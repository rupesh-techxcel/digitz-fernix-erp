# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""Server side sync of medical tokens into Sales Invoices.

This replaces the browser driven loop that used to live in the Sales Invoice
Board page. A cron job pulls new tokens for every enabled Cashier, records each
one in Medical Service Logs and raises the matching Sales Invoice, then pushes a
realtime event so open desks update without polling.

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

from digitz_erp.api.medical_services import get_medical_service_items

REALTIME_EVENT = "digitz_token_invoice_created"
SYNC_JOB_ID = "digitz_erp::medical_token_sync"
REQUEST_TIMEOUT = 30
RETRY_LOOKBACK_DAYS = 2
MAX_ATTEMPTS = 5
DEFAULT_TAX_RATE = 5

STATUS_PENDING = "Pending"
STATUS_COMPLETED = "Completed"
STATUS_SKIPPED = "Skipped"
STATUS_FAILED = "Failed"


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
	"""Manual 'Sync now' trigger from the Sales Invoice Board."""
	frappe.only_for(("System Manager", "Cashier"))

	if not is_sync_enabled():
		frappe.throw(_("Token sync is disabled in Settings."))

	frappe.enqueue(
		"digitz_erp.api.token_sync.sync_medical_tokens",
		queue="long",
		job_id=SYNC_JOB_ID,
		deduplicate=True,
		timeout=600,
	)

	return {"queued": True}


