// Cashier Console: Customer Ledger.
//
// One customer's statement for a date range: the opening balance, every
// posting, the running balance and the closing balance. The same figures as the
// Account Ledger Report filtered on the customer (digitz_erp/api/
// customer_ledger.py), which a cashier cannot open. The invoice and receipt
// editors open it on their customer: /app/cashier-console/ledger/<customer>.

frappe.provide("digitz_erp");

digitz_erp.CustomerLedger = class CustomerLedger {
	constructor($parent) {
		this.$el = $('<div class="cc-history cl-ledger"></div>').appendTo($parent);
		this.reload = frappe.utils.debounce(() => this.load(), 300);
		this.make();
	}

	money(v) {
		return format_currency(v, frappe.boot.sysdefaults.currency);
	}

	esc(v) {
		return frappe.utils.escape_html(v == null ? "" : String(v));
	}

	// Dr / Cr balance: positive is what the customer owes
	balance(v) {
		v = flt(v, 2);
		return v ? `${this.money(Math.abs(v))} ${v > 0 ? __("Dr") : __("Cr")}` : this.money(0);
	}

	make() {
		this.$el.html(`
			<div class="cc-hist-filters">
				<div class="cc-hist-fields"></div>
				<div class="cc-hist-chips">
					<button type="button" class="cc-hist-chip" data-range="month">${__("This Month")}</button>
					<button type="button" class="cc-hist-chip" data-range="3">${__("Last 3 Months")}</button>
					<button type="button" class="cc-hist-chip" data-range="year">${__("This Year")}</button>
				</div>
				<div class="cl-buttons">
					<button type="button" class="btn btn-default btn-sm" data-tool="print">${frappe.utils.icon("printer", "sm")} ${__("Print")}</button>
					<button type="button" class="btn btn-default btn-sm hide" data-tool="report">${__("Open Account Ledger Report")}</button>
				</div>
			</div>
			<div class="cc-hist-tiles"></div>
			<div class="cc-hist-table"></div>
		`);

		const $fields = this.$el.find(".cc-hist-fields");
		const field = (df, cls) => frappe.ui.form.make_control({
			parent: $(`<div class="cc-hist-field ${cls || ""}"></div>`).appendTo($fields),
			df: { ...df, change: () => this.reload() },
			render_input: true,
		});
		this.fields = {
			customer: field({ fieldtype: "Link", fieldname: "customer", label: __("Customer"), options: "Customer" }, "cl-customer"),
			from_date: field({ fieldtype: "Date", fieldname: "from_date", label: __("From") }),
			to_date: field({ fieldtype: "Date", fieldname: "to_date", label: __("To") }),
		};
		this.set_range("3", true);

		this.$el.on("click", ".cc-hist-chip", (e) => this.set_range($(e.currentTarget).attr("data-range")));
		this.$el.on("click", "[data-tool]", (e) => {
			$(e.currentTarget).attr("data-tool") === "print" ? this.print() : this.open_report();
		});
		this.$el.on("click", "[data-open]", (e) => {
			e.preventDefault();
			const [doctype, name] = [$(e.currentTarget).attr("data-doctype"), $(e.currentTarget).attr("data-open")];
			const tab = { "Sales Invoice": "invoices", "Receipt Entry": "receipts" }[doctype];
			tab ? frappe.set_route("cashier-console", tab, name) : frappe.set_route("Form", doctype, name);
		});
	}

	set_range(range, quiet) {
		const today = frappe.datetime.get_today();
		const from = {
			month: frappe.datetime.month_start(),
			3: frappe.datetime.add_months(frappe.datetime.month_start(), -2),
			year: frappe.datetime.year_start(),
		}[range];
		this.$el.find(".cc-hist-chip").each((_, el) => el.classList.toggle("active", el.dataset.range === range));
		if (quiet) {
			this.fields.from_date.df.change = null;
			this.fields.to_date.df.change = null;
		}
		this.fields.from_date.set_value(from);
		this.fields.to_date.set_value(today);
		if (quiet) {
			this.fields.from_date.df.change = () => this.reload();
			this.fields.to_date.df.change = () => this.reload();
		}
	}

	// /app/cashier-console/ledger/<customer>
	route(sub) {
		const customer = sub && sub[0] ? decodeURIComponent(sub[0]) : null;
		if (customer && customer !== this.fields.customer.get_value()) {
			this.fields.customer.set_value(customer);
		} else {
			this.load();
		}
	}

	async load() {
		const customer = this.fields.customer.get_value();
		if (!customer) {
			this.data = null;
			this.$el.find(".cc-hist-tiles").empty();
			this.$el.find(".cc-hist-table").html(`<div class="cc-hist-empty"><p>${__("Select a customer to see their ledger.")}</p></div>`);
			return;
		}
		const seq = (this.seq = (this.seq || 0) + 1);
		this.$el.addClass("is-loading");
		try {
			const r = await frappe.call({
				method: "digitz_erp.api.customer_ledger.get_customer_ledger",
				args: {
					customer,
					from_date: this.fields.from_date.get_value(),
					to_date: this.fields.to_date.get_value(),
				},
			});
			if (seq !== this.seq || !r.message) {
				return;
			}
			this.data = r.message;
			this.$el.find('[data-tool="report"]').toggleClass("hide", !this.data.can_open_report);
			this.render();
		} finally {
			seq === this.seq && this.$el.removeClass("is-loading");
		}
	}

	render() {
		const d = this.data;
		const tile = (label, value, cls = "") => `
			<div class="cc-hist-tile ${cls}">
				<div class="cc-hist-tile-label">${label}</div>
				<div class="cc-hist-tile-value">${value}</div>
			</div>`;
		this.$el.find(".cc-hist-tiles").html(
			tile(__("Opening Balance"), this.balance(d.opening)) +
			tile(__("Debit"), this.money(d.debit)) +
			tile(__("Credit"), this.money(d.credit)) +
			tile(__("Closing Balance"), this.balance(d.closing), flt(d.closing, 2) > 0 ? "is-short" : "")
		);

		if (!d.rows.length) {
			this.$el.find(".cc-hist-table").html(`<div class="cc-hist-empty"><p>${__("No entries for {0} in this range.", [this.esc(d.customer_name || d.customer)])}</p></div>`);
			return;
		}
		const body = d.rows.map((row) => {
			const summary = ["Opening", "Closing Balance"].includes(row.voucher_type);
			const running = flt(row.running_total_debit) - flt(row.running_total_credit);
			const voucher = summary || !row.voucher_no
				? this.esc(row.voucher_no)
				: `<a href="#" data-open="${this.esc(row.voucher_no)}" data-doctype="${this.esc(row.voucher_type)}">${this.esc(row.voucher_no)}</a>`;
			return `
				<tr class="${summary ? "cl-summary" : ""}">
					<td>${frappe.datetime.str_to_user(row.posting_date)}</td>
					<td>${summary ? this.esc(row.account) : __(row.voucher_type)}</td>
					<td>${voucher}</td>
					<td><div class="ci-ellipsis">${this.esc(row.remarks)}</div></td>
					<td class="cc-num">${flt(row.debit_amount) ? this.money(row.debit_amount) : ""}</td>
					<td class="cc-num">${flt(row.credit_amount) ? this.money(row.credit_amount) : ""}</td>
					<td class="cc-num cc-nowrap">${this.balance(running)}</td>
				</tr>`;
		}).join("");
		this.$el.find(".cc-hist-table").html(`
			<div class="cc-hist-scroll">
				<table class="cc-hist-grid">
					<thead><tr>
						<th>${__("Date")}</th><th>${__("Type")}</th><th>${__("Voucher")}</th><th>${__("Remarks")}</th>
						<th class="cc-num">${__("Debit")}</th><th class="cc-num">${__("Credit")}</th><th class="cc-num">${__("Balance")}</th>
					</tr></thead>
					<tbody>${body}</tbody>
				</table>
			</div>`);
	}

	open_report() {
		const d = this.data;
		frappe.route_options = { customer: d.customer, from_date: d.from_date, to_date: d.to_date };
		frappe.set_route("query-report", "Account Ledger Report");
	}

	// A statement to hand the customer
	print() {
		const d = this.data;
		if (!d) {
			frappe.msgprint(__("Select a customer first."));
			return;
		}
		const rows = d.rows.map((row) => {
			const running = flt(row.running_total_debit) - flt(row.running_total_credit);
			const summary = ["Opening", "Closing Balance"].includes(row.voucher_type);
			return `<tr class="${summary ? "s" : ""}">
				<td>${frappe.datetime.str_to_user(row.posting_date)}</td>
				<td>${summary ? this.esc(row.account) : this.esc(row.voucher_type)}</td>
				<td>${summary ? "" : this.esc(row.voucher_no)}</td>
				<td>${this.esc(row.remarks)}</td>
				<td class="n">${flt(row.debit_amount) ? this.money(row.debit_amount) : ""}</td>
				<td class="n">${flt(row.credit_amount) ? this.money(row.credit_amount) : ""}</td>
				<td class="n">${this.balance(running)}</td></tr>`;
		}).join("");
		const w = window.open("", "_blank");
		if (!w) {
			frappe.msgprint(__("Allow pop-ups for this site to print the statement."));
			return;
		}
		w.document.open();
		w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${__("Statement")} ${this.esc(d.customer)}</title>
			<style>
				@page { size: A4; margin: 12mm; }
				body { font-family: Arial, sans-serif; font-size: 11px; color: #000; }
				h2 { text-align: center; background: #f2f2f2; padding: 8px; margin: 0 0 10px; font-size: 17px; }
				.meta { display: flex; justify-content: space-between; margin-bottom: 10px; }
				table { width: 100%; border-collapse: collapse; }
				th, td { border: 1px solid #999; padding: 4px 6px; text-align: left; }
				th { background: #eaeaea; }
				.n { text-align: right; white-space: nowrap; }
				tr.s td { font-weight: bold; background: #f7f7f7; }
				.tot { margin-top: 10px; text-align: right; font-size: 12px; }
			</style></head>
			<body onload="window.print()">
				<h2>${__("STATEMENT OF ACCOUNT")}</h2>
				<div class="meta">
					<div><b>${this.esc(d.customer_name || d.customer)}</b><br>${this.esc(d.customer)}</div>
					<div>${__("Period")}: ${frappe.datetime.str_to_user(d.from_date)} – ${frappe.datetime.str_to_user(d.to_date)}<br>
						${__("Printed")}: ${frappe.datetime.str_to_user(frappe.datetime.now_datetime())}</div>
				</div>
				<table><thead><tr><th>${__("Date")}</th><th>${__("Type")}</th><th>${__("Voucher")}</th><th>${__("Remarks")}</th>
					<th class="n">${__("Debit")}</th><th class="n">${__("Credit")}</th><th class="n">${__("Balance")}</th></tr></thead>
					<tbody>${rows}</tbody></table>
				<div class="tot"><b>${__("Closing Balance")}: ${this.balance(d.closing)}</b></div>
			</body></html>`);
		w.document.close();
	}
};
