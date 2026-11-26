# Copyright (c) 2025, Techxcel Technologies and contributors
# For license information, please see license.txt

import frappe
from collections import defaultdict
from frappe.utils import flt

def execute(filters=None):
	filters = filters or {}
	columns = get_columns()
	data = get_data_grouped_with_headers(filters)
	return columns, data

def get_columns():
	return [
		{
			"fieldname": "posting_date",
			"label": "Date",
			"fieldtype": "Date",
			"width": 120,
		},
		{
			"fieldname": "category",
			"label": "Item Category",
			# Data, not a Link: a Cashier cannot read Item Group, and query_report
			# checks every Link column against the user's read rights once there are rows
			"fieldtype": "Data",
			"width": 300,
		},
		{
			"fieldname": "total_amount",
			"label": "Total Amount",
			"fieldtype": "Currency",
			"width": 160,
		},
	] + [
		{"fieldname": fieldname, "label": label, "fieldtype": "Currency", "width": 140}
		for fieldname, label, _expr in AMOUNTS
	] + [
		{"fieldname": "round_off", "label": "Round Off", "fieldtype": "Currency", "width": 110},
		{"fieldname": "total_vat", "label": "Total VAT", "fieldtype": "Currency", "width": 120},
		{"fieldname": "total_invoice_value", "label": "Total Invoice Value", "fieldtype": "Currency", "width": 160},
		{"fieldname": "net_service_charge", "label": "Net Service Charge", "fieldtype": "Currency", "width": 160},
	]

# The line charges, each per unit on the line, so times its qty (as in the Sales Detail V2 report)
AMOUNTS = (
	("service_charge", "Service Charge", "sii.service_charge * sii.qty"),
	("govt_fee", "Govt. Fee", "sii.gov * sii.qty"),
	("typing_charges", "Typing Charges", "sii.typing_charges * sii.qty"),
	("transaction_charges", "Transaction Charges", "sii.transaction_charges * sii.qty"),
)
# The line totals: gross is the Total Amount column; VAT and the line value with VAT as they stand on the line
LINE_TOTALS = (
	("total_amount", "sii.gross_amount"),
	("total_vat", "sii.tax_amount"),
	("line_value", "sii.net_amount"),
)

def get_data_grouped_with_headers(filters):
	# --- Build conditions & params (default to Today if dates missing) ---
	params = dict(filters or {})
	conditions = []

	if not params.get("from_date") or not params.get("to_date"):
		today = frappe.utils.today()
		params["from_date"] = today
		params["to_date"] = today

	conditions.append("si.posting_date BETWEEN %(from_date)s AND %(to_date)s")

	# --- User privilege restriction: Cashier limited to own records; Administrator and System Manager are not ---
	current_user = frappe.session.user
	roles = set(frappe.get_roles(current_user))
	is_privileged = current_user == "Administrator" or "System Manager" in roles

	if "Cashier" in roles and not is_privileged:
		params["user"] = current_user
		conditions.append("si.owner = %(user)s")
	elif params.get("user"):
		# Honor explicit user filter if provided
		conditions.append("si.owner = %(user)s")

	conditions.append("si.docstatus = 1")

	where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

	# --- Fetch sums per (date, item_group) ---
	# NOTE: Keeping your schema: `sii.item` and `sii.gross_amount`
	# Submitted Sales Returns take their lines back off, on the day of the return
	sums = [(name, expr) for name, expr in LINE_TOTALS] + [(name, expr) for name, _label, expr in AMOUNTS]
	select_lines = ", ".join(f"IFNULL({expr}, 0) AS {name}" for name, expr in sums)
	select_return_lines = ", ".join(f"-IFNULL({expr}, 0)" for _name, expr in sums)
	totals = ", ".join(f"SUM(doc_lines.{name}) AS {name}" for name, _expr in sums)
	query = f"""
		SELECT doc_lines.posting_date, item.item_group AS category, {totals}
		FROM (
			SELECT DATE(si.posting_date) AS posting_date, sii.item AS item, {select_lines}
			FROM `tabSales Invoice` si
			INNER JOIN `tabSales Invoice Item` sii ON sii.parent = si.name
			{where_clause}
			UNION ALL
			SELECT DATE(si.posting_date), sii.item, {select_return_lines}
			FROM `tabSales Return` si
			INNER JOIN `tabSales Return Item` sii ON sii.parent = si.name
			{where_clause}
		) doc_lines
		INNER JOIN `tabItem` item
			ON doc_lines.item = item.name
		GROUP BY doc_lines.posting_date, item.item_group
		ORDER BY posting_date ASC, total_amount DESC
	"""
	rows = frappe.db.sql(query, params, as_dict=True)

	# Round Off is the invoice's, not a category's: it goes on the date's row only
	round_offs = dict(frappe.db.sql(f"""
		SELECT posting_date, SUM(round_off) FROM (
			SELECT DATE(si.posting_date) AS posting_date, IFNULL(si.round_off, 0) AS round_off
			FROM `tabSales Invoice` si {where_clause}
			UNION ALL
			SELECT DATE(si.posting_date), -IFNULL(si.round_off, 0)
			FROM `tabSales Return` si {where_clause}
		) docs GROUP BY posting_date
	""", params))

	# --- Build visual sections: header row per date, then its categories ---
	fields = [name for name, _expr in LINE_TOTALS] + [name for name, _label, _expr in AMOUNTS]
	by_date = defaultdict(list)
	for r in rows:
		by_date[r["posting_date"]].append(r)

	def amounts(source, round_off=None):
		"""The report's amount columns from summed lines. Total Invoice Value is
		the lines with VAT (plus the round off on a date's row); Net Service
		Charge is that without VAT and government fees."""
		values = {field: flt(source.get(field), 2) for field in fields if field != "line_value"}
		values["total_invoice_value"] = flt(flt(source.get("line_value")) + flt(round_off), 2)
		values["net_service_charge"] = flt(flt(source.get("line_value")) - flt(source.get("total_vat"))
			- flt(source.get("govt_fee")), 2)
		values["round_off"] = flt(round_off, 2) if round_off is not None else None
		return values

	out = []
	for d in sorted(by_date.keys()):
		day = {field: sum(flt(r.get(field)) for r in by_date[d]) for field in fields}
		# Header row: bold, shows the date's totals
		out.append({
			"posting_date": d,
			"category": None,          # blank on header for a clean section feel
			**amounts(day, round_offs.get(d, 0)),
			"bold": 1,
			"indent": 0,
		})
		# Detail rows: categories under that date
		for r in by_date[d]:
			out.append({
				"posting_date": None,   # show date only on header
				"category": r["category"],
				**amounts(r),
				"indent": 1,
			})

	return out
