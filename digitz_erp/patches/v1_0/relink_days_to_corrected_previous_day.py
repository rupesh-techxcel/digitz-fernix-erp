import frappe
from frappe.utils import flt

from digitz_erp.api.counter_session_api import get_live_session


def execute():
	"""Days still open or awaiting approval whose previous day was corrected
	after they were opened link to the cancelled original, which stops them
	being closed. Link them to the correction instead."""
	stale = frappe.db.sql(
		"""
		SELECT s.name, s.previous_session
		FROM `tabCounter Session` s
		INNER JOIN `tabCounter Session` p ON p.name = s.previous_session
		WHERE s.docstatus = 0 AND p.docstatus = 2
		""",
		as_dict=True,
	)
	for row in stale:
		live = get_live_session(row.previous_session)
		frappe.db.set_value(
			"Counter Session", row.name,
			{
				"previous_session": live,
				"previous_closing_cash": flt(frappe.db.get_value("Counter Session", live, "counted_cash")) if live else 0,
			},
		)
