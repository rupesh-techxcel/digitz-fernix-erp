# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""Seed Items from the ERP master data sheet.

Run manually; this is deliberately not a patch, so `bench migrate` never
triggers it.

	bench --site <site> execute digitz_erp.seeds.item_seed.run

	# preview without writing anything
	bench --site <site> execute digitz_erp.seeds.item_seed.run \
		--kwargs "{'dry_run': 1}"

	# a different workbook or sheet
	bench --site <site> execute digitz_erp.seeds.item_seed.run \
		--kwargs "{'file_path': '/path/to/book.xlsx', 'sheet': 'Walk-in Customer'}"

Column mapping, all located by header name:

	ITEM CODE  -> item_code   (also the record name; Item is autonamed
	                           `field:item_code`)
	ITEM NAME  -> item_name
	Item Group -> item_group  (must already exist; run item_group_seed first)
	com        -> com
	gov        -> gov

Everything else is left to the doctype defaults: `item_type` Service,
`base_unit` PCS, `maintain_stock` off, and `description` which Item's own
before_validate fills from item_name.

Re-running is safe: an existing item_code is skipped, never rewritten. That is
not only for idempotency -- Item.before_save refuses any edit to an existing
Item by a user holding the Cashier role, and Administrator holds every role.
"""

import frappe
from frappe.utils import cint, flt

from digitz_erp.seeds.workbook import load_sheet, require_columns, text

DEFAULT_FILE = "/home/rupesh/Downloads/ERP Master Data - 26.08.2026.xlsx"

CODE = "ITEM CODE"
NAME = "ITEM NAME"
GROUP = "Item Group"
COM = "com"
GOV = "gov"


def run(file_path=None, sheet=None, dry_run=0):
	"""Create one Item per sheet row.

	:param file_path: workbook to read. Defaults to DEFAULT_FILE.
	:param sheet: sheet name. Defaults to the first sheet.
	:param dry_run: report what would happen without writing.
	"""
	file_path = file_path or DEFAULT_FILE
	dry_run = cint(dry_run)

	header, rows = load_sheet(file_path, sheet)
	columns = require_columns(header, [CODE, NAME, GROUP, COM, GOV], file_path)

	created, existing, problems = [], [], []
	seen = set()

	for number, row in enumerate(rows, start=2):
		item = read_row(row, columns)

		if not item["item_code"]:
			continue

		key = item["item_code"].lower()

		if key in seen:
			problems.append((number, item["item_code"], "duplicate of an earlier row"))
			continue

		seen.add(key)

		problem = check(item)
		if problem:
			problems.append((number, item["item_code"], problem))
			continue

		if frappe.db.exists("Item", item["item_code"]):
			existing.append(item["item_code"])
			continue

		if not dry_run:
			frappe.get_doc(dict(doctype="Item", **item)).insert(ignore_permissions=True)

		created.append(item["item_code"])

	if not dry_run:
		frappe.db.commit()

	report(file_path, len(rows), created, existing, problems, dry_run)

	return {
		"file": file_path,
		"rows": len(rows),
		"created": created,
		"existing": existing,
		"problems": problems,
		"dry_run": bool(dry_run),
	}


def read_row(row, columns):
	return {
		"item_code": text(row, columns[CODE]),
		"item_name": text(row, columns[NAME]),
		"item_group": text(row, columns[GROUP]),
		"com": flt(text(row, columns[COM]) or 0),
		"gov": flt(text(row, columns[GOV]) or 0),
	}


def check(item):
	"""Why this row cannot become an Item, or None if it can.

	Reported per row rather than raised, so one bad row does not abandon the
	rest of the sheet halfway through.
	"""
	if not item["item_name"]:
		return "no ITEM NAME"

	if not item["item_group"]:
		return "no Item Group"

	if not frappe.db.exists("Item Group", item["item_group"]):
		return f"Item Group '{item['item_group']}' does not exist"

	return None


def report(file_path, total, created, existing, problems, dry_run):
	prefix = "[dry run] would create" if dry_run else "created"

	print(f"\nItem seed from {file_path}")
	print(f"  data rows        : {total}")
	print(f"  {prefix:<16} : {len(created)}")
	print(f"  already present  : {len(existing)}")
	print(f"  not seeded       : {len(problems)}")

	for number, code, reason in problems:
		print(f"    ! row {number}: {code} -- {reason}")

	for code in existing:
		print(f"    = {code} (unchanged)")

	for code in created:
		print(f"    + {code}")
