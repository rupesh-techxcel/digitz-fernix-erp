import frappe
from frappe.utils import getdate


def execute():
	"""Give every counted Counter Session its close as a date close row, now
	that a session is closed date by date.

	One row per session, on the date its till was closed, with the count,
	expenditure, expected cash and difference exactly as saved: nothing is
	recalculated or deleted, so slips, Day History and reports show the same
	figures. The session's closing count rows (notes and coins, non-cash totals)
	get the same date. A finished (submitted or cancelled) session's count
	covered its whole day, so the row is marked so and asks for no more dates;
	a close still waiting for approval becomes date by date, and a supervisor
	counts any other date of it on Day Close. Days still open get no row.
	Safe to run again: a session that already has a row is skipped.
	"""
	sessions = frappe.db.sql(
		"""
		SELECT cs.name, cs.docstatus, cs.status, cs.closed_on, cs.closed_by, cs.approved_by, cs.close_remarks,
			cs.opening_float, cs.cash_sales, cs.cash_receipts, cs.cash_refunds, cs.cash_paid_out,
			cs.cash_expenditure, cs.expected_cash, cs.counted_cash, cs.difference
		FROM `tabCounter Session` cs
		WHERE cs.status IN ('Closing', 'Closed', 'Cancelled') AND cs.closed_on IS NOT NULL
		  AND NOT EXISTS (
			SELECT 1 FROM `tabCounter Session Date Close` dc
			WHERE dc.parent = cs.name AND dc.parenttype = 'Counter Session'
		  )
		""",
		as_dict=True,
	)
	for s in sessions:
		close_date = getdate(s.closed_on)
		finished = s.docstatus in (1, 2)
		row = frappe.get_doc({
			"doctype": "Counter Session Date Close",
			"parent": s.name,
			"parenttype": "Counter Session",
			"parentfield": "date_closes",
			"idx": 1,
			"docstatus": s.docstatus,
			"close_date": close_date,
			"status": "Closed" if finished else "Closing",
			"covers_whole_day": 1 if finished else 0,
			"opening_float": s.opening_float,
			"cash_sales": s.cash_sales,
			"cash_receipts": s.cash_receipts,
			"cash_refunds": s.cash_refunds,
			"cash_paid_out": s.cash_paid_out,
			"cash_expenditure": s.cash_expenditure,
			"expected_cash": s.expected_cash,
			"counted_cash": s.counted_cash,
			"difference": s.difference,
			"closed_by": s.closed_by,
			"closed_on": s.closed_on,
			"approved_by": s.approved_by,
			"remarks": s.close_remarks,
		})
		row.db_insert()

		for doctype, parentfield in (
			("Cash Denomination Count", "denominations"),
			("Counter Session Payment Total", "payment_mode_totals"),
		):
			frappe.db.sql(
				f"""
				UPDATE `tab{doctype}` SET close_date = %(close_date)s
				WHERE parent = %(parent)s AND parenttype = 'Counter Session'
				  AND parentfield = %(parentfield)s AND close_date IS NULL
				""",
				{"close_date": close_date, "parent": s.name, "parentfield": parentfield},
			)
