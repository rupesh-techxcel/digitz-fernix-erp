# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""Images the app ships, made available as public File attachments.

The blobs live in `digitz_erp/public/images/`, so they travel with the code.
This copies them into the site's own files on install and on every migrate,
which is what makes them attachable and selectable in the desk -- an
`/assets/...` path is served by the app but never appears in the file picker.

Idempotent by design: a public File with the same name is left alone, so this
is safe to run on every migration.
"""

import os

import frappe

# File names under digitz_erp/public/images that every site should have.
BUNDLED_FILES = ("weqayati-logo.png",)


def ensure_public_file(file_name):
	"""Create a public File from the bundled image if it is not there yet.

	Returns (status, file_url) where status is created / existing / missing.
	"""
	source = os.path.join(frappe.get_app_path("digitz_erp"), "public", "images", file_name)

	if not os.path.exists(source):
		return "missing", None

	found = frappe.db.get_value("File", {"file_name": file_name, "is_private": 0}, "file_url")

	if found:
		return "existing", found

	with open(source, "rb") as handle:
		content = handle.read()

	doc = frappe.get_doc(
		{
			"doctype": "File",
			"file_name": file_name,
			"is_private": 0,
			"content": content,
		}
	)
	doc.save(ignore_permissions=True)

	return "created", doc.file_url


def ensure_bundled_files():
	"""Install hook and after_migrate hook: keep BUNDLED_FILES present."""
	results = {}

	for file_name in BUNDLED_FILES:
		try:
			status, url = ensure_public_file(file_name)
			results[file_name] = (status, url)
		except Exception:
			# A missing attachment must never abort an install or a migration.
			frappe.log_error(
				message=frappe.get_traceback(),
				title=f"Could not attach bundled file {file_name}",
			)
			results[file_name] = ("failed", None)

	frappe.db.commit()

	return results
