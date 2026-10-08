# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""Recognise which counter PC a request comes from.

Browsers cannot read a hardware id and the LAN has no fixed IPs, so each counter PC
is given a number by the system instead. Registering a PC creates a Counter Device
(DEV-0007) tied to a Counter and a long random secret. The secret lives in that
PC's browser -- as a long-lived HttpOnly cookie, sent with every request, and as a
localStorage copy the desk script uses to restore the cookie if it is lost. The
server keeps only its SHA-256 hash, so the database alone cannot be used to
impersonate a PC.

Every request is then resolved from the cookie (get_request_device), which is what
the Sales Invoice stamps and checks. Untick Enabled on the Counter Device (or on its
Counter) to revoke it; that browser then counts as unregistered.

A PC is registered in one of two ways:

- A supervisor, on the PC, registers it (register_device), to an existing counter
  or to a new one created on the spot.
- A cashier, on the PC, asks for it (request_device). A request for a counter with
  no PC is approved at once. A request for a counter that already has a PC would
  take it over, so it waits, Pending, until a supervisor approves or rejects it
  (approve_device_request / reject_device_request) from the counter badge.

A counter has one enabled device at a time. Registering or approving a device for
a counter disables the counter's other devices (and whatever the browser was
before), recording who did it and which device replaced them.

Registration and the cashier's day (counter_session_api) are independent. A day
belongs to a cashier and a counter, not a PC, so a day left open on a replaced
device carries on on whichever PC is now that counter's device. Registering is
never blocked by an open day; the dialogs only warn about it.
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
# Sent to every desk when a request is made or decided, so badges update at once
REALTIME_EVENT = "digitz_counter_devices"

SUPERVISOR_ROLES = ("System Manager", "Management")


def hash_secret(secret):
	return hashlib.sha256(secret.encode()).hexdigest()


def is_supervisor(user=None):
	"""May register devices: System Manager, Management, or a Cashier marked supervisor."""
	user = user or frappe.session.user
	if user == "Administrator" or set(SUPERVISOR_ROLES) & set(frappe.get_roles(user)):
		return True
	return bool(frappe.db.get_value("Cashier", {"user": user, "disabled": 0}, "is_supervisor"))


def check_supervisor():
	if not is_supervisor():
		frappe.throw("Only a supervisor can do this.", frappe.PermissionError)


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


def get_pending_for_secret(secret):
	"""{device, counter, registered_on} of this browser's request still Pending, else None."""
	if not secret:
		return None
	return frappe.db.get_value(
		"Counter Device",
		{"secret_hash": hash_secret(secret), "approval_status": "Pending"},
		["name as device", "counter", "registered_on"],
		as_dict=True,
	)


def request_secret():
	request = getattr(frappe.local, "request", None)
	return request.cookies.get(COOKIE) if request else None


def get_request_device():
	"""The counter device this request comes from, from its cookie, or None.

	None outside a web request (scheduler, console), so background jobs such as
	the token sync are never treated as a counter.
	"""
	if not getattr(frappe.local, "request", None):
		return None

	device = get_device_for_secret(request_secret())
	if device:
		touch_last_seen(device.device)
	return device


def get_request_registration():
	"""This browser's request when it is not (or no longer) a working device:
	{device, counter, approval_status} while Pending or after it was Rejected, else None."""
	secret = request_secret()
	if not secret:
		return None
	return frappe.db.get_value(
		"Counter Device",
		{"secret_hash": hash_secret(secret), "approval_status": ["in", ["Pending", "Rejected"]]},
		["name as device", "counter", "approval_status"],
		as_dict=True,
	)


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


def lock_counter(counter):
	"""Hold the counter row until commit, so two PCs cannot take one counter at once."""
	frappe.db.sql("SELECT name FROM `tabCounter` WHERE name = %s FOR UPDATE", (counter,))


def get_active_device(counter):
	return frappe.db.get_value("Counter Device", {"counter": counter, "enabled": 1}, "name")


def open_session_on(device):
	"""{open_session, cashier_name} for a day still Open that was opened from `device`."""
	session = frappe.db.get_value(
		"Counter Session",
		{"counter_device": device, "docstatus": 0, "status": "Open"},
		["name", "cashier"],
		as_dict=True,
	)
	return {
		"open_session": session.name if session else None,
		"cashier_name": frappe.utils.get_fullname(session.cashier) if session else None,
	}


def notify_devices_changed():
	frappe.publish_realtime(REALTIME_EVENT, {}, after_commit=True)


