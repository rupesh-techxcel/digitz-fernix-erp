// Copyright (c) 2025, Techxcel Technologies and contributors
// For license information, please see license.txt

frappe.query_reports["Counter based Sales report"] = {
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
			"fieldname": "counter",
			"fieldtype": "Link",
			"label": "Counter",
			"options": "Counter"
		},
		{
			"fieldname": "user",
			"fieldtype": "Link",
			"label": "User",
			"options": "User"
		},
		{		
			"fieldname": "current_date",
			"fieldtype": "Date",
			"label": "Today",			
			"default":frappe.datetime.get_today()	
		},	

	],
	// One row per counter, with the users who worked it underneath
	tree: true,
	name_field: "name",
	parent_field: "parent",
	initial_depth: 1,
	formatter(value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		// Counter rows and the grand total in bold; a user row repeats nothing of its counter
		if (data && column.fieldname === "counter" && data.indent === 1) {
			return "";
		}
		return data && data.indent === 0 ? `<b>${value}</b>` : value;
	},
};
