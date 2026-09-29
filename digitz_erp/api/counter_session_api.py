# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""Day Open / Day Close for a cashier at a counter.

A Counter Session is one cashier's day at one registered counter PC: opened with a
float (open_day), closed by counting the till (close_day). Every cash document a
cashier saves -- Sales Invoice, Sales Return, Receipt Entry, Expense Entry -- is
stamped with the open session (stamp_counter_session), which is how the session
works out the cash it should hold. A cashier without an open day on this counter
cannot save them; supervisors and background jobs (the token sync) are not held to it.

Shift change on one counter: the outgoing cashier closes with Close & Hand Over
(close_day, then log out), and the next cashier opens with the counted cash as
their float (get_last_close carries the count). A day left open by a cashier who
has gone is closed by a supervisor who counts the till (supervisor_close).
"""

import json

import frappe
from frappe.utils import flt, now_datetime

from digitz_erp.api.counter_api import get_request_device, is_supervisor
from digitz_erp.digitz_erp.doctype.counter_session.counter_session import TOLERANCE

# The note and coin values offered in the Close Day cash count (AED)
DENOMINATIONS = (1000, 500, 200, 100, 50, 20, 10, 5, 1, 0.5, 0.25)


def get_open_session(user=None, counter=None, billing=False):
	"""The user's unsubmitted session (optionally on `counter`), as a name, or None.

	With `billing`, only a session still Open counts: one waiting in Closing for a
	supervisor takes no more documents.
	"""
	filters = {"cashier": user or frappe.session.user, "docstatus": 0}
	if counter:
		filters["counter"] = counter
	if billing:
		filters["status"] = "Open"
	return frappe.db.get_value("Counter Session", filters, "name")


def must_have_open_day(user=None):
	user = user or frappe.session.user
	return "Cashier" in frappe.get_roles(user) and not is_supervisor(user)


def stamp_counter_session(doc):
	"""Record the counter PC and the open day a cash document is saved in.

	Called from before_validate of Sales Invoice, Sales Return, Receipt Entry and
	Expense Entry. Sets `counter_session` (and `counter` / `counter_device` where
	the doctype has them) from the request's registered PC and the user's open
	session on it. A cashier who is not a supervisor is stopped without both.
	Nothing is required of background work, which has no request.
	"""
	if not getattr(frappe.local, "request", None):
		return

	device = get_request_device()
	if device:
		if doc.meta.has_field("counter"):
			doc.counter = device.counter
		if doc.meta.has_field("counter_device"):
			doc.counter_device = device.device

	session = get_open_session(counter=device.counter, billing=True) if device else None
	if session:
		doc.counter_session = session
		return

	if not must_have_open_day():
		return

	if not device:
		frappe.throw(
			"This device is not registered as a counter, so this cannot be saved here. "
			"Ask a supervisor to register it.",
			title="Unregistered Device",
		)

	frappe.throw(
		f"Open the day on {device.counter} before billing. Click the counter badge at the top of the page.",
		title="Day Not Opened",
	)


def get_last_close(counter):
	"""The last counted session on `counter`, or None.

	{name, cashier, cashier_name, closed_on, counted_cash, difference, status,
	denominations}. A close still waiting for approval counts: its till was
	counted and handed over, so it is what the next day starts from.
	"""
	if not counter:
		return None
	rows = frappe.db.sql(
		"""
		SELECT name, cashier, closed_by, closed_on, counted_cash, difference, status
		FROM `tabCounter Session`
		WHERE counter = %(counter)s AND closed_on IS NOT NULL
		  AND (docstatus = 1 OR (docstatus = 0 AND status = 'Closing'))
		ORDER BY closed_on DESC
		LIMIT 1
		""",
		{"counter": counter},
		as_dict=True,
	)
	if not rows:
		return None
	last = rows[0]
	last.cashier_name = frappe.utils.get_fullname(last.cashier)
	last.closed_by_name = frappe.utils.get_fullname(last.closed_by) if last.closed_by else None
	last.denominations = frappe.get_all(
		"Cash Denomination Count",
		filters={"parent": last.name, "parenttype": "Counter Session", "parentfield": "denominations"},
		fields=["denomination", "count"],
		order_by="idx",
	)
	return last


@frappe.whitelist()
def get_state():
	"""Everything the counter badge shows: the PC, the user's day, and pending approvals."""
	device = get_request_device()
	supervisor = is_supervisor()

	session = None
	name = get_open_session()
	if name:
		session = frappe.db.get_value(
			"Counter Session", name, ["name", "counter", "status", "opened_on", "opening_float"], as_dict=True
		)

	return {
		"device": device.device if device else None,
		"counter": device.counter if device else None,
		"session": session,
		"can_register": supervisor,
		"is_supervisor": supervisor,
		"must_open_day": must_have_open_day(),
		"pending_approvals": frappe.db.count("Counter Session", {"docstatus": 0, "status": "Closing"}) if supervisor else 0,
		"counters": frappe.get_all("Counter", filters={"enabled": 1}, pluck="name", order_by="name") if supervisor else [],
		"denominations": DENOMINATIONS,
		"user_full_name": frappe.utils.get_fullname(frappe.session.user),
		"now": now_datetime(),
		# Shown when opening a day: the cash the last day on this counter closed with
		"last_close": get_last_close(device.counter) if device and not session else None,
		# Another cashier's day still open on this counter, which stops a new one
		"counter_taken": get_counter_taken(device.counter) if device and not session else None,
	}


