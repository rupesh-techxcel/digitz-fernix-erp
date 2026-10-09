// Copyright (c) 2023, Rupesh P and contributors
// For license information, please see license.txt

// import { general_ledgers } from '/assets/digitz_erp/js/digitz_common.js';

frappe.ui.form.on('Sales Invoice', {
	
	show_a_message: function (frm,message) {
		frappe.call({
			method: 'digitz_erp.api.settings_api.show_a_message',
			args: {
				msg: message
			}
		});
	},
	 refresh: function (frm) {
		 create_custom_buttons(frm);
		 add_print_buttons(frm);
		 show_shortcuts(frm);

		//  if (frm.doc.docstatus === 0 && (!frm.doc.quotation && !frm.doc.sales_order)) 
	
		// update_total_big_display(frm);
		
		if (frm.is_new() && !frm.doc.amended_from)
		{
			console.log("clear table")
			frm.clear_table("items");
			frm.refresh_field("items");
		}    

		if (!frm.is_new()) {

			if (frm.is_dirty()) {
					frappe.msgprint(__("Please save the document before printing."));
					return;
				}
			frm.add_custom_button("Attach PDF", function () {
				frappe.call({
					method: "digitz_erp.selling.doctype.sales_invoice.sales_invoice.print_sales_invoice_pdf",
					args: {
						docname: frm.doc.name
					},
					freeze: true,
					freeze_message: __("Generating PDF..."),
					callback: function (r) {

						frm.reload_doc();						
					}
				});
			},"Print");
		}

	 },
	 setup: function (frm) {

		register_ctrl_p();

		frm.add_fetch('customer', 'full_address', 'customer_address')
		frm.add_fetch('customer', 'salesman', 'salesman')
		frm.add_fetch('customer', 'credit_days', 'credit_days')
		frm.add_fetch('payment_mode', 'account', 'payment_account')

		frm.set_query("warehouse", function() {
			return {
				"filters": {
					"disabled": 0
				}
			};
		});

		frm.set_query("salesman", function() {
			return {
				"filters": {
					"disabled": 0,
					"status": ["!=", "On Boarding"]
				}
			};
		});

		frm.set_query("price_list", function () {
			return {
				"filters": {
					"is_selling": 1
				}
			};
		});

		frm.set_query("customer", function () {
			return {
				"filters": {
					"disabled": 0
				}
			};
		});

		frm.fields_dict['items'].grid.get_field('warehouse').get_query = function(doc, cdt, cdn) {
            return {
                filters: {
                    disabled: 0
                }
            };
		}

		frm.set_query("ship_to_location", function () {
			return {
				"filters": {
					"parent": frm.doc.customer
				}
			};
		});

		frm.set_query('project', function() {
			console.log("project filter applies")
            return {
				
                filters: {
                    customer: frm.doc.customer,
                    docstatus: 1,
                    status: 'Open',
                    disabled: 0
                }
            };});

		frm.fields_dict['items'].grid.get_field('item').get_query = function(doc, cdt, cdn) {
			var child = locals[cdt][cdn];
			return {
				filters: {
					
					'item_type':['not in', ['Labour']]
				}
			};
		};
	},
	async assign_defaults(frm)
	{
		if(frm.is_new())
		{
			await frm.trigger("get_default_company_and_warehouse");

			// Never a credit sale by default; the payment mode as for the customer
			apply_customer_payment_defaults(frm);
		}


	},
	after_save: function (frm) {

		 if (frm.doc.auto_save_delivery_note) {
			// frm.call("auto_generate_delivery_note")
		 }
	},
	validate: function (frm) {

		var valid = false;

		frm.doc.items.forEach(function (entry) {

			if (typeof (entry) == 'undefined') {

			}
			else {
				valid = true;
			}
		});

		if(!frm.doc.credit_sale && !frm.doc.payment_account)
		{
			valid = false;
			frappe.msgprint("Select payment account")
			frm.set_df_property("payment_account", "hidden", frm.doc.credit_sale);
			frm.refresh_field("payment_account");
		}

		if(!frm.doc.credit_sale && !frm.doc.payment_mode)
		{
			valid = false;
			frappe.msgprint("Select payment mode")
		}

		// if (!valid) {
		// 	frappe.message("No valid item found in the document");
		// 	return;
		// }

		if (frm.doc.tab_sales)
			frappe.throw("Cannot change Sales Invoice created from a Tab Sales. Do it from the correspodning Tab Sale")

		if(frm.doc.__islocal) //When the invoice is created by duplicating from an existing invoice, there may be delivery notes allocated
		{					// and it needs to be removed
			if(frm.doc.delivery_notes)
			{
					frm.doc.delivery_notes = undefined;
			}
		}
	},

	customer(frm) {

		apply_customer_billing_details(frm, true);

		// A draft takes the customer's Default Payment Mode (else the company's)
		if (frm.doc.customer) {
			apply_customer_payment_defaults(frm);
		}

		// The customer's assigned price list prices the lines; without one, prices come
		// from the Item master. Setting it fires `price_list`, which re-prices the rows.
		if (frm.doc.customer) {
			frappe.db.get_value('Customer', frm.doc.customer, 'default_price_list', (r) => {
				frm.set_value('price_list', (r && r.default_price_list) || '');
			});
		}

			frappe.call(
			{
				method: 'digitz_erp.accounts.doctype.gl_posting.gl_posting.get_party_balance',
				args: {
					'party_type': 'Customer',
					'party': frm.doc.customer
				},
				callback: (r) => {
					frm.set_value('customer_balance',r.message)
					frm.refresh_field("customer_balance");
				}
			});

			// An invoice raised from a token carries the patient's own name, email and
			// mobile from the token API; picking another Customer must not replace them.
			// Other invoices take them from the customer.
			if (!frm.doc.customer_token) {
				frm.set_value('customer_display_name', frm.doc.customer_name);
				frappe.db.get_value('Customer', frm.doc.customer, 'mobile_no', (c) => {
					frm.set_value('customer_mobile_number', (c && c.mobile_no) || '');
				});
			}

		frappe.call(
			{
				method:'digitz_erp.api.settings_api.get_customer_terms',
				args:{
					'customer': frm.doc.customer
				},
				callback(r){
					console.log(r.message)
					if(r.message && typeof(r.message.template_name)!= undefined && r.message.template_name)
					{
						frm.doc.terms = r.message.template_name;
						frm.refresh_field("terms");
					}
					if( r.message && typeof(r.message.terms != undefined) && r.message.terms )
					{
						frm.doc.terms_and_conditions = r.message.terms
						frm.refresh_field("terms_and_conditions");
					}


				}
			}
		);

		fill_receipt_schedule(frm);
	},
	edit_posting_date_and_time(frm) {

		if (frm.doc.edit_posting_date_and_time == 1) {
			frm.set_df_property("posting_date", "read_only", 0);
			frm.set_df_property("posting_time", "read_only", 0);
		}
		else {
			frm.set_df_property("posting_date", "read_only", 1);
			frm.set_df_property("posting_time", "read_only", 1);
		}
	},
	credit_sale(frm) {

		set_default_payment_mode(frm);

		fill_receipt_schedule(frm,refresh= true)
		set_cash_balance(frm);
	},
	project(frm)
	{
		if(frm.doc.project != undefined)
		{
			frm.set_value('update_stock',false)
		}

		if (frm.doc.project) {
            // Call the server-side method to fetch the sales order
            frappe.db.get_doc('Project', frm.doc.project).then(project => {
                if (project.sales_order) {
                    // Set the sales_order value in the form
                    frm.set_value('sales_order', project.sales_order);

					frappe.db.get_doc('Sales Order', project.sales_order).then(so=>{

						frm.set_value('project_value', so.gross_total)
					})

                }
            });

            // Set update_stock to false
            frm.set_value('update_stock', false);
        }    
	},
	credit_days(frm)
	{
		fill_receipt_schedule(frm,refresh_credit_days= true);
	},
	additional_discount(frm) {
		frm.trigger("make_taxes_and_totals");
	},
	rate_includes_tax(frm) {
		frappe.confirm('Are you sure you want to change this setting which will change the tax calculation in the line items ?',
			() => {
				frm.trigger("make_taxes_and_totals");
			},
			() => {
				// Not confirmed: put the setting back, so the amounts still match it
				frm.doc.rate_includes_tax = cint(frm.doc.rate_includes_tax) ? 0 : 1;
				frm.refresh_field("rate_includes_tax");
			})
	},
	make_taxes_and_totals(frm) {
		// The rules are in the shared Sales Invoice engine (public/js/sales_invoice_engine.js),
		// which the Cashier Console's invoice editor uses too.
		frm.refresh_field("taxes");
		digitz_erp.si_engine.calculate(frm.doc, (fieldname, value) => frm.set_value(fieldname, value));
		frm.refresh_field("round_off");
		frm.refresh_field("rounded_total");

		fill_receipt_schedule(frm);

		update_total_big_display(frm);
		set_cash_balance(frm);

		frm.refresh_field("items");
		frm.refresh_field("taxes");
		frm.refresh_field("gross_total");
		frm.refresh_field("taxable_total");
		frm.refresh_field("net_total");
		frm.refresh_field("tax_total");
		frm.refresh_field("round_off");
	},
	price_list(frm) {
		apply_item_charges(frm);
	},
	received_amount(frm) {
		set_cash_balance(frm);
	},
	payment_mode_type(frm) {
		set_cash_balance(frm);
	},
	payment_mode(frm){
		if (frm.doc.payment_mode === "Cash"){
				update_prices_for_item(frm,"Cash");
		}else if (frm.doc.payment_mode === "Card"){
				update_prices_for_item(frm,"Card");
		}
		
	},
	is_round_off(frm) {
		digitz_erp.si_engine.apply_round_off(frm.doc, (fieldname, value) => frm.set_value(fieldname, value));
		frm.refresh_field('round_off');
		frm.refresh_field('rounded_total');
		fill_receipt_schedule(frm);

		update_total_big_display(frm);

		frm.refresh_field("items");
		frm.refresh_field("taxes");

		frm.refresh_field("gross_total");
		frm.refresh_field("net_total");
		frm.refresh_field("tax_total");
		frm.refresh_field("round_off");

	},
	get_item_stock_balance(frm) {

		frm.doc.selected_item_stock_qty_in_the_warehouse = ""
		frm.refresh_field("selected_item_stock_qty_in_the_warehouse");

		frappe.call(
	    {
			method: 'frappe.client.get_value',
			args: {
				'doctype': 'Stock Balance',
				'filters': { 'item': frm.item, 'warehouse': frm.warehouse },
				'fieldname': ['stock_qty']
			},
			callback: (r2) => {
				console.log(r2);
				if (r2 && r2.message && r2.message.stock_qty !== undefined)
				{
					const itemRow = frm.doc.items.find(item => item.item === frm.item && item.warehouse === frm.warehouse);
					if (itemRow) {
						frm.doc.selected_item_stock_qty_in_the_warehouse = "Stock Bal: "  + r2.message.stock_qty + " for " + frm.item + " at w/h: "+ frm.warehouse + ": ";
						frm.refresh_field("selected_item_stock_qty_in_the_warehouse");
					}
				}
			}
    });

	},
	async get_default_company_and_warehouse(frm) {
		try {
			frm.custom = frm.custom || {};

			// Shared with the Cashier Console (public/js/sales_invoice_engine.js)
			const settings = await digitz_erp.si_engine.company_defaults(frm.doc);
			if (!settings) return;

			frm.refresh_field("company");

			frm.custom.allow_edit_sales_invoice_no = settings.allow_edit_sales_invoice_no;
			frm.set_df_property("sales_inv_no", "hidden", !frm.custom.allow_edit_sales_invoice_no);

			frm.refresh_field("warehouse");
			frm.refresh_field("rate_includes_tax");
			frm.refresh_field("update_rates_in_price_list");
			frm.refresh_field("auto_save_delivery_note");
			frm.refresh_field("update_stock");
			frm.refresh_field("terms");
			frm.refresh_field("terms_and_conditions");

			if (frm.doc.company && settings.hidden_fields.length) {
				settings.hidden_fields.forEach(fieldname => {
					if (frm.fields_dict[fieldname]) {
						frm.set_df_property(fieldname, "hidden", true);
					}
				});

				frm.refresh_fields();
			}
		} catch (err) {
			console.error("Error in get_default_company_and_warehouse:", err);
		}
	},
});

