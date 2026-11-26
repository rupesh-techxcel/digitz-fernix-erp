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
				doc.calculate_cash = lambda **kwargs: model.CounterSession.calculate_cash(doc, **kwargs)
				with patch.object(api, 'frappe') as framework, \
						patch.object(api, 'get_invoice_day_sessions', return_value=['day-1']), \
						patch.object(api, 'get_non_cash_payment_modes', return_value=[]), \
						patch.object(api, 'nowdate', return_value='2026-11-16'), \
						patch.object(model, 'get_takings_by_mode', return_value={'day-1': {}}), \
						patch.object(model, 'get_document_dates', return_value=['2026-11-13']), \
						patch.object(model, 'get_sales_by_type', return_value={'day-1': {'non_cash': 0, 'credit': 0}}), \
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


class TestDayOverviewInvoiceDates(unittest.TestCase):
	"""A day left open past midnight: the board shows only the chosen date's
	documents, by their posting date, unless later dates are asked for."""

	def make_session(self, model):
		doc = frappe._dict({
			'doctype': 'Counter Session', 'name': 'day-1', 'docstatus': 1, 'status': 'Closed',
			'cashier': 'cashier@example.com', 'counter': 'Counter 3',
			'opened_on': '2026-11-13 09:00:00', 'closed_on': '2026-11-14 20:00:00',
			'opening_float': 100, 'counted_cash': 190, 'cash_expenditure': 10,
			'approved_by': None, 'payment_mode_totals': [], 'denominations': [],
		})
		doc.is_new = lambda: False
		doc.source_session = lambda: 'day-1'
		doc.set = doc.__setitem__
		doc.calculate_cash = lambda **kwargs: model.CounterSession.calculate_cash(doc, **kwargs)
		return doc

	def overview(self, include_later):
		from digitz_erp.digitz_erp.doctype.counter_session import counter_session as model

		doc = self.make_session(model)
		with patch.object(api, 'frappe') as framework, \
				patch.object(api, 'get_invoice_day_sessions', return_value=['day-1']), \
				patch.object(api, 'get_non_cash_payment_modes', return_value=[]), \
				patch.object(api, 'nowdate', return_value='2026-11-16'), \
				patch.object(model, 'get_takings_by_mode', return_value={'day-1': {}}) as takings, \
				patch.object(model, 'get_document_dates', return_value=['2026-11-13', '2026-11-14']), \
				patch.object(model, 'get_sales_by_type', return_value={'day-1': {'non_cash': 30, 'credit': 70}}), \
				patch.object(model, 'frappe') as model_framework:
			framework._dict = frappe._dict
			framework.get_doc.return_value = doc
			model_framework.db.sql.side_effect = [[[50]], [[0]], [[0]], [[0]]]
			overview = api.build_day_overview('2026-11-13', include_later)
			session = overview.sessions[0]
			self.overview_lines = overview.lines
			queries = [c.args for c in model_framework.db.sql.call_args_list]
		return session, queries, takings

	def test_selected_date_only_by_posting_date(self):
		session, queries, takings = self.overview(0)
		for query, params in queries:
			self.assertIn("d.posting_date = %(posting_date)s", query)
			self.assertNotIn("opened_on", query)
			self.assertEqual(str(params["posting_date"]), "2026-11-13")
		self.assertEqual(takings.call_args.args[1:], (date(2026, 11, 13), False))
		# The count and expenditure belong to the whole day: hidden for part of it
		self.assertTrue(session.partial)
		self.assertEqual(str(session.continues_to), "2026-11-14")
		self.assertEqual((session.counted_cash, session.difference, session.cash_expenditure), (None, None, None))
		self.assertEqual(session.expected_cash, 150)

	def test_include_later_dates(self):
		session, queries, takings = self.overview(1)
		for query, _params in queries:
			self.assertIn("d.posting_date >= %(posting_date)s", query)
		self.assertEqual(takings.call_args.args[1:], (date(2026, 11, 13), True))
		self.assertFalse(session.partial)
		self.assertEqual((session.counted_cash, session.expected_cash, session.difference), (190, 140, 50))

	def test_sales_rows_include_credit_and_total(self):
		session, _queries, _takings = self.overview(0)
		self.assertEqual((session.cash_sales, session.non_cash_sales, session.credit_sales), (50, 30, 70))
		self.assertEqual(session.total_sales, 150)
		rows = {ln["label"]: ln for ln in self.overview_lines if ln["kind"] != "section"}
		self.assertEqual(rows["Credit Sales (not paid)"]["total"], 70)
		self.assertEqual(rows["Total Sales"]["values"], [150])
		self.assertEqual(rows["Total Sales"]["kind"], "strong")
		self.assertEqual(session.total_collection, 80)
		self.assertEqual(rows["Total Collection (all but credit)"]["values"], [80])

	def test_recorded_entries_kept_when_grid_hides_them(self):
		session, _queries, _takings = self.overview(0)
		self.assertIsNone(session.counted_cash)
		self.assertEqual(session.recorded, {"counted_cash": 190, "cash_expenditure": 10, "modes": {}})


