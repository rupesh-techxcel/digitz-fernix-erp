# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""Seed Items.

Run manually; this is deliberately not a patch, so `bench migrate` never
triggers it.

	bench --site <site> execute digitz_erp.seeds.item_seed.run

	# preview without writing anything
	bench --site <site> execute digitz_erp.seeds.item_seed.run \
		--kwargs "{'dry_run': 1}"

The rows are held in ITEMS below rather than read from a spreadsheet, so this
runs on a server that has no copy of the master data file. They were taken from
"ERP Master Data - 26.08.2026.xlsx", one tuple per sheet row:

	(item_code, item_name, item_group, com, gov)

item_code is also the record name -- Item is autonamed `field:item_code`.
Everything else is left to the doctype defaults: `item_type` Service,
`base_unit` PCS, `maintain_stock` off, and `description`, which Item's own
before_validate fills from item_name.

Run item_group_seed first: every row links to an Item Group that must exist.

Re-running is safe: an existing item_code is skipped, never rewritten. That is
not only for idempotency -- Item.before_save refuses any edit to an existing
Item by a user holding the Cashier role, and Administrator holds every role.
"""

import frappe
from frappe.utils import cint, flt

# (item_code, item_name, item_group, com, gov)
ITEMS = (
	('VISA25', 'AOE  Sponsor File Opening  AOE', 'OTHER SERVICES', 0.0, 355.0),
	('20376727', 'AOE  Visa  EID  Transaction Charge  AOE', 'OTHER SERVICE CHARGES', 0.17, 0.0),
	('VISA35', 'AOE  Visa Modification  Govt Fee  AOE', 'OTHER SERVICES', 0.0, 100.0),
	('TAS020', 'AOE Health Ins. Govt. Fee    .', 'Insurance', 0.0, 0.0),
	('204', 'Beauticians & Related Services  SPA Workers Health Card Govt. Fee', 'MEDICAL', 0.0, 260.0),
	('VISA09', 'Cancellation  AOE Govt Fee', 'OTHER SERVICES', 0.0, 202.84),
	('VISA07', 'Change Status  AOE  Govt Fee', 'OTHER SERVICES', 0.0, 660.0),
	('VISA10', 'Change Status  DXB  Govt Fees', 'OTHER SERVICES', 0.0, 666.0),
	('VISA67', 'Company Visa DXB  Transaction Charge', 'OTHER SERVICE CHARGES', 72.59, 0.0),
	('VISA54', 'Data Modification - Others', 'OTHER SERVICES', 0.0, 100.0),
	('VISA53', 'Data Modification  AOE  Govt Fee', 'AOE Visa Services', 0.0, 204.15),
	('VISA59', 'Data Modification  DXB  Govt Fee', 'DXB Visa Services', 0.0, 100.0),
	('M202', 'Drivers Health Card Govt. Fee', 'MEDICAL', 0.0, 110.0),
	('VISA23', 'DXB  Sponsor File Opening  DXB', 'OTHER SERVICES', 0.0, 206.3),
	('VISA11', 'DXB  Transaction Charge  DXB', 'OTHER SERVICE CHARGES', 69.44, 0.0),
	('TAS019', 'DXB Health Ins. Govt. Fee    .', 'Insurance', 0.0, 189.0),
	('VISA26', 'DXB Visa Typing', 'DXB Visa Services', 41.0, 0.0),
	('OT26', 'E Channel Renewal  Gov Fee', 'OTHER SERVICES', 0.0, 3199.33),
	('OT27', 'E Channel Renewal  Service Fee', 'OTHER SERVICE CHARGES', 80.0, 0.0),
	('EMBASSY02', 'Embassy Medical Service Fee', 'OTHER SERVICE CHARGES', 88.14, 0.0),
	('EMBASSY03', 'Embassy Medical Service VIP', 'MEDICAL', 300.0, 0.0),
	('EMBASSY01', 'Embassy Service Medical  Govt Fee', 'OTHER SERVICES', 0.0, 258.0),
	('EID01', 'Emirates ID   1 Year  New', 'EMIRATES ID - GOVT FEE', 0.0, 253.91),
	('EID05', 'Emirates ID   10 Years (NEW RENEW)', 'EMIRATES ID - GOVT FEE', 0.0, 1159.62),
	('EID09', 'Emirates ID   2 Year  Renew', 'EMIRATES ID - GOVT FEE', 0.0, 353.91),
	('EID02', 'Emirates ID   2 Years  NEW', 'EMIRATES ID - GOVT FEE', 0.0, 353.91),
	('EID08', 'EMIRATES ID  1 Year  Renew', 'EMIRATES ID - GOVT FEE', 0.0, 253.91),
	('EID006', 'Emirates ID  5 Years (NEW RENEW)', 'EMIRATES ID - GOVT FEE', 0.0, 535.91),
	('VISA16', 'Emirates ID  AOE  1 Year  Govt Fee', 'EMIRATES ID - GOVT FEE', 0.0, 204.1),
	('VISA13', 'Emirates ID  AOE  2 Years  Govt Fee', 'EMIRATES ID - GOVT FEE', 0.0, 304.1),
	('VISA31', 'Emirates ID  AOE  5 Year  Govt Fee', 'EMIRATES ID - GOVT FEE', 0.0, 654.55),
	('91012586', 'Emirates ID  AOE  Typing Fee     AOE', 'EID Visa Services', 35.0, 0.0),
	('VISA66', 'Emirates ID  Golden Visa  Typing  AOE', 'EMIRATES ID SERVICE CHARGE', 35.0, 0.0),
	('VISA65', 'Emirates ID  Golden Visa  Typing  DXB', 'EMIRATES ID SERVICE CHARGE', 30.45, 0.0),
	('VISA63', 'Emirates ID  Modification DXB', 'EMIRATES ID - GOVT FEE', 0.0, 100.0),
	('501', 'Emirates ID  Typing Fee', 'EMIRATES ID SERVICE CHARGE', 31.09, 0.0),
	('VISA61', 'Emirates ID Fines  AOE', 'EMIRATES ID - GOVT FEE', 0.0, 0.0),
	('EID07', 'Emirates ID Fines  DXB', 'EMIRATES ID - GOVT FEE', 0.0, 20.0),
	('MOD1', 'Emirates ID Modification DXB', 'EMIRATES ID - GOVT FEE', 100.0, 0.0),
	('MOD2', 'Emirates ID Modification AOE', 'EMIRATES ID - GOVT FEE', 0.0, 0.0),
	('EID12', 'Emirates ID Replacement  Govt Fee AOE', 'EMIRATES ID - GOVT FEE', 0.0, 454.55),
	('VISA64', 'Emirates ID Replacement  Govt Fee DXB', 'EMIRATES ID - GOVT FEE', 0.0, 454.55),
	('VISA08', 'Entry Permit  AOE   Govt Fee', 'OTHER SERVICES', 0.0, 353.91),
	('VISA24', 'Entry Permit  Inside Country  DXB  Fee', 'OTHER SERVICES', 0.0, 1016.8),
	('VISA52', 'Entry Permit  Outside Country  DXB  Fee', 'OTHER SERVICES', 0.0, 346.32),
	('TAS004', 'Establishment Card Data Establishment Card New Govt. Fee', 'TASHEEL', 0.0, 555.34),
	('TAS005', 'Establishment Card Data Establishment Card ReNew Govt. Fee', 'TASHEEL', 0.0, 76.14),
	('TAS003', 'Establishment Card Data Modification Govt. Fee', 'TASHEEL', 0.0, 523.46),
	('TAS023', 'Fees Payment (Second Visit  23) Govt. Fee', 'TASHEEL', 0.0, 3550.7),
	('203', 'Food Handlers Health Card Govt. Fee', 'MEDICAL', 0.0, 160.0),
	('OT18', 'Foreign Affairs Attestation  Normal  Gov Fee', 'OTHER SERVICES', 0.0, 192.0),
	('OT19', 'Foreign Affairs Attestation  Normal  Service Fee', 'OTHER SERVICE CHARGES', 53.0, 0.0),
	('OT20', 'Foreign Affairs Attestation  Urgent  Gov Fee', 'OTHER SERVICES', 0.0, 302.0),
	('OT21', 'Foreign Affairs Attestation  Urgent  Service Fee', 'OTHER SERVICE CHARGES', 103.0, 0.0),
	('VISA32', 'Golden Visa  AOE  Candidate Application  Gov Fee', 'GOLDEN VISA', 0.0, 60.0),
	('VISA33', 'Golden Visa  AOE  EID 10 Years Govt fee', 'OTHER SERVICES', 0.0, 3150.0),
	('VISA28', 'Golden Visa  AOE  Govt Fees', 'OTHER SERVICES', 0.0, 1154.55),
	('VISA34', 'Golden Visa  AOE  Transaction Charge (Round off)', 'OTHER SERVICE CHARGES', 6.81, 0.0),
	('OT09', 'Health Card  Expatriate  Gov Fee', 'OTHER SERVICES', 0.0, 115.0),
	('OT010', 'Health Card  Gov Fee', 'OTHER SERVICES', 0.0, 115.0),
	('OT11', 'Health Card  UAE Citizens and GCC  Gov Fee', 'OTHER SERVICES', 0.0, 30.0),
	('OT15', 'Health Card  UAE National  Service Fee', 'OTHER SERVICE CHARGES', 29.79, 0.0),
	('OT10', 'Health Card Service Fee', 'OTHER SERVICE CHARGES', 45.0, 0.0),
	('OT12', 'Humanitarian Form  Govt Fee', 'OTHER SERVICES', 0.0, 152.48),
	('OT13', 'Humanitarian Form  Service Fee', 'OTHER SERVICE CHARGES', 46.53, 0.0),
	('OT23', 'Immigration Box  Renewal  Service Fee', 'OTHER SERVICE CHARGES', 40.0, 0.0),
	('TAS021', 'IOL Ins. Govt. Fee   IOL.', 'Insurance', 0.0, 126.0),
	('Labour', 'Labour Services', 'OTHER SERVICES', 0.0, 18.09),
	('OT16', 'License Update  Immigration  Govt Fee', 'OTHER SERVICES', 0.0, 18.09),
	('OT17', 'License Update  Immigration  Service Fee', 'OTHER SERVICE CHARGES', 100.0, 0.0),
	('M06', 'Medical  Service Fee', 'MEDICAL', 50.0, 0.0),
	('MTYP', 'Medical  Typing Fee', 'MEDICAL SERVICE FEE', 38.14, 0.0),
	('M01', 'Medical Category  A  Govt Fee', 'MEDICAL', 0.0, 261.86),
	('M02', 'Medical Category  B  Govt Fee', 'MEDICAL', 0.0, 261.86),
	('M03', 'Medical Category  C  Govt Fee', 'MEDICAL', 0.0, 261.86),
	('Express', 'Medical Service Fee  Express  08 Hours', 'MEDICAL SERVICE FEE', 300.0, 0.0),
	('Fast', 'Medical Service Fee  Fast Track  24 Hours', 'MEDICAL SERVICE FEE', 150.0, 0.0),
	('Urgent', 'Medical Service Fee  Urgent  04 Hours', 'MEDICAL SERVICE FEE', 400.0, 0.0),
	('M11', 'Medical service fee L0.5', 'MEDICAL', 5.0, 0.0),
	('M10', 'Medical service fee L1', 'MEDICAL', 10.0, 0.0),
	('M20', 'Medical service fee L2', 'MEDICAL', 20.0, 0.0),
	('M30', 'Medical service fee L3', 'MEDICAL', 30.0, 0.0),
	('M40', 'Medical service fee L4', 'MEDICAL', 40.0, 0.0),
	('TAS014', 'New Work Permit Govt. Fee', 'TASHEEL', 0.0, 138.79),
	('OLLabour', 'Offer letter  Contract  Electronic preapproval work permit (Package)  Labour Govt. Fee', 'OTHER SERVICES', 0.0, 76.14),
	('OfferLetter', 'Offer letter  Contract  Electronic preapproval work permit (Package)  Service Fee', 'OTHER SERVICES', 0.0, 278.77),
	('VISA58', 'OTHER  AOE Transaction Charge', 'AOE Visa Services', 0.0, 24.0),
	('VISA21', 'Other Third Party Charges  AOE', 'OTHER SERVICES', 0.0, 3050.0),
	('VISA62', 'Other Third Party Charges  DXB', 'DXB Visa Services', 0.0, 3150.0),
	('OT01', 'PHOTOGRAPH', 'OTHER SERVICES', 30.0, 0.0),
	('M41', 'Pre Employment Govt. Fee', 'MEDICAL', 0.0, 266.89),
	('M42', 'Pre Employment Service Fee', 'MEDICAL', 50.0, 0.0),
	('M43', 'Pre Employment Typing Fee', 'MEDICAL', 8.11, 0.0),
	('M05', 'Pregnancy Test', 'MEDICAL', 0.0, 50.36),
	('TAS015', 'Renewal Work Permit Govt. Fee', 'TASHEEL', 0.0, 76.14),
	('TAS001', 'Request Initial Approval Govt. Fee', 'TASHEEL', 0.0, 153.91),
	('VISA14', 'Residence  Cancellation  DXB Fee  Inside', 'OTHER SERVICES', 0.0, 88.45),
	('VISA57', 'Residence  Cancellation  DXB Fee  Outside', 'OTHER SERVICES', 0.0, 191.6),
	('VISA15', 'Residence Visa  AOE  Sponsor  1 Year  Govt Fee', 'OTHER SERVICES', 0.0, 354.83),
	('VISA12', 'Residence Visa  AOE  Sponsor  2 Years  Govt Fee', 'OTHER SERVICES', 0.0, 457.56),
	('VISA36', 'Residence Visa  AOE  Sponsor  5 Years  Govt Fee', 'OTHER SERVICES', 0.0, 761.66),
	('VISA18', 'Residence Visa  DXB  Sponsor  1 Year  Fee', 'OTHER SERVICES', 0.0, 316.41),
	('VISA03', 'Residence Visa  DXB  Sponsor  Renewal  2 Years  Fee', 'OTHER SERVICES', 0.0, 419.56),
	('PREApproval', 'Submit pre approval work permit', 'TASHEEL', 0.0, 76.14),
	('RenewLabour', 'submit renew labour card  Govt Fee', 'OTHER SERVICES', 0.0, 3550.7),
	('VISA55', 'Sudanese Sharjah Visa & EID  Govt. Fee', 'AOE Visa Services', 0.0, 555.34),
	('VISA56', 'Sudanese Sharjah Visa & EID  Typing Fee', 'AOE Visa Services', 42.3, 0.0),
	('TAS025', 'Tasheel Transaction Charges', 'TASHEEL', 1.21, 0.0),
	('TAW001', 'Tawjeeh  New', 'TAWJEEH', 0.0, 152.28),
	('TAW002', 'Tawjeeh  Renew', 'TAWJEEH', 0.0, 1360.85),
	('TAS024', 'Temporary Closure  With Absconding Govt. Fee', 'TASHEEL', 0.0, 76.14),
	('TAS011', 'Update Establishment Govt. Fee', 'TASHEEL', 0.0, 253.2),
	('TAS032', 'UPDATE INFORMATION', 'TASHEEL', 0.0, 51.77),
	('M04', 'Vaccination Card', 'MEDICAL', 0.0, 50.0),
	('V01', 'Vaccination Service', 'MEDICAL', 80.0, 0.0),
	('VIP', 'VIP Service', 'MEDICAL SERVICE FEE', 300.0, 0.0),
	('VISA06', 'Visa  AOE  Typing Fee    AOE', 'AOE Visa Services', 40.0, 0.0),
	('VISA20', 'VISA FINES  AOE', 'OTHER SERVICES', 0.0, 0.0),
	('VISA60', 'VISA FINES  DXB', 'DXB Visa Services', 0.0, 0.0),
)


def run(dry_run=0):
	"""Create one Item per entry in ITEMS.

	:param dry_run: report what would happen without writing.
	"""
	dry_run = cint(dry_run)

	created, existing, problems = [], [], []
	seen = set()

	for position, (item_code, item_name, item_group, com, gov) in enumerate(ITEMS, start=1):
		key = str(item_code).lower()

		if key in seen:
			problems.append((position, item_code, "duplicate of an earlier entry"))
			continue

		seen.add(key)

		if not item_name:
			problems.append((position, item_code, "no item_name"))
			continue

		if not frappe.db.exists("Item Group", item_group):
			problems.append((position, item_code, f"Item Group '{item_group}' does not exist"))
			continue

		if frappe.db.exists("Item", item_code):
			existing.append(item_code)
			continue

		if not dry_run:
			frappe.get_doc(
				{
					"doctype": "Item",
					"item_code": item_code,
					"item_name": item_name,
					"item_group": item_group,
					"com": flt(com),
					"gov": flt(gov),
				}
			).insert(ignore_permissions=True)

		created.append(item_code)

	if not dry_run:
		frappe.db.commit()

	prefix = "[dry run] would create" if dry_run else "created"
	print("\nItem seed")
	print(f"  defined          : {len(ITEMS)}")
	print(f"  {prefix:<16} : {len(created)}")
	print(f"  already present  : {len(existing)}")
	print(f"  not seeded       : {len(problems)}")

	for position, code, reason in problems:
		print(f"    ! #{position}: {code} -- {reason}")

	for code in existing:
		print(f"    = {code} (unchanged)")

	for code in created:
		print(f"    + {code}")

	return {
		"defined": len(ITEMS),
		"created": created,
		"existing": existing,
		"problems": problems,
		"dry_run": bool(dry_run),
	}
