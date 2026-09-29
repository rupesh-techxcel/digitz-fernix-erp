# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""A stand-in for the external token service, for testing the token sync.

The sync (api/token_sync.py) GETs `Settings.url` from the server with a one-day
window, `?from=<last CreatedDate seen>&to=<day end>`, both in .NET round-trip
form (7 fractional digits), and expects a bare JSON array of tokens. `feed`
answers exactly that from the Test Token doctype, so a tester adds tokens in the
desk and the sync raises Sales Invoices from them as it would from the real one.

The call carries no session (it comes from the scheduler or an inline sync), so
`feed` has to accept guests. It is therefore served only where developer_mode
is on, or where site_config sets "token_simulator_enabled": 1 -- never on a live
site by accident.

Point Settings > Token URL at simulator_url(), or use the Test Token list's
"Use Simulator URL" button, which also remembers the real URL to restore.
"""

import json
import random

import frappe
from frappe.utils import add_to_date, cint, get_datetime, now_datetime
from werkzeug.wrappers import Response

FEED_PATH = "/api/method/digitz_erp.api.token_simulator.feed"

# Settings.url before the simulator took over, so it can be put back
PREVIOUS_URL_KEY = "digitz_token_url_before_simulator"

# Where the live ERP is reached, and so where its own feed is. "host_name" in
# site_config.json overrides it.
PRODUCTION_URL = "http://192.168.85.183"

SAMPLE_NAMES = (
	"AHMED KHAN", "FATIMA ALI", "MOHAMMED RASHID", "AISHA BEGUM", "JOHN MATHEW", "PRIYA NAIR",
	"OMAR FAROOQ", "MARIA SANTOS", "RAVI KUMAR", "SARA HUSSAIN", "ABDUL KAREEM", "LINA HADDAD",
)
SAMPLE_NATIONALITIES = ("INDIA", "PAKISTAN", "PHILIPPINES", "EGYPT", "BANGLADESH", "NEPAL")


def is_enabled():
	return bool(cint(frappe.conf.get("developer_mode")) or cint(frappe.conf.get("token_simulator_enabled")))


def ensure_enabled():
	if not is_enabled():
		frappe.throw(
			"The token simulator is off on this site. It runs only with developer_mode, "
			'or with "token_simulator_enabled": 1 in site_config.json.',
			frappe.PermissionError,
		)


# ---------------------------------------------------------------------------
# the feed the sync calls
# ---------------------------------------------------------------------------


def parse_dotnet(value):
	"""A .NET round-trip timestamp (2026-09-29T10:15:00.1234567) as a datetime, or None."""
	value = (value or "").strip()
	if not value:
		return None
	head, _sep, fraction = value.partition(".")
	try:
		return get_datetime(f"{head}.{fraction[:6]}".replace("T", " ") if fraction else head.replace("T", " "))
	except Exception:
		return None


def format_dotnet(value):
	"""A datetime in the .NET form the sync echoes back as its next `from`."""
	return get_datetime(value).strftime("%Y-%m-%dT%H:%M:%S.%f") + "0"


@frappe.whitelist(allow_guest=True, methods=["GET"])
def feed():
	"""Tokens created after `from` and up to `to`, oldest first, as a bare JSON array.

	`from` is exclusive: the sync passes the CreatedDate of the last token it
	stored, and the real service does not hand that one back again.
	"""
	ensure_enabled()

	start = parse_dotnet(frappe.form_dict.get("from"))
	end = parse_dotnet(frappe.form_dict.get("to"))

	filters = []
	if start:
		filters.append(["created_date", ">", start])
	if end:
		filters.append(["created_date", "<=", end])

	rows = frappe.get_all(
		"Test Token",
		filters=filters,
		fields=["name"],
		order_by="created_date asc, creation asc",
		ignore_permissions=True,
	)
	tokens = [token_payload(frappe.get_doc("Test Token", row.name)) for row in rows]

	return Response(json.dumps(tokens), mimetype="application/json")


def token_payload(token):
	"""A Test Token in the real service's shape and key names."""
	service = frappe.db.get_value("Medical Services", token.service, ["display_name", "title"], as_dict=True) or {}
	return {
		"TokenNumber": token.token_number,
		"UserName": frappe.db.get_value("User", token.cashier, "username") if token.cashier else None,
		"ApplicationNumber": token.application_number or None,
		"Name": token.patient_name,
		"Service": service.get("display_name") or service.get("title") or token.service,
		"CreatedDate": format_dotnet(token.created_date),
		"VisitDate": format_dotnet(token.visit_date) if token.visit_date else None,
		"CompanyId": str(token.company_id) if cint(token.company_id) else None,
		"CustomerId": token.customer_id or None,
		"Email": token.email or None,
		"Mobile": token.mobile or None,
		"WhatsApp": token.whatsapp or None,
		"Gender": token.gender or None,
		"Nationality": token.nationality or None,
		"DOB": str(token.dob) if token.dob else None,
	}


