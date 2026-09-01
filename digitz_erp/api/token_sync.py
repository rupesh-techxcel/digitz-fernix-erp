# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""Server side sync of medical tokens into Sales Invoices.

This replaces the browser driven loop that used to live in the Sales Invoice
Board page. A cron job pulls the new token stream, records each token in Medical
Service Logs and raises the matching Sales Invoice, then pushes a realtime event
so open desks update without polling.

The remote request carries no username -- it returns the whole stream -- so the
sync fetches once per run. Each token names its own desk in `UserName`, and that
is only used to decide who the resulting invoice belongs to.

The design goals, in order:

1. Never create the same invoice twice, even if two workers race or the remote
   API replays a token. `Medical Service Logs.token_key` is uniquely indexed and
   is the single source of truth for "have we seen this token".
2. Never lose a token silently. Every token that cannot be invoiced ends up as a
   `Skipped` or `Failed` log with a readable reason, and `Failed` ones are
   retried on later runs.
3. Never let one bad token block the rest. Each token is committed on its own.
"""

import hashlib
import json
from contextlib import contextmanager

import requests

import frappe
from frappe import _
from frappe.utils import add_days, cint, flt, get_datetime, now_datetime, today
from frappe.utils.file_lock import LockTimeoutError
from frappe.utils.scheduler import is_scheduler_inactive
from frappe.utils.synchronization import filelock

from digitz_erp.api.medical_services import get_medical_service_items

REALTIME_EVENT = "digitz_token_invoice_created"
SYNC_JOB_ID = "digitz_erp::medical_token_sync"
SYNC_LOCK = "digitz_medical_token_sync"
REQUEST_TIMEOUT = 30
RETRY_LOOKBACK_DAYS = 2
MAX_ATTEMPTS = 5
DEFAULT_TAX_RATE = 5

# ---------------------------------------------------------------------------
# TEMPORARY BACKFILL SWITCH
#
#   0 = normal operation, pull today's tokens.
#   1 = pull yesterday's tokens instead, 2 = the day before, and so on.
#
# TO REVERT: set this back to 0. Nothing else needs undoing -- it is server
# side only, so no asset rebuild and no browser reload are involved.
#
# While it is non-zero every sync report says so in the popup, so the switch
# cannot quietly be left on. Note that invoices are still dated today: the
# posting date is not backdated (Sales Invoice blocks that unless
# edit_posting_date_and_time is set), only the tokens fetched are from the
# earlier day.
# ---------------------------------------------------------------------------
SYNC_DAYS_BACK = 0

STATUS_PENDING = "Pending"
STATUS_COMPLETED = "Completed"
STATUS_SKIPPED = "Skipped"
STATUS_FAILED = "Failed"

# Reported by process_token but never stored on a log: the token was already
# invoiced by an earlier run and this sighting is a replay.
OUTCOME_ALREADY = "Already invoiced"


class TokenSkipped(Exception):
	"""Raised when a token is valid but deliberately produces no invoice."""


# ---------------------------------------------------------------------------
# entry points
# ---------------------------------------------------------------------------


def enqueue_medical_token_sync():
	"""Cron entry point, runs every minute.

	The scheduler tick only enqueues; the actual work happens on the long queue
	so a slow remote API can never hold up other scheduled jobs. `deduplicate`
	means a run that overruns its minute is not stacked on top of itself, which
	is the server side replacement for the old `window.__..._sync_running` lock.
	"""
	if not is_sync_enabled():
		return

	frappe.enqueue(
		"digitz_erp.api.token_sync.sync_medical_tokens",
		queue="long",
		job_id=SYNC_JOB_ID,
		deduplicate=True,
		timeout=600,
	)


@frappe.whitelist()
def run_token_sync_now():
	"""Manual 'Sync now' trigger from the board and the dashboard.

	Runs inline rather than enqueueing, so the caller gets the report back and
	the button still works when no background worker is running -- which is
	exactly the situation somebody clicks it to diagnose.
	"""
	frappe.only_for(("System Manager", "Cashier"))

	return sync_medical_tokens()


def sync_medical_tokens():
	"""Pull new tokens for every enabled Cashier, then retry past failures.

	Returns a report of everything that happened, which the desk renders in the
	'Sync Now' popup. The scheduled run ignores it.
	"""
	try:
		with filelock(SYNC_LOCK, timeout=0):
			return run_sync()
	except LockTimeoutError:
		# The scheduled run enqueues with deduplicate=True, but that lock does
		# not cover an inline caller. Without this, a manual click landing on
		# top of a cron run could invoice the same token twice: both would see
		# the log as Pending, one via the DuplicateEntryError re-read.
		return sync_report(
			state="busy",
			message=_("A token sync is already running. Try again in a moment."),
		)


def sync_report(state, message=None, **extra):
	"""Skeleton report, so every exit path has the same shape."""
	report = {
		"ok": state == "completed",
		"state": state,
		"message": message,
		"generated_at": str(now_datetime()),
		"scheduler_inactive": scheduler_is_inactive(),
		"url": None,
		"sync_date": str(sync_date()),
		"days_back": SYNC_DAYS_BACK,
		"stream": stream_report(),
		"retried": [],
		"totals": {
			"fetched": 0,
			"created": 0,
			"already": 0,
			"skipped": 0,
			"failed": 0,
		},
	}
	report.update(extra)
	return report


def scheduler_is_inactive():
	"""Whether automatic syncing is off, regardless of the enable checkbox.

	Surfaced in the report because a paused scheduler is the usual reason for
	"it is enabled but nothing is syncing".
	"""
	try:
		return bool(is_scheduler_inactive(verbose=False))
	except Exception:
		return False


def run_sync():
	"""The sync itself. Always returns a report; never raises to the caller."""
	if not is_sync_enabled():
		return sync_report(
			state="disabled",
			message=_("Token sync is disabled in Settings."),
		)

	url = get_token_url()
	if not url:
		frappe.log_error(
			message="Settings.url is empty, cannot fetch medical tokens.",
			title="Medical token sync",
		)
		return sync_report(
			state="no_url",
			message=_("No Token URL is set in Settings."),
		)

	stream = sync_stream(url)
	retried = retry_stalled_logs()

	created = [
		outcome
		for outcome in all_outcomes(stream, retried)
		if outcome["status"] == STATUS_COMPLETED
	]
	if created:
		notify_invoices_created(created)

	return sync_report(
		state="completed",
		url=url,
		stream=stream,
		retried=retried,
		totals=tally(stream, retried),
	)


def all_outcomes(stream, retried):
	yield from stream["outcomes"]
	yield from retried


def tally(stream, retried):
	counts = {
		"fetched": stream["fetched"],
		"created": 0,
		"already": 0,
		"skipped": 0,
		"failed": 0,
	}

	key_for = {
		STATUS_COMPLETED: "created",
		OUTCOME_ALREADY: "already",
		STATUS_SKIPPED: "skipped",
		STATUS_FAILED: "failed",
	}

	for outcome in all_outcomes(stream, retried):
		key = key_for.get(outcome["status"])
		if key:
			counts[key] += 1

	return counts


def short_error():
	"""The last line of the current traceback, for display.

	The full traceback still goes to Error Log and to the log's error_message;
	this is only what the popup shows.
	"""
	traceback = frappe.get_traceback(with_context=False).strip()
	return traceback.splitlines()[-1] if traceback else _("Unknown error")


# ---------------------------------------------------------------------------
# settings / configuration
# ---------------------------------------------------------------------------


def is_sync_enabled():
	# get_single_value throws (rather than returning None) when the field does
	# not exist, so an un-migrated site would raise on every scheduler tick.
	# Treat "field not there yet" as off.
	if not frappe.get_meta("Settings").has_field("token_sync_enabled"):
		return False

	return bool(cint(frappe.db.get_single_value("Settings", "token_sync_enabled")))


def get_token_url():
	url = frappe.db.get_single_value("Settings", "url")
	return url.strip() if url else None


def get_sync_usernames():
	"""Usernames of the enabled Cashiers.

	The sync itself no longer calls this: the remote request carries no
	username, so nothing about the fetch depends on the Cashier list. It is
	kept because the simulator in api/test_token_api.py stamps `UserName` on
	the tokens it queues, and that has to match a real desk for attribution to
	be exercised.
	"""
	if not frappe.db.exists("DocType", "Cashier"):
		frappe.log_error(
			message="The Cashier doctype is not installed; token sync has no desks to poll.",
			title="Medical token sync",
		)
		return []

	cashier_users = frappe.get_all(
		"Cashier",
		filters={"disabled": 0},
		pluck="user",
	)

	usernames = []
	for user in cashier_users:
		if not user:
			continue

		username = frappe.db.get_value("User", user, "username")
		if username and username not in usernames:
			usernames.append(username)

	if not usernames:
		frappe.log_error(
			message="No enabled Cashier has a User with a username set; nothing to sync.",
			title="Medical token sync",
		)

	return usernames


def get_counter_user(username):
	"""The User behind a Cashier username.

	`Sales Invoice.owner` is what the Counter based Sales report groups by, so
	the owner *is* the counter. Invoices must therefore be raised as the cashier
	the token belongs to, not as the scheduler's Administrator.
	"""
	if not username:
		return None

	return frappe.db.get_value("User", {"username": username, "enabled": 1}, "name")


@contextmanager
def as_user(user):
	"""Run a block as `user`, restoring the previous session user afterwards.

	Document.set_user_and_timestamp assigns `owner = modified_by = session user`
	unconditionally for new documents, overwriting anything set on the doc, so
	swapping the session user is the only way to attribute the invoice and the
	log to the right counter.
	"""
	previous = frappe.session.user

	if not user or user == previous:
		yield
		return

	frappe.set_user(user)
	try:
		yield
	finally:
		frappe.set_user(previous)


# ---------------------------------------------------------------------------
# cursor / fetch
# ---------------------------------------------------------------------------


def sync_date():
	"""The day the sync pulls tokens for. Today, unless SYNC_DAYS_BACK is set."""
	return add_days(today(), -SYNC_DAYS_BACK) if SYNC_DAYS_BACK else today()


def get_cursor():
	"""Return the (timestamp, last_token_no) watermark for the day's stream.

	Token numbers restart each day, so the watermark is scoped to one day and
	falls back to midnight/0 at the start of a new day. The timestamp is taken
	from the raw `api_response` where possible so we hand the API back exactly
	the value it gave us, rather than a value round-tripped through MariaDB.

	One watermark for the whole site, not one per desk: the request carries no
	username, so every desk would be handed the identical stream anyway.

	While backfilling an earlier day the watermark will not advance, because
	the logs written by the backfill carry today's `added_on`. Each run then
	re-reads the whole day and reports the repeats as "Already invoiced",
	which is the safe direction for a catch-up.
	"""
	day = sync_date()
	day_start = f"{day} 00:00:00"
	day_end = f"{day} 23:59:59.999999"

	# Ordered on created_date alone. token_number is text -- it can be 'T-104' --
	# so it sorts lexicographically and is no use as a tie break; rows sharing a
	# created_date all yield the same watermark anyway, which is the only part of
	# this row the caller uses.
	last = frappe.db.get_value(
		"Medical Service Logs",
		{
			"added_on": ["between", [day_start, day_end]],
		},
		["created_date", "token_number", "api_response"],
		order_by="created_date desc",
		as_dict=True,
	)

	if not last:
		return f"{day}T00:00:00.0000000", None

	return (
		extract_created_date(last.api_response) or format_dotnet_datetime(last.created_date),
		last.token_number,
	)


def extract_created_date(api_response):
	"""Pull `CreatedDate` out of a stored API payload, normalised to 7 decimals."""
	if not api_response:
		return None

	try:
		payload = json.loads(api_response)
	except (ValueError, TypeError):
		return None

	created = payload.get("CreatedDate") if isinstance(payload, dict) else None
	if not created or not isinstance(created, str):
		return None

	head, _sep, fraction = created.partition(".")
	return f"{head}.{fraction[:7].ljust(7, '0')}"


def format_dotnet_datetime(value):
	"""Format a Frappe datetime the way the remote (.NET) API expects it."""
	if not value:
		return f"{sync_date()}T00:00:00.0000000"

	value = get_datetime(value)
	# Frappe stores datetime(6); pad the missing 7th digit of .NET ticks.
	return value.strftime("%Y-%m-%dT%H:%M:%S.%f") + "0"


def get_day_end(timestamp):
	"""The end of the window to ask for, in the API's format.

	Anchored to `sync_date()` rather than to the cursor's own date. Deriving it
	from the cursor would strand the sync after a backfill: the watermark can
	still point at an earlier day's token, which would clamp the window shut on
	that day and today's tokens would never be fetched.

	`timestamp` is accepted so the window can never end before it starts.
	"""
	day = str(sync_date())
	start_day = str(timestamp or "")[:10]

	if start_day > day:
		day = start_day

	return f"{day}T23:59:59.9999999"


def token_request_params(timestamp):
	"""The query the remote service is asked for: one day, from the watermark."""
	return {
		"from": timestamp,
		"to": get_day_end(timestamp),
	}


def token_request_url(url, timestamp):
	"""The URL fetch_tokens will call, built without sending anything.

	Worked out up front so the report can show the exact request even when the
	call itself never completes -- an unreachable host is precisely when the
	reader wants to see what was being asked for.
	"""
	try:
		return requests.Request("GET", url, params=token_request_params(timestamp)).prepare().url
	except Exception:
		return url


def fetch_tokens(url, timestamp):
	"""Return (tokens, request_url).

	The fully built request URL comes back so the report can show exactly what
	was asked of the remote service; when a desk unexpectedly gets nothing, the
	`from`/`to` window is the first thing worth looking at.
	"""
	response = requests.get(
		url,
		params=token_request_params(timestamp),
		timeout=REQUEST_TIMEOUT,
	)
	request_url = response.url
	response.raise_for_status()

	body = response.json()

	# The real (.NET) service returns a bare array. A Frappe hosted stand-in,
	# such as the simulator in api/test_token_api.py, wraps whitelisted return
	# values in {"message": [...]}, so accept either shape.
	if isinstance(body, dict) and "message" in body:
		body = body["message"]

	if not isinstance(body, list):
		frappe.log_error(
			message=f"Expected a list of tokens, got {type(body).__name__}.",
			title="Medical token sync",
		)
		return [], request_url

	return body, request_url


def stream_report(**extra):
	"""Skeleton report for the one fetch this sync makes."""
	report = {
		"request_url": None,
		"fetched": 0,
		"error": None,
		"outcomes": [],
	}
	report.update(extra)
	return report


def sync_stream(url):
	"""Fetch the whole token stream once and process every token in it.

	The remote service takes no username, so there is exactly one stream for
	the site. Each token names its own desk in `UserName`, and that is what
	decides who the resulting invoice belongs to -- the sync no longer needs a
	list of Cashiers before it is allowed to call the API.
	"""
	timestamp, last_token_no = get_cursor()

	# Known before the call, so a connection failure still reports the URL.
	request_url = token_request_url(url, timestamp)

	try:
		tokens, request_url = fetch_tokens(url, timestamp)
	except Exception:
		frappe.db.rollback()
		frappe.log_error(
			message=frappe.get_traceback(),
			title="Medical token fetch failed",
		)
		return stream_report(request_url=request_url, error=short_error())

	outcomes = []

	for item in tokens:
		if not isinstance(item, dict):
			continue

		# Attribute the invoice to the desk the token came from. An unknown or
		# missing UserName leaves the session user as owner rather than
		# dropping the token.
		username = item.get("UserName")

		with as_user(get_counter_user(username)):
			outcomes.append(process_token(item, username))

	return stream_report(
		request_url=request_url,
		fetched=len(outcomes),
		outcomes=outcomes,
	)


# ---------------------------------------------------------------------------
# per token processing
# ---------------------------------------------------------------------------


def token_text(item):
	"""The token number as the API sent it, trimmed, or None.

	Token numbers are text, not integers: the remote issues values like 'T-104'
	alongside plain numbers. Nothing on this path may coerce them, because
	cint() turns every non numeric token into 0 and they all collide.
	"""
	raw = item.get("TokenNumber")

	if raw is None:
		return None

	return str(raw).strip() or None


def token_outcome(item, **extra):
	"""Skeleton outcome for one token, so every path reports the same shape."""
	outcome = {
		"token_number": token_text(item),
		"customer_name": item.get("Name"),
		"service": item.get("Service"),
		"username": item.get("UserName"),
		"status": None,
		"sales_invoice": None,
		"customer": None,
		"log": None,
		"reason": None,
	}
	outcome.update(extra)
	return outcome


def process_token(item, username):
	"""Record one token and raise its invoice. Commits or rolls back on its own.

	Always returns an outcome dict describing what happened, so the caller can
	report skips and failures instead of only successes.
	"""
	try:
		log = get_or_create_log(item, username)

		# Completed is authoritative on its own: legacy rows migrated by the
		# backfill patch may be Completed without a `sales_invoice` link, and
		# must not be re-invoiced if the API ever replays the token.
		if log.status == STATUS_COMPLETED:
			frappe.db.commit()
			return token_outcome(
				item,
				status=OUTCOME_ALREADY,
				sales_invoice=log.sales_invoice,
				customer=log.customer,
				log=log.name,
			)

		invoice = create_invoice_for_log(log, item)
		frappe.db.commit()
		return token_outcome(item, status=STATUS_COMPLETED, log=log.name, **invoice)
	except TokenSkipped as skip:
		frappe.db.rollback()
		return token_outcome(
			item,
			status=STATUS_SKIPPED,
			reason=str(skip),
			log=mark_log(item, username, STATUS_SKIPPED, str(skip)),
		)
	except Exception:
		frappe.db.rollback()
		frappe.log_error(
			message=frappe.get_traceback(),
			title=f"Medical token {item.get('TokenNumber')} failed",
		)
		# The log keeps the tail of the traceback; the report shows one line.
		return token_outcome(
			item,
			status=STATUS_FAILED,
			reason=short_error(),
			log=mark_log(
				item, username, STATUS_FAILED, frappe.get_traceback(with_context=False)[-1000:]
			),
		)


def make_token_key(item):
	"""Stable idempotency key for a token, independent of when we saw it.

	`ApplicationNumber` is the remote system's own identifier; the service and
	token number are folded in so that one application raising two different
	services still produces two logs.
	"""
	parts = [
		str(item.get("ApplicationNumber") or ""),
		str(item.get("Service") or ""),
		str(item.get("TokenNumber") or ""),
		str(item.get("CreatedDate") or "")[:10],
		str(item.get("Name") or ""),
	]
	return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()


def get_or_create_log(item, username):
	"""Fetch the log for this token, creating it if this is the first sighting.

	The unique index on `token_key` is what makes this safe under concurrency:
	if two workers insert at once one of them gets a DuplicateEntryError and
	re-reads the winner's row instead of creating a second log.
	"""
	token_key = make_token_key(item)

	name = frappe.db.get_value("Medical Service Logs", {"token_key": token_key}, "name")
	if name:
		return frappe.get_doc("Medical Service Logs", name)

	log = frappe.get_doc(
		{
			"doctype": "Medical Service Logs",
			"token_key": token_key,
			"customer_name": item.get("Name"),
			"token_number": token_text(item),
			"service": item.get("Service"),
			"status": STATUS_PENDING,
			"api_response": json.dumps(item),
			"created_date": parse_created_date(item.get("CreatedDate")),
			"added_on": now_datetime(),
			"synced_for_username": username,
		}
	)

	try:
		log.insert(ignore_permissions=True)
	except frappe.DuplicateEntryError:
		frappe.db.rollback()
		name = frappe.db.get_value("Medical Service Logs", {"token_key": token_key}, "name")
		if not name:
			raise
		return frappe.get_doc("Medical Service Logs", name)

	return log


def parse_created_date(value):
	"""Parse the API's .NET timestamp into something MariaDB accepts."""
	if not value:
		return now_datetime()

	try:
		# get_datetime chokes on 7 digit fractions; trim to microseconds.
		head, _sep, fraction = str(value).partition(".")
		normalised = f"{head}.{fraction[:6]}" if fraction else head
		return get_datetime(normalised.replace("T", " "))
	except Exception:
		return now_datetime()


