# digitz_erp/api/test_token_api.py
#
# Simulator for the external medical token service.
#
# `Settings.url` points at `mock_tokens` on a dev site, so this stands in for
# the real endpoint that the cron job in digitz_erp/api/token_sync.py polls. It
# is deliberately faithful to the real contract:
#
#   * it honours the `timestamp` / `last_token_no` watermark, returning only
#     tokens newer than what the caller has already seen, so the cursor logic is
#     genuinely exercised rather than bypassed;
#   * it returns the same field names and the same .NET style 7 digit timestamp;
#   * queued tokens are NOT drained on read, exactly like the real service,
#     which means idempotency is exercised too.
#
# Queue tokens with `queue_mock_tokens`, then either wait for the cron or call
# `simulate_tokens` to queue and sync in one step.

import random
from datetime import datetime, timedelta

import frappe
from frappe.utils import cint, now_datetime, today

CACHE_KEY = "digitz_mock_tokens"

SAMPLE_NAMES = [
	"MUHAMMAD YASEEN",
	"ANJALI RAMESH",
	"JOHN OKONKWO",
	"PRIYA NAIR",
	"AHMED AL BALUSHI",
	"MARIA SANTOS",
	"RAVI KUMAR",
	"FATIMA ZAHRA",
]


# ---------------------------------------------------------------------------
# the endpoint Settings.url points at
# ---------------------------------------------------------------------------


@frappe.whitelist(allow_guest=True)
def mock_tokens(username=None, last_token_no=None):
	"""Stand-in for the real token service.

	Returns queued tokens inside the caller's [from, to] window, oldest first,
	mirroring how the real API pages forward.

	`from` is a Python keyword and `to` is not in this signature, so both are
	read off form_dict rather than declared as parameters.
	"""
	from_time = frappe.form_dict.get("from")
	to_time = frappe.form_dict.get("to")

	tokens = get_queue()
	last_token_no = cint(last_token_no)

	fresh = [
		t
		for t in tokens
		if is_for_desk(t, username)
		and is_after_watermark(t, from_time, last_token_no)
		and is_before_end(t, to_time)
	]
	fresh.sort(key=lambda t: (t["CreatedDate"], t["TokenNumber"]))

	return fresh


def is_for_desk(token, username):
	"""The real service scopes tokens by username; keep that behaviour here."""
	if not username:
		return True

	token_user = token.get("UserName")
	if not token_user:
		return True

	return str(token_user).lower() == str(username).lower()


def is_after_watermark(token, from_time, last_token_no):
	"""Same ordering the sync assumes: created date first, then token number."""
	if not from_time:
		return True

	created = token.get("CreatedDate") or ""

	if created > from_time:
		return True

	if created == from_time:
		return cint(token.get("TokenNumber")) > last_token_no

	return False


def is_before_end(token, to_time):
	"""Upper bound of the window; inclusive, as the end-of-day value implies."""
	if not to_time:
		return True

	return (token.get("CreatedDate") or "") <= to_time


# ---------------------------------------------------------------------------
# seeding
# ---------------------------------------------------------------------------


@frappe.whitelist()
def queue_mock_tokens(count=3, service=None, company_id=None, customer_name=None, email=None):
	"""Queue `count` tokens for the sync to pick up on its next run.

	:param service: Medical Services title. Defaults to a random service that
		actually has items, since one with an empty table is Skipped by design.
	:param company_id: set this to exercise the company customer path
		(existing customer, its discount, one invoice per day).
	:param customer_name: force a specific customer name instead of a random one.
	"""
	frappe.only_for("System Manager")

	count = max(1, cint(count) or 1)
	services = [service] if service else get_services_with_items()

	if not services:
		frappe.throw("No Medical Services with items exist, so no token can produce an invoice.")

	queue = get_queue()
	next_token = get_next_token_number(queue)
	# Space tokens a few seconds apart so their order is unambiguous.
	base_time = now_datetime()

	created = []
	for index in range(count):
		token = {
			"TokenNumber": next_token + index,
			"UserName": get_sync_username(),
			"ApplicationNumber": make_application_number(),
			"Nationality": None,
			"DOB": None,
			"Gender": random.choice(["MALE", "FEMALE"]),
			"Mobile": f"05{random.randint(10000000, 49999999)}",
			"Name": customer_name or random.choice(SAMPLE_NAMES),
			"Service": random.choice(services),
			"CreatedDate": to_dotnet(base_time + timedelta(seconds=index * 5)),
			"VisitDate": to_dotnet(base_time + timedelta(seconds=index * 5)),
			"CustomerId": None,
			"CompanyId": cint(company_id) if company_id else None,
			"Email": email,
			"WhatsApp": None,
		}
		queue.append(token)
		created.append(token)

	set_queue(queue)

	return {"queued": len(created), "tokens": created, "queue_size": len(queue)}