# ---------------------------------------------------------------------------
# desk tools (Test Token list and form)
# ---------------------------------------------------------------------------


def simulator_url():
	"""The URL this site's server can reach the feed at.

	On a bench dev server the request goes to 127.0.0.1 on the webserver port,
	which serves the default site; any other site has to be addressed by its
	own name (which must then resolve, e.g. through /etc/hosts). Elsewhere it is
	the site's "host_name", or the production address. Not the request's host:
	this also runs from migrate, which has no request.
	"""
	port = frappe.conf.get("webserver_port")
	if cint(frappe.conf.get("developer_mode")) and port:
		serves_default = frappe.conf.get("serve_default_site") and frappe.conf.get("default_site") == frappe.local.site
		host = "127.0.0.1" if serves_default else frappe.local.site
		return f"http://{host}:{port}{FEED_PATH}"
	base = (frappe.conf.get("host_name") or PRODUCTION_URL).rstrip("/")
	return f"{base}{FEED_PATH}"


@frappe.whitelist()
def get_status():
	"""What the Test Token list shows about the simulator's wiring."""
	frappe.only_for("System Manager")
	url = simulator_url()
	current = frappe.db.get_single_value("Settings", "url") or ""
	return {
		"enabled": is_enabled(),
		"simulator_url": url,
		"token_url": current,
		"using_simulator": current.strip().endswith(FEED_PATH),
		"previous_url": frappe.db.get_default(PREVIOUS_URL_KEY),
		"sync_enabled": cint(frappe.db.get_single_value("Settings", "token_sync_enabled")),
		"site_by_name": not url.startswith("http://127.0.0.1"),
	}


@frappe.whitelist()
def use_simulator(enable_sync=1):
	"""Point Settings > Token URL at the feed, keeping the real URL to restore."""
	frappe.only_for("System Manager")
	ensure_enabled()

	current = (frappe.db.get_single_value("Settings", "url") or "").strip()
	if current and not current.endswith(FEED_PATH):
		frappe.db.set_default(PREVIOUS_URL_KEY, current)

	frappe.db.set_single_value("Settings", "url", simulator_url())
	if cint(enable_sync):
		frappe.db.set_single_value("Settings", "token_sync_enabled", 1)
	return get_status()


