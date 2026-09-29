# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""One login at a time for counter staff.

System Settings "Allow only one session per user" makes Frappe end a user's older
sessions when they log in again, keeping as many as the user's "Simultaneous
Sessions". Cashiers get 1, so a cashier is only ever signed in on one browser: a
new login elsewhere ends the old one ("Logged In From Another Session"). Staff who
also hold a supervisor role keep what they have.
"""

import frappe

# A user with any of these is not restricted to one session
EXEMPT_ROLES = ("System Manager", "Management", "Administrator")


def is_single_session_user(roles):
	return "Cashier" in roles and not set(EXEMPT_ROLES) & set(roles)


def enforce_on_user(doc, method=None):
	"""User.validate: hold cashiers to one session, as they are created or given the role."""
	if doc.name == "Administrator":
		return
	if is_single_session_user([r.role for r in doc.get("roles", [])]):
		doc.simultaneous_sessions = 1
