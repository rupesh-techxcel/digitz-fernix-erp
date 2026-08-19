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

		frm.add_fetch('customer', 'full_address', 'customer_address')
		frm.add_fetch('customer', 'salesman', 'salesman')
		frm.add_fetch('customer', 'tax_id', 'tax_id')
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

			// frappe.db.get_value('Company', frm.doc.company, 'default_credit_sale', function(r) {
			// 	if (r && r.default_credit_sale === 1) {
			// 			frm.set_value('credit_sale', 1);
			// 	}
			// });

			set_default_payment_mode(frm);
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

		frappe.call(
			{
				method: 'frappe.client.get_value',
				args: {
					'doctype': 'Customer',
					'filters': { 'customer_name': frm.doc.customer_name },
					'fieldname': ['default_price_list','customer_name']
				},
				callback: (r) => {

					console.log("r.message.default_price_list")
					console.log(r.message.default_price_list)

					if (r.message.default_price_list) {
						frm.doc.price_list = r.message.default_price_list;
					}

					frm.refresh_field("price_list");
					console.log("frm.doc.price_list")
					console.log(frm.doc.price_list)
				}
			});

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

			frm.set_value('customer_display_name', frm.doc.customer_name)
			frm.refresh_field("customer_display_name");

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
			})
	},
	make_taxes_and_totals(frm) {
		console.clear();
		console.log("from make totals..");

		frm.clear_table("taxes");
		frm.refresh_field("taxes");

		var gross_total = 0;
		var taxable_total = 0;
		var tax_total = 0;
		var net_total = 0;
		var discount_total = 0;
		var rate_inbcludes_tax = 0;

		// Avoid Possible NaN
		frm.doc.gross_total = 0;
		frm.doc.net_total = 0;
		frm.doc.tax_total = 0;
		frm.doc.total_discount_in_line_items = 0;
		frm.doc.round_off = 0;
		frm.doc.rounded_total = 0;
		frm.doc.taxable_total = 0;

		(frm.doc.items || []).forEach(function (entry) {

			// rate_includes_tax column in items table is readonly and it depends the form's rate_includes_tax column
			entry.rate_includes_tax = frm.doc.rate_includes_tax;
			entry.gross_amount = 0;
			entry.taxable_amount = 0;
			entry.tax_amount = 0;
			entry.net_amount = 0;

			entry.rate = flt(entry.com) + flt(entry.gov) 

			console.log("entry.tax_excluded", entry.tax_excluded);
			console.log("entry.tax_rate", entry.tax_rate);

			if (!entry.tax_excluded && flt(entry.tax_rate) > 0) {
				let com_amount = (flt(entry.qty) * flt(entry.com)) - flt(entry.discount_amount);
				let gov_amount = (flt(entry.qty) * flt(entry.gov));

				if (entry.rate_includes_tax) {
					entry.taxable_amount =
						com_amount / (1 + (flt(entry.tax_rate) / 100));

					entry.tax_amount =
						com_amount - flt(entry.taxable_amount);

					entry.net_amount =
						com_amount + gov_amount;
				} else {
					entry.taxable_amount = com_amount;

					entry.tax_amount =
						flt(entry.taxable_amount) * (flt(entry.tax_rate) / 100);

					entry.net_amount =
						com_amount + gov_amount + flt(entry.tax_amount);
				}
			}
			else {
				entry.taxable_amount = 0;
				entry.tax_amount = 0;
				entry.net_amount =
					(flt(entry.qty) * flt(entry.rate)) - flt(entry.discount_amount);
			}

			entry.gross_amount = flt(entry.qty) * (flt(entry.com) + flt(entry.gov));

			console.log("entry.gross_amount")
			console.log(entry.gross_amount)

			gross_total = gross_total + flt(entry.gross_amount);
			tax_total = tax_total + flt(entry.tax_amount);
			net_total = net_total + flt(entry.net_amount);
			taxable_total = taxable_total + flt(entry.taxable_amount);
			discount_total = discount_total + flt(entry.discount_amount);

			entry.qty_in_base_unit = flt(entry.qty) * flt(entry.conversion_factor);
			entry.rate_in_base_unit = flt(entry.conversion_factor)
				? flt(entry.rate) / flt(entry.conversion_factor)
				: 0;
		});

		if (isNaN(flt(frm.doc.additional_discount))) {
			frm.doc.additional_discount = 0;
		}

		frm.doc.gross_total = flt(gross_total);
		frm.doc.taxable_total = flt(taxable_total);
		frm.doc.tax_total = flt(tax_total);
		frm.doc.total_discount_in_line_items = flt(discount_total);
		frm.doc.net_total = flt(net_total) - flt(frm.doc.additional_discount);

		console.log("frm.doc.additional discount");
		console.log(frm.doc.additional_discount);

		console.log("gross total");
		console.log(gross_total);

		console.log("tax total");
		console.log(tax_total);

		console.log("frm.doc.net_total");
		console.log(frm.doc.net_total);

		if (frm.doc.net_total != Math.round(frm.doc.net_total)) {
			frm.doc.round_off = Math.round(frm.doc.net_total) - frm.doc.net_total;
			frm.set_value("rounded_total", Math.round(frm.doc.net_total));
			frm.refresh_field("round_off");
			frm.refresh_field("rounded_total");
		}
		else {
			frm.doc.round_off = 0;
			frm.set_value("rounded_total", Math.round(frm.doc.net_total));
			frm.refresh_field("round_off");
			frm.refresh_field("rounded_total");

			console.log(frm.doc.net_total);
			console.log(frm.doc.rounded_total);
		}

		console.log("rounded_total_calculated", frm.doc.rounded_total);

		console.log("before call fill_receipt_schedule");
		fill_receipt_schedule(frm);
		console.log("rounded_total_calculated 2", frm.doc.rounded_total);

		update_total_big_display(frm);

		frm.refresh_field("items");
		frm.refresh_field("taxes");
		frm.refresh_field("gross_total");
		frm.refresh_field("taxable_total");
		frm.refresh_field("net_total");
		frm.refresh_field("tax_total");
		frm.refresh_field("round_off");
	},
	payment_mode(frm){
		if (frm.doc.payment_mode === "Cash"){
				update_prices_for_item(frm,"Cash");
		}else if (frm.doc.payment_mode === "Card"){
				update_prices_for_item(frm,"Card");
		}
		
	},
	is_round_off(frm) {
		if (!frm.doc.is_round_off) {
			frm.set_value("rounded_total", frm.doc.net_total)
			frm.set_value("round_off", 0)
		}else{
			if (frm.doc.net_total != Math.round(frm.doc.net_total)) {
				 frm.doc.round_off = Math.round(frm.doc.net_total) - frm.doc.net_total;
				//  frm.doc.rounded_total = Math.round(frm.doc.net_total);
				 frm.set_value("rounded_total", Math.round(frm.doc.net_total))	
				 frm.refresh_field('round_off');
				 frm.refresh_field('rounded_total');

			 }
			 else{

				// frm.doc.rounded_total = frm.doc.net_total;
				// frm.refresh_field("rounded_total");
				frm.set_value("rounded_total", Math.round(frm.doc.net_total))	

				console.log(frm.doc.net_total)
				console.log(frm.doc.rounded_total)
				
			 }

		}
		fill_receipt_schedule(frm);
		console.log("rounded_total_calculated 2", frm.doc.rounded_total)

		update_total_big_display(frm);
		// });

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
						const unit = itemRow.unit;
						frm.doc.selected_item_stock_qty_in_the_warehouse = "Stock Bal: "  + r2.message.stock_qty +  " " + unit + " for " + frm.item + " at w/h: "+ frm.warehouse + ": ";
						frm.refresh_field("selected_item_stock_qty_in_the_warehouse");
					}
				}
			}
    });

	},
	async get_default_company_and_warehouse(frm) {
		try {
			frm.custom = frm.custom || {};

			const r = await frappe.call({
				method: "frappe.client.get_value",
				args: {
					doctype: "Global Settings",
					fieldname: "default_company"
				}
			});

			const default_company = r.message?.default_company || "";
			if (!default_company) return;

			frm.doc.company = default_company;
			frm.refresh_field("company");

			const r2 = await frappe.call({
				method: "frappe.client.get_value",
				args: {
					doctype: "Company",
					filters: { company_name: default_company },
					fieldname: [
						"default_warehouse",
						"rate_includes_tax",
						"delivery_note_integrated_with_sales_invoice",
						"update_price_list_price_with_sales_invoice",
						"use_customer_last_price",
						"customer_terms",
						"update_stock_in_sales_invoice",
						"allow_edit_sales_invoice_no",
						"hidden_sales_invoice"
					]
				}
			});

			const company_data = r2.message || {};

			frm.doc.warehouse = company_data.default_warehouse;
			frm.doc.rate_includes_tax = company_data.rate_includes_tax;
			frm.doc.update_stock = company_data.update_stock_in_sales_invoice;

			frm.custom.allow_edit_sales_invoice_no = company_data.allow_edit_sales_invoice_no;

			console.log("frm.custom.allow_edit_sales_invoice_no");
			console.log(frm.custom.allow_edit_sales_invoice_no);

			frm.set_df_property("sales_inv_no", "hidden", !frm.custom.allow_edit_sales_invoice_no);

			// frm.doc.auto_save_delivery_note = company_data.delivery_note_integrated_with_sales_invoice;
			frm.doc.auto_save_delivery_note = false;

			if (company_data.use_customer_last_price == 0) {
				frm.doc.update_rates_in_price_list = company_data.update_price_list_price_with_sales_invoice;
			}

			frm.refresh_field("warehouse");
			frm.refresh_field("rate_includes_tax");
			frm.refresh_field("update_rates_in_price_list");
			frm.refresh_field("auto_save_delivery_note");
			frm.refresh_field("update_stock");

			//Have a button to create delivery note in case delivery note is not integrated with SI
			// if (!frm.doc.__islocal && !company_data.delivery_note_integrated_with_sales_invoice) {
			// 	frm.add_custom_button('Create/Update Delivery Note', () => {
			// 		frm.call("auto_generate_delivery_note")
			// 	},
			// 	)
			// }

			if (company_data.customer_terms) {
				frm.doc.terms = company_data.customer_terms;
				frm.refresh_field("terms");

				const terms_res = await frappe.call({
					method: "digitz_erp.api.settings_api.get_terms_for_template",
					args: {
						template: company_data.customer_terms
					}
				});

				frm.doc.terms_and_conditions = terms_res.message?.terms || "";
				frm.refresh_field("terms_and_conditions");
			}

			if (frm.doc.company) {
				console.log("Current Company: ", frm.doc.company);

				if (company_data.hidden_sales_invoice) {
					console.log("Hidden fields for Sales Invoice: ", company_data.hidden_sales_invoice);

					const fieldsToHide = company_data.hidden_sales_invoice
						.split(",")
						.map(f => f.trim())
						.filter(Boolean);

					fieldsToHide.forEach(fieldname => {
						if (frm.fields_dict[fieldname]) {
							frm.set_df_property(fieldname, "hidden", true);
						}
					});

					frm.refresh_fields();
				}
			}
		} catch (err) {
			console.error("Error in get_default_company_and_warehouse:", err);
		}
	},
	get_item_units(frm) {

		frappe.call({
			method: 'digitz_erp.api.items_api.get_item_uoms',
			async: false,
			args: {
				item: frm.item
			},
			callback: (r) => {

				var units = ""
				for(var i = 0; i < r.message.length; i++)
				{
					if(i==0)
					{
						units = r.message[i].unit
					}
					else
					{
						units = units + ", " + r.message[i].unit
					}
				}

				frm.doc.item_units = "Unit(s) for "+ frm.item +": " +units
				frm.refresh_field("item_units");
			}
		})
	},
});

