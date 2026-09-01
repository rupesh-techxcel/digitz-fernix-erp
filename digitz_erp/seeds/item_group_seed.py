# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""Seed Item Groups.

Run manually; this is deliberately not a patch, so `bench migrate` never
triggers it.

	bench --site <site> execute digitz_erp.seeds.item_group_seed.run

	# preview without writing anything
	bench --site <site> execute digitz_erp.seeds.item_group_seed.run \
		--kwargs "{'dry_run': 1}"

The values are held in GROUPS below rather than read from a spreadsheet, so
this runs on a server that has no copy of the master data file. They were taken
from the "Item Group" column (previously headed "DIVISION") of
"ERP Master Data - 26.08.2026.xlsx".

Each value becomes one Item Group, stored in both `item_group_name` and
`description`. Item Group is autonamed `field:item_group_name`, so the text is
also the record's name.

Run this before item_seed, which links every Item to one of these groups.

Re-running is safe: existing groups are left alone and reported as skipped.
"""

import frappe
from frappe.utils import cint

# Order preserved from the source sheet; duplicates already collapsed.
GROUPS = (
	'OTHER SERVICES',
	'OTHER SERVICE CHARGES',
	'Insurance',
	'MEDICAL',
	'AOE Visa Services',
	'DXB Visa Services',
	'EMIRATES ID - GOVT FEE',
	'EID Visa Services',
	'EMIRATES ID SERVICE CHARGE',
	'TASHEEL',
	'GOLDEN VISA',
	'MEDICAL SERVICE FEE',
	'TAWJEEH',
)


def run(dry_run=0, update_existing=0):
	"""Create one Item Group per entry in GROUPS.

	:param dry_run: report what would happen without writing.
	:param update_existing: also fill `description` on groups that already
		exist but have none. Off by default, so a re-run changes nothing.
	"""
	dry_run = cint(dry_run)
	update_existing = cint(update_existing)

	created, skipped, updated = [], [], []

	for group in GROUPS:
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

	prefix = "[dry run] would create" if dry_run else "created"
	print("\nItem Group seed")
	print(f"  defined          : {len(GROUPS)}")
	print(f"  {prefix:<16} : {len(created)}")
	print(f"  already present  : {len(skipped)}")

	if updated:
		print(f"  description filled: {len(updated)}")

	for group in created:
		print(f"    + {group}")

	for group in updated:
		print(f"    ~ {group}")

	for group in skipped:
		print(f"    = {group} (unchanged)")

	return {
		"defined": len(GROUPS),
		"created": created,
		"skipped": skipped,
		"updated": updated,
		"dry_run": bool(dry_run),
	}
