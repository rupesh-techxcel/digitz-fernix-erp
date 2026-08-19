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
			"fieldname": "item",
			"label": "Item",
			"fieldtype": "Link",
			"options": "Item",
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
	params = dict(filters or {})
	conditions = []

	# --- Date range (fallback to Today if missing) ---
	if not params.get("from_date") or not params.get("to_date"):
		today = frappe.utils.today()
		params["from_date"] = today
		params["to_date"] = today
	conditions.append("si.posting_date BETWEEN %(from_date)s AND %(to_date)s")

	# --- Optional Item filter ---
	if params.get("item"):
		conditions.append("sii.item = %(item)s")

	# --- User privilege restriction (Cashier limited to own; Administrator privileged) ---
	current_user = frappe.session.user
	roles = set(frappe.get_roles(current_user))
	is_privileged = (current_user == "Administrator")

	if "Cashier" in roles and not is_privileged:
		params["user"] = current_user
		conditions.append("si.owner = %(user)s")
	elif params.get("user"):
		# Honor explicit user filter if provided
		conditions.append("si.owner = %(user)s")

	conditions.append("si.docstatus = 1")
	where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

	# --- Query: sum gross_amount grouped by date + item ---
	query = f"""
		SELECT
			DATE(si.posting_date) AS posting_date,
			sii.item AS item,
			COALESCE(SUM(sii.gross_amount), 0) AS total_amount
		FROM `tabSales Invoice` si
		INNER JOIN `tabSales Invoice Item` sii
			ON sii.parent = si.name
		{where_clause}
		GROUP BY DATE(si.posting_date), sii.item
		ORDER BY posting_date ASC, total_amount DESC
	"""
	rows = frappe.db.sql(query, params, as_dict=True)

	# --- Build sections: header row per date, then grouped items ---
	by_date = defaultdict(list)
	date_totals = defaultdict(float)

	for r in rows:
		by_date[r["posting_date"]].append({
			"item": r["item"],
			"total_amount": r["total_amount"],
		})
		date_totals[r["posting_date"]] += float(r.get("total_amount") or 0.0)

	out = []
	for d in sorted(by_date.keys()):
		# Header row with summed total for the whole date
		out.append({
			"posting_date": d,
			"item": None,                 # keep header clean
			"total_amount": date_totals[d],
			"bold": 1,                    # Query Report styling hint
			"indent": 0,
		})
		# Item rows (already summed by GROUP BY)
		for r in by_date[d]:
			out.append({
				"posting_date": None,     # show date only on header
				"item": r["item"],
				"total_amount": r["total_amount"],
				"indent": 1,
			})

	return out
