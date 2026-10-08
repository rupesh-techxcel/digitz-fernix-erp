# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""A cashier's day at a counter: opened with a float, closed by counting the till.

A draft session is an open day. Documents saved in it (Sales Invoice, Sales Return,
Receipt Entry, Expense Entry) carry its name in `counter_session`; see
digitz_erp.api.counter_session_api. Submitting the session closes the day. A close
whose counted cash differs from the expected cash waits in status Closing until a
supervisor approves it. It is a record of the till only: nothing is posted to the GL.

The counter is taken only while a day on it is Open. Once the till is counted the
counter is free for the next cashier, even if the close still waits for approval:
the cash has been handed over, and the approval is only about the difference.
"""

import frappe
from frappe.model.document import Document
from frappe.utils import flt, now_datetime

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

		# A cashier's own close that waits for approval still holds them: it is
		# their one unfinished day.
		own = frappe.db.get_value(
			"Counter Session", {"cashier": self.cashier, "docstatus": 0, "name": ["!=", self.name]}, "name"
		)
		if own:
			frappe.throw(f"You already have an unfinished day ({own}). Close it before opening another.")

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
		if self.denominations and total:
			self.counted_cash = total

	def calculate_cash(self):
		"""Sum the submitted cash documents of this session and, less the
		expenditure entered at Day Close, the expected cash."""
		expected = flt(self.opening_float)

		for field, doctype, amount_expr, sign, skip_credit in CASH_MOVEMENTS:
			amount = 0
			if not self.is_new():
				credit = "AND IFNULL(d.credit_sale, 0) = 0" if skip_credit else ""
				amount = flt(frappe.db.sql(
					f"""
					SELECT SUM({amount_expr})
					FROM `tab{doctype}` d
					INNER JOIN `tabPayment Mode` pm ON pm.name = d.payment_mode
					WHERE d.counter_session = %s AND d.docstatus = 1 AND pm.mode = 'Cash' {credit}
					""",
					(self.name,),
				)[0][0])
			self.set(field, amount)
			expected += sign * amount

		# Paid out of the till, entered at Day Close: kept on the session only
		expected -= flt(self.cash_expenditure)

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

		if self.has_difference() and not self.approved_by:
			frappe.throw(
				f"The counted cash differs from the expected cash by {flt(self.difference):.2f}. "
				"A supervisor has to approve this close.",
				title="Approval Needed",
			)

		self.status = "Closed"
		# Kept from the count when the close waited for approval
		self.closed_on = self.closed_on or now_datetime()
		self.closed_by = self.closed_by or self.cashier

	def on_cancel(self):
		self.db_set("status", "Cancelled")
