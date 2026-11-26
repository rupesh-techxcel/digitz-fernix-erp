# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""Data for the Print or View Invoices page (page/print_or_view_invoices).

Sales Invoices as a filtered, paged list with totals, and one invoice's printed
PDFs (invoice, and receipt when it has one) to view and print. The list goes
through frappe.get_list, so each user sees only the invoices they may read.
"""

import frappe
from frappe.utils import cint

PAGE_LENGTH = 50

LIST_FIELDS = [
	"name", "posting_date", "posting_time", "customer_name", "customer_display_name",
	"customer_mobile_number", "payment_mode", "credit_sale", "rounded_total", "docstatus",
]


def _filters(filters):
	"""get_list filters and or_filters for the page's filters."""
	filters = frappe.parse_json(filters) if isinstance(filters, str) else (filters or {})
	where, or_where = [["for_advance_payment", "=", 0]], []

	if filters.get("from_date"):
		where.append(["posting_date", ">=", filters["from_date"]])
	if filters.get("to_date"):
		where.append(["posting_date", "<=", filters["to_date"]])
	for field in ("customer", "payment_mode"):
		if filters.get(field):
			where.append([field, "=", filters[field]])
	if filters.get("sale_type") in ("Cash", "Credit"):
		where.append(["credit_sale", "=", 1 if filters["sale_type"] == "Credit" else 0])
	status = {"Draft": 0, "Submitted": 1, "Cancelled": 2}.get(filters.get("status"))
	if status is not None:
		where.append(["docstatus", "=", status])
	if filters.get("search"):
		search = f"%{filters['search'].strip()}%"
		or_where = [[field, "like", search] for field in
			("name", "customer_name", "customer_display_name", "customer_mobile_number")]
	return where, or_where


@frappe.whitelist()
def get_invoices(filters=None, start=0, page_length=PAGE_LENGTH):
	"""One page of invoices matching the filters, newest first, with the count and total of all matches."""
	where, or_where = _filters(filters)
	rows = frappe.get_list(
		"Sales Invoice", fields=LIST_FIELDS, filters=where, or_filters=or_where,
		order_by="posting_date desc, posting_time desc, creation desc",
		start=cint(start), page_length=min(cint(page_length) or PAGE_LENGTH, 200),
	)
	totals = frappe.get_list(
		"Sales Invoice", fields=["count(name) as count", "sum(rounded_total) as total"],
		filters=where, or_filters=or_where, order_by=None,
	)[0]
	return {"rows": rows, "totals": totals}


@frappe.whitelist()
def get_invoice_pdfs(name):
	"""The invoice's printed PDFs, {invoice, receipt, docstatus}, generating them when none is attached yet."""
	from digitz_erp.selling.doctype.sales_invoice.sales_invoice import get_print_pdf_urls

	doc = frappe.get_doc("Sales Invoice", name)
	doc.check_permission("read")
	files = get_print_pdf_urls(name)
	if not files.get("invoice"):
		files = doc.attach_print_pdfs()
	return {**files, "docstatus": doc.docstatus}