def get_replaced_devices(counter):
	"""The enabled devices registering this browser to `counter` disables.

	[{device, counter, last_seen, user_agent, open_session, cashier_name}]: the
	counter's other devices, and the device this browser is now if it is on another
	counter. `open_session` is a day still Open that was opened from that device,
	for the dialog's warning: the day itself is not touched.
	"""
	current = get_request_device()
	rows = frappe.db.sql(
		"""
		SELECT name AS device, counter, last_seen, user_agent
		FROM `tabCounter Device`
		WHERE enabled = 1 AND (counter = %(counter)s OR name = %(current)s)
		ORDER BY name
		""",
		{"counter": counter, "current": current.device if current else ""},
		as_dict=True,
	)
	for row in rows:
		# This browser's own device on the same counter: nothing changes for its
		# day, so there is nothing to warn about
		if current and row.device == current.device and row.counter == counter:
			row.update(open_session=None, cashier_name=None)
		else:
			row.update(open_session_on(row.device))
	return rows


def disable_device(name, replaced_by=None):
	"""Disable a device through its document, so its history shows who and when."""
	doc = frappe.get_doc("Counter Device", name)
	if not doc.enabled:
		return
	doc.enabled = 0
	doc.disabled_by = frappe.session.user
	doc.disabled_on = now_datetime()
	doc.replaced_by = replaced_by
	doc.flags.ignore_permissions = True
	doc.save()


def take_over_counter(doc):
	"""Make `doc` (saved, not yet enabled) the counter's one enabled device."""
	for name in frappe.get_all(
		"Counter Device", filters={"counter": doc.counter, "enabled": 1, "name": ["!=", doc.name]}, pluck="name"
	):
		disable_device(name, replaced_by=doc.name)
	doc.enabled = 1
	doc.flags.ignore_permissions = True
	doc.save()


def reject_own_pending(secret, reason):
	"""Withdraw a request still Pending from this browser, superseded by a newer step."""
	pending = get_pending_for_secret(secret)
	if pending:
		frappe.db.set_value("Counter Device", pending.device, {
			"approval_status": "Rejected",
			"reviewed_on": now_datetime(),
		})
		frappe.get_doc("Counter Device", pending.device).add_comment("Info", reason)


def new_device(counter, secret, **fields):
	request = getattr(frappe.local, "request", None)
	doc = frappe.get_doc({
		"doctype": "Counter Device",
		"counter": counter,
		"enabled": 0,
		"secret_hash": hash_secret(secret),
		"registered_by": frappe.session.user,
		"registered_on": now_datetime(),
		"last_seen": now_datetime(),
		"user_agent": request.headers.get("User-Agent") if request else None,
		**fields,
	})
	doc.insert(ignore_permissions=True)
	return doc


def create_counter(name):
	name = (name or "").strip()
	if not name:
		frappe.throw("Give the new counter a name.")
	if frappe.db.exists("Counter", name):
		frappe.throw(f"{name} already exists. Choose it from the list instead.")
	frappe.get_doc({"doctype": "Counter", "counter_name": name, "enabled": 1}).insert(ignore_permissions=True)
	return name


@frappe.whitelist()
def get_registration_preview(counter):
	"""What registering this browser to `counter` would disable, for the dialog."""
	check_supervisor()
	return get_replaced_devices(counter)


@frappe.whitelist()
def register_device(counter=None, new_counter=None):
	"""Register the browser making this request as the PC of `counter`, or of a
	counter created now and named `new_counter`.

	Returns the secret once; the desk script keeps a copy in localStorage. The
	counter's other devices, and what this browser was before, are disabled. A day
	open on one of them is left as it is: its cashier carries on on this counter's
	new device, or closes it from any PC.
	"""
	check_supervisor()

	if new_counter:
		counter = create_counter(new_counter)
	elif not frappe.db.get_value("Counter", counter, "enabled"):
		frappe.throw(f"Counter {counter} does not exist or is disabled.")

	lock_counter(counter)
	current = get_request_device()
	reject_own_pending(request_secret(), "Withdrawn: a supervisor registered this PC instead.")

	secret = secrets.token_urlsafe(32)
	doc = new_device(counter, secret)
	if current and current.counter != counter:
		disable_device(current.device, replaced_by=doc.name)
	take_over_counter(doc)

	set_device_cookie(secret)
	notify_devices_changed()
	return {
		"device": doc.name,
		"counter": counter,
		"secret": secret,
		"disabled": frappe.get_all("Counter Device", filters={"replaced_by": doc.name}, pluck="name"),
	}