class TestSalesByType(unittest.TestCase):
	def test_splits_non_cash_and_credit_for_the_date(self):
		from digitz_erp.digitz_erp.doctype.counter_session import counter_session as model
		with patch.object(model, "frappe") as framework:
			framework.db.sql.return_value = [("day-1", 30, 70)]
			sales = model.get_sales_by_type({"day-1": "day-1", "day-2": "day-2"}, "2026-11-13")
			query, params = framework.db.sql.call_args.args
		self.assertEqual(sales, {"day-1": {"non_cash": 30, "credit": 70}, "day-2": {"non_cash": 0, "credit": 0}})
		self.assertIn("d.posting_date = %(posting_date)s", query)
		self.assertIn("LEFT JOIN `tabPayment Mode`", query)
		self.assertEqual(params["posting_date"], "2026-11-13")


class TestPaymentModesRequired(unittest.TestCase):
	"""Every non-cash mode must be given at a close, 0 included."""

	def apply(self, totals):
		session = frappe._dict()
		session.set = session.__setitem__
		modes = [frappe._dict(payment_mode="Card", mode="Card"), frappe._dict(payment_mode="Bank Transfer", mode="Bank")]
		with patch.object(api, "get_non_cash_payment_modes", return_value=modes), \
				patch.object(api, "frappe") as framework:
			framework.throw.side_effect = Exception
			api.apply_count(session, 100, [], 0, totals)
		return session

	def test_blank_mode_is_refused(self):
		with self.assertRaises(Exception):
			self.apply([{"payment_mode": "Card", "amount": 50}, {"payment_mode": "Bank Transfer", "amount": ""}])

	def test_zero_counts_as_entered(self):
		session = self.apply([{"payment_mode": "Card", "amount": 50}, {"payment_mode": "Bank Transfer", "amount": 0}])
		self.assertEqual(
			session.payment_mode_totals,
			[{"payment_mode": "Card", "amount": 50}, {"payment_mode": "Bank Transfer", "amount": 0}],
		)
		self.assertEqual(session.counted_cash, 100)


class TestCashierSales(unittest.TestCase):
	def test_adds_each_cashiers_days_and_all_cashiers(self):
		day = lambda cashier, sales, collection: frappe._dict(
			cashier=cashier, cashier_name=cashier.title(), total_sales=sales, total_collection=collection)
		rows, totals = api.cashier_sales([day("ali", 100, 60), day("sara", 50, 50), day("ali", 30, 30)])
		self.assertEqual(
			[(r.cashier, r.days, r.total_sales, r.total_collection) for r in rows],
			[("ali", 2, 130, 90), ("sara", 1, 50, 50)],
		)
		self.assertEqual((totals.days, totals.total_sales, totals.total_collection), (3, 180, 140))


class TestLastCloseIsBlindForCashiers(unittest.TestCase):
	"""Day Open's previous close: counted cash with the difference gives the
	expected cash, so only a supervisor gets the difference."""

	def last_close(self, supervisor):
		row = frappe._dict(
			name="CS-1", cashier="cashier@example.com", closed_by=None, closed_on="2026-11-25 22:00:00",
			counted_cash=900.0, difference=-100.0, status="Closed",
		)
		with patch.object(api, "frappe") as framework, patch.object(api, "is_supervisor", return_value=supervisor):
			framework.db.sql.return_value = [row]
			framework.get_all.return_value = []
			return api.get_last_close("Counter 1")

	def test_cashier_gets_count_without_difference(self):
		last = self.last_close(supervisor=False)
		self.assertEqual(last.counted_cash, 900.0)
		self.assertNotIn("difference", last)

	def test_supervisor_gets_difference(self):
		self.assertEqual(self.last_close(supervisor=True).difference, -100.0)


class TestDayOverviewTotalsAgree(unittest.TestCase):
	"""A counted day beside one only partly on this date: the cash and
	payment-mode totals take the counted day only, so Expected less Counted and
	System less Entered match the Difference totals; sales take every day."""

	def lines(self):
		def day(counted, cash_sales, card_system, card_entered, credit):
			return frappe._dict(
				opening_float=0, cash_sales=cash_sales, cash_receipts=0, cash_refunds=0, cash_paid_out=0,
				cash_expenditure=0 if counted else None, expected_cash=cash_sales,
				counted_cash=17030.0 if counted else None,
				difference=17030.0 - cash_sales if counted else None,
				modes={"Card": {"system": card_system, "entered": card_entered}},
				non_cash_sales=card_system, credit_sales=credit,
				total_sales=cash_sales + card_system + credit, total_collection=cash_sales + card_system,
			)

		overview = frappe._dict(
			modes=[frappe._dict(payment_mode="Card", mode="Bank")],
			sessions=[day(True, 17031.91, 23380.0, 23430.0, 210.0), day(False, 100.0, 50.0, None, 5357.6)],
		)
		return {ln["label"]: ln["total"] for ln in api.day_overview_lines(overview) if ln["kind"] != "section"}

	def test_cash_and_mode_totals_cover_counted_days(self):
		t = self.lines()
		self.assertAlmostEqual(t["+ Cash Sales"], 17031.91)
		self.assertAlmostEqual(t["Expected Cash"], 17031.91)
		self.assertAlmostEqual(t["Counted Cash (entered)"] - t["Expected Cash"], t["Cash Difference"])
		self.assertEqual(t["Card: System"], 23380.0)
		self.assertEqual(t["Card: Entered"] - t["Card: System"], t["Card: Difference"])

	def test_sales_totals_cover_every_day(self):
		t = self.lines()
		self.assertAlmostEqual(t["Cash Sales"], 17131.91)
		self.assertEqual(t["Card / Bank Sales"], 23430.0)
		self.assertAlmostEqual(t["Credit Sales (not paid)"], 5567.6)
