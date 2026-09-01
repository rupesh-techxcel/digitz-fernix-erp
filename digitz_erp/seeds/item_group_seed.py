# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""Seed Item Groups from the Item Group column of the ERP master data sheet.

Run manually; this is deliberately not a patch, so `bench migrate` never
triggers it.

	bench --site <site> execute digitz_erp.seeds.item_group_seed.run

	# preview without writing anything
	bench --site <site> execute digitz_erp.seeds.item_group_seed.run \
		--kwargs "{'dry_run': 1}"

	# a different workbook, sheet or column
	bench --site <site> execute digitz_erp.seeds.item_group_seed.run \
		--kwargs "{'file_path': '/path/to/book.xlsx', 'sheet': 'Walk-in Customer', 'column': 'Item Group'}"

Each distinct value becomes one Item Group, stored in both `item_group_name`
and `description`. Item Group is autonamed `field:item_group_name`, so that
text is also the record's name.

Run this before item_seed, which links every Item to one of these groups.

Re-running is safe: existing groups are left alone and reported as skipped.
"""

import frappe
from frappe.utils import cint

from digitz_erp.seeds.workbook import column_index, load_sheet, text

DEFAULT_FILE = "/home/rupesh/Downloads/ERP Master Data - 26.08.2026.xlsx"

# The column was originally headed DIVISION and was later renamed to match the
# doctype. Both are accepted so the seed works against either version of the
# sheet; the first one present wins.
DEFAULT_COLUMNS = ("Item Group", "DIVISION")


def run(file_path=None, sheet=None, column=None, dry_run=0, update_existing=0):
	"""Create one Item Group per distinct value in the column.

	:param file_path: workbook to read. Defaults to DEFAULT_FILE.
	:param sheet: sheet name. Defaults to the first sheet.
	:param column: header to read. Defaults to "Item Group", falling back to
		"DIVISION", matched case-insensitively.
	:param dry_run: report what would happen without writing.
	:param update_existing: also fill `description` on groups that already
		exist but have none. Off by default, so a re-run changes nothing.
	"""
	file_path = file_path or DEFAULT_FILE
	dry_run = cint(dry_run)
	update_existing = cint(update_existing)

	groups, column_used = read_groups(file_path, sheet, column)

	if not groups:
		print(f"No values found in column '{column_used}'. Nothing to seed.")
		return

	created, skipped, updated = [], [], []

	for group in groups:
		if frappe.db.exists("Item Group", group):
			if update_existing and not frappe.db.get_value("Item Group", group, "description"):
				if not dry_run:
					frappe.db.set_value("Item Group", group, "description", group)
				updated.append(group)
			else:
				skipped.append(group)
			continue

		if not dry_run:
			frappe.get_doc(
				{
					"doctype": "Item Group",
					"item_group_name": group,
					"description": group,
				}
			).insert(ignore_permissions=True)

		created.append(group)

	if not dry_run:
		frappe.db.commit()

	report(file_path, column_used, groups, created, skipped, updated, dry_run)

	return {
		"file": file_path,
		"column": column_used,
		"distinct": len(groups),
		"created": created,
		"skipped": skipped,
		"updated": updated,
		"dry_run": bool(dry_run),
	}


def read_groups(file_path, sheet, column):
	"""Distinct, trimmed values, in the order the sheet lists them.

	Deduped case-insensitively because Frappe stores document names in a
	case-insensitive collation: 'MEDICAL' and 'Medical' would be the same Item
	Group, so they must collapse here rather than collide on insert. The first
	spelling seen wins.
	"""
	header, rows = load_sheet(file_path, sheet)

	candidates = (column,) if column else DEFAULT_COLUMNS
	index = None
	column_used = None

	for candidate in candidates:
		index = column_index(header, candidate)

		if index is not None:
			column_used = candidate
			break

	if index is None:
		found = ", ".join(str(cell) for cell in header if cell is not None)
		frappe.throw(
			f"No {' or '.join(repr(c) for c in candidates)} column in {file_path}. Found: {found}"
		)

	groups = []
	seen = set()

	for row in rows:
		value = text(row, index)

		if not value or value.lower() in seen:
			continue

		seen.add(value.lower())
		groups.append(value)

	return groups, column_used


def report(file_path, column, groups, created, skipped, updated, dry_run):
	prefix = "[dry run] would create" if dry_run else "created"

	print(f"\nItem Group seed from {file_path}")
	print(f"  column           : {column}")
	print(f"  distinct values  : {len(groups)}")
	print(f"  {prefix:<16} : {len(created)}")
	print(f"  already present  : {len(skipped)}")

	if updated:
		verb = "would fill" if dry_run else "filled"
		print(f"  description {verb}: {len(updated)}")

	for group in created:
		print(f"    + {group}")

	for group in updated:
		print(f"    ~ {group}")

	for group in skipped:
		print(f"    = {group} (unchanged)")
