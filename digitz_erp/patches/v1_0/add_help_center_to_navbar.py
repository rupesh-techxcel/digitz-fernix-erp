"""Put the Help Center (the digitz-help page) at the top of the navbar Help menu.

Frappe fills Navbar Settings from hooks only on install, so existing sites get
the item from this patch. Safe to re-run: it does nothing if the item is there.
"""

import frappe

ROUTE = "/app/digitz-help"


def execute():
	navbar = frappe.get_single("Navbar Settings")
	if not any(item.route == ROUTE for item in navbar.help_dropdown):
		navbar.append("help_dropdown", {"item_label": "Help Center", "item_type": "Route", "route": ROUTE})

	# Help Center first, the rest in their existing order, numbered afresh
	items = sorted(navbar.help_dropdown, key=lambda item: (item.route != ROUTE, item.idx or 0))
	if [item.name for item in items] == [item.name for item in navbar.help_dropdown] and all(
		item.idx == i for i, item in enumerate(items, 1)
	):
		return

	for i, item in enumerate(items, 1):
		item.idx = i
	navbar.help_dropdown = items
	navbar.save(ignore_permissions=True)
