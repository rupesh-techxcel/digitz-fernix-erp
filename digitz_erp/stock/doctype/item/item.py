# Copyright (c) 2022, Rupesh P and contributors
# For license information, please see license.txt

import frappe
import uuid
from frappe.model.document import Document
from digitz_erp.api.settings_api import get_default_currency
from digitz_erp.api.item_price_api import update_item_price
from frappe import _
from frappe.model.naming import getseries
from frappe.utils import flt

class Item(Document):

	def before_naming(self):
		# Item is named from item_code, so the code has to be in place before naming runs.
		# The generated code replaces anything carried in (e.g. from Duplicate); only
		# Data Import rows keep the code they bring. Existing items are never renumbered.
		if not self.is_new() or not item_code_from_item_group_enabled():
			return
		if self.item_code and frappe.flags.in_import:
			return
		self.item_code = get_next_item_code(self.item_group)
    		
	def validate(self):

		if not self.item_name_arabic and frappe.db.get_single_value("Settings", "item_name_arabic_mandatory"):
			frappe.throw("Item Name Arabic is mandatory for the item.")
     
		if not self.is_new():
			if self.base_unit != frappe.db.get_value("Item", self.item_code, "base_unit"):
				self.check_stock_ledgers_for_base_unit_change()
   
   
		default_company = frappe.db.get_single_value(
			"Global Settings", "default_company")
  
		company_default = frappe.get_value("Company", default_company, ['default_product_expense_account'], as_dict=1)

		if not company_default.default_product_expense_account:
			frappe.throw("'Default Product Expense Account' is not configured for the company.")
       
   
	def check_stock_ledgers_for_base_unit_change(self):
		base_unit = self.base_unit
		existing_stock_ledgers = frappe.db.get_all("Stock Ledger", filters={"item": self.item_code}, fields=["name", "unit"])
		for ledger in existing_stock_ledgers:
			if ledger["unit"] != base_unit:
				frappe.throw("Cannot change base unit as it's being used in stock ledgers.")
    
	def before_save(self):
		if self.is_new():
			return

		# Administrator holds every role in Frappe, Cashier included, so a bare
		# role check locks the superuser out of the item master it owns. The
		# companion hook, medical_services.item_has_permission, already makes
		# this exemption; this method was missing it.
		if frappe.session.user == "Administrator":
			return

		# A save by the system on the user's behalf, not an edit: the customer's
		# latest rate recorded when a Cashier submits an invoice
		# (item_price_api.update_customer_item_price)
		if self.flags.ignore_permissions:
			return

		if "Cashier" in frappe.get_roles(frappe.session.user):
			frappe.throw("You are not allowed to edit Items.")
	def before_validate(self):
		
		base_unit_exists = False
		# Loop through the rows in the child table 'Item Unit'
		for row in self.units:
			# Check if there is already a row with the base_unit
			if row.unit == self.base_unit:
				base_unit_exists = True
				break
		
		# If base_unit does not exist, add it with conversion factor 1
		if not base_unit_exists:
			self.append("units", {
				"unit": self.base_unit,
				"conversion_factor": 1
			})	

			
		if not self.description:
			self.description = self.item_name

		if self.item_type == "Fixed Asset" and self.maintain_stock:
			self.maintain_stock = False
			frappe.msgprint("Maintaining stock for fixed assets is not applicable. It has been set to false.",alert=True)

		if not self.default_expense_account:
      
			default_company = frappe.db.get_single_value(
			"Global Settings", "default_company")

			company_default = frappe.get_value("Company", default_company, ['default_product_expense_account'], as_dict=1)
		
			if company_default.default_product_expense_account:
				self.default_expense_account  = company_default.default_expense_account

	def update_standard_selling_price(self):
		"""Keep the item's undated 'Standard Selling' Item Price in step with its charges.

		Items are priced by Service Charge + Typing Charges + Transaction Charges +
		GOV, so those are what gets copied, and the Item Price works its rate out as their sum. The
		hidden Standard Selling Price field follows the same sum. Item Price copies
		changes back the other way (ItemPrice.on_update); `from_item` stops that
		echoing straight back here.
		"""
		charges = {f: flt(self.get(f)) for f in ("service_charge", "typing_charges", "transaction_charges", "gov")}
		total = sum(charges.values())

		if flt(self.standard_selling_price) != total:
			self.db_set("standard_selling_price", total, update_modified=False)

		currency = get_default_currency()

		# The undated price is the standing one; dated prices are temporary and left alone
		item_price_name = frappe.db.get_value("Item Price", {
			"item": self.item_code, "price_list": "Standard Selling",
			"from_date": ["is", "not set"], "to_date": ["is", "not set"]}, "name")

		if not item_price_name:
			if not total:
				return

			item_price = frappe.get_doc({
				"doctype": "Item Price",
				"item": self.item_code,
				"item_name": self.item_name,
				"price_list": "Standard Selling",
				"currency": currency,
				"is_selling": 1,
				"unit": self.base_unit,
				"rate": total,
				**charges,
			})
			item_price.flags.from_item = True
			item_price.insert(ignore_permissions=True, ignore_links=True)
			frappe.msgprint(f"Price list 'Standard Selling' added for the item {self.item_code}", alert=True)
			return

		item_price = frappe.get_doc("Item Price", item_price_name)
		if any(flt(item_price.get(f)) != v for f, v in charges.items()) or flt(item_price.rate) != total:
			item_price.update(charges)
			item_price.rate = total
			item_price.flags.from_item = True
			item_price.save(ignore_permissions=True)
			frappe.msgprint(f"Price list 'Standard Selling' updated for the item {self.item_code}", alert=True)

	def update_standard_buying_price(self):

		currency = get_default_currency()

		if not frappe.db.exists("Item Price",{'item': self.item_code, 'price_list':'Standard Buying', 'currency':currency}):

			if(self.standard_buying_price>0):

				item_price = frappe.get_doc({
				"doctype": "Item Price",
				"item": self.item_code,
				"item_name": self.item_name,
				"price_list": "Standard Buying",
				"currency": currency,
				"is_buying":1,
				"rate": self.standard_buying_price,
				"unit": self.base_unit
				})

				# Set the flags to ignore permissions and links
				item_price.flags.ignore_permissions = True
				item_price.flags.ignore_links = True

				# Save the document to the database without firing hooks
				item_price.insert(ignore_permissions=True, ignore_links=True)
				
				frappe.msgprint(f"Price list,'Standard Buying' added for the item, {self.item_code}", alert= True)
		else:
				item_price_name = frappe.get_value("Item Price",{'item': self.item_code, 'price_list': 'Standard Buying', 'currency':currency},['name'])
				item_price_to_update = frappe.get_doc('Item Price', item_price_name)

				if(item_price_to_update.rate != self.standard_buying_price):
					item_price_to_update.rate = self.standard_buying_price
					item_price_to_update.save()
					frappe.msgprint(f"Price list,'Standard Buying' updated for the item, {self.item_code}", alert= True)

				# #print("item_price_to_update")
				# #print(item_price_to_update)

				# if(item_price_to_update.rate != self.standard_buying_price):
				# 	sql = """
				# 	UPDATE `tabItem Price`
				# 	SET `rate` = %s
				# 	WHERE `name` = %s
				# 	""".format(frappe.db.escape(self.standard_buying_price), frappe.db.escape(item_price_name))


	def on_update(self):

		# if self.do_not_update_price == False:
		self.update_standard_buying_price()
		self.update_standard_selling_price()

def item_code_from_item_group_enabled():
	return bool(frappe.db.get_single_value("Settings", "item_group_code_required")
		and frappe.db.get_single_value("Settings", "create_item_code_from_item_group"))

def get_next_item_code(item_group):

	if not item_group:
		frappe.throw("Select Item Group to generate the Item Code.")

	item_group_code = frappe.db.get_value("Item Group", item_group, "item_group_code")
	if not item_group_code:
		frappe.throw(f"Item Group Code is not set for item group {item_group}.")

	# Series locks its row, so concurrent saves never draw the same number.
	# Skip numbers already taken by items created by hand or imported.
	while True:
		item_code = item_group_code + getseries(f"Item Code {item_group_code}", 4)
		if not frappe.db.exists("Item", item_code):
			return item_code

@frappe.whitelist()
def get_item_settings():
	# Settings is readable only by System Manager, so the Item form reads the flags through here
	return {
		"item_code_from_item_group": item_code_from_item_group_enabled(),
		"item_name_arabic_mandatory": bool(frappe.db.get_single_value("Settings", "item_name_arabic_mandatory")),
	}
