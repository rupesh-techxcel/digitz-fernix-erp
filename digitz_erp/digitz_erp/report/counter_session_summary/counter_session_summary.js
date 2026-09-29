// Copyright (c) 2026, Rupesh P and contributors
// For license information, please see license.txt

frappe.query_reports["Counter Session Summary"] = {
	filters: [
		{ fieldname: "from_date", fieldtype: "Date", label: __("From Date"), default: frappe.datetime.month_start() },
		{ fieldname: "to_date", fieldtype: "Date", label: __("To Date"), default: frappe.datetime.get_today() },
		{ fieldname: "counter", fieldtype: "Link", label: __("Counter"), options: "Counter" },
		{ fieldname: "cashier", fieldtype: "Link", label: __("Cashier"), options: "User" },
		{ fieldname: "status", fieldtype: "Select", label: __("Status"), options: "\nOpen\nClosing\nClosed" },
	],
	formatter(value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		if (column.fieldname === "difference" && data && Math.abs(data.difference || 0) >= 0.005) {
			return `<span style="color: ${data.difference < 0 ? "var(--red-600)" : "var(--orange-600)"}; font-weight: 600;">${value}</span>`;
		}
		return value;
	},
};
