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


class TestDayOverviewRecalculation(unittest.TestCase):
	def test_pending_and_closed_overviews_recalculate_after_return_cancelled(self):
		from digitz_erp.digitz_erp.doctype.counter_session import counter_session as model
		for docstatus, status in ((0, 'Closing'), (1, 'Closed')):
			with self.subTest(status=status):
				doc = frappe._dict({
					'doctype': 'Counter Session', 'name': 'day-1', 'docstatus': docstatus,
					'status': status, 'cashier': 'cashier@example.com', 'counter': 'Counter 3',
					'opened_on': '2026-11-13 09:00:00', 'closed_on': '2026-11-13 20:00:00',
					'opening_float': 100, 'counted_cash': 140, 'cash_expenditure': 0,
					'approved_by': 'Administrator' if docstatus else None,
					'payment_mode_totals': [], 'denominations': [],
				})
				doc.is_new = lambda: False
				doc.source_session = lambda: 'day-1'
				doc.set = doc.__setitem__
				doc.calculate_cash = lambda: model.CounterSession.calculate_cash(doc)
				with patch.object(api, 'frappe') as framework, \
						patch.object(api, 'get_invoice_day_sessions', return_value=['day-1']), \
						patch.object(api, 'get_non_cash_payment_modes', return_value=[]), \
						patch.object(api, 'nowdate', return_value='2026-11-16'), \
						patch.object(model, 'get_takings_by_mode', return_value={'day-1': {}}), \
						patch.object(model, 'frappe') as model_framework:
					framework._dict = frappe._dict
					framework.get_doc.return_value = doc
					# 100 float + 50 sales - 20 return = 130 expected; count 140.
					model_framework.db.sql.side_effect = [[[50]], [[0]], [[20]], [[0]]]
					before = api.build_day_overview('2026-11-13').sessions[0]
					self.assertEqual((before.cash_refunds, before.expected_cash, before.difference), (20, 130, 10))
					# Cancelled return no longer contributes to submitted refunds.
					model_framework.db.sql.side_effect = [[[50]], [[0]], [[0]], [[0]]]
					after = api.build_day_overview('2026-11-13').sessions[0]
					self.assertEqual((after.cash_refunds, after.expected_cash, after.difference), (0, 150, -10))
					self.assertEqual(after.counted_cash, 140)
					self.assertEqual(doc.docstatus, docstatus)
					self.assertEqual(doc.status, status)
					self.assertEqual(doc.closed_on, '2026-11-13 20:00:00')
					framework.db.set_value.assert_not_called()
					model_framework.db.set_value.assert_not_called()
