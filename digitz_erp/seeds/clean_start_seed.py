# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""Wipe sales transactions and the item master, then load the new service list.

Run manually; this is deliberately not a patch, so `bench migrate` never
triggers it. It deletes data for good, so take a backup first:

	bench --site <site> backup

	# 1. dry run (the default): does the whole wipe and import, prints the
	#    report, then rolls everything back
	bench --site <site> execute digitz_erp.seeds.clean_start_seed.run

	# 2. the real run: commits. `confirm` must be the site name, so the
	#    command cannot be pasted against the wrong site by accident
	bench --site <site> execute digitz_erp.seeds.clean_start_seed.run \
		--kwargs "{'dry_run': 0, 'confirm': '<site>'}"

What is removed (with SQL, not delete_doc: submitted documents cannot be
deleted, and cancelling would post reversing entries into a ledger that is
meant to end up empty):

	Sales Invoice, Sales Return, Receipt Entry -- with their child rows, their
	  GL Posting / Stock Ledger / Document Posting Status rows, and their
	  Comment and Version history. Sales Return goes too because every return
	  points at an invoice.
	Medical Services (with their Service Items rows), Medical Service Logs
	  and Test Token (the token simulator's tokens, which link to a service)
	  -- all. Medical Services is reloaded by its own seed afterwards.
	Item Price -- every row, Standard Selling and Standard Buying included.
	Price List -- all but Standard Selling and Standard Buying. A Customer or
	  Supplier defaulting to a removed list is moved to the standard one.
	Item (with child rows), Stock Balance, Item Subgroup, Item Group -- all.

Then ITEM_GROUPS and ITEMS below are created. The rows are held here rather
than read from a spreadsheet, so this runs on a server that has no copy of the
file. They were taken from "Service List For ERP - Updated (1).xlsx", one
tuple per sheet row, with whitespace in the text trimmed and collapsed:

	(item_code, item_name, item_group, gov, service_charge, typing_charges,
	 transaction_charges, tax, base_unit)

The sheet's "Standard Selling Rate" column is not carried: Item.on_update sets
standard_selling_price, and creates the undated Standard Selling Item Price,
as the sum of the four charges -- and for every row in the sheet that sum
equals the rate it gives.

Safety: after the wipe, every Link and Dynamic Link field in the database is
checked for rows still pointing at a removed record (say, a Quotation or a
Purchase Invoice naming an Item). If any are found, nothing is committed and
they are listed.
"""

import frappe
from frappe.utils import cint, flt

KEEP_PRICE_LISTS = ("Standard Selling", "Standard Buying")

# Removed outright, with their child rows
TRANSACTIONS = ("Sales Invoice", "Sales Return", "Receipt Entry")
MASTERS = ("Medical Services", "Item", "Item Subgroup", "Item Group")

# item_group_name -> item_group_code. The code is required when Settings >
# Item Group Code Required is on, and it prefixes item codes generated for new
# items when Create Item Code From Item Group is on. Edit freely before running.
ITEM_GROUPS = {
	'AOE - Residence Visa': 'AOERV',
	'DXB - Residence Visa': 'DXBRV',
	'E Channel Services': 'ECH',
	'Embassy Service - Normal': 'EMBN',
	'Embassy Service Pre typed': 'EMBPT',
	'Emirates ID AOE': 'EIDAOE',
	'Emirates ID Golden Visa': 'EIDGV',
	'GOLDEN VISA': 'GV',
	'Health Card': 'HC',
	'Immigration and MOFA Services': 'IMM',
	'Insurance': 'INS',
	'Labor Services - Tasheel': 'TAS',
	'Labor Services - Tawjeeh': 'TAW',
	'OTHER SERVICES': 'OTH',
	'Sales Emirates ID': 'SEID',
	'Sales Medical': 'SMED',
	'MEDICAL SERVICE FEE': 'MSF',
	'AOE - Labor Services - Tasheel': 'AOETAS',
	'DXB - Labor Services - Tasheel': 'DXBTAS',
}

# (item_code, item_name, item_group, gov, service_charge, typing_charges,
#  transaction_charges, tax, base_unit)
ITEMS = (
	('VISA35', 'AOE Visa Modification', 'AOE - Residence Visa', 100.0, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('VISA09', 'Cancellation Sponsor AOE', 'AOE - Residence Visa', 202.84, 0.0, 40.0, 7.16, 'UAE VAT - 5%', 'PCS'),
	('VISA53', 'Data Modification AOE', 'AOE - Residence Visa', 202.84, 0.0, 40.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('VISA08', 'Entry Permit Sponsor AOE', 'AOE - Residence Visa', 353.91, 0.0, 40.0, 6.09, 'UAE VAT - 5%', 'PCS'),
	('VISA15', 'Residence Sponsor Visa AOE 1 Year', 'AOE - Residence Visa', 353.91, 0.0, 40.0, 9.66, 'UAE VAT - 5%', 'PCS'),
	('VISA25', 'AOE Sponsor File Opening', 'AOE - Residence Visa', 353.91, 0.0, 40.0, 6.09, 'UAE VAT - 5%', 'PCS'),
	('VISA12', 'Residence Sponsor Visa AOE 2 Years', 'AOE - Residence Visa', 454.62, 0.0, 40.0, 8.24, 'UAE VAT - 5%', 'PCS'),
	('VISA55', 'Sudanese Sharjah Visa & EID', 'AOE - Residence Visa', 555.34, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('VISA07', 'Change Status AOE', 'AOE - Residence Visa', 656.05, 0.0, 40.0, 3.95, 'UAE VAT - 5%', 'PCS'),
	('VISA36', 'Residence Sponsor Visa AOE 5 Years', 'AOE - Residence Visa', 761.66, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('VISA21', 'Other Third Party Charges AOE', 'AOE - Residence Visa', 3050.0, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('VISA14', 'Residence Cancellation DXB Inside', 'DXB - Residence Visa', 88.45, 0.0, 41.0, 80.55, 'UAE VAT - 5%', 'PCS'),
	('VISA59', 'Data Modification DXB', 'DXB - Residence Visa', 100.0, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('VISA57', 'Residence Cancellation DXB Outside', 'DXB - Residence Visa', 191.6, 0.0, 41.0, 77.4, 'UAE VAT - 5%', 'PCS'),
	('VISA23', 'Sponsor File Opening DXB', 'DXB - Residence Visa', 206.3, 0.0, 41.0, 52.7, 'UAE VAT - 5%', 'PCS'),
	('VISA18', 'Residence Visa DXB Sponsor New/Renewal 1 Year', 'DXB - Residence Visa', 316.41, 0.0, 41.0, 72.59, 'UAE VAT - 5%', 'PCS'),
	('VISA52', 'Entry Permit Outside Country DXB', 'DXB - Residence Visa', 346.32, 0.0, 41.0, 132.68, 'UAE VAT - 5%', 'PCS'),
	('VISA03', 'Residence Visa DXB Sponsor New/Renewal 2 Years', 'DXB - Residence Visa', 419.56, 0.0, 41.0, 69.44, 'UAE VAT - 5%', 'PCS'),
	('VISA10', 'Change Status DXB', 'DXB - Residence Visa', 666.0, 0.0, 34.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('VISA24', 'Entry Permit Inside Country DXB', 'DXB - Residence Visa', 1016.8, 0.0, 41.0, 102.2, 'UAE VAT - 5%', 'PCS'),
	('VISA62', 'Other Third Party Charges DXB', 'DXB - Residence Visa', 3150.0, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('VISA11', 'DXB Transaction Charge', 'DXB - Residence Visa', 0.0, 0.0, 80.55, 0.0, 'UAE VAT - 5%', 'PCS'),
	('OT26', 'E Channel Renewal', 'E Channel Services', 1159.62, 0.0, 40.38, 0.0, 'UAE VAT - 5%', 'PCS'),
	('EMBASSY01', 'Embassy Medical', 'Embassy Service - Normal', 261.86, 50.0, 38.14, 0.0, 'UAE VAT - 5%', 'PCS'),
	('EMBASSY02', 'Embassy Service Pre-Typed', 'Embassy Service Pre typed', 0.0, 50.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('VISA16', 'Emirates ID AOE 1 Year', 'Emirates ID AOE', 201.43, 0.0, 35.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('VISA13', 'Emirates ID AOE 2 Years', 'Emirates ID AOE', 302.14, 0.0, 35.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('VISA31', 'Emirates ID AOE 5 Years', 'Emirates ID AOE', 654.55, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('EID05', 'Golden Emirates ID DXB 10 Years (NEW RENEW)', 'Emirates ID Golden Visa', 1150.0, 0.0, 35.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('VISA28', 'Golden Visa AOE', 'Emirates ID Golden Visa', 1260.34, 600.0, 40.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('VISA29', 'Golden Visa DXB', 'Emirates ID Golden Visa', 2500.0, 600.0, 40.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('VISA33', 'Golden Visa AOE EID 10 Years', 'Emirates ID Golden Visa', 3150.0, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('VISA34', 'Golden Visa - AOE - Service Fee', 'Emirates ID Golden Visa', 0.0, 0.0, 0.0, 400.0, 'UAE VAT - 5%', 'PCS'),
	('VISA32', 'Golden Visa AOE Candidate Application', 'GOLDEN VISA', 60.0, 0.0, 100.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('OT11', 'Health Card UAE Citizens and GCC', 'Health Card', 30.21, 0.0, 29.79, 0.0, 'UAE VAT - 5%', 'PCS'),
	('M202', 'Drivers Health Card', 'Health Card', 110.0, 0.0, 50.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('OT010', 'Health Card Fee', 'Health Card', 115.0, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('OT09', 'Health Card Expatriate', 'Health Card', 115.82, 0.0, 44.18, 0.0, 'UAE VAT - 5%', 'PCS'),
	('H203', 'Food Handlers Health Card', 'Health Card', 161.14, 0.0, 38.86, 0.0, 'UAE VAT - 5%', 'PCS'),
	('H204', 'Beauticians & Related Services SPA Workers Health Card', 'Health Card', 260.0, 0.0, 60.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('OT16', 'License Update Immigration', 'Immigration and MOFA Services', 18.09, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('OT18', 'Foreign Affairs Attestation Normal', 'Immigration and MOFA Services', 151.07, 0.0, 48.93, 0.0, 'UAE VAT - 5%', 'PCS'),
	('OT12', 'Humanitarian Form', 'Immigration and MOFA Services', 152.48, 0.0, 47.52, 0.0, 'UAE VAT - 5%', 'PCS'),
	('OT20', 'Foreign Affairs Attestation Urgent', 'Immigration and MOFA Services', 302.0, 0.0, 102.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS021', 'IOL Ins. Fee', 'Insurance', 126.0, 0.0, 24.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS019', 'DXB Health Ins.', 'Insurance', 189.0, 0.0, 26.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS020', 'AOE Health Ins.', 'Insurance', 357.95, 0.0, 147.05, 0.0, 'UAE VAT - 5%', 'PCS'),
	('Labour', 'Labour Services', 'Labor Services - Tasheel', 18.09, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('OLLabour', 'Offer letter Contract Electronic preapproval work permit (Package) Labour', 'Labor Services - Tasheel', 50.36, 0.0, 249.64, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS032', 'UPDATE INFORMATION', 'Labor Services - Tasheel', 51.77, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('PREApproval', 'Submit pre approval work permit', 'Labor Services - Tasheel', 76.14, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS005', 'Establishment Card Data Establishment Card ReNew', 'Labor Services - Tasheel', 76.14, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS015', 'Renewal Work Permit', 'Labor Services - Tasheel', 76.14, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS024', 'Temporary Closure With Absconding', 'Labor Services - Tasheel', 76.14, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS014', 'New Work Permit', 'Labor Services - Tasheel', 138.79, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS001', 'Request Initial Approval', 'Labor Services - Tasheel', 152.48, 0.0, 47.52, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS011', 'Update Establishment', 'Labor Services - Tasheel', 253.2, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('OfferLetter', 'Offer letter Contract Electronic preapproval work permit (Package) Service', 'Labor Services - Tasheel', 278.77, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS073', 'Driving License Service', 'Labor Services - Tasheel', 322.0, 0.0, 28.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS003', 'Establishment Card Data Modification', 'Labor Services - Tasheel', 523.46, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS004', 'Establishment Card Data Establishment Card New', 'Labor Services - Tasheel', 555.34, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS023', 'Fees Payment (Second Visit 2/3)', 'Labor Services - Tasheel', 1208.57, 0.0, 75.43, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS0027', 'Labor fees (cat 3)', 'Labor Services - Tasheel', 3474.63, 0.0, 65.37, 0.0, 'UAE VAT - 5%', 'PCS'),
	('RenewLabour', 'Submit renew labour card', 'Labor Services - Tasheel', 3550.7, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAW001', 'Tawjeeh New', 'Labor Services - Tawjeeh', 152.28, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAW002', 'Tawjeeh Renew', 'Labor Services - Tawjeeh', 1360.85, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('VISA54', 'Data Modification - Others', 'OTHER SERVICES', 100.0, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('MOD1', 'Emirates ID Modification DXB', 'Sales Emirates ID', 100.0, 0.0, 35.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('VISA63', 'Visa Modification DXB', 'Sales Emirates ID', 100.0, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('EID01', 'Emirates ID 1 Year New / Renew', 'Sales Emirates ID', 253.2, 0.0, 31.8, 0.0, 'UAE VAT - 5%', 'PCS'),
	('EID02', 'Emirates ID 2 Year New / Renew', 'Sales Emirates ID', 353.91, 0.0, 31.09, 0.0, 'UAE VAT - 5%', 'PCS'),
	('EID12', 'Emirates ID Replacement Fee AOE', 'Sales Emirates ID', 454.62, 0.0, 30.38, 0.0, 'UAE VAT - 5%', 'PCS'),
	('EID13', 'Emirates ID Replacement Fee DXB', 'Sales Emirates ID', 454.62, 0.0, 30.38, 0.0, 'UAE VAT - 5%', 'PCS'),
	('EID03', 'Emirates ID 5 Year New / Renew', 'Sales Emirates ID', 535.91, 0.0, 34.09, 0.0, 'UAE VAT - 5%', 'PCS'),
	('M04', 'Vaccination Card', 'Sales Medical', 50.0, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('M05', 'Pregnancy Test', 'Sales Medical', 50.36, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('M01', 'Medical Category A', 'Sales Medical', 261.86, 50.0, 38.14, 0.0, 'UAE VAT - 5%', 'PCS'),
	('M41', 'Pre-Employment Medical', 'Sales Medical', 266.89, 50.0, 8.11, 0.0, 'UAE VAT - 5%', 'PCS'),
	('M42', 'Pre-employment Pre-typed', 'Sales Medical', 0.0, 50.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('M02', 'Medical Category B', 'Sales Medical', 312.22, 50.0, 37.78, 0.0, 'UAE VAT - 5%', 'PCS'),
	('M03', 'Medical Category C', 'Sales Medical', 362.57, 50.0, 37.43, 0.0, 'UAE VAT - 5%', 'PCS'),
	('M08', 'Medical Service', 'MEDICAL SERVICE FEE', 0.0, 50.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('OT1', 'Photograph', 'OTHER SERVICES', 0.0, 30.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('OT2', 'RTA License', 'OTHER SERVICES', 322.0, 0.0, 28.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('OT3', 'Business Setup - Freezone', 'OTHER SERVICES', 5000.0, 1000.0, 0.0, 200.0, 'UAE VAT - 5%', 'PCS'),
	('OT4', 'Business Setup - Main Land', 'OTHER SERVICES', 5000.0, 1000.0, 0.0, 200.0, 'UAE VAT - 5%', 'PCS'),
	('OT5', 'Ejari Service', 'OTHER SERVICES', 500.0, 0.0, 200.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('VIP1', 'HOME VIP Service', 'MEDICAL SERVICE FEE', 0.0, 200.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('VIP2', 'Medical Service Fee - Urgent - 04 Hours', 'MEDICAL SERVICE FEE', 0.0, 400.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('VIP3', 'Medical Service Fee - Fast Track - 24 Hours', 'MEDICAL SERVICE FEE', 0.0, 150.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('VIP4', 'Medical Service Fee - Urgent - 08 Hours', 'MEDICAL SERVICE FEE', 0.0, 300.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS037', 'Noqodi Charges', 'Labor Services - Tasheel', 0.0, 3.15, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS038', 'Typing Temporary Pre-Approval for Work Permit Application', 'Labor Services - Tasheel', 50.36, 0.0, 59.64, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS039', 'Lost Soft Token - Establishments Govt. Fee', 'Labor Services - Tasheel', 595.0, 0.0, 110.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS040', 'Renew Electronic Work Permit', 'Labor Services - Tasheel', 76.14, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS041', 'Pre Approval for Work Permit Payment Fees', 'Labor Services - Tasheel', 76.14, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS042', 'Instant Quota Modify', 'Labor Services - Tasheel', 76.14, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS043', 'Provide Information about Workload for Quota Requests', 'Labor Services - Tasheel', 409.25, 0.0, 65.75, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS044', 'New Pro Card', 'Labor Services - Tasheel', 372.5, 0.0, 77.5, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS045', 'Renew Pro Card', 'Labor Services - Tasheel', 422.5, 0.0, 77.5, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS046', 'Cancel PRO', 'Labor Services - Tasheel', 222.5, 0.0, 67.5, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS047', 'Renew Verify Contract Workpermit Service', 'Labor Services - Tasheel', 3474.63, 0.0, 65.37, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS048', 'Golden Visa Pre Approval for Work Permit', 'Labor Services - Tasheel', 50.36, 0.0, 110.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS049', 'Relative Work Contract', 'Labor Services - Tasheel', 50.36, 0.0, 110.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS050', 'Entry Permit Company Visa AOE', 'AOE - Labor Services - Tasheel', 353.91, 0.0, 41.09, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS051', 'Change Status Company Visa AOE', 'AOE - Labor Services - Tasheel', 656.05, 0.0, 43.95, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS052', 'Residence Company Visa AOE 2 Years', 'AOE - Labor Services - Tasheel', 454.62, 0.0, 35.0, 3.24, 'UAE VAT - 5%', 'PCS'),
	('TAS053', 'Emirates ID AOE Company Visa 2 Years', 'AOE - Labor Services - Tasheel', 302.14, 0.0, 30.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS054', 'Cancellation Company Visa AOE', 'AOE - Labor Services - Tasheel', 202.84, 0.0, 42.16, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS055', 'Entry Permit Company Visa Inside Country DXB', 'DXB - Labor Services - Tasheel', 1022.5, 0.0, 112.5, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS056', 'Entry Permit Company Visa Outside Country DXB', 'DXB - Labor Services - Tasheel', 387.5, 0.0, 112.5, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS057', 'Change Status Company Visa DXB', 'DXB - Labor Services - Tasheel', 572.5, 0.0, 112.5, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS058', 'Residence Cancellation Company Visa Inside DXB', 'DXB - Labor Services - Tasheel', 122.5, 0.0, 77.5, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS059', 'Residence Cancellation Company Visa Outside DXB', 'DXB - Labor Services - Tasheel', 222.5, 0.0, 102.5, 0.0, 'UAE VAT - 5%', 'PCS'),
	('TAS060', 'Residence Company Visa DXB New/Renewal 2 Years', 'DXB - Labor Services - Tasheel', 443.5, 0.0, 96.5, 0.0, 'UAE VAT - 5%', 'PCS'),
	('VISA40', 'Secuiity Deposit - AOE', 'AOE - Residence Visa', 0.0, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('VISA41', 'Secuiity Deposit - DXB', 'DXB - Residence Visa', 0.0, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('VISA42', 'Visa Fine - DXB', 'DXB - Residence Visa', 0.0, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('VISA43', 'Visa Fine - AOE', 'AOE - Residence Visa', 0.0, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('VISA44', 'Emirates ID Fine - DXB', 'DXB - Residence Visa', 0.0, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('VISA45', 'Emirates ID Fine - AOE', 'AOE - Residence Visa', 0.0, 0.0, 0.0, 0.0, 'UAE VAT - 5%', 'PCS'),
	('VISA46', 'Company Fine', 'DXB - Labor Services - Tasheel', 0.0, 0.0, 0.0, 0.0, '', ''),
)


def run(dry_run=1, confirm=None):
	"""Wipe, check, import; commit only on a real run with nothing left dangling.

	:param dry_run: 1 (the default) rolls everything back at the end.
	:param confirm: the site name; required when dry_run is 0.
	"""
	dry_run = cint(dry_run)
	site = frappe.local.site

	if not dry_run and confirm != site:
		frappe.throw(f"A real run needs confirm='{site}'.")

	print(f"\nClean start seed on {site}" + (" [dry run]" if dry_run else ""))

	try:
		removed = wipe()
		blockers = find_dangling_links()

		if blockers:
			frappe.db.rollback()
			print_report(removed)
			print("\n  ABORTED, nothing was changed. These rows still point at removed records:")
			for line in blockers:
				print(f"    ! {line}")
			print("  Clear or repoint them, or add their doctype to this seed, then run again.")
			return {"aborted": True, "blockers": blockers}

		groups = import_item_groups()
		created, problems = import_items()
		prices = frappe.db.count("Item Price")

		if problems:
			frappe.db.rollback()
			print_report(removed, groups, created, problems, prices=prices)
			print("\n  ABORTED, nothing was changed: fix the rows above.")
			return {"aborted": True, "problems": problems}

		if dry_run:
			frappe.db.rollback()
		else:
			frappe.db.commit()
			frappe.clear_cache()

	except Exception:
		frappe.db.rollback()
		raise

	print_report(removed, groups, created, problems, prices=prices)
	print("\n  " + ("Dry run: everything was rolled back." if dry_run else "Committed."))

	return {
		"removed": removed,
		"item_groups": len(groups),
		"items": len(created),
		"dry_run": bool(dry_run),
	}


def wipe():
	"""Delete everything listed in the module docstring. Returns {label: rows}."""
	removed = {}
	in_transactions = ", ".join(["%s"] * len(TRANSACTIONS))

	removed["Medical Service Logs"] = delete_with_children("Medical Service Logs")
	removed["Test Token"] = delete_with_children("Test Token")

	removed["GL Posting"] = delete("GL Posting", f"voucher_type in ({in_transactions})", TRANSACTIONS)
	removed["Stock Ledger"] = delete("Stock Ledger", f"voucher in ({in_transactions})", TRANSACTIONS)
	removed["Document Posting Status"] = delete(
		"Document Posting Status", f"document_type in ({in_transactions})", TRANSACTIONS)

	history = TRANSACTIONS + MASTERS + ("Item Price",)
	in_history = ", ".join(["%s"] * len(history))
	removed["Comment"] = delete("Comment", f"reference_doctype in ({in_history})", history)
	removed["Version"] = delete("Version", f"ref_doctype in ({in_history})", history)

	for doctype in TRANSACTIONS:
		removed[doctype] = delete_with_children(doctype)

	removed["Item Price"] = delete_with_children("Item Price")

	in_keep = ", ".join(["%s"] * len(KEEP_PRICE_LISTS))
	for doctype, fallback in (("Customer", "Standard Selling"), ("Supplier", "Standard Buying")):
		if frappe.get_meta(doctype).has_field("default_price_list"):
			repointed = frappe.db.sql(
				f"""update `tab{doctype}` set default_price_list = %s
				where ifnull(default_price_list, '') != '' and default_price_list not in ({in_keep})""",
				(fallback, *KEEP_PRICE_LISTS))
			removed[f"{doctype} price list -> {fallback}"] = frappe.db._cursor.rowcount

	removed["Price List"] = delete_with_children("Price List", f"name not in ({in_keep})", KEEP_PRICE_LISTS)
	removed["Stock Balance"] = delete("Stock Balance")

	for doctype in MASTERS:
		removed[doctype] = delete_with_children(doctype)

	return removed


def delete(doctype, where="1=1", values=()):
	count = frappe.db.sql(f"select count(*) from `tab{doctype}` where {where}", values)[0][0]
	if count:
		frappe.db.sql(f"delete from `tab{doctype}` where {where}", values)
	return count


def delete_with_children(doctype, where="1=1", values=()):
	"""Delete matching rows of doctype and the child rows hanging off them."""
	for table_field in frappe.get_meta(doctype).get_table_fields():
		frappe.db.sql(
			f"""delete from `tab{table_field.options}` where parenttype = %s
			and parent in (select name from `tab{doctype}` where {where})""",
			(doctype, *values))
	return delete(doctype, where, values)


def find_dangling_links():
	"""Rows anywhere that still name a removed record, as 'Doctype.field: n rows'.

	Link fields are checked across every doctype; Dynamic Link fields only
	within this app, so framework logs (File, ToDo, Activity Log, ...) that
	mention an old invoice or item do not block the run.
	"""
	targets = TRANSACTIONS + MASTERS + ("Price List", "Item Price")
	in_targets = ", ".join(["%s"] * len(targets))

	links = frappe.db.sql(f"""
		select parent, fieldname, options from `tabDocField`
		where fieldtype = 'Link' and options in ({in_targets})
		union
		select dt, fieldname, options from `tabCustom Field`
		where fieldtype = 'Link' and options in ({in_targets})""", targets + targets)

	blockers = []

	for doctype, fieldname, target in links:
		if not has_column(doctype, fieldname):
			continue
		count = frappe.db.sql(f"""
			select count(*) from `tab{doctype}` d
			where ifnull(d.`{fieldname}`, '') != ''
			and not exists (select 1 from `tab{target}` t where t.name = d.`{fieldname}`)""")[0][0]
		if count:
			blockers.append(f"{doctype}.{fieldname} -> {target}: {count} rows")

	app_doctypes = frappe.get_all(
		"DocType", filters={"module": ["in", frappe.get_module_list("digitz_erp")]}, pluck="name")
	dynamic = frappe.get_all(
		"DocField", filters={"fieldtype": "Dynamic Link", "parent": ["in", app_doctypes]},
		fields=["parent", "fieldname", "options"])

	for field in dynamic:
		if not has_column(field.parent, field.fieldname) or not has_column(field.parent, field.options):
			continue
		count = frappe.db.sql(f"""
			select count(*) from `tab{field.parent}`
			where `{field.options}` in ({in_targets}) and ifnull(`{field.fieldname}`, '') != ''""",
			targets)[0][0]
		if count:
			blockers.append(f"{field.parent}.{field.fieldname} (dynamic): {count} rows")

	return blockers


def has_column(doctype, fieldname):
	if frappe.db.get_value("DocType", doctype, "issingle") or not frappe.db.table_exists(doctype):
		return False
	return frappe.db.has_column(doctype, fieldname)


def import_item_groups():
	created = []
	for group, code in ITEM_GROUPS.items():
		frappe.get_doc({
			"doctype": "Item Group",
			"item_group_name": group,
			"description": group,
			"item_group_code": code,
		}).insert(ignore_permissions=True)
		created.append(group)
	return created


def import_items():
	"""Create ITEMS. Returns (created codes, [(position, code, reason)])."""
	created, problems, seen = [], [], set()

	# Settings that would otherwise get in the way of a bulk load:
	# - in_import keeps the sheet's item_code; with Create Item Code From
	#   Item Group on, Item.before_naming would otherwise replace it
	# - the sheet has no Arabic names, so the mandatory check is lifted for
	#   the load and restored after (both inside this transaction)
	arabic_mandatory = frappe.db.get_single_value("Settings", "item_name_arabic_mandatory")
	if arabic_mandatory:
		frappe.db.set_single_value("Settings", "item_name_arabic_mandatory", 0)

	frappe.flags.in_import = True
	frappe.flags.mute_messages = True

	try:
		for position, row in enumerate(ITEMS, start=1):
			code, name, group, gov, service_charge, typing, transaction, tax, unit = row

			if code.lower() in seen:
				problems.append((position, code, "duplicate item_code"))
				continue
			seen.add(code.lower())

			if group not in ITEM_GROUPS:
				problems.append((position, code, f"item group '{group}' is not in ITEM_GROUPS"))
				continue
			if tax and not frappe.db.exists("Tax", tax):
				problems.append((position, code, f"Tax '{tax}' does not exist"))
				continue
			if unit and not frappe.db.exists("Unit", unit):
				problems.append((position, code, f"Unit '{unit}' does not exist"))
				continue

			item = {
				"doctype": "Item",
				"item_code": code,
				"item_name": name,
				"item_group": group,
				"item_type": "Service",
				"gov": flt(gov),
				"service_charge": flt(service_charge),
				"typing_charges": flt(typing),
				"transaction_charges": flt(transaction),
				"tax": tax or None,
				# The Item.json default does not reach a dict insert; a blank unit
				# would also become a blank Item Unit row in before_validate
				"base_unit": unit or "PCS",
				# Item.update_standard_buying_price compares this with > 0, so None fails
				"standard_buying_price": 0,
			}
			frappe.get_doc(item).insert(ignore_permissions=True)
			created.append(code)
	finally:
		frappe.flags.in_import = False
		frappe.flags.mute_messages = False
		if arabic_mandatory:
			frappe.db.set_single_value("Settings", "item_name_arabic_mandatory", arabic_mandatory)

	return created, problems



def print_report(removed, groups=(), created=(), problems=(), prices=0):
	print("\n  Removed")
	for label, count in removed.items():
		print(f"    {label:<40} {count}")

	print("\n  Imported")
	print(f"    {'Item Group':<40} {len(groups)}")
	print(f"    {'Item':<40} {len(created)} of {len(ITEMS)}")
	print(f"    {'Item Price (Standard Selling)':<40} {prices}")

	for position, code, reason in problems:
		print(f"    ! #{position}: {code} -- {reason}")

