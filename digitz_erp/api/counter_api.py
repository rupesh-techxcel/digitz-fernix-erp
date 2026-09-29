# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""Recognise which counter PC a request comes from.

Browsers cannot read a hardware id and the LAN has no fixed IPs, so each counter PC
is given a number by the system instead. A supervisor registers the PC once
(register_device): that creates a Counter Device (DEV-0007) tied to a Counter and a
long random secret. The secret lives in that PC's browser -- as a long-lived
HttpOnly cookie, sent with every request, and as a localStorage copy the desk
script uses to restore the cookie if it is lost. The server keeps only its SHA-256
hash, so the database alone cannot be used to impersonate a PC.

Every request is then resolved from the cookie (get_request_device), which is what
the Sales Invoice stamps and checks. Untick Enabled on the Counter Device (or on its
Counter) to revoke it; that browser then counts as unregistered.
"""

import hashlib
import secrets

import frappe
from frappe.utils import add_to_date, now_datetime

COOKIE = "digitz_device"
# How long the browser keeps the cookie: effectively for good
COOKIE_YEARS = 10
# How often last_seen is written for a device, at most
LAST_SEEN_EVERY_MIN = 10

SUPERVISOR_ROLES = ("System Manager", "Management")


def hash_secret(secret):
	return hashlib.sha256(secret.encode()).hexdigest()


def is_supervisor(user=None):
	"""May register devices: System Manager, Management, or a Cashier marked supervisor."""
	user = user or frappe.session.user
	if user == "Administrator" or set(SUPERVISOR_ROLES) & set(frappe.get_roles(user)):
		return True
	return bool(frappe.db.get_value("Cashier", {"user": user, "disabled": 0}, "is_supervisor"))


def get_device_for_secret(secret):
	"""{device, counter} for an enabled device on an enabled counter, else None."""
	if not secret:
		return None

	row = frappe.db.sql(
		"""
		SELECT d.name AS device, d.counter
		FROM `tabCounter Device` d
		INNER JOIN `tabCounter` c ON c.name = d.counter
		WHERE d.secret_hash = %s AND d.enabled = 1 AND c.enabled = 1
		LIMIT 1
		""",
		(hash_secret(secret),),
		as_dict=True,
	)
	return row[0] if row else None


def get_request_device():
	"""The counter device this request comes from, from its cookie, or None.

	None outside a web request (scheduler, console), so background jobs such as
	the token sync are never treated as a counter.
	"""
	request = getattr(frappe.local, "request", None)
	if not request:
		return None

	device = get_device_for_secret(request.cookies.get(COOKIE))
	if device:
		touch_last_seen(device.device)
	return device


def touch_last_seen(device):
	key = f"digitz_counter_device_seen:{device}"
	if frappe.cache.get_value(key):
		return
	frappe.db.set_value("Counter Device", device, "last_seen", now_datetime(), update_modified=False)
	frappe.cache.set_value(key, 1, expires_in_sec=LAST_SEEN_EVERY_MIN * 60)


def set_device_cookie(secret):
	frappe.local.cookie_manager.set_cookie(
		COOKIE, secret, expires=add_to_date(now_datetime(), years=COOKIE_YEARS), httponly=True
	)


@frappe.whitelist()
def register_device(counter):
	"""Register the browser making this request as a PC of `counter`.

	Returns the secret once; the desk script keeps a copy in localStorage. Anything
	this browser was registered as before is superseded, not revoked: the old
	Counter Device stays until someone disables it.
	"""
	if not is_supervisor():
		frappe.throw("Only a supervisor can register a device as a counter.", frappe.PermissionError)

	if not frappe.db.get_value("Counter", counter, "enabled"):
		frappe.throw(f"Counter {counter} does not exist or is disabled.")

	secret = secrets.token_urlsafe(32)
	request = getattr(frappe.local, "request", None)

	device = frappe.get_doc({
		"doctype": "Counter Device",
		"counter": counter,
		"enabled": 1,
		"secret_hash": hash_secret(secret),
		"registered_by": frappe.session.user,
		"registered_on": now_datetime(),
		"last_seen": now_datetime(),
		"user_agent": request.headers.get("User-Agent") if request else None,
	}).insert(ignore_permissions=True)

	set_device_cookie(secret)
	return {"device": device.name, "counter": counter, "secret": secret}


@frappe.whitelist()
def resolve_device(secret=None):
	"""Which counter this browser is, for the navbar badge.

	The cookie is the source of truth. `secret` is the desk script's localStorage
	copy: when the cookie was lost but that copy is still valid, the cookie is
	restored from it.
	"""
	request = getattr(frappe.local, "request", None)
	cookie_secret = request.cookies.get(COOKIE) if request else None

	device = get_device_for_secret(cookie_secret)
	if not device and secret:
		device = get_device_for_secret(secret)
		if device:
			set_device_cookie(secret)

	supervisor = is_supervisor()
	result = {
		"device": device.device if device else None,
		"counter": device.counter if device else None,
		"can_register": supervisor,
	}
	if supervisor:
		result["counters"] = frappe.get_all("Counter", filters={"enabled": 1}, pluck="name", order_by="name")
	return result
