# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""Import invoices from the previous system's SERVICE REPORT into Historical Invoice.

The report has one row per invoice line. Rows are grouped on INVOICE NUMBER:
the columns that are the same on every line of an invoice (date, time,
customer, payment mode and status, cashier) fill the Historical Invoice
header, and every row becomes one Historical Invoice Item, all 37 columns kept.
The header totals are sums of the lines; INVOICE TOTAL is kept as the report
has it.

The reports bundled in seeds/data/historical_invoices/ are loaded by the patch
digitz_erp.patches.v1_0.import_historical_invoices on `bench migrate`, so a
server picks them up with no copy of the files. Run by hand to load them again
or to load another report (.xlsx or .csv, same columns):

	bench --site <site> execute digitz_erp.seeds.historical_invoice_seed.run

	bench --site <site> execute digitz_erp.seeds.historical_invoice_seed.import_file \
		--kwargs "{'path': '/path/to/SERVICE_REPORT.csv'}"

	# preview without writing anything
	... --kwargs "{'dry_run': 1}"

An invoice number that is already imported is skipped, never rewritten, so a
run can be repeated and overlapping reports are safe.

Clean-ups applied to the text, none of which drop information:
- `&amp;` and similar HTML entities in names are decoded (`&amp;` -> `&`).
- The leading apostrophe Excel uses to force text (`'0102...`) is removed; a
  lone apostrophe, the report's "empty", becomes blank.
- A 9-digit mobile starting with 5 (Excel dropped its leading zero) gets the
  zero back, as the CSV export of the same report shows it.
