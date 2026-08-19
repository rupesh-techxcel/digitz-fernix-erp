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
			"fieldname": "total_items",
			"label": "Total Items",
			"fieldtype": "Int",
			"width": 150,
		},
		{
			"fieldname": "total_amount",
			"label": "Total Amount",
			"fieldtype": "Currency",
			"width": 150,
		},
	]
	return columns



def get_data(filters):
	query = """

		SELECT
			si_items_service.parent AS service,
			COUNT(sii.name) AS total_items,
			COALESCE(SUM(si.net_total), 0) AS total_amount
		FROM `tabSales Invoice` si
		INNER JOIN `tabSales Invoice Item` sii
			ON sii.parent = si.name
		INNER JOIN `tabService Items` si_items_service
			ON sii.item = si_items_service.item
		WHERE
		si.owner = %(user)s 
		 AND DATE(si.posting_date) = CURDATE()
		GROUP BY si_items_service.parent
		ORDER BY total_items DESC;
		"""
	
	result = frappe.db.sql(query,{"user": frappe.session.user}, as_dict=1)
	return result