@frappe.whitelist()
def get_request_options():
	"""The counters a cashier may ask for, each with the PC it has now (if any)."""
	rows = frappe.get_all("Counter", filters={"enabled": 1}, pluck="name", order_by="name")
	return [{"counter": counter, "device": get_active_device(counter)} for counter in rows]


@frappe.whitelist()
def request_device(counter):
	"""A cashier asks for the browser making this request to be `counter`'s PC.

	A counter with no PC is the cashier's at once. A counter that has one would be
	taken over, so the request waits for a supervisor. Either way the browser gets
	its secret now; it identifies the PC only once the request is approved.
	"""
	if "Cashier" not in frappe.get_roles() and not is_supervisor():
		frappe.throw("Only a cashier can ask for this PC to be registered.", frappe.PermissionError)

	if not frappe.db.get_value("Counter", counter, "enabled"):
		frappe.throw(f"Counter {counter} does not exist or is disabled.")

	if get_request_device():
		frappe.throw("This PC is already registered. Ask a supervisor to move it to another counter.")

	lock_counter(counter)
	reject_own_pending(request_secret(), "Withdrawn: a newer request was made from this PC.")

	secret = secrets.token_urlsafe(32)
	takeover = get_active_device(counter)
	doc = new_device(
		counter, secret, requested_by=frappe.session.user, approval_status="Pending" if takeover else "Approved"
	)
	if not takeover:
		take_over_counter(doc)
		doc.add_comment("Info", f"Approved automatically: {counter} had no PC.")

	set_device_cookie(secret)
	notify_devices_changed()
	return {
		"device": doc.name,
		"counter": counter,
		"secret": secret,
		"status": doc.approval_status,
		"replaces": takeover,
	}


@frappe.whitelist()
def get_device_requests():
	"""Requests waiting for a supervisor: each with the PC it would take over."""
	check_supervisor()
	rows = frappe.get_all(
		"Counter Device",
		filters={"approval_status": "Pending"},
		fields=["name as device", "counter", "requested_by", "registered_on", "user_agent"],
		order_by="registered_on",
	)
	for row in rows:
		row.requested_by_name = frappe.utils.get_fullname(row.requested_by)
		row.replaces = get_active_device(row.counter)
		row.update(open_session_on(row.replaces) if row.replaces else {"open_session": None, "cashier_name": None})
	return rows


def get_pending_request_doc(device):
	check_supervisor()
	doc = frappe.get_doc("Counter Device", device)
	if doc.approval_status != "Pending":
		frappe.throw(f"{device} is not waiting for approval (it is {doc.approval_status}).")
	return doc


@frappe.whitelist()
def approve_device_request(device):
	"""Make a requested device its counter's PC, disabling the PC it replaces."""
	doc = get_pending_request_doc(device)
	lock_counter(doc.counter)
	if not frappe.db.get_value("Counter", doc.counter, "enabled"):
		frappe.throw(f"Counter {doc.counter} is disabled.")

	doc.approval_status = "Approved"
	doc.reviewed_by = frappe.session.user
	doc.reviewed_on = now_datetime()
	take_over_counter(doc)

	notify_devices_changed()
	return {"device": doc.name, "counter": doc.counter}


@frappe.whitelist()
def reject_device_request(device, reason=None):
	doc = get_pending_request_doc(device)
	doc.approval_status = "Rejected"
	doc.reviewed_by = frappe.session.user
	doc.reviewed_on = now_datetime()
	doc.flags.ignore_permissions = True
	doc.save()
	if (reason or "").strip():
		doc.add_comment("Comment", f"Rejected: {reason.strip()}")

	notify_devices_changed()
	return {"device": doc.name}


@frappe.whitelist()
def resolve_device(secret=None):
	"""Which counter this browser is, for the navbar badge.

	The cookie is the source of truth. `secret` is the desk script's localStorage
	copy: when the cookie was lost but that copy is still valid (as a device or as
	a request still waiting), the cookie is restored from it.
	"""
	cookie_secret = request_secret()

	device = get_device_for_secret(cookie_secret)
	if not device and secret and secret != cookie_secret:
		if get_device_for_secret(secret) or get_pending_for_secret(secret):
			set_device_cookie(secret)
			device = get_device_for_secret(secret)

	supervisor = is_supervisor()
	result = {
		"device": device.device if device else None,
		"counter": device.counter if device else None,
		"can_register": supervisor,
	}
	if supervisor:
		result["counters"] = frappe.get_all("Counter", filters={"enabled": 1}, pluck="name", order_by="name")
	return result
