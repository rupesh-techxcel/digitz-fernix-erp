# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""Every cashier day (Counter Session): float, cash movements, expected vs counted cash."""

import frappe


def execute(filters=None):
	return get_columns(), get_data(filters or {})


def get_columns():
	currency = lambda fieldname, label, width=110: {"fieldname": fieldname, "label": label, "fieldtype": "Currency", "width": width}
	return [
		{"fieldname": "name", "label": "Session", "fieldtype": "Link", "options": "Counter Session", "width": 150},
		{"fieldname": "counter", "label": "Counter", "fieldtype": "Link", "options": "Counter", "width": 120},
		{"fieldname": "cashier_name", "label": "Cashier", "fieldtype": "Data", "width": 150},
		{"fieldname": "opened_on", "label": "Opened", "fieldtype": "Datetime", "width": 150},
		{"fieldname": "closed_on", "label": "Closed", "fieldtype": "Datetime", "width": 150},
		{"fieldname": "status", "label": "Status", "fieldtype": "Data", "width": 90},
		currency("opening_float", "Float"),
		currency("cash_sales", "Cash Sales"),
		currency("cash_receipts", "Cash Receipts"),
		currency("cash_refunds", "Refunds"),
		currency("cash_paid_out", "Paid Out"),
		currency("expected_cash", "Expected"),
		currency("counted_cash", "Counted"),
		currency("difference", "Difference"),
		{"fieldname": "closed_by", "label": "Closed By", "fieldtype": "Data", "width": 140},
		{"fieldname": "approved_by", "label": "Approved By", "fieldtype": "Data", "width": 140},
	]


def get_data(filters):
	conditions = ["cs.docstatus < 2"]
	if filters.get("from_date"):
		conditions.append("DATE(cs.opened_on) >= %(from_date)s")
	if filters.get("to_date"):
		conditions.append("DATE(cs.opened_on) <= %(to_date)s")
	for field in ("counter", "cashier", "status"):
		if filters.get(field):
			conditions.append(f"cs.{field} = %({field})s")

	return frappe.db.sql(
		f"""
		SELECT cs.name, cs.counter, IFNULL(u.full_name, cs.cashier) AS cashier_name, cs.opened_on, cs.closed_on,
			cs.status, cs.opening_float, cs.cash_sales, cs.cash_receipts, cs.cash_refunds, cs.cash_paid_out,
			cs.expected_cash, cs.counted_cash, cs.difference, IFNULL(c.full_name, cs.closed_by) AS closed_by,
			IFNULL(a.full_name, cs.approved_by) AS approved_by
		FROM `tabCounter Session` cs
		LEFT JOIN `tabUser` u ON u.name = cs.cashier
		LEFT JOIN `tabUser` c ON c.name = cs.closed_by
		LEFT JOIN `tabUser` a ON a.name = cs.approved_by
		WHERE {" AND ".join(conditions)}
		ORDER BY cs.opened_on DESC
		""",
		filters,
		as_dict=True,
	)