def mark_log(item, username, status, message=None):
	"""Record the outcome of a token on its log, in its own transaction.

	Returns the log name so the caller can link to it, or None if even the log
	could not be written.
	"""
	try:
		token_key = make_token_key(item)
		name = frappe.db.get_value("Medical Service Logs", {"token_key": token_key}, "name")

		if not name:
			# The failure happened before the log existed; create it so the
			# token is still visible rather than vanishing.
			log = frappe.get_doc(
				{
					"doctype": "Medical Service Logs",
					"token_key": token_key,
					"customer_name": item.get("Name"),
					"token_number": token_text(item),
					"service": item.get("Service"),
					"status": status,
					"api_response": json.dumps(item),
					"created_date": parse_created_date(item.get("CreatedDate")),
					"added_on": now_datetime(),
					"synced_for_username": username,
					"error_message": message,
					"attempts": 1,
				}
			)
			log.insert(ignore_permissions=True)
			name = log.name
		else:
			frappe.db.set_value(
				"Medical Service Logs",
				name,
				{
					"status": status,
					"error_message": message,
					"attempts": cint(frappe.db.get_value("Medical Service Logs", name, "attempts")) + 1,
				},
				update_modified=False,
			)

		frappe.db.commit()
		return name
	except Exception:
		frappe.db.rollback()
		frappe.log_error(
			message=frappe.get_traceback(),
			title="Could not record medical token outcome",
		)
		return None


