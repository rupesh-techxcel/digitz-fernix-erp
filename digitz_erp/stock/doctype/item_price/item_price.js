// Copyright (c) 2023, Rupesh P and contributors
// For license information, please see license.txt

frappe.ui.form.on('Item Price', {
	// The discount against Standard Selling is read fresh each time the form opens
	// and whenever the item or price list changes; a rate change only recomputes it.
	refresh(frm) {
		load_standard_rate(frm);
	},
	item(frm) {
		load_standard_rate(frm);
	},
	price_list(frm) {
		load_standard_rate(frm);
	},
	rate(frm) {
		show_standard_discount(frm);
	},

	is_selling(frm)
	{
		console.log("is_selling")
		frm.doc.is_buying = !frm.doc.is_selling
		frm.refresh_field("is_buying");  
	},
	is_buying(frm)
	{
		console.log("is buying")
		frm.doc.is_selling = !frm.doc.is_buying
		frm.refresh_field("is_selling"); 
	},

	// The rate is Service Charge + Typing Charges + GOV whenever any of them is set.
	// The server does the same on save; this keeps the form in step while typing.
	service_charge(frm) {
		set_rate_from_charges(frm);
	},
	typing_charges(frm) {
		set_rate_from_charges(frm);
	},
	gov(frm) {
		set_rate_from_charges(frm);
	},

	validate: function (frm) {

		if ((frm.doc.from_date && !frm.doc.to_date) || (!frm.doc.from_date && frm.doc.to_date)) {
            frappe.msgprint(__('Both From Date and To Date must be selected together.'));
            frappe.validated = false;
        }
	},
	get_default_currency(frm)
	{

		var default_company = ""

		frappe.call({
			method: 'frappe.client.get_value',
			args: {
				'doctype': 'Global Settings',
				'fieldname': 'default_company'
			},
			callback: (r) => {

				default_company = r.message.default_company
				frm.doc.company = r.message.default_company
				frm.refresh_field("company");
				frappe.call(
					{
						method: 'frappe.client.get_value',
						args: {
							'doctype': 'Company',
							'filters': { 'company_name': default_company },
							'fieldname': ['default_currency']
						},
						callback: (r2) => {
							
							
							frm.doc.currency = r2.message.default_currency;							
							frm.refresh_field("currency");
	}
	})}});
},


});

const STANDARD_PRICE_LIST = "Standard Selling";

// Fetch the item's current standard selling rate, then show the discount.
async function load_standard_rate(frm) {
	frm.standard_rate = null;
	frm.dashboard.clear_headline();

	if (!frm.doc.item || !frm.doc.price_list || frm.doc.price_list === STANDARD_PRICE_LIST) {
		return;
	}

	// Only a selling list is a deviation from the standard selling price
	const pl = await frappe.db.get_value("Price List", frm.doc.price_list, "is_selling");
	if (!cint((pl.message || {}).is_selling)) {
		return;
	}

	const r = await frappe.call({
		method: "digitz_erp.api.price_list_manager_api.get_standard_rate",
		args: { item: frm.doc.item },
	});
	frm.standard_rate = flt((r.message || {}).standard_rate);
	show_standard_discount(frm);
}

function show_standard_discount(frm) {
	if (frm.standard_rate === null || frm.standard_rate === undefined) {
		return;
	}

	const currency = frm.doc.currency || "";
	const standard = frm.standard_rate;
	const fmt = (v) => format_currency(v, currency);

	if (!standard) {
		frm.dashboard.set_headline(__("{0} has no {1} price to compare with.", [frm.doc.item, STANDARD_PRICE_LIST]));
		return;
	}

	const discount = standard - flt(frm.doc.rate);
	const pct = ((discount * 100) / standard).toFixed(1);
	let text;
	if (Math.abs(discount) < 0.005) {
		text = __("Same as the {0} rate of {1}.", [STANDARD_PRICE_LIST, fmt(standard)]);
	} else if (discount > 0) {
		text = __("{0} rate {1} · discount <b>{2} ({3}%)</b>", [STANDARD_PRICE_LIST, fmt(standard), fmt(discount), pct]);
	} else {
		text = __("{0} rate {1} · <b>{2} ({3}%) above</b> it", [STANDARD_PRICE_LIST, fmt(standard), fmt(-discount), (-pct).toFixed(1)]);
	}
	frm.dashboard.set_headline(text, discount < 0 ? "red" : "green");
}

function set_rate_from_charges(frm) {
	const charges = flt(frm.doc.service_charge) + flt(frm.doc.typing_charges) + flt(frm.doc.gov);
	if (flt(frm.doc.service_charge) || flt(frm.doc.typing_charges) || flt(frm.doc.gov)) {
		frm.set_value("rate", charges);
	}
}

frappe.ui.form.on("Item Price", "onload", function (frm) {

	console.log("")

	if(frm.doc.__islocal)
	{
		frm.trigger("get_default_currency");
	}
});
