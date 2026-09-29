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
					'fieldname': ['item_name','service_charge','typing_charges','gov', 'base_unit', 'tax', 'tax_excluded']
				},
				callback: (r) => {
					console.log("item")
					console.log(r)
					// Rate is Service Charge + Typing Charges + GOV; VAT is on the first two only
					const taxable = flt(r.message.service_charge) + flt(r.message.typing_charges);
					row.item_name = r.message.item_name;
					row.rate = taxable + flt(r.message.gov);
                    row.unit = r.message.base_unit;
                    row.tax = r.message.tax;
                    row.qty = 1;
                    row.tax_excluded =  r.message.tax_excluded;
                    row.gross_amount = row.rate;
                    row.net_amount = row.rate;
                    row.service_charge = r.message.service_charge
                    row.typing_charges = r.message.typing_charges
                    row.gov = r.message.gov
                    if (!r.message.tax_excluded){
                        row.tax_amount = taxable * 0.05
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
            frappe.model.set_value(cdt,cdn,'tax_amount', (row.qty * (flt(row.service_charge) + flt(row.typing_charges))) * (5 / 100));
        }

    }

});