function fill_receipt_schedule(frm, refresh=false,refresh_credit_days=false)
{
	digitz_erp.si_engine.fill_receipt_schedule(frm.doc, refresh, refresh_credit_days);
	refresh_field("receipt_schedule");
}

// Base a line discount is calculated against: qty * (Service Charge + Typing Charges + Transaction Charges + GOV).
function line_discount_base(row) {
	return digitz_erp.si_engine.line_discount_base(row);
}

function update_total_big_display(frm) {

	let total_to_display = flt(frm.doc.rounded_total).toFixed(2);

	// Add 'AED' prefix and format net_total for display
	let displayHtml = `<div style="font-size: 25px; text-align: right; color: black;">AED ${total_to_display}</div>`;

	// The field is missing on some customised layouts / print-only views. Without this
	// guard the throw aborts the caller before it refreshes the tax fields.
	if (frm.fields_dict && frm.fields_dict['total_big'] && frm.fields_dict['total_big'].$wrapper) {
		frm.fields_dict['total_big'].$wrapper.html(displayHtml);
	} else {
		console.warn("[digitz-tax] total_big field not present on this form - skipping big-total display.");
	}
}

// Production diagnostic. Run `digitz_tax_doctor()` from the browser console while a
// Sales Invoice is open to see, in one place, every setting that can switch tax off.
window.digitz_tax_doctor = function () {
	const frm = cur_frm;
	if (!frm) {
		console.error("[digitz-tax] Open a Sales Invoice first.");
		return;
	}

	console.group("[digitz-tax] doctor");
	console.log("doctype:", frm.doc.doctype, "name:", frm.doc.name, "company:", frm.doc.company);
	console.log("parent rate_includes_tax:", frm.doc.rate_includes_tax,
		"->", cint(frm.doc.rate_includes_tax) ? "INCLUSIVE" : "EXCLUSIVE");
	console.log("is_round_off:", frm.doc.is_round_off, "additional_discount:", frm.doc.additional_discount);

	frappe.call({
		method: 'digitz_erp.api.settings_api.get_company_settings',
		callback(r) {
			const s = (r.message && r.message.length) ? r.message[0] : null;
			console.log("Company settings row:", s);
			if (s && cint(s.tax_excluded)) {
				console.warn("[digitz-tax] Company.tax_excluded is ON - every new row is forced to tax_excluded=1, so no tax will ever be calculated. Turn it off in the Company record.");
			}
		}
	});

	frappe.db.get_value('Company', frm.doc.company,
		['rate_includes_tax', 'do_not_apply_round_off_in_si'], (c) => {
			console.log("Company tax/rounding config:", c);
			if (c && cint(c.rate_includes_tax) !== cint(frm.doc.rate_includes_tax)) {
				console.warn("[digitz-tax] Company.rate_includes_tax (" + c.rate_includes_tax +
					") differs from this document's value (" + frm.doc.rate_includes_tax +
					"). rate_includes_tax is read-only on the form and is stamped at creation time.");
			}
		});

	(frm.doc.items || []).forEach((row, i) => {
		if (!row.item) { return; }
		frappe.db.get_value('Item', row.item, ['service_charge', 'typing_charges', 'transaction_charges', 'gov', 'tax', 'tax_excluded'], (it) => {
			console.log("row " + (i + 1) + " " + row.item + " | Item master:", it,
				"| row:", {
					service_charge: row.service_charge, typing_charges: row.typing_charges, transaction_charges: row.transaction_charges, gov: row.gov, rate: row.rate, qty: row.qty,
					tax: row.tax, tax_rate: row.tax_rate, tax_excluded: row.tax_excluded,
					discount_amount: row.discount_amount
				});
			if (it && cint(it.tax_excluded)) {
				console.warn("[digitz-tax] Item " + row.item + " has 'Tax Not Applicable' checked (the Item field defaults to 1). No tax will be applied to it.");
			}
			if (it && !it.tax && (flt(it.service_charge) + flt(it.typing_charges) + flt(it.transaction_charges)) > 0) {
				console.warn("[digitz-tax] Item " + row.item + " has Service Charge/Typing Charges/Transaction Charges but no Tax link, so tax_rate stays 0.");
			}
			if (it && !flt(it.service_charge) && !flt(it.typing_charges) && !flt(it.transaction_charges) && !flt(it.gov)) {
				console.error("[digitz-tax] Item " + row.item + " has Service Charge, Typing Charges, Transaction Charges and GOV all 0 on the Item master. The rate is derived from their sum, so this line can only ever come out as 0 with no tax. THIS IS THE FIX: set Service Charge, Typing Charges, Transaction Charges and GOV as applicable on the Item.");
			}
			if (it && (flt(it.service_charge) !== flt(row.service_charge) || flt(it.typing_charges) !== flt(row.typing_charges) || flt(it.transaction_charges) !== flt(row.transaction_charges) || flt(it.gov) !== flt(row.gov))) {
				console.warn("[digitz-tax] Item " + row.item + ": row Service Charge/Typing Charges/Transaction Charges/GOV (" + flt(row.service_charge) + "/" + flt(row.typing_charges) + "/" + flt(row.transaction_charges) + "/" + flt(row.gov) +
					") differ from the Item master (" + flt(it.service_charge) + "/" + flt(it.typing_charges) + "/" + flt(it.transaction_charges) + "/" + flt(it.gov) +
					"). The row copies them when the item is picked; re-pick the item to refresh them.");
			}
		});
	});

	console.log("Last calculation trace: window.digitz_last_tax_debug");
	console.groupEnd();
};
function show_sales_quotation_dialog(frm){
	if (!frm.doc.customer) {
        frappe.msgprint("Select a customer");
        return;
    }

    frappe.call({
        method: 'digitz_erp.api.quotation_api.get_pending_quotation_for_new_sales_invoice',
        args: { customer: frm.doc.customer },
        callback: function (r) {
            if (r.message && r.message.length > 0) {
                const quotations = r.message;
                const content = $('<div>').append($('<table class="table table-bordered">')
                    .append('<thead><tr><th>Select</th><th>Quotation</th><th>Date</th><th>Amount</th></tr></thead>')
                    .append($('<tbody>').append(quotations.map(dN =>
                        `<tr><td><input type="checkbox" class="delivery-note-checkbox" data-delivery-note="${dN['Quotation']}"/></td><td>${dN['Quotation']}</td><td>${dN['Date']}</td><td>${dN['Amount']}</td></tr>`
                    ))));

                const dialog = new frappe.ui.Dialog({
                    title: 'Select Quotations',
                    fields: [{ fieldtype: 'HTML', fieldname: 'quotations', options: content.html() }],
                    primary_action_label: 'Select',
                    primary_action: function () {
                        const selectedQuotations = $('.delivery-note-checkbox:checked').map(function () {
                            return $(this).data('delivery-note');
                        }).get();

                        // Clearing previously selected items before making a new call
                        dialog.get_field("quotations").$wrapper.empty();

                        frappe.call({
                            method: 'digitz_erp.api.quotation_api.get_quotation_items',
                            args: { quotation_list: JSON.stringify(selectedQuotations) },
                            callback: function (response) {
                                process_delivery_note_items(frm, response.message);
                                dialog.hide();
                            }
                        });
                    }
                });

                dialog.show();
            } else {
                frappe.msgprint('No pending Quotations for this customer.');
            }
        }
    });

}

