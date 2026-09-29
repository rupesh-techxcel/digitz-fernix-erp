// Price List Manager
//
// Price List and Item Price are separate doctypes: each Item Price row ties one
// item to one price list at a rate. This page lists the price lists on the left
// and, for the one selected, its items on the right, with add, edit and delete.
//
// Everything goes through digitz_erp.api.price_list_manager_api, which limits
// every call to System Manager and Management and saves through the Item Price
// document, so its own rules (one undated price per item and list, no
// overlapping date ranges) still apply.

frappe.provide("digitz_erp");

const PLM_API = "digitz_erp.api.price_list_manager_api.";

// The default selling price list (STANDARD_PRICE_LIST in the API). Every other
// selling list deviates from it for particular customers, so its items show the
// discount they give against it.
const PLM_STANDARD = "Standard Selling";

frappe.pages["price-list-manager"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Price List Manager"),
		single_column: true,
	});

	wrapper.price_list_manager = new digitz_erp.PriceListManager(page, wrapper);
};

frappe.pages["price-list-manager"].on_page_show = function (wrapper) {
	const manager = wrapper.price_list_manager;
	if (!manager) {
		return;
	}

	// Opened with a price list in mind, e.g. frappe.set_route("price-list-manager", {price_list: "..."})
	const wanted = frappe.route_options && frappe.route_options.price_list;
	frappe.route_options = null;
	manager.load_price_lists(wanted);
};

