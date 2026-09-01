# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""Seed the Al Taj letterhead images as public File attachments.

Run manually; this is deliberately not a patch, so `bench migrate` never
triggers it.

	bench --site <site> execute digitz_erp.seeds.company_letterhead_seed.run

	# preview without writing anything
	bench --site <site> execute digitz_erp.seeds.company_letterhead_seed.run \
		--kwargs "{'dry_run': 1}"

The images ship inside the app (digitz_erp/public/images), so this runs on a
server with no copy of the originals -- the same reason the other seeds hold
their data inline.

Each becomes a public File, which puts it at `/files/<name>` and makes it
selectable in Company's Header and Footer fields. The file names are kept
exactly as they are, because Company.header_image stores that path verbatim and
the PDF generator resolves it straight off disk
(quotation.py -> create_header_pdf).

Re-running is safe: a public File with the same name is left alone.
"""

import os

import frappe
from frappe.utils import cint

# (file name as it must appear under /files/, what it is used for)
LETTERHEAD_FILES = (
	("AlTaj Logo Header.jpeg", "Company header"),
	("al.taj-fooer.jpeg", "Company footer"),
)


def run(dry_run=0):
	"""Attach each bundled letterhead image as a public File.

	:param dry_run: report what would happen without writing.
	"""
	dry_run = cint(dry_run)

	created, existing, problems = [], [], []

	for file_name, purpose in LETTERHEAD_FILES:
		source = os.path.join(frappe.get_app_path("digitz_erp"), "public", "images", file_name)

		if not os.path.exists(source):
			problems.append((file_name, f"not bundled with the app at {source}"))
			continue

		found = frappe.db.get_value(
			"File", {"file_name": file_name, "is_private": 0}, ["name", "file_url"], as_dict=True
		)

		if found:
			existing.append((file_name, found.file_url))
			continue

		if dry_run:
			created.append((file_name, f"/files/{file_name}", purpose))
			continue

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

		created.append((file_name, doc.file_url, purpose))

	if not dry_run:
		frappe.db.commit()

	report(created, existing, problems, dry_run)

	return {
		"created": [{"file_name": n, "file_url": u} for n, u, _ in created],
		"existing": [{"file_name": n, "file_url": u} for n, u in existing],
		"problems": problems,
		"dry_run": bool(dry_run),
	}


def report(created, existing, problems, dry_run):
	prefix = "[dry run] would attach" if dry_run else "attached"

	print("\nCompany letterhead seed")
	print(f"  {prefix:<22} : {len(created)}")
	print(f"  already present        : {len(existing)}")
	print(f"  problems               : {len(problems)}")

	for file_name, url, purpose in created:
		print(f"    + {file_name}  ->  {url}   ({purpose})")

	for file_name, url in existing:
		print(f"    = {file_name}  ->  {url}   (unchanged)")

	for file_name, reason in problems:
		print(f"    ! {file_name}: {reason}")

	if created and not dry_run:
		print("\n  Set these on the Company record:")
		print("    Header -> /files/AlTaj Logo Header.jpeg")
		print("    Footer -> /files/al.taj-fooer.jpeg")
