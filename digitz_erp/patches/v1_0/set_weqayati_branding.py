# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""Switch the desk, login page, splash and website brand to the Weqayati logo.

force=True on purpose. apply_branding() normally leaves a field alone when it
already holds a working URL, which is what keeps it from overriding a logo an
administrator chose. Here the point is to replace the previous Fernix logo,
which is a perfectly valid /assets/ path and would otherwise be kept.

The image ships in the app under public/images, so there is nothing to copy
between environments.
"""

import frappe

from digitz_erp.api.branding import apply_branding


def execute():
	changed = apply_branding(force=True)

	if changed:
		frappe.log_error(
			message=f"Applied Weqayati branding to: {', '.join(changed)}",
			title="Branding",
		)
