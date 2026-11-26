"""Date-by-date closes inside a Counter Session: each date's expected cash from
its own documents, the count entered for it, its approval, and the Day Close
board built on them. Mocked: no database."""

import unittest
from datetime import date
from unittest.mock import patch

import frappe

from digitz_erp.api import counter_session_api as api
from digitz_erp.digitz_erp.doctype.counter_session import counter_session as model

D13, D14 = date(2026, 11, 13), date(2026, 11, 14)

# Cash documents per date: 50 cash sales on the 13th, 60 on the 14th
MOVEMENTS = {
	D13: {"cash_sales": 50, "cash_receipts": 0, "cash_refunds": 0, "cash_paid_out": 0},
	D14: {"cash_sales": 60, "cash_receipts": 0, "cash_refunds": 0, "cash_paid_out": 0},
}


def movements(_source, posting_date=None, include_later=False):
	if posting_date is None:
		return {k: sum(m[k] for m in MOVEMENTS.values()) for k in MOVEMENTS[D13]}
	return dict(MOVEMENTS.get(frappe.utils.getdate(posting_date), dict.fromkeys(MOVEMENTS[D13], 0)))


class Row(frappe._dict):
	"""A child row: like Frappe's, update() takes one dict and no keywords."""

	def update(self, values):
		super().update(values)


class FakeSession(frappe._dict):
	"""A Counter Session in memory, with the real controller's date methods."""

	date_close = model.CounterSession.date_close
	document_dates = model.CounterSession.document_dates
	dates_to_close = model.CounterSession.dates_to_close
	float_date = model.CounterSession.float_date
	calculate_date_cash = model.CounterSession.calculate_date_cash
	update_date_closes = model.CounterSession.update_date_closes
	handover_close = model.CounterSession.handover_close
	handover_cash = model.CounterSession.handover_cash
	unclosed_dates = model.CounterSession.unclosed_dates

	def is_new(self):
		return False

	def source_session(self):
		return self.name

	def set(self, key, value):
		self[key] = [Row(v) for v in value]

	def append(self, key, value):
		row = Row(value)
		self.setdefault(key, []).append(row)
		return row

	def save(self, **kwargs):
		self.update_date_closes()

	def submit(self):
		self.docstatus = 1
		self.submitted = True


def session(**values):
	doc = FakeSession(
		name="CS-1", cashier="cashier", counter="Counter 1", docstatus=0, status="Open",
		opened_on="2026-11-13 09:00:00", closed_on=None, opening_float=100, amended_from=None,
		date_closes=[], denominations=[], payment_mode_totals=[], flags=frappe._dict(), close_remarks=None,
	)
	doc.update(values)
	doc.date_closes = [Row(r) for r in doc.date_closes]
	return doc


def patched(dates=(D13, D14)):
	"""The controller's database reads: the documents' dates and cash movements."""
	return (
		patch.object(model, "get_document_dates", return_value=list(dates)),
		patch.object(model, "get_cash_movements", side_effect=movements),
	)


class TestDateCash(unittest.TestCase):
	def test_float_counts_on_the_first_date_only(self):
		doc = session()
		dates, cash = patched()
		with dates, cash:
			self.assertEqual(doc.calculate_date_cash(D13).expected_cash, 150)  # 100 float + 50
			self.assertEqual(doc.calculate_date_cash(D14).expected_cash, 60)  # the 13th's cash was taken out
			self.assertEqual(doc.calculate_date_cash(D14, expenditure=10).expected_cash, 50)

	def test_session_totals_come_from_the_date_closes(self):
		doc = session(date_closes=[
			frappe._dict(close_date=D13, counted_cash=148, cash_expenditure=0),
			frappe._dict(close_date=D14, counted_cash=55, cash_expenditure=5),
		])
		dates, cash = patched()
		with dates, cash:
			doc.update_date_closes()
		first, second = doc.date_closes
		self.assertEqual((first.expected_cash, first.difference), (150, -2))
		self.assertEqual((second.expected_cash, second.difference), (55, 0))
		self.assertEqual((doc.counted_cash, doc.expected_cash, doc.difference, doc.cash_expenditure), (203, 205, -2, 5))

	def test_whole_day_close_keeps_the_whole_days_figures(self):
		doc = session(date_closes=[frappe._dict(close_date=D14, counted_cash=200, cash_expenditure=0, covers_whole_day=1)])
		dates, cash = patched()
		with dates, cash:
			doc.update_date_closes()
			# 100 float + 50 + 60, for every date of the day
			self.assertEqual(doc.date_closes[0].expected_cash, 210)
			# Counted whole before date-by-date closes: nothing more to close
			self.assertEqual(doc.dates_to_close(), [D14])


