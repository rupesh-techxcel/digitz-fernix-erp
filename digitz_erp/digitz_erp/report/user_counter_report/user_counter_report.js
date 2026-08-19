// Copyright (c) 2025, Techxcel Technologies and contributors
// For license information, please see license.txt

frappe.query_reports["User_Counter Report"] = {
	"filters": [

		{		
			"fieldname": "from_date",
			"fieldtype": "Date",
			"label": "From Date"					
				
		},
		{		
			"fieldname": "to_date",
			"fieldtype": "Date",
			"label": "To Date"	
			
		},	
		{		
			"fieldname": "current_date",
			"fieldtype": "Date",
			"label": "Today",			
			"default":frappe.datetime.get_today()	
		},	

	]
};