function show_delivery_notes_dialog(frm) {
    if (!frm.doc.customer) {
        frappe.msgprint("Select a customer");
        return;
    }

    frappe.call({
        method: 'digitz_erp.api.delivery_note_api.get_pending_delivery_notes_for_new_sales_invoice',
        args: { customer: frm.doc.customer },
        callback: function (r) {
            if (r.message && r.message.length > 0) {
                const deliveryNotes = r.message;
                const content = $('<div>').append($('<table class="table table-bordered">')
                    .append('<thead><tr><th>Select</th><th>Delivery Note</th><th>Date</th><th>Amount</th></tr></thead>')
                    .append($('<tbody>').append(deliveryNotes.map(dN =>
                        `<tr><td><input type="checkbox" class="delivery-note-checkbox" data-delivery-note="${dN['Delivery Note']}"/></td><td>${dN['Delivery Note']}</td><td>${dN['Date']}</td><td>${dN['Amount']}</td></tr>`
                    ))));

                const dialog = new frappe.ui.Dialog({
                    title: 'Select Delivery Notes',
                    fields: [{ fieldtype: 'HTML', fieldname: 'delivery_notes', options: content.html() }],
                    primary_action_label: 'Select',
                    primary_action: function () {
                        const selectedDeliveryNotes = $('.delivery-note-checkbox:checked').map(function () {
                            return $(this).data('delivery-note');
                        }).get();

                        // Clearing previously selected items before making a new call
                        dialog.get_field("delivery_notes").$wrapper.empty();

                        frappe.call({
                            method: 'digitz_erp.api.delivery_note_api.get_delivery_note_items',
                            args: { delivery_notes: JSON.stringify(selectedDeliveryNotes) },
                            callback: function (response) {
                                process_delivery_note_items(frm, response.message);
                                dialog.hide();
                            }
                        });
                    }
                });

                dialog.show();
            } else {
                frappe.msgprint('No pending delivery notes for this customer.');
            }
        }
    });
}