# ---------------------------------------------------------------------------
# customer + invoice
# ---------------------------------------------------------------------------


def resolve_customer(item):
	"""Return (customer, discount) for a token, creating the customer if needed.

	A token carrying a CompanyId is billed to the company Customer for that id,
	creating it when the id is not mapped yet, and picks up that company's
	discount; one without falls back to a per person Customer keyed on the
	token's Name.

	Raises TokenSkipped when the token deliberately produces no invoice, which
	now only means the token cannot be attributed to any customer at all.
	"""
	company_id = item.get("CompanyId")

	# CompanyId arrives from the API as a string, so "0" has to be ruled out
	# alongside the integer.
	if company_id not in (None, "", 0) and cint(company_id):
		company = get_or_create_company_customer(company_id)

		# The company exists before the person is touched, so the link the
		# person carries always has something to point at.
		ensure_person_customer(item, company)

		# Every token gets its own invoice, including several on the same day for
		# the same company. The company is only who the invoice is billed to; the
		# person the token belongs to is kept on the log's `customer_name`, and
		# the invoice is told apart by its `customer_token` and `medical_service`.
		return company, flt(frappe.db.get_value("Customer", company, "discount"))

	customer_name = (item.get("Name") or "").strip()
	if not customer_name:
		raise TokenSkipped("Token has no customer Name and no CompanyId.")

	existing = frappe.db.get_value("Customer", {"customer_name": customer_name}, "name")
	if existing:
		return existing, 0

	customer = frappe.get_doc(
		{
			"doctype": "Customer",
			"customer_name": customer_name,
			"customer_group": "Default Customer Group",
		}
	)
	customer.insert(ignore_permissions=True)

	return customer.name, 0


