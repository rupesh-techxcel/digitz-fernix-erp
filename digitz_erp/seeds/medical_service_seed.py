# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""Seed Medical Services, with their Service Items child rows, from a sheet.

Run manually; this is deliberately not a patch, so `bench migrate` never
triggers it.

	bench --site <site> execute digitz_erp.seeds.medical_service_seed.run

	# preview without writing anything
	bench --site <site> execute digitz_erp.seeds.medical_service_seed.run \
		--kwargs "{'dry_run': 1}"

	# a different workbook or sheet
	bench --site <site> execute digitz_erp.seeds.medical_service_seed.run \
		--kwargs "{'file_path': '/path/to/book.xlsx', 'sheet': 'Sheet1'}"

Column mapping, all located by header name:

	Service Name -> title         (also the record name; Medical Services is
	                               autonamed `field:title`)
	Display Name -> display_name
	item         -> one `services` child row, linked to that Item

Rows sharing a Service Name are merged into one Medical Services record with a
child row each, so a service made of several items can be expressed as several
lines in the sheet.

The child row is filled from the linked Item to match the shape of the records
already on the site -- see child_row() for the arithmetic.

Run item_seed first: every row links to an Item that must already exist.
Re-running is safe: an existing title is skipped, never rewritten.
"""

import frappe
from frappe.utils import cint, flt

from digitz_erp.seeds.workbook import load_sheet, require_columns, text

DEFAULT_FILE = "/home/rupesh/Downloads/Service List_Altaj_31-08-2026.xlsx"

TITLE = "Service Name"
DISPLAY = "Display Name"
ITEM = "item"


def run(file_path=None, sheet=None, dry_run=0):
	"""Create one Medical Services record per distinct Service Name.

	:param file_path: workbook to read. Defaults to DEFAULT_FILE.
	:param sheet: sheet name. Defaults to the first sheet.
	:param dry_run: report what would happen without writing.
	"""
	file_path = file_path or DEFAULT_FILE
	dry_run = cint(dry_run)

	header, rows = load_sheet(file_path, sheet)
	columns = require_columns(header, [TITLE, DISPLAY, ITEM], file_path)

	services, problems = collect(rows, columns)

	created, existing = [], []

	for title, service in services.items():
		if frappe.db.exists("Medical Services", title):
			existing.append(title)
			continue

		if not dry_run:
			doc = frappe.get_doc(
				{
					"doctype": "Medical Services",
					"title": title,
					"display_name": service["display_name"],
					"services": [child_row(item_code) for item_code in service["items"]],
				}
			)
			doc.insert(ignore_permissions=True)

		created.append((title, service["items"]))

	if not dry_run:
		frappe.db.commit()

	report(file_path, len(rows), created, existing, problems, dry_run)

	return {
		"file": file_path,
		"rows": len(rows),
		"created": [title for title, _ in created],
		"existing": existing,
		"problems": problems,
		"dry_run": bool(dry_run),
	}


def collect(rows, columns):
	"""Group sheet rows into one entry per Service Name.

	Returns (services, problems). A row that cannot be used is recorded with
	its sheet row number rather than raised, so one bad line does not abandon
	the rest of the sheet halfway through.
	"""
	services = {}
	problems = []

	for number, row in enumerate(rows, start=2):
		title = text(row, columns[TITLE])
		display_name = text(row, columns[DISPLAY])
		item_code = text(row, columns[ITEM])

		if not any((title, display_name, item_code)):
			continue

		if not title:
			problems.append((number, "-", "no Service Name"))
			continue

		if not item_code:
			problems.append((number, title, "no item"))
			continue

		if not frappe.db.exists("Item", item_code):
			problems.append((number, title, f"Item '{item_code}' does not exist"))
			continue

		service = services.setdefault(title, {"display_name": display_name, "items": []})

		# First non-empty Display Name wins; later rows for the same service
		# only contribute their item.
		if not service["display_name"] and display_name:
			service["display_name"] = display_name

		if item_code in service["items"]:
			problems.append((number, title, f"Item '{item_code}' already listed for this service"))
			continue

		service["items"].append(item_code)

	return services, problems


def child_row(item_code):
	"""One Service Items row, priced from the Item.

	Mirrors the rows already on the site: `rate` is the full charge, the item's
	service charge plus the government fee, with qty 1 and the same value in
	gross and net. Tax is left off the row (`tax_excluded`), which is what the
	existing records do and what makes token_sync.build_invoice_items treat the
	line as zero rated.
	"""
	item = frappe.db.get_value("Item", item_code, ["item_name", "com", "gov"], as_dict=True)

	com = flt(item.com)
	gov = flt(item.gov)
	rate = com + gov

	return {
		"item": item_code,
		"item_name": item.item_name,
		"qty": 1,
		"rate": rate,
		"gross_amount": rate,
		"net_amount": rate,
		"tax_excluded": 1,
		"tax_amount": 0,
		"com": com,
		"gov": gov,
	}


def report(file_path, total, created, existing, problems, dry_run):
	prefix = "[dry run] would create" if dry_run else "created"

	print(f"\nMedical Services seed from {file_path}")
	print(f"  data rows        : {total}")
	print(f"  {prefix:<16} : {len(created)}")
	print(f"  already present  : {len(existing)}")
	print(f"  not seeded       : {len(problems)}")

	for number, title, reason in problems:
		print(f"    ! row {number}: {title} -- {reason}")

	for title in existing:
		print(f"    = {title} (unchanged)")

	for title, items in created:
		print(f"    + {title}  [{', '.join(items)}]")
