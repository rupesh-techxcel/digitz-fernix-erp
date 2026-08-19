// Copyright (c) 2025, Techxcel Technologies and contributors
// For license information, please see license.txt

frappe.query_reports["Sales Details Report"] = {
	"filters": [
	  {
		"fieldname": "from_date",
		"fieldtype": "Date",
		"label": "From Date",
		"default": frappe.datetime.get_today(),
		"width": "80",
	  },
	  {
		"fieldname": "to_date",
		"fieldtype": "Date",
		"label": "To Date",
		"default": frappe.datetime.get_today(),
		"width": "80",
	  },
	  {
		"fieldname": "user",
		"fieldtype": "Link",
		"options": "User",
		"label": "User",
		"width": "80",
	  },
	  {
		"fieldname": "customer",
		"fieldtype": "Link",
		"options": "Customer",
		"label": "Customer",
		"width": "80",
	  },
	  {
		// Use Select so we can include "Credit Sale" (not a Payment Mode doc)
		"fieldname": "payment_mode",
		"fieldtype": "Select",
		"label": "Payment Mode",
		"width": "120",
		"options": "\nCredit Sale" // fallback; will be replaced onload
	  }
	],
  
	onload: function (report) {
	  const f = report.get_filter && report.get_filter("payment_mode");
	  if (!f) return;
  
	  const prev = f.get_value ? f.get_value() : "";
  
	  frappe.db.get_list("Payment Mode", {
		fields: ["name"],
		limit: 0
	  }).then(res => {
		const modes = (res || []).map(r => r.name);
		f.df.options = ["", "Credit Sale", ...modes].join("\n");
		f.refresh();
		if (prev) f.set_value(prev);
	  }).catch(() => {
		// keep minimal options even if fetch fails
		f.df.options = ["", "Credit Sale"].join("\n");
		f.refresh();
		if (prev) f.set_value(prev);
	  });
	}
  };
  