function fill_receipt_schedule(frm, refresh=false,refresh_credit_days=false)
{

	if(refresh)
	{
		frm.doc.receipt_schedule = [];
		refresh_field("receipt_schedule");
	}

	console.log("fill_receipt_schedule")
	console.log(frm.doc.credit_sale)

	if (frm.doc.credit_sale) {

		console.log("credit sale")
		console.log(frm.doc.rounded_total)

		var postingDate = frm.doc.posting_date;
		var creditDays = frm.doc.credit_days;
		
		if (!frm.doc.receipt_schedule) {
			frm.doc.receipt_schedule = [];
		}

		var receiptRow = null;

		row_count = 0;
		// Check if a Payment Schedule row already exists
		frm.doc.receipt_schedule.forEach(function(row) {
			if (row){
				receiptRow = row;
				if(refresh || refresh_credit_days)
				{
					receiptRow.date = creditDays ? frappe.datetime.add_days(postingDate, creditDays) : postingDate;
				}

				row_count++;

			}
		});

		//If there is no row exits create one with the relevant values
		if (!receiptRow) {
			// Calculate receipt schedule and add a new row
			receiptRow = frappe.model.add_child(frm.doc, "Receipt Schedule", "receipt_schedule");
			receiptRow.date = creditDays ? frappe.datetime.add_days(postingDate, creditDays) : postingDate;
			receiptRow.payment_mode = "Cash"
			receiptRow.amount = frm.doc.rounded_total;
			refresh_field("receipt_schedule");
			console.log("here 1")
		}
		else if (row_count==1)
		{
			//If there is only one row update the amount. If there is more than one row that means there is manual
			//entry and	user need to manage it by themself
			receiptRow.payment_mode = "Cash"
			receiptRow.amount = frm.doc.rounded_total;
			refresh_field("receipt_schedule");
			console.log("here 2")
		}

		//Update date based on credit_days if there is a credit days change or change in the credit_sales checkbox
		if(refresh || refresh_credit_days)
			receiptRow.date = creditDays ? frappe.datetime.add_days(postingDate, creditDays) : postingDate;
			refresh_field("receipt_schedule");
	}
	else
	{
		frm.doc.receipt_schedule = [];
		refresh_field("receipt_schedule");
	}
}