class TestApplyCount(unittest.TestCase):
	modes = [frappe._dict(payment_mode="Card", mode="Card"), frappe._dict(payment_mode="Bank Transfer", mode="Bank")]

	def apply(self, doc, day, totals, counted=100, denominations=()):
		with patch.object(api, "get_non_cash_payment_modes", return_value=self.modes), \
				patch.object(api, "frappe") as framework:
			framework.throw.side_effect = Exception
			return api.apply_count(doc, day, counted, list(denominations), 0, totals)

	def test_blank_mode_is_refused(self):
		with self.assertRaises(Exception):
			self.apply(session(), D13, [{"payment_mode": "Card", "amount": 50}, {"payment_mode": "Bank Transfer", "amount": ""}])

	def test_only_that_dates_rows_are_replaced(self):
		doc = session(payment_mode_totals=[
			frappe._dict(payment_mode="Card", amount=10, close_date=D13),
			frappe._dict(payment_mode="Card", amount=20, close_date=D14),
		])
		row = self.apply(doc, D14, [{"payment_mode": "Card", "amount": 25}, {"payment_mode": "Bank Transfer", "amount": 0}])
		self.assertEqual(
			[(r.amount, r.close_date) for r in doc.payment_mode_totals],
			[(10, D13), (25, D14), (0, D14)],
		)
		self.assertEqual((row.close_date, row.counted_cash), (D14, 100))
		self.assertEqual(doc.date_close(D14), row)

	def test_counted_from_the_notes_and_coins(self):
		doc = session()
		row = self.apply(
			doc, D13, [{"payment_mode": "Card", "amount": 0}, {"payment_mode": "Bank Transfer", "amount": 0}],
			counted=None, denominations=[{"denomination": 50, "count": 3}],
		)
		self.assertEqual(row.counted_cash, 150)
		self.assertEqual(doc.denominations[0].close_date, D13)


class TestCloseFlow(unittest.TestCase):
	"""Every close waits for a supervisor; the day finishes once its till is
	closed and every date of it is approved."""

	totals = [{"payment_mode": "Card", "amount": 0}]

	def close(self, doc, closed_by, supervisor, day=None, today="2026-11-14"):
		dates, cash = patched()
		with dates, cash, \
				patch.object(api, "get_non_cash_payment_modes", return_value=[frappe._dict(payment_mode="Card", mode="Card")]), \
				patch.object(api, "is_supervisor", return_value=supervisor), \
				patch.object(api, "nowdate", return_value=today), \
				patch.object(api, "now_datetime", return_value="2026-11-14 20:00:00"), \
				patch.object(api.frappe, "session", frappe._dict(user=closed_by)):
			return api.count_and_close(doc, 60, [], "", closed_by, 0, self.totals, day)

	def test_cashier_close_waits_and_closes_the_till(self):
		doc = session()
		result = self.close(doc, "cashier", supervisor=False)
		self.assertEqual((result["status"], result["close_date"]), ("Closing", "2026-11-14"))
		self.assertEqual(doc.status, "Closing")
		self.assertFalse(doc.get("submitted"))

	def test_supervisor_counting_an_earlier_date_leaves_the_till_open(self):
		doc = session()
		result = self.close(doc, "supervisor", supervisor=True, day=D13)
		self.assertEqual(result["status"], "Closed")
		self.assertEqual(doc.status, "Open")
		self.assertFalse(doc.get("submitted"))

	def test_day_finishes_when_every_date_is_approved(self):
		doc = session()
		self.close(doc, "cashier", supervisor=False)  # the 14th, waiting
		self.close(doc, "supervisor", supervisor=True, day=D13)  # the 13th, approved
		self.assertFalse(doc.get("submitted"))
		dates, cash = patched()
		with dates, cash, patch.object(api, "is_supervisor", return_value=True), \
				patch.object(api.frappe, "session", frappe._dict(user="supervisor")):
			doc.date_close(D14).status = "Closed"
			self.assertTrue(api.finish_if_complete(doc))
		self.assertTrue(doc.submitted)