def get_counter_taken(counter):
	"""Someone else's Open day on `counter`: {name, cashier, cashier_name, opened_on}, or None."""
	row = frappe.db.get_value(
		"Counter Session",
		{"counter": counter, "docstatus": 0, "status": "Open", "cashier": ["!=", frappe.session.user]},
		["name", "cashier", "opened_on"],
		as_dict=True,
	)
	if row:
		row.cashier_name = frappe.utils.get_fullname(row.cashier)
	return row


def parse_denominations(denominations):
	"""[{denomination, count}] with counts, from the pages' JSON."""
	if isinstance(denominations, str):
		denominations = json.loads(denominations or "[]")
	return [
		{"denomination": flt(row.get("denomination")), "count": flt(row.get("count"))}
		for row in denominations or []
		if flt(row.get("count"))
	]


@frappe.whitelist()
def open_day(opening_float=0, denominations=None, remarks=None):
	"""Open the user's day on this PC's counter with the cash now in the till.

	`denominations` is the optional note-by-note count; when given, it makes up
	the opening float.
	"""
	device = get_request_device()
	if not device:
		frappe.throw("This device is not registered as a counter. Ask a supervisor to register it.")

	counted = parse_denominations(denominations)
	if counted:
		opening_float = sum(row["denomination"] * row["count"] for row in counted)

	if flt(opening_float) < 0:
		frappe.throw("The opening float cannot be negative.")

	last_close = get_last_close(device.counter)

	session = frappe.get_doc({
		"doctype": "Counter Session",
		"counter": device.counter,
		"counter_device": device.device,
		"cashier": frappe.session.user,
		"status": "Open",
		"opened_on": now_datetime(),
		"opening_float": flt(opening_float),
		"previous_session": last_close.name if last_close else None,
		"previous_closing_cash": flt(last_close.counted_cash) if last_close else 0,
		"opening_denominations": [dict(row, amount=row["denomination"] * row["count"]) for row in counted],
		"opening_remarks": remarks,
	}).insert(ignore_permissions=True)

	return {"session": session.name, "counter": session.counter}


def get_own_open_session_doc():
	name = get_open_session()
	if not name:
		frappe.throw("You have no open day to close.")
	return frappe.get_doc("Counter Session", name)


@frappe.whitelist()
def get_close_preview():
	"""The expected cash of the user's open day, worked out now."""
	session = get_own_open_session_doc()
	session.calculate_cash()
	preview = {
		f: session.get(f)
		for f in ("name", "counter", "counter_device", "opened_on", "opening_float", "previous_session",
				  "previous_closing_cash", "cash_sales", "cash_receipts", "cash_refunds", "cash_paid_out",
				  "expected_cash", "status")
	}
	preview["documents"] = get_session_documents(session.name)
	return preview


def get_session_documents(session):
	"""The submitted cash documents behind each movement of `session`.

	{movement field: [{doctype, name, posting_date, posting_time, party, amount}]}
	"""
	from digitz_erp.digitz_erp.doctype.counter_session.counter_session import CASH_MOVEMENTS

	documents = {}
	for field, doctype, amount_field, _sign, skip_credit in CASH_MOVEMENTS:
		meta = frappe.get_meta(doctype)
		# Who the document is for: the first of these the doctype has that is filled in
		party_fields = [f for f in ("customer_display_name", "customer", "supplier", "remarks") if meta.has_field(f)]
		party = "COALESCE(" + ", ".join(f"NULLIF(d.`{f}`, '')" for f in party_fields) + ")" if party_fields else None
		time = "d.posting_time" if meta.has_field("posting_time") else "NULL"
		credit = "AND IFNULL(d.credit_sale, 0) = 0" if skip_credit else ""
		documents[field] = frappe.db.sql(
			f"""
			SELECT %(doctype)s AS doctype, d.name, d.posting_date, {time} AS posting_time,
				{party or "NULL"} AS party, d.`{amount_field}` AS amount
			FROM `tab{doctype}` d
			INNER JOIN `tabPayment Mode` pm ON pm.name = d.payment_mode
			WHERE d.counter_session = %(session)s AND d.docstatus = 1 AND pm.mode = 'Cash' {credit}
			ORDER BY d.posting_date, d.creation
			""",
			{"doctype": doctype, "session": session},
			as_dict=True,
		)
	return documents


