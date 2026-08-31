# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""Point the desk, login page, splash and website brand at the Fernix logo.

Runs on migrate so production picks the branding up without anyone uploading a
file. The logo itself ships in the app under public/images, so there is nothing
to copy between environments.
"""

import frappe

from digitz_erp.api.branding import apply_branding


def execute():
	changed = apply_branding()

	if changed:
		frappe.log_error(
			message=f"Applied Fernix branding to: {', '.join(changed)}",
			title="Branding",
		)
