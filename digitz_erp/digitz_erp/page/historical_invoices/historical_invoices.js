// Historical Invoices
//
// Invoices from the previous system (Historical Invoice, loaded by
// seeds/historical_invoice_seed.py), read-only. The list, with its filters and
// totals, is /app/historical-invoices; one invoice, laid out like the printed
// invoice with its totals at the foot, is /app/historical-invoices/<invoice no>.
// Data comes from digitz_erp/api/historical_invoice_api.py.

frappe.provide("digitz_erp");

frappe.pages["historical-invoices"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Historical Invoices"),
		single_column: true,
	});
	wrapper.historical_invoices = new digitz_erp.HistoricalInvoices(page);
};

frappe.pages["historical-invoices"].on_page_show = function (wrapper) {
	wrapper.historical_invoices && wrapper.historical_invoices.route();
};

digitz_erp.HistoricalInvoices = class HistoricalInvoices {
	static API = "digitz_erp.api.historical_invoice_api.";
	static PAGE_LENGTH = 50;

	constructor(page) {
		this.page = page;
		this.start = 0;
		this.$el = $(`
			<div class="historical-invoices">
				<div class="hi-list">
					<div class="hi-tiles"></div>
					<div class="hi-table"></div>
					<div class="hi-pager"></div>
				</div>
				<div class="hi-view hide"></div>
			</div>`).appendTo(page.body);
		this.$list = this.$el.find(".hi-list");
		this.$view = this.$el.find(".hi-view");
		this.reload = frappe.utils.debounce(() => {
			this.start = 0;
			this.load();
		}, 300);

		this.make_filters();
		this.options = this.load_options();

		this.$el.on("click", "[data-page]", (e) => {
			this.start = Math.max(0, this.start + cint($(e.currentTarget).attr("data-page")) * HistoricalInvoices.PAGE_LENGTH);
			this.load();
		});
		// The page stays loaded while the route moves between the list and an invoice
		frappe.router.on("change", () => {
			frappe.get_route()[0] === "historical-invoices" && this.route();
		});
	}

	money(v) {
		return format_currency(flt(v), frappe.boot.sysdefaults.currency);
	}

	esc(v) {
		return frappe.utils.escape_html(v == null ? "" : String(v));
	}

	date(v) {
		return v ? frappe.datetime.str_to_user(v) : "";
	}

	time(v) {
		// "8:11:31" or "08:11:31.000000" -> "08:11"
		return v ? String(v).split(":").slice(0, 2).map((p) => p.padStart(2, "0")).join(":") : "";
	}

	status_badge(status) {
		const cls = { "Fully Paid": "is-paid", "Partly Paid": "is-part", "Not Paid": "is-unpaid" }[status] || "";
		return status ? `<span class="hi-badge ${cls}">${this.esc(__(status))}</span>` : "";
	}

	url(name) {
		return `/app/historical-invoices/${encodeURIComponent(name)}`;
	}

	// ---------- List ----------

	make_filters() {
		const add = (df) => this.page.add_field({ ...df, change: () => this.reload() });
		this.fields = {
			from_date: add({ fieldtype: "Date", fieldname: "from_date", label: __("From Date") }),
			to_date: add({ fieldtype: "Date", fieldname: "to_date", label: __("To Date") }),
			customer_name: add({ fieldtype: "Autocomplete", fieldname: "customer_name", label: __("Customer"), options: [] }),
			payment_mode: add({ fieldtype: "Select", fieldname: "payment_mode", label: __("Payment Mode"), options: [""] }),
			payment_status: add({ fieldtype: "Select", fieldname: "payment_status", label: __("Payment Status"), options: [""] }),
			sales_man: add({ fieldtype: "Select", fieldname: "sales_man", label: __("Sales Man"), options: [""] }),
			search: add({ fieldtype: "Data", fieldname: "search", label: __("Invoice No / Name / Mobile") }),
			service: add({ fieldtype: "Data", fieldname: "service", label: __("Service") }),
		};
	}

	async load_options() {
		const r = await frappe.call({ method: HistoricalInvoices.API + "get_filter_options" });
		const o = r.message || {};
		this.fields.customer_name.set_data(o.customers || []);
		const set_select = (field, values) => {
			field.df.options = [""].concat(values || []);
			field.refresh();
		};
		set_select(this.fields.payment_mode, o.payment_modes);
		set_select(this.fields.payment_status, o.payment_statuses);
		set_select(this.fields.sales_man, o.sales_men);
		this.date_range = [o.first_date, o.last_date];
	}

	filters() {
		const values = {};
		Object.entries(this.fields).forEach(([key, field]) => {
			const value = field.get_value();
			if (value) {
				values[key] = value;
			}
		});
		return values;
	}

	clear_filters() {
		Object.values(this.fields).forEach((field) => {
			field.df.change = null;
			field.set_value("");
		});
		Object.values(this.fields).forEach((field) => {
			field.df.change = () => this.reload();
		});
		this.reload();
	}

	async load() {
		const seq = (this.seq = (this.seq || 0) + 1);
		this.$list.addClass("is-loading");
		try {
			const r = await frappe.call({
				method: HistoricalInvoices.API + "get_invoices",
				args: { filters: this.filters(), start: this.start, page_length: HistoricalInvoices.PAGE_LENGTH },
			});
			if (seq === this.seq && r.message) {
				this.data = r.message;
				this.render_list();
			}
		} finally {
			seq === this.seq && this.$list.removeClass("is-loading");
		}
	}

	render_list() {
		const { rows, totals } = this.data;
		const tile = (label, value, cls = "") => `
			<div class="hi-tile ${cls}">
				<div class="hi-tile-label">${label}</div>
				<div class="hi-tile-value">${value}</div>
			</div>`;
		this.$list.find(".hi-tiles").html(
			tile(__("Invoices"), cint(totals.count).toLocaleString()) +
			tile(__("Total"), this.money(totals.total)) +
			tile(__("Paid"), this.money(totals.paid), "is-paid") +
			tile(__("Not Paid"), this.money(totals.unpaid), flt(totals.unpaid) ? "is-unpaid" : "")
		);

		if (!rows.length) {
			const range = this.date_range && this.date_range[0]
				? __("Invoices on file run from {0} to {1}.", [this.date(this.date_range[0]), this.date(this.date_range[1])])
				: __("No historical invoices have been imported yet.");
			this.$list.find(".hi-table").html(`<div class="hi-empty"><p>${__("No invoices match these filters.")}</p><p>${range}</p></div>`);
			this.$list.find(".hi-pager").empty();
			return;
		}

		const body = rows.map((row) => `
			<tr>
				<td><a href="${this.url(row.name)}" class="hi-link">${this.esc(row.invoice_number)}</a></td>
				<td>${this.date(row.invoice_date)} <span class="hi-muted">${this.time(row.invoice_time)}</span></td>
				<td><div class="hi-ellipsis" title="${this.esc(row.customer_name)}">${this.esc(row.customer_name)}</div></td>
				<td><div class="hi-ellipsis" title="${this.esc(row.display_customer)}">${this.esc(row.display_customer)}</div></td>
				<td>${this.esc(row.customer_mobile)}</td>
				<td>${this.esc(row.payment_mode)}</td>
				<td>${this.status_badge(row.payment_status)}</td>
				<td class="hi-num">${this.money(row.invoice_total)}</td>
			</tr>`).join("");
		this.$list.find(".hi-table").html(`
			<div class="hi-scroll">
				<table class="hi-grid">
					<thead><tr>
						<th>${__("Invoice No")}</th><th>${__("Date")}</th><th>${__("Customer")}</th>
						<th>${__("Display Customer")}</th><th>${__("Mobile")}</th><th>${__("Payment Mode")}</th>
						<th>${__("Status")}</th><th class="hi-num">${__("Total")}</th>
					</tr></thead>
					<tbody>${body}</tbody>
				</table>
			</div>`);

		const first = this.start + 1;
		const last = this.start + rows.length;
		this.$list.find(".hi-pager").html(`
			<span class="hi-muted">${__("{0} to {1} of {2}", [first, last, cint(totals.count).toLocaleString()])}</span>
			<button type="button" class="btn btn-default btn-sm" data-page="-1" ${this.start ? "" : "disabled"}>${__("Previous")}</button>
			<button type="button" class="btn btn-default btn-sm" data-page="1" ${last < totals.count ? "" : "disabled"}>${__("Next")}</button>`);
	}

	// ---------- Route ----------

	route() {
		const name = frappe.get_route()[1];
		name ? this.show_invoice(name) : this.show_list();
	}

	show_list() {
		this.current = null;
		this.page.set_title(__("Historical Invoices"));
		this.page.page_form.removeClass("hide");
		this.$view.addClass("hide").empty();
		this.$list.removeClass("hide");
		this.page.clear_actions();
		this.page.clear_inner_toolbar();
		this.page.set_secondary_action(__("Clear Filters"), () => this.clear_filters());
		this.page.set_primary_action(__("Refresh"), () => this.load(), "refresh");
		if (!this.data) {
			this.load();
		}
	}

	// ---------- Invoice view ----------

	async show_invoice(name) {
		if (this.current === name) {
			return;
		}
		this.current = name;
		this.page.set_title(name);
		this.page.page_form.addClass("hide");
		this.$list.addClass("hide");
		this.$view.removeClass("hide").html(`<div class="hi-empty"><p>${__("Loading...")}</p></div>`);

		this.page.clear_actions();
		this.page.clear_inner_toolbar();
		this.page.set_secondary_action(__("Back to List"), () => frappe.set_route("historical-invoices"), "arrow-left");
		this.page.set_primary_action(__("Print"), () => window.print(), "printer");
		if (frappe.user.has_role("System Manager")) {
			this.page.add_inner_button(__("Open Record"), () => frappe.set_route("Form", "Historical Invoice", name));
		}

		const r = await frappe.call({ method: HistoricalInvoices.API + "get_invoice", args: { name } });
		if (this.current === name && r.message) {
			this.render_invoice(r.message);
		}
	}

	render_invoice(d) {
		const c = d.company || {};
		const fact = (label, value) => value ? `<div class="hi-fact"><span>${label}</span><strong>${value}</strong></div>` : "";
		const extra = (label, value) => value ? `<span>${label}: ${this.esc(value)}</span>` : "";
		// What the customer paid on a line beyond its service charge. The report's
		// TOTAL GOVT.FEE can repeat an OTHER CHARGE that is already in the service
		// charge (INV/408176), so it is taken from the line amount instead; the
		// report's own figure stays on the record.
		const govt_fee = (item) => flt(item.amount) - flt(item.total_service_charge);
		const govt_total = (d.items || []).reduce((sum, item) => sum + govt_fee(item), 0);
		const header = c.invoice_header_image
			? `<header class="hi-letterhead"><img src="${this.esc(c.invoice_header_image)}" alt="${this.esc(c.company_name || "")}"></header>`
			: `<header class="hi-sheet-head">
					<div class="hi-company">
						${c.company_logo ? `<img src="${this.esc(c.company_logo)}" alt="">` : ""}
						<div>
							<div class="hi-company-name">${this.esc(c.company_name || "")}</div>
							<div class="hi-muted hi-pre">${this.esc(c.address || "")}</div>
							<div class="hi-muted">${[c.phone, c.email_id].filter(Boolean).map((v) => this.esc(v)).join(" · ")}</div>
							${c.tax_id ? `<div class="hi-muted">${__("TRN")}: ${this.esc(c.tax_id)}</div>` : ""}
						</div>
					</div>
					<div class="hi-title"><h2>${__("Tax Invoice")}</h2></div>
				</header>`;

		const lines = (d.items || []).map((item, i) => {
			const details = [
				extra(__("Code"), item.stock_id),
				extra(__("Govt. Bank"), item.govt_bank),
				extra(__("Application / Receipt ID"), item.application_id),
				extra(__("Bank Ref."), item.bank_reference_number),
				extra(__("MB/ST/DW-ID"), item.mb_st_dw_id),
				extra(__("Ref."), item.ref_name),
			].filter(Boolean).join("");
			return `
				<tr>
					<td class="hi-idx">${i + 1}</td>
					<td>
						<div class="hi-service">${this.esc(item.service_name)}</div>
						<div class="hi-details">${details}</div>
					</td>
					<td>${this.esc(item.category)}</td>
					<td class="hi-num">${flt(item.quantity)}</td>
					<td class="hi-num">${this.money(item.total_service_charge)}</td>
					<td class="hi-num">${this.money(item.total_vat)}</td>
					<td class="hi-num">${this.money(govt_fee(item))}</td>
					<td class="hi-num hi-strong">${this.money(item.amount)}</td>
				</tr>`;
		}).join("");

		const total_row = (label, value, cls = "") => `<tr class="${cls}"><td>${label}</td><td class="hi-num">${value}</td></tr>`;
		const optional = (label, value, sign = "") => flt(value) ? total_row(label, sign + this.money(value)) : "";
		const unpaid = d.payment_status && d.payment_status !== "Fully Paid";
		const differs = Math.abs(flt(d.computed_total) - flt(d.invoice_total)) >= 0.01;

		this.$view.html(`
			<div class="hi-sheet">
				${header}

				<section class="hi-meta">
					<div class="hi-billto">
						<div class="hi-number">${this.esc(d.invoice_number)} ${this.status_badge(d.payment_status)}</div>
						<div class="hi-label">${__("Bill To")}</div>
						<div class="hi-billto-name">${this.esc(d.customer_name)}</div>
						${d.display_customer && d.display_customer !== d.customer_name ? `<div>${this.esc(d.display_customer)}</div>` : ""}
						<div class="hi-muted">${[d.customer_mobile, d.customer_email].filter(Boolean).map((v) => this.esc(v)).join(" · ")}</div>
					</div>
					<div class="hi-facts">
						${fact(__("Invoice Date"), this.date(d.invoice_date))}
						${fact(__("Time"), this.time(d.invoice_time))}
						${fact(__("Payment Mode"), this.esc(d.payment_mode))}
						${fact(__("Sales Man"), this.esc(d.sales_man))}
						${fact(__("Cashier"), this.esc(d.employee_name || d.employee))}
					</div>
				</section>

				<div class="hi-scroll-x">
					<table class="hi-items">
						<thead><tr>
							<th class="hi-idx">#</th><th>${__("Service")}</th><th>${__("Category")}</th>
							<th class="hi-num">${__("Qty")}</th><th class="hi-num">${__("Service Charge")}</th>
							<th class="hi-num">${__("VAT")}</th><th class="hi-num">${__("Govt. Fee")}</th>
							<th class="hi-num">${__("Amount")}</th>
						</tr></thead>
						<tbody>${lines}</tbody>
					</table>
				</div>

				<footer class="hi-foot">
					<div class="hi-notes hi-muted">
						<p>${__("Service charges include VAT.")}</p>
						<p>${__("Imported from the previous system{0}. Not posted to the ledger.", [d.source_file ? ` (${this.esc(d.source_file)})` : ""])}</p>
						${differs ? `<p class="hi-warn">${__("The lines add up to {0}; the previous system recorded {1} as the invoice total.", [this.money(d.computed_total), this.money(d.invoice_total)])}</p>` : ""}
					</div>
					<table class="hi-totals">
						${total_row(__("Service Charges (excl. VAT)"), this.money(flt(d.total_service_charge) - flt(d.total_vat)))}
						${total_row(__("VAT"), this.money(d.total_vat))}
						${total_row(__("Govt. Fees"), this.money(govt_total))}
						${flt(d.total_bank_service_charge) ? total_row(`<span class="hi-muted">${__("incl. bank service charges")}</span>`, `<span class="hi-muted">${this.money(d.total_bank_service_charge)}</span>`) : ""}
						${optional(__("Extra / Round Off"), d.total_extra_charge)}
						${optional(__("Discount"), d.total_discount, "- ")}
						${optional(__("Reward"), d.total_reward, "- ")}
						${total_row(__("Invoice Total"), this.money(d.invoice_total), "hi-grand")}
						${unpaid ? total_row(__("Amount Due"), this.money(d.invoice_total), "hi-due") : ""}
					</table>
				</footer>
				${c.footer_image ? `<div class="hi-letterfoot"><img src="${this.esc(c.footer_image)}" alt=""></div>` : ""}
			</div>`);
	}
};
