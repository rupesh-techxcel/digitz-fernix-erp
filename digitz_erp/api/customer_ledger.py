# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""The Cashier Console's Customer Ledger tab: one customer's statement.

Runs the Account Ledger Report's own query for the customer, so the two always
agree. A cashier cannot open that report (it needs report rights on GL Posting,
which would show every ledger), so the console reads it through here, for one
customer the user can read.
"""

import frappe
from frappe.utils import add_months, flt, get_first_day, getdate, nowdate

from digitz_erp.accounts.report.account_ledger_report.account_ledger_report import get_data


@frappe.whitelist()
def get_customer_ledger(customer, from_date=None, to_date=None):
	if not customer:
		frappe.throw("Select a customer.")
	if not frappe.has_permission("Customer", "read", customer):
		frappe.throw(f"You cannot see {customer}.", frappe.PermissionError)

	to_date = getdate(to_date or nowdate())
	from_date = getdate(from_date or get_first_day(add_months(to_date, -2)))
	if from_date > to_date:
		from_date, to_date = to_date, from_date

	rows = get_data(frappe._dict(customer=customer, from_date=from_date, to_date=to_date))
	opening = next((r for r in rows if r.get("voucher_type") == "Opening"), None)
	closing = next((r for r in rows if r.get("voucher_type") == "Closing Balance"), None)
	entries = [r for r in rows if r.get("voucher_type") not in ("Opening", "Closing Balance")]

	def balance(row):
		return flt(row.get("debit_amount")) - flt(row.get("credit_amount")) if row else 0

	return {
		"customer": customer,
		"customer_name": frappe.db.get_value("Customer", customer, "customer_name"),
		"from_date": from_date,
		"to_date": to_date,
		"rows": rows,
		"opening": balance(opening),
		"debit": sum(flt(r.get("debit_amount")) for r in entries),
		"credit": sum(flt(r.get("credit_amount")) for r in entries),
		"closing": balance(closing),
		"can_open_report": "System Manager" in frappe.get_roles(),
	}
