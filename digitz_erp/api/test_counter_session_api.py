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


class TestSalesByType(unittest.TestCase):
	def test_splits_non_cash_and_credit_for_the_date(self):
		from digitz_erp.digitz_erp.doctype.counter_session import counter_session as model
		with patch.object(model, "frappe") as framework:
			framework.db.sql.return_value = [("day-1", "Card", 20, 70), ("day-1", "Pay by Link", 10, 0)]
			sales = model.get_sales_by_type({"day-1": "day-1", "day-2": "day-2"}, "2026-11-13")
			query, params = framework.db.sql.call_args.args
		self.assertEqual(sales, {
			"day-1": {"non_cash": 30, "credit": 70, "by_mode": {"Card": 20, "Pay by Link": 10}},
			"day-2": {"non_cash": 0, "credit": 0, "by_mode": {}},
		})
		self.assertIn("d.posting_date = %(posting_date)s", query)
		self.assertIn("LEFT JOIN `tabPayment Mode`", query)
		self.assertEqual(params["posting_date"], "2026-11-13")


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
				non_cash_sales=card_system, sales_by_mode={"Card": card_system}, non_cash_taken=card_system, credit_sales=credit,
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
		self.assertEqual(t["Card Sales"], 23430.0)
		self.assertAlmostEqual(t["Credit Sales (not paid)"], 5567.6)

	def test_sales_rows_add_up_to_total_collection(self):
		t = self.lines()
		self.assertAlmostEqual(t["Cash Sales"] + t["Card Sales"], t["Total Sales Collection (all payment modes, not credit)"])


class TestDayOverviewSalesRows(unittest.TestCase):
	"""The Sales section: Cash Sales split into Cash in Hand and Expenditure, one
	row per payment mode (Pay by Link too), adding up to the Total Collection."""

	def rows(self):
		def day(cash_sales, expenditure, by_mode):
			return frappe._dict(
				opening_float=0, cash_sales=cash_sales, cash_receipts=0, cash_refunds=0, cash_paid_out=0,
				cash_expenditure=expenditure, expected_cash=cash_sales - (expenditure or 0),
				counted_cash=cash_sales - expenditure if expenditure is not None else None,
				difference=0 if expenditure is not None else None,
				modes={"Card": {"system": 0, "entered": 0}, "Pay by Link": {"system": 0, "entered": 0}},
				non_cash_sales=sum(by_mode.values()), sales_by_mode=by_mode, non_cash_taken=sum(by_mode.values()), credit_sales=0,
				total_sales=cash_sales + sum(by_mode.values()), total_collection=cash_sales + sum(by_mode.values()),
			)

		overview = frappe._dict(
			modes=[frappe._dict(payment_mode="Card", mode="Bank"), frappe._dict(payment_mode="Pay by Link", mode="Bank")],
			sessions=[
				day(10760.0, 389.0, {"Card": 8925.0, "Pay by Link": 2455.0}),
				day(100.0, None, {"Old Mode": 40.0}),
			],
		)
		lines = api.day_overview_lines(overview)
		start = next(i for i, ln in enumerate(lines) if ln["label"] == "Sales")
		return [(ln["label"], ln["values"], ln["total"]) for ln in lines[start + 1:]]

	def test_rows_in_order_with_every_mode(self):
		self.assertEqual([r[0] for r in self.rows()][:11], [
			"Cash Sales",
			"Cash in Hand (Cash Sales − Expenditure)",
			"Expenditure (paid from Cash Sales)",
			"Card Sales",
			"Pay by Link Sales",
			"Old Mode Sales",
			"Total Sales Collection (all payment modes, not credit)",
			"+ Cash Receipts (Credit Collections)",
			"+ Card / Bank Receipts (Credit Collections, less refunds)",
			"− Cash Refunds",
			"Total Money Collected",
		])

	def test_cash_split_and_total(self):
		r = {label: (values, total) for label, values, total in self.rows()}
		self.assertEqual(r["Cash in Hand (Cash Sales − Expenditure)"][0], [10371.0, 100.0])
		self.assertEqual(r["Expenditure (paid from Cash Sales)"][0], [389.0, None])
		self.assertEqual(r["Pay by Link Sales"][0], [2455.0, 0])
		modes = sum(r[f"{m} Sales"][1] for m in ("Card", "Pay by Link", "Old Mode"))
		self.assertAlmostEqual(r["Cash Sales"][1] + modes, r["Total Sales Collection (all payment modes, not credit)"][1])


