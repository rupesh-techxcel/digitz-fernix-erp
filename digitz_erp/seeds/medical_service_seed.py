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
this runs on a server that has no copy of the file. They were taken from the
"Services" sheet of "CJM - Final One 13.10.2026.xlsx", one tuple per row:

	(service_with_code, item_code)

"Service with Code" fills both `title` and `display_name`; title is also the
record name -- Medical Services is autonamed `field:title`. The text is kept
exactly as the sheet has it (ends trimmed only), because token_sync matches the
service name a token carries against these fields as-is. "STOCK ID" is the one
Service Items child row each service gets.

The child row is priced from the linked Item -- see child_row() for the
arithmetic. It is a snapshot: token_sync reprices from the price list or Item.

clean_start_seed runs import_services() itself, after it has wiped Medical
Services and reloaded the Items these rows link to, so a clean start needs no
separate run of this seed. Run it on its own only to add services that are
missing: an existing title is skipped, never rewritten.
"""

import frappe
from frappe.utils import cint, flt

# (service_with_code, item_code)
SERVICES = (
	('100-Medical Pre-Typed Female New', 'M08'),
	('101-Medical Pre-Typed Female Renew', 'M08'),
	('102-Medical Pre-Typed Male New', 'M08'),
	('103-Medical Pre-Typed Male Renew', 'M08'),
	('104-Medical A Typing Female New', 'M01'),
	('105-Medical A Typing Female Renew', 'M01'),
	('106-Medical A Typing Male New', 'M01'),
	('107-Medical A Typing Male Renew', 'M01'),
	('108-Medical B Typing  Male New', 'M02'),
	('109-Medical B Typing Female New', 'M02'),
	('110-Medical B Typing Female Renew', 'M02'),
	('111-Medical B Typing Male Renew', 'M02'),
	('112-Medical C Typing Female New', 'M03'),
	('113-Medical C Typing Female Renew', 'M03'),
	('114-Medical C Typing Male New', 'M02'),
	('115-Medical C Typing Male Renew', 'M02'),
	('116-Embassy Medical Pre-Typed', 'EMBASSY02'),
	('117-Embassy Medical Typing', 'EMBASSY01'),
	('118-Pre Employment Pre-Typed', 'M42'),
	('119-Pre Employment Typing', 'M41'),
	('120-EID 1 Year - DXB', 'EID01'),
	('121-EID 10 Years - DXB', 'EID05'),
	('122-EID 2 Years - DXB', 'EID02'),
	('123-EID 5 Years - DXB', 'EID03'),
	('124-EID Replacement -DXB', 'EID13'),
	('125-EID Modification - DXB', 'MOD1'),
	('126-Medical Group Female', 'M08'),
	('127-Medical Group Male', 'M08'),
	('128-Other Group Services', 'VISA18'),
)


def run(dry_run=0):
	"""Create one Medical Services record per entry in SERVICES.

	:param dry_run: report what would happen without writing.
	"""
	dry_run = cint(dry_run)

	try:
		created, existing, problems = import_services()
	except Exception:
		frappe.db.rollback()
		raise

	if dry_run:
		frappe.db.rollback()
	else:
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

	for title, code in created:
		print(f"    + {title}  [{code}]")

	return {
		"defined": len(SERVICES),
		"created": [title for title, _ in created],
		"existing": existing,
		"problems": problems,
		"dry_run": bool(dry_run),
	}


def import_services():
	"""Insert every service in SERVICES that is not there yet. Does not commit.

	Returns (created [(title, item_code)], existing [title],
	problems [(position, title, reason)]).
	"""
	created, existing, problems = [], [], []

	for position, (title, item_code) in enumerate(SERVICES, start=1):
		if not frappe.db.exists("Item", item_code):
			problems.append((position, title, f"Item not found: {item_code}"))
			continue

		if frappe.db.exists("Medical Services", title):
			existing.append(title)
			continue

		frappe.get_doc(
			{
				"doctype": "Medical Services",
				"title": title,
				"display_name": title,
				"services": [child_row(item_code)],
			}
		).insert(ignore_permissions=True)

		created.append((title, item_code))

	return created, existing, problems


def child_row(item_code):
	"""One Service Items row, priced from the Item.

	`rate` is the full charge, the sum of the item's service, typing and
	transaction charges and government fee, with qty 1 and the same value in
	gross and net. Tax is left off the row (`tax_excluded`), as the earlier
	records had it; this does not decide the invoice's tax, which
	token_sync.item_tax takes from the Item.
	"""
	item = frappe.db.get_value("Item", item_code, ["item_name", "service_charge", "typing_charges", "transaction_charges", "gov"], as_dict=True)

	service_charge = flt(item.service_charge)
	typing_charges = flt(item.typing_charges)
	transaction_charges = flt(item.transaction_charges)
	gov = flt(item.gov)
	rate = service_charge + typing_charges + transaction_charges + gov

	return {
		"item": item_code,
		"item_name": item.item_name,
		"qty": 1,
		"rate": rate,
		"gross_amount": rate,
		"net_amount": rate,
		"tax_excluded": 1,
		"tax_amount": 0,
		"service_charge": service_charge,
		"typing_charges": typing_charges,
		"transaction_charges": transaction_charges,
		"gov": gov,
	}
