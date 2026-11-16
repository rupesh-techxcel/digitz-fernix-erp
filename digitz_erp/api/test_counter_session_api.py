import unittest
from datetime import date
from unittest.mock import patch

import frappe

from digitz_erp.api import counter_session_api as api


class TestInvoiceDaySessions(unittest.TestCase):
	@patch.object(api, "frappe")
	def test_selects_invoice_sessions_including_corrected_close(self, framework):
		db, get_all = framework.db, framework.get_all
		db.sql_list.return_value = ["earlier-day", "original"]
		get_all.return_value = [
			frappe._dict(name="earlier-day", amended_from=None, docstatus=0),
			frappe._dict(name="opened-today-without-invoices", amended_from=None, docstatus=0),
			frappe._dict(name="original", amended_from=None, docstatus=2),
			frappe._dict(name="correction", amended_from="original", docstatus=2),
			frappe._dict(name="latest", amended_from="correction", docstatus=1),
		]
		posting_date = date(2026, 11, 13)
		self.assertEqual(api.get_invoice_day_sessions(posting_date), ["earlier-day", "latest"])
		query, params = db.sql_list.call_args.args
		self.assertIn("posting_date = %(date)s", query)
		self.assertIn("docstatus = 1", query)
		self.assertNotIn("opened_on", query)
		self.assertEqual(params, {"date": posting_date})

	@patch.object(api, "frappe")
	def test_no_invoices_does_not_fall_back_to_opening_date(self, framework):
		db, get_all = framework.db, framework.get_all
		db.sql_list.return_value = []
		self.assertEqual(api.get_invoice_day_sessions(date(2026, 11, 13)), [])
		get_all.assert_not_called()


class TestPendingCloseAllowsOpen(unittest.TestCase):
	@patch.object(api, "frappe")
	def test_active_session_lookup_excludes_pending_close(self, framework):
		framework.session.user = "cashier@example.com"
		framework.db.get_value.return_value = "new-day"
		for billing in (False, True):
			self.assertEqual(api.get_open_session(counter="Counter 3", billing=billing), "new-day")
			framework.db.get_value.assert_called_with(
				"Counter Session",
				{"cashier": "cashier@example.com", "docstatus": 0, "status": "Open", "counter": "Counter 3"},
				"name",
			)

	def test_pending_close_does_not_block_but_open_day_does(self):
		from digitz_erp.digitz_erp.doctype.counter_session import counter_session as model

		doc = frappe._dict(name="new-day", cashier="cashier@example.com", counter="Counter 3")
		pending = {"name": "previous-day", "cashier": doc.cashier, "counter": doc.counter,
			"docstatus": 0, "status": "Closing"}

		def find_session(doctype, filters, fields, **kwargs):
			return pending["name"] if all(
				pending.get(key) == value for key, value in filters.items() if key != "name"
			) else None

		with patch.object(model, "frappe") as framework:
			framework.db.get_value.side_effect = find_session
			model.CounterSession.validate_single_open_session(doc)
			framework.throw.assert_not_called()
			# A cashier's active day on another counter must still block a new day.
			pending.update(status="Open", counter="Counter 2")
			model.CounterSession.validate_single_open_session(doc)
			framework.throw.assert_called_once()
