"""Cashiers no longer add, edit or delete Items: they only pick them on the invoice.

The after_migrate grant never takes a right away, so this removes the Item write,
create and delete rights the Cashier was given before, in whichever permission
set the site has in effect (Custom DocPerm or the doctype's DocPerm).
"""

import frappe

from digitz_erp.api.cashier_permissions import ROLE, cashier_row


def execute() -> None:
	if not frappe.db.exists("Role", ROLE):
		return
	found = cashier_row("Item")
	if not found:
		return
	table, name, _row = found
	frappe.db.set_value(table, name, {"write": 0, "create": 0, "delete": 0}, update_modified=False)
	frappe.clear_cache(doctype="Item")