def get_or_create_company_customer(company_id):
	"""The company Customer for a token's CompanyId, created if it is unknown.

	`company_id` is passed explicitly on insert, and that is load bearing.
	Customer.before_save only allocates `count + 1` and POSTs to
	`add_customer_url` when the field is empty, so supplying the remote's own id
	both keeps that id and suppresses the outbound push -- which is correct,
	since the remote is where the id came from and already knows this company.

	The token carries no company name, so a new record gets a placeholder to be
	renamed by hand later. Renaming then pushes the real name out through the
	existing update_customer_url path.
	"""
	company_id = cint(company_id)

	name = frappe.db.get_value("Customer", {"company_id": company_id}, "name")
	if name:
		return name

	customer = frappe.get_doc(
		{
			"doctype": "Customer",
			"customer_name": f"Company {company_id}",
			"customer_type": "Company",
			"company_id": company_id,
			"customer_group": "Default Customer Group",
		}
	)

	try:
		customer.insert(ignore_permissions=True)
	except frappe.DuplicateEntryError:
		# Another worker created it between the lookup and the insert.
		frappe.db.rollback()
		name = frappe.db.get_value("Customer", {"company_id": company_id}, "name")
		if not name:
			raise
		return name
	except frappe.ValidationError as error:
		# Usually one of the Company's customer_*_required flags: a placeholder
		# company has no address, mobile or TRN to give. Reported as a skip with
		# the reason rather than a failure, since retrying cannot help until the
		# company is created by hand.
		raise TokenSkipped(
			f"Could not create a customer for CompanyId {company_id}: {error}"
		) from error

	return customer.name


