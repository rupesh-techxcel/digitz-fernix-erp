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
	# Added a Date column so the header rows can show their date cleanly.
	return [
		{
			"fieldname": "posting_date",
			"label": "Date",
			"fieldtype": "Date",
			"width": 120,
		},
		{
			"fieldname": "service",
			"label": "Service",
			"fieldtype": "Data",
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
	# --- Build conditions & params (with Today fallback for dates) ---
	conditions = []
	params = dict(filters or {})

	if not params.get("from_date") or not params.get("to_date"):
		today = frappe.utils.today()
		params["from_date"] = today
		params["to_date"] = today

	conditions.append("si.posting_date BETWEEN %(from_date)s AND %(to_date)s")

	# Cashier restriction (Administrator and System Manager are not limited)
	current_user = frappe.session.user
	roles = set(frappe.get_roles(current_user))
	is_privileged = current_user == "Administrator" or "System Manager" in roles

	if "Cashier" in roles and not is_privileged:
		params["user"] = current_user
		conditions.append("si.owner = %(user)s")
	elif params.get("user"):
		conditions.append("si.owner = %(user)s")

	conditions.append("si.docstatus = 1")

	where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

	# --- Fetch sums per (date, service) ---
	# A submitted Sales Return takes its lines back off on the day of the return,
	# under the service of the invoice each line was returned from
	query = f"""
		SELECT posting_date, service, COALESCE(SUM(amount), 0) AS total_amount
		FROM (
			SELECT
				DATE(si.posting_date) AS posting_date,
				IFNULL(NULLIF(si.medical_service, ''), 'No service') AS service,
				sii.net_amount AS amount
			FROM `tabSales Invoice` si
			INNER JOIN `tabSales Invoice Item` sii ON sii.parent = si.name
			{where_clause}
			UNION ALL
			SELECT
				DATE(si.posting_date),
				IFNULL(NULLIF(original.medical_service, ''), 'No service'),
				-sii.net_amount
			FROM `tabSales Return` si
			INNER JOIN `tabSales Return Item` sii ON sii.parent = si.name
			LEFT JOIN `tabSales Invoice Item` original_item ON original_item.name = sii.si_item_reference
			LEFT JOIN `tabSales Invoice` original ON original.name = original_item.parent
			{where_clause}
		) doc_lines
		GROUP BY posting_date, service
		ORDER BY posting_date ASC, total_amount DESC
	"""
	rows = frappe.db.sql(query, params, as_dict=True)

	# --- Build visual sections: header row per date, then its services ---
	by_date = defaultdict(list)
	date_totals = defaultdict(float)

	for r in rows:
		by_date[r["posting_date"]].append(r)
		date_totals[r["posting_date"]] += float(r.get("total_amount") or 0.0)

	out = []
	for d in sorted(by_date.keys()):
		# Header row (bold, no indent). Shows the date total on the right.
		out.append({
			"posting_date": d,
			"service": None,            # blank service for header row
			"total_amount": date_totals[d],
			"bold": 1,                  # frappe query reports respect 'bold' for styling
			"indent": 0
		})
		# Detail rows (indented) for that date
		for r in by_date[d]:
			out.append({
				"posting_date": None,     # keep date only on the header row for visual grouping
				"service": r["service"],
				"total_amount": r["total_amount"],
				"indent": 1
			})

	return out
