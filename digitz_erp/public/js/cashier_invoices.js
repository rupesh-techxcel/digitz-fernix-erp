// Cashier Console: Sales Invoices.
//
// The console's Sales Invoices tab: an "All Invoices" list and one inner tab per
// invoice opened or being created, each an InvoiceEditor. The open invoice is in
// the route (/app/cashier-console/invoices/<name>), so links, reloads and the
// back button land on it.
//
// Invoices here are standalone: nothing links to a Sales Order, Quotation,
// Delivery Note or Project. One that does opens read-only, with a way to the
// standard form. Every rule (pricing, tax, discounts, receipt schedule, cash) is
// the shared engine the Sales Invoice form uses (sales_invoice_engine.js), and
// documents are saved, submitted and cancelled through the same server calls as
// the form, so server validations and postings are unchanged.

frappe.provide("digitz_erp");

(function () {
	const DOCTYPE = "Sales Invoice";
	const ITEM_DOCTYPE = "Sales Invoice Item";
	const ROUTE = ["cashier-console", "invoices"];
	const E = () => digitz_erp.si_engine;

	const esc = (v) => frappe.utils.escape_html(v == null ? "" : String(v));
	const money = (v) => format_currency(flt(v), frappe.boot.sysdefaults.currency);
	const num = (v) => format_number(flt(v), null, 2);
	const storage_key = () => `digitz_cashier_invoices:${frappe.session.user}`;

	// Fields that tie an invoice to a Sales Order, Quotation, Delivery Note or
	// Project. The console never writes them; an invoice with any set opens read-only.
	const LINKED = ["sales_order", "quotation", "project", "for_advance_payment", "for_retention_recovery"];

	// The payment fields: in the Payment popup, summarised beside its button
	// Reference Date is not shown: the server gives a bank payment the posting date.
	// Credit Days is not shown either: it comes from the customer (or company) and
	// still sets the receipt schedule's due date.
	const PAYMENT_FIELDS = ["credit_sale", "payment_mode", "payment_account", "reference_no", "received_amount"];
	const ROW_LINKED = ["sales_order_item_reference_no", "delivery_note_item_reference_no", "quotation_item_reference_no"];

	// A record's values, or {} when the user may not read that doctype. The
	// server shows the permission error; the form carries on the same way.
	async function read_values(doctype, name, fields) {
		try {
			return (await frappe.db.get_value(doctype, name, fields)).message || {};
		} catch (err) {
			return {};
		}
	}

	// Small Text controls set a 150px height inline; these cards need less
	function compact_textarea(control) {
		control.$input && control.$input.is("textarea") && control.$input.css("height", "72px");
	}

	// A cashier who is not a supervisor works on today's invoices only (the
	// server's counter_session_api.restrict_cashier_to_today): one dated another
	// day opens read-only, and the posting date cannot be changed
	function today_only() {
		const state = digitz_erp.counter_state;
		return state ? !!state.must_open_day : frappe.user.has_role("Cashier") && !frappe.user.has_role("System Manager");
	}

	function other_day(doc) {
		return !doc.__islocal && doc.docstatus === 0 && !!doc.posting_date && doc.posting_date !== frappe.datetime.get_today();
	}

	function linked_to(doc) {
		const found = LINKED.filter((f) => doc[f]).map((f) => frappe.meta.get_label(DOCTYPE, f));
		if ((doc.delivery_notes || []).length || (doc.items || []).some((r) => ROW_LINKED.some((f) => r[f]))) {
			found.push(__("Delivery Note / Sales Order / Quotation items"));
		}
		return [...new Set(found)];
	}

	// ================================================================ host

	digitz_erp.CashierInvoices = class CashierInvoices {
		constructor(page, parent) {
			this.page = page;
			this.tabs = []; // {key, editor, $tab, $view}
			this.active = "list";
			this.new_count = 0;
			this.mobile_mandatory = null;

			this.$el = $(`
				<div class="ci">
					<div class="ci-strip" role="tablist" aria-label="${__("Open invoices")}">
						<button type="button" class="ci-stab ci-stab-list active" data-key="list" role="tab">
							${frappe.utils.icon("list", "sm")}<span>${__("All Invoices")}</span>
						</button>
						<div class="ci-stab-docs"></div>
						<div class="ci-strip-files"></div>
						<button type="button" class="ci-new" title="${__("New Invoice (Alt+N)")}">
							${frappe.utils.icon("add", "sm")}<span>${__("New Invoice")}</span>
						</button>
					</div>
					<div class="ci-views">
						<div class="ci-view" data-key="list"></div>
					</div>
				</div>
			`).appendTo(parent);

			this.$docs = this.$el.find(".ci-stab-docs");
			this.list = new digitz_erp.InvoiceList(this, this.$el.find('.ci-view[data-key="list"]'));

			this.bind();
			this.restore();
		}

		bind() {
			this.$el.on("click", ".ci-stab", (e) => {
				if ($(e.target).closest(".ci-stab-close").length) {
					return;
				}
				this.go($(e.currentTarget).attr("data-key"));
			});
			this.$el.on("click", ".ci-stab-close", (e) => {
				e.stopPropagation();
				this.close($(e.currentTarget).closest(".ci-stab").attr("data-key"));
			});
			this.$el.on("click", ".ci-new", () => this.new_invoice());
			this.$el.on("click", ".ci-strip-file", (e) => {
				const editor = this.active_editor();
				if (!editor || e.ctrlKey || e.metaKey || e.shiftKey) {
					return;
				}
				e.preventDefault();
				editor.show_pdf(cint(e.currentTarget.dataset.pdfIndex));
			});
			this.$el.on("change", "[data-print-flag]", (e) => {
				const editor = this.active_editor();
				editor && editor.set_print_flag(e.currentTarget.dataset.printFlag, e.currentTarget.checked ? 1 : 0);
			});

			frappe.ui.keys.add_shortcut({
				shortcut: "alt+n",
				action: () => this.is_visible() && this.new_invoice(),
				description: __("Cashier Console: New Sales Invoice"),
				page: this.page,
				ignore_inputs: true,
			});
			frappe.ui.keys.add_shortcut({
				shortcut: "alt+p",
				action: () => {
					const editor = this.active_editor();
					editor && this.is_visible() && editor.open_payment_dialog();
				},
				description: __("Cashier Console: Payment"),
				page: this.page,
				ignore_inputs: true,
			});
			frappe.ui.keys.add_shortcut({
				shortcut: "ctrl+s",
				action: () => {
					const editor = this.active_editor();
					if (editor && this.is_visible()) {
						editor.save("Save");
						return true;
					}
					return false;
				},
				description: __("Cashier Console: Save Sales Invoice"),
				page: this.page,
				ignore_inputs: true,
			});

			// Unsaved invoices are only in this browser tab
			$(window).on("beforeunload", () => {
				if (this.tabs.some((t) => t.editor && t.editor.dirty)) {
					return true;
				}
			});
		}

		is_visible() {
			return this.$el.is(":visible");
		}

		active_editor() {
			const tab = this.tabs.find((t) => t.key === this.active);
			return tab && tab.editor;
		}

		// ------------------------------------------------------------ routing

		go(key) {
			key && key !== "list" ? frappe.set_route(...ROUTE, key) : frappe.set_route(...ROUTE);
		}

		new_invoice() {
			frappe.set_route(...ROUTE, "new");
		}

		open_invoice(name) {
			this.go(name);
		}

		replace_route(key) {
			frappe.route_flags.replace_route = true;
			this.go(key);
		}

		// Called by the console with the route after /invoices
		async route(sub) {
			const key = sub && sub[0] ? decodeURIComponent(sub[0]) : "list";

			// The doctype's fields and defaults, which the form would have loaded
			await frappe.model.with_doctype(DOCTYPE);

			if (key === "list") {
				this.show("list");
				return;
			}
			if (key === "new") {
				const tab = await this.add_new();
				tab && this.replace_route(tab.key);
				return;
			}

			let tab = this.tabs.find((t) => t.key === key);
			if (!tab) {
				// A link to an unsaved invoice from an earlier session: start a new one
				if (key.startsWith("new-sales-invoice")) {
					this.replace_route("new");
					return;
				}
				tab = this.add_tab(key);
			}
			this.show(key);
			if (!tab.editor && !tab.loading) {
				await this.load(tab);
			}
		}

		refresh() {
			if (this.active === "list") {
				this.list.load(true);
			} else {
				const editor = this.active_editor();
				editor && !editor.dirty && !editor.doc.__islocal && editor.reload();
			}
		}

		// ------------------------------------------------------------- tabs

		add_tab(key, label) {
			const tab = { key, label: label || key };
			tab.$tab = $(`
				<button type="button" class="ci-stab ci-stab-doc" role="tab" data-key="${esc(key)}">
					<span class="ci-stab-dot"></span>
					<span class="ci-stab-label"></span>
					<span class="ci-stab-close" role="button" title="${__("Close")}">${frappe.utils.icon("close", "xs")}</span>
				</button>`).appendTo(this.$docs);
			tab.$view = $(`<div class="ci-view" data-key="${esc(key)}" hidden></div>`).appendTo(this.$el.find(".ci-views"));
			this.tabs.push(tab);
			this.paint(tab);
			return tab;
		}

		async add_new(doc, opts = {}) {
			this.new_count++;
			const editor_doc = doc || frappe.model.get_new_doc(DOCTYPE);
			const tab = this.add_tab(editor_doc.name, __("New Invoice {0}", [this.new_count]));
			tab.editor = new digitz_erp.InvoiceEditor(this, tab, editor_doc);
			await tab.editor.init_new(opts);
			return tab;
		}

		async load(tab) {
			tab.loading = true;
			tab.$view.html(`<div class="ci-loading">${__("Loading {0}...", [esc(tab.key)])}</div>`);
			try {
				// Always the saved version, never a cached copy edited earlier
				if (frappe.get_doc(DOCTYPE, tab.key)) {
					frappe.model.remove_from_locals(DOCTYPE, tab.key);
				}
				await frappe.model.with_doc(DOCTYPE, tab.key);
				const doc = frappe.get_doc(DOCTYPE, tab.key);
				if (!doc) {
					throw new Error("not found");
				}
				tab.editor = new digitz_erp.InvoiceEditor(this, tab, doc);
				tab.editor.render();
			} catch (e) {
				tab.$view.html(`<div class="ci-loading">${__("Could not open {0}. It may have been deleted or you may not have access.", [esc(tab.key)])}</div>`);
			} finally {
				tab.loading = false;
				this.paint(tab);
				this.persist();
			}
		}

		show(key) {
			this.active = key;
			this.$el.find(".ci-stab").each((_, el) => {
				const on = el.dataset.key === key;
				el.classList.toggle("active", on);
				el.setAttribute("aria-selected", on ? "true" : "false");
				on && el.scrollIntoView && el.scrollIntoView({ block: "nearest", inline: "nearest" });
			});
			this.$el.find(".ci-view").each((_, el) => {
				el.hidden = el.dataset.key !== key;
			});
			if (key === "list") {
				this.list.show();
			}
			const editor = this.active_editor();
			editor && editor.on_show();
			this.paint_files();
			// Inside an invoice the console's blue header gives its room to the invoice
			// (the navbar counter badge still shows the shift); it returns on the list
			this.$el.closest(".cashier-console").toggleClass("cc-in-invoice", key !== "list");
		}

		// Beside New Invoice, for the open invoice: what its printout shows
		// (Show Company / Show TRN) and its Invoice PDF and Receipt PDF
		paint_files() {
			const editor = this.active_editor();
			if (!editor) {
				this.$el.find(".ci-strip-files").empty();
				return;
			}
			const doc = editor.doc;
			const pdfs = !doc.__islocal ? editor.pdfs || [] : [];
			const can_change = editor.can_change_print_flags();
			const flag = (fieldname, label) => `
				<label class="ci-print-flag" title="${__("Shown on the invoice and receipt printouts")}">
					<input type="checkbox" data-print-flag="${fieldname}" ${cint(doc[fieldname]) ? "checked" : ""} ${can_change ? "" : "disabled"}>
					<span>${label}</span>
				</label>`;
			this.$el.find(".ci-strip-files").html(`
				<div class="ci-print-flags">
					<span class="ci-print-caption">${__("Print shows")}</span>
					${flag("show_company_in_printout", __("Company"))}
					${flag("show_trn_in_printout", __("TRN"))}
				</div>
				${pdfs.map((f, i) => `
					<a class="ci-strip-file" href="${encodeURI(f.file_url)}" target="_blank" rel="noopener" title="${esc(f.file_name)}" data-pdf-index="${i}">
						${frappe.utils.icon("file", "sm")}<span>${f.label}</span>
					</a>`).join("")}`);
		}

		// Tab label, status colour and unsaved marker
		paint(tab) {
			const editor = tab.editor;
			const doc = editor && editor.doc;
			let state = "loading";
			if (doc) {
				state = doc.__islocal ? "new" : ["draft", "submitted", "cancelled"][doc.docstatus] || "draft";
			}
			tab.$tab.attr("data-state", state).toggleClass("is-dirty", !!(editor && editor.dirty));
			tab.$tab.find(".ci-stab-label").text(doc && !doc.__islocal ? doc.name : tab.label);
			tab.$tab.attr("title", doc && doc.customer_display_name ? `${tab.$tab.find(".ci-stab-label").text()} · ${doc.customer_display_name}` : "");
		}

		close(key) {
			const tab = this.tabs.find((t) => t.key === key);
			if (!tab) {
				return;
			}
			const remove = () => {
				const i = this.tabs.indexOf(tab);
				this.tabs.splice(i, 1);
				tab.$tab.remove();
				tab.$view.remove();
				// Edits live on the cached document: drop it, so unsaved changes are
				// really discarded and the invoice reopens as saved
				if (tab.editor && frappe.get_doc(DOCTYPE, tab.editor.doc.name)) {
					frappe.model.remove_from_locals(DOCTYPE, tab.editor.doc.name);
				}
				this.persist();
				if (this.active === key) {
					const next = this.tabs[i] || this.tabs[i - 1];
					this.replace_route(next ? next.key : "list");
				}
			};
			if (tab.editor && tab.editor.dirty) {
				frappe.confirm(__("{0} has unsaved changes. Close it and lose them?", [esc(tab.$tab.find(".ci-stab-label").text())]), remove);
			} else {
				remove();
			}
		}

		// A new invoice was saved: its tab takes the invoice's name
		renamed(tab, old_key) {
			tab.key = tab.editor.doc.name;
			tab.$tab.attr("data-key", tab.key);
			tab.$view.attr("data-key", tab.key);
			if (this.active === old_key) {
				this.active = tab.key;
				this.replace_route(tab.key);
			}
			this.persist();
		}

		// Saved invoices open in tabs come back after a reload
		persist() {
			const names = this.tabs.filter((t) => !t.key.startsWith("new-")).map((t) => t.key);
			try {
				localStorage.setItem(storage_key(), JSON.stringify(names.slice(-10)));
			} catch (e) {
				// storage unavailable: tabs just don't come back
			}
		}

		restore() {
			let names = [];
			try {
				names = JSON.parse(localStorage.getItem(storage_key()) || "[]");
			} catch (e) {
				names = [];
			}
			(Array.isArray(names) ? names : []).forEach((name) => typeof name === "string" && this.add_tab(name));
		}

		async get_mobile_mandatory() {
			if (this.mobile_mandatory === null) {
				const r = await frappe.call({ method: "digitz_erp.selling.doctype.sales_invoice.sales_invoice.get_customer_mobile_number_mandatory" });
				this.mobile_mandatory = cint(r.message);
			}
			return this.mobile_mandatory;
		}
	};

	// ================================================================ list

	digitz_erp.InvoiceList = class InvoiceList {
		static PAGE = 50;

		constructor(host, $el) {
			this.host = host;
			this.$el = $el;
			this.range = "today";
			this.status = "";
			this.payment = "";
			this.search = "";
			this.rows = [];
			this.reload = frappe.utils.debounce(() => this.load(true), 300);
			this.make();
		}

		make() {
			const chips = (name, items, value) => `
				<div class="ci-chips" data-filter="${name}">
					${items.map(([v, label]) => `<button type="button" class="ci-chip${v === value ? " active" : ""}" data-value="${v}">${label}</button>`).join("")}
				</div>`;

			this.$el.html(`
				<div class="ci-list">
					<div class="ci-list-bar">
						<div class="ci-search">
							${frappe.utils.icon("search", "sm")}
							<input type="search" class="form-control" placeholder="${__("Search invoice no, customer, mobile or token")}" aria-label="${__("Search invoices")}">
						</div>
						<select class="form-control ci-range" aria-label="${__("Period")}">
							${[["today", __("Today")], ["week", __("This Week")], ["month", __("This Month")], ["30", __("Last 30 Days")], ["all", __("All")]]
								.map(([v, label]) => `<option value="${v}"${v === this.range ? " selected" : ""}>${label}</option>`).join("")}
						</select>
						${chips("status", [["", __("Any Status")], ["0", __("Draft")], ["1", __("Submitted")], ["2", __("Cancelled")]], this.status)}
						${chips("payment", [["", __("Cash & Credit")], ["cash", __("Cash")], ["credit", __("Credit")]], this.payment)}
						<span class="ci-list-count text-muted"></span>
					</div>
					<div class="ci-list-table"></div>
					<div class="ci-list-more" hidden>
						<button type="button" class="btn btn-default btn-sm">${__("Load more")}</button>
					</div>
				</div>
			`);

			this.$el.on("input", ".ci-search input", (e) => {
				this.search = e.currentTarget.value.trim();
				this.reload();
			});
			this.$el.on("change", ".ci-range", (e) => {
				this.range = e.currentTarget.value;
				this.load(true);
			});
			this.$el.on("click", ".ci-chip", (e) => {
				const $chip = $(e.currentTarget);
				const filter = $chip.closest(".ci-chips").attr("data-filter");
				this[filter] = $chip.attr("data-value");
				$chip.addClass("active").siblings().removeClass("active");
				this.load(true);
			});
			this.$el.on("click", "tr[data-name]", (e) => this.host.open_invoice($(e.currentTarget).attr("data-name")));
			this.$el.on("keydown", "tr[data-name]", (e) => {
				if (e.key === "Enter") {
					this.host.open_invoice($(e.currentTarget).attr("data-name"));
				}
			});
			this.$el.on("click", ".ci-list-more button", () => this.load(false));
		}

		show() {
			this.loaded ? this.paint_open() : this.load(true);
		}

		filters() {
			const today = frappe.datetime.get_today();
			const from = {
				today: today,
				week: frappe.datetime.week_start(),
				month: frappe.datetime.month_start(),
				30: frappe.datetime.add_days(today, -29),
			}[this.range];
			const filters = [];
			from && filters.push([DOCTYPE, "posting_date", ">=", from]);
			this.status !== "" && filters.push([DOCTYPE, "docstatus", "=", cint(this.status)]);
			this.payment && filters.push([DOCTYPE, "credit_sale", "=", this.payment === "credit" ? 1 : 0]);
			return filters;
		}

		async load(reset) {
			const seq = (this.seq = (this.seq || 0) + 1);
			const start = reset ? 0 : this.rows.length;
			const like = `%${this.search}%`;
			this.$el.addClass("is-loading");
			try {
				const r = await frappe.call({
					method: "frappe.client.get_list",
					args: {
						doctype: DOCTYPE,
						fields: ["name", "posting_date", "posting_time", "customer", "customer_name", "customer_display_name",
							"customer_mobile_number", "customer_token", "medical_service", "credit_sale", "payment_mode",
							"payment_status", "rounded_total", "docstatus"],
						filters: this.filters(),
						or_filters: this.search
							? ["name", "customer", "customer_display_name", "customer_mobile_number", "customer_token"].map((f) => [DOCTYPE, f, "like", like])
							: [],
						order_by: "posting_date desc, posting_time desc, creation desc",
						limit_start: start,
						limit_page_length: digitz_erp.InvoiceList.PAGE + 1,
					},
				});
				if (seq !== this.seq) {
					return;
				}
				const rows = r.message || [];
				const more = rows.length > digitz_erp.InvoiceList.PAGE;
				this.rows = (reset ? [] : this.rows).concat(rows.slice(0, digitz_erp.InvoiceList.PAGE));
				this.loaded = true;
				this.render(more);
			} finally {
				seq === this.seq && this.$el.removeClass("is-loading");
			}
		}

		render(more) {
			const $table = this.$el.find(".ci-list-table");
			this.$el.find(".ci-list-more").prop("hidden", !more);
			this.$el.find(".ci-list-count").text(
				this.rows.length ? __("{0} invoice(s){1}", [this.rows.length, more ? "+" : ""]) : ""
			);

			if (!this.rows.length) {
				$table.html(`
					<div class="ci-empty-list">
						<p>${this.search ? __("No invoices match your search.") : __("No invoices in this period.")}</p>
						<button type="button" class="btn btn-primary btn-sm ci-new">${__("New Invoice")}</button>
					</div>`);
				return;
			}

			const status = (row) => {
				const [label, colour] = [[__("Draft"), "orange"], [__("Submitted"), "green"], [__("Cancelled"), "red"]][row.docstatus] || ["", "gray"];
				return `<span class="indicator-pill ${colour}">${label}</span>`;
			};
			const time = (row) => (row.posting_time ? moment(String(row.posting_time), "HH:mm:ss").format("HH:mm") : "");

			$table.html(`
				<div class="ci-scroll">
					<table class="ci-table ci-table-list">
						<thead><tr>
							<th>${__("Invoice")}</th><th>${__("Date")}</th><th>${__("Customer")}</th><th>${__("Mobile")}</th>
							<th>${__("Token / Service")}</th><th>${__("Payment")}</th><th class="ci-num">${__("Total")}</th><th>${__("Status")}</th>
						</tr></thead>
						<tbody>${this.rows.map((row) => `
							<tr data-name="${esc(row.name)}" tabindex="0">
								<td class="ci-strong ci-nowrap"><span class="ci-open-mark" title="${__("Open in a tab")}"></span>${esc(row.name)}</td>
								<td class="ci-nowrap">${frappe.datetime.str_to_user(row.posting_date)} <span class="text-muted">${time(row)}</span></td>
								<td><div class="ci-ellipsis">${esc(row.customer_display_name || row.customer_name || row.customer)}</div>
									${row.customer_display_name && row.customer_display_name !== row.customer ? `<div class="ci-sub ci-ellipsis">${esc(row.customer)}</div>` : ""}</td>
								<td class="ci-nowrap">${esc(row.customer_mobile_number)}</td>
								<td><div class="ci-ellipsis">${esc(row.customer_token)}</div><div class="ci-sub ci-ellipsis">${esc(row.medical_service)}</div></td>
								<td>${row.credit_sale ? `<span class="ci-tag ci-tag-credit">${__("Credit")}</span>` : `<span class="ci-tag">${esc(row.payment_mode || row.payment_status || __("Cash"))}</span>`}</td>
								<td class="ci-num ci-strong">${money(row.rounded_total)}</td>
								<td>${status(row)}</td>
							</tr>`).join("")}
						</tbody>
					</table>
				</div>`);
			this.paint_open();
		}

		// Marks the invoices that are open in a tab
		paint_open() {
			const open = new Set(this.host.tabs.map((t) => t.key));
			this.$el.find("tr[data-name]").each((_, tr) => tr.classList.toggle("is-open", open.has(tr.dataset.name)));
		}
	};

	// ============================================================== editor

	digitz_erp.InvoiceEditor = class InvoiceEditor {
		constructor(host, tab, doc) {
			this.host = host;
			this.tab = tab;
			this.doc = doc;
			this.dirty = !!doc.__islocal;
			this.settings = { allow_edit_sales_invoice_no: 0, hidden_fields: [] };
			this.controls = {};
			this.row_controls = {};
			this.walk_in = false;
			this.$el = tab.$view;
		}

		// ------------------------------------------------------------ lifecycle

		// What the form's onload (assign_defaults) does for a new invoice
		async init_new() {
			this.tab.$view.html(`<div class="ci-loading">${__("Preparing a new invoice...")}</div>`);
			try {
				const settings = await E().company_defaults(this.doc);
				if (settings) {
					this.settings = settings;
				}
			} catch (err) {
				// As the form: a user who cannot read Global Settings / Company gets
				// no company defaults (the server reports the permission error)
				console.error("Error loading Sales Invoice company defaults:", err);
			}
			// Never a credit sale by default; the payment mode as for the customer
			await this.set_default_payment_mode();
			this.render();
		}

		async reload() {
			frappe.model.remove_from_locals(DOCTYPE, this.doc.name);
			await frappe.model.with_doc(DOCTYPE, this.doc.name);
			this.doc = frappe.get_doc(DOCTYPE, this.doc.name);
			this.dirty = false;
			this.render();
		}

		on_show() {
			// Nothing to refresh on a draft being edited; a saved one may have
			// changed elsewhere (submitted from the form, paid by a receipt)
			this.update_stock_hint();
		}

		is_editable() {
			return this.doc.docstatus === 0 && !this.doc.tab_sales && !linked_to(this.doc).length
				&& !(today_only() && other_day(this.doc));
		}

		visible(fieldname) {
			const df = frappe.meta.get_docfield(DOCTYPE, fieldname);
			if (!df || this.settings.hidden_fields.includes(fieldname)) {
				return false;
			}
			// The form shows these itself when they apply
			if (fieldname === "credit_days") {
				return !!this.doc.credit_sale;
			}
			if (fieldname === "sales_inv_no") {
				return !!this.settings.allow_edit_sales_invoice_no;
			}
			return !cint(df.hidden);
		}

		// ------------------------------------------------------------ render

		render() {
			this.controls = {};
			this.row_controls = {};
			const doc = this.doc;
			const editable = this.is_editable();

			this.$el.html(`
				<div class="ci-editor${editable ? "" : " is-readonly"}">
					<div class="ci-banners"></div>
					<header class="ci-head">
						<div class="ci-head-main">
							<h3 class="ci-docname"></h3>
							<span class="ci-status indicator-pill"></span>
							<div class="ci-head-meta"></div>
						</div>
						<div class="ci-actions"></div>
					</header>
					<div class="ci-layout">
						<div class="ci-main">
							<section class="ci-card ci-card-customer">
								<div class="ci-fields ci-fields-customer-main"></div>
								<div class="ci-cust-foot">
									<button type="button" class="ci-cust-toggle" aria-expanded="false">
										${frappe.utils.icon("down", "xs")}
										<span class="ci-strong">${__("Customer details")}</span>
										<span class="ci-cust-summary text-muted">${__("Email, company & TRN, address, salesman, token")}</span>
									</button>
									<div class="ci-cust-chips">
										<span class="ci-chip-info ci-token" hidden></span>
										<span class="ci-balance" hidden></span>
									</div>
								</div>
								<div class="ci-cust-body" hidden>
									<div class="ci-fields ci-fields-customer"></div>
								</div>
							</section>
							<section class="ci-card ci-card-items">
								<div class="ci-items-bar">
									<div class="ci-item-search"></div>
									<button type="button" class="btn btn-primary btn-sm ci-pay-btn" title="${__("Payment (Alt+P)")}">${__("Payment")}</button>
									<button type="button" class="ci-pay-info" title="${__("Payment (Alt+P)")}"></button>
									<span class="ci-count"></span>
								</div>
								<div class="ci-scroll"><table class="ci-table ci-items">
									<thead><tr>
										<th class="ci-col-item">${__("Item")}</th>
										<th class="ci-num">${__("Qty")}</th>
										<th class="ci-num" title="${__("Service Charge + Typing Charges + Transaction Charges + GOV")}">${__("Rate")}</th>
										<th class="ci-num">${__("Service Charges")}</th>
										<th class="ci-num">${__("GOV")}</th>
										<th class="ci-num">${__("Typing Charges")}</th>
										<th class="ci-num">${__("Transaction Charges")}</th>
										<th class="ci-num">${__("VAT")}</th>
										<th class="ci-num">${__("Net")}</th>
										<th></th>
									</tr></thead>
									<tbody></tbody>
								</table></div>
								<div class="ci-stock-hint text-muted"></div>
							</section>
							<!-- Total under the items. Payment is the summary and popup in the items bar -->
							<div class="ci-side">
								<section class="ci-card ci-card-total">
									<div class="ci-total-label">${__("Total")}</div>
									<div class="ci-total-value"></div>
									<div class="ci-total-words text-muted"></div>
									<div class="ci-sums"></div>
								</section>
							</div>
							<section class="ci-card ci-card-more">
								<button type="button" class="ci-more-toggle" aria-expanded="false">
									<h4>${__("More Details")}</h4>
									<span class="ci-more-hint text-muted">${__("Date & time, price list, remarks")}</span>
									${frappe.utils.icon("down", "sm")}
								</button>
								<div class="ci-more-body" hidden>
									<div class="ci-fields ci-fields-more"></div>
									<div class="ci-info"></div>
								</div>
							</section>
						</div>
					</div>
				</div>
			`);

			// The customer row holds what every invoice needs; the rest folds away
			this.make_fields(".ci-fields-customer-main", ["customer", "customer_display_name", "customer_mobile_number"]);
			this.make_fields(".ci-fields-customer", [
				"customer_email", "customer_token", "customer_company", "tax_id",
				["customer_address", { span: 2 }], "salesman", "medical_service",
			]);
			this.make_fields(".ci-fields-more", [
				"edit_posting_date_and_time", "posting_date", "posting_time", "naming_series", "sales_inv_no",
				// Update Stock, Cost Center, LPO and Update Rates In Price List are not used at the counter: their
				// values (defaults included) are kept, just not shown
				"price_list", "rate_includes_tax",
				["remarks", { span: 2 }], ["reason_for_unfilled_invoice", { span: 2 }],
			]);
			this.make_item_search();
			this.bind();
			this.render_rows();
			this.refresh();
			this.load_files();

			if (doc.customer && editable) {
				// Company / TRN are typed in only for the walk-in customer
				E().customer_billing_details(doc.customer).then((d) => {
					this.walk_in = !!d.is_walk_in;
					this.refresh_states();
				});
			}

			// A new invoice starts in Customer
			if (editable && !doc.customer) {
				setTimeout(() => this.focus_field("customer"), 50);
			}
		}

		toggle_customer_details(open) {
			const $btn = this.$el.find(".ci-cust-toggle");
			open = open === undefined ? $btn.attr("aria-expanded") !== "true" : open;
			$btn.attr("aria-expanded", open ? "true" : "false");
			this.$el.find(".ci-cust-body").prop("hidden", !open);
		}

		// Controls from the doctype's own field definitions, bound to the document
		make_fields(selector, fields) {
			const $wrap = this.$el.find(selector);
			fields.forEach((entry) => {
				const [fieldname, opts] = Array.isArray(entry) ? entry : [entry, {}];
				const meta_df = frappe.meta.get_docfield(DOCTYPE, fieldname);
				if (!meta_df) {
					return;
				}
				const df = Object.assign({}, meta_df, {
					hidden: 0, depends_on: null, mandatory_depends_on: null, read_only_depends_on: null,
					change: () => this.on_change(fieldname),
				});
				df.get_query = this.query_for(fieldname);
				const $cell = $(`<div class="ci-field${opts.span ? " ci-span-2" : ""}" data-fieldname="${fieldname}"></div>`).appendTo($wrap);
				const control = frappe.ui.form.make_control({ df, parent: $cell, render_input: true, doc: this.doc });
				control.refresh();
				compact_textarea(control);
				this.controls[fieldname] = control;
			});
		}

		// The form's set_query filters
		query_for(fieldname) {
			const doc = () => this.doc;
			return {
				customer: () => ({ filters: { disabled: 0 } }),
				salesman: () => ({ filters: { disabled: 0, status: ["!=", "On Boarding"] } }),
				price_list: () => ({ filters: { is_selling: 1 } }),
				ship_to_location: () => ({ filters: { parent: doc().customer } }),
				warehouse: () => ({ filters: { disabled: 0 } }),
			}[fieldname];
		}

		make_item_search() {
			const $wrap = this.$el.find(".ci-item-search");
			if (!this.is_editable()) {
				$wrap.remove();
				this.$el.find(".ci-pay-btn").remove();
				this.$el.find(".ci-pay-info").prop("disabled", true);
				return;
			}
			this.item_search = frappe.ui.form.make_control({
				parent: $wrap,
				df: {
					fieldtype: "Link", fieldname: "item_search", options: "Item",
					placeholder: __("Search an item"),
					get_query: () => ({ filters: { item_type: ["not in", ["Labour"]] } }),
					change: () => {
						const value = this.item_search.get_value();
						if (value) {
							this.item_search.set_value("");
							this.add_item(value);
						}
					},
				},
				render_input: true,
			});
			this.item_search.refresh();
			this.item_search.$wrapper.find(".control-label").remove();
		}

		bind() {
			// render() runs on every load, save and reload and calls this again: drop
			// the previous handlers first, or one click would run once per render
			// (several Print requests at once fought over the same PDF files).
			this.$el.off();
			this.$el.on("click", ".ci-pay-btn, .ci-pay-info", () => this.open_payment_dialog());
			this.$el.on("click", ".ci-cust-toggle", () => this.toggle_customer_details());
			this.$el.on("click", ".ci-more-toggle", (e) => {
				const $btn = $(e.currentTarget);
				const open = $btn.attr("aria-expanded") !== "true";
				$btn.attr("aria-expanded", open ? "true" : "false");
				this.$el.find(".ci-more-body").prop("hidden", !open);
			});

			// Item rows
			this.$el.on("change", ".ci-items input[data-f]", (e) => this.on_row_input(e.currentTarget));
			this.$el.on("keydown", ".ci-items input[data-f]", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					e.currentTarget.blur();
				}
			});
			this.$el.on("focus", ".ci-items input[data-f]", (e) => e.currentTarget.select());
			this.$el.on("click", ".ci-row-del", (e) => this.remove_row($(e.currentTarget).closest("tr").attr("data-row")));
			this.$el.on("click", ".ci-row-more", (e) => this.open_row_dialog($(e.currentTarget).closest("tr").attr("data-row")));

			// Actions
			this.$el.on("click", "[data-action]", (e) => {
				e.preventDefault();
				this.action($(e.currentTarget).attr("data-action"));
			});
		}

		// ------------------------------------------------------------ refresh

		refresh() {
			this.refresh_head();
			this.refresh_states();
			this.refresh_values();
			this.refresh_rows();
			this.refresh_totals();
			this.render_schedule();
			this.refresh_banners();
			this.host.paint(this.tab);
		}

		refresh_head() {
			const doc = this.doc;
			const [label, colour] = doc.__islocal
				? [__("Not Saved"), "orange"]
				: [[__("Draft"), "orange"], [__("Submitted"), "green"], [__("Cancelled"), "red"]][doc.docstatus];
			this.$el.find(".ci-docname").text(doc.__islocal ? __("New Sales Invoice") : doc.name);
			this.$el.find(".ci-status").attr("class", `ci-status indicator-pill ${this.dirty && !doc.__islocal ? "orange" : colour}`)
				.text(this.dirty && !doc.__islocal ? __("Not Saved") : label);

			const meta = [
				`${frappe.utils.icon("calendar", "xs")} ${frappe.datetime.str_to_user(doc.posting_date)} ${doc.posting_time ? moment(String(doc.posting_time), "HH:mm:ss").format("HH:mm") : ""}`,
			];
			doc.counter && meta.push(`${esc(doc.counter)}${doc.counter_session ? ` · ${esc(doc.counter_session)}` : ""}`);
			doc.payment_status && !doc.__islocal && meta.push(esc(doc.payment_status));
			doc.amended_from && meta.push(__("Amended from {0}", [esc(doc.amended_from)]));
			this.$el.find(".ci-head-meta").html(meta.map((m) => `<span>${m}</span>`).join(""));

			this.render_actions();
		}

		render_actions() {
			const doc = this.doc;
			const saved = !doc.__islocal;
			const manager = frappe.user.has_role("Management");
			const can_revert = ["Administrator", "it-admin"].includes(frappe.session.user) || manager;
			const btn = (action, label, cls = "btn-default", icon = "") =>
				`<button type="button" class="btn btn-sm ${cls}" data-action="${action}">${icon ? frappe.utils.icon(icon, "sm") : ""}<span>${label}</span></button>`;
			const item = (action, label) => `<li><a class="dropdown-item" href="#" data-action="${action}">${label}</a></li>`;

			const buttons = [];
			const menu = [];

			if (this.is_editable()) {
				buttons.push(btn("save", __("Save"), saved && !this.dirty ? "btn-default" : "btn-primary", "check"));
				saved && !this.dirty && buttons.push(btn("submit", __("Submit"), "btn-primary"));
			}
			// A submitted credit sale not yet fully paid: take the payment here
			// (public/js/cashier_receipts.js), as a Receipt Entry
			this.can_record_payment() && buttons.push(btn("record-payment", __("Record Payment"), "btn-primary"));
			if (saved) {
				// One Print menu. Print sends the PDF straight to the printer (no dialog
				// where Chrome runs with --kiosk-printing); Preview shows it in a popup.
				// A receipt exists for a cash sale, and for a credit sale once a receipt
				// has paid it, so its two entries show only then.
				const has_receipt = !cint(doc.credit_sale) || !!doc.allocated_receipt_entry;
				!this.dirty && buttons.push(`
					<div class="btn-group">
						<button type="button" class="btn btn-sm btn-default dropdown-toggle" data-toggle="dropdown" aria-expanded="false">
							${frappe.utils.icon("printer", "sm")}<span>${__("Print")}</span>
						</button>
						<ul class="dropdown-menu dropdown-menu-right">
							${item("print-invoice", __("Print Invoice"))}
							${item("preview-invoice", __("Preview Invoice"))}
							${has_receipt ? `<li class="dropdown-divider ci-menu-divider" role="separator"></li>
								${item("print-receipt", __("Print Receipt"))}
								${item("preview-receipt", __("Preview Receipt"))}` : ""}
						</ul>
					</div>`);

				doc.docstatus === 1 && menu.push(item("cancel", __("Cancel")));
				doc.docstatus === 2 && menu.push(item("amend", __("Amend")));
				doc.docstatus === 0 && menu.push(item("delete", __("Delete")));
				doc.docstatus === 1 && can_revert && menu.push(item("revert", __("Revert To Draft")));
				if (doc.docstatus === 1 && manager) {
					menu.push(item("gl", __("General Ledgers")), item("stock", __("Stock Ledgers")));
				}
				menu.push(item("reload", __("Reload")), item("form", __("Open in Standard Form")));
			}
			if (menu.length) {
				buttons.push(`
					<div class="btn-group">
						<button type="button" class="btn btn-sm btn-default dropdown-toggle ci-menu" data-toggle="dropdown" aria-expanded="false" aria-label="${__("More actions")}">
							${frappe.utils.icon("dot-horizontal", "sm")}
						</button>
						<ul class="dropdown-menu dropdown-menu-right">${menu.join("")}</ul>
					</div>`);
			}
			this.$el.find(".ci-actions").html(buttons.join(""));
		}

		// Visibility and read-only state, which depend on the document
		refresh_states() {
			const doc = this.doc;
			const editable = this.is_editable();
			const credit = cint(doc.credit_sale);
			const bank = doc.mode === "Bank";
			const cash = !credit && doc.payment_mode_type === "Cash";

			const shown = {
				payment_mode: !credit,
				payment_account: !credit,
				reference_no: bank,
				received_amount: cash,
				reason_for_unfilled_invoice: !doc.invoice_fullfilled,
			};
			const cashier = today_only();
			const read_only = {
				edit_posting_date_and_time: cashier,
				posting_date: cashier || !cint(doc.edit_posting_date_and_time),
				posting_time: cashier || !cint(doc.edit_posting_date_and_time),
				customer_company: !this.walk_in,
				tax_id: !this.walk_in,
				naming_series: !doc.__islocal,
			};
			const reqd = {
				reference_no: bank,
				received_amount: cash,
				customer_mobile_number: !!this.host.mobile_mandatory,
			};

			Object.entries(this.controls).forEach(([fieldname, control]) => {
				const meta_df = frappe.meta.get_docfield(DOCTYPE, fieldname);
				control.df.read_only = !editable || cint(meta_df.read_only) || read_only[fieldname] ? 1 : 0;
				// Like the form: a read-only field with nothing in it is not shown
				const value = doc[fieldname];
				const empty = control.df.read_only && meta_df.fieldtype !== "Check" && (value === undefined || value === null || value === "");
				const visible = this.visible(fieldname) && (shown[fieldname] === undefined || shown[fieldname]) && !empty;
				control.$wrapper.closest(".ci-field").prop("hidden", !visible);
				control.df.reqd = cint(meta_df.reqd) || reqd[fieldname] ? 1 : 0;
			});

			this.refresh_pay_info();
		}

		// How the invoice is paid, in one line beside the Payment button
		refresh_pay_info() {
			const doc = this.doc;
			const credit = cint(doc.credit_sale);
			const cash = !credit && doc.payment_mode_type === "Cash";
			const part = (label, value, cls = "") => `<span class="ci-pay-part ${cls}"><span>${label}</span><b>${value}</b></span>`;
			const parts = [];

			if (credit) {
				parts.push(`<span class="ci-pay-mode is-credit">${__("Credit Sale")}</span>`);
				const due = (doc.receipt_schedule || []).map((r) => r.date).filter(Boolean).sort().pop();
				due && parts.push(part(__("Due"), frappe.datetime.str_to_user(due)));
			} else if (doc.payment_mode) {
				parts.push(`<span class="ci-pay-mode">${esc(doc.payment_mode)}</span>`);
				doc.payment_account && parts.push(`<span class="ci-pay-part ci-pay-account">${esc(doc.payment_account)}</span>`);
				if (cash) {
					parts.push(part(__("Received"), money(doc.received_amount)));
					flt(doc.received_amount) && parts.push(part(__("Change"), money(doc.balance_amount), flt(doc.balance_amount) < 0 ? "is-short" : ""));
				}
				if (doc.mode === "Bank") {
					doc.reference_no && parts.push(part(__("Ref"), esc(doc.reference_no)));
				}
			} else {
				parts.push(`<span class="ci-pay-mode is-missing">${__("No payment mode")}</span>`);
			}
			this.$el.find(".ci-pay-info").html(parts.join(""));
		}

		refresh_values() {
			Object.values(this.controls).forEach((control) => {
				control.doc = this.doc;
				if (control.$input && control.$input.is(":focus")) {
					return;
				}
				control.refresh();
			});
		}

		refresh_banners() {
			const doc = this.doc;
			const banners = [];
			const links = linked_to(doc);
			if (links.length) {
				banners.push(["blue", __("This invoice is linked to {0}. Invoices with Sales Order, Quotation, Delivery Note or Project links are edited in the standard form.", [links.map(esc).join(", ")]), "form", __("Open in Standard Form")]);
			}
			if (doc.tab_sales) {
				banners.push(["blue", __("Created from Tab Sales {0}. Change it from the Tab Sale.", [esc(doc.tab_sales)])]);
			}
			if (doc.docstatus === 0 && E().is_placeholder_mobile(doc.customer_mobile_number)) {
				banners.push(["orange", __("Mobile number {0} is a placeholder. Enter the customer's real mobile number before submitting.", [esc(doc.customer_mobile_number)])]);
			}
			if (doc.docstatus === 2) {
				banners.push(["red", __("This invoice is cancelled. Amend it to make a corrected copy."), "amend", __("Amend")]);
			}
			if (today_only() && other_day(doc)) {
				banners.push(["orange", __("This draft is dated {0}. A cashier can save and submit only today's invoices: ask a supervisor to handle it.", [frappe.datetime.str_to_user(doc.posting_date)])]);
			}
			this.$el.find(".ci-banners").html(banners.map(([tone, text, action, label]) => `
				<div class="ci-banner ci-banner-${tone}">
					<span>${text}</span>
					${action ? `<button type="button" class="btn btn-xs btn-default" data-action="${action}">${label}</button>` : ""}
				</div>`).join(""));
		}

		refresh_totals() {
			const doc = this.doc;
			this.$el.find(".ci-total-value").text(money(doc.rounded_total));
			this.$el.find(".ci-total-words").text(doc.in_words && !this.dirty ? doc.in_words : "");

			const line = (label, value, cls = "") => `<div class="ci-sum ${cls}"><span>${label}</span><span>${value}</span></div>`;
			const sums = [line(__("Gross"), money(doc.gross_total))];
			flt(doc.total_discount_in_line_items) && sums.push(line(__("Line Discounts"), "− " + money(doc.total_discount_in_line_items)));
			flt(doc.additional_discount) && sums.push(line(__("Additional Discount"), "− " + money(doc.additional_discount)));
			sums.push(line(__("Taxable"), money(doc.taxable_total)));
			sums.push(line(cint(doc.rate_includes_tax) ? __("VAT (included)") : __("VAT"), money(doc.tax_total)));
			flt(doc.round_off) && sums.push(line(__("Round Off"), `${flt(doc.round_off) < 0 ? "−" : "+"} ${money(Math.abs(flt(doc.round_off)))}`));
			this.$el.find(".ci-sums").html(sums.join(""));

			// Received and Change follow the total
			this.refresh_pay_info();
			const balance_text = doc.customer_balance ? __("Balance {0}", [money(doc.customer_balance)]) : "";
			this.$el.find(".ci-balance").text(balance_text).prop("hidden", !balance_text);
			const token = [doc.customer_token && __("Token {0}", [doc.customer_token]), doc.medical_service].filter(Boolean).join(" · ");
			this.$el.find(".ci-token").text(token).prop("hidden", !token);
		}

		// ------------------------------------------------------------- items

		render_rows() {
			const editable = this.is_editable();
			const items = this.doc.items || [];
			const input = (row, f) => editable
				? `<input type="text" inputmode="decimal" class="ci-input" data-row="${row.name}" data-f="${f}" aria-label="${esc(frappe.meta.get_label(ITEM_DOCTYPE, f))}">`
				: `<span data-show="${f}"></span>`;

			this.$el.find(".ci-items tbody").html(items.length ? items.map((row) => `
				<tr data-row="${row.name}">
					<td class="ci-col-item">
						<div class="ci-item-name"></div>
						<div class="ci-sub"><span class="ci-item-code"></span><span class="ci-tax-badge"></span></div>
					</td>
					<td class="ci-num" data-label="${__("Qty")}">${input(row, "qty")}</td>
					<td class="ci-num ci-strong" data-label="${__("Rate")}"><span data-show="rate"></span></td>
					<td class="ci-num" data-label="${__("Service Charges")}">${input(row, "service_charge")}</td>
					<td class="ci-num" data-label="${__("GOV")}">${input(row, "gov")}</td>
					<td class="ci-num" data-label="${__("Typing Charges")}">${input(row, "typing_charges")}</td>
					<td class="ci-num" data-label="${__("Transaction Charges")}">${input(row, "transaction_charges")}</td>
					<td class="ci-num" data-label="${__("VAT")}"><span data-show="tax_amount"></span></td>
					<td class="ci-num ci-strong" data-label="${__("Net")}"><span data-show="net_amount"></span></td>
					<td class="ci-row-actions">
						<button type="button" class="btn btn-xs btn-default ci-row-more" title="${__("Row details")}" aria-label="${__("Row details")}">${frappe.utils.icon("edit", "xs")}</button>
						${editable ? `<button type="button" class="btn btn-xs btn-default ci-row-del" title="${__("Remove")}" aria-label="${__("Remove row")}">${frappe.utils.icon("delete", "xs")}</button>` : ""}
					</td>
				</tr>
				`).join("")
				: `<tr class="ci-items-empty"><td colspan="10">${editable ? __("No items yet. Search for an item above to add it.") : __("No items.")}</td></tr>`);
			this.row_controls = {};
		}

		// Numbers in the rows, without disturbing the input being typed in
		refresh_rows() {
			const items = this.doc.items || [];
			this.$el.find(".ci-count").text(items.length ? __("{0} line(s)", [items.length]) : "");
			items.forEach((row) => {
				const $tr = this.$el.find(`tr[data-row="${row.name}"]`);
				if (!$tr.length) {
					return;
				}
				$tr.find(".ci-item-name").text(row.display_name || row.item_name || row.item || "");
				$tr.find(".ci-item-code").text(row.item || "");
				$tr.find(".ci-tax-badge").html(
					cint(row.tax_excluded) || !flt(row.tax_rate)
						? `<span class="ci-tag">${__("No VAT")}</span>`
						: `<span class="ci-tag ci-tag-vat">${__("VAT {0}%", [flt(row.tax_rate)])}</span>`
				);
				$tr.find("input[data-f]").each((_, el) => {
					if (document.activeElement !== el) {
						el.value = num(row[el.dataset.f]);
					}
				});
				$tr.find("[data-show]").each((_, el) => {
					el.textContent = num(row[el.dataset.show]);
				});
				Object.values(this.row_controls[row.name] || {}).forEach((c) => c.refresh());
				// The row's edit popup, if open (render_rows may have reset row_controls)
				this.row_dialog && this.row_dialog.rowname === row.name
					&& Object.values(this.row_dialog.controls).forEach((c) => c.refresh());
			});
		}

		// A line's details (item, display name, charges, tax) in a popup. The fields
		// are bound to the line, so a change applies at once, as typing in the grid.
		open_row_dialog(rowname) {
			const row = (this.doc.items || []).find((r) => r.name === rowname);
			if (!row) {
				return;
			}
			const d = new frappe.ui.Dialog({
				title: row.display_name || row.item_name || row.item || __("Item"),
				size: "large",
				fields: [{ fieldtype: "HTML", fieldname: "fields" }],
				primary_action_label: __("Done"),
				primary_action: () => d.hide(),
			});
			// The console's colours for the fields
			d.$wrapper.addClass("ci-pay-dialog");
			const $wrap = $(`<div class="ci-fields ci-fields-row"></div>`).appendTo(d.fields_dict.fields.$wrapper);
			this.make_row_controls(rowname, $wrap);
			this.row_dialog = { rowname, controls: this.row_controls[rowname] || {} };
			d.onhide = () => {
				this.row_dialog = null;
				delete this.row_controls[rowname];
				this.refresh();
			};
			d.show();
		}

		make_row_controls(rowname, $wrap) {
			const row = (this.doc.items || []).find((r) => r.name === rowname);
			if (!row) {
				return;
			}
			const editable = this.is_editable();
			const controls = {};
			const queries = {
				item: () => ({ filters: { item_type: ["not in", ["Labour"]] } }),
				warehouse: () => ({ filters: { disabled: 0 } }),
			};
			// Item with its Display Name beside it, then the charges, then tax.
			// Warehouse is not shown: a line keeps the invoice's warehouse.
			["item", "display_name", "service_charge", "typing_charges", "transaction_charges", "gov", "tax", "tax_excluded"].forEach((fieldname) => {
				const meta_df = frappe.meta.get_docfield(ITEM_DOCTYPE, fieldname);
				const df = Object.assign({}, meta_df, {
					hidden: 0, read_only: editable ? cint(meta_df.read_only) : 1,
					depends_on: null, mandatory_depends_on: null,
					change: () => this.on_row_change(row, fieldname),
				});
				queries[fieldname] && (df.get_query = queries[fieldname]);
				const $cell = $(`<div class="ci-field${fieldname === "display_name" ? " ci-span-2" : ""}"></div>`).appendTo($wrap);
				const control = frappe.ui.form.make_control({ df, parent: $cell, render_input: true, doc: row });
				control.refresh();
				compact_textarea(control);
				controls[fieldname] = control;
			});
			this.row_controls[rowname] = controls;
		}

		// A number typed in a row
		on_row_input(input) {
			const row = (this.doc.items || []).find((r) => r.name === input.dataset.row);
			if (!row) {
				return;
			}
			const f = input.dataset.f;
			row[f] = flt(input.value);
			this.mark_dirty();

			// Service Charges, GOV, Typing or Transaction Charges: Rate is their sum, rebuilt by recalc
			this.recalc();
			input.value = num(row[f]);
		}

		// The form's Sales Invoice Item events, for the row-detail fields
		async on_row_change(row, fieldname) {
			this.mark_dirty();
			if (fieldname === "item") {
				if (!row.item) {
					return;
				}
				await this.load_item(row);
			} else if (fieldname === "tax_excluded") {
				if (row.tax_excluded) {
					row.tax = "";
					row.tax_rate = 0;
					this.recalc();
				}
			} else if (fieldname === "tax") {
				if (!row.tax_excluded && row.tax) {
					await E().load_tax_rate(row);
					this.recalc();
				}
			} else if (fieldname === "warehouse") {
				this.stock_item = { item: row.item, warehouse: row.warehouse };
				this.update_stock_hint();
			} else if (["service_charge", "typing_charges", "transaction_charges", "gov"].includes(fieldname)) {
				// As the form's Sales Invoice Item events for the charges
				this.recalc();
			} else if (fieldname === "display_name") {
				this.refresh_rows();
			}
		}

		add_item(item_code) {
			if (!this.doc.customer) {
				frappe.msgprint(__("Select customer."));
				return;
			}
			// What the form's items_add does
			const row = frappe.model.add_child(this.doc, ITEM_DOCTYPE, "items");
			if (this.doc.default_cost_center) {
				row.cost_center = this.doc.default_cost_center;
			}
			row.warehouse = this.doc.warehouse;
			row.item = item_code;
			this.mark_dirty();
			this.render_rows();
			this.recalc();
			this.load_item(row);
		}

		async load_item(row) {
			const r = await E().load_item(this.doc, row);
			if (!r.found) {
				return;
			}
			r.advance_message && frappe.show_alert(r.advance_message);
			this.stock_item = { item: row.item, warehouse: row.warehouse };
			this.update_stock_hint();
			// Charges from the price list when it has a price for the item, else the Item master
			await this.apply_charges([row]);
		}

		remove_row(rowname) {
			const row = (this.doc.items || []).find((r) => r.name === rowname);
			if (!row) {
				return;
			}
			this.doc.items = this.doc.items.filter((r) => r !== row);
			this.doc.items.forEach((r, i) => (r.idx = i + 1));
			frappe.model.remove_from_locals(ITEM_DOCTYPE, rowname);
			this.mark_dirty();
			this.render_rows();
			this.recalc();
		}

		async update_stock_hint() {
			const target = this.stock_item;
			const $hint = this.$el.find(".ci-stock-hint");
			if (!target || !target.item || !target.warehouse) {
				$hint.text("");
				return;
			}
			const r = await frappe.call({
				method: "frappe.client.get_value",
				args: { doctype: "Stock Balance", filters: { item: target.item, warehouse: target.warehouse }, fieldname: ["stock_qty"] },
			});
			if (this.stock_item === target) {
				$hint.text(r.message && r.message.stock_qty !== undefined
					? __("Stock balance: {0} of {1} at {2}", [r.message.stock_qty, target.item, target.warehouse])
					: "");
			}
		}

		// ---------------------------------------------------------- calculation

		recalc() {
			E().calculate(this.doc);
			E().fill_receipt_schedule(this.doc);
			E().set_cash_balance(this.doc);
			this.refresh_rows();
			this.refresh_totals();
			this.render_schedule();
			this.refresh_states();
			this.refresh_values();
		}

		async apply_charges(rows) {
			if (this.doc.docstatus !== 0) {
				return;
			}
			const rate_only = await E().apply_item_charges(this.doc, rows);
			E().rate_only_alert(this.doc, rate_only);
			this.recalc();
		}

		// ------------------------------------------------------- field changes

		mark_dirty() {
			if (!this.dirty) {
				this.dirty = true;
				this.refresh_head();
				this.host.paint(this.tab);
			}
		}

		// The form's Sales Invoice events, for fields changed on screen
		async on_change(fieldname) {
			this.mark_dirty();
			const doc = this.doc;

			switch (fieldname) {
				case "customer":
					await this.on_customer();
					// The walk-in customer needs the applicant's company and TRN typed in
					this.walk_in && this.toggle_customer_details(true);
					break;
				case "payment_mode":
					await this.on_payment_mode();
					break;
				case "credit_sale":
					await this.set_default_payment_mode();
					E().fill_receipt_schedule(doc, true);
					E().set_cash_balance(doc);
					break;
				case "credit_days":
					// As the form: the schedule is rebuilt with the new due date
					E().fill_receipt_schedule(doc, true);
					break;
				case "price_list":
					await this.apply_charges();
					break;
				case "received_amount":
					E().set_cash_balance(doc);
					break;
				case "additional_discount":
					this.recalc();
					break;
				case "rate_includes_tax":
					// As the form: confirm, then work every line's tax out again. Saying
					// no puts the setting back, so the amounts never disagree with it.
					await new Promise((resolve) => {
						frappe.confirm(
							__("Are you sure you want to change this setting which will change the tax calculation in the line items ?"),
							() => {
								this.recalc();
								resolve();
							},
							() => {
								doc.rate_includes_tax = cint(doc.rate_includes_tax) ? 0 : 1;
								resolve();
							}
						);
					});
					break;
			}
			this.refresh();

			// Customer chosen: on to the items
			if (fieldname === "customer" && doc.customer && !(doc.items || []).length && this.item_search) {
				this.item_search.$input && this.item_search.$input.trigger("focus");
			}
		}

		// What the form does when a customer is picked
		async on_customer() {
			const doc = this.doc;
			if (!doc.customer) {
				return;
			}
			const c = await read_values("Customer", doc.customer,
				["customer_name", "full_address", "salesman", "credit_days", "address_line_1", "address_line_2", "area_name",
					"country", "default_price_list", "mobile_no"]);

			// fetch_from / add_fetch on the form
			Object.assign(doc, {
				customer_name: c.customer_name, customer_address: c.full_address, salesman: c.salesman,
				credit_days: c.credit_days, address_line_1: c.address_line_1, address_line_2: c.address_line_2,
				area_name: c.area_name, country: c.country,
			});

			// An invoice raised from a token carries the patient's own name and mobile
			if (!doc.customer_token) {
				doc.customer_display_name = doc.customer_name;
				doc.customer_mobile_number = c.mobile_no || "";
			}

			const [details, balance, terms] = await Promise.all([
				E().customer_billing_details(doc.customer),
				E().party_balance(doc.customer),
				E().customer_terms(doc.customer),
			]);
			this.walk_in = !!details.is_walk_in;
			doc.customer_company = details.customer_company || "";
			doc.tax_id = details.tax_id || "";
			doc.customer_balance = balance;
			terms.template_name && (doc.terms = terms.template_name);
			terms.terms && (doc.terms_and_conditions = terms.terms);

			await this.set_default_payment_mode();

			// The customer's price list prices the lines; without one, the Item master
			const price_list = c.default_price_list || "";
			if (price_list !== (doc.price_list || "")) {
				doc.price_list = price_list;
				await this.apply_charges();
			}
			E().fill_receipt_schedule(doc);
		}

		async on_payment_mode() {
			const doc = this.doc;
			const pm = doc.payment_mode ? await read_values("Payment Mode", doc.payment_mode, ["mode", "account"]) : {};
			doc.mode = pm.mode || "";
			doc.payment_mode_type = pm.mode || "";
			doc.payment_account = pm.account || "";
			if (doc.payment_mode === "Cash" || doc.payment_mode === "Card") {
				await this.apply_charges();
			}
			E().set_cash_balance(doc);
		}

		// Cash sale: the customer's default payment mode (else the company's). Credit: none.
		async set_default_payment_mode() {
			const doc = this.doc;
			if (doc.docstatus !== 0) {
				return;
			}
			if (cint(doc.credit_sale) === 0) {
				const d = await E().payment_defaults(doc);
				if (d.payment_mode) {
					if (d.payment_mode !== doc.payment_mode || !doc.payment_mode_type) {
						doc.payment_mode = d.payment_mode;
						await this.on_payment_mode();
					}
				} else {
					frappe.msgprint(__("Default payment mode for sales not found."));
				}
			} else if (doc.payment_mode) {
				doc.payment_mode = "";
				await this.on_payment_mode();
			}
		}

		// ------------------------------------------------------ receipt schedule

		// The schedule sits in the Payment popup: bound to it while it is open
		bind_schedule($root) {
			$root.on("change", ".ci-schedule input[data-f]", (e) => {
				const input = e.currentTarget;
				const row = (this.doc.receipt_schedule || []).find((r) => r.name === input.dataset.row);
				if (!row) {
					return;
				}
				row[input.dataset.f] = input.dataset.f === "amount" ? flt(input.value) : input.value;
				this.mark_dirty();
			});
			$root.on("click", ".ci-schedule-add", () => {
				const row = frappe.model.add_child(this.doc, "Receipt Schedule", "receipt_schedule");
				row.date = this.doc.posting_date;
				row.payment_mode = "Cash";
				row.amount = 0;
				this.mark_dirty();
				this.render_schedule();
			});
			$root.on("click", ".ci-schedule-del", (e) => {
				const name = $(e.currentTarget).attr("data-row");
				this.doc.receipt_schedule = (this.doc.receipt_schedule || []).filter((r) => r.name !== name);
				this.doc.receipt_schedule.forEach((r, i) => (r.idx = i + 1));
				this.mark_dirty();
				this.render_schedule();
			});
		}

		render_schedule() {
			const doc = this.doc;
			const $wrap = this.$schedule;
			if (!$wrap) {
				return;
			}
			const show = cint(doc.credit_sale) && this.visible("receipt_schedule");
			$wrap.prop("hidden", !show);
			if (!show) {
				return;
			}
			const editable = this.is_editable();
			const rows = doc.receipt_schedule || [];
			const focused = document.activeElement && $.contains($wrap[0], document.activeElement);
			if (focused) {
				return;
			}
			$wrap.html(`
				<div class="ci-schedule-head">
					<span>${__("Receipt Schedule")}</span>
					${editable ? `<button type="button" class="btn btn-xs btn-default ci-schedule-add">${__("Add")}</button>` : ""}
				</div>
				<table class="ci-table ci-schedule-table">
					<thead><tr><th>${__("Due")}</th><th>${__("Mode")}</th><th class="ci-num">${__("Amount")}</th><th></th></tr></thead>
					<tbody>${rows.map((r) => `
						<tr>
							<td>${editable ? `<input type="date" class="ci-input" data-row="${r.name}" data-f="date" value="${esc(r.date || "")}">` : frappe.datetime.str_to_user(r.date)}</td>
							<td>${editable ? `<input type="text" class="ci-input" data-row="${r.name}" data-f="payment_mode" value="${esc(r.payment_mode || "")}">` : esc(r.payment_mode)}</td>
							<td class="ci-num">${editable ? `<input type="text" inputmode="decimal" class="ci-input" data-row="${r.name}" data-f="amount" value="${num(r.amount)}">` : money(r.amount)}</td>
							<td>${editable ? `<button type="button" class="btn btn-xs btn-default ci-schedule-del" data-row="${r.name}" aria-label="${__("Remove")}">${frappe.utils.icon("delete", "xs")}</button>` : ""}</td>
						</tr>`).join("")}
					</tbody>
				</table>`);
		}

		// ------------------------------------------------------------- actions

		action(name) {
			const doc = this.doc;
			const handlers = {
				save: () => this.save("Save"),
				submit: () => this.save("Submit"),
				cancel: () => this.cancel(),
				amend: () => this.amend(),
				delete: () => this.delete(),
				revert: () => this.revert_to_draft(),
				reload: () => (this.dirty
					? frappe.confirm(__("Discard your unsaved changes and reload?"), () => this.reload())
					: this.reload()),
				form: () => frappe.set_route("Form", DOCTYPE, doc.name),
				gl: () => E().show_gl_postings(DOCTYPE, doc.name),
				stock: () => E().show_stock_ledgers(DOCTYPE, doc.name),
				"preview-invoice": () => this.preview_pdf("invoice"),
				"print-invoice": () => this.print_direct("invoice"),
				"preview-receipt": () => this.preview_pdf("receipt"),
				"print-receipt": () => this.print_direct("receipt"),
				"record-payment": () => this.record_payment(),
			};
			handlers[name] && handlers[name]();
		}

		can_record_payment() {
			const doc = this.doc;
			return doc.docstatus === 1 && !this.dirty && !!cint(doc.credit_sale) && !cint(doc.for_advance_payment)
				&& flt(doc.paid_amount, 2) < flt(doc.rounded_total, 2);
		}

		// The receipt is submitted by the server; the invoice then shows it as paid
		// (or part paid), and its Print menu has the receipt
		async record_payment() {
			const receipt = await digitz_erp.record_quick_payment(this.doc.name);
			if (receipt) {
				await this.reload();
				this.host.list.loaded = false;
			}
		}

		// What the form checks before it saves or submits
		check(action) {
			const doc = this.doc;

			if (doc.tab_sales) {
				frappe.msgprint(__("Cannot change Sales Invoice created from a Tab Sales. Do it from the correspodning Tab Sale"));
				return false;
			}
			if (!cint(doc.credit_sale) && !doc.payment_account) {
				frappe.msgprint(__("Select payment account"));
			}
			if (!cint(doc.credit_sale) && !doc.payment_mode) {
				frappe.msgprint(__("Select payment mode"));
			}

			const missing = [];
			let first_payment_field = null;
			const need = (fieldname, ok) => {
				if (!ok) {
					missing.push(frappe.meta.get_label(DOCTYPE, fieldname));
					PAYMENT_FIELDS.includes(fieldname) && (first_payment_field ||= fieldname);
				}
			};
			need("customer", doc.customer);
			need("items", (doc.items || []).length);
			if (!cint(doc.credit_sale) && doc.payment_mode_type === "Cash") {
				need("received_amount", flt(doc.received_amount));
			}
			if (doc.mode === "Bank") {
				need("reference_no", doc.reference_no);
			}
			if (this.host.mobile_mandatory) {
				need("customer_mobile_number", doc.customer_mobile_number);
			}
			if (missing.length) {
				frappe.msgprint({
					title: __("Missing Fields"),
					message: __("Fill these before saving: {0}", [missing.map((m) => `<b>${esc(m)}</b>`).join(", ")]),
					indicator: "orange",
				});
				first_payment_field && this.focus_field(first_payment_field);
				return false;
			}

			const cash_error = E().cash_received_error(doc);
			if (cash_error) {
				frappe.msgprint({ ...cash_error, indicator: "red" });
				this.focus_field("received_amount");
				return false;
			}

			if (action === "Submit" && this.host.mobile_mandatory && E().is_placeholder_mobile(doc.customer_mobile_number)) {
				frappe.msgprint({
					title: __("Mobile Number Needed"),
					message: __("{0} is a placeholder. Enter the customer's real mobile number before submitting.", [esc(doc.customer_mobile_number)]),
					indicator: "red",
				});
				this.focus_field("customer_mobile_number");
				return false;
			}
			return true;
		}

		focus_field(fieldname) {
			const control = this.controls[fieldname];
			if (control) {
				control.$input && control.$input.trigger("focus");
			} else if (PAYMENT_FIELDS.includes(fieldname)) {
				// Payment fields are only in the Payment popup
				this.open_payment_dialog(fieldname);
			}
		}

		async save(action) {
			if (this.saving || !this.is_editable()) {
				return;
			}
			const doc = this.doc;
			await this.host.get_mobile_mandatory();

			// Rows without an item are dropped, as the form does
			doc.items = (doc.items || []).filter((r) => r.item);
			doc.items.forEach((r, i) => (r.idx = i + 1));
			if (doc.__islocal) {
				// A copied invoice must not carry delivery note allocations
				delete doc.delivery_notes;
			}
			if (!this.check(action)) {
				this.render_rows();
				this.refresh();
				return;
			}

			const run = async () => {
				this.saving = true;
				const old_key = this.tab.key;
				const old_name = doc.name;
				try {
					const r = await frappe.call({
						method: "frappe.desk.form.save.savedocs",
						args: { doc, action },
						freeze: true,
						freeze_message: action === "Submit" ? __("Submitting...") : __("Saving..."),
					});
					const saved = r.docs && r.docs[0];
					if (!saved) {
						return;
					}
					if (saved.name !== old_name) {
						frappe.model.remove_from_locals(DOCTYPE, old_name);
					}
					this.doc = frappe.get_doc(DOCTYPE, saved.name) || saved;
					this.dirty = false;
					this.render();
					old_key !== this.doc.name && this.host.renamed(this.tab, old_key);
					this.host.paint(this.tab);
					this.host.list.loaded = false;
					frappe.show_alert({ message: action === "Submit" ? __("Submitted {0}", [this.doc.name]) : __("Saved {0}", [this.doc.name]), indicator: "green" });
				} catch (e) {
					// The server's message is already shown
				} finally {
					this.saving = false;
				}
			};

			if (action === "Submit") {
				frappe.confirm(__("Permanently Submit {0}?", [esc(doc.name)]), run);
			} else {
				await run();
			}
		}

		cancel() {
			frappe.confirm(__("Permanently Cancel {0}?", [esc(this.doc.name)]), async () => {
				await frappe.call({
					method: "frappe.desk.form.save.cancel",
					args: { doctype: DOCTYPE, name: this.doc.name },
					freeze: true,
					freeze_message: __("Cancelling..."),
				});
				this.host.list.loaded = false;
				await this.reload();
			});
		}

		// As the form's Amend: a new draft copied from this cancelled invoice
		async amend() {
			const is_amended = await frappe.xcall("frappe.client.is_document_amended", { doctype: DOCTYPE, docname: this.doc.name });
			if (is_amended) {
				frappe.throw(__("This document is already amended, you cannot ammend it again"));
			}
			const newdoc = frappe.model.copy_doc(this.doc, true);
			newdoc.idx = null;
			newdoc.__run_link_triggers = false;
			newdoc.amended_from = this.doc.name;
			const tab = await this.host.add_new(newdoc);
			this.host.go(tab.key);
		}

		// frappe.model.delete_doc asks for the confirmation itself
		delete() {
			frappe.model.delete_doc(DOCTYPE, this.doc.name, () => {
				this.host.list.loaded = false;
				this.dirty = false;
				this.host.close(this.tab.key);
			});
		}

		revert_to_draft() {
			frappe.confirm(__("This will delete GL Posting rows for this voucher and reset the document to Draft. Do you want to continue?"), () => {
				frappe.call({
					method: "digitz_erp.api.gl_posting_api.reset_gl_for_voucher",
					args: { voucher_doctype: DOCTYPE, voucher_name: this.doc.name },
					freeze: true,
					freeze_message: __("Reverting to Draft..."),
					callback: (r) => {
						if (!r.exc) {
							frappe.msgprint({ title: __("Success"), message: r.message || __("Document succesfully reverted to draft."), indicator: "green" });
							this.reload();
						}
					},
				});
			});
		}

		// ------------------------------------------------------------ payment popup

		// The Payment card's fields in a popup, beside the item search. Every change
		// goes straight into the invoice through on_change, exactly as typing in the
		// card does (default payment mode, account, change to return, credit
		// schedule), so the card behind always shows the same values.
		open_payment_dialog(focus) {
			if (!this.is_editable()) {
				return;
			}
			const doc = this.doc;
			const FIELDS = PAYMENT_FIELDS;
			let syncing = false;

			const fields = [{ fieldtype: "HTML", fieldname: "summary" }];
			FIELDS.forEach((fieldname, i) => {
				const meta_df = frappe.meta.get_docfield(DOCTYPE, fieldname);
				if (!meta_df) {
					return;
				}
				i === 3 && fields.push({ fieldtype: "Column Break" });
				fields.push(Object.assign({}, meta_df, {
					hidden: 0, depends_on: null, mandatory_depends_on: null, read_only_depends_on: null,
					get_query: this.query_for(fieldname),
					change: () => {
						if (syncing) {
							return;
						}
						const value = d.get_value(fieldname);
						if ((doc[fieldname] ?? "") === (value ?? "") || (meta_df.fieldtype === "Check" && cint(doc[fieldname]) === cint(value))) {
							return;
						}
						doc[fieldname] = value;
						this.on_change(fieldname).then(() => sync());
					},
				}));
			});

			// Credit sale: the receipt schedule, as the Payment card had it
			fields.push({ fieldtype: "Section Break", fieldname: "schedule_section" }, { fieldtype: "HTML", fieldname: "schedule" });

			const d = new frappe.ui.Dialog({
				title: __("Payment"),
				size: "large",
				fields,
				primary_action_label: __("Done"),
				primary_action: () => d.hide(),
			});
			// The console's colours, for the schedule table
			d.$wrapper.addClass("ci-pay-dialog");
			this.$schedule = d.fields_dict.schedule.$wrapper.addClass("ci-schedule");
			this.bind_schedule(this.$schedule);
			d.onhide = () => {
				this.$schedule = null;
				this.refresh();
			};

			// Values, visibility and the totals, from the invoice (as refresh_states)
			const sync = () => {
				syncing = true;
				const credit = cint(doc.credit_sale);
				const bank = doc.mode === "Bank";
				const cash = !credit && doc.payment_mode_type === "Cash";
				const shown = {
					payment_mode: !credit, payment_account: !credit,
					reference_no: bank, received_amount: cash,
				};
				const reqd = { reference_no: bank, received_amount: cash };
				FIELDS.forEach((fieldname) => {
					const field = d.fields_dict[fieldname];
					if (!field) {
						return;
					}
					const visible = this.visible(fieldname) && (shown[fieldname] === undefined || shown[fieldname]);
					d.set_df_property(fieldname, "hidden", visible ? 0 : 1);
					d.set_df_property(fieldname, "reqd", reqd[fieldname] ? 1 : 0);
					if ((field.get_value() ?? "") !== (doc[fieldname] ?? "")) {
						field.set_value(doc[fieldname]);
					}
				});
				const balance = flt(doc.balance_amount);
				d.fields_dict.summary.$wrapper.html(`
					<div class="ci-pay-summary">
						<div><span>${__("Total")}</span><strong>${money(doc.rounded_total || doc.grand_total)}</strong></div>
						${cash ? `<div class="${balance < 0 ? "is-short" : ""}"><span>${__("Change to return")}</span><strong>${money(balance)}</strong></div>` : ""}
					</div>`);
				d.set_df_property("schedule_section", "hidden", credit ? 0 : 1);
				this.render_schedule();
				// Let the field's own change settle before listening again
				setTimeout(() => (syncing = false), 0);
			};

			d.show();
			sync();
			setTimeout(() => {
				const target = focus || (doc.payment_mode_type === "Cash" && !cint(doc.credit_sale) ? "received_amount" : "payment_mode");
				d.fields_dict[target] && d.fields_dict[target].$input && d.fields_dict[target].$input.trigger("focus");
			}, 300);
		}

		// Show Company / Show TRN only change the printout, so like the form
		// (allow on submit) they can be changed on a submitted invoice too
		can_change_print_flags() {
			return this.doc.docstatus === 0 ? this.is_editable() : this.doc.docstatus === 1;
		}

		async set_print_flag(fieldname, value) {
			const doc = this.doc;
			if (!this.can_change_print_flags() || cint(doc[fieldname]) === value) {
				return;
			}
			if (doc.docstatus === 0) {
				// Saved with the invoice; saving regenerates the PDFs
				doc[fieldname] = value;
				this.mark_dirty();
				return;
			}
			// Submitted: update the field, then regenerate the PDFs, which the form
			// leaves as they were
			try {
				await frappe.call({
					method: "frappe.client.set_value",
					args: { doctype: DOCTYPE, name: doc.name, fieldname, value },
					freeze: true,
					freeze_message: __("Updating the printout..."),
				});
				await frappe.call({
					method: "digitz_erp.selling.doctype.sales_invoice.sales_invoice.print_sales_invoice_pdf",
					args: { docname: doc.name },
					freeze: true,
					freeze_message: __("Generating PDF..."),
				});
				await this.reload();
				frappe.show_alert({ message: __("Printout updated"), indicator: "green" });
			} finally {
				// Shows the saved state, also when the update failed
				this.host.active_editor() === this && this.host.paint_files();
			}
		}

		// Regenerate the Invoice / Receipt PDFs. The index in this.pdfs of the
		// Invoice PDF (or of the Receipt PDF, for `kind` "receipt"), or -1.
		async generate_pdfs(kind = "invoice") {
			try {
				await frappe.call({
					method: "digitz_erp.selling.doctype.sales_invoice.sales_invoice.print_sales_invoice_pdf",
					args: { docname: this.doc.name },
					freeze: true,
					freeze_message: __("Generating PDF..."),
				});
				await this.reload();
				await this.load_files();
			} catch (e) {
				return -1;
			}
			if (!(this.pdfs || []).length) {
				frappe.msgprint(__("The PDF was not found. Try again."));
				return -1;
			}
			const index = this.pdfs.findIndex((f) => /receipt/i.test(f.file_name) === (kind === "receipt"));
			if (kind === "receipt" && index < 0) {
				frappe.msgprint(__("This invoice has no receipt yet."));
			}
			return kind === "receipt" ? index : Math.max(0, index);
		}

		// Preview: regenerate, then show the Invoice (or Receipt) PDF in a popup
		async preview_pdf(kind = "invoice") {
			const index = await this.generate_pdfs(kind);
			index >= 0 && this.show_pdf(index);
		}

		// Print: regenerate, then print the Invoice (or Receipt) PDF without a
		// preview. The PDF
		// loads in a hidden frame and the browser's print starts on it: no dialog on
		// a counter PC whose Chrome runs with --kiosk-printing, the usual print
		// dialog anywhere else.
		async print_direct(kind = "invoice") {
			const index = await this.generate_pdfs(kind);
			if (index < 0) {
				return;
			}
			const pdf = this.pdfs[index];
			$(".ci-print-frame").remove();
			const frame = $(`<iframe class="ci-print-frame" title="${esc(pdf.label)}"
				style="position: fixed; right: 0; bottom: 0; width: 1px; height: 1px; border: 0; opacity: 0;"></iframe>`)
				.appendTo(document.body)[0];
			frame.onload = () => {
				// The PDF viewer needs a moment after load before it can print
				setTimeout(() => {
					try {
						frame.contentWindow.focus();
						frame.contentWindow.print();
						frappe.show_alert({ message: __("Sent {0} to the printer", [pdf.label]), indicator: "green" });
					} catch (e) {
						this.show_pdf(index);
					}
					// Removed later, not now: printing reads from it
					setTimeout(() => frame.remove(), 60000);
				}, 600);
			};
			frame.src = `${encodeURI(pdf.file_url)}?v=${Date.now()}`;
		}

		// The invoice's PDFs in a popup: switch between Invoice and Receipt, print
		// the one shown, or open it in a new tab
		show_pdf(index = 0) {
			const pdfs = this.pdfs || [];
			let current = pdfs[index] ? index : 0;
			if (!pdfs.length) {
				return;
			}
			// A new URL each time, so a regenerated PDF is never served from cache.
			// In the popup the viewer opens without its thumbnail pane, fitted to width.
			const url = (f) => `${encodeURI(f.file_url)}?v=${Date.now()}`;

			const d = new frappe.ui.Dialog({
				title: this.doc.name,
				size: "extra-large",
				fields: [{ fieldtype: "HTML", fieldname: "viewer" }],
				primary_action_label: __("Print"),
				primary_action: () => {
					const frame = d.$wrapper.find(".ci-pdf-frame")[0];
					try {
						frame.contentWindow.focus();
						frame.contentWindow.print();
					} catch (e) {
						window.open(url(pdfs[current]), "_blank");
					}
				},
				secondary_action_label: __("Open in New Tab"),
				secondary_action: () => window.open(url(pdfs[current]), "_blank"),
			});

			const $viewer = d.fields_dict.viewer.$wrapper;
			const paint = () => {
				$viewer.html(`
					${pdfs.length > 1 ? `
						<div class="ci-pdf-switch" role="tablist">
							${pdfs.map((f, i) => `<button type="button" class="btn btn-sm ${i === current ? "btn-primary" : "btn-default"}" data-pdf="${i}">${f.label}</button>`).join("")}
						</div>` : ""}
					<iframe class="ci-pdf-frame" src="${url(pdfs[current])}#navpanes=0&view=FitH" title="${esc(pdfs[current].label)}"></iframe>`);
			};
			$viewer.on("click", "[data-pdf]", (e) => {
				current = cint(e.currentTarget.dataset.pdf);
				paint();
			});
			paint();
			d.show();
		}

		// The invoice and receipt PDFs the server attaches on save: the latest of
		// each, shown in the strip beside New Invoice (CashierInvoices.paint_files)
		async load_files() {
			this.pdfs = [];
			if (!this.doc.__islocal) {
				const files = await frappe.db.get_list("File", {
					filters: { attached_to_doctype: DOCTYPE, attached_to_name: this.doc.name },
					fields: ["file_name", "file_url"],
					order_by: "creation desc",
					limit: 10,
				});
				const latest = {};
				(files || [])
					.filter((f) => /\.pdf$/i.test(f.file_name || ""))
					.forEach((f) => {
						const receipt = /receipt/i.test(f.file_name);
						latest[receipt ? "receipt" : "invoice"] ||= { ...f, label: receipt ? __("Receipt PDF") : __("Invoice PDF") };
					});
				this.pdfs = [latest.invoice, latest.receipt].filter(Boolean);
			}
			this.host.active_editor() === this && this.host.paint_files();
		}
	};
})();
