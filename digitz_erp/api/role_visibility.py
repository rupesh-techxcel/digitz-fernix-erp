# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""Keep the role lists short: hide the roles this app does not use.

Frappe and the app's own doctypes create many roles (Accounts User, Blogger,
Stock Manager, ...) that the Medical Center never assigns. They crowd the User
form's role checkboxes and Role Permission Manager, so this disables them on
every install and migrate. A disabled role is hidden from both and from role
pickers; its permission rows stay in place and simply apply to no one.

Disabling is the only hiding that lasts. The User form's role editor drops,
on save, any role it does not display, so a role that was merely hidden but
still assigned would be stripped from the user at the next edit anyway.

Safe for production: a role still held by any user is left enabled and
reported, so nobody loses access on an update. Remove it from those users
(or run apply(force=1), which does that) to hide it as well.

Never touched: Frappe's standard and automatic roles (Administrator, System
Manager, Script Manager, Guest, All, Desk User), and every role not listed in
HIDDEN_ROLES -- among them Cashier, Cashier Approver and Management, and
Frappe's Report Manager, Workspace Manager, Dashboard Manager and Prepared
Report User, which run custom reports, workspaces and dashboards.

Check a site with: bench --site <site> execute digitz_erp.api.role_visibility.report
"""

import frappe
from frappe.core.doctype.role.role import STANDARD_ROLES
from frappe.permissions import AUTOMATIC_ROLES

# Roles nobody at the Medical Center is given
HIDDEN_ROLES = (
	# The app's general ERP roles; the counter works with Cashier and Management
	"Accounts Manager",
	"Accounts User",
	"Sales Manager",
	"Sales Master Manager",
	"Sales User",
	"Purchase Manager",
	"Purchase Master Manager",
	"Purchase User",
	"Stock Manager",
	"Stock User",
	"Item Manager",
	"Tab User",
	"Maintenance Manager",
	"Maintenance User",
	# Frappe features the Medical Center does not use
	"Website Manager",
	"Blogger",
	"Newsletter Manager",
	"Knowledge Base Contributor",
	"Knowledge Base Editor",
	"Inbox User",
	"Translator",
)

PROTECTED = set(STANDARD_ROLES) | set(AUTOMATIC_ROLES)


def holders(role):
	"""Users (other than Administrator) who hold `role`."""
	return frappe.get_all(
		"Has Role",
		filters={"role": role, "parenttype": "User", "parent": ["!=", "Administrator"]},
		pluck="parent",
		distinct=True,
	)


def hide_unused_roles(force=0):
	"""Disable every role in HIDDEN_ROLES that no user holds. With `force`,
	also the held ones, taking them off their users. Safe to run any number of times."""
	hidden, kept = [], {}

	for role in HIDDEN_ROLES:
		if role in PROTECTED or not frappe.db.exists("Role", role):
			continue
		if frappe.db.get_value("Role", role, "disabled"):
			continue

		users = holders(role)
		if users and not frappe.utils.cint(force):
			kept[role] = users
			continue

		if users:
			# Role.disable_role takes the role off every user, as the form does
			frappe.get_doc("Role", role).update({"disabled": 1}).save(ignore_permissions=True)
		else:
			frappe.db.set_value("Role", role, "disabled", 1, update_modified=False)
		hidden.append(role)

	if hidden:
		frappe.clear_cache()
		print("Roles hidden: " + ", ".join(hidden))
	for role, users in kept.items():
		print(f"Role {role} kept visible: still held by {', '.join(users)}")

	return {"hidden": hidden, "kept": kept}


def apply():
	"""after_migrate, and after_sync on install, once every doctype has created its roles."""
	hide_unused_roles()


def report():
	"""Print each role in HIDDEN_ROLES and whether it is hidden, kept (and by whom) or missing."""
	frappe.only_for("System Manager")
	for role in HIDDEN_ROLES:
		if not frappe.db.exists("Role", role):
			print(f"--     {role} (not on this site)")
		elif frappe.db.get_value("Role", role, "disabled"):
			print(f"hidden {role}")
		else:
			print(f"SHOWN  {role}: held by {', '.join(holders(role)) or 'nobody (run apply)'}")