def ensure_person_customer(item, company):
	"""Record the person on a company token as a Customer under that company.

	Never raises. The invoice is billed to the company either way, so a person
	record that cannot be written -- most likely because the Company has one of
	the customer_*_required flags set -- must not cost the site its invoice.

	`customer_type` stays Individual on purpose: marking a patient as a Company
	would make Customer.before_save allocate them a company_id and push them to
	the external token service.
	"""
	customer_name = (item.get("Name") or "").strip()

	if not customer_name or not company:
		return None

	try:
		existing = frappe.db.get_value(
			"Customer", {"customer_name": customer_name}, ["name", "company_customer"], as_dict=True
		)

		if existing:
			# An existing link is left alone: the same name under a different
			# company is more likely two people than a move, and reassigning
			# would make the link flip back and forth between them.
			if not existing.company_customer:
				frappe.db.set_value(
					"Customer", existing.name, "company_customer", company, update_modified=False
				)

			return existing.name

		person = frappe.get_doc(
			{
				"doctype": "Customer",
				"customer_name": customer_name,
				"customer_type": "Individual",
				"company_customer": company,
				"customer_group": "Default Customer Group",
			}
		)
		person.insert(ignore_permissions=True)

		return person.name
	except Exception:
		frappe.log_error(
			message=frappe.get_traceback(),
			title=f"Could not record person customer for {customer_name}",
		)
		return None