class TestTotalMoneyCollected(unittest.TestCase):
	"""Cashier 3 on 25-11-2026: sales collection 22,140 plus 6,270 cash and
	1,800 Pay by Link credit collections, less 450 cash refunds, is 29,760,
	the same as the payment-mode sections' cash and System figures."""

	def test_cashier_3_on_25_11(self):
		day = frappe._dict(
			opening_float=0, cash_sales=10760.0, cash_receipts=6270.0, cash_refunds=450.0, cash_paid_out=0,
			cash_expenditure=389.0, expected_cash=16191.0, counted_cash=16190.0, difference=-1.0,
			modes={"Card": {"system": 10725.0, "entered": 10725.0}, "Pay by Link": {"system": 2455.0, "entered": 2455.0}},
			non_cash_sales=11380.0, sales_by_mode={"Card": 10725.0, "Pay by Link": 655.0},
			non_cash_taken=13180.0, credit_sales=0, total_sales=22140.0, total_collection=22140.0,
		)
		overview = frappe._dict(
			modes=[frappe._dict(payment_mode="Card", mode="Bank"), frappe._dict(payment_mode="Pay by Link", mode="Bank")],
			sessions=[day],
		)
		t = {ln["label"]: ln["total"] for ln in api.day_overview_lines(overview) if ln["kind"] != "section"}
		self.assertEqual(t["Total Sales Collection (all payment modes, not credit)"], 22140.0)
		self.assertEqual(t["+ Card / Bank Receipts (Credit Collections, less refunds)"], 1800.0)
		self.assertEqual(t["Total Money Collected"], 29760.0)
		self.assertEqual(t["Total Money Collected"], t["Expected Cash"] + t["− Expenditure (entered)"] + 10725.0 + 2455.0)


class TestCashierGrid(unittest.TestCase):
	"""The Day Close summary: the detail rows, one column per cashier, with all
	of the cashier's days added together."""

	def overview(self):
		def day(name, cashier, day_status, expected, counted, difference, remarks="", docstatus=0):
			return frappe._dict(
				name=name, cashier=cashier, cashier_name=cashier.title(), day_status=day_status,
				difference=difference, close_remarks=remarks, docstatus=docstatus,
				expected_cash=expected, counted_cash=counted,
			)

		sessions = [
			day("CS-27", "cashier 1", "Closing", 100.0, 98.0, -2.0, "short 2"),
			day("CS-31", "cashier 2", "Closing", 50.0, 55.0, 5.0),
			day("CS-40", "cashier 1", "Closed", 200.0, 200.0, 0.0, docstatus=1),
			day("CS-41", "cashier 1", "Open", 30.0, None, None),
		]
		lines = [
			{"label": "Cash", "kind": "section"},
			{"label": "Expected Cash", "kind": "strong", "values": [s.expected_cash for s in sessions], "total": 300.0},
			{"label": "Counted Cash (entered)", "kind": "strong", "values": [s.counted_cash for s in sessions], "total": 298.0},
		]
		return frappe._dict(sessions=sessions, lines=lines)

	def test_one_column_per_cashier(self):
		grid = api.cashier_grid(self.overview())
		one, two = grid.cashiers
		self.assertEqual((one.cashier, one.days, one.open_days), ("cashier 1", 3, 1))
		self.assertEqual((two.cashier, two.days, two.open_days), ("cashier 2", 1, 0))
		section, expected, counted = grid.lines
		self.assertEqual(section, {"label": "Cash", "kind": "section"})
		# Every day's actual figure, open and part days included
		self.assertEqual(expected["values"], [330.0, 50.0])
		self.assertEqual(counted["values"], [298.0, 55.0])
		# The Total column stays the detail grid's own
		self.assertEqual((expected["total"], counted["total"]), (300.0, 298.0))

	def test_awaiting_approval_per_cashier(self):
		grid = api.cashier_grid(self.overview())
		one, two = grid.cashiers
		self.assertEqual((one.awaiting, one.awaiting_difference), (["CS-27"], -2.0))
		self.assertEqual((two.awaiting, two.awaiting_difference), (["CS-31"], 5.0))
		self.assertEqual(one.remarks, ["short 2"])
		self.assertEqual(one.counted, [
			{"name": "CS-27", "status": "Closing", "docstatus": 0},
			{"name": "CS-40", "status": "Closed", "docstatus": 1},
		])
		# The open day can still be counted for this date
		self.assertEqual(one.closable, [{"name": "CS-41", "status": "Open"}])
