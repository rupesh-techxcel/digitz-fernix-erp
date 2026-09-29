// Copyright (c) 2022, Rupesh P and contributors
// For license information, please see license.txt

frappe.ui.form.on('Item Group', {
	refresh: function(frm) {
		frappe.call({
			method: "digitz_erp.stock.doctype.item_group.item_group.get_item_group_code_required",
			callback: function(r) {
				const item_group_code_required = cint(r.message);
				frm.set_df_property("item_group_code", "hidden", !item_group_code_required);
				frm.set_df_property("item_group_code", "reqd", item_group_code_required);
			}
		});
	},

	setup:function(frm)
	{
		frm.set_query("default_expense_account", function () {
			return {
				"filters": {
					"root_type":"Expense",
					"is_group":0
				}
			};
		});
	}
});
