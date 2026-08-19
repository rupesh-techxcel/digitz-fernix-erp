# Copyright (c) 2025, Techxcel Technologies and contributors
# For license information, please see license.txt

import frappe


def execute(filters=None):
	columns, data = get_columns(), get_data(filters)
	return columns, data



def get_columns():
	columns = [
		{
			"fieldname": "service",
			"label": "Service",
			"fieldtype": "Link",
			"options": "Medical Services",
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
			si_items_service.parent AS service,
			
			COALESCE(SUM(si.net_total), 0) AS total_amount
		FROM `tabSales Invoice` si
		INNER JOIN `tabSales Invoice Item` sii
			ON sii.parent = si.name
		INNER JOIN `tabService Items` si_items_service
			ON sii.item = si_items_service.item
		
		
		GROUP BY si_items_service.parent
		ORDER BY total_amount DESC;
		"""
	if filters.get("current_date"):
		query = """
			SELECT
			si_items_service.parent AS service,
			
			COALESCE(SUM(si.net_total), 0) AS total_amount
		FROM `tabSales Invoice` si
		INNER JOIN `tabSales Invoice Item` sii
			ON sii.parent = si.name
		INNER JOIN `tabService Items` si_items_service
			ON sii.item = si_items_service.item
		 WHERE
		DATE(si.posting_date) = CURDATE()
		GROUP BY si_items_service.parent
		ORDER BY total_amount DESC;
		"""
	
	
	elif filters.get("from_date") and filters.get("to_date"):
		query = """
			SELECT
			si_items_service.parent AS service,
			
			COALESCE(SUM(si.net_total), 0) AS total_amount
		FROM `tabSales Invoice` si
		INNER JOIN `tabSales Invoice Item` sii
			ON sii.parent = si.name
		INNER JOIN `tabService Items` si_items_service
			ON sii.item = si_items_service.item
		
		WHERE si.posting_date BETWEEN %(from_date)s AND %(to_date)s
		GROUP BY si_items_service.parent
		ORDER BY total_amount DESC;
		
		
		"""
	result = frappe.db.sql(query,filters, as_dict=1)
	return result