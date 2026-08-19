# Copyright (c) 2025, Techxcel Technologies and contributors
# For license information, please see license.txt

import frappe


def execute(filters=None):
	columns, data = get_columns(), get_data(filters)
	return columns, data


def get_columns():
	columns = [
		{
			"fieldname": "user",
			"label": "User/Counter",
			"fieldtype": "Link",
			"options": "User",
			"width": 300,
		},
		{
			"fieldname": "total_amount",
			"label": "Total Amount",
			"fieldtype": "Currency",
			"width": 200,
		},
	]
	return columns

def get_data(filters):
	query = """
		SELECT
			SUM(si.net_total) AS total_amount,
			u.username AS user
		FROM `tabSales Invoice` si
		JOIN `tabUser` u ON si.owner = u.name
		
		GROUP BY si.owner
		ORDER BY total_amount DESC;

	"""
	if filters.get("current_date"):
		query = """
		SELECT
			SUM(si.net_total) AS total_amount,
			u.username AS user
		FROM `tabSales Invoice` si
		JOIN `tabUser` u ON si.owner = u.name
		WHERE DATE(si.posting_date) = CURDATE()
		GROUP BY si.owner
		ORDER BY total_amount DESC
		"""
	elif filters.get("from_date") and filters.get("to_date"):
		query = """
		SELECT
			SUM(si.net_total) AS total_amount,
			u.username AS user
		FROM `tabSales Invoice` si
		JOIN `tabUser` u ON si.owner = u.name
		WHERE si.posting_date BETWEEN %(from_date)s AND %(to_date)s
		GROUP BY si.owner
		ORDER BY total_amount DESC
		"""
	result = frappe.db.sql(query,filters, as_dict=1)
	return result