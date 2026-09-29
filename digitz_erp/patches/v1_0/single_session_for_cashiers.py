"""Turn on "Allow only one session per user" and hold existing cashiers to one session.

New or changed users are handled by digitz_erp.api.session_policy.enforce_on_user.
"""

import frappe

from digitz_erp.api.session_policy import is_single_session_user


def execute():
	frappe.db.set_single_value("System Settings", "deny_multiple_sessions", 1)

	for user in frappe.get_all("Has Role", filters={"role": "Cashier", "parenttype": "User"}, pluck="parent", distinct=True):
		if user == "Administrator":
			continue
		if is_single_session_user(frappe.get_roles(user)):
			frappe.db.set_value("User", user, "simultaneous_sessions", 1, update_modified=False)
