# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""Seed Medical Services, with their Service Items child rows.

Run manually; this is deliberately not a patch, so `bench migrate` never
triggers it.

	bench --site <site> execute digitz_erp.seeds.medical_service_seed.run

	# preview without writing anything
	bench --site <site> execute digitz_erp.seeds.medical_service_seed.run \
		--kwargs "{'dry_run': 1}"

The rows are held in SERVICES below rather than read from a spreadsheet, so
this runs on a server that has no copy of the file. They were taken from
"Service List_Altaj_31-08-2026.xlsx", one tuple per service:

	(title, display_name, (item_code, ...))

title is also the record name -- Medical Services is autonamed `field:title`.
Rows in the sheet that shared a Service Name are already merged here into one
entry with several item codes.

The child row is priced from the linked Item -- see child_row() for the
arithmetic.

Run item_seed first: every entry links to an Item that must already exist.
Re-running is safe: an existing title is skipped, never rewritten.
"""

import frappe
from frappe.utils import cint, flt

# (title, display_name, (item_code, ...))
SERVICES = (
	('MED-C-M-001', 'MEDICAL-CAT-C-Male-New', ('M03',)),
	('MED-C-M-004', 'MEDICAL-CAT-C-Male-Renew-Pre-typed', ('M03',)),
	('MED-C-F-003', 'MEDICAL-CAT-C-Female-Renew', ('M03',)),
	('MED-A-F-005', 'MEDICAL-CAT-A-Female-Renew', ('M01',)),
	('MED-B-M-002', 'MEDICAL-CAT-B-Male-New-Pre-typed', ('M02',)),
	('EID-R-003', 'RENEW-3YEARS', ('M06',)),
	('MED-B-F-002', 'MEDICAL-CAT-BP-Female-New-Pre-typed', ('M06',)),
	('MED-A-M-003', 'MEDICAL-CAT-A-Male-Renew-without-X-ray', ('M06',)),
	('MED-A-F-001', 'MEDICAL-CAT-A-Female-New', ('M06',)),
	('EID-R-002', 'RENEW-2YEARS', ('M06',)),
	('DXB', 'DXB', ('M06',)),
	('MED-A-M-005', 'MEDICAL-CAT-A-Male-Renew-X-ray', ('M06',)),
	('TAWJEEH', 'TAWJEEH-SERVICE', ('M06',)),
	('EID-N-002', 'NEW-2YEARS', ('M06',)),
	('MED-C-F-001', 'MEDICAL-CAT-C-Female-New', ('M06',)),
	('VISIT VISA', 'VISIT VISA', ('M06',)),
	('MED-A-F-002', 'MEDICAL-CAT-A-Female-New-without-X-ray', ('M06',)),
	('MED-A-F-006', 'MEDICAL-CAT-A-Female-Renew-Pre-typed', ('M06',)),
	('EID-R-001', 'RENEW-1YEAR', ('M06',)),
	('MED-B-M-003', 'MEDICAL-CAT-B-Male-Renew', ('M06',)),
	('AOE', 'AOE', ('M06',)),
	('MED-A-M-002', 'MEDICAL-CAT-A-Male-New-Pre-typed', ('M06',)),
	('MED-C-M-002', 'MEDICAL-CAT-C-Male-New-Pre-typed', ('M06',)),
	('EID-R-004', 'RENEW-5YEARS', ('M06',)),
	('MED-B-M-004', 'MEDICAL-CAT-B-Male-Renew-Pre-typed', ('M06',)),
	('CHANGE STATUS', 'CHANGE STATUS', ('M06',)),
	('MED-B-F-001', 'MEDICAL-CAT-BP-Female-New', ('M06',)),
	('ENTRY PERMIT', 'ENTRY PERMIT', ('M06',)),
	('EID-N-005', 'NEW-10YEARS', ('M06',)),
	('MED-C-M-003', 'MEDICAL-CAT-C-Male-Renew', ('M06',)),
	('EID-N-003', 'NEW-3YEARS', ('M06',)),
	('MED-B-M-001', 'MEDICAL-CAT-B-Male-New', ('M06',)),
	('MED-BP-F-001', 'MED-BP-Female Pregnant', ('M06',)),
	('MED-B-F-003', 'MEDICAL-CAT-BP-Female-Renew', ('M06',)),
	('EID-N-001', 'NEW-1YEAR', ('M06',)),
	('MED-A-M-001', 'MEDICAL-CAT-A-Male-New', ('M06',)),
	('MED-A-F-004', 'MEDICAL-CAT-A-Female-New-Pre-typed-without-X-ray', ('M06',)),
	('MED-A-F-003', 'MEDICAL-CAT-A-Female-New-Pre-typed', ('M06',)),
	('EID-N-004', 'NEW-5YEARS', ('M06',)),
	('HEALTH CARD', 'HEALTH CARD', ('M06',)),
	('MED-A-M-004', 'MEDICAL-CAT-A-Male-Renew-Pre-typed', ('M06',)),
	('EID-R-005', 'RENEW-10YEARS', ('M06',)),
	('MED-B-F-004', 'MEDICAL-CAT-BP-Female-Renew-Pre-typed', ('M06',)),
	('MED-C-F-004', 'MEDICAL-CAT-C-Female-Renew-Pre-typed', ('M06',)),
	('MED-C-F-002', 'MEDICAL-CAT-C-Female-New-Pre-typed', ('M06',)),
)


def run(dry_run=0):
	"""Create one Medical Services record per entry in SERVICES.

	:param dry_run: report what would happen without writing.
	"""
	dry_run = cint(dry_run)

	created, existing, problems = [], [], []

	for position, (title, display_name, item_codes) in enumerate(SERVICES, start=1):
		missing = [code for code in item_codes if not frappe.db.exists("Item", code)]

		if missing:
			problems.append((position, title, f"Item(s) not found: {', '.join(missing)}"))
			continue

		if frappe.db.exists("Medical Services", title):
			existing.append(title)
			continue

		if not dry_run:
			frappe.get_doc(
				{
					"doctype": "Medical Services",
					"title": title,
					"display_name": display_name,
					"services": [child_row(code) for code in item_codes],
				}
			).insert(ignore_permissions=True)

		created.append((title, item_codes))

	if not dry_run:
		frappe.db.commit()

	prefix = "[dry run] would create" if dry_run else "created"
	print("\nMedical Services seed")
	print(f"  defined          : {len(SERVICES)}")
	print(f"  {prefix:<16} : {len(created)}")
	print(f"  already present  : {len(existing)}")
	print(f"  not seeded       : {len(problems)}")

	for position, title, reason in problems:
		print(f"    ! #{position}: {title} -- {reason}")

	for title in existing:
		print(f"    = {title} (unchanged)")

	for title, codes in created:
		print(f"    + {title}  [{', '.join(codes)}]")

	return {
		"defined": len(SERVICES),
		"created": [title for title, _ in created],
		"existing": existing,
		"problems": problems,
		"dry_run": bool(dry_run),
	}


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