function process_delivery_note_items(frm, items) {
    // `Delivery Note Item` has no Service Charge/Typing Charges/Transaction Charges/GOV columns, so items pulled from a
    // delivery note arrive with a rate but with all three at 0. Since the rate is always derived from
    // their sum, those rows would otherwise collapse to rate 0 and produce no tax at all.
    // Read them from the Item master first, then build the rows.
    const item_codes = [...new Set((items || []).map(i => i.item).filter(Boolean))];

    if (!item_codes.length) {
        add_delivery_note_rows(frm, items, {});
        return;
    }

    frappe.db.get_list('Item', {
        filters: { item_code: ['in', item_codes] },
        fields: ['item_code', 'service_charge', 'typing_charges', 'transaction_charges', 'gov'],
        limit_page_length: 0
    }).then(rows => {
        const charges = {};
        (rows || []).forEach(r => { charges[r.item_code] = r; });

        const missing = item_codes.filter(c => !charges[c] || (!flt(charges[c].service_charge) && !flt(charges[c].typing_charges) && !flt(charges[c].transaction_charges) && !flt(charges[c].gov)));
        if (missing.length) {
            frappe.msgprint({
                title: __("Service Charge / Typing Charges / Transaction Charges / GOV not set"),
                indicator: "red",
                message: __("These items have no Service Charge, Typing Charges, Transaction Charges or GOV on the Item master, so their rate and tax will be 0: {0}", [missing.join(", ")])
            });
        }

        add_delivery_note_rows(frm, items, charges);
    });
}