digitz_erp.PriceListManager = class PriceListManager {
	constructor(page, wrapper) {
		this.page = page;
		this.$wrapper = $(wrapper);
		this.price_lists = [];
		this.items = [];
		this.selected = null;

		this.inject_styles();
		this.setup_page();
		this.bind_events();
	}

	inject_styles() {
		if (document.getElementById("plm-styles")) {
			return;
		}

		const style = document.createElement("style");
		style.id = "plm-styles";
		style.textContent = digitz_erp.PriceListManager.CSS;
		document.head.appendChild(style);
	}

	setup_page() {
		this.page.set_primary_action(__("Add Item"), () => this.edit_item_price(), "add");
		this.page.set_secondary_action(__("New Price List"), () => this.new_price_list());
		this.page.add_menu_item(__("Refresh"), () => this.load_price_lists(this.selected));

		this.$body = $(`
			<div class="plm">
				<aside class="plm-lists">
					<input type="search" class="form-control input-sm plm-list-search"
						placeholder="${__("Search price lists")}">
					<div class="plm-list-items"></div>
				</aside>
				<section class="plm-detail">
					<div class="plm-detail-head">
						<div>
							<div class="plm-detail-title"></div>
							<div class="plm-detail-sub"></div>
						</div>
						<input type="search" class="form-control input-sm plm-item-search"
							placeholder="${__("Search items")}">
					</div>
					<div class="plm-table-wrap"></div>
				</section>
			</div>
		`).appendTo(this.page.main);
	}

	bind_events() {
		this.$body.on("input", ".plm-list-search", () => this.render_price_lists());
		this.$body.on("input", ".plm-item-search", () => this.render_items());

		this.$body.on("click", ".plm-list-item", (e) => {
			this.select($(e.currentTarget).attr("data-name"));
		});

		this.$body.on("click", "[data-edit]", (e) => {
			const row = this.items.find((r) => r.name === $(e.currentTarget).attr("data-edit"));
			if (row) {
				this.edit_item_price(row);
			}
		});

		this.$body.on("click", "[data-delete]", (e) => {
			const row = this.items.find((r) => r.name === $(e.currentTarget).attr("data-delete"));
			if (row) {
				this.delete_item_price(row);
			}
		});
	}

	// ------------------------------------------------------------ price lists

	async load_price_lists(select_name) {
		const r = await frappe.call({ method: PLM_API + "get_price_lists" });
		this.price_lists = r.message || [];

		const keep = select_name || this.selected;
		const target = this.price_lists.find((p) => p.name === keep) || this.price_lists[0];
		this.selected = target ? target.name : null;

		this.render_price_lists();
		await this.load_items();
	}

	render_price_lists() {
		const esc = frappe.utils.escape_html;
		const term = (this.$body.find(".plm-list-search").val() || "").toLowerCase();
		const rows = this.price_lists.filter((p) => p.name.toLowerCase().includes(term));

		if (!rows.length) {
			this.$body.find(".plm-list-items").html(
				`<div class="plm-empty">${this.price_lists.length ? __("No price list matches.") : __("No price lists yet.")}</div>`
			);
			return;
		}

		this.$body.find(".plm-list-items").html(rows.map((p) => {
			const badges = [
				p.is_selling ? `<span class="plm-badge plm-badge-sell">${__("Selling")}</span>` : "",
				p.is_buying ? `<span class="plm-badge plm-badge-buy">${__("Buying")}</span>` : "",
			].join("");

			return `
				<button type="button" class="plm-list-item ${p.name === this.selected ? "active" : ""}"
					data-name="${esc(p.name)}">
					<span class="plm-list-name">${esc(p.name)}</span>
					<span class="plm-list-meta">${badges}<span class="plm-count">${p.item_count}</span></span>
				</button>`;
		}).join(""));
	}

	select(name) {
		if (name === this.selected) {
			return;
		}
		this.selected = name;
		this.$body.find(".plm-item-search").val("");
		this.render_price_lists();
		this.load_items();
	}

	new_price_list() {
		const d = new frappe.ui.Dialog({
			title: __("New Price List"),
			fields: [
				{ fieldname: "price_list_name", fieldtype: "Data", label: __("Price List Name"), reqd: 1 },
				{ fieldname: "is_selling", fieldtype: "Check", label: __("Is Selling"), default: 1 },
				{ fieldname: "is_buying", fieldtype: "Check", label: __("Is Buying") },
			],
			primary_action_label: __("Create"),
			primary_action: async (values) => {
				const r = await frappe.call({
					method: PLM_API + "create_price_list",
					args: values,
					freeze: true,
				});
				d.hide();
				frappe.show_alert({ message: __("Price List {0} created", [r.message]), indicator: "green" });
				this.load_price_lists(r.message);
			},
		});
		d.show();
	}

	// ------------------------------------------------------------------ items

	async load_items() {
		const price_list = this.selected;
		this.items = [];

		if (!price_list) {
			this.render_items();
			return;
		}

		this.$body.find(".plm-table-wrap").html(`<div class="plm-empty">${__("Loading...")}</div>`);

		const r = await frappe.call({ method: PLM_API + "get_item_prices", args: { price_list } });

		// The user may have picked another list while this one was loading
		if (price_list !== this.selected) {
			return;
		}

		this.items = r.message || [];
		this.render_items();
	}

	render_items() {
		const esc = frappe.utils.escape_html;
		const pl = this.price_lists.find((p) => p.name === this.selected);

		this.page.btn_primary.toggle(!!pl);
		this.$body.find(".plm-detail-title").text(pl ? pl.name : __("No price list selected"));
		// Discount only means something on a selling list that deviates from the standard one
		const show_discount = !!(pl && pl.is_selling && pl.name !== PLM_STANDARD);
		this.$body.find(".plm-detail-sub").text(pl ? this.summary(show_discount) : "");
		this.$body.find(".plm-item-search").toggle(!!pl);

		if (!pl) {
			this.$body.find(".plm-table-wrap").html(
				`<div class="plm-empty">${__("Create a price list to start adding item prices.")}</div>`
			);
			return;
		}

		const term = (this.$body.find(".plm-item-search").val() || "").toLowerCase();
		const rows = this.items.filter((r) =>
			(r.item || "").toLowerCase().includes(term) || (r.item_name || "").toLowerCase().includes(term)
		);

		if (!rows.length) {
			this.$body.find(".plm-table-wrap").html(`<div class="plm-empty">${
				this.items.length ? __("No item matches.") : __("No items in this price list yet. Use Add Item to add one.")
			}</div>`);
			return;
		}

		const date = (d) => (d ? frappe.datetime.str_to_user(d) : "");

		this.$body.find(".plm-table-wrap").html(`
			<table class="plm-table">
				<thead>
					<tr>
						<th>${__("Item")}</th>
						<th>${__("Item Name")}</th>
						<th>${__("Unit")}</th>
						<th class="plm-num">${__("Service Charge")}</th>
						<th class="plm-num">${__("Typing Charges")}</th>
						<th class="plm-num">${__("GOV")}</th>
						<th class="plm-num">${__("Rate")}</th>
						${show_discount ? `
							<th class="plm-num">${__("Standard")}</th>
							<th class="plm-num" title="${__("Standard Selling rate less this list's rate")}">${__("Discount")}</th>` : ""}
						<th>${__("From")}</th>
						<th>${__("To")}</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					${rows.map((r) => `
						<tr>
							<td class="plm-code">${esc(r.item || "")}</td>
							<td>${esc(r.item_name || "")}</td>
							<td>${esc(r.unit || "")}</td>
							<td class="plm-num">${format_currency(r.service_charge, r.currency)}</td>
							<td class="plm-num">${format_currency(r.typing_charges, r.currency)}</td>
							<td class="plm-num">${format_currency(r.gov, r.currency)}</td>
							<td class="plm-num plm-rate">${format_currency(r.rate, r.currency)}</td>
							${show_discount ? `
								<td class="plm-num plm-muted">${format_currency(r.standard_rate, r.currency)}</td>
								<td class="plm-num">${this.discount_html(r.standard_rate, r.rate, r.currency)}</td>` : ""}
							<td>${date(r.from_date)}</td>
							<td>${date(r.to_date)}</td>
							<td class="plm-actions">
								<button type="button" class="btn btn-xs btn-default" data-edit="${esc(r.name)}">${__("Edit")}</button>
								<button type="button" class="btn btn-xs btn-default plm-del" data-delete="${esc(r.name)}">${__("Delete")}</button>
							</td>
						</tr>`).join("")}
				</tbody>
			</table>
		`);
	}

	// Add when `row` is empty, edit otherwise.
	edit_item_price(row) {
		if (!this.selected) {
			return;
		}

		const is_new = !row;
		const d = new frappe.ui.Dialog({
			title: is_new ? __("Add Item to {0}", [this.selected]) : __("Edit {0}", [row.item]),
			fields: [
				{
					fieldname: "item", fieldtype: "Link", options: "Item", label: __("Item"),
					reqd: 1, read_only: is_new ? 0 : 1,
					onchange: () => is_new && this.fill_item_defaults(d),
				},
				{ fieldname: "item_name", fieldtype: "Data", label: __("Item Name"), read_only: 1 },
				{ fieldname: "col", fieldtype: "Column Break" },
				{ fieldname: "unit", fieldtype: "Link", options: "Unit", label: __("Unit"), reqd: 1 },
				{ fieldname: "currency", fieldtype: "Link", options: "Currency", label: __("Currency"), reqd: 1 },
				{
					fieldname: "charges", fieldtype: "Section Break", label: __("Charges"),
					description: __("Rate is Service Charge + Typing Charges + GOV. With all three empty, enter the rate directly."),
				},
				{ fieldname: "service_charge", fieldtype: "Currency", label: __("Service Charge"), onchange: () => this.sum_rate(d) },
				{ fieldname: "typing_charges", fieldtype: "Currency", label: __("Typing Charges"), onchange: () => this.sum_rate(d) },
				{ fieldname: "col3", fieldtype: "Column Break" },
				{ fieldname: "gov", fieldtype: "Currency", label: __("GOV"), onchange: () => this.sum_rate(d) },
				{ fieldname: "rate", fieldtype: "Currency", label: __("Rate"), reqd: 1, onchange: () => this.show_discount(d) },
				{ fieldname: "discount_info", fieldtype: "HTML" },
				{
					fieldname: "dates", fieldtype: "Section Break", label: __("Validity"),
					description: __("Leave both dates empty for a price that always applies."),
				},
				{ fieldname: "from_date", fieldtype: "Date", label: __("From Date") },
				{ fieldname: "col2", fieldtype: "Column Break" },
				{ fieldname: "to_date", fieldtype: "Date", label: __("To Date") },
			],
			primary_action_label: is_new ? __("Add") : __("Save"),
			primary_action: async (values) => {
				await frappe.call({
					method: PLM_API + "save_item_price",
					args: {
						price_list: this.selected,
						item: values.item,
						rate: values.rate,
						service_charge: values.service_charge || 0,
						typing_charges: values.typing_charges || 0,
						gov: values.gov || 0,
						unit: values.unit,
						currency: values.currency,
						from_date: values.from_date || null,
						to_date: values.to_date || null,
						name: is_new ? null : row.name,
					},
					freeze: true,
				});
				d.hide();
				frappe.show_alert({
					message: is_new ? __("{0} added", [values.item]) : __("{0} updated", [values.item]),
					indicator: "green",
				});
				this.load_price_lists(this.selected);
			},
		});

		d.standard_rate = is_new ? null : flt(row.standard_rate);

		if (!is_new) {
			d.set_values({
				item: row.item, item_name: row.item_name, rate: row.rate, unit: row.unit,
				service_charge: row.service_charge, typing_charges: row.typing_charges, gov: row.gov,
				currency: row.currency, from_date: row.from_date, to_date: row.to_date,
			});
		}

		d.show();
		this.show_discount(d);

		// Read the standard rate fresh on opening: the table's copy may predate a
		// change to the item's Standard Selling price.
		if (!is_new) {
			frappe.call({ method: PLM_API + "get_standard_rate", args: { item: row.item } }).then((r) => {
				d.standard_rate = flt((r.message || {}).standard_rate);
				this.show_discount(d);
			});
		}
	}

	async fill_item_defaults(d) {
		const item = d.get_value("item");
		if (!item) {
			return;
		}

		const r = await frappe.call({ method: PLM_API + "get_item_defaults", args: { item } });
		const def = r.message || {};

		d.standard_rate = flt(def.standard_rate);
		d.set_value("item_name", def.item_name || "");
		// Start from the Item master's charges; the manager can then adjust them for this list
		d.set_value("service_charge", flt(def.service_charge));
		d.set_value("typing_charges", flt(def.typing_charges));
		d.set_value("gov", flt(def.gov));
		if (!d.get_value("unit") && def.unit) {
			d.set_value("unit", def.unit);
		}
		if (!d.get_value("currency") && def.currency) {
			d.set_value("currency", def.currency);
		}

		if (this.items.some((r) => r.item === item)) {
			frappe.show_alert({
				message: __("{0} already has a price in this list. Add one only for a different date range.", [item]),
				indicator: "orange",
			}, 7);
		}
	}

	// Rate follows the charges whenever any of them is set, as Item Price does on save.
	sum_rate(d) {
		const parts = ["service_charge", "typing_charges", "gov"].map((f) => flt(d.get_value(f)));
		const has_parts = parts.some((v) => v);
		d.set_df_property("rate", "read_only", has_parts ? 1 : 0);
		if (has_parts) {
			d.set_value("rate", parts[0] + parts[1] + parts[2]);
		}
	}

	// "12.00 (10.0%)" off the standard rate; a price above it is shown as a markup.
	discount_html(standard_rate, rate, currency) {
		standard_rate = flt(standard_rate);
		if (!standard_rate) {
			return `<span class="plm-muted">${__("No standard price")}</span>`;
		}
		const discount = standard_rate - flt(rate);
		const pct = (discount * 100) / standard_rate;
		if (Math.abs(discount) < 0.005) {
			return `<span class="plm-muted">${__("None")}</span>`;
		}
		if (discount < 0) {
			return `<span class="plm-markup">${__("+{0} ({1}% above)", [format_currency(-discount, currency), (-pct).toFixed(1)])}</span>`;
		}
		return `<span class="plm-discount">${format_currency(discount, currency)} (${pct.toFixed(1)}%)</span>`;
	}

	summary(show_discount) {
		const count = __("{0} item(s)", [this.items.length]);
		const priced = this.items.filter((r) => flt(r.standard_rate));
		if (!show_discount || !priced.length) {
			return count;
		}
		const standard_total = priced.reduce((t, r) => t + flt(r.standard_rate), 0);
		const discount_total = priced.reduce((t, r) => t + flt(r.standard_rate) - flt(r.rate), 0);
		return __("{0} · average discount {1}% against {2}", [
			count, ((discount_total * 100) / standard_total).toFixed(1), PLM_STANDARD,
		]);
	}

	// The discount line in the add/edit dialog, for selling lists other than the standard one.
	show_discount(d) {
		const pl = this.price_lists.find((p) => p.name === this.selected);
		const $info = d.fields_dict.discount_info.$wrapper;
		if (!pl || !pl.is_selling || pl.name === PLM_STANDARD || d.standard_rate === null || d.standard_rate === undefined) {
			$info.empty();
			return;
		}
		const currency = d.get_value("currency") || "";
		$info.html(`<div class="plm-dialog-discount">
			${__("{0} rate", [PLM_STANDARD])}: <b>${format_currency(d.standard_rate, currency)}</b>
			&nbsp;·&nbsp; ${__("Discount")}: ${this.discount_html(d.standard_rate, d.get_value("rate"), currency)}
		</div>`);
	}

	delete_item_price(row) {
		frappe.confirm(
			__("Delete the price of <b>{0}</b> from <b>{1}</b>?", [
				frappe.utils.escape_html(row.item), frappe.utils.escape_html(this.selected),
			]),
			async () => {
				await frappe.call({
					method: PLM_API + "delete_item_price",
					args: { name: row.name },
					freeze: true,
				});
				frappe.show_alert({ message: __("{0} removed", [row.item]), indicator: "green" });
				this.load_price_lists(this.selected);
			}
		);
	}
};

digitz_erp.PriceListManager.CSS = `
.plm {
	display: grid;
	grid-template-columns: 280px minmax(0, 1fr);
	gap: 16px;
	align-items: start;
}
@media (max-width: 768px) {
	.plm { grid-template-columns: 1fr; }
}
.plm-lists, .plm-detail {
	border: 1px solid var(--border-color);
	border-radius: var(--border-radius-lg, 10px);
	background: var(--card-bg, var(--fg-color));
	padding: 12px;
}
.plm-list-items {
	margin-top: 10px;
	display: flex;
	flex-direction: column;
	gap: 4px;
	max-height: 70vh;
	overflow-y: auto;
}
.plm-list-item {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	width: 100%;
	text-align: left;
	padding: 8px 10px;
	border: 1px solid transparent;
	border-radius: var(--border-radius, 6px);
	background: transparent;
	color: var(--text-color);
	cursor: pointer;
}
.plm-list-item:hover { background: var(--subtle-fg, var(--control-bg)); }
.plm-list-item.active {
	background: var(--control-bg);
	border-color: var(--primary, #2490ef);
}
.plm-list-name {
	font-weight: 500;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.plm-list-meta {
	display: flex;
	align-items: center;
	gap: 4px;
	flex-shrink: 0;
}
.plm-badge {
	font-size: 10px;
	padding: 1px 6px;
	border-radius: 10px;
	font-weight: 600;
}
.plm-badge-sell { background: var(--green-100, #e4f5e9); color: var(--green-700, #16794c); }
.plm-badge-buy { background: var(--blue-100, #e1effe); color: var(--blue-700, #1a56db); }
.plm-count {
	font-size: 11px;
	min-width: 22px;
	text-align: center;
	color: var(--text-muted);
}
.plm-detail-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	flex-wrap: wrap;
	margin-bottom: 12px;
}
.plm-detail-title { font-size: 16px; font-weight: 600; }
.plm-detail-sub { font-size: 12px; color: var(--text-muted); }
.plm-item-search { max-width: 260px; }
.plm-table-wrap { overflow-x: auto; }
.plm-table {
	width: 100%;
	border-collapse: collapse;
	font-size: 13px;
}
.plm-table th {
	text-align: left;
	font-size: 11px;
	text-transform: uppercase;
	letter-spacing: 0.04em;
	color: var(--text-muted);
	font-weight: 600;
	padding: 8px;
	border-bottom: 1px solid var(--border-color);
	white-space: nowrap;
}
.plm-table td {
	padding: 8px;
	border-bottom: 1px solid var(--border-color);
	vertical-align: middle;
}
.plm-table tbody tr:hover { background: var(--subtle-fg, var(--control-bg)); }
.plm-num { text-align: right !important; white-space: nowrap; }
.plm-code { font-weight: 500; white-space: nowrap; }
.plm-rate { font-weight: 600; }
.plm-muted { color: var(--text-muted); }
.plm-discount { color: var(--green-700, #16794c); font-weight: 500; }
.plm-markup { color: var(--red-600, #e03636); font-weight: 500; }
.plm-dialog-discount {
	margin-top: 4px;
	padding: 8px 10px;
	border-radius: var(--border-radius, 6px);
	background: var(--control-bg);
	font-size: 12.5px;
}
.plm-actions { text-align: right; white-space: nowrap; }
.plm-actions .btn + .btn { margin-left: 4px; }
.plm-del:hover { color: var(--red-600, #e03636); }
.plm-empty {
	padding: 24px 8px;
	text-align: center;
	color: var(--text-muted);
}
`;
