// Copyright (c) 2025, Techxcel Technologies and contributors
// For license information, please see license.txt

frappe.ui.form.on("Quotation Items Template", {
	refresh(frm) {

	},
});

frappe.ui.form.on('Quotation Items Template Detail', {
    item: function (frm, cdt, cdn) {
        const row = locals[cdt][cdn];
        if (!row.item) return;

        frappe.db.get_doc('Item', row.item).then(item => {
            frappe.model.set_value(cdt, cdn, 'description', item.description);
            frappe.model.set_value(cdt, cdn, 'item_group', item.item_group);
            frappe.model.set_value(cdt, cdn, 'unit', item.base_unit);
            frappe.model.set_value(cdt, cdn, 'selling_price', item.standard_selling_price);
        });
    }
});