# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""Server side of the Price List Manager page.

Price List and Item Price are separate doctypes: an Item Price row ties one item
to one price list at a rate. The page lists the price lists, and for the selected
one lists, adds, edits and deletes its Item Price rows.

Every call is limited to MANAGER_ROLES. Item Price and Price List are only
permitted to System Manager at the doctype level, so writes run with
ignore_permissions once the role check has passed. They still go through the
normal document save, so Item Price's own rules (one undated price per item and
list, no overlapping date ranges, keeping Item's standard prices in step) apply.
"""

import frappe
from frappe.utils import flt, getdate

from digitz_erp.api.settings_api import get_default_currency

MANAGER_ROLES = ("System Manager", "Management")

# The default selling price list. Every other selling list is a deviation from it
# for particular customers, so its items are shown against this list's rates.
STANDARD_PRICE_LIST = "Standard Selling"

# An item's standard rate: its undated Standard Selling price, or, with none, the sum
# of its charges on the Item master (which is what that price is kept in step with).
STANDARD_RATE_SQL = """
	COALESCE(
		(SELECT MAX(std.rate) FROM `tabItem Price` std
		 WHERE std.item = {item} AND std.price_list = %(standard_price_list)s
		   AND std.from_date IS NULL AND std.to_date IS NULL),
		IFNULL(i.service_charge, 0) + IFNULL(i.typing_charges, 0) + IFNULL(i.transaction_charges, 0) + IFNULL(i.gov, 0)
	)
"""


def check_manager():
	frappe.only_for(MANAGER_ROLES)


@frappe.whitelist()
def get_price_lists():
	check_manager()

	return frappe.db.sql(
		"""
		SELECT pl.name, pl.is_selling, pl.is_buying, COUNT(ip.name) AS item_count
		FROM `tabPrice List` pl
		LEFT JOIN `tabItem Price` ip ON ip.price_list = pl.name
		GROUP BY pl.name, pl.is_selling, pl.is_buying
		ORDER BY pl.name
		""",
		as_dict=True,
	)


@frappe.whitelist()
def get_item_prices(price_list):
	check_manager()

	return frappe.db.sql(
		f"""
		SELECT ip.name, ip.item, COALESCE(i.item_name, ip.item_name) AS item_name,
			ip.unit, ip.currency, ip.service_charge, ip.typing_charges, ip.transaction_charges, ip.gov, ip.rate,
			ip.from_date, ip.to_date, ip.modified,
			{STANDARD_RATE_SQL.format(item="ip.item")} AS standard_rate
		FROM `tabItem Price` ip
		LEFT JOIN `tabItem` i ON i.name = ip.item
		WHERE ip.price_list = %(price_list)s
		ORDER BY item_name, ip.item, ip.from_date
		""",
		{"price_list": price_list, "standard_price_list": STANDARD_PRICE_LIST},
		as_dict=True,
	)


@frappe.whitelist()
def get_item_defaults(item):
	"""Values to pre-fill when an item is picked in the add dialog."""
	check_manager()

	defaults = frappe.db.get_value("Item", item,
		["item_name", "base_unit as unit", "service_charge", "typing_charges", "transaction_charges", "gov"], as_dict=True) or {}
	defaults["currency"] = get_default_currency()
	defaults["standard_rate"] = flt(frappe.db.sql(
		f"SELECT {STANDARD_RATE_SQL.format(item='i.name')} FROM `tabItem` i WHERE i.name = %(item)s",
		{"item": item, "standard_price_list": STANDARD_PRICE_LIST})[0][0]) if defaults else 0
	return defaults


@frappe.whitelist()
def get_standard_rate(item):
	"""The item's current standard selling rate, read fresh when a price is opened."""
	check_manager()

	row = frappe.db.sql(
		f"SELECT {STANDARD_RATE_SQL.format(item='i.name')} FROM `tabItem` i WHERE i.name = %(item)s",
		{"item": item, "standard_price_list": STANDARD_PRICE_LIST})
	return {"standard_price_list": STANDARD_PRICE_LIST, "standard_rate": flt(row[0][0]) if row else 0}


@frappe.whitelist()
def save_item_price(price_list, item, rate, unit, currency, from_date=None, to_date=None, name=None,
		service_charge=0, typing_charges=0, transaction_charges=0, gov=0):
	"""Create an Item Price, or update the one called `name`.

	With any of Service Charge, Typing Charges, Transaction Charges or GOV set, Item Price works the rate
	out as their sum on save, so the rate passed in only matters without them.
	"""
	check_manager()

	from_date = from_date or None
	to_date = to_date or None

	if min(flt(rate), flt(service_charge), flt(typing_charges), flt(transaction_charges), flt(gov)) < 0:
		frappe.throw("Rate and charges cannot be negative.")

	if bool(from_date) != bool(to_date):
		frappe.throw("Enter both From Date and To Date, or leave both empty.")

	if from_date and getdate(from_date) > getdate(to_date):
		frappe.throw("From Date cannot be after To Date.")

	if name:
		doc = frappe.get_doc("Item Price", name)
		if doc.price_list != price_list:
			frappe.throw("This price belongs to a different price list. Reload the page and try again.")
	else:
		doc = frappe.new_doc("Item Price")
		doc.price_list = price_list

	doc.item = item
	doc.service_charge = flt(service_charge)
	doc.typing_charges = flt(typing_charges)
	doc.transaction_charges = flt(transaction_charges)
	doc.gov = flt(gov)
	doc.rate = flt(rate)
	doc.unit = unit
	doc.currency = currency
	doc.from_date = from_date
	doc.to_date = to_date
	doc.save(ignore_permissions=True)

	return doc.name


@frappe.whitelist()
def delete_item_price(name):
	check_manager()

	frappe.delete_doc("Item Price", name, ignore_permissions=True)


@frappe.whitelist()
def create_price_list(price_list_name, is_selling=0, is_buying=0):
	check_manager()

	price_list_name = (price_list_name or "").strip()
	if not price_list_name:
		frappe.throw("Enter a name for the price list.")

	if frappe.db.exists("Price List", price_list_name):
		frappe.throw(f"Price List {price_list_name} already exists.")

	doc = frappe.new_doc("Price List")
	doc.price_list_name = price_list_name
	doc.is_selling = 1 if frappe.utils.cint(is_selling) else 0
	doc.is_buying = 1 if frappe.utils.cint(is_buying) else 0
	doc.insert(ignore_permissions=True)

	return doc.name
