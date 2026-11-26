// Print or View Invoices
//
// Sales Invoices, laid out like Historical Invoices. The list, with its filters
// and totals, is /app/print-or-view-invoices; one invoice is
// /app/print-or-view-invoices/<invoice no>, showing its printed PDF (the
// invoice, or the receipt when it has one) with Print and Open Record.
// Data comes from digitz_erp/api/sales_invoice_viewer_api.py.

frappe.provide("digitz_erp");

frappe.pages["print-or-view-invoices"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Print or View Invoices"),
		single_column: true,
	});
	wrapper.print_or_view_invoices = new digitz_erp.PrintOrViewInvoices(page);
};

frappe.pages["print-or-view-invoices"].on_page_show = function (wrapper) {
	wrapper.print_or_view_invoices && wrapper.print_or_view_invoices.route();
};

digitz_erp.PrintOrViewInvoices = class PrintOrViewInvoices {
	static API = "digitz_erp.api.sales_invoice_viewer_api.";
	static PAGE_LENGTH = 50;
	static ROUTE = "print-or-view-invoices";

	constructor(page) {
		this.page = page;
		this.start = 0;
		this.$el = $(`
			<div class="print-or-view-invoices">
				<div class="pv-list">
					<div class="pv-tiles"></div>
					<div class="pv-table"></div>
					<div class="pv-pager"></div>
				</div>
				<div class="pv-view hide"></div>
			</div>`).appendTo(page.body);
		this.$list = this.$el.find(".pv-list");
		this.$view = this.$el.find(".pv-view");
		this.reload = frappe.utils.debounce(() => {
			this.start = 0;
			this.load();
		}, 300);

		this.make_filters();

		this.$el.on("click", "[data-page]", (e) => {
			this.start = Math.max(0, this.start + cint($(e.currentTarget).attr("data-page")) * PrintOrViewInvoices.PAGE_LENGTH);
			this.load();
		});
		this.$el.on("click", "[data-kind]", (e) => this.show_pdf($(e.currentTarget).attr("data-kind")));
		// The page stays loaded while the route moves between the list and an invoice
		frappe.router.on("change", () => {
			frappe.get_route()[0] === PrintOrViewInvoices.ROUTE && this.route();
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

	status_badge(row) {
		const [label, cls] = row.docstatus === 2 ? [__("Cancelled"), "is-unpaid"]
			: row.docstatus === 0 ? [__("Draft"), "is-part"]
			: row.credit_sale ? [__("Credit"), ""] : [__("Cash"), "is-paid"];
		return `<span class="pv-badge ${cls}">${label}</span>`;
	}

	url(name) {
		return `/app/${PrintOrViewInvoices.ROUTE}/${encodeURIComponent(name)}`;
	}

	// ---------- List ----------

	make_filters() {
		const add = (df) => this.page.add_field({ ...df, change: () => this.reload() });
		const today = frappe.datetime.get_today();
		this.fields = {
			from_date: add({ fieldtype: "Date", fieldname: "from_date", label: __("From Date"), default: today }),
			to_date: add({ fieldtype: "Date", fieldname: "to_date", label: __("To Date"), default: today }),
			customer: add({ fieldtype: "Link", fieldname: "customer", label: __("Customer"), options: "Customer" }),
			payment_mode: add({ fieldtype: "Link", fieldname: "payment_mode", label: __("Payment Mode"), options: "Payment Mode" }),
			sale_type: add({ fieldtype: "Select", fieldname: "sale_type", label: __("Cash / Credit"), options: ["", "Cash", "Credit"] }),
			status: add({ fieldtype: "Select", fieldname: "status", label: __("Status"), options: ["", "Submitted", "Draft", "Cancelled"] }),
			search: add({ fieldtype: "Data", fieldname: "search", label: __("Invoice No / Name / Mobile") }),
		};
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
				method: PrintOrViewInvoices.API + "get_invoices",
				args: { filters: this.filters(), start: this.start, page_length: PrintOrViewInvoices.PAGE_LENGTH },
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
		const tile = (label, value) => `
			<div class="pv-tile">
				<div class="pv-tile-label">${label}</div>
				<div class="pv-tile-value">${value}</div>
			</div>`;
		this.$list.find(".pv-tiles").html(
			tile(__("Invoices"), cint(totals.count).toLocaleString()) +
			tile(__("Total"), this.money(totals.total))
		);

		if (!rows.length) {
			this.$list.find(".pv-table").html(`<div class="pv-empty"><p>${__("No invoices match these filters.")}</p></div>`);
			this.$list.find(".pv-pager").empty();
			return;
		}

		const body = rows.map((row) => `
			<tr>
				<td><a href="${this.url(row.name)}" class="pv-link">${this.esc(row.name)}</a></td>
				<td>${this.date(row.posting_date)} <span class="pv-muted">${this.time(row.posting_time)}</span></td>
				<td><div class="pv-ellipsis" title="${this.esc(row.customer_name)}">${this.esc(row.customer_name)}</div></td>
				<td><div class="pv-ellipsis" title="${this.esc(row.customer_display_name)}">${this.esc(row.customer_display_name)}</div></td>
				<td>${this.esc(row.customer_mobile_number)}</td>
				<td>${this.esc(row.payment_mode)}</td>
				<td>${this.status_badge(row)}</td>
				<td class="pv-num">${this.money(row.rounded_total)}</td>
			</tr>`).join("");
		this.$list.find(".pv-table").html(`
			<div class="pv-scroll">
				<table class="pv-grid">
					<thead><tr>
						<th>${__("Invoice No")}</th><th>${__("Date")}</th><th>${__("Customer")}</th>
						<th>${__("Display Name")}</th><th>${__("Mobile")}</th><th>${__("Payment Mode")}</th>
						<th>${__("Type")}</th><th class="pv-num">${__("Total")}</th>
					</tr></thead>
					<tbody>${body}</tbody>
				</table>
			</div>`);

		const first = this.start + 1;
		const last = this.start + rows.length;
		this.$list.find(".pv-pager").html(`
			<span class="pv-muted">${__("{0} to {1} of {2}", [first, last, cint(totals.count).toLocaleString()])}</span>
			<button type="button" class="btn btn-default btn-sm" data-page="-1" ${this.start ? "" : "disabled"}>${__("Previous")}</button>
			<button type="button" class="btn btn-default btn-sm" data-page="1" ${last < totals.count ? "" : "disabled"}>${__("Next")}</button>`);
	}

	// ---------- Route ----------

	route() {
		const name = frappe.get_route()[1];
		name ? this.show_invoice(decodeURIComponent(name)) : this.show_list();
	}

	show_list() {
		this.current = null;
		this.page.set_title(__("Print or View Invoices"));
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
		this.files = null;
		this.page.set_title(name);
		this.page.page_form.addClass("hide");
		this.$list.addClass("hide");
		this.$view.removeClass("hide").html(`<div class="pv-empty"><p>${__("Loading...")}</p></div>`);

		this.page.clear_actions();
		this.page.clear_inner_toolbar();
		this.page.set_secondary_action(__("Back to List"), () => frappe.set_route(PrintOrViewInvoices.ROUTE), "arrow-left");
		this.page.set_primary_action(__("Print"), () => this.print(), "printer");
		if (frappe.model.can_read("Sales Invoice")) {
			this.page.add_inner_button(__("Open Record"), () => frappe.set_route("Form", "Sales Invoice", name));
		}

		let r;
		try {
			r = await frappe.call({
				method: PrintOrViewInvoices.API + "get_invoice_pdfs",
				args: { name },
				freeze: true,
				freeze_message: __("Loading the printout..."),
			});
		} catch (e) {
			this.current === name && this.$view.html(`<div class="pv-empty"><p>${__("This invoice could not be opened.")}</p></div>`);
			return;
		}
		if (this.current !== name || !r.message) {
			return;
		}
		this.files = r.message;
		this.show_pdf("invoice");
	}

	pdf_src(url) {
		// A new URL each time, so a regenerated PDF is never served from cache
		return `${encodeURI(url)}?v=${Date.now()}`;
	}

	show_pdf(kind) {
		const files = this.files || {};
		if (!files[kind]) {
			kind = "invoice";
		}
		this.kind = kind;
		const tabs = files.receipt
			? `<div class="pv-tabs" role="tablist">
					${[["invoice", __("Invoice")], ["receipt", __("Receipt")]].map(([k, label]) => `
						<button type="button" class="btn btn-sm ${k === kind ? "btn-primary" : "btn-default"}"
							data-kind="${k}" role="tab" aria-selected="${k === kind}">${label}</button>`).join("")}
				</div>`
			: "";
		const banner = files.docstatus === 2
			? `<div class="pv-banner">${__("This invoice is cancelled.")}</div>`
			: files.docstatus === 0 ? `<div class="pv-banner is-draft">${__("This invoice is a draft, not submitted yet.")}</div>` : "";
		this.$view.html(`
			${banner}
			<div class="pv-toolbar">
				${tabs}
				<a class="btn btn-sm btn-default" href="${this.pdf_src(files[kind])}" target="_blank" rel="noopener">${__("Open in New Tab")}</a>
			</div>
			<iframe class="pv-pdf" title="${this.esc(this.current)}" src="${this.pdf_src(files[kind])}"></iframe>`);
	}

	print() {
		const files = this.files || {};
		const url = files[this.kind];
		if (!url) {
			return;
		}
		digitz_erp.si_engine.print_pdf(url, this.kind === "receipt" ? __("Receipt PDF") : __("Invoice PDF"));
	}
};