function add_delivery_note_rows(frm, items, charges) {
    let any_duplicate = false;

    items.forEach(item => {
        // Check if the item already exists in the sales invoice based on a unique identifier, like the delivery note item reference number
        const exists = frm.doc.items && frm.doc.items.some(frmItem => frmItem.delivery_note_item_reference_no === item.delivery_note_item_reference_no);

        if (!exists) {
            frm.add_child('items', {
                item: item.item,
                item_name: item.item_name,
                qty: item.qty,
                warehouse: item.warehouse,
                display_name: item.display_name,
                unit: item.unit,
                service_charge: flt((charges[item.item] || {}).service_charge),
                typing_charges: flt((charges[item.item] || {}).typing_charges),
                transaction_charges: flt((charges[item.item] || {}).transaction_charges),
                gov: flt((charges[item.item] || {}).gov),
                rate: flt((charges[item.item] || {}).service_charge) + flt((charges[item.item] || {}).typing_charges) + flt((charges[item.item] || {}).transaction_charges) + flt((charges[item.item] || {}).gov),
                base_unit: item.base_unit,
                // Units are ignored: no conversion, so base-unit qty/rate are just
                // qty/rate. make_taxes_and_totals recomputes these anyway.
                qty_in_base_unit: flt(item.qty),
                rate_in_base_unit: flt((charges[item.item] || {}).service_charge) + flt((charges[item.item] || {}).typing_charges) + flt((charges[item.item] || {}).transaction_charges) + flt((charges[item.item] || {}).gov),
                conversion_factor: 1,
                rate_includes_tax: item.rate_includes_tax,
                gross_amount: item.gross_amount,
                tax_excluded: item.tax_excluded,
                tax_rate: item.tax_rate,
                tax_amount: item.tax_amount,
                discount_percentage: item.discount_percentage,
                discount_amount: item.discount_amount,
                net_amount: item.net_amount,
                delivery_note_item_reference_no: item.delivery_note_item_reference_no
            });
        } else {
            any_duplicate = true;
        }
    });

    frm.refresh_field('items');
    frm.trigger("make_taxes_and_totals");

    if (any_duplicate) {
        frappe.msgprint("One or more items from the delivery note already exist in the document. These items have been ignored.");
    }
}


frappe.ui.form.on("Sales Invoice", "onload", function (frm) {

	frm.trigger("assign_defaults")	
});

frappe.ui.form.on("Sales Invoice", "refresh", function (frm) {

	apply_customer_billing_details(frm, false);

	frappe.call({
		method: "digitz_erp.selling.doctype.sales_invoice.sales_invoice.get_customer_mobile_number_mandatory",
		callback: function (r) {
			frm.set_df_property("customer_mobile_number", "reqd", cint(r.message));
		}
	});

	if (frm.doc.docstatus === 0 && is_placeholder_mobile(frm.doc.customer_mobile_number)) {
		frm.dashboard.set_headline(
			__("Mobile number {0} is a placeholder. Enter the customer's real mobile number before submitting.",
				[frappe.utils.escape_html(frm.doc.customer_mobile_number)]),
			"orange"
		);
	}
});

// A token that arrives without a mobile number is saved with 0000 so the draft
// exists; the server refuses to submit it with that, and so does the form, with
// the cursor put in the field to fix.
frappe.ui.form.on("Sales Invoice", "before_submit", function (frm) {
	if (frm.fields_dict.customer_mobile_number.df.reqd && is_placeholder_mobile(frm.doc.customer_mobile_number)) {
		frm.scroll_to_field("customer_mobile_number");
		frappe.throw({
			title: __("Mobile Number Needed"),
			message: __("{0} is a placeholder. Enter the customer's real mobile number before submitting.",
				[frappe.utils.escape_html(frm.doc.customer_mobile_number)]),
		});
	}
});

// A cash sale needs the cash tendered, covering the total, on every save and on
// submit. The field is marked mandatory for Cash (mandatory_depends_on); this adds
// the total check and puts the cursor in the field. The server enforces the same
// (validate_received_amount).
frappe.ui.form.on("Sales Invoice", "validate", function (frm) {
	const error = digitz_erp.si_engine.cash_received_error(frm.doc);
	if (error) {
		frm.scroll_to_field("received_amount");
		frappe.throw(error);
	}
});

frappe.ui.form.on("Sales Invoice", "customer_mobile_number", function (frm) {
	if (!is_placeholder_mobile(frm.doc.customer_mobile_number)) {
		frm.dashboard.clear_headline();
	}
});

// Same rule as is_placeholder_mobile in sales_invoice.py: 0000, or any all-zero number
function is_placeholder_mobile(number) {
	return digitz_erp.si_engine.is_placeholder_mobile(number);
}

