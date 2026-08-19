// Copyright (c) 2025, Techxcel Technologies and contributors
// For license information, please see license.txt

frappe.query_reports["Service wise Sales Report"] = {
	"filters": [
		{		
			"fieldname": "from_date",
			"fieldtype": "Date",
			"label": "From Date",		
			"default": frappe.datetime.get_today()				
					
		},
		{		
			"fieldname": "to_date",
			"fieldtype": "Date",
			"label": "To Date",	
			"default": frappe.datetime.get_today()		
				
		}	

	]
};