@frappe.whitelist()
def get_pending_approvals():
	"""Closes waiting for a supervisor, with the figures to decide on."""
	if not is_supervisor():
		return []
	rows = frappe.get_all(
		"Counter Session",
		filters={"docstatus": 0, "status": "Closing"},
		fields=["name", "counter", "cashier", "opened_on", "expected_cash", "counted_cash", "difference", "close_remarks"],
		order_by="modified",
	)
	for row in rows:
		row.cashier_name = frappe.utils.get_fullname(row.cashier)
	return rows


def count_and_close(session, counted_cash, denominations, remarks, closed_by):
	"""Record the till count on `session` and close it.

	A clean count submits the session. Otherwise it stays in Closing for a
	supervisor -- unless a supervisor is closing someone else's day, when their
	close is its own approval. Either way the counter is free from here on.
	"""
	session.set("denominations", parse_denominations(denominations))

	if not session.denominations and counted_cash in (None, ""):
		frappe.throw("Enter the counted cash, or count the notes and coins.")

	session.counted_cash = flt(counted_cash)
	session.close_remarks = remarks
	session.status = "Closing"
	session.closed_on = now_datetime()
	session.closed_by = closed_by
	session.save(ignore_permissions=True)

	if (
		abs(flt(session.difference)) >= TOLERANCE
		and closed_by != session.cashier
		and is_supervisor(closed_by)
	):
		session.approved_by = closed_by
		session.save(ignore_permissions=True)

	if abs(flt(session.difference)) < TOLERANCE or session.approved_by:
		session.flags.ignore_permissions = True
		session.submit()
		return {"session": session.name, "status": "Closed", "difference": flt(session.difference)}

	return {"session": session.name, "status": "Closing", "difference": session.difference}


@frappe.whitelist()
def close_day(counted_cash=None, denominations=None, remarks=None):
	"""Close the user's open day with the counted cash.

	A clean count closes (submits) the session. A count that differs from the
	expected cash leaves it in Closing until a supervisor approves it (approve_close).
	`denominations` is a list of {denomination, count}; when given, it makes up the
	counted cash.
	"""
	session = get_own_open_session_doc()
	if session.status != "Open":
		frappe.throw(f"{session.name} is already counted and waiting for approval.")

	return count_and_close(session, counted_cash, denominations, remarks, frappe.session.user)


@frappe.whitelist()
def get_open_days():
	"""Days still open on any counter, for a supervisor to close: with the live expected cash.

	Leaves out the supervisor's own day, which they close the normal way.
	"""
	if not is_supervisor():
		return []
	names = frappe.get_all(
		"Counter Session",
		filters={"docstatus": 0, "status": "Open", "cashier": ["!=", frappe.session.user]},
		pluck="name",
		order_by="opened_on",
	)
	rows = []
	for name in names:
		doc = frappe.get_doc("Counter Session", name)
		doc.calculate_cash()
		rows.append({
			"name": doc.name,
			"counter": doc.counter,
			"cashier": doc.cashier,
			"cashier_name": frappe.utils.get_fullname(doc.cashier),
			"opened_on": doc.opened_on,
			"opening_float": doc.opening_float,
			"expected_cash": doc.expected_cash,
		})
	return rows


@frappe.whitelist()
def supervisor_close(session, counted_cash=None, denominations=None, remarks=None):
	"""A supervisor counts the till and closes another cashier's open day.

	For a cashier who left without closing, which would otherwise hold the counter.
	The supervisor is recorded as closed_by, and a difference is approved by them
	in the same step. A reason is required.
	"""
	if not is_supervisor():
		frappe.throw("Only a supervisor can close another cashier's day.", frappe.PermissionError)

	if not (remarks or "").strip():
		frappe.throw("Give a reason for closing this day on the cashier's behalf.")

	doc = frappe.get_doc("Counter Session", session)
	if doc.docstatus != 0 or doc.status != "Open":
		frappe.throw(f"{session} is not an open day.")

	return count_and_close(doc, counted_cash, denominations, remarks, frappe.session.user)


@frappe.whitelist()
def approve_close(session):
	"""A supervisor signs off a close with a difference, which closes the session."""
	if not is_supervisor():
		frappe.throw("Only a supervisor can approve a cash difference.", frappe.PermissionError)

	doc = frappe.get_doc("Counter Session", session)
	if doc.docstatus != 0 or doc.status != "Closing":
		frappe.throw(f"{session} is not waiting for approval.")

	doc.approved_by = frappe.session.user
	doc.save(ignore_permissions=True)
	doc.flags.ignore_permissions = True
	doc.submit()
	return {"session": doc.name, "status": doc.status, "difference": doc.difference}