def resolve_medical_service(service_name):
	"""The Medical Services title for the value the API sends in `Service`.

	The remote system identifies a service by its *display name*, while Medical
	Services is autonamed on `title`, so the token value usually is not the
	record name at all -- 'MEDICAL-CAT-C-Male-New' is the display name of
	'MED-C-M-001'.

	`display_name` is matched first and `title` second: six of the current
	services carry the same text in both fields, and logs recorded before this
	change stored the title, so the fallback keeps those retryable.
	"""
	if not service_name:
		return None

	return frappe.db.get_value(
		"Medical Services", {"display_name": service_name}, "name"
	) or frappe.db.get_value("Medical Services", {"title": service_name}, "name")


def item_tax(item_code, taxable_amount):
	"""Return (tax name, rate, amount) for one invoice line.

	Read from the Item master, not from the Medical Service's child row. Those
	rows are a snapshot: `get_medical_service_items` only refreshes their tax
	fields when com or gov happens to differ, so a service set up with tax off
	keeps reporting no tax even after the Item is marked taxable. The Item is
	the authority, which is what the invoice import path also uses
	(SalesInvoice.populate_item_details_during_import).

	Nothing recalculates this afterwards: make_taxes_and_totals only runs from
	do_import(), so whatever is set here is what the invoice keeps.
	"""
	item = frappe.db.get_value("Item", item_code, ["tax", "tax_excluded"], as_dict=True)

	# Tax applies only when the Item is not tax excluded and names a Tax.
	if not item or item.tax_excluded or not item.tax:
		return None, 0, 0

	rate = cint(frappe.db.get_value("Tax", item.tax, "tax_rate"))

	# Charged on the service charge only. `rate`/`gross_amount` on the line are
	# the com, so the government fee stays outside the taxable amount.
	return item.tax, rate, flt(taxable_amount) * rate / 100.0