def update_token_url_after_migrate():
	"""Keep Settings > Token URL right for this site after every migrate.

	The simulator's URL names this site's host and port, so it goes stale when a
	database is copied to another site (staging to production, or between
	benches). In order:

	1. "token_url" in site_config.json is the URL this site must use. Production
	   pins its real service there.
	2. A Token URL pointing at a simulator feed is rebuilt for this site when the
	   simulator is allowed here. Where it is not (a live site), the URL saved
	   before the simulator took over is put back; with none saved it is cleared
	   and token sync switched off, so a live site never polls a test feed.
	3. Any other URL is left as it is.
	"""
	pinned = (frappe.conf.get("token_url") or "").strip()
	current = (frappe.db.get_single_value("Settings", "url") or "").strip()

	if pinned:
		new = pinned
	elif not current.endswith(FEED_PATH):
		return
	elif is_enabled():
		new = simulator_url()
	else:
		new = (frappe.db.get_default(PREVIOUS_URL_KEY) or "").strip()
		frappe.db.set_default(PREVIOUS_URL_KEY, "")
		if not new:
			frappe.db.set_single_value("Settings", "token_sync_enabled", 0)

	if new == current:
		return

	frappe.db.set_single_value("Settings", "url", new)
	frappe.db.commit()
	print(f"Token URL: {current or '(empty)'} -> {new or '(empty, token sync turned off)'}")


@frappe.whitelist()
def restore_token_url():
	"""Put back the Token URL that was set before the simulator took over."""
	frappe.only_for("System Manager")
	previous = frappe.db.get_default(PREVIOUS_URL_KEY) or ""
	frappe.db.set_single_value("Settings", "url", previous)
	frappe.db.set_default(PREVIOUS_URL_KEY, "")
	return get_status()


@frappe.whitelist()
def generate_tokens(count=5, cashier=None, company_share=0.3):
	"""Add `count` realistic test tokens dated now, spread over services and cashiers.

	About `company_share` of them go to an existing company customer; the rest
	are walk-ins. A token's cashier is `cashier`, or else one of the enabled
	Cashier-role users that have a username, in turn.
	"""
	frappe.only_for("System Manager")
	ensure_enabled()

	count = min(max(cint(count), 1), 50)
	services = frappe.get_all("Medical Services", pluck="name")
	if not services:
		frappe.throw("Create a Medical Service first: every token names one.")

	if cashier:
		cashiers = [cashier]
	else:
		cashiers = frappe.db.sql_list(
			"""SELECT DISTINCT u.name FROM `tabUser` u
			   JOIN `tabHas Role` r ON r.parent = u.name AND r.parenttype = 'User' AND r.role = 'Cashier'
			   WHERE u.enabled = 1 AND IFNULL(u.username, '') != '' ORDER BY u.name"""
		) or [None]

	companies = frappe.get_all("Customer", filters={"company_id": ["is", "set"]}, pluck="name", limit=200)

	start = now_datetime()
	created = []
	for i in range(count):
		company = random.choice(companies) if companies and random.random() < flt_share(company_share) else None
		token = frappe.get_doc({
			"doctype": "Test Token",
			"patient_name": random.choice(SAMPLE_NAMES),
			"service": random.choice(services),
			"cashier": cashiers[i % len(cashiers)],
			# A millisecond apart, so every token has its own CreatedDate
			"created_date": add_to_date(start, seconds=i / 1000),
			"company": company,
			"gender": random.choice(("MALE", "FEMALE")),
			"nationality": random.choice(SAMPLE_NATIONALITIES),
			"mobile": f"05{random.randint(0, 9)}{random.randint(1000000, 9999999)}",
			"application_number": f"APP{random.randint(100000, 999999)}",
		}).insert()
		created.append(token.name)

	return {"created": created}


def flt_share(value):
	return min(max(float(value or 0), 0), 1)


@frappe.whitelist()
def get_token_result(name):
	"""The Medical Service Log and invoice the sync made from a Test Token, if any.

	Found by the sync's own idempotency key over the payload the feed serves.
	"""
	from digitz_erp.api.token_sync import make_token_key

	frappe.only_for("System Manager")
	payload = token_payload(frappe.get_doc("Test Token", name))
	log = frappe.db.get_value(
		"Medical Service Logs",
		{"token_key": make_token_key(payload)},
		["name", "status", "sales_invoice", "error_message"],
		as_dict=True,
	)
	return {"payload": payload, "log": log}
