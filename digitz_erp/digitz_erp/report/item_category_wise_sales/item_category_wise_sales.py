# Copyright (c) 2025, Techxcel Technologies and contributors
# For license information, please see license.txt

import frappe
from collections import defaultdict

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
			"fieldtype": "Link",
			"options": "Item Group",
			"width": 300,
		},
		{
			"fieldname": "total_amount",
			"label": "Total Amount",
			"fieldtype": "Currency",
			"width": 200,
		},
	]

def get_data_grouped_with_headers(filters):
	# --- Build conditions & params (default to Today if dates missing) ---
	params = dict(filters or {})
	conditions = []

	if not params.get("from_date") or not params.get("to_date"):
		today = frappe.utils.today()
		params["from_date"] = today
		params["to_date"] = today

	conditions.append("si.posting_date BETWEEN %(from_date)s AND %(to_date)s")

	# --- User privilege restriction: Cashier limited to own records; Administrator is privileged ---
	current_user = frappe.session.user
	roles = set(frappe.get_roles(current_user))
	is_privileged = (current_user == "Administrator")

	if "Cashier" in roles and not is_privileged:
		params["user"] = current_user
		conditions.append("si.owner = %(user)s")
	elif params.get("user"):
		# Honor explicit user filter if provided
		conditions.append("si.owner = %(user)s")

	where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

	# --- Fetch sums per (date, item_group) ---
	# NOTE: Keeping your schema: `sii.item` and `sii.gross_amount`
	query = f"""
		SELECT
			DATE(si.posting_date) AS posting_date,
			item.item_group AS category,
			COALESCE(SUM(sii.gross_amount), 0) AS total_amount
		FROM `tabSales Invoice` si
		INNER JOIN `tabSales Invoice Item` sii
			ON sii.parent = si.name
		INNER JOIN `tabItem` item
			ON sii.item = item.name
		{where_clause}
		GROUP BY DATE(si.posting_date), item.item_group
		ORDER BY posting_date ASC, total_amount DESC
	"""
	rows = frappe.db.sql(query, params, as_dict=True)

	# --- Build visual sections: header row per date, then its categories ---
	by_date = defaultdict(list)
	date_totals = defaultdict(float)

	for r in rows:
		by_date[r["posting_date"]].append(r)
		date_totals[r["posting_date"]] += float(r.get("total_amount") or 0.0)

	out = []
	for d in sorted(by_date.keys()):
		# Header row: bold, shows the date total
		out.append({
			"posting_date": d,
			"category": None,          # blank on header for a clean section feel
			"total_amount": date_totals[d],
			"bold": 1,
			"indent": 0,
		})
		# Detail rows: categories under that date
		for r in by_date[d]:
			out.append({
				"posting_date": None,   # show date only on header
				"category": r["category"],
				"total_amount": r["total_amount"],
				"indent": 1,
			})

	return out
