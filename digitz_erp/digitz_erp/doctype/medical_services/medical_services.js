// Copyright (c) 2025, Techxcel Technologies and contributors
// For license information, please see license.txt

frappe.ui.form.on("Medical Services", {
	refresh(frm) {

	},
});
frappe.ui.form.on("Service Items",{
    
    item(frm,cdt,cdn){
        let row = frappe.get_doc(cdt, cdn);
        console.log("Working till here")
        console.log(row)
        frappe.call(
			{
				method: 'frappe.client.get_value',
				args: {
					'doctype': 'Item',
					'filters': { 'item_code': row.item },
					'fieldname': ['item_name','com','gov', 'base_unit', 'tax', 'tax_excluded']
				},
				callback: (r) => {
					console.log("item")
					console.log(r)
					row.item_name = r.message.item_name;
					row.rate = r.message.com + r.message.gov;
                    row.unit = r.message.base_unit;
                    row.tax = r.message.tax;
                    row.qty = 1;
                    row.tax_excluded =  r.message.tax_excluded;
                    row.gross_amount = r.message.com + r.message.gov;
                    row.net_amount = r.message.com + r.message.gov;
                    row.com = r.message.com
                    row.gov = r.message.gov
                    if (!r.message.tax_excluded){
                        row.tax_amount = r.message.com * 0.05
                    }
                }
            });
    },
    qty(frm,cdt,cdn){
        console.log("Called")
        let row = frappe.get_doc(cdt, cdn);
        // row.gross_amount = row.qty * row.rate
        frappe.model.set_value(cdt,cdn,'gross_amount', row.qty * row.rate);
        console.log(row.gross_amount)
        // row.net_amount = row.qty * row.rate
        frappe.model.set_value(cdt,cdn,'net_amount', row.qty * row.rate);
        if (!row.tax_excluded){
            frappe.model.set_value(cdt,cdn,'tax_amount', (row.qty * row.com) * (5 / 100));
        }

    }

});