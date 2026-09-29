# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""Live operations data for the Medical Center dashboard.

One whitelisted call returns everything the page renders, so a refresh is a
single round trip rather than a dozen. Everything is scoped to today.

Two views of "counter" live here side by side:

* the real counters (Counter / Counter Device / Counter Session): which desks
  have a day open, who is on them, the cash that should be in each till, and
  what each has taken today by `Sales Invoice.counter` (get_counter_board);
* the per-cashier split, grouped by `Sales Invoice.owner` like the Counter
  based Sales report. token_sync raises each invoice as the cashier whose token
  it was, and synced drafts carry no counter until a cashier saves them on a
  PC, so the queue and the in-progress figures stay per cashier (get_counters).
"""

import frappe
from frappe.utils import cint, flt, now_datetime, today

# A session is "live" if it checked in this recently.
ONLINE_WINDOW_MINUTES = 15

# Counters are identified by role, not by the Cashier doctype.
CASHIER_ROLE = "Cashier"

# Categorical slots for counters, in fixed order. Computed against the Frappe
# card surfaces (#ffffff / #232323) with the dataviz validator at --pairs all:
# all checks pass in both modes. The two WARNs it reports (violet-vs-blue CVD
# at deltaE 7.5, and dark-mode contrast) are both discharged by the same thing:
# every bar is directly labelled, never colour-alone. Do not reorder or extend
# without re-running the validator; a 6th counter folds into "Other".
COUNTER_COLORS = ["#1d4ed8", "#8b5cf6", "#ec4899", "#be123c", "#ea580c"]
OTHER_COLOR = "#64748b"
MAX_COUNTER_SLOTS = len(COUNTER_COLORS)


@frappe.whitelist()
def get_live_dashboard():
	"""Everything the Medical Center dashboard shows, for today."""
	frappe.only_for(("System Manager", "Management", CASHIER_ROLE))

	online = get_online_users()
	counters = get_counters(online)
	board = get_counter_board()

	return {
		"generated_at": str(now_datetime()),
		"date": str(today()),
		"counters": counters,
		"counter_board": board,
		"totals": get_totals(counters, board),
		"online": online,
		"queue": get_live_queue(counters),
		"hourly": get_hourly_activity(),
		"sync": get_sync_health(),
	}


def get_owner_scope():
	"""The single owner this user may see, or None for unrestricted.

	Deliberately mirrors `get_sales_invoice_permission_query` in
	api/sales_invoice_api.py (and the identical rule on Medical Service Logs):
	Administrator is unrestricted, a user *without* the Cashier role is
	unrestricted, and a Cashier sees only records they own.

	The dashboard needs this explicitly because its queries are raw SQL for
	aggregation, and raw SQL does not run permission_query_conditions. Without
	it a cashier would see the whole floor's takings here while seeing only
	their own on the Sales Invoice Board.
	"""
	user = frappe.session.user

	if not user or user == "Administrator":
		return None

	if CASHIER_ROLE not in frappe.get_roles(user):
		return None

	return user


def owner_clause(scope, column="owner"):
	"""SQL fragment + params for the owner scope. Empty when unrestricted."""
	if not scope:
		return "", {}

	return f" AND `{column}` = %(owner)s", {"owner": scope}


# ---------------------------------------------------------------------------
# counters
# ---------------------------------------------------------------------------


def get_counter_users():
	"""Users holding the Cashier ROLE, in a stable order.

	Role, not the Cashier doctype. The role is what actually governs who works
	a counter -- it is also what the Sales Invoice permission query keys off, so
	this dashboard and that filter now agree on who a cashier is. The doctype is
	a separate master that can be incomplete or stale, and gating on it would
	hide real desks.

	Ordered by user id, deliberately *not* by revenue. Colour follows the
	counter, so a rank-ordered list would repaint every bar as takings move,
	and rows would jump under the operator's cursor on a page that refreshes
	itself. A fixed order keeps both stable.
	"""
	scope = get_owner_scope()
	if scope:
		# A cashier is their own and only counter.
		return [scope]

	holders = frappe.get_all(
		"Has Role",
		filters={"parenttype": "User", "role": CASHIER_ROLE},
		pluck="parent",
	)

	roster = set()
	if holders:
		# Only people who can actually sign in.
		roster.update(
			frappe.get_all("User", filters={"name": ["in", holders], "enabled": 1}, pluck="name")
		)

	# Anyone who actually raised an invoice today is a counter, whether or not
	# they hold the role. Without this a desk that is genuinely taking money is
	# invisible here purely because its role assignment is missing.
	todays = set(
		frappe.db.sql_list(
			"""SELECT DISTINCT owner FROM `tabSales Invoice`
			   WHERE posting_date = %(today)s AND docstatus < 2""",
			{"today": today()},
		)
	)

	# Role holders occupy the colour slots first, and only then whoever else
	# happened to invoice today. Callers assign colour by position, so ordering
	# the durable roster ahead of the daily stragglers stops a one-off invoice
	# owner from repainting every established counter. (Changing the roster
	# itself still reshuffles; that is rare and deliberate, unlike daily churn.)
	return sorted(u for u in roster if u) + sorted(u for u in todays - roster if u)


def get_counters(online=None):
	"""Per counter: today's takings, invoice counts and live state.

	`online` is passed in so the presence query runs once per request.
	"""
	users = get_counter_users()
	if not users:
		return []

	scope = get_owner_scope()
	where, scope_params = owner_clause(scope)

	# One grouped query rather than per-counter queries.
	rows = frappe.db.sql(
		"""
		SELECT
			owner,
			COUNT(*) AS invoices,
			SUM(CASE WHEN docstatus = 1 THEN 1 ELSE 0 END) AS submitted,
			SUM(CASE WHEN docstatus = 0 THEN 1 ELSE 0 END) AS drafts,
			SUM(CASE WHEN docstatus = 1 THEN net_total ELSE 0 END) AS amount,
			SUM(CASE WHEN docstatus = 0 THEN net_total ELSE 0 END) AS draft_amount
		FROM `tabSales Invoice`
		WHERE posting_date = %(today)s AND docstatus < 2
		"""
		+ where
		+ " GROUP BY owner",
		{"today": today(), **scope_params},
		as_dict=True,
	)
	by_user = {r.owner: r for r in rows}

	tokens = frappe.db.sql(
		"""
		SELECT owner, COUNT(*) AS tokens
		FROM `tabMedical Service Logs`
		WHERE DATE(added_on) = %(today)s
		"""
		+ where
		+ " GROUP BY owner",
		{"today": today(), **scope_params},
		as_dict=True,
	)
	tokens_by_user = {r.owner: cint(r.tokens) for r in tokens}

	online_users = {u["user"] for u in (online if online is not None else get_online_users())}

	counters = []
	for index, user in enumerate(users):
		stats = by_user.get(user) or {}
		full_name = frappe.db.get_value("User", user, "full_name") or user

		counters.append(
			{
				"user": user,
				"full_name": full_name,
				"initials": make_initials(full_name),
				"color": COUNTER_COLORS[index] if index < MAX_COUNTER_SLOTS else OTHER_COLOR,
				"online": user in online_users,
				"invoices": cint(stats.get("invoices")),
				"submitted": cint(stats.get("submitted")),
				"drafts": cint(stats.get("drafts")),
				"amount": flt(stats.get("amount")),
				"draft_amount": flt(stats.get("draft_amount")),
				"total_amount": flt(stats.get("amount")) + flt(stats.get("draft_amount")),
				"tokens": tokens_by_user.get(user, 0),
			}
		)

	# Bar width is share of the busiest counter's handled value. Handled, not
	# collected, so the bars still read early in the day when every invoice is
	# still a draft. Both parts are labelled on the row.
	top = max([c["total_amount"] for c in counters] or [0])
	for counter in counters:
		counter["share"] = round((counter["total_amount"] / top) * 100, 1) if top else 0
		counter["collected_share"] = (
			round((counter["amount"] / counter["total_amount"]) * 100, 1)
			if counter["total_amount"] else 0
		)

	return counters


def make_initials(full_name):
	parts = [p for p in str(full_name).split() if p]
	if not parts:
		return "?"
	if len(parts) == 1:
		return parts[0][:2].upper()
	return (parts[0][0] + parts[-1][0]).upper()


def get_totals(counters, board):
	"""Day totals across every cashier, plus site-wide draft count."""
	scope = get_owner_scope()
	draft_filters = {"docstatus": 0}
	if scope:
		draft_filters["owner"] = scope

	drafts = frappe.db.count("Sales Invoice", draft_filters)

	return {
		"amount": sum(c["amount"] for c in counters),
		"draft_amount": sum(c["draft_amount"] for c in counters),
		"invoices": sum(c["invoices"] for c in counters),
		"submitted": sum(c["submitted"] for c in counters),
		"tokens": sum(c["tokens"] for c in counters),
		"drafts": drafts,
		"online_cashiers": sum(1 for c in counters if c["online"]),
		"total_cashiers": len(counters),
		"open_counters": sum(1 for c in board["counters"] if c["state"] == "open"),
		"total_counters": len(board["counters"]),
	}


# ---------------------------------------------------------------------------
# counter board (Counter / Counter Device / Counter Session)
# ---------------------------------------------------------------------------


def get_counter_board():
	"""Every enabled counter with its day, its PC and today's takings.

	Per counter the session shown is the open day if there is one (Open, or
	Closing while it waits for a supervisor), else the last day closed today.
	`state` is one of open / closing / closed / idle.

	A cashier sees only the counters they worked today, and only their own
	sessions and takings on them, matching the owner scope of the rest of the
	page.
	"""
	from digitz_erp.api.counter_api import is_supervisor

	scope = get_owner_scope()
	cashier_where, cashier_params = owner_clause(scope, column="cashier")

	sessions = frappe.db.sql(
		"""
		SELECT name, counter, counter_device, cashier, status, docstatus,
		       opened_on, closed_on, opening_float, expected_cash,
		       counted_cash, difference
		FROM `tabCounter Session`
		WHERE (docstatus = 0 OR (docstatus = 1 AND DATE(closed_on) = %(today)s))
		"""
		+ cashier_where
		# After a handover a counter can hold the next cashier's Open day and the
		# last one's close awaiting approval; the Open day is what the card shows.
		+ """ ORDER BY CASE WHEN docstatus = 0 AND status = 'Open' THEN 0
		                   WHEN docstatus = 0 THEN 1 ELSE 2 END,
		           closed_on DESC""",
		{"today": today(), **cashier_params},
		as_dict=True,
	)

	# Open day first, then a close awaiting approval, else the latest close today.
	session_by_counter = {}
	for row in sessions:
		session_by_counter.setdefault(row.counter, row)

	names = frappe.get_all("Counter", filters={"enabled": 1}, pluck="name", order_by="name")
	if scope:
		names = [n for n in names if n in session_by_counter]

	if not names:
		return {"counters": [], "pending_approvals": 0}

	till = get_live_till_cash([s.name for s in session_by_counter.values() if s.docstatus == 0])

	where, scope_params = owner_clause(scope)
	takings = frappe.db.sql(
		"""
		SELECT counter, COUNT(*) AS invoices, SUM(net_total) AS amount
		FROM `tabSales Invoice`
		WHERE posting_date = %(today)s AND docstatus = 1
		  AND IFNULL(counter, '') != ''
		"""
		+ where
		+ " GROUP BY counter",
		{"today": today(), **scope_params},
		as_dict=True,
	)
	takings_by_counter = {r.counter: r for r in takings}

	devices = frappe.db.sql(
		"""
		SELECT counter, COUNT(*) AS devices, MAX(last_seen) AS last_seen
		FROM `tabCounter Device`
		WHERE enabled = 1
		GROUP BY counter
		""",
		as_dict=True,
	)
	devices_by_counter = {r.counter: r for r in devices}

	board = []
	for name in names:
		session = session_by_counter.get(name)
		taken = takings_by_counter.get(name) or {}
		device = devices_by_counter.get(name) or {}

		entry = {
			"counter": name,
			"state": "idle",
			"invoices": cint(taken.get("invoices")),
			"amount": flt(taken.get("amount")),
			"devices": cint(device.get("devices")),
			"last_seen": str(device["last_seen"]) if device.get("last_seen") else None,
			"session": None,
		}

		if session:
			if session.docstatus == 0:
				entry["state"] = "closing" if session.status == "Closing" else "open"
			else:
				entry["state"] = "closed"

			cashier_name = frappe.utils.get_fullname(session.cashier)
			expected = (
				flt(session.opening_float) + till.get(session.name, 0)
				if session.docstatus == 0 and session.status == "Open"
				else flt(session.expected_cash)
			)
			entry["session"] = {
				"name": session.name,
				"cashier": session.cashier,
				"cashier_name": cashier_name,
				"initials": make_initials(cashier_name),
				"opened_on": str(session.opened_on) if session.opened_on else None,
				"closed_on": str(session.closed_on) if session.closed_on else None,
				"opening_float": flt(session.opening_float),
				"expected_cash": expected,
				"counted_cash": flt(session.counted_cash),
				"difference": flt(session.difference),
			}

		board.append(entry)

	pending = (
		frappe.db.count("Counter Session", {"docstatus": 0, "status": "Closing"})
		if is_supervisor() else 0
	)

	return {"counters": board, "pending_approvals": pending}


def get_live_till_cash(sessions):
	"""{session: net cash moved so far} for open sessions, without the float.

	The same sums Counter Session.calculate_cash works out on save, done here
	for every open session in one query per movement, so the till figure is
	live rather than whatever the session held when it was last saved.
	"""
	from digitz_erp.digitz_erp.doctype.counter_session.counter_session import CASH_MOVEMENTS

	if not sessions:
		return {}

	net = {}
	for _field, doctype, amount_field, sign, skip_credit in CASH_MOVEMENTS:
		credit = "AND IFNULL(d.credit_sale, 0) = 0" if skip_credit else ""
		rows = frappe.db.sql(
			f"""
			SELECT d.counter_session, SUM(d.`{amount_field}`)
			FROM `tab{doctype}` d
			INNER JOIN `tabPayment Mode` pm ON pm.name = d.payment_mode
			WHERE d.counter_session IN %(sessions)s AND d.docstatus = 1
			  AND pm.mode = 'Cash' {credit}
			GROUP BY d.counter_session
			""",
			{"sessions": tuple(sessions)},
		)
		for session, amount in rows:
			net[session] = net.get(session, 0) + sign * flt(amount)

	return net


# ---------------------------------------------------------------------------
# presence
# ---------------------------------------------------------------------------


def get_online_users():
	"""Desk users with a session that checked in recently.

	`tabSessions` is a plain table, not a doctype, so this is raw SQL. Guest
	sessions are excluded: they are not people at a counter.

	Scoped like everything else: a cashier sees only themselves. The payload
	carries full names, so an unscoped list would let a cashier enumerate staff
	on a page that otherwise shows them nothing but their own work.
	"""
	scope = get_owner_scope()
	where, scope_params = owner_clause(scope, column="user") if scope else ("", {})

	rows = frappe.db.sql(
		"""
		SELECT s.user, MAX(s.lastupdate) AS last_seen
		FROM tabSessions s
		WHERE s.user != 'Guest'
		  AND s.lastupdate > DATE_SUB(NOW(), INTERVAL %(mins)s MINUTE)
		"""
		+ where
		+ " GROUP BY s.user ORDER BY last_seen DESC",
		{"mins": ONLINE_WINDOW_MINUTES, **scope_params},
		as_dict=True,
	)

	users = []
	for row in rows:
		full_name = frappe.db.get_value("User", row.user, "full_name") or row.user
		users.append(
			{
				"user": row.user,
				"full_name": full_name,
				"initials": make_initials(full_name),
				"last_seen": str(row.last_seen),
			}
		)

	return users


# ---------------------------------------------------------------------------
# live queue + activity
# ---------------------------------------------------------------------------


def get_live_queue(counters, limit=12):
	"""Draft invoices still waiting to be taken, newest first.

	Takes the already-computed counters so the colour lookup does not re-run
	the whole per-counter aggregation a second time.
	"""
	where, scope_params = owner_clause(get_owner_scope())

	rows = frappe.db.sql(
		"""
		SELECT name, customer, customer_token, medical_service,
		       rounded_total, owner, creation
		FROM `tabSales Invoice`
		WHERE docstatus = 0
		"""
		+ where
		+ " ORDER BY creation DESC LIMIT %(limit)s",
		{"limit": cint(limit), **scope_params},
		as_dict=True,
	)

	colors = {c["user"]: c["color"] for c in counters}

	for row in rows:
		row["creation"] = str(row["creation"])
		row["color"] = colors.get(row["owner"], OTHER_COLOR)
		row["owner_name"] = frappe.db.get_value("User", row["owner"], "full_name") or row["owner"]

	return rows


def get_hourly_activity():
	"""Invoices raised per hour today, by creation time.

	Creation rather than posting_time: this strip is about when work actually
	happened, and posting_time is nudged forward by the controller when two
	invoices land in the same second.
	"""
	where, scope_params = owner_clause(get_owner_scope())

	rows = frappe.db.sql(
		"""
		SELECT HOUR(creation) AS hour, COUNT(*) AS invoices,
		       SUM(CASE WHEN docstatus = 1 THEN net_total ELSE 0 END) AS amount
		FROM `tabSales Invoice`
		WHERE DATE(creation) = %(today)s AND docstatus < 2
		"""
		+ where
		+ " GROUP BY HOUR(creation)",
		{"today": today(), **scope_params},
		as_dict=True,
	)
	by_hour = {cint(r.hour): r for r in rows}

	current_hour = now_datetime().hour
	series = []
	for hour in range(24):
		row = by_hour.get(hour)
		series.append(
			{
				"hour": hour,
				"invoices": cint(row.invoices) if row else 0,
				"amount": flt(row.amount) if row else 0,
				"current": hour == current_hour,
			}
		)

	return series


# ---------------------------------------------------------------------------
# token sync health
# ---------------------------------------------------------------------------


def get_sync_health():
	"""Is the token pull alive, and is anything stuck?"""
	from digitz_erp.api.token_sync import is_sync_enabled

	where, scope_params = owner_clause(get_owner_scope())

	counts = frappe.db.sql(
		"""
		SELECT status, COUNT(*) AS c
		FROM `tabMedical Service Logs`
		WHERE DATE(added_on) = %(today)s
		"""
		+ where
		+ " GROUP BY status",
		{"today": today(), **scope_params},
		as_dict=True,
	)
	by_status = {r.status: cint(r.c) for r in counts}

	last = frappe.db.sql(
		"""
		SELECT MAX(added_on) AS last_added FROM `tabMedical Service Logs`
		WHERE DATE(added_on) = %(today)s
		"""
		+ where,
		{"today": today(), **scope_params},
		as_dict=True,
	)
	last_added = last[0].last_added if last else None

	failed = by_status.get("Failed", 0)
	pending = by_status.get("Pending", 0)

	if not is_sync_enabled():
		state = "off"
	elif failed:
		state = "critical"
	elif pending:
		state = "warning"
	else:
		state = "good"

	return {
		"enabled": is_sync_enabled(),
		"state": state,
		"completed": by_status.get("Completed", 0),
		"skipped": by_status.get("Skipped", 0),
		"failed": failed,
		"pending": pending,
		"last_added": str(last_added) if last_added else None,
	}