def build_invoice_items(service_name):
	"""Price the service off the Item master and return (rows, gross, tax)."""
	title = resolve_medical_service(service_name)

	if not title:
		raise TokenSkipped(
			f"No Medical Service matches '{service_name}' by display name or title."
		)

	service_doc = get_medical_service_items(title)

	if not service_doc or not service_doc.get("services"):
		raise TokenSkipped(f"Medical Service '{title}' has no items.")

	rows = []
	gross_total = 0
	tax_total = 0

	for service_item in service_doc.services:
		com = flt(service_item.com)
		tax_name, tax_rate, tax_amount = item_tax(service_item.item, com)

		gross_total += com
		tax_total += tax_amount

		rows.append(
			{
				"item": service_item.item,
				"item_name": service_item.item_name,
				"display_name": service_item.item_name,
				"qty": cint(service_item.qty) or 1,
				"rate": com,
				"gross_amount": com,
				# `tax` is a Link to Tax; the old JS coerced an empty value to 0,
				# which is not a valid link target.
				"tax": tax_name,
				"tax_rate": tax_rate,
				"tax_amount": tax_amount,
				"net_amount": com,
				"com": com,
				"gov": flt(service_item.gov),
			}
		)

	return rows, gross_total, tax_total


def token_for_invoice(item, log):
	"""The token number to put on the invoice.

	Taken from the API payload, falling back to the log's copy when the payload
	has no usable value -- which is what the retry path relies on, since it
	replays a stored `api_response`.
	"""
	return token_text(item) or (str(log.token_number).strip() or None if log.token_number else None)


def create_invoice_for_log(log, item):
	"""Create the Sales Invoice for a log and mark it Completed."""
	customer, discount = resolve_customer(item)

	rows, gross_total, tax_total = build_invoice_items(log.service)
	calculated_discount = (gross_total * flt(discount)) / 100

	invoice = frappe.get_doc(
		{
			"doctype": "Sales Invoice",
			"customer": customer,
			"customer_email": item.get("Email"),
			"payment_mode": "Card",
			"customer_token": token_for_invoice(item, log),
			"medical_service": log.service,
			"items": rows,
			"gross_total": gross_total - calculated_discount,
			"tax_total": tax_total,
			"net_total": (gross_total + tax_total) - calculated_discount,
			"net_amount": gross_total - calculated_discount,
			"rounded_total": (gross_total + tax_total) - calculated_discount,
			# `paid_amount` is deliberately not set. SalesInvoice.before_validate
			# owns it: a non credit sale is forced to rounded_total, a credit
			# sale to 0. Passing a value here would be silently discarded, which
			# is exactly what happened to the old arithmetic in the board page.
		}
	)

	# A company billed invoice is raised against the company, so the person the
	# token belongs to would otherwise not appear on it at all.
	if item.get("CompanyId") not in (None, "", 0) and log.customer_name:
		invoice.remarks = log.customer_name

	invoice.insert(ignore_permissions=True)

	log.db_set(
		{
			"status": STATUS_COMPLETED,
			"sales_invoice": invoice.name,
			"customer": customer,
			"error_message": None,
			"attempts": cint(log.attempts) + 1,
		},
		update_modified=False,
	)

	return {
		"sales_invoice": invoice.name,
		"customer": customer,
		"customer_name": log.customer_name,
		"token_number": log.token_number,
		"service": log.service,
	}