frappe.ui.form.on('Sales Invoice Item', {
	item(frm, cdt, cdn) {

		let row = frappe.get_doc(cdt, cdn);

		if (typeof (frm.doc.customer) == "undefined" || !frm.doc.customer) {
			frappe.msgprint("Select customer.");
			frappe.model.set_value(cdt, cdn, "item", "");
			return;
		}

		frm.item = row.item;

		// Name, unit, tax and Service Charge / Typing Charges / Transaction Charges / GOV from the Item master
		digitz_erp.si_engine.load_item(frm.doc, row).then((r) => {
			if (!r.found) {
				return;
			}

			frm.item = row.item;
			frm.warehouse = row.warehouse;

			if (r.advance_message) {
				frm.events.show_a_message(frm, r.advance_message);
			}

			frm.trigger("get_item_stock_balance");

			// Charges come from the price list when it has a price for the item,
			// otherwise from the Item master (already on the row). This also
			// recalculates the totals.
			apply_item_charges(frm, [row]);
		});
	},
	tax_excluded(frm, cdt, cdn) {
		let row = frappe.get_doc(cdt, cdn);

		if (row.tax_excluded) {
			row.tax = "";
			row.tax_rate = 0;
			frm.refresh_field("items");
			frm.trigger("make_taxes_and_totals");
		}
	},
	tax(frm, cdt, cdn) {
		let row = frappe.get_doc(cdt, cdn);

		if (!row.tax_excluded) //For tax excluded, tax and rate already adjusted
		{
			digitz_erp.si_engine.load_tax_rate(row).then(() => {
				frm.refresh_field("items");
				frm.trigger("make_taxes_and_totals");
			});
		}
	},
	qty(frm, cdt, cdn) {
		frm.trigger("make_taxes_and_totals");
	},
	gov(frm, cdt, cdn) {
		frm.trigger("make_taxes_and_totals");
	},
	service_charge(frm, cdt, cdn) {
		frm.trigger("make_taxes_and_totals");
	},
	typing_charges(frm, cdt, cdn) {
		frm.trigger("make_taxes_and_totals");
	},
	transaction_charges(frm, cdt, cdn) {
		frm.trigger("make_taxes_and_totals");
	},
	// rate(frm, cdt, cdn) {
	// 	frm.trigger("make_taxes_and_totals");
	// },
	rate_includes_tax(frm, cdt, cdn) {
		frm.trigger("make_taxes_and_totals");
	},
	// The `unit` handler used to look up a UOM conversion factor and rescale the rate
	// from it. Units are ignored in this document and the rate comes only from Service Charge + Typing Charges + Transaction Charges + GOV,
	// so there is nothing left for it to do. Deliberately removed.
	discount_percentage(frm, cdt, cdn) {
		let row = frappe.get_doc(cdt, cdn);
		const message = digitz_erp.si_engine.apply_discount_percentage(row);
		if (message) {
			frappe.msgprint(message);
		}

		frm.refresh_field("items");
		frm.trigger("make_taxes_and_totals");
	},
	discount_amount(frm, cdt, cdn) {
		let row = frappe.get_doc(cdt, cdn);
		const message = digitz_erp.si_engine.apply_discount_amount(row);
		if (message) {
			frappe.msgprint(message);
		}

		frm.refresh_field("items");
		frm.trigger("make_taxes_and_totals");
	},
	warehouse(frm, cdt, cdn) {
		let row = frappe.get_doc(cdt, cdn);
		frm.item = row.item
		frm.warehouse = row.warehouse
		frm.trigger("get_item_stock_balance");
	},
	items_add(frm, cdt, cdn) {
		var child = locals[cdt][cdn];
		if (frm.doc.default_cost_center) {
			frappe.model.set_value(cdt, cdn, 'cost_center', frm.doc.default_cost_center);
		}

		let row = frappe.get_doc(cdt, cdn);
		row.warehouse = frm.doc.warehouse

		frm.trigger("make_taxes_and_totals");

	},
	items_remove(frm, cdt, cdn) {
		frm.trigger("make_taxes_and_totals");
	}
});

// How a new invoice is paid by default, from get_sales_payment_defaults (the
// same rule the token sync and data import use): the customer's Default Payment
// Mode, else the company's. A credit sale has no payment mode.
function get_sales_payment_defaults(frm) {
	return digitz_erp.si_engine.payment_defaults(frm.doc);
}

// On a draft, when the customer is picked (or a new invoice already has one):
// their payment mode. A credit sale stays as the user left it, never defaulted.
function apply_customer_payment_defaults(frm) {
	if (frm.doc.docstatus !== 0) {
		return;
	}
	set_default_payment_mode(frm);
}

function set_default_payment_mode(frm)
{
	if(frm.doc.credit_sale == 0){
		get_sales_payment_defaults(frm).then((d) => {
			if (d.payment_mode) {
				frm.set_value('payment_mode', d.payment_mode);
			} else {
				frappe.msgprint('Default payment mode for sales not found.');
			}
		});
    }
	else{

		frm.set_value('payment_mode', '');
	}

	frm.set_df_property("credit_days", "hidden", !frm.doc.credit_sale);
	frm.set_df_property("payment_mode", "hidden", frm.doc.credit_sale);
	frm.set_df_property("payment_account", "hidden", frm.doc.credit_sale);
	frm.set_df_property("payment_mode", "mandatory", !frm.doc.credit_sale);
}

