// Copyright (c) 2022, Rupesh P and contributors
// For license information, please see license.txt

frappe.ui.form.on('Customer', {
	
	refresh:function(frm)
	{

		if (frappe.user.has_role('Management')) {
			frm.add_custom_button(('Merge Customer'), function() {
				// Open the merge popup
				open_merge_popup(frm);
			});
		}

		// Rename with every reference: administrators only (the server checks too)
		if (!frm.is_new() && (frappe.session.user === "Administrator" || frappe.user.has_role("System Manager") || frappe.user.has_role("Management"))) {
			frm.add_custom_button(__("Rename Customer"), () => open_rename_popup(frm));
		}

		frm.set_query("area", function() {
			return {
				"filters": {
					"emirate": frm.doc.emirate
				}
			};
		});	

		frm.set_query("default_price_list", function() {
			return {
				"filters": {
					"is_selling": 1
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

		frm.set_df_property("default_terms","hidden", frm.doc.use_default_customer_terms)
		frm.set_df_property("terms","hidden", frm.doc.use_default_customer_terms)

		frappe.call({
			method: "digitz_erp.accounts.doctype.customer.customer.get_customer_code_required",
			callback: function(r) {
				const customer_code_required = cint(r.message);
				frm.set_df_property("customer_code", "hidden", !customer_code_required);
				frm.set_df_property("customer_code", "reqd", customer_code_required);
			}
		});
	},
	before_save: function(frm){

		var addressline_1 = frm.doc.address_line_1;
		var addressline_2 = "";
		
		if(frm.doc.address_line_1 && frm.doc.address_line_1 !="")
		{
			addressline_1 = frm.doc.address_line_1;			
		}
		else
		{
			addressline_1 = "";
		}
		
		if(frm.doc.address_line_2 && frm.doc.address_line_2 !="")
		{
			if(addressline_1 !="")
			{
				addressline_2 = "\n" + frm.doc.address_line_2;				
			}
			else
			{
				addressline_2 = frm.doc.address_line_2;			
			}			
		}

		var area = "";
		
		if(frm.doc.area_name && frm.doc.area_name !="")
		{			
			if((!addressline_1 && !addressline_2) || (addressline_1 =="" && addressline_2==""))
			{
				area = frm.doc.area_name;								
			}
			else
			{
				area = "\n" + frm.doc.area_name;
			}
		}
		else
		{
			
		}

		var emirate = "\n" + frm.doc.emirate;
		var country = "\n" + frm.doc.country;
		
		frm.doc.full_address = addressline_1 + addressline_2  + area + emirate +  country + "\n"
		console.log(frm.doc.full_address);
	},
	emirate(frm)
	{
		// frm.doc.area = ""; //Change default area for the emirate selected
		frm.set_value("area","")
	},
	use_default_customer_terms(frm)
	{
		frm.set_df_property("default_terms","hidden", frm.doc.use_default_customer_terms)
		frm.set_df_property("terms","hidden", frm.doc.use_default_customer_terms)
	}

});

frappe.ui.form.on("Customer", "onload", function(frm) {
	
})


// Merge Customer: every record of this customer moves to the selected one,
// and this customer is deleted. Shows how many records move first.
function open_merge_popup(frm) {
	const esc = frappe.utils.escape_html;
	const d = new frappe.ui.Dialog({
		title: __("Merge Customer"),
		fields: [
			{
				fieldtype: "HTML",
				options: `<div style="color: var(--red-600); font-weight: bold;">${__("Merging customers cannot be undone.")}</div>
					<p class="text-muted small" style="margin-top: 6px;">${__("Every invoice, return, receipt, GL posting and other record of the current customer moves to the selected customer, and the current customer is deleted.")}</p>`,
			},
			{ label: __("Current Customer"), fieldname: "current_customer", fieldtype: "Data", read_only: 1, default: frm.doc.name },
			{
				label: __("Merge Into"), fieldname: "merge_customer", fieldtype: "Link", options: "Customer", reqd: 1,
				get_query: () => ({ filters: { name: ["!=", frm.doc.name] } }),
			},
			{ fieldtype: "HTML", fieldname: "references" },
		],
		primary_action_label: __("Merge"),
		primary_action(values) {
			frappe.confirm(
				__("Move every record of {0} to {1} and delete {0}? This cannot be undone.", [esc(frm.doc.name), esc(values.merge_customer)]),
				() => frappe.call({
					method: "digitz_erp.api.customer_api.merge_customer",
					args: { current_customer: frm.doc.name, merge_customer: values.merge_customer },
					freeze: true,
					freeze_message: __("Merging the customers..."),
					callback: (r) => {
						if (!r.message) {
							return;
						}
						d.hide();
						frappe.show_alert({ message: __("Merged into {0}", [esc(r.message.name)]), indicator: "green" });
						frappe.set_route("Form", "Customer", r.message.name);
					},
				})
			);
		},
	});

	frappe.call({
		method: "digitz_erp.accounts.doctype.customer.customer.get_customer_references",
		args: { customer: frm.doc.name },
		callback: (r) => {
			const references = (r.message && r.message.references) || [];
			const total = references.reduce((sum, x) => sum + x.count, 0);
			d.fields_dict.references.$wrapper.html(references.length
				? `<div class="text-muted small" style="margin: 4px 0 6px;">${__("{0} record(s) move:", [total])}</div>
					<table class="table table-bordered table-sm" style="margin: 0;"><tbody>${references.map((x) => `
						<tr><td>${esc(__(x.doctype))}${x.lines ? ` <span class="text-muted">(${__("lines")})</span>` : ""}</td>
							<td class="text-right">${x.count}</td></tr>`).join("")}</tbody></table>`
				: `<div class="text-muted small">${__("No other record points at this customer.")}</div>`);
		},
	});
	d.show();
}


// Rename Customer: the new name, what the customer's ID becomes, and how many
// records point at it (all of them are renamed); optionally the Customer Name
// copied onto its documents too
function open_rename_popup(frm) {
	const esc = frappe.utils.escape_html;
	const method = "digitz_erp.accounts.doctype.customer.customer";
	let references = [];

	const d = new frappe.ui.Dialog({
		title: __("Rename Customer"),
		fields: [
			{ fieldtype: "Data", fieldname: "current", label: __("Current"), read_only: 1, default: frm.doc.name },
			{
				fieldtype: "Data", fieldname: "new_name", label: __("New Name"), reqd: 1, default: frm.doc.customer_name,
				change: frappe.utils.debounce(() => preview(), 300),
			},
			{ fieldtype: "HTML", fieldname: "new_id" },
			{
				fieldtype: "Check", fieldname: "update_copies", default: 1,
				label: __("Also change the Customer Name printed on its existing documents"),
			},
			{ fieldtype: "HTML", fieldname: "references" },
		],
		primary_action_label: __("Rename"),
		primary_action: (values) => {
			const new_name = (values.new_name || "").trim();
			const total = references.reduce((sum, r) => sum + r.count, 0);
			frappe.confirm(
				__("Rename {0} to {1} and update {2} referencing record(s)? This cannot be undone.",
					[esc(frm.doc.name), esc(new_name), total]),
				() => frappe.call({
					method: `${method}.rename_customer`,
					args: { customer: frm.doc.name, new_name, update_copies: values.update_copies ? 1 : 0 },
					freeze: true,
					freeze_message: __("Renaming the customer and its references..."),
					callback: (r) => {
						if (!r.message) {
							return;
						}
						d.hide();
						frappe.show_alert({ message: __("Renamed to {0}", [esc(r.message.name)]), indicator: "green" });
						frappe.set_route("Form", "Customer", r.message.name);
					},
				})
			);
		},
	});

	const show_references = () => {
		const total = references.reduce((sum, r) => sum + r.count, 0);
		const rows = references.map((r) => `
			<tr><td>${esc(__(r.doctype))}${r.lines ? ` <span class="text-muted">(${__("lines")})</span>` : ""}</td>
				<td class="text-muted">${esc(r.field)}</td><td class="text-right">${r.count}</td></tr>`).join("");
		d.fields_dict.references.$wrapper.html(references.length ? `
			<div class="text-muted small" style="margin: 4px 0 6px;">${__("These records point at the customer. All of them are renamed with it.")}</div>
			<table class="table table-bordered table-sm" style="margin: 0;">
				<thead><tr><th>${__("Document")}</th><th>${__("Field")}</th><th class="text-right">${__("Records")}</th></tr></thead>
				<tbody>${rows}</tbody>
				<tfoot><tr><th colspan="2">${__("Total")}</th><th class="text-right">${total}</th></tr></tfoot>
			</table>` : `<div class="text-muted small">${__("No other record points at this customer.")}</div>`);
	};

	const preview = async () => {
		const new_name = (d.get_value("new_name") || "").trim();
		const r = await frappe.call({
			method: `${method}.get_customer_references`,
			args: { customer: frm.doc.name, new_name },
		});
		references = r.message.references || [];
		const new_id = r.message.new_id;
		d.fields_dict.new_id.$wrapper.html(new_id && new_id !== frm.doc.name
			? `<div class="small" style="margin: -4px 0 8px;">${__("New customer ID")}: <b>${esc(new_id)}</b></div>`
			: "");
		show_references();
	};

	d.show();
	preview();
}
