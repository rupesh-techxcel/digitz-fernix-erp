# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""Every cashier day (Counter Session), one line per date close: float, cash
movements, expected vs counted cash. A day still open, or not counted yet, has
one line of its own.

The report's ref_doctype is Sales Invoice, not Counter Session: Frappe grants no
doctype-level "report" right through an If Owner rule, which is how a Cashier
holds Counter Session, so the report would be closed to them. A Cashier holds
Sales Invoice without If Owner. get_data limits a Cashier to their own sessions.
"""

import frappe


def execute(filters=None):
	return get_columns(), get_data(filters or {})


def get_columns():
	currency = lambda fieldname, label, width=110: {"fieldname": fieldname, "label": label, "fieldtype": "Currency", "width": width}
	return [
		{"fieldname": "close_date", "label": "Date", "fieldtype": "Date", "width": 100},
		{"fieldname": "name", "label": "Session", "fieldtype": "Link", "options": "Counter Session", "width": 150},
		# Data, not a Link: a Cashier cannot read Counter, and query_report checks every
		# Link column against the user's read rights once there are rows
		{"fieldname": "counter", "label": "Counter", "fieldtype": "Data", "width": 120},
		{"fieldname": "cashier_name", "label": "Cashier", "fieldtype": "Data", "width": 150},
		{"fieldname": "opened_on", "label": "Opened", "fieldtype": "Datetime", "width": 150},
		{"fieldname": "closed_on", "label": "Closed", "fieldtype": "Datetime", "width": 150},
		{"fieldname": "status", "label": "Status", "fieldtype": "Data", "width": 90},
		currency("opening_float", "Float"),
		currency("cash_sales", "Cash Sales"),
		currency("cash_receipts", "Cash Receipts"),
		currency("cash_refunds", "Refunds"),
		currency("cash_paid_out", "Paid Out"),
		currency("cash_expenditure", "Expenditure"),
		currency("expected_cash", "Expected"),
		currency("counted_cash", "Counted"),
		currency("difference", "Difference"),
		{"fieldname": "closed_by", "label": "Closed By", "fieldtype": "Data", "width": 140},
		{"fieldname": "approved_by", "label": "Approved By", "fieldtype": "Data", "width": 140},
	]


def get_data(filters):
	# Cashier limited to own sessions; Administrator and System Manager are not
	current_user = frappe.session.user
	roles = set(frappe.get_roles(current_user))
	is_privileged = current_user == "Administrator" or "System Manager" in roles

	if "Cashier" in roles and not is_privileged:
		filters["cashier"] = current_user

	day = "IFNULL(t.close_date, DATE(t.opened_on))"
	conditions = []
	if filters.get("from_date"):
		conditions.append(f"{day} >= %(from_date)s")
	if filters.get("to_date"):
		conditions.append(f"{day} <= %(to_date)s")
	for field in ("counter", "cashier", "status"):
		if filters.get(field):
			conditions.append(f"t.{field} = %({field})s")
	where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

	return frappe.db.sql(
		f"""
		SELECT t.name, t.close_date, t.counter, IFNULL(u.full_name, t.cashier) AS cashier_name, t.opened_on,
			t.closed_on, t.status, t.opening_float, t.cash_sales, t.cash_receipts, t.cash_refunds,
			t.cash_paid_out, t.cash_expenditure, t.expected_cash, t.counted_cash, t.difference,
			IFNULL(c.full_name, t.closed_by) AS closed_by, IFNULL(a.full_name, t.approved_by) AS approved_by
		FROM (
			-- Each date's close
			SELECT cs.name, dc.close_date, cs.counter, cs.cashier, cs.opened_on, dc.closed_on, dc.status,
				dc.opening_float, dc.cash_sales, dc.cash_receipts, dc.cash_refunds, dc.cash_paid_out,
				dc.cash_expenditure, dc.expected_cash, dc.counted_cash, dc.difference, dc.closed_by, dc.approved_by
			FROM `tabCounter Session` cs
			INNER JOIN `tabCounter Session Date Close` dc ON dc.parent = cs.name AND dc.parenttype = 'Counter Session'
			WHERE cs.docstatus < 2
			UNION ALL
			-- A day still open, or with nothing counted yet
			SELECT cs.name, NULL, cs.counter, cs.cashier, cs.opened_on, cs.closed_on, cs.status,
				cs.opening_float, cs.cash_sales, cs.cash_receipts, cs.cash_refunds, cs.cash_paid_out,
				cs.cash_expenditure, cs.expected_cash, cs.counted_cash, cs.difference, cs.closed_by, cs.approved_by
			FROM `tabCounter Session` cs
			WHERE cs.docstatus < 2 AND (cs.status = 'Open' OR NOT EXISTS (
				SELECT 1 FROM `tabCounter Session Date Close` x WHERE x.parent = cs.name AND x.parenttype = 'Counter Session'
			))
		) t
		LEFT JOIN `tabUser` u ON u.name = t.cashier
		LEFT JOIN `tabUser` c ON c.name = t.closed_by
		LEFT JOIN `tabUser` a ON a.name = t.approved_by
		{where}
		ORDER BY {day} DESC, t.opened_on DESC
		""",
		filters,
		as_dict=True,
	)