let create_custom_buttons = function(frm){

	if (frappe.user.has_role('Management')) {
		if(!frm.is_new() && (frm.doc.docstatus == 1)){
		frm.add_custom_button('General Ledgers',() =>{
				general_ledgers(frm)
		}, 'Postings');
			frm.add_custom_button('Stock Ledgers',() =>{
				stock_ledgers(frm)
		}, 'Postings');
		}
	}

	// if (!frm.is_new()) {
	// 	frm.add_custom_button(__('Duplicate'), function() {
	// 		// Call the method directly on the server-side document instance
	// 		frm.call({
	// 			method: "generate_sales_invoice",
	// 			doc: frm.doc,
	// 			callback: function(r) {
	// 				if (!r.exc) {
	// 					// Navigate to the new duplicated invoice
	// 					frappe.set_route("Form", "Sales Invoice", r.message);
	// 					frappe.show_alert({
	// 						message: __("New Sales Invoice " + r.message + " has been opened."),
	// 						indicator: 'green'
	// 					});
	// 				}
	// 			}
	// 		});
	// 	} );
	// }

	// if(frm.is_new())
	// {
	// 	frm.add_custom_button(__('Get Items From Quotation'), function () {
	// 		show_sales_quotation_dialog(frm)
	// 	});
	// }
	// {
	// 	frm.add_custom_button(__('Get Items From Delivery Note'), function () {
	// 		show_delivery_notes_dialog(frm)
	// 		});
	// }

	

if (
	frm.doc.docstatus === 1 &&
	(
		frappe.session.user === "Administrator" ||
		frappe.session.user === "it-admin" ||
		frappe.user.has_role("Management")
	)
) {
	frm.add_custom_button("Revert To Draft", () => {
		frappe.confirm(
			__("This will delete GL Posting rows for this voucher and reset the document to Draft. Do you want to continue?"),
			() => {
				frappe.show_alert({
					message: __("Processing revert to draft..."),
					indicator: "orange"
				});

				frm.call({
					method: "digitz_erp.api.gl_posting_api.reset_gl_for_voucher",
					args: {
						voucher_doctype: frm.doc.doctype,
						voucher_name: frm.doc.name
					},
					freeze: true,
					freeze_message: __("Reverting to Draft..."),
					callback: function(r) {
						if (!r.exc) {
							frappe.msgprint({
								title: __("Success"),
								message: r.message || __("Document succesfully reverted to draft."),
								indicator: "green"
							});
							frm.reload_doc();
						}
					}
				});
			}
		);
	});
}
}

let general_ledgers = function (frm) {
	digitz_erp.si_engine.show_gl_postings(frm.doc.doctype, frm.doc.name);
};

let stock_ledgers = function (frm) {
	digitz_erp.si_engine.show_stock_ledgers(frm.doc.doctype, frm.doc.name);
};
















console.log("file is connected.");

frappe.ui.form.on("Sales Invoice",{
    refresh(frm){
        // frm.set_df_property('custom_item_table', 'hidden', 1);

        // frm.add_custom_button(__('Allocate'), function() {
        //     // Define the dialog
        //     let d = new frappe.ui.Dialog({
        //         title: 'Allocate Receipt Entry',
        //         fields: [
        //             {
        //                 label: 'Receipt Entry',
        //                 fieldname: 'receipt_entry',
        //                 fieldtype: 'Link',
        //                 options: 'Receipt Entry',
        //                 get_query: function() {
        //                     return {
        //                         filters: [
        //                             ['advance_payment', '=', 1],
        //                             ['project', '=', frm.doc.project],
        //                             ['customer', '=', frm.doc.customer]
        //                         ]
        //                     };
        //                 }
        //             }
        //         ],
        //         primary_action: function(data) {
        //             console.log('Selected Receipt Entry:', data.receipt_entry);

        //             frappe.call({
        //                 method: 'digitz_erp.accounts.doctype.receipt_entry.receipt_entry.receipt_allocation_updates',
        //                 args:{
        //                     receipt_entry_id: data.receipt_entry,
        //                     sales_inv_id: frm.doc.name
        //                 },
        //                 callback: function(response){
        //                     if(response.message){

        //                     }
        //                 }
        //             })

        //             d.hide();
        //         },
        //         primary_action_label: __('Allocate')
        //     });

        //     // Show the dialog
        //     d.show();
        // });
    },    
    setup(frm){
        let prev_customer = localStorage.getItem("prev_customer");
        let prev_project = localStorage.getItem("prev_project");
        let proforma_invoice = localStorage.getItem("proforma_invoice");
        console.log(prev_customer,prev_project)

        if(prev_customer && prev_project && proforma_invoice){
            frm.set_value("customer",prev_customer);
            console.log(2);
            frm.set_value("project",prev_project);
            frm.set_value("stage_proforma_invoice",proforma_invoice);
        }

        localStorage.removeItem("prev_customer");
        localStorage.removeItem("prev_project");
        localStorage.removeItem("proforma_invoice");


        if(proforma_invoice){
            frm.set_df_property('items', 'hidden', 1);
            frm.set_df_property('item_table', 'hidden', 0);
            frm.set_df_property('section_break_25', 'hidden', 1);

            frappe.call({
                method:"digitz_erp.project.doctype.proforma_invoice.proforma_invoice.get_items",
                args: {
                    proforma_id : proforma_invoice,
                },
                callback: function(response){
                    if(response.message){
                        data = response.message;
                        console.log(data);

                        // data.item_table.forEach(item =>{
                        //     console.log('Hello',item)
                        //     let row = frm.add_child("custom_item_table",{
                        //         "item_name": item.item_name,
                        //         "description": item.description,
                        //         "qty":item.qty,
                        //         "rate": item.amount,
                        //         "amount": item.amount
                        //     })
                        // })
                        data.item_table.forEach(item =>{
                            let row = frm.add_child('item_table',{
                                "item": item.item,
                                "description": item.description,
                                "completed_percentage": item.completed_percentage,
                                "quantity": item.quantity,
                                "unit": item.unit,
                                "rate": item.rate,
                                "amount": item.amount
                        })});
                        frm.refresh_field('item_table');
                        frm.trigger("make_taxes_and_totals");

                    }
                }
            })
        }
    }   
})


