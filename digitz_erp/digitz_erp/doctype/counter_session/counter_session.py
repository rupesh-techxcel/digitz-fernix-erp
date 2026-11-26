# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""A cashier's day at a counter: opened with a float, closed by counting the till.

A draft session is an open day. Documents saved in it (Sales Invoice, Sales Return,
Receipt Entry, Expense Entry) carry its name in `counter_session`; see
digitz_erp.api.counter_session_api. It is a record of the till only: nothing is
posted to the GL.

A session is closed date by date (`date_closes`, one row per date of its
documents): each date's expected cash comes from that date's documents -- the
opening float counts on the session's first date only, as each date's cash is
taken out when that date is closed -- and is set against the count entered for
it. Every date close waits (Closing) until a supervisor approves it, with or
without a difference. The cashier's Day Close ends the till (status Closing) and
counts the current date; a supervisor closes any earlier date. Submitting the
session finishes it, once the till is closed and every date is approved.

The counter is taken only while a day on it is Open. Once the till is counted the
counter is free for the next cashier, even if the close still waits for approval:
the cash has been handed over, and the approval is the supervisor's check of the count.
"""

import frappe
from frappe.model.document import Document
from frappe.utils import flt, getdate, now_datetime

# A receipt's cash: its amount adds Sales Return / Credit Note lines as positive,
# but they are paid out, so the cash taken is the amount less twice those lines
# (as the receipt's GL posts it)
RECEIPT_CASH = """d.amount - 2 * IFNULL((
	SELECT SUM(r.amount) FROM `tabReceipt Entry Detail` r
	WHERE r.parent = d.name AND r.parenttype = 'Receipt Entry' AND r.receipt_type = 'Customer'
		AND r.reference_type IN ('Sales Return', 'Credit Note')), 0)"""

# Cash is anything settled through a payment mode whose Mode is Cash
CASH_MOVEMENTS = (
	# (field on this session, doctype, amount (SQL over the document `d`), sign in expected cash, skip credit sales)
	("cash_sales", "Sales Invoice", "d.rounded_total", 1, True),
	("cash_receipts", "Receipt Entry", RECEIPT_CASH, 1, False),
	("cash_refunds", "Sales Return", "d.rounded_total", -1, True),
	("cash_paid_out", "Expense Entry", "d.paid_amount", -1, False),
)

# Differences below this are treated as a clean close
TOLERANCE = 0.005


def posting_date_condition(posting_date=None, include_later=False):
	"""SQL condition limiting a session's documents `d` to the Day Close board's
	date: `posting_date` only, or with `include_later` that date and the ones
	after it. No date means the whole session."""
	if not posting_date:
		return ""
	return "AND d.posting_date >= %(posting_date)s" if include_later else "AND d.posting_date = %(posting_date)s"


def get_cash_movements(source, posting_date=None, include_later=False):
	"""{field: amount} of the submitted cash documents saved in session `source`
	(CASH_MOVEMENTS), limited to a date as in posting_date_condition."""
	movements = {}
	for field, doctype, amount_expr, _sign, skip_credit in CASH_MOVEMENTS:
		credit = "AND IFNULL(d.credit_sale, 0) = 0" if skip_credit else ""
		dated = posting_date_condition(posting_date, include_later)
		movements[field] = flt(frappe.db.sql(
			f"""
			SELECT SUM({amount_expr})
			FROM `tab{doctype}` d
			INNER JOIN `tabPayment Mode` pm ON pm.name = d.payment_mode
			WHERE d.counter_session = %(source)s AND d.docstatus = 1 AND pm.mode = 'Cash' {credit} {dated}
			""",
			{"source": source, "posting_date": posting_date},
		)[0][0])
	return movements


def expected_from(opening_float, movements, expenditure):
	"""The cash the till should hold: the float, plus and minus the cash
	movements by their sign, less the expenditure paid out of it."""
	expected = flt(opening_float) - flt(expenditure)
	for field, _doctype, _amount, sign, _skip in CASH_MOVEMENTS:
		expected += sign * flt(movements.get(field))
	return expected


def get_document_dates(source):
	"""The posting dates of the submitted documents saved in session `source`, oldest first."""
	union = " UNION ".join(
		f"SELECT posting_date FROM `tab{doctype}` WHERE counter_session = %(source)s AND docstatus = 1"
		for doctype in {doctype for _field, doctype, *_rest in CASH_MOVEMENTS}
	)
	return sorted(frappe.db.sql_list(union, {"source": source}))


def get_takings_by_mode(sessions, posting_date=None, include_later=False):
	"""{session: {payment mode: net amount}} of the non-cash documents saved in
	`sessions` -- what the card machine and bank should show for each day.

	`sessions` maps the name to report under to the name the documents carry
	(the original session, for a corrected copy; see CounterSession.source_session).
	Signs and credit sales are treated as in CASH_MOVEMENTS. `posting_date` and
	`include_later` limit the documents as in posting_date_condition.
	"""
	takings = {name: {} for name in sessions}
	if not sessions:
		return takings
	reported_as = {}
	for name, source in sessions.items():
		reported_as.setdefault(source, []).append(name)

	for _field, doctype, amount_expr, sign, skip_credit in CASH_MOVEMENTS:
		credit = "AND IFNULL(d.credit_sale, 0) = 0" if skip_credit else ""
		dated = posting_date_condition(posting_date, include_later)
		rows = frappe.db.sql(
			f"""
			SELECT d.counter_session, d.payment_mode, SUM({amount_expr})
			FROM `tab{doctype}` d
			INNER JOIN `tabPayment Mode` pm ON pm.name = d.payment_mode
			WHERE d.counter_session IN %(sources)s AND d.docstatus = 1 AND pm.mode != 'Cash' {credit} {dated}
			GROUP BY d.counter_session, d.payment_mode
			""",
			{"sources": list(reported_as), "posting_date": posting_date},
		)
		for source, mode, amount in rows:
			for name in reported_as[source]:
				takings[name][mode] = takings[name].get(mode, 0) + sign * flt(amount)
	return takings


def get_sales_by_type(sessions, posting_date=None, include_later=False):
	"""{session: {"non_cash": amount, "credit": amount}} of the submitted Sales
	Invoices saved in `sessions`: those settled through a non-cash payment mode,
	and the credit sales, which no payment row counts. With the cash sales these
	make up every invoice of the day.

	`sessions` maps names as in get_takings_by_mode; `posting_date` and
	`include_later` limit the invoices as in posting_date_condition.
	"""
	sales = {name: {"non_cash": 0, "credit": 0} for name in sessions}
	if not sessions:
		return sales
	reported_as = {}
	for name, source in sessions.items():
		reported_as.setdefault(source, []).append(name)

	dated = posting_date_condition(posting_date, include_later)
	rows = frappe.db.sql(
		f"""
		SELECT d.counter_session,
			SUM(CASE WHEN IFNULL(d.credit_sale, 0) = 0 THEN d.rounded_total ELSE 0 END),
			SUM(CASE WHEN IFNULL(d.credit_sale, 0) = 1 THEN d.rounded_total ELSE 0 END)
		FROM `tabSales Invoice` d
		LEFT JOIN `tabPayment Mode` pm ON pm.name = d.payment_mode
		WHERE d.counter_session IN %(sources)s AND d.docstatus = 1
			AND (IFNULL(d.credit_sale, 0) = 1 OR IFNULL(pm.mode, '') != 'Cash') {dated}
		GROUP BY d.counter_session
		""",
		{"sources": list(reported_as), "posting_date": posting_date},
	)
	for source, non_cash, credit in rows:
		for name in reported_as[source]:
			sales[name]["non_cash"] += flt(non_cash)
			sales[name]["credit"] += flt(credit)
	return sales


class CounterSession(Document):
	def validate(self):
		if self.is_new() and self.amended_from:
			# A correction of a day already counted and closed, not a new day:
			# it occupies no counter and goes straight to submit.
			self.status = "Closing"
		elif self.is_new():
			self.validate_single_open_session()
		self.validate_approver()
		self.set_counted_cash_from_denominations()
		self.calculate_cash()
		self.update_date_closes()

	def validate_single_open_session(self):
		taken = frappe.db.get_value(
			"Counter Session",
			{"counter": self.counter, "docstatus": 0, "status": "Open", "name": ["!=", self.name]},
			["name", "cashier"],
			as_dict=True,
		)
		if taken:
			frappe.throw(
				f"{self.counter} already has a day open by {frappe.utils.get_fullname(taken.cashier)} "
				f"({taken.name}). They close it (Close & Hand Over), or a supervisor closes it for them, "
				"before another day can be opened here."
			)

		# Only an active day holds the cashier. Counted closes may await approval
		# while the cashier opens and bills in a new session.
		own = frappe.db.get_value(
			"Counter Session", {"cashier": self.cashier, "docstatus": 0, "status": "Open", "name": ["!=", self.name]}, "name"
		)
		if own:
			frappe.throw(f"You already have an open day ({own}). Close it before opening another.")

	def validate_approver(self):
		"""Only a supervisor can sign off a difference, and only as themselves."""
		from digitz_erp.api.counter_api import is_supervisor

		if not self.approved_by or not self.has_value_changed("approved_by"):
			return
		if self.approved_by != frappe.session.user or not is_supervisor():
			frappe.throw("Only a supervisor can approve a cash difference.", frappe.PermissionError)

	def set_counted_cash_from_denominations(self):
		total = 0
		for row in self.denominations:
			row.amount = flt(row.denomination) * flt(row.count)
			total += row.amount
		# With date closes each date's count is its own (update_date_closes)
		if self.denominations and total and not self.date_closes:
			self.counted_cash = total

	def date_close(self, date):
		"""The close of `date`, or None."""
		date = getdate(date)
		return next((row for row in self.date_closes if getdate(row.close_date) == date), None)

	def document_dates(self):
		if self.is_new() and not self.amended_from:
			return []
		return sorted({getdate(d) for d in get_document_dates(self.source_session())})

	def dates_to_close(self):
		"""The dates this session must close: every date of its documents, and
		the date the till was closed on. A day counted whole before date-by-date
		closes needs nothing more."""
		if any(row.covers_whole_day for row in self.date_closes):
			return sorted({getdate(row.close_date) for row in self.date_closes})
		dates = set(self.document_dates())
		if self.status in ("Closing", "Closed") and self.closed_on:
			dates.add(getdate(self.closed_on))
		return sorted(dates)

	def float_date(self):
		"""The date the opening float counts on: the session's first date, of its
		documents or of a close (a later date's cash starts from nothing, as the
		earlier date's cash was taken out when that date was closed)."""
		dates = set(self.document_dates()) | {getdate(row.close_date) for row in self.date_closes}
		return min(dates) if dates else getdate(self.opened_on)

	def calculate_date_cash(self, date, expenditure=0, float_date=None):
		"""{opening_float, the CASH_MOVEMENTS fields, expected_cash} for `date`:
		that date's cash documents, the float on the session's first date only,
		less `expenditure` (the date's, entered at its close)."""
		date = getdate(date)
		movements = (
			get_cash_movements(self.source_session(), date)
			if not (self.is_new() and not self.amended_from)
			else {field: 0 for field, *_rest in CASH_MOVEMENTS}
		)
		opening = flt(self.opening_float) if date == (float_date or self.float_date()) else 0
		return frappe._dict(
			movements, opening_float=opening, expected_cash=expected_from(opening, movements, expenditure)
		)

	def update_date_closes(self):
		"""Each date close's figures from its date's documents and its count, and
		the session's count, expenditure, expected cash and difference as their
		totals (what Day History, the dashboard and the reports read)."""
		if not self.date_closes:
			return
		first = self.float_date()
		for row in self.date_closes:
			counted = [d for d in self.denominations if d.close_date and getdate(d.close_date) == getdate(row.close_date)]
			total = sum(flt(d.denomination) * flt(d.count) for d in counted)
			if counted and total:
				row.counted_cash = total
			if row.covers_whole_day:
				# Counted for every date of the day, before date-by-date closes
				movements = get_cash_movements(self.source_session())
				row.update(dict(movements, opening_float=flt(self.opening_float)))
				row.expected_cash = expected_from(self.opening_float, movements, row.cash_expenditure)
			else:
				row.update(self.calculate_date_cash(row.close_date, row.cash_expenditure, first))
			row.difference = flt(row.counted_cash) - flt(row.expected_cash)
		self.counted_cash = sum(flt(row.counted_cash) for row in self.date_closes)
		self.cash_expenditure = sum(flt(row.cash_expenditure) for row in self.date_closes)
		self.expected_cash = sum(flt(row.expected_cash) for row in self.date_closes)
		self.difference = sum(flt(row.difference) for row in self.date_closes)

	def handover_close(self):
		"""The close of the date the till was closed on (the latest date): the
		cash left in the till, which the next day on the counter starts from."""
		if not self.date_closes:
			return None
		return max(self.date_closes, key=lambda row: (getdate(row.close_date), str(row.closed_on or "")))

	def handover_cash(self):
		row = self.handover_close()
		return flt(row.counted_cash) if row else flt(self.counted_cash)

	def unclosed_dates(self):
		"""The dates still to close or approve before the session can finish."""
		return [d for d in self.dates_to_close() if not (self.date_close(d) and self.date_close(d).status == "Closed")]

	def source_session(self):
		"""The session the day's documents carry. A corrected close is an amended
		copy under a new name, but the invoices still name the original."""
		name = self.name
		amended_from = self.amended_from
		while amended_from:
			name = amended_from
			amended_from = frappe.db.get_value("Counter Session", name, "amended_from")
		return name

	def calculate_cash(self, posting_date=None, include_later=False):
		"""Sum the submitted cash documents of this session and, less the
		expenditure entered at Day Close, the expected cash. `posting_date` and
		`include_later` limit the documents as in posting_date_condition: the Day
		Close board's view of a date, worked out in memory and never saved."""
		movements = (
			{field: 0 for field, *_rest in CASH_MOVEMENTS}
			if self.is_new()
			else get_cash_movements(self.source_session(), posting_date, include_later)
		)
		self.update(movements)
		# Paid out of the till, entered at Day Close: kept on the session only
		expected = expected_from(self.opening_float, movements, self.cash_expenditure)

		self.expected_cash = expected
		self.difference = flt(self.counted_cash) - expected if self.status in ("Closing", "Closed") else 0

	def has_difference(self):
		return abs(flt(self.difference)) >= TOLERANCE

	def before_submit(self):
		# Submitting is closing the day, which only follows a till count (Day
		# Close, or a supervisor's close). A bare Submit on an Open day would
		# close it with no count at all.
		if self.status != "Closing":
			frappe.throw(
				"A day is closed by counting the till on the Day Close page, not by submitting it here.",
				title="Close from Day Close",
			)

		self.calculate_cash()
		self.update_date_closes()

		if self.date_closes:
			unclosed = self.unclosed_dates()
			if unclosed:
				frappe.throw(
					"Close and approve every date of this day first: "
					+ ", ".join(frappe.utils.formatdate(d) for d in unclosed) + ".",
					title="Approval Needed",
				)
		elif self.has_difference() and not self.approved_by:
			frappe.throw(
				f"The counted cash differs from the expected cash by {flt(self.difference):.2f}. "
				"A supervisor has to approve this close.",
				title="Approval Needed",
			)

		self.status = "Closed"
		# Kept from the count when the close waited for approval
		self.closed_on = self.closed_on or now_datetime()
		self.closed_by = self.closed_by or self.cashier

	def on_submit(self):
		self.relink_next_days()

	def relink_next_days(self):
		"""Point the days still open or awaiting approval that follow this one
		at it, and carry its count as their previous close.

		A supervisor's correction replaces a closed day with an amended copy,
		often after the next day was opened. A day left linked to the cancelled
		original cannot be saved, so it cannot be closed either.
		"""
		replaced = [self.name] + ([self.amended_from] if self.amended_from else [])
		for name in frappe.get_all(
			"Counter Session", filters={"docstatus": 0, "previous_session": ["in", replaced]}, pluck="name"
		):
			frappe.db.set_value(
				"Counter Session", name,
				{"previous_session": self.name, "previous_closing_cash": self.handover_cash()},
			)

	def on_cancel(self):
		self.db_set("status", "Cancelled")
