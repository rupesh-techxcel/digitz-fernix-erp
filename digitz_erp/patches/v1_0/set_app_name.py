# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""Set Website Settings.app_name to the product name.

force=True because an existing site already holds a name -- Frappe's default,
or whatever a previous install left -- and apply_app_name() deliberately will
not write over a value that looks deliberate. This patch is the one place that
asserts it.

The name reaches the browser tab, the login page and outgoing email subjects.
"""

import frappe

from digitz_erp.api.branding import APP_NAME, apply_app_name


def execute():
	if apply_app_name(force=True):
		frappe.log_error(message=f"Website Settings.app_name set to {APP_NAME}", title="Branding")