@frappe.whitelist()
def simulate_tokens(count=3, service=None, company_id=None, customer_name=None, email=None):
	"""Queue tokens and run the sync immediately, instead of waiting for cron."""
	frappe.only_for("System Manager")

	from digitz_erp.api.token_sync import sync_medical_tokens

	result = queue_mock_tokens(
		count=count,
		service=service,
		company_id=company_id,
		customer_name=customer_name,
		email=email,
	)

	# The sync reads the queue over HTTP, so it must see the committed value.
	frappe.db.commit()
	sync_medical_tokens()

	result["logs"] = frappe.get_all(
		"Medical Service Logs",
		filters={"token_number": ["in", [t["TokenNumber"] for t in result["tokens"]]]},
		fields=["name", "token_number", "customer_name", "service", "status", "sales_invoice", "error_message"],
		order_by="token_number asc",
	)

	return result


# ---------------------------------------------------------------------------
# queue management
# ---------------------------------------------------------------------------


@frappe.whitelist()
def list_mock_tokens():
	"""Inspect what is currently queued."""
	frappe.only_for("System Manager")
	return get_queue()


@frappe.whitelist()
def clear_mock_tokens():
	"""Empty the queue. The logs and invoices already created are untouched."""
	frappe.only_for("System Manager")

	size = len(get_queue())
	set_queue([])

	return {"cleared": size}


def get_queue():
	return frappe.cache().get_value(CACHE_KEY) or []


def set_queue(tokens):
	frappe.cache().set_value(CACHE_KEY, tokens)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def get_services_with_items():
	"""Display names of the services that can actually produce an invoice.

	Display names, not titles: the real service identifies a service by its
	display name in the token's `Service` field, and token_sync resolves that
	back to the record. Queueing titles here would exercise only the fallback
	path and hide a broken lookup.

	Only services with a populated items table qualify -- one with an empty
	table is Skipped by design.
	"""
	parents = frappe.get_all(
		"Service Items",
		filters={"parenttype": "Medical Services"},
		distinct=True,
		pluck="parent",
	)

	names = []
	for parent in parents:
		display_name = frappe.db.get_value("Medical Services", parent, "display_name")
		names.append(display_name or parent)

	return names


def get_next_token_number(queue):
	"""Continue today's numbering, across both the queue and existing logs."""
	queued_max = max((cint(t.get("TokenNumber")) for t in queue), default=0)

	logged_max = (
		frappe.db.get_value(
			"Medical Service Logs",
			{"added_on": ["between", [f"{today()} 00:00:00", f"{today()} 23:59:59.999999"]]},
			"max(token_number)",
		)
		or 0
	)

	return max(queued_max, cint(logged_max)) + 1


def get_sync_username():
	"""Mirror the username the sync will actually poll with."""
	from digitz_erp.api.token_sync import get_sync_usernames

	usernames = get_sync_usernames()
	return usernames[0] if usernames else "administrator"


def make_application_number():
	alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	return "".join(random.choice(alphabet) for _ in range(14))


def to_dotnet(value: datetime):
	"""Format as the real service does: ISO with a 7 digit fraction."""
	return value.strftime("%Y-%m-%dT%H:%M:%S.%f") + "0"