class TestDayOverviewByDate(unittest.TestCase):
	"""The board for a date: that date's documents, set against that date's close."""

	def overview(self, doc, day):
		dates, cash = patched()
		with dates, cash, \
				patch.object(api, "frappe") as framework, \
				patch.object(api, "get_day_sessions", return_value=[doc.name]), \
				patch.object(api, "get_non_cash_payment_modes", return_value=[frappe._dict(payment_mode="Card", mode="Card")]), \
				patch.object(api, "nowdate", return_value="2026-11-16"), \
				patch.object(model, "get_takings_by_mode", return_value={doc.name: {"Card": 30}}) as takings, \
				patch.object(model, "get_sales_by_type", return_value={doc.name: {"non_cash": 30, "credit": 70}}):
			framework._dict = frappe._dict
			framework.get_doc.return_value = doc
			framework.utils.get_fullname.side_effect = lambda user: user
			overview = api.build_day_overview(day)
			self.takings_args = takings.call_args.args
		return overview

	def doc(self):
		return session(status="Closing", closed_on="2026-11-14 20:00:00", date_closes=[
			frappe._dict(close_date=D14, status="Closing", counted_cash=40, cash_expenditure=10, remarks="short"),
		], payment_mode_totals=[frappe._dict(payment_mode="Card", amount=30, close_date=D14)])

	def test_date_with_a_close_compares_its_own_figures(self):
		x = self.overview(self.doc(), "2026-11-14").sessions[0]
		self.assertEqual(self.takings_args[1], D14)
		# 60 cash sales, less 10 expenditure; no float on the 14th
		self.assertEqual((x.expected_cash, x.counted_cash, x.difference), (50, 40, -10))
		self.assertEqual((x.day_status, x.close_remarks), ("Closing", "short"))
		self.assertEqual(x.modes["Card"], {"entered": 30, "system": 30})
		self.assertEqual(x.recorded, {"counted_cash": 40, "cash_expenditure": 10, "modes": {"Card": 30}})

	def test_date_without_a_close_is_not_closed(self):
		x = self.overview(self.doc(), "2026-11-13").sessions[0]
		self.assertEqual(x.day_status, "Not Closed")
		self.assertEqual(x.expected_cash, 150)
		self.assertEqual((x.counted_cash, x.difference, x.recorded), (None, None, None))
		self.assertEqual(x.modes["Card"]["entered"], None)

	def test_open_day_without_a_close_is_open(self):
		self.assertEqual(self.overview(session(), "2026-11-13").sessions[0].day_status, "Open")

	def test_whole_day_close_marks_its_other_dates_counted(self):
		doc = session(docstatus=1, status="Closed", closed_on="2026-11-14 20:00:00", date_closes=[
			frappe._dict(close_date=D14, status="Closed", counted_cash=200, cash_expenditure=0,
				covers_whole_day=1, expected_cash=210, difference=-10, opening_float=100),
		])
		other = self.overview(doc, "2026-11-13").sessions[0]
		self.assertEqual((other.day_status, other.counted_with, other.counted_cash), ("Counted", str(D14), None))
		own = self.overview(doc, "2026-11-14").sessions[0]
		self.assertEqual((own.expected_cash, own.counted_cash, own.difference), (210, 200, -10))

	def test_sales_rows_include_credit_and_total(self):
		overview = self.overview(self.doc(), "2026-11-14")
		x = overview.sessions[0]
		self.assertEqual((x.cash_sales, x.non_cash_sales, x.credit_sales, x.total_sales), (60, 30, 70, 160))
		self.assertEqual(x.total_collection, 90)
		rows = {ln["label"]: ln for ln in overview.lines if ln["kind"] != "section"}
		self.assertEqual(rows["Total Sales"]["values"], [160])


class TestMigrationPatch(unittest.TestCase):
	"""Existing counted sessions get one date close row, as saved."""

	def run_patch(self, sessions):
		from digitz_erp.patches.v1_0 import date_closes_for_counted_sessions as patch_module

		rows = []
		with patch.object(patch_module, "frappe") as framework:
			framework.db.sql.side_effect = lambda query, *args, **kwargs: None if "UPDATE" in query else sessions

			def get_doc(values):
				row = frappe._dict(values)
				row.db_insert = lambda: rows.append(row)
				return row

			framework.get_doc.side_effect = get_doc
			patch_module.execute()
			updates = [c.args for c in framework.db.sql.call_args_list if "UPDATE" in c.args[0]]
		return rows, updates

	def session(self, name, docstatus, status, closed_on="2026-11-14 20:00:00"):
		return frappe._dict(
			name=name, docstatus=docstatus, status=status, closed_on=closed_on, closed_by="cashier",
			approved_by=None, close_remarks="ok", opening_float=100, cash_sales=50, cash_receipts=0,
			cash_refunds=0, cash_paid_out=0, cash_expenditure=0, expected_cash=150, counted_cash=148, difference=-2,
		)

	def test_one_row_per_session_as_saved(self):
		rows, updates = self.run_patch([self.session("CS-1", 1, "Closed"), self.session("CS-2", 0, "Closing")])
		finished, waiting = rows
		self.assertEqual((finished.parent, finished.close_date, finished.status, finished.covers_whole_day), ("CS-1", D14, "Closed", 1))
		self.assertEqual((finished.counted_cash, finished.expected_cash, finished.difference), (148, 150, -2))
		self.assertEqual((finished.parentfield, finished.docstatus, finished.remarks), ("date_closes", 1, "ok"))
		# Still waiting for approval: closed date by date from now on
		self.assertEqual((waiting.status, waiting.covers_whole_day), ("Closing", 0))
		# The closing count rows of both sessions take the date
		self.assertEqual(len(updates), 4)
		self.assertTrue(all("close_date IS NULL" in query for query, _params in updates))
		self.assertEqual({params["parentfield"] for _query, params in updates}, {"denominations", "payment_mode_totals"})

	def test_nothing_to_migrate(self):
		self.assertEqual(self.run_patch([]), ([], []))
