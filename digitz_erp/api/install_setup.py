# Setup records the app brings to a new site: the Cashier roles, the permission
# rules (Custom DocPerm), the Medical Center navigator and the Sales Invoice email.
#
# They live in digitz_erp/install_data, not in a fixtures folder: Frappe imports
# fixtures with force on every `bench migrate`, deleting and re-inserting each
# record, which put a live site's own permission changes back each deploy. These
# are imported once, at installation (after_sync); a migrate never touches them.

from pathlib import Path

import frappe

INSTALL_DATA = Path(__file__).resolve().parent.parent / "install_data"


def import_install_data() -> None:
	"""after_sync, on a fresh install: import each install_data/*.json file."""
	from frappe.core.doctype.data_import.data_import import import_doc

	for path in sorted(INSTALL_DATA.glob("*.json")):
		try:
			import_doc(str(path))
		except (ImportError, frappe.DoesNotExistError) as e:
			print(f"Skipping install data {path.name}: {e}")
