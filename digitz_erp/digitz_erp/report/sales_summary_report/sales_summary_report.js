// Copyright (c) 2025,
// For license information, please see license.txt

frappe.query_reports["Sales Summary Report"] = {
    filters: [
      {
        fieldname: "from_date",
        label: __("From Date"),
        fieldtype: "Date",
        default: frappe.datetime.month_start(),
        reqd: 1
      },
      {
        fieldname: "to_date",
        label: __("To Date"),
        fieldtype: "Date",
        default: frappe.datetime.month_end(),
        reqd: 1
      },
      {
        fieldname: "user",
        label: __("User"),
        fieldtype: "Link",
        options: "User",
        reqd: 0,
        // Optional: restrict to Cashier role and show full names
        // get_query: () => ({ query: "your_app.api.user_with_name" })
      }
    ],
  
    // Custom formatter for grouped look & feel
    formatter(value, row, column, data, default_formatter) {
      let formatted = default_formatter(value, row, column, data);
      if (!data) return formatted;
  
      // User header row
      if (data.is_user_header) {
        if (column.fieldname === "username") {
          formatted = `<span style="font-weight:600;">${frappe.utils.escape_html(value || "")}</span>`;
        } else {
          formatted = "";
        }
        return formatted;
      }
  
      // Indent detail lines
      if (data.indent && data.indent > 0 && column.fieldname === "payment_mode") {
        formatted = `<span style="padding-left:${data.indent * 16}px; display:inline-block;">${formatted}</span>`;
      }
  
      // Bold totals (per-user Total & Grand Total)
      if (data.bold) {
        formatted = `<span style="font-weight:600;">${formatted}</span>`;
      }
  
      return formatted;
    }
  };
  