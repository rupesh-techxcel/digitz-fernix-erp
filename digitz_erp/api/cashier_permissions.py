# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""What the Cashier role may do, enforced on every install and migrate.

A cashier works the counter: opens and closes the day, bills and prints invoices,
collects payments on credit invoices (Receipt Entry) and adds customers. They
never manage items, prices or masters, and never cancel, amend or delete an
invoice or a receipt.

The permissions ship two ways: as rows in each doctype's own JSON, and as Custom
DocPerm fixtures (Sales Invoice, Customer, ...). But once a site has a Custom
DocPerm on a doctype -- anyone saving it in Role Permission Manager creates them
-- Frappe ignores that doctype's JSON rows there. So this runs after every
migrate and install and makes the rule below true in whichever set is in effect,
using the Role Permission Manager's own add_permission so the other roles'
rights are kept.

Only the Cashier row is touched, and only the flags listed: other flags and other
roles are left as the site has them.

Check a site with: bench --site <site> execute digitz_erp.api.cashier_permissions.report
"""

import frappe
from frappe.permissions import add_permission

ROLE = "Cashier"

LOOKUP = {"read": 1, "select": 1}
NO_CHANGES = {"write": 0, "create": 0, "delete": 0, "submit": 0, "cancel": 0, "amend": 0}

# doctype: {flag: 1 (must have) or 0 (must not have)}
RULES = {
	"Sales Invoice": {
		"read": 1, "select": 1, "write": 1, "create": 1, "submit": 1, "print": 1, "report": 1,
		"cancel": 0, "amend": 0, "delete": 0,
	},
	"Customer": {"read": 1, "select": 1, "create": 1, "delete": 0},
	# Collections on credit invoices, from the console's Receipts tab
	"Receipt Entry": {
		"read": 1, "select": 1, "write": 1, "create": 1, "submit": 1, "print": 1, "report": 1,
		"cancel": 0, "amend": 0, "delete": 0,
	},
	"Counter Session": {"read": 1, "print": 1, "write": 0, "create": 0, "delete": 0, "cancel": 0},
	"Item": {**LOOKUP, **NO_CHANGES},
	"Item Price": {"write": 0, "create": 0, "delete": 0},
	"Price List": {"select": 1, "write": 0, "create": 0, "delete": 0},
	"Payment Mode": {**LOOKUP, **NO_CHANGES},
	"Tax": {**LOOKUP, **NO_CHANGES},
	"Unit": {**LOOKUP, **NO_CHANGES},
	"Warehouse": {**LOOKUP, **NO_CHANGES},
	"Company": {**LOOKUP, **NO_CHANGES},
	"Terms And Conditions": {**LOOKUP, **NO_CHANGES},
	"Stock Balance": {**LOOKUP, **NO_CHANGES},
	"Medical Services": {**LOOKUP, **NO_CHANGES},
	"Medical Service Logs": {**LOOKUP, **NO_CHANGES},
	"Global Settings": {"read": 1, "write": 0},
	# Picked in the invoice (Salesman, Cost Center), never opened: Employee is HR data
	"Employee": {"select": 1, "read": 0, "write": 0, "create": 0, "delete": 0},
	"Cost Center": {"select": 1, "write": 0, "create": 0, "delete": 0},
	# The receipt's cash/bank and receivable accounts, set by the console, never opened
	"Account": {"select": 1, "write": 0, "create": 0, "delete": 0},
}


def has_custom_perms(doctype):
	return bool(frappe.db.exists("Custom DocPerm", {"parent": doctype}))


def cashier_row(doctype):
	"""(table, name, values) of the Cashier's level-0 row now in effect, or None."""
	table = "Custom DocPerm" if has_custom_perms(doctype) else "DocPerm"
	row = frappe.db.get_value(table, {"parent": doctype, "role": ROLE, "permlevel": 0}, ["*"], as_dict=True)
	return (table, row.name, row) if row else None


def ensure_cashier_permissions():
	"""Make RULES true on this site. Safe to run any number of times."""
	if not frappe.db.exists("Role", ROLE):
		frappe.get_doc({"doctype": "Role", "role_name": ROLE, "desk_access": 1}).insert(ignore_permissions=True)

	changed = []
	for doctype, rule in RULES.items():
		if not frappe.db.exists("DocType", doctype):
			continue

		found = cashier_row(doctype)
		wants_access = any(rule.values())
		if not found:
			if not wants_access:
				continue  # no row means no rights, which is what the rule asks
			# Copies the standard rows to Custom DocPerm first (if not done yet),
			# so the other roles keep what they have
			add_permission(doctype, ROLE, 0)
			found = cashier_row(doctype)

		table, name, row = found
		updates = {flag: value for flag, value in rule.items() if row.get(flag) != value}
		if updates:
			frappe.db.set_value(table, name, updates, update_modified=False)
			changed.append(f"{doctype}: {updates}")

	if changed:
		frappe.clear_cache()
		print("Cashier permissions corrected:\n  " + "\n  ".join(changed))


def apply():
	"""after_migrate, and after_sync on install: runs once the fixtures are in."""
	ensure_cashier_permissions()


@frappe.whitelist()
def report():
	"""Print, for each doctype in RULES, the Cashier's rights in effect and any mismatch."""
	frappe.only_for("System Manager")
	flags = ("read", "select", "write", "create", "submit", "cancel", "amend", "delete", "print")
	ok = True
	for doctype, rule in RULES.items():
		if not frappe.db.exists("DocType", doctype):
			continue
		found = cashier_row(doctype)
		row = found[2] if found else {}
		have = " ".join(f for f in flags if row.get(f)) or "-"
		wrong = [f for f, v in rule.items() if bool(row.get(f)) != bool(v)]
		ok = ok and not wrong
		source = found[0] if found else ("Custom DocPerm" if has_custom_perms(doctype) else "DocPerm")
		print(f"{'OK ' if not wrong else 'BAD'} {doctype:22} [{source}] {have}" + (f"   wrong: {wrong}" if wrong else ""))
	print("All Cashier permissions as required." if ok else "Some Cashier permissions are wrong: run ensure_cashier_permissions.")
	return ok