// Re-prices the lines when the payment mode changes. Cash and Card are priced the
// same today, so this is the normal price list / Item master pricing. It used to
// write rate, gross and net straight onto the rows and skip the tax calculation,
// which left the totals and the saved amounts out of step with the lines.
function update_prices_for_item(frm, mode) {
	apply_item_charges(frm);
}

// Set Service Charge, Typing Charges, Transaction Charges and GOV on `rows` (default: every row with an
// item) from the invoice's price list, falling back to the Item master, then
// recalculate. Only a draft is re-priced.
function apply_item_charges(frm, rows) {
	if (frm.doc.docstatus !== 0) {
		return;
	}

	digitz_erp.si_engine.apply_item_charges(frm.doc, rows).then((rate_only) => {
		if (rate_only) {
			digitz_erp.si_engine.rate_only_alert(frm.doc, rate_only);
			frm.refresh_field("items");
		}
		frm.trigger("make_taxes_and_totals");
	});
}

// Customer Company and Tax Id come from the customer and are read-only, except on
// the Default Walk-in Customer, where the user types the applicant's company and
// TRN. With `set_values` (a customer was just picked) the fields are also filled,
// or cleared for the walk-in customer; on refresh only the editability is set.
function apply_customer_billing_details(frm, set_values) {
	if (!frm.doc.customer) {
		return;
	}

	digitz_erp.si_engine.customer_billing_details(frm.doc.customer).then((details) => {
		const editable = details.is_walk_in && frm.doc.docstatus === 0;

		frm.set_df_property("customer_company", "read_only", editable ? 0 : 1);
		frm.set_df_property("tax_id", "read_only", editable ? 0 : 1);

		if (set_values) {
			frm.set_value("customer_company", details.customer_company || "");
			frm.set_value("tax_id", details.tax_id || "");
		}
	});
}


// Received Amount is the cash tendered and Balance the change to give back. Both
// apply only to a cash payment mode on a sale that is not on credit; the server
// works Balance out again on save.
function set_cash_balance(frm) {
	digitz_erp.si_engine.set_cash_balance(frm.doc, (fieldname, value) => frm.set_value(fieldname, value));
}

// ------------------------------------------------------------ printing

// Print Invoice / Print Receipt under the Print group. Both save the invoice
// first when it has unsaved changes, so the printout is always what is stored.
function add_print_buttons(frm) {
	if (frm.doc.for_advance_payment) {
		return;
	}
	frm.add_custom_button(__("Print Invoice"), () => print_sales_invoice(frm, "invoice"), __("Print"));
	// A receipt exists for a cash sale, and for a credit sale once a receipt has paid it
	if (!frm.is_new() && (!frm.doc.credit_sale || frm.doc.allocated_receipt_entry)) {
		frm.add_custom_button(__("Print Receipt"), () => print_sales_invoice(frm, "receipt"), __("Print"));
	}
}

async function print_sales_invoice(frm, kind = "invoice") {
	if (!(frm.doc.items || []).some((row) => row.item)) {
		frappe.msgprint(__("Items are required before printing."));
		return;
	}

	// Save first. Saving a draft regenerates its PDFs (before_save), so they are
	// then only looked up rather than generated a second time.
	let fresh = false;
	if (frm.is_new() || frm.is_dirty()) {
		try {
			await frm.save(frm.doc.docstatus === 1 ? "Update" : "Save");
		} catch (e) {
			return; // the save's own message is already shown
		}
		if (frm.is_dirty()) {
			return; // validation stopped the save
		}
		fresh = frm.doc.docstatus === 0;
	}

	const files = await digitz_erp.si_engine.get_print_pdfs(frm.doc.name, fresh);
	const url = files[kind];
	if (!url) {
		frappe.msgprint(kind === "receipt" ? __("This invoice has no receipt yet.") : __("The PDF was not found. Try again."));
		return;
	}
	digitz_erp.si_engine.print_pdf(url, kind === "receipt" ? __("Receipt PDF") : __("Invoice PDF"));
	frm.reload_doc();
}

// Ctrl+P on the Sales Invoice form prints the invoice PDF (saving first), not
// Frappe's print view. Registered once; it only applies while this form is on screen.
function register_ctrl_p() {
	if (digitz_erp.si_form_ctrl_p) {
		return;
	}
	digitz_erp.si_form_ctrl_p = true;
	digitz_erp.si_engine.on_ctrl_p({
		applies: () => {
			const route = frappe.get_route();
			return route[0] === "Form" && route[1] === "Sales Invoice"
				&& cur_frm && cur_frm.doctype === "Sales Invoice" && !cur_frm.doc.for_advance_payment
				&& cur_frm.page.wrapper.is(":visible");
		},
		print: () => print_sales_invoice(cur_frm, "invoice"),
	});
}

// The form's keyboard shortcuts, as a strip above the fields
function show_shortcuts(frm) {
	frm.layout.wrapper.find(".si-shortcuts").remove();
	const shortcuts = [];
	frm.doc.docstatus === 0 && shortcuts.push(["Ctrl+S", __("Save / Submit")]);
	frm.doc.for_advance_payment || shortcuts.push(["Ctrl+P", __("Print Invoice")]);
	frm.is_new() || shortcuts.push(["Ctrl+B", __("New Sales Invoice")]);
	shortcuts.push(["Ctrl+G", __("Search")], ["?", __("All Shortcuts")]);
	frm.layout.wrapper.prepend(digitz_erp.si_engine.shortcuts_html(shortcuts));
}
