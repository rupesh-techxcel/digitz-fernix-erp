# Copyright (c) 2025, Techxcel Technologies and contributors
# For license information, please see license.txt

import frappe


def execute(filters=None):
	columns, data = get_columns(), get_data(filters)
	frappe.msgprnt("testing", alert=1)
	return columns, data


def get_columns():
	columns = [
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
	return columns

def get_data(filters):
	query = """

		SELECT
			sii.item AS item,
			COALESCE(SUM(sii.gross_amount),0) AS total_amount
		`tabSales Invoice Item` sii
			
		
		GROUP BY sii.item
		ORDER BY total_amount DESC;
		"""
	
	if filters.get("current_date"):
		query = """
			SELECT

			sii.item AS item,
			COALESCE(SUM(sii.gross_amount),0) AS total_amount
			FROM `tabSales Invoice` si
		INNER JOIN
		`tabSales Invoice Item` sii
			ON sii.parent = si.name
		 WHERE
		DATE(si.posting_date) = CURDATE() AND si.docstatus =1
		GROUP BY sii.item
		ORDER BY total_amount DESC;
		
		"""
	
	elif filters.get("from_date") and filters.get("to_date"):
		query = """
			SELECT

			sii.item AS item,
			COALESCE(SUM(sii.gross_amount),0) AS total_amount
			FROM `tabSales Invoice` si
		INNER JOIN
		`tabSales Invoice Item` sii
			ON sii.parent = si.name
		WHERE si.posting_date BETWEEN %(from_date)s AND %(to_date)s and si.docstatus =1
		GROUP BY sii.item
		ORDER BY total_amount DESC;
		
		"""
	result = frappe.db.sql(query,filters, as_dict=1)
	return result