def sync_medical_tokens():
	"""Pull new tokens for every enabled Cashier, then retry past failures."""
	if not is_sync_enabled():
		return

	url = get_token_url()
	if not url:
		frappe.log_error(
			message="Settings.url is empty, cannot fetch medical tokens.",
			title="Medical token sync",
		)
		return

	created = []

	for username in get_sync_usernames():
		try:
			created.extend(sync_for_username(url, username))
		except Exception:
			# One desk failing must not stop the others.
			frappe.db.rollback()
			frappe.log_error(
				message=frappe.get_traceback(),
				title=f"Medical token sync failed for {username}",
			)

	created.extend(retry_stalled_logs())

	if created:
		notify_invoices_created(created)


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
	"""Usernames to poll, one per enabled Cashier.

	The remote API is scoped by `username`, so each reception desk has its own
	token stream. Previously this came from `frappe.session.user` in whichever
	browser happened to have the board open; on the server we enumerate the
	Cashier records instead so the sync no longer depends on who is logged in.
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


def get_cursor(username):
	"""Return the (timestamp, last_token_no) watermark for a desk.

	Token numbers restart each day, so the watermark is scoped to today and
	falls back to midnight/0 at the start of a new day. The timestamp is taken
	from the raw `api_response` where possible so we hand the API back exactly
	the value it gave us, rather than a value round-tripped through MariaDB.
	"""
	day_start = f"{today()} 00:00:00"
	day_end = f"{today()} 23:59:59.999999"

	last = frappe.db.get_value(
		"Medical Service Logs",
		{
			"synced_for_username": username,
			"added_on": ["between", [day_start, day_end]],
		},
		["created_date", "token_number", "api_response"],
		order_by="created_date desc, token_number desc",
		as_dict=True,
	)

	if not last:
		return f"{today()}T00:00:00.0000000", 0

	return (
		extract_created_date(last.api_response) or format_dotnet_datetime(last.created_date),
		cint(last.token_number),
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
		return f"{today()}T00:00:00.0000000"

	value = get_datetime(value)
	# Frappe stores datetime(6); pad the missing 7th digit of .NET ticks.
	return value.strftime("%Y-%m-%dT%H:%M:%S.%f") + "0"


def fetch_tokens(url, username, timestamp, last_token_no):
	response = requests.get(
		url,
		params={
			"username": username,
			"timestamp": timestamp,
			"last_token_no": last_token_no,
		},
		timeout=REQUEST_TIMEOUT,
	)
	response.raise_for_status()

	body = response.json()

	# The real (.NET) service returns a bare array. A Frappe hosted stand-in,
	# such as the simulator in api/test_token_api.py, wraps whitelisted return
	# values in {"message": [...]}, so accept either shape.
	if isinstance(body, dict) and "message" in body:
		body = body["message"]

	if not isinstance(body, list):
		frappe.log_error(
			message=f"Expected a list of tokens for {username}, got {type(body).__name__}.",
			title="Medical token sync",
		)
		return []

	return body


def sync_for_username(url, username):
	timestamp, last_token_no = get_cursor(username)
	tokens = fetch_tokens(url, username, timestamp, last_token_no)

	created = []
	counter_user = get_counter_user(username)

	with as_user(counter_user):
		for item in tokens:
			if not isinstance(item, dict):
				continue

			invoice = process_token(item, username)
			if invoice:
				created.append(invoice)

	return created


# ---------------------------------------------------------------------------
# per token processing
# ---------------------------------------------------------------------------


def process_token(item, username):
	"""Record one token and raise its invoice. Commits or rolls back on its own."""
	try:
		log = get_or_create_log(item, username)

		# Completed is authoritative on its own: legacy rows migrated by the
		# backfill patch may be Completed without a `sales_invoice` link, and
		# must not be re-invoiced if the API ever replays the token.
		if log.status == STATUS_COMPLETED:
			frappe.db.commit()
			return None

		invoice = create_invoice_for_log(log, item)
		frappe.db.commit()
		return invoice
	except TokenSkipped as skip:
		frappe.db.rollback()
		mark_log(item, username, STATUS_SKIPPED, str(skip))
		return None
	except Exception:
		frappe.db.rollback()
		frappe.log_error(
			message=frappe.get_traceback(),
			title=f"Medical token {item.get('TokenNumber')} failed",
		)
		mark_log(item, username, STATUS_FAILED, frappe.get_traceback(with_context=False)[-1000:])
		return None


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
			"token_number": cint(item.get("TokenNumber")),
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
	"""Record the outcome of a token on its log, in its own transaction."""
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
					"token_number": cint(item.get("TokenNumber")),
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
	except Exception:
		frappe.db.rollback()
		frappe.log_error(
			message=frappe.get_traceback(),
			title="Could not record medical token outcome",
		)


# ---------------------------------------------------------------------------
# customer + invoice
# ---------------------------------------------------------------------------


def resolve_customer(item):
	"""Return (customer, discount) for a token, creating the customer if needed.

	Raises TokenSkipped when the token deliberately produces no invoice.
	"""
	company_id = item.get("CompanyId")

	if company_id not in (None, "", 0):
		customer = frappe.db.get_value(
			"Customer",
			{"company_id": cint(company_id)},
			["name", "discount"],
			as_dict=True,
		)

		if not customer:
			raise TokenSkipped(f"No Customer is mapped to CompanyId {company_id}.")

		# One invoice per company customer per day.
		existing = frappe.db.get_value(
			"Sales Invoice",
			{"customer": customer.name, "posting_date": today()},
			"name",
		)
		if existing:
			raise TokenSkipped(
				f"Company customer {customer.name} already has invoice {existing} today."
			)

		return customer.name, flt(customer.discount)

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


def build_invoice_items(service_name):
	"""Price the service off the Item master and return (rows, gross, tax)."""
	service_doc = get_medical_service_items(service_name)

	if not service_doc or not service_doc.get("services"):
		raise TokenSkipped(f"Medical Service '{service_name}' has no items or does not exist.")

	rows = []
	gross_total = 0
	tax_total = 0

	for service_item in service_doc.services:
		com = flt(service_item.com)
		gross_total += com
		tax_total += flt(service_item.tax_amount)

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
				"tax": service_item.tax or None,
				"tax_rate": 0 if service_item.tax_excluded else DEFAULT_TAX_RATE,
				"tax_amount": flt(service_item.tax_amount),
				"net_amount": com,
				"com": com,
				"gov": flt(service_item.gov),
			}
		)

	return rows, gross_total, tax_total


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
			"customer_token": log.token_number,
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

	created = []
	for row in stalled:
		try:
			item = json.loads(row.api_response or "{}")
		except (ValueError, TypeError):
			continue

		if not isinstance(item, dict) or not item:
			continue

		with as_user(get_counter_user(row.synced_for_username)):
			invoice = process_token(item, row.synced_for_username)

		if invoice:
			created.append(invoice)

	return created


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
	"""Draft invoices for the Sales Invoice Board.

	Returned through a whitelisted method rather than `frappe.client.get_list`
	so the board gets exactly the fields it needs and the permission query on
	Sales Invoice still applies.
	"""
	return frappe.get_list(
		"Sales Invoice",
		fields=["name", "customer", "customer_token", "medical_service", "posting_date", "rounded_total"],
		filters={"docstatus": 0},
		order_by="creation desc",
		limit_page_length=cint(limit) or 100,
	)
