# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""Data for the Historical Invoices page (page/historical_invoices).

Invoices from the previous system, read-only: a filtered, paged list with
totals, and one invoice with its lines for the invoice view.
"""

import frappe
from frappe.utils import cint, flt

PAGE_LENGTH = 50

LIST_FIELDS = [
	"name", "invoice_number", "invoice_date", "invoice_time", "customer_name",
	"display_customer", "customer_mobile", "payment_mode", "payment_status",
	"sales_man", "invoice_total",
]


def _conditions(filters):
	"""SQL conditions and values for the page's filters."""
	filters = frappe.parse_json(filters) if isinstance(filters, str) else (filters or {})
	conditions, values = [], {}

	def add(sql, key, value):
		conditions.append(sql)
		values[key] = value

	if filters.get("from_date"):
		add("invoice_date >= %(from_date)s", "from_date", filters["from_date"])
	if filters.get("to_date"):
		add("invoice_date <= %(to_date)s", "to_date", filters["to_date"])
	for field in ("customer_name", "payment_mode", "payment_status", "sales_man"):
		if filters.get(field):
			add(f"`{field}` = %({field})s", field, filters[field])
	if filters.get("search"):
		add(
			"(invoice_number like %(search)s or display_customer like %(search)s"
			" or customer_mobile like %(search)s or customer_name like %(search)s)",
			"search", f"%{filters['search'].strip()}%",
		)
	if filters.get("service"):
		add(
			"name in (select parent from `tabHistorical Invoice Item`"
			" where parenttype = 'Historical Invoice' and service_name like %(service)s)",
			"service", f"%{filters['service'].strip()}%",
		)
	return (" where " + " and ".join(conditions)) if conditions else "", values


@frappe.whitelist()
def get_filter_options():
	"""Distinct values for the select filters, and the date range on file."""
	frappe.has_permission("Historical Invoice", "read", throw=True)

	def distinct(field):
		return frappe.db.sql_list(
			f"select distinct `{field}` from `tabHistorical Invoice`"
			f" where ifnull(`{field}`, '') != '' order by `{field}`"
		)

	first, last = frappe.db.sql(
		"select min(invoice_date), max(invoice_date) from `tabHistorical Invoice`"
	)[0]
	return {
		"customers": distinct("customer_name"),
		"payment_modes": distinct("payment_mode"),
		"payment_statuses": distinct("payment_status"),
		"sales_men": distinct("sales_man"),
		"first_date": first,
		"last_date": last,
	}


@frappe.whitelist()
def get_invoices(filters=None, start=0, page_length=PAGE_LENGTH):
	"""One page of invoices matching the filters, newest first, with the totals of all matches."""
	frappe.has_permission("Historical Invoice", "read", throw=True)
	where, values = _conditions(filters)
	start, page_length = cint(start), min(cint(page_length) or PAGE_LENGTH, 500)

	rows = frappe.db.sql(
		f"select {', '.join(f'`{f}`' for f in LIST_FIELDS)} from `tabHistorical Invoice`{where}"
		f" order by invoice_date desc, invoice_time desc, name desc limit {page_length} offset {start}",
		values, as_dict=True,
	)
	totals = frappe.db.sql(
		f"""select count(*) as count,
			coalesce(sum(invoice_total), 0) as total,
			coalesce(sum(case when payment_status = 'Fully Paid' then invoice_total else 0 end), 0) as paid,
			coalesce(sum(case when payment_status != 'Fully Paid' then invoice_total else 0 end), 0) as unpaid,
			coalesce(sum(total_vat), 0) as vat,
			coalesce(sum(total_govt_fee), 0) as govt_fee
		from `tabHistorical Invoice`{where}""",
		values, as_dict=True,
	)[0]
	return {"rows": rows, "totals": totals, "start": start, "page_length": page_length}


@frappe.whitelist()
def get_invoice(name):
	"""One invoice with its lines, and the company details for the invoice heading."""
	doc = frappe.get_doc("Historical Invoice", name)
	doc.check_permission("read")

	company = frappe.db.get_single_value("Global Settings", "default_company")
	company_details = frappe.db.get_value(
		"Company", company,
		[
			"company_name", "address", "phone", "email_id", "tax_id", "company_logo",
			"invoice_header_image", "footer_image",
		],
		as_dict=True,
	) if company else None

	data = doc.as_dict(no_default_fields=True)
	data["name"] = doc.name
	data["company"] = company_details or {}
	data["computed_total"] = flt(sum(flt(i.amount) for i in doc.items), 2)
	return data