function update_total_big_display(frm) {

	console.log("from big",frm.doc.rounded_total)
	
	let total_to_display = isNaN(frm.doc.rounded_total) ? "0.00" : parseFloat(frm.doc.rounded_total).toFixed(2);


    // Add 'AED' prefix and format net_total for display

	let displayHtml = `<div style="font-size: 25px; text-align: right; color: black;">AED ${total_to_display}</div>`;

	console.log("displayHtml",displayHtml)

    // Directly update the HTML content of the 'total_big' field
    frm.fields_dict['total_big'].$wrapper.html(displayHtml);

}
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
                rate: item.rate,
                base_unit: item.base_unit,
                qty_in_base_unit: item.qty_in_base_unit,
                rate_in_base_unit: item.rate_in_base_unit,
                conversion_factor: item.conversion_factor,
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

frappe.ui.form.on('Sales Invoice Item', {
	item(frm, cdt, cdn) {

		let row = frappe.get_doc(cdt, cdn);

		if (typeof (frm.doc.customer) == "undefined" || !frm.doc.customer) {
			frappe.msgprint("Select customer.");
			frappe.model.set_value(cdt, cdn, "item", "");
			return;
		}

		// keeping structure close to your original code
		row.warehouse = frm.doc.warehouse;

		frm.item = row.item;
		frm.trigger("get_item_units");

		let tax_excluded_for_company = false;

		frappe.call({
			method: 'digitz_erp.api.settings_api.get_company_settings',
			async: false,
			callback(r) {
				console.log("digitz_erp.api.settings_api.get_company_settings");
				console.log(r);

				if (r.message && r.message.length) {
					tax_excluded_for_company = r.message[0].tax_excluded;
				}
			}
		});

		console.log("tax_excluded_for_company");
		console.log(tax_excluded_for_company);

		frappe.call({
			method: 'frappe.client.get_value',
			args: {
				doctype: 'Item',
				filters: { item_code: row.item },
				fieldname: ['item_name', 'description', 'base_unit', 'tax', 'tax_excluded', 'com', 'gov']
			},
			callback: (r) => {
				console.log("item");
				console.log(r);

				if (!r.message) {
					return;
				}

				row.item_name = r.message.item_name;
				row.display_name = r.message.description;

				if (tax_excluded_for_company) {
					row.tax_excluded = true;
					console.log("tax excluded assinged in");
				} else {
					row.tax_excluded = r.message.tax_excluded;
				}

				row.base_unit = r.message.base_unit;
				row.unit = r.message.base_unit;
				row.conversion_factor = 1;
				row.rate = flt(r.message.com) + flt(r.message.gov);
				row.com = flt(r.message.com);
				row.gov = flt(r.message.gov);
				row.qty = 1;

				frm.item = row.item;
				frm.warehouse = row.warehouse;

				let advance_filled = false;
				if (frm.doc.project && frm.doc.for_advance_payment && frm.doc.project_value > 0 && frm.doc.advance_percentage > 0) {

					let advance_value = (frm.doc.project_value * frm.doc.advance_percentage / 100);
					row.rate = advance_value;
					advance_filled = true;

					var message = frm.doc.advance_percentage + "% advance = " + advance_value + " allocated in the line item.";
					frm.events.show_a_message(frm, message);
				}

				frm.trigger("get_item_stock_balance");

				// IMPORTANT: finalize only after tax call is completed
				const finalize_row = () => {
					var currency = "";
					console.log("before call digitz_erp.api.settings_api.get_default_currency");
					frappe.call({
						method: 'digitz_erp.api.settings_api.get_default_currency',
						async: false,
						callback(r3) {
							console.log(r3);
							currency = r3.message;
							console.log("currency");
							console.log(currency);
						}
					});

					frm.refresh_field("items");
					frm.trigger("make_taxes_and_totals");
				};

				if (!row.tax_excluded) {
					frappe.call({
						method: 'frappe.client.get_value',
						args: {
							doctype: 'Tax',
							filters: { tax_name: r.message.tax },
							fieldname: ['tax_name', 'tax_rate']
						},
						callback: (r2) => {
							if (r2.message) {
								row.tax = r2.message.tax_name;
								row.tax_rate = flt(r2.message.tax_rate);
							} else {
								row.tax = "";
								row.tax_rate = 0;
							}

							finalize_row();
						}
					});
				} else {
					row.tax = "";
					row.tax_rate = 0;
					finalize_row();
				}
			}
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
			frappe.call(
				{
					method: 'frappe.client.get_value',
					args: {
						'doctype': 'Tax',
						'filters': { 'tax_name': row.tax },
						'fieldname': ['tax_name', 'tax_rate']
					},
					callback: (r2) => {
						row.tax_rate = r2.message.tax_rate;
						frm.refresh_field("items");
						frm.trigger("make_taxes_and_totals");
					}
				});
		}
	},
	qty(frm, cdt, cdn) {
		frm.trigger("make_taxes_and_totals");
	},
	// rate(frm, cdt, cdn) {
	// 	frm.trigger("make_taxes_and_totals");
	// },
	rate_includes_tax(frm, cdt, cdn) {
		frm.trigger("make_taxes_and_totals");
	},
	unit(frm, cdt, cdn) {

		let row = frappe.get_doc(cdt, cdn);

		frappe.call(
			{
				method: 'digitz_erp.api.items_api.get_item_uom',
				async: false,
				args: {
					item: row.item,
					unit: row.unit
				},
				callback(r) {
					if (r.message.length == 0) {
						frappe.msgprint("Invalid unit, Unit does not exists for the item.");
						row.unit = row.base_unit;
						row.conversion_factor = 1;
					}
					else {

						row.conversion_factor = r.message[0].conversion_factor;
						row.rate = row.rate_in_base_unit * row.conversion_factor;
						//row.rate = row.rate * row.conversion_factor;
						//frappe.confirm('Rate converted for the unit selected. Do you want to convert the qty as well ?',
						//() => {
						//row.qty = row.qty/ row.conversion_factor;
						//})
					}
					frm.trigger("make_taxes_and_totals");

					frm.refresh_field("items");
				}

			}
		);
	},
	discount_percentage(frm, cdt, cdn) {
		let row = frappe.get_doc(cdt, cdn);

		var discount_percentage = row.discount_percentage;

		if (row.discount_percentage > 0) {

			var discount = row.gross_amount * (row.discount_percentage / 100);
			row.discount_amount = discount;
		}
		else {
			row.discount_amount = 0;
			row.discount_percentage = 0;
		}

		frm.trigger("make_taxes_and_totals");

		frm.refresh_field("items");

	},
	discount_amount(frm, cdt, cdn) {

		let row = frappe.get_doc(cdt, cdn);
		var discount = row.discount_amount;

		if (row.discount_amount > 0) {
			var discount_percentage = discount * 100 / row.gross_amount;
			row.discount_percentage = discount_percentage;
		}
		else {
			row.discount_amount = 0;
			row.discount_percentage = 0;
		}

		frm.trigger("make_taxes_and_totals");

		frm.refresh_field("items");
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

function set_default_payment_mode(frm)
{
	if(frm.doc.credit_sale == 0){
        frappe.db.get_value('Company', frm.doc.company,'default_payment_mode_for_sales', function(r){

			if (r && r.default_payment_mode_for_sales) {
							frm.set_value('payment_mode', r.default_payment_mode_for_sales);
			} else {
							frappe.msgprint('Default payment mode for purchase not found.');
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
    frappe.call({
        method: "digitz_erp.api.accounts_api.get_gl_postings",
        args: {
            voucher: frm.doc.doctype,
            voucher_no: frm.doc.name
        },
        callback: function (response) {
            let gl_postings = response.message.gl_postings;
            let totalDebit = parseFloat(response.message.total_debit).toFixed(2);
            let totalCredit = parseFloat(response.message.total_credit).toFixed(2);

            // Generate HTML content for the popup
            let htmlContent = '<div style="max-height: 680px; overflow-y: auto;">' +
                              '<table class="table table-bordered" style="width: 100%;">' +
                              '<thead>' +
                              '<tr>' +
                              '<th style="width: 15%;">Account</th>' +
							  '<th style="width: 25%;">Remarks</th>' +
                              '<th style="width: 10%;">Debit Amount</th>' +
                              '<th style="width: 10%;">Credit Amount</th>' +
							  '<th style="width: 10%;">Party</th>' +
                              '<th style="width: 10%;">Against Account</th>' +                              
                              '<th style="width: 10%;">Project</th>' +
                              '<th style="width: 10%;">Cost Center</th>' +                              
                              '</tr>' +
                              '</thead>' +
                              '<tbody>';

			console.log("gl_postings",gl_postings)

            gl_postings.forEach(function (gl_posting) {
                let remarksText = gl_posting.remarks || '';
                let debitAmount = parseFloat(gl_posting.debit_amount).toFixed(2);
                let creditAmount = parseFloat(gl_posting.credit_amount).toFixed(2);

                htmlContent += '<tr>' +
                               `<td>${gl_posting.account}</td>` +
							   `<td>${remarksText}</td>` +
                               `<td style="text-align: right;">${debitAmount}</td>` +
                               `<td style="text-align: right;">${creditAmount}</td>` +
							   `<td>${gl_posting.party}</td>` +
                               `<td>${gl_posting.against_account}</td>` +                               
                               `<td>${gl_posting.project}</td>` +
                               `<td>${gl_posting.cost_center}</td>` +
                               
                               '</tr>';
            });

            // Add totals row
            htmlContent += '<tr>' +
                           '<td style="font-weight: bold;">Total</td>' +
						   '<td></td>'+
                           `<td style="text-align: right; font-weight: bold;">${totalDebit}</td>` +
                           `<td style="text-align: right; font-weight: bold;">${totalCredit}</td>` +
                           '<td colspan="5"></td>' +
                           '</tr>';

            htmlContent += '</tbody></table></div>';

            // Create and show the dialog
            let d = new frappe.ui.Dialog({
                title: 'General Ledgers',
                fields: [{
                    fieldtype: 'HTML',
                    fieldname: 'general_ledgers_html',
                    options: htmlContent
                }],
                primary_action_label: 'Close',
                primary_action: function () {
                    d.hide();
                }
            });

            // Set custom width for the dialog
            d.$wrapper.find('.modal-dialog').css('max-width', '90%'); 

            d.show();
        }
    });
};

let stock_ledgers = function (frm) {
    frappe.call({
        method: "digitz_erp.api.accounts_api.get_stock_ledgers",
        args: {
			voucher: frm.doc.doctype,
            voucher_no: frm.doc.name
        },
        callback: function (response) {
            let stock_ledgers_data = response.message;

            // Generate HTML content for the popup
            let htmlContent = '<div style="max-height: 400px; overflow-y: auto;">' +
                              '<table class="table table-bordered" style="width: 100%;">' +
                              '<thead>' +
                              '<tr>' +
                              '<th style="width: 10%;">Item Code</th>' +
							  '<th style="width: 20%;">Item Name</th>' +
                              '<th style="width: 15%;">Warehouse</th>' +
                              '<th style="width: 10%;">Qty In</th>' +
                              '<th style="width: 10%;">Qty Out</th>' +
                              '<th style="width: 15%;">Valuation Rate</th>' +
                              '<th style="width: 15%;">Balance Qty</th>' +
                              '<th style="width: 15%;">Balance Value</th>' +
                              '</tr>' +
                              '</thead>' +
                              '<tbody>';

            // Loop through the data and create rows
            stock_ledgers_data.forEach(function (ledger) {
                htmlContent += '<tr>' +
                               `<td><a href="/app/item/${ledger.item}" target="_blank">${ledger.item}</a></td>` +
							   `<td>${ledger.item_name}</td>` +
                               `<td>${ledger.warehouse}</td>` +
                               `<td>${ledger.qty_in}</td>` +
                               `<td>${ledger.qty_out}</td>` +
                               `<td>${ledger.valuation_rate}</td>` +
                               `<td>${ledger.balance_qty}</td>` +
                               `<td>${ledger.balance_value}</td>` +
                               '</tr>';
            });

            htmlContent += '</tbody></table></div>';

            // Create and show the dialog
            let d = new frappe.ui.Dialog({
                title: 'Stock Ledgers',
                fields: [{
                    fieldtype: 'HTML',
                    fieldname: 'stock_ledgers_html',
                    options: htmlContent
                }],
                primary_action_label: 'Close',
                primary_action: function () {
                    d.hide();
                }
            });

            // Set custom width for the dialog
            d.$wrapper.find('.modal-dialog').css('max-width', '85%'); // or any specific width like 800px

            d.show();
        }
    });
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


// Function to update prices based on payment mode
async function update_prices_for_item(frm,mode) {
    let gross_amount = 0;
	
    for (let row of frm.doc.items) {
        // Fetch item details from Item doctype
        let item = await frappe.db.get_doc("Item", row.item);
        		
		// if (mode === "Cash"){
		let rate = item.com + item.gov
		// }else if (mode === "Card"){
		// 	rate = item.com
		// }
		
		gross_amount += rate
		
		
        // Update item rate
        frappe.model.set_value(row.doctype, row.name, "rate",rate);
		frappe.model.set_value(row.doctype, row.name, "gross_amount",rate);
		frappe.model.set_value(row.doctype, row.name, "net_amount",rate);

        // Recalculate amount for this row
        

        
    }

    // Now recalculate totals
    frm.set_value("gross_total", gross_amount);
    frm.set_value("net_total", gross_amount + frm.doc.tax_total);   // you can add discount/taxes logic here
    frm.set_value("rounded_total", gross_amount + frm.doc.tax_total);
    frm.set_value("paid_amount", gross_amount + frm.doc.tax_total); // depends if payment is full
     frm.set_value("net_amount", gross_amount);
	update_total_big_display(frm); 
	frm.refresh_fields();
}