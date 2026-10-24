# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""Wipe sales transactions and the item master, then load the new service list
and the Medical Services built on it.

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
	  -- all.
	Item Price -- every row, Standard Selling and Standard Buying included.
	Price List -- all but Standard Selling and Standard Buying. A Customer or
	  Supplier defaulting to a removed list is moved to the standard one.
	Item (with child rows), Stock Balance, Item Subgroup, Item Group -- all.

Then ITEM_GROUPS and ITEMS below are created, and Medical Services is
reloaded from medical_service_seed.SERVICES, all in the same transaction. The
rows are held here rather than read from a spreadsheet, so this runs on a
server that has no copy of the file. They were taken from the first sheet of
"Service List For ERP -22.10.2026 -  FINAL.xlsx", one tuple per sheet row,
with whitespace in the text trimmed and collapsed:

	(item_code, item_name, item_name_arabic, item_group, gov, service_charge,
	 typing_charges, transaction_charges)

Every item gets TAX and BASE_UNIT. The sheet's "Standard Selling Rate" column
is not carried: Item.on_update sets standard_selling_price, and creates the
undated Standard Selling Item Price, as the sum of the four charges. That sum
equals the sheet's rate on every row but VISA 69, where the charges add up to
100.01 against a rate of 100.

Safety: after the wipe, every Link and Dynamic Link field in the database is
checked for rows still pointing at a removed record (say, a Quotation or a
Purchase Invoice naming an Item). If any are found, nothing is committed and
they are listed.
"""

import frappe
from frappe.utils import cint, flt

from digitz_erp.seeds import medical_service_seed

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
	'AOE - Labor Services - Tasheel': 'AOETAS',
	'DXB - Labor Services - Tasheel': 'DXBTAS',
	'Tadbeer Services': 'TADB',
	'Tasheel': 'TSH',
	'Embassy Service Pre typed': 'EMBPT',
	'MEDICAL SERVICE FEE': 'MSF',
}

# Every item gets the same tax and unit
TAX = "UAE VAT - 5%"
BASE_UNIT = "PCS"

# (item_code, item_name, item_name_arabic, item_group, gov, service_charge,
#  typing_charges, transaction_charges)
ITEMS = (
	('VISA35', 'AOE Visa Modification', 'تعديل بيانات الإقامة - الإمارات الشمالية', 'AOE - Residence Visa', 100.0, 0.0, 0.0, 0.0),
	('VISA09', 'Cancellation Sponsor AOE', 'إلغاء الإقامة - الإمارات الشمالية', 'AOE - Residence Visa', 202.84, 0.0, 40.0, 7.16),
	('VISA53', 'Data Modification AOE', 'تعديل بيانات - الإمارات الشمالية', 'AOE - Residence Visa', 202.84, 0.0, 40.0, 0.0),
	('VISA08', 'Entry Permit Sponsor AOE', 'إذن دخول - الإمارات الشمالية', 'AOE - Residence Visa', 353.91, 0.0, 40.0, 6.09),
	('VISA15', 'Residence Sponsor Visa AOE 1 Year', 'اقامة - سنة - الإمارات الشمالية', 'AOE - Residence Visa', 353.91, 0.0, 40.0, 9.66),
	('VISA25', 'AOE Sponsor File Opening', 'فتح ملف كفيل - الإمارات الشمالية', 'AOE - Residence Visa', 353.91, 0.0, 40.0, 6.09),
	('VISA12', 'Residence Sponsor Visa AOE 2 Years', 'اقامة - سنتان - الإمارات الشمالية', 'AOE - Residence Visa', 454.62, 0.0, 40.0, 8.24),
	('VISA55', 'Sudanese Sharjah Visa & EID', 'اقامة و هوية إماراتية - السودانيين - الإمارات الشمالية', 'AOE - Residence Visa', 555.34, 0.0, 0.0, 0.0),
	('VISA07', 'Change Status AOE', 'تعديل وضع - الإمارات الشمالية', 'AOE - Residence Visa', 656.05, 0.0, 40.0, 3.95),
	('VISA36', 'Residence Sponsor Visa AOE 5 Years', 'اقامة - خمس سنوات - الامارات الشمالية', 'AOE - Residence Visa', 761.66, 0.0, 0.0, 0.0),
	('VISA21', 'Other Third Party Charges AOE', 'رسوم الطرف الثالث الاخرى - الإمارات الشمالية', 'AOE - Residence Visa', 3050.0, 0.0, 0.0, 0.0),
	('VISA14', 'Residence Cancellation DXB Inside', 'إلغاء الإقامة - داخل الدولة - دبي', 'DXB - Residence Visa', 88.45, 0.0, 41.0, 80.55),
	('VISA59', 'Data Modification DXB', 'تعديل بيانات - دبي', 'DXB - Residence Visa', 100.0, 0.0, 0.0, 0.0),
	('VISA57', 'Residence Cancellation DXB Outside', 'الغاء الاقامة - خارج الدولة - دبي', 'DXB - Residence Visa', 191.6, 0.0, 41.0, 77.4),
	('VISA23', 'Sponsor File Opening DXB', 'فتح ملف كفيل - دبي', 'DXB - Residence Visa', 206.3, 0.0, 41.0, 52.7),
	('VISA18', 'Residence Sponsor Visa DXB 1 Year', 'اقامة - سنة - دبي', 'DXB - Residence Visa', 316.41, 0.0, 41.0, 72.59),
	('VISA52', 'Entry Permit Outside Country DXB', 'إذن دخول - خارج الدولة - دبي', 'DXB - Residence Visa', 346.32, 0.0, 41.0, 132.68),
	('VISA03', 'Residence Visa DXB Sponsor New/Renewal 2 Years', 'اقامة - سنتان - دبي - جديد/تجديد', 'DXB - Residence Visa', 419.56, 0.0, 41.0, 69.44),
	('VISA10', 'Change Status DXB', 'تعديل وضع - دبي', 'DXB - Residence Visa', 666.0, 0.0, 34.0, 0.0),
	('VISA24', 'Entry Permit Inside Country DXB', 'إذن دخول - داخل الدولة - دبي', 'DXB - Residence Visa', 1016.8, 0.0, 41.0, 102.2),
	('VISA62', 'Other Third Party Charges DXB', 'رسوم الطرف الثالث الاخرى - دبي', 'DXB - Residence Visa', 3150.0, 0.0, 0.0, 0.0),
	('VISA11', 'DXB Transaction Charge', 'رسوم المعاملات - دبي', 'DXB - Residence Visa', 0.0, 0.0, 80.55, 0.0),
	('OT26', 'E Channel Renewal', 'تجديد القناة الرقمية', 'E Channel Services', 1159.62, 0.0, 40.38, 0.0),
	('EMBASSY01', 'Embassy Service Medical', 'الفحص الطبي للسفارات', 'Embassy Service - Normal', 261.86, 0.0, 88.14, 0.0),
	('VISA16', 'Emirates ID AOE 1 Year', 'الهوية الإماراتية - سنة - الإمارات الشمالية', 'Emirates ID AOE', 201.43, 0.0, 35.0, 0.0),
	('VISA13', 'Emirates ID AOE 2 Years', 'الهوية الإماراتية - سنتان - الإمارات الشمالية', 'Emirates ID AOE', 302.14, 0.0, 35.0, 0.0),
	('VISA31', 'Emirates ID AOE 5 Years', 'الهوية الإماراتية - خمس سنوات - الامارات الشمالية', 'Emirates ID AOE', 654.55, 0.0, 0.0, 0.0),
	('EID05', 'Golden Emirates ID DXB 10 Years (NEW RENEW)', 'الهوية الإماراتية - الذهبية - عشر سنوات - دبي', 'Emirates ID Golden Visa', 1150.0, 0.0, 35.0, 0.0),
	('VISA28', 'Golden Visa AOE', 'الاقامة الذهبية - الإمارات الشمالية', 'Emirates ID Golden Visa', 1260.34, 600.0, 40.0, 0.0),
	('VISA29', 'Golden Visa DXB', 'الاقامة الذهبية - دبي', 'Emirates ID Golden Visa', 2500.0, 600.0, 40.0, 0.0),
	('VISA33', 'Golden Visa AOE EID 10 Years', 'الهوية الإماراتية - الذهبية - عشر سنوات - الامارات الشمالية', 'Emirates ID Golden Visa', 3150.0, 0.0, 0.0, 0.0),
	('VISA34', 'Golden Visa - AOE - Service Fee', 'الاقامة الذهبية - مصاريف الخدمة - الإمارات الشمالية', 'Emirates ID Golden Visa', 0.0, 0.0, 0.0, 400.0),
	('VISA32', 'Golden Visa AOE Candidate Application', 'الاقامة الذهبية - طلب ترشيح - الإمارات الشمالية', 'GOLDEN VISA', 60.0, 0.0, 100.0, 0.0),
	('OT11', 'Health Card UAE Citizens and GCC', 'البطاقة الصحية - المواطنين ودول مجلس التعاون الخليجي', 'Health Card', 30.21, 0.0, 29.79, 0.0),
	('M202', 'Drivers Health Card', 'البطاقة الصحية للسائقين', 'Health Card', 110.0, 0.0, 50.0, 0.0),
	('OT09', 'Health Card Expatriate', 'البطاقة الصحية - للوافدين', 'Health Card', 115.82, 0.0, 44.18, 0.0),
	('203', 'Food Handlers Health Card', 'البطاقة الصحية لمقدمى الطعام', 'Health Card', 161.14, 0.0, 38.86, 0.0),
	('204', 'Beauticians & Related Services SPA Workers Health Card', 'البطاقة الصحية للعاملين بخدمات التجميل', 'Health Card', 260.0, 0.0, 60.0, 0.0),
	('OT16', 'License Update Immigration', 'تحديث الرخصة - الجوازات', 'Immigration and MOFA Services', 18.09, 0.0, 0.0, 0.0),
	('OT18', 'Foreign Affairs Attestation Normal', 'تصديق وزارة الخارجية - عادي', 'Immigration and MOFA Services', 151.07, 48.93, 0.0, 0.0),
	('OT12', 'Humanitarian Form', 'طلب حالة إنسانية', 'Immigration and MOFA Services', 152.48, 0.0, 47.52, 0.0),
	('OT20', 'Foreign Affairs Attestation Urgent', 'تصديق وزارة الخارجية - مستعجل', 'Immigration and MOFA Services', 302.0, 102.0, 0.0, 0.0),
	('TAS021', 'IOL Ins. Fee', 'تأمين التعطل عن العمل', 'Insurance', 126.0, 0.0, 24.0, 0.0),
	('TAS019', 'DXB Health Ins.', 'التأمين الصحي - دبي', 'Insurance', 189.0, 0.0, 26.0, 0.0),
	('TAS020', 'AOE Health Ins.', 'التأمين الصحي - الإمارات الشمالية', 'Insurance', 357.95, 0.0, 147.05, 0.0),
	('Labour', 'Labour Services', 'خدمات العمالة', 'Labor Services - Tasheel', 18.09, 0.0, 0.0, 0.0),
	('OLLabour', 'Offer letter Contract Electronic preapproval work permit (Package) Labour', 'باقة خدمات العمالة - خطاب التوظيف و العقد و الموافقة المبدئية لتصريح العمل', 'Labor Services - Tasheel', 50.36, 249.64, 0.0, 0.0),
	('TAS032', 'UPDATE INFORMATION', 'تحديث بيانات', 'Labor Services - Tasheel', 51.77, 0.0, 0.0, 0.0),
	('PREApproval', 'Submit pre approval work permit', 'طلب الموافقة المبدئية لتصريح العمل', 'Labor Services - Tasheel', 76.14, 0.0, 0.0, 0.0),
	('TAS005', 'Establishment Card Data Establishment Card ReNew', 'تجديد بطاقة المنشأة', 'Labor Services - Tasheel', 76.14, 0.0, 0.0, 0.0),
	('TAS015', 'Renewal Work Permit', 'تجديد تصريح العمل', 'Labor Services - Tasheel', 76.14, 0.0, 0.0, 0.0),
	('TAS024', 'Temporary Closure With Absconding', 'الإغلاق المؤقت للملف - تسجيل هروب', 'Labor Services - Tasheel', 76.14, 0.0, 0.0, 0.0),
	('TAS014', 'New Work Permit', 'تصريح عمل جديد', 'Labor Services - Tasheel', 138.79, 0.0, 0.0, 0.0),
	('TAS001', 'Request Initial Approval', 'طلب الموافقة المبدئية', 'Labor Services - Tasheel', 152.48, 0.0, 47.52, 0.0),
	('TAS011', 'Update Establishment', 'تحديث بطاقة المنشأة', 'Labor Services - Tasheel', 253.2, 0.0, 0.0, 0.0),
	('OfferLetter', 'Offer letter Contract Electronic preapproval work permit (Package) Service', 'باقة خدمات - خطاب التوظيف و العقد و الموافقة المبدئية لتصريح العمل', 'Labor Services - Tasheel', 278.77, 0.0, 0.0, 0.0),
	('TAS073', 'Driving License Service', 'خدمة رخصة القيادة', 'Labor Services - Tasheel', 322.0, 0.0, 28.0, 0.0),
	('TAS003', 'Establishment Card Data Modification', 'تعديل بيانات بطاقة المنشأة', 'Labor Services - Tasheel', 523.46, 0.0, 0.0, 0.0),
	('TAS004', 'Establishment Card Data Establishment Card New', 'إصدار بطاقة المنشأة - جديد', 'Labor Services - Tasheel', 555.34, 0.0, 0.0, 0.0),
	('TAS023', 'Fees Payment (Second Visit 2/3)', 'مصاريف الزيارة الثانية/الثالثة', 'Labor Services - Tasheel', 1208.57, 0.0, 75.43, 0.0),
	('TAS027', 'Labor fees (cat 3)', 'مصاريف العمالة - الفئة الثالثة', 'Labor Services - Tasheel', 3474.63, 0.0, 65.37, 0.0),
	('RenewLabour', 'Submit renew labour card', 'تجديد بطاقة العمل', 'Labor Services - Tasheel', 3550.7, 0.0, 0.0, 0.0),
	('TAW001', 'Tawjeeh New', 'توجيه - جديد', 'Labor Services - Tawjeeh', 152.28, 0.0, 0.0, 0.0),
	('TAW002', 'Tawjeeh Renew', 'توجيه - تجديد', 'Labor Services - Tawjeeh', 1360.85, 0.0, 0.0, 0.0),
	('VISA54', 'Data Modification - Others', 'تعديل بيانات - أخرى', 'OTHER SERVICES', 100.0, 0.0, 0.0, 0.0),
	('MOD1', 'Emirates ID Modification DXB', 'تعديل بيانات الهوية الإماراتية - دبي', 'Sales Emirates ID', 100.0, 0.0, 0.0, 0.0),
	('VISA63', 'Visa Modification DXB', 'تعديل بيانات الإقامة - دبي', 'Sales Emirates ID', 100.0, 0.0, 0.0, 0.0),
	('EID01', 'Emirates ID 1 Year New / Renew', 'الهوية الإماراتية - سنة - جديد/تجديد - دبي', 'Sales Emirates ID', 253.2, 0.0, 31.8, 0.0),
	('EID02', 'Emirates ID 2 Year New / Renew', 'الهوية الإماراتية - سنتان - جديد/تجديد - دبي', 'Sales Emirates ID', 353.91, 0.0, 31.09, 0.0),
	('EID12', 'Emirates ID Replacement Fee AOE', 'الهوية الإماراتية - بدل فاقد - الإمارات الشمالية', 'Sales Emirates ID', 454.62, 0.0, 30.38, 0.0),
	('EID13', 'Emirates ID Replacement Fee DXB', 'الهوية الإماراتية - بدل فاقد - دبي', 'Sales Emirates ID', 454.62, 0.0, 30.38, 0.0),
	('EID03', 'Emirates ID 5 Year New / Renew', 'الهوية الإماراتية - خمس سنوات - جديد/تجديد', 'Sales Emirates ID', 535.91, 0.0, 0.0, 0.0),
	('M04', 'Vaccination Card', 'بطاقة التطعيم', 'Sales Medical', 50.0, 0.0, 0.0, 0.0),
	('M05', 'Pregnancy Test', 'فحص الحمل', 'Sales Medical', 50.36, 0.0, 0.0, 0.0),
	('M01', 'Medical Category A', 'الفحص الطبي - الفئة "A"', 'Sales Medical', 261.86, 50.0, 38.14, 0.0),
	('M41', 'Pre Employment . Fee', 'الفحص الطبي - ما قبل العمل', 'Sales Medical', 266.89, 50.0, 8.11, 0.0),
	('M02', 'Medical Category B', 'الفحص الطبي - الفئة "B"', 'Sales Medical', 312.22, 50.0, 37.78, 0.0),
	('M03', 'Medical Category C', 'الفحص الطبي - الفئة "C"', 'Sales Medical', 362.57, 50.0, 37.43, 0.0),
	('M08', 'Medical Service', 'الفحص الطبي - رسوم الخدمة', 'Sales Medical', 0.0, 50.0, 0.0, 0.0),
	('TAS017', 'Noqodi Charges', 'نقودى', 'Labor Services - Tasheel', 0.0, 3.15, 0.0, 0.0),
	('TAS016', 'Typing Temporary Pre-Approval for Work Permit Application', 'طباعة الموافقة المبدئية لتصريح العمل المؤقت', 'Labor Services - Tasheel', 50.36, 0.0, 59.64, 0.0),
	('TAS013', 'Lost Soft Token - Establishments Govt. Fee', 'بدل فاقد للسوفت توكن - منشآت - المصاريف الحكومية', 'Labor Services - Tasheel', 595.0, 0.0, 110.0, 0.0),
	('TAS039', 'Renew Electronic Work Permit', 'تجديد تصريح العمل الالكترونى', 'Labor Services - Tasheel', 76.14, 0.0, 0.0, 0.0),
	('TAS040', 'Pre Approval for Work Permit Payment Fees', 'الموافقة المبدئية لدفع تصريح العمل', 'Labor Services - Tasheel', 76.14, 0.0, 0.0, 0.0),
	('TAS041', 'Instant Quota Modify', 'تعديل حصة تصاريح العمل', 'Labor Services - Tasheel', 76.14, 0.0, 0.0, 0.0),
	('TAS042', 'Provide Information about Workload for Quota Requests', 'طلب تقدير حجم العمل', 'Labor Services - Tasheel', 409.25, 0.0, 65.75, 0.0),
	('TAS043', 'New Pro Card', 'إصدار بطاقة مندوب علاقات عامة', 'Labor Services - Tasheel', 372.5, 0.0, 77.5, 0.0),
	('TAS044', 'Renew Pro Card', 'تجديد بطاقة مندوب علاقات عامة', 'Labor Services - Tasheel', 422.5, 0.0, 77.5, 0.0),
	('TAS045', 'Cancel Pro Card', 'إلغاء بطاقة مندوب علاقات عامة', 'Labor Services - Tasheel', 222.5, 0.0, 67.5, 0.0),
	('TAS046', 'Renew Verify Contract Workpermit Service', 'الموافقة المبدئية لتصريح العمل', 'Labor Services - Tasheel', 3474.63, 0.0, 65.37, 0.0),
	('TAS047', 'Golden Visa Pre Approval for Work Permit', 'الموافقة المبدئية لتصريح العمل - الاقامة الذهبية', 'Labor Services - Tasheel', 50.36, 0.0, 110.0, 0.0),
	('TAS048', 'Relative Work Contract', 'عقد عمل - الاقارب', 'Labor Services - Tasheel', 50.36, 0.0, 110.0, 0.0),
	('TAS049', 'Entry Permit Company Visa AOE', 'إذن دخول - شركات - الإمارات الشمالية', 'AOE - Labor Services - Tasheel', 353.91, 0.0, 41.09, 0.0),
	('TAS050', 'Change Status Company Visa AOE', 'تعديل وضع - شركات - الإمارات الشمالية', 'AOE - Labor Services - Tasheel', 656.05, 0.0, 43.95, 0.0),
	('TAS051', 'Residence Company Visa AOE 2 Years', 'إقامة - شركات - سنتان - الإمارات الشمالية', 'AOE - Labor Services - Tasheel', 454.62, 0.0, 35.0, 3.24),
	('TAS052', 'Emirates ID AOE Company Visa 2 Years', 'الهوية الإماراتية - شركات - سنتان - الإمارات الشمالية', 'AOE - Labor Services - Tasheel', 302.14, 0.0, 30.0, 0.0),
	('TAS053', 'Cancellation Company Visa AOE', 'إلغاء الإقامة - شركات - الإمارات الشمالية', 'AOE - Labor Services - Tasheel', 202.84, 0.0, 42.16, 0.0),
	('TAS054', 'Entry Permit Company Visa Inside Country DXB', 'إذن دخول - داخل الدولة - شركات - الإمارات الشمالية', 'DXB - Labor Services - Tasheel', 1022.5, 0.0, 112.5, 0.0),
	('TAS055', 'Entry Permit Company Visa Outside Country DXB', 'إذن دخول - خارج الدولة - شركات - الإمارات الشمالية', 'DXB - Labor Services - Tasheel', 387.5, 0.0, 112.5, 0.0),
	('TAS056', 'Change Status Company Visa DXB', 'تعديل وضع - شركات - دبي', 'DXB - Labor Services - Tasheel', 572.5, 0.0, 112.5, 0.0),
	('TAS057', 'Residence Cancellation Company Visa Inside DXB', 'إلغاء الإقامة - داخل الدولة - شركات - دبي', 'DXB - Labor Services - Tasheel', 122.5, 0.0, 77.5, 0.0),
	('TAS058', 'Residence Cancellation Company Visa Outside DXB', 'الغاء الاقامة -خارج الدولة - شركات - دبي', 'DXB - Labor Services - Tasheel', 222.5, 0.0, 102.5, 0.0),
	('TAS059', 'Residence Company Visa DXB New/Renewal 2 Years', 'إقامة - شركات - سنتان - جديد/تجديد - دبي', 'DXB - Labor Services - Tasheel', 443.5, 0.0, 96.5, 0.0),
	('TADB01', 'Tadbeer Residence Visa New/Renewal 2 Years', 'اقامة - تدبير - سنتان - جديد/تجديد', 'Tadbeer Services', 317.25, 0.0, 40.0, 62.75),
	('TADB02', 'Tadbeer Emirates ID New/Renewal 2 Years', 'الهوية الإماراتية - تدبير - سنتان - جديد/تجديد', 'Tadbeer Services', 353.91, 0.0, 31.09, 0.0),
	('TADB03', 'Tadbeer Contract Fess', 'مصاريف عقد العمل - تدبير', 'Tadbeer Services', 0.0, 0.0, 35.0, 0.0),
	('VISA56', 'DXB Family Holding Fees', 'تعليق الإقامة العائلية - دبي', 'DXB - Residence Visa', 0.0, 0.0, 100.0, 0.0),
	('VISA58', 'Guarantor File Resident Issue', 'اصدار ملف ضامن مقيم', 'AOE - Residence Visa', 353.91, 0.0, 40.0, 6.09),
	('VISA64', 'Fines Reduction Request', 'طلب تخفيض الغرامات', 'AOE - Residence Visa', 253.2, 0.0, 40.0, 56.8),
	('VISA60', 'Investigation Permit Leaving (Exceptional) Issue', 'طلب تصريح مغادرة الدولة', 'AOE - Residence Visa', 353.91, 0.0, 40.0, 6.09),
	('VISA61', 'Residency Countries of Disasters and Wars (Without Guarantor)', 'إقامة - دول الحروب والكوارث - بدون ضامن', 'AOE - Residence Visa', 353.91, 0.0, 40.0, 6.09),
	('TAS060', 'Department of Economic Development – License Renewal', 'تجديد الرخصة التجارية - دائرة التنمية الاقتصادية', 'Tasheel', 0.0, 0.0, 0.0, 0.0),
	('TAS061', 'Attestation of the Commercial Lease Agreement', 'تصديق عقود الإيجار التجارية', 'Tasheel', 0.0, 0.0, 0.0, 0.0),
	('TAS062', 'Municipal Clearance Certificate', 'شهادة براءة ذمة من البلدية', 'Tasheel', 0.0, 0.0, 0.0, 0.0),
	('Bank01', 'Bank Charges', 'عمولة البنك', 'OTHER SERVICES', 0.0, 0.0, 0.0, 0.0),
	('EMBASSY02', 'Embassy Service Pre-Typed', 'فحص طبي - سفارات', 'Embassy Service Pre typed', 0.0, 50.0, 0.0, 0.0),
	('M42', 'Pre-employment Pre-typed', 'فحص طبي - ما قبل العمل', 'Sales Medical', 0.0, 50.0, 0.0, 0.0),
	('OT1', 'Photograph', 'صورة شخصية', 'OTHER SERVICES', 0.0, 30.0, 0.0, 0.0),
	('OT2', 'RTA License', 'رخصة القيادة', 'OTHER SERVICES', 322.0, 0.0, 28.0, 0.0),
	('OT3', 'Business Setup - Freezone', 'تاسيس الشركات - منطقة حرة', 'OTHER SERVICES', 5000.0, 1000.0, 0.0, 200.0),
	('OT4', 'Business Setup - Main Land', 'تاسيس الشركات - البر الرئيسي', 'OTHER SERVICES', 5000.0, 1000.0, 0.0, 200.0),
	('OT5', 'Ejari Service', 'خدمات ايجارى', 'OTHER SERVICES', 500.0, 0.0, 200.0, 0.0),
	('VIP1', 'HOME VIP Service', 'خدمة الفحص الطبي بالمنزل', 'MEDICAL SERVICE FEE', 0.0, 200.0, 0.0, 0.0),
	('VIP2', 'Medical Service Fee - Urgent - 04 Hours', 'رسوم الفحص الطبي - عاجل - 4 ساعات', 'MEDICAL SERVICE FEE', 0.0, 400.0, 0.0, 0.0),
	('VIP3', 'Medical Service Fee - Fast Track - 24 Hours', 'رسوم الفحص الطبي - عاجل - 24 ساعة', 'MEDICAL SERVICE FEE', 0.0, 150.0, 0.0, 0.0),
	('VIP4', 'Medical Service Fee - Urgent - 08 Hours', 'رسوم الفحص الطبي - عاجل - 8 ساعات', 'MEDICAL SERVICE FEE', 0.0, 300.0, 0.0, 0.0),
	('VISA40', 'Security Deposit - AOE', 'مبلغ الضمان - الإمارات الشمالية', 'AOE - Residence Visa', 0.0, 0.0, 0.0, 0.0),
	('VISA41', 'Security Deposit - DXB', 'مبلغ الضمان - دبي', 'DXB - Residence Visa', 0.0, 0.0, 0.0, 0.0),
	('VISA42', 'Visa Fine - DXB', 'غرامات الإقامة - دبي', 'DXB - Residence Visa', 0.0, 0.0, 0.0, 0.0),
	('VISA43', 'Visa Fine - AOE', 'غرامات الإقامة - الإمارات الشمالية', 'AOE - Residence Visa', 0.0, 0.0, 0.0, 0.0),
	('VISA44', 'Emirates ID Fine - DXB', 'غرامات الهوية الإماراتية - دبي', 'DXB - Residence Visa', 0.0, 0.0, 0.0, 0.0),
	('VISA45', 'Emirates ID Fine - AOE', 'غرامات الهوية الإماراتية - الإمارات الشمالية', 'AOE - Residence Visa', 0.0, 0.0, 0.0, 0.0),
	('VISA46', 'Company Fine', 'غرامات الشركات', 'DXB - Labor Services - Tasheel', 0.0, 0.0, 0.0, 0.0),
	('VISA 69', 'Issuance of a Clear Criminal Record Certificate', 'إصدار شهادة بحث الحالة الجنائية', 'DXB - Labor Services - Tasheel', 50.36, 0.0, 49.65, 0.0),
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
		services, _, service_problems = ([], [], []) if problems else medical_service_seed.import_services()
		problems += [(f"service {position}", title, reason) for position, title, reason in service_problems]

		if problems:
			frappe.db.rollback()
			print_report(removed, groups, created, problems, prices=prices, services=services)
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

	print_report(removed, groups, created, problems, prices=prices, services=services)
	print("\n  " + ("Dry run: everything was rolled back." if dry_run else "Committed."))

	return {
		"removed": removed,
		"item_groups": len(groups),
		"items": len(created),
		"medical_services": len(services),
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

	for label, doctype, name in (("TAX", "Tax", TAX), ("BASE_UNIT", "Unit", BASE_UNIT)):
		if not frappe.db.exists(doctype, name):
			problems.append((label, name, f"{doctype} '{name}' does not exist"))
	if problems:
		return created, problems

	# in_import keeps the sheet's item_code; with Create Item Code From Item
	# Group on, Item.before_naming would otherwise replace it
	frappe.flags.in_import = True
	frappe.flags.mute_messages = True

	try:
		for position, row in enumerate(ITEMS, start=1):
			code, name, name_arabic, group, gov, service_charge, typing, transaction = row

			if code.lower() in seen:
				problems.append((position, code, "duplicate item_code"))
				continue
			seen.add(code.lower())

			if group not in ITEM_GROUPS:
				problems.append((position, code, f"item group '{group}' is not in ITEM_GROUPS"))
				continue

			item = {
				"doctype": "Item",
				"item_code": code,
				"item_name": name,
				"item_name_arabic": name_arabic,
				"item_group": group,
				"item_type": "Service",
				"gov": flt(gov),
				"service_charge": flt(service_charge),
				"typing_charges": flt(typing),
				"transaction_charges": flt(transaction),
				"tax": TAX,
				# The Item.json default does not reach a dict insert; a blank unit
				# would also become a blank Item Unit row in before_validate
				"base_unit": BASE_UNIT,
				# Item.update_standard_buying_price compares this with > 0, so None fails
				"standard_buying_price": 0,
			}
			frappe.get_doc(item).insert(ignore_permissions=True)
			created.append(code)
	finally:
		frappe.flags.in_import = False
		frappe.flags.mute_messages = False

	return created, problems


def print_report(removed, groups=(), created=(), problems=(), prices=0, services=()):
	print("\n  Removed")
	for label, count in removed.items():
		print(f"    {label:<40} {count}")

	print("\n  Imported")
	print(f"    {'Item Group':<40} {len(groups)}")
	print(f"    {'Item':<40} {len(created)} of {len(ITEMS)}")
	print(f"    {'Item Price (Standard Selling)':<40} {prices}")
	print(f"    {'Medical Services':<40} {len(services)} of {len(medical_service_seed.SERVICES)}")

	for position, code, reason in problems:
		print(f"    ! #{position}: {code} -- {reason}")