# ---------------------------------------------------------------------------
# retry
# ---------------------------------------------------------------------------


def retry_stalled_logs():
	"""Re-attempt logs that were left Pending or Failed by an earlier run.

	Without this a transient failure (API blip, missing Item, locked row) would
	strand a token forever, because the cursor has already moved past it.
	"""
	cutoff = add_days(today(), -RETRY_LOOKBACK_DAYS)

	stalled = frappe.get_all(
		"Medical Service Logs",
		filters={
			"status": ["in", [STATUS_PENDING, STATUS_FAILED]],
			"sales_invoice": ["is", "not set"],
			"added_on": [">=", f"{cutoff} 00:00:00"],
			"attempts": ["<", MAX_ATTEMPTS],
		},
		fields=["name", "api_response", "synced_for_username"],
		order_by="added_on asc",
		limit=50,
	)

	outcomes = []
	for row in stalled:
		try:
			item = json.loads(row.api_response or "{}")
		except (ValueError, TypeError):
			continue

		if not isinstance(item, dict) or not item:
			continue

		with as_user(get_counter_user(row.synced_for_username)):
			outcomes.append(process_token(item, row.synced_for_username))

	return outcomes


# ---------------------------------------------------------------------------
# realtime
# ---------------------------------------------------------------------------


def get_notify_users():
	"""Desk users who should see new-token toasts."""
	users = set()

	if frappe.db.exists("DocType", "Cashier"):
		for user in frappe.get_all("Cashier", filters={"disabled": 0}, pluck="user"):
			if user:
				users.add(user)

	for user in frappe.get_all(
		"Has Role",
		filters={"parenttype": "User", "role": ["in", ["System Manager", "Cashier"]]},
		pluck="parent",
	):
		users.add(user)

	# Only notify users who can actually log in.
	if not users:
		return []

	return frappe.get_all(
		"User",
		filters={"name": ["in", list(users)], "enabled": 1},
		pluck="name",
	)


def notify_invoices_created(invoices):
	"""Push new invoices to every open desk.

	Published per user rather than to the site-wide room so the payload only
	reaches people who are allowed to work the board. Emitted immediately (not
	`after_commit`) because each invoice was already committed by process_token.
	"""
	payload = {"invoices": invoices, "count": len(invoices)}

	for user in get_notify_users():
		frappe.publish_realtime(REALTIME_EVENT, payload, user=user)


# ---------------------------------------------------------------------------
# board data
# ---------------------------------------------------------------------------


@frappe.whitelist()
def get_board_invoices(limit=100):
	"""Draft invoices for the Sales Invoice Board -- the whole counter's, not
	just the caller's.

	`get_all` rather than `get_list` on purpose: it is the same query builder
	with `ignore_permissions=True`, which skips the `permission_query_conditions`
	hook that restricts a Cashier to invoices they own. The board is a shared
	queue, so every desk sees every draft waiting for payment.

	The Sales Invoice *list* is unaffected and stays per cashier: the desk's own
	list path always runs that hook, and nothing there can opt out of it. A
	clicked row still opens, because reading one document never consults the
	hook -- it only filters lists.

	Because permissions are bypassed, the role check below is what keeps this
	method safe; it must not be removed. `only_for` lets Administrator through.
	"""
	frappe.only_for(("System Manager", "Cashier", "Cashier Approver"))

	return frappe.get_all(
		"Sales Invoice",
		fields=["name", "customer", "customer_token", "medical_service", "posting_date", "rounded_total"],
		# Drafts only. The board is the queue of invoices still to be taken.
		filters={"docstatus": 0},
		order_by="creation desc",
		limit_page_length=cint(limit) or 100,
	)