"""

import csv
import html
from collections import OrderedDict
from datetime import date, datetime, time
from pathlib import Path

import frappe
from frappe.utils import cint, flt, getdate

DATA_DIR = Path(__file__).parent / "data" / "historical_invoices"

# Report column -> Historical Invoice field (same on every line of an invoice)
HEADER_COLUMNS = {
	"INVOICE NUMBER": "invoice_number",
	"INVOICE DATE": "invoice_date",
	"INVOICE TIME": "invoice_time",
	"CARD TYPE": "payment_mode",
	"PAYMENT STATUS": "payment_status",
	"CUSTOMER": "customer_name",
	"DISPLAY CUSTOMER": "display_customer",
	"CUSTOMER MOBILE": "customer_mobile",
	"CUSTOMER EMAIL": "customer_email",
	"SALES MAN": "sales_man",
	"EMPLOYEE": "employee",
	"EMPLOYEE NAME": "employee_name",
}

# Report column -> Historical Invoice Item field (one per line)
ITEM_COLUMNS = {
	"STOCK ID": "stock_id",
	"SERVICE NAME": "service_name",
	"CATEGORY": "category",
	"QUANTITY": "quantity",
	"SERVICE CHARGE": "service_charge",
	"TOTAL SERVICE CHARGE": "total_service_charge",
	"EXTRA/ROUND OFF CHARGE": "extra_charge",
	"TOTAL VAT": "total_vat",
	"GOVT.FEE": "govt_fee",
	"GOVT.BANK": "govt_bank",
	"BANK SERVICE CHARGE": "bank_service_charge",
	"BANK SERVICE CHARGE VAT": "bank_service_charge_vat",
	"OTHER CHARGE": "other_charge",
	"TOTAL GOVT.FEE": "total_govt_fee",
	"BANK REFERENCE NUMBER": "bank_reference_number",
	"MB/ST/DW-ID": "mb_st_dw_id",
	"APPLICATION ID / RECEIPT ID": "application_id",
	"REF.NAME": "ref_name",
	"EMPLOYEE COMMISSION": "employee_commission",
	"CUSTOMER COMMISSION": "customer_commission",
	"DISCOUNT AMOUNT": "discount_amount",
	"REWARD AMOUNT": "reward_amount",
	"LINE TOTAL": "line_total",
	"NET SERVICE CHARGE": "net_service_charge",
}

INVOICE_TOTAL_COLUMN = "INVOICE TOTAL"

ITEM_NUMBERS = {
	"quantity", "service_charge", "total_service_charge", "extra_charge", "total_vat",
	"govt_fee", "bank_service_charge", "bank_service_charge_vat", "other_charge",
	"total_govt_fee", "employee_commission", "customer_commission", "discount_amount",
	"reward_amount", "line_total", "net_service_charge",
}

# Header total -> the item field it sums
TOTALS = {
	"total_service_charge": "total_service_charge",
	"total_vat": "total_vat",
	"total_govt_fee": "total_govt_fee",
	"total_bank_service_charge": "bank_service_charge",
	"total_other_charge": "other_charge",
	"total_discount": "discount_amount",
	"total_reward": "reward_amount",
	"total_extra_charge": "extra_charge",
	"net_total": "line_total",
}

COMMIT_EVERY = 200


def run(dry_run=0):
	"""Import every report bundled in seeds/data/historical_invoices/."""
	summary = {"created": 0, "skipped": 0, "lines": 0, "files": 0}
	for path in sorted(DATA_DIR.glob("*")):
		if path.suffix.lower() in (".xlsx", ".csv"):
			result = import_file(str(path), dry_run=dry_run)
			summary["files"] += 1
			for key in ("created", "skipped", "lines"):
				summary[key] += result[key]
	print(f"Historical invoices: {summary}")
	return summary


def import_file(path, dry_run=0):
	"""Import one SERVICE REPORT file (.xlsx or .csv).

	:param path: the report on this server.
	:param dry_run: report what would happen without writing.
	"""
	dry_run = cint(dry_run)
	path = Path(path)
	invoices = group_invoices(read_rows(path))
	existing = set(frappe.get_all(
		"Historical Invoice",
		filters={"name": ["in", list(invoices)]},
		pluck="name",
	)) if invoices else set()
	customers = customer_lookup()

	created = skipped = lines = 0
	for number, rows in invoices.items():
		if number in existing:
			skipped += 1
			continue
		doc = build_invoice(number, rows, path.name, customers)
		created += 1
		lines += len(doc.items)
		if dry_run:
			continue
		doc.insert(ignore_permissions=True, ignore_mandatory=True)
		if created % COMMIT_EVERY == 0:
			frappe.db.commit()

	if not dry_run:
		frappe.db.commit()
	result = {"file": path.name, "created": created, "skipped": skipped, "lines": lines, "dry_run": dry_run}
	print(result)
	return result


def read_rows(path):
	"""Yield each report row as {COLUMN NAME: value}, column names upper-cased."""
	if path.suffix.lower() == ".csv":
		with path.open(newline="", encoding="utf-8-sig") as f:
			reader = csv.reader(f)
			header = [column_key(h) for h in next(reader)]
			for values in reader:
				if any(v.strip() for v in values):
					yield dict(zip(header, values))
		return

	import openpyxl

	wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
	try:
		rows = wb.worksheets[0].iter_rows(values_only=True)
		header = [column_key(h) for h in next(rows)]
		for values in rows:
			if any(v not in (None, "") for v in values):
				yield dict(zip(header, values))
	finally:
		wb.close()


def column_key(name):
	return " ".join(str(name or "").split()).upper()


def group_invoices(rows):
	"""{invoice number: [rows]} in report order."""
	invoices = OrderedDict()
	for row in rows:
		number = text(row.get("INVOICE NUMBER"))
		if number:
			invoices.setdefault(number, []).append(row)
	return invoices


def build_invoice(number, rows, source_file, customers):
	first = rows[0]
	doc = frappe.new_doc("Historical Invoice")
	for column, field in HEADER_COLUMNS.items():
		doc.set(field, text(first.get(column)))
	doc.invoice_number = number
	doc.invoice_date = to_date(first.get("INVOICE DATE"))
	doc.invoice_time = to_time(first.get("INVOICE TIME"))
	doc.customer_mobile = mobile(first.get("CUSTOMER MOBILE"))
	doc.customer = customers.get(doc.customer_name.lower()) if doc.customer_name else None
	doc.invoice_total = flt(first.get(INVOICE_TOTAL_COLUMN), 2)
	doc.source_file = source_file

	for row in rows:
		item = {}
		for column, field in ITEM_COLUMNS.items():
			value = row.get(column)
			item[field] = flt(value, 2) if field in ITEM_NUMBERS else text(value)
		item["amount"] = flt(item["line_total"] + item["total_vat"], 2)
		doc.append("items", item)

	for total, field in TOTALS.items():
		doc.set(total, flt(sum(flt(i.get(field)) for i in doc.items), 2))
	return doc


def customer_lookup():
	"""{lower-cased customer_name: Customer name} for linking where a name matches."""
	return {
		(c.customer_name or "").strip().lower(): c.name
		for c in frappe.get_all("Customer", fields=["name", "customer_name"])
		if c.customer_name
	}


def text(value):
	if value is None:
		return ""
	if isinstance(value, float) and value.is_integer():
		value = int(value)
	value = html.unescape(str(value)).strip()
	if value.startswith("'"):
		value = value[1:].strip()
	return value


def mobile(value):
	value = text(value)
	if len(value) == 9 and value.isdigit() and value.startswith("5"):
		return "0" + value
	return value


def to_date(value):
	if isinstance(value, datetime):
		return value.date()
	if isinstance(value, date):
		return value
	value = text(value)
	if not value:
		return None
	for fmt in ("%d-%m-%Y", "%d/%m/%Y", "%Y-%m-%d"):
		try:
			return datetime.strptime(value, fmt).date()
		except ValueError:
			pass
	return getdate(value)


def to_time(value):
	if isinstance(value, datetime):
		return value.time()
	if isinstance(value, time):
		return value
	return text(value) or None
