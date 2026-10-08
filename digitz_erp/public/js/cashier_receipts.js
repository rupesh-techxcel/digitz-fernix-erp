// Cashier Console: Receipts.
//
// The console's Receipts tab: an "All Receipts" list and one inner tab per
// receipt opened or being created, each a ReceiptEditor. The open receipt is in
// the route (/app/cashier-console/receipts/<name>), so links, reloads and the
// back button land on it.
//
// A receipt here collects payment on a customer's credit Sales Invoices: pick
// the customer, the payment mode, then how much goes to each invoice (in full
// or in part). It is saved as an ordinary Receipt Entry, shaped exactly as the
// Receipt Entry form and its allocation popup make one -- one Customer line of
// type Sales Invoice and one Receipt Allocation row per invoice paid -- and is
// saved and submitted through the same server calls as the form, so the
// server's validations, postings, the counter session and the invoice receipt
// printouts all work as for any receipt. A receipt of any other shape (other
// lines, other reference types) opens read-only, with a way to the standard form.
//
// Invoices are paid only once the receipt is submitted; a saved draft holds its
// amounts against the invoices' balances meanwhile.

frappe.provide("digitz_erp");

(function () {
	const DOCTYPE = "Receipt Entry";
	const DETAIL_DOCTYPE = "Receipt Entry Detail";
	const ALLOCATION_DOCTYPE = "Receipt Allocation";
	const ROUTE = ["cashier-console", "receipts"];
	const API = "digitz_erp.api.receipt_entry_api";

	const esc = (v) => frappe.utils.escape_html(v == null ? "" : String(v));
	const money = (v) => format_currency(flt(v), frappe.boot.sysdefaults.currency);
	const round2 = (v) => flt(v, 2);
	const storage_key = () => `digitz_cashier_receipts:${frappe.session.user}`;

	// One Customer line paying Sales Invoices, as the console makes it. A receipt
	// made in the form with anything else opens read-only.
	function fits_console(doc) {
		const details = doc.receipt_entry_details || [];
		if (doc.__islocal && !details.length) {
			return true;
		}
		return (
			details.length === 1 &&
			details[0].receipt_type === "Customer" &&
			details[0].reference_type === "Sales Invoice" &&
			!!details[0].customer &&
			(doc.receipt_allocation || []).every((a) => a.reference_type === "Sales Invoice" && a.customer === details[0].customer)
		);
	}

	// ======================================================= quick payment

	// Record Payment on a submitted credit invoice (the console's Sales Invoices
	// tab): a dialog for the payment mode and amount, then the server makes and
	// submits the receipt (receipt_entry_api.create_quick_receipt). Resolves to the
	// receipt's name, or null when nothing was recorded.
	digitz_erp.record_quick_payment = async function (sales_invoice) {
		const info = await frappe.xcall(`${API}.get_quick_receipt_info`, { sales_invoice });
		if (flt(info.balance_amount) <= 0) {
			frappe.msgprint({
				title: __("Nothing to pay"),
				indicator: "orange",
				message: flt(info.held_by_drafts) > 0
					? __("Draft receipts hold the rest of {0} ({1}). Submit or delete them in the Receipts tab first.", [esc(sales_invoice), money(info.held_by_drafts)])
					: __("{0} is fully paid.", [esc(sales_invoice)]),
			});
			return null;
		}

		return new Promise((resolve) => {
			let mode = null;
			let done = false;

			const set_mode = async (payment_mode) => {
				mode = null;
				if (payment_mode) {
					const r = await frappe.db.get_value("Payment Mode", payment_mode, "mode");
					mode = (r.message || {}).mode || null;
				}
				const bank = mode === "Bank";
				d.set_df_property("reference_no", "hidden", bank ? 0 : 1);
				d.set_df_property("reference_no", "reqd", bank ? 1 : 0);
				d.set_df_property("reference_date", "hidden", bank ? 0 : 1);
				bank && !d.get_value("reference_date") && d.set_value("reference_date", frappe.datetime.get_today());
			};

			const sums = [
				[__("Invoice Total"), money(info.invoice_amount)],
				[__("Paid"), money(info.paid_amount)],
			];
			flt(info.held_by_drafts) > 0 && sums.push([__("Held by draft receipts"), money(info.held_by_drafts)]);
			sums.push([__("Balance"), money(info.balance_amount)]);

			const d = new frappe.ui.Dialog({
				title: __("Record Payment · {0}", [sales_invoice]),
				fields: [
					{
						fieldtype: "HTML", fieldname: "summary",
						options: `
							<div class="ci-pay-summary cr-quick-summary">
								<div class="cr-quick-customer">${esc(info.customer_display_name || info.customer)}</div>
								${sums.map(([l, v]) => `<div><span>${l}</span><strong>${v}</strong></div>`).join("")}
							</div>`,
					},
					{
						fieldtype: "Link", fieldname: "payment_mode", label: __("Payment Mode"), options: "Payment Mode", reqd: 1,
						default: info.payment_mode, change: () => set_mode(d.get_value("payment_mode")),
					},
					{
						fieldtype: "Currency", fieldname: "amount", label: __("Amount Received"), reqd: 1,
						default: info.balance_amount,
						description: __("The full balance, or less for a part payment."),
					},
					{ fieldtype: "Column Break" },
					{ fieldtype: "Data", fieldname: "reference_no", label: __("Reference No"), hidden: 1 },
					{ fieldtype: "Date", fieldname: "reference_date", label: __("Reference Date"), hidden: 1 },
					{ fieldtype: "Small Text", fieldname: "remarks", label: __("Remarks") },
				],
				primary_action_label: __("Record & Submit"),
				primary_action: async (values) => {
					const amount = round2(values.amount);
					if (amount <= 0) {
						frappe.msgprint(__("Enter the amount received."));
						return;
					}
					if (amount > round2(info.balance_amount)) {
						frappe.msgprint(__("At most {0} is left to pay on {1}.", [money(info.balance_amount), esc(sales_invoice)]));
						return;
					}
					if (mode === "Bank" && !values.reference_no) {
						frappe.msgprint(__("Reference No is required for a bank payment."));
						return;
					}
					d.get_primary_btn().prop("disabled", true);
					try {
						const receipt = await frappe.xcall(`${API}.create_quick_receipt`, {
							sales_invoice,
							amount,
							payment_mode: values.payment_mode,
							reference_no: mode === "Bank" ? values.reference_no : null,
							reference_date: mode === "Bank" ? values.reference_date : null,
							remarks: values.remarks || null,
						}, { freeze: true, freeze_message: __("Recording the payment...") });
						done = true;
						d.hide();
						$(document).trigger("digitz:receipt-saved", [receipt]);
						frappe.show_alert({ message: __("Payment of {0} recorded in {1}", [money(amount), receipt]), indicator: "green" }, 7);
						resolve(receipt);
					} catch (e) {
						// The server's message is already shown
						d.get_primary_btn().prop("disabled", false);
					}
				},
			});
			d.onhide = () => !done && resolve(null);
			d.show();
			set_mode(info.payment_mode);
			setTimeout(() => {
				const $amount = d.fields_dict.amount.$input;
				$amount && $amount.trigger("focus").trigger("select");
			}, 300);
		});
	};

	// ================================================================ host

	digitz_erp.CashierReceipts = class CashierReceipts {
		constructor(page, parent) {
			this.page = page;
			this.tabs = []; // {key, editor, $tab, $view}
			this.active = "list";
			this.new_count = 0;
			this.defaults = null;

			this.$el = $(`
				<div class="ci cr">
					<div class="ci-strip" role="tablist" aria-label="${__("Open receipts")}">
						<button type="button" class="ci-stab ci-stab-list active" data-key="list" role="tab">
							${frappe.utils.icon("list", "sm")}<span>${__("All Receipts")}</span>
						</button>
						<div class="ci-stab-docs"></div>
						<button type="button" class="ci-new cr-new" title="${__("New Receipt")}">
							${frappe.utils.icon("add", "sm")}<span>${__("New Receipt")}</span>
						</button>
					</div>
					<div class="ci-views">
						<div class="ci-view" data-key="list"></div>
					</div>
				</div>
			`).appendTo(parent);

			this.$docs = this.$el.find(".ci-stab-docs");
			this.list = new digitz_erp.ReceiptList(this, this.$el.find('.ci-view[data-key="list"]'));

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
			this.$el.on("click", ".cr-new", () => this.new_receipt());
			// A receipt recorded from an invoice (Record Payment): the list reloads when next shown
			$(document).on("digitz:receipt-saved", () => (this.list.loaded = false));

			// Keyboard shortcuts are not added here: Frappe keeps one handler per key
			// and page, and Alt+N / Ctrl+S on this page belong to the Sales Invoices tab.

			// Unsaved receipts are only in this browser tab
			$(window).on("beforeunload", () => {
				if (this.tabs.some((t) => t.editor && t.editor.dirty)) {
					return true;
				}
			});
		}

		active_editor() {
			const tab = this.tabs.find((t) => t.key === this.active);
			return tab && tab.editor;
		}

		// What a new receipt is filled in with, as the form's onload does
		async get_defaults() {
			if (!this.defaults) {
				const [defaults, cash_mode] = await Promise.all([
					frappe.xcall(`${API}.get_console_receipt_defaults`),
					frappe.db.get_value("Payment Mode", { mode: "Cash" }, "name").then((r) => (r.message || {}).name),
				]);
				this.defaults = Object.assign({ payment_mode: cash_mode }, defaults);
			}
			return this.defaults;
		}

		// ------------------------------------------------------------ routing

		go(key) {
			key && key !== "list" ? frappe.set_route(...ROUTE, key) : frappe.set_route(...ROUTE);
		}

		new_receipt() {
			frappe.set_route(...ROUTE, "new");
		}

		open_receipt(name) {
			this.go(name);
		}

		replace_route(key) {
			frappe.route_flags.replace_route = true;
			this.go(key);
		}

		// Called by the console with the route after /receipts
		async route(sub) {
			const key = sub && sub[0] ? decodeURIComponent(sub[0]) : "list";

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
				// A link to an unsaved receipt from an earlier session: start a new one
				if (key.startsWith("new-receipt-entry")) {
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

		async add_new() {
			this.new_count++;
			const doc = frappe.model.get_new_doc(DOCTYPE);
			const tab = this.add_tab(doc.name, __("New Receipt {0}", [this.new_count]));
			tab.editor = new digitz_erp.ReceiptEditor(this, tab, doc);
			await tab.editor.init_new();
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
				tab.editor = new digitz_erp.ReceiptEditor(this, tab, doc);
				await tab.editor.init_saved();
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
			// Inside a receipt the console's blue header gives its room to the receipt
			this.$el.closest(".cashier-console").toggleClass("cc-in-invoice", key !== "list");
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
			const customer = editor && editor.customer;
			tab.$tab.attr("title", customer ? `${tab.$tab.find(".ci-stab-label").text()} · ${customer}` : "");
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
				// Drop the cached document, so the receipt reopens as saved
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

		// A new receipt was saved: its tab takes the receipt's name
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

		// Saved receipts open in tabs come back after a reload
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
	};

	// ================================================================ list

	digitz_erp.ReceiptList = class ReceiptList {
		static PAGE = 50;

		constructor(host, $el) {
			this.host = host;
			this.$el = $el;
			this.range = "today";
			this.status = "";
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
							<input type="search" class="form-control" placeholder="${__("Search receipt no, customer or reference")}" aria-label="${__("Search receipts")}">
						</div>
						<select class="form-control ci-range" aria-label="${__("Period")}">
							${[["today", __("Today")], ["week", __("This Week")], ["month", __("This Month")], ["30", __("Last 30 Days")], ["all", __("All")]]
								.map(([v, label]) => `<option value="${v}"${v === this.range ? " selected" : ""}>${label}</option>`).join("")}
						</select>
						${chips("status", [["", __("Any Status")], ["0", __("Draft")], ["1", __("Submitted")], ["2", __("Cancelled")]], this.status)}
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
			this.$el.on("click", "tr[data-name]", (e) => this.host.open_receipt($(e.currentTarget).attr("data-name")));
			this.$el.on("keydown", "tr[data-name]", (e) => {
				if (e.key === "Enter") {
					this.host.open_receipt($(e.currentTarget).attr("data-name"));
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
						fields: ["name", "posting_date", "posting_time", "customers", "payment_mode", "reference_no", "amount", "docstatus"],
						filters: this.filters(),
						or_filters: this.search ? ["name", "customers", "reference_no"].map((f) => [DOCTYPE, f, "like", like]) : [],
						order_by: "posting_date desc, posting_time desc, creation desc",
						limit_start: start,
						limit_page_length: digitz_erp.ReceiptList.PAGE + 1,
					},
				});
				if (seq !== this.seq) {
					return;
				}
				const rows = r.message || [];
				const more = rows.length > digitz_erp.ReceiptList.PAGE;
				this.rows = (reset ? [] : this.rows).concat(rows.slice(0, digitz_erp.ReceiptList.PAGE));
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
				this.rows.length ? __("{0} receipt(s){1}", [this.rows.length, more ? "+" : ""]) : ""
			);

			if (!this.rows.length) {
				$table.html(`
					<div class="ci-empty-list">
						<p>${this.search ? __("No receipts match your search.") : __("No receipts in this period.")}</p>
						<button type="button" class="btn btn-primary btn-sm cr-new">${__("New Receipt")}</button>
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
							<th>${__("Receipt")}</th><th>${__("Date")}</th><th>${__("Customer")}</th>
							<th>${__("Payment")}</th><th>${__("Reference")}</th><th class="ci-num">${__("Amount")}</th><th>${__("Status")}</th>
						</tr></thead>
						<tbody>${this.rows.map((row) => `
							<tr data-name="${esc(row.name)}" tabindex="0">
								<td class="ci-strong ci-nowrap"><span class="ci-open-mark" title="${__("Open in a tab")}"></span>${esc(row.name)}</td>
								<td class="ci-nowrap">${frappe.datetime.str_to_user(row.posting_date)} <span class="text-muted">${time(row)}</span></td>
								<td><div class="ci-ellipsis">${esc(row.customers)}</div></td>
								<td><span class="ci-tag">${esc(row.payment_mode)}</span></td>
								<td class="ci-nowrap">${esc(row.reference_no)}</td>
								<td class="ci-num ci-strong">${money(row.amount)}</td>
								<td>${status(row)}</td>
							</tr>`).join("")}
						</tbody>
					</table>
				</div>`);
			this.paint_open();
		}

		// Marks the receipts that are open in a tab
		paint_open() {
			const open = new Set(this.host.tabs.map((t) => t.key));
			this.$el.find("tr[data-name]").each((_, tr) => tr.classList.toggle("is-open", open.has(tr.dataset.name)));
		}
	};

	// ============================================================== editor

	digitz_erp.ReceiptEditor = class ReceiptEditor {
		constructor(host, tab, doc) {
			this.host = host;
			this.tab = tab;
			this.doc = doc;
			this.dirty = !!doc.__islocal;
			this.$el = tab.$view;
			this.controls = {};
			// The receipt being entered: who pays, how, and how much to each invoice
			this.customer = null;
			this.mode = null; // the payment mode's Mode: Cash, Bank, Card, Other
			this.rows = []; // pending invoices (get_console_receivables), each with `paying`
			this.rows_loading = false;
		}

		// ------------------------------------------------------------ lifecycle

		async init_new() {
			this.tab.$view.html(`<div class="ci-loading">${__("Preparing a new receipt...")}</div>`);
			try {
				const defaults = await this.host.get_defaults();
				const doc = this.doc;
				doc.company = defaults.company;
				doc.warehouse = defaults.warehouse;
				defaults.payment_mode && (await this.set_payment_mode(defaults.payment_mode));
			} catch (err) {
				// The server reports the permission error; the receipt can still be entered
				console.error("Error loading receipt defaults:", err);
			}
			this.render();
		}

		// A saved receipt: its customer and the invoices with what it pays to each
		async init_saved() {
			const doc = this.doc;
			const line = (doc.receipt_entry_details || [])[0];
			this.customer = line ? line.customer : null;
			if (doc.payment_mode) {
				const r = await frappe.db.get_value("Payment Mode", doc.payment_mode, "mode");
				this.mode = (r.message || {}).mode || doc.mode;
			}
			if (this.is_editable() && this.customer) {
				await this.load_rows();
			}
			this.render();
		}

		async reload() {
			frappe.model.remove_from_locals(DOCTYPE, this.doc.name);
			await frappe.model.with_doc(DOCTYPE, this.doc.name);
			this.doc = frappe.get_doc(DOCTYPE, this.doc.name);
			this.dirty = false;
			await this.init_saved();
			this.host.paint(this.tab);
		}

		is_editable() {
			return this.doc.docstatus === 0 && fits_console(this.doc);
		}

		// ------------------------------------------------------------ data

		async set_payment_mode(payment_mode) {
			const doc = this.doc;
			doc.payment_mode = payment_mode || null;
			doc.account = null;
			this.mode = null;
			if (payment_mode) {
				const r = await frappe.db.get_value("Payment Mode", payment_mode, ["account", "mode"]);
				const values = r.message || {};
				doc.account = values.account || null;
				doc.mode = values.mode || null;
				this.mode = values.mode || null;
			}
			if (this.mode !== "Bank") {
				doc.reference_no = null;
				doc.reference_date = null;
			} else if (!doc.reference_date) {
				doc.reference_date = frappe.datetime.get_today();
			}
		}

		// The customer's pending credit invoices. A saved receipt's own invoices
		// come with what it pays to each.
		async load_rows() {
			if (!this.customer) {
				this.rows = [];
				return;
			}
			this.rows_loading = true;
			this.render_rows();
			try {
				const rows = await frappe.xcall(`${API}.get_console_receivables`, {
					customer: this.customer,
					receipt_no: this.doc.__islocal ? "" : this.doc.name,
				});
				this.rows = (rows || []).map((row) => Object.assign(row, { paying: round2(row.paying_amount) }));
			} finally {
				this.rows_loading = false;
			}
		}

		total_paying() {
			return round2(this.rows.reduce((sum, row) => sum + flt(row.paying), 0));
		}

		total_balance() {
			return round2(this.rows.reduce((sum, row) => sum + flt(row.balance_amount), 0));
		}

		// An amount received, spread over the invoices oldest first
		spread(amount) {
			let left = round2(amount);
			this.rows.forEach((row) => {
				row.paying = round2(Math.max(0, Math.min(left, flt(row.balance_amount))));
				left = round2(left - row.paying);
			});
			return left;
		}

		mark_dirty() {
			this.dirty = true;
			this.refresh();
		}

		// ------------------------------------------------------------ render

		render() {
			this.controls = {};
			const doc = this.doc;
			const editable = this.is_editable();

			this.$el.html(`
				<div class="ci-editor cr-editor${editable ? "" : " is-readonly"}">
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
							<section class="ci-card cr-card-party">
								<div class="ci-fields cr-fields-party"></div>
							</section>
							<section class="ci-card cr-card-invoices">
								<div class="ci-card-head">
									<h4>${editable ? __("Invoices to pay") : __("Invoices paid")}</h4>
									<div class="cr-received"></div>
								</div>
								<div class="cr-rows"></div>
							</section>
							<div class="ci-side">
								<section class="ci-card ci-card-total">
									<div class="ci-total-label">${__("Amount Received")}</div>
									<div class="ci-total-value"></div>
									<div class="ci-sums"></div>
								</section>
							</div>
							<section class="ci-card cr-card-remarks">
								<div class="ci-fields cr-fields-remarks"></div>
							</section>
						</div>
					</div>
				</div>
			`);

			this.make_party_fields();
			this.bind();
			this.render_received();
			this.render_rows();
			this.refresh();

			if (editable && !this.customer) {
				setTimeout(() => this.focus("customer"), 50);
			}
		}

		// Standalone controls: the values are written into the receipt on save
		make_control(selector, df, value) {
			const editable = this.is_editable();
			const $cell = $(`<div class="ci-field${df.span ? " ci-span-2" : ""}" data-fieldname="${df.fieldname}"></div>`).appendTo(this.$el.find(selector));
			const control = frappe.ui.form.make_control({
				df: Object.assign({}, df, { read_only: editable ? 0 : 1 }),
				parent: $cell,
				render_input: true,
			});
			control.refresh();
			control.set_value(value ?? "");
			this.controls[df.fieldname] = control;
			return control;
		}

		make_party_fields() {
			const doc = this.doc;
			const label = (fieldname) => __(frappe.meta.get_label(DOCTYPE, fieldname));

			this.make_control(".cr-fields-party", {
				fieldtype: "Link", fieldname: "customer", options: "Customer", label: __("Customer"), reqd: 1,
				get_query: () => ({ filters: { disabled: 0 } }),
				change: () => this.on_customer(this.controls.customer.get_value()),
			}, this.customer);
			this.make_control(".cr-fields-party", {
				fieldtype: "Link", fieldname: "payment_mode", options: "Payment Mode", label: label("payment_mode"), reqd: 1,
				change: () => this.on_payment_mode(this.controls.payment_mode.get_value()),
			}, doc.payment_mode);
			this.make_control(".cr-fields-party", {
				fieldtype: "Data", fieldname: "reference_no", label: label("reference_no"), reqd: 1,
				change: () => this.on_value("reference_no"),
			}, doc.reference_no);
			this.make_control(".cr-fields-party", {
				fieldtype: "Date", fieldname: "reference_date", label: label("reference_date"), reqd: 1,
				change: () => this.on_value("reference_date"),
			}, doc.reference_date);
			this.make_control(".cr-fields-remarks", {
				fieldtype: "Small Text", fieldname: "remarks", label: label("remarks"), span: 1,
				change: () => this.on_value("remarks"),
			}, doc.remarks);
			const remarks = this.controls.remarks;
			remarks.$input && remarks.$input.is("textarea") && remarks.$input.css("height", "72px");
		}

		// Amount received: spreads over the invoices, oldest first
		render_received() {
			const $wrap = this.$el.find(".cr-received");
			if (!this.is_editable()) {
				$wrap.empty();
				return;
			}
			$wrap.html(`
				<label class="cr-received-label" for="cr-received-${esc(this.tab.key)}">${__("Amount received")}</label>
				<input type="text" inputmode="decimal" class="ci-input cr-received-input" id="cr-received-${esc(this.tab.key)}"
					placeholder="0.00" title="${__("Fills the invoices oldest first")}">
				<button type="button" class="btn btn-default btn-xs" data-action="pay-all">${__("Pay all")}</button>
				<button type="button" class="btn btn-default btn-xs" data-action="clear">${__("Clear")}</button>`);
		}

		render_rows() {
			const $wrap = this.$el.find(".cr-rows");
			if (!$wrap.length) {
				return;
			}
			if (!this.is_editable()) {
				$wrap.html(this.saved_rows_html());
				return;
			}
			if (!this.customer) {
				$wrap.html(`<div class="cr-empty text-muted">${__("Select the customer to see their unpaid credit invoices.")}</div>`);
				return;
			}
			if (this.rows_loading) {
				$wrap.html(`<div class="cr-empty text-muted">${__("Loading the customer's invoices...")}</div>`);
				return;
			}
			if (!this.rows.length) {
				$wrap.html(`<div class="cr-empty text-muted">${__("{0} has no unpaid credit invoices.", [esc(this.customer)])}</div>`);
				return;
			}

			$wrap.html(`
				<div class="ci-scroll">
					<table class="ci-table cr-table">
						<thead><tr>
							<th class="cr-col-check"><input type="checkbox" class="cr-check-all" aria-label="${__("Pay all invoices in full")}"></th>
							<th>${__("Invoice")}</th><th>${__("Date")}</th><th>${__("Reference")}</th>
							<th class="ci-num">${__("Invoice Amount")}</th>
							<th class="ci-num" title="${__("Allocated in other receipts, drafts included")}">${__("Other Receipts")}</th>
							<th class="ci-num">${__("Balance")}</th>
							<th class="ci-num">${__("Paying")}</th>
						</tr></thead>
						<tbody>${this.rows.map((row, i) => `
							<tr data-row="${i}">
								<td class="cr-col-check"><input type="checkbox" class="cr-check" aria-label="${__("Pay {0} in full", [esc(row.reference_name)])}"></td>
								<td class="ci-strong ci-nowrap">${esc(row.reference_name)}</td>
								<td class="ci-nowrap">${frappe.datetime.str_to_user(row.posting_date)}</td>
								<td><div class="ci-ellipsis">${esc(row.reference_no)}</div></td>
								<td class="ci-num">${money(row.invoice_amount)}</td>
								<td class="ci-num">${flt(row.paid_amount) ? money(row.paid_amount) : `<span class="text-muted">-</span>`}</td>
								<td class="ci-num ci-strong">${money(row.balance_amount)}</td>
								<td class="ci-num"><input type="text" inputmode="decimal" class="ci-input cr-pay" data-row="${i}"></td>
							</tr>`).join("")}
						</tbody>
					</table>
				</div>`);
			this.refresh_rows();
		}

		// A submitted, cancelled or form-made receipt: what it allocated, from the document
		saved_rows_html() {
			const allocations = (this.doc.receipt_allocation || []).filter((a) => flt(a.paying_amount) > 0);
			if (!allocations.length) {
				return `<div class="cr-empty text-muted">${__("This receipt pays no invoices.")}</div>`;
			}
			const can_open = (a) => a.reference_type === "Sales Invoice" && this.doc.docstatus === 1;
			return `
				<div class="ci-scroll">
					<table class="ci-table cr-table">
						<thead><tr>
							<th>${__("Document")}</th><th>${__("Customer")}</th>
							<th class="ci-num">${__("Total")}</th><th class="ci-num">${__("Paid")}</th><th></th>
						</tr></thead>
						<tbody>${allocations.map((a) => `
							<tr>
								<td class="ci-strong ci-nowrap">${esc(a.reference_name)}<div class="ci-sub">${esc(__(a.reference_type))}</div></td>
								<td><div class="ci-ellipsis">${esc(a.customer)}</div></td>
								<td class="ci-num">${money(a.total_amount)}</td>
								<td class="ci-num ci-strong">${money(a.paying_amount)}</td>
								<td class="ci-row-actions">${can_open(a)
									? `<button type="button" class="btn btn-default btn-xs" data-open-invoice="${esc(a.reference_name)}"
										title="${__("Open the invoice to print it and its receipt")}">${__("Open Invoice")}</button>`
									: ""}</td>
							</tr>`).join("")}
						</tbody>
					</table>
				</div>`;
		}

		bind() {
			// render() runs on every load, save and reload: drop the previous handlers first
			this.$el.off();
			this.$el.on("click", "[data-action]", (e) => {
				e.preventDefault();
				this.action($(e.currentTarget).attr("data-action"));
			});
			this.$el.on("click", "[data-open-invoice]", (e) => {
				frappe.set_route("cashier-console", "invoices", $(e.currentTarget).attr("data-open-invoice"));
			});

			this.$el.on("change", ".cr-received-input", (e) => {
				const value = flt(e.currentTarget.value);
				const left = this.spread(value);
				left > 0 && frappe.show_alert({
					message: __("{0} is more than the invoices' balance. Only {1} is allocated.", [money(value), money(value - left)]),
					indicator: "orange",
				});
				this.mark_dirty();
			});
			this.$el.on("keydown", ".cr-received-input, .cr-pay", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					e.currentTarget.blur();
				}
			});
			this.$el.on("focus", ".cr-received-input, .cr-pay", (e) => e.currentTarget.select());

			this.$el.on("change", ".cr-pay", (e) => {
				const row = this.rows[cint(e.currentTarget.dataset.row)];
				let value = round2(e.currentTarget.value);
				if (value < 0) {
					value = 0;
				}
				if (value > flt(row.balance_amount)) {
					frappe.show_alert({ message: __("{0}: at most {1} is left to pay.", [row.reference_name, money(row.balance_amount)]), indicator: "orange" });
					value = round2(row.balance_amount);
				}
				row.paying = value;
				this.mark_dirty();
			});
			this.$el.on("change", ".cr-check", (e) => {
				const row = this.rows[cint($(e.currentTarget).closest("tr").attr("data-row"))];
				row.paying = e.currentTarget.checked ? round2(row.balance_amount) : 0;
				this.mark_dirty();
			});
			this.$el.on("change", ".cr-check-all", (e) => {
				const on = e.currentTarget.checked;
				this.rows.forEach((row) => (row.paying = on ? round2(row.balance_amount) : 0));
				this.mark_dirty();
			});
		}

		// ------------------------------------------------------------ changes

		async on_customer(customer) {
			customer = customer || null;
			if (customer === this.customer) {
				return;
			}
			this.customer = customer;
			this.rows = [];
			this.dirty = true;
			await this.load_rows();
			this.render_rows();
			this.refresh();
			this.host.paint(this.tab);
			customer && !this.doc.payment_mode && this.focus("payment_mode");
		}

		async on_payment_mode(payment_mode) {
			payment_mode = payment_mode || null;
			if (payment_mode === (this.doc.payment_mode || null)) {
				return;
			}
			await this.set_payment_mode(payment_mode);
			this.controls.reference_no.set_value(this.doc.reference_no || "");
			this.controls.reference_date.set_value(this.doc.reference_date || "");
			this.mark_dirty();
			this.mode === "Bank" ? this.focus("reference_no") : this.$el.find(".cr-received-input").trigger("focus");
		}

		on_value(fieldname) {
			const value = this.controls[fieldname].get_value() || null;
			if ((this.doc[fieldname] || null) === value) {
				return;
			}
			this.doc[fieldname] = value;
			this.mark_dirty();
		}

		focus(fieldname) {
			const control = this.controls[fieldname];
			control && control.$input && control.$input.trigger("focus");
		}

		// ------------------------------------------------------------ refresh

		refresh() {
			this.refresh_head();
			this.refresh_fields();
			this.refresh_rows();
			this.refresh_totals();
			this.refresh_banners();
			this.host.paint(this.tab);
		}

		refresh_head() {
			const doc = this.doc;
			const [label, colour] = doc.__islocal
				? [__("Not Saved"), "orange"]
				: [[__("Draft"), "orange"], [__("Submitted"), "green"], [__("Cancelled"), "red"]][doc.docstatus];
			this.$el.find(".ci-docname").text(doc.__islocal ? __("New Receipt") : doc.name);
			this.$el.find(".ci-status").attr("class", `ci-status indicator-pill ${this.dirty && !doc.__islocal ? "orange" : colour}`)
				.text(this.dirty && !doc.__islocal ? __("Not Saved") : label);

			const meta = [];
			doc.posting_date && meta.push(`${frappe.utils.icon("calendar", "xs")} ${frappe.datetime.str_to_user(doc.posting_date)} ${doc.posting_time ? moment(String(doc.posting_time), "HH:mm:ss").format("HH:mm") : ""}`);
			doc.counter_session && meta.push(esc(doc.counter_session));
			doc.amended_from && meta.push(__("Amended from {0}", [esc(doc.amended_from)]));
			this.$el.find(".ci-head-meta").html(meta.map((m) => `<span>${m}</span>`).join(""));

			this.render_actions();
		}

		render_actions() {
			const doc = this.doc;
			const saved = !doc.__islocal;
			const btn = (action, label, cls = "btn-default", icon = "") =>
				`<button type="button" class="btn btn-sm ${cls}" data-action="${action}">${icon ? frappe.utils.icon(icon, "sm") : ""}<span>${label}</span></button>`;
			const item = (action, label) => `<li><a class="dropdown-item" href="#" data-action="${action}">${label}</a></li>`;

			const buttons = [];
			if (this.is_editable()) {
				buttons.push(btn("save", __("Save"), saved && !this.dirty ? "btn-default" : "btn-primary", "check"));
				saved && !this.dirty && buttons.push(btn("submit", __("Submit"), "btn-primary"));
			}
			if (saved) {
				buttons.push(`
					<div class="btn-group">
						<button type="button" class="btn btn-sm btn-default dropdown-toggle ci-menu" data-toggle="dropdown" aria-expanded="false" aria-label="${__("More actions")}">
							${frappe.utils.icon("dot-horizontal", "sm")}
						</button>
						<ul class="dropdown-menu dropdown-menu-right">
							${item("reload", __("Reload"))}
							${item("form", __("Open in Standard Form"))}
						</ul>
					</div>`);
			}
			this.$el.find(".ci-actions").html(buttons.join(""));
		}

		// Reference No / Date only for a bank payment mode
		refresh_fields() {
			const bank = this.mode === "Bank";
			["reference_no", "reference_date"].forEach((fieldname) => {
				const shown = bank || (!this.is_editable() && !!this.doc[fieldname]);
				this.$el.find(`.ci-field[data-fieldname="${fieldname}"]`).prop("hidden", !shown);
			});
		}

		refresh_rows() {
			if (!this.is_editable()) {
				return;
			}
			const $rows = this.$el.find(".cr-table tbody tr[data-row]");
			$rows.each((_, tr) => {
				const row = this.rows[cint(tr.dataset.row)];
				if (!row) {
					return;
				}
				const paying = flt(row.paying);
				const $input = $(tr).find(".cr-pay");
				// Leave the box being typed in alone
				!$input.is(":focus") && $input.val(paying ? format_number(paying, null, 2) : "");
				$(tr).find(".cr-check").prop("checked", paying > 0 && round2(paying) === round2(row.balance_amount));
				tr.classList.toggle("is-paying", paying > 0);
			});
			const full = this.rows.length && this.rows.every((row) => round2(row.paying) === round2(row.balance_amount));
			this.$el.find(".cr-check-all").prop("checked", !!full);
		}

		refresh_totals() {
			const editable = this.is_editable();
			const total = editable ? this.total_paying() : flt(this.doc.amount);
			this.$el.find(".ci-total-value").text(money(total));

			const sums = [];
			if (editable) {
				const paying = this.rows.filter((row) => flt(row.paying) > 0).length;
				sums.push([__("Invoices paid"), paying ? `${paying} / ${this.rows.length}` : "-"]);
				sums.push([__("Customer's balance"), money(this.total_balance())]);
				this.rows.length && sums.push([__("Left after this receipt"), money(this.total_balance() - total)]);
			} else {
				const line = (this.doc.receipt_entry_details || [])[0];
				line && line.customer && sums.push([__("Customer"), esc(line.customer)]);
			}
			this.doc.payment_mode && sums.push([__("Payment Mode"), esc(this.doc.payment_mode)]);
			this.$el.find(".ci-sums").html(sums.map(([l, v]) => `<div class="ci-sum"><span>${l}</span><span>${v}</span></div>`).join(""));
		}

		refresh_banners() {
			const banners = [];
			if (this.doc.docstatus === 0 && !fits_console(this.doc)) {
				banners.push(["orange", __("This receipt has lines the console does not handle (other customers, reference types or receipts). Open it in the standard form to change it."),
					`<button type="button" class="btn btn-xs btn-default" data-action="form">${__("Open in Standard Form")}</button>`]);
			} else if (this.doc.docstatus === 0 && !this.doc.__islocal && !this.dirty) {
				banners.push(["blue", __("Saved as a draft. The invoices are paid once the receipt is submitted."), ""]);
			} else if (this.doc.docstatus === 2) {
				banners.push(["red", __("This receipt is cancelled. The invoices it paid are unpaid again."), ""]);
			}
			this.$el.find(".ci-banners").html(banners.map(([tone, text, extra]) =>
				`<div class="ci-banner ci-banner-${tone}"><span>${text}</span>${extra}</div>`).join(""));
		}

		// ------------------------------------------------------------ actions

		action(name) {
			({
				save: () => this.save("Save"),
				submit: () => this.save("Submit"),
				"pay-all": () => {
					this.rows.forEach((row) => (row.paying = round2(row.balance_amount)));
					this.$el.find(".cr-received-input").val("");
					this.mark_dirty();
				},
				clear: () => {
					this.rows.forEach((row) => (row.paying = 0));
					this.$el.find(".cr-received-input").val("");
					this.mark_dirty();
				},
				reload: () => this.reload(),
				form: () => frappe.set_route("Form", DOCTYPE, this.doc.name),
			}[name] || (() => {}))();
		}

		// What the server would refuse, said here first
		check() {
			const doc = this.doc;
			const fail = (message, fieldname) => {
				frappe.msgprint({ message, indicator: "orange", title: __("Cannot save the receipt") });
				fieldname && this.focus(fieldname);
				return false;
			};
			if (!this.customer) {
				return fail(__("Select the customer."), "customer");
			}
			if (!doc.payment_mode) {
				return fail(__("Select the payment mode."), "payment_mode");
			}
			if (!doc.account) {
				return fail(__("Payment mode {0} has no account set. Ask a supervisor to set it.", [esc(doc.payment_mode)]));
			}
			if (this.mode === "Bank" && !doc.reference_no) {
				return fail(__("Reference No is required for a bank payment."), "reference_no");
			}
			if (this.mode === "Bank" && !doc.reference_date) {
				return fail(__("Reference Date is required for a bank payment."), "reference_date");
			}
			const over = this.rows.find((row) => round2(row.paying) > round2(row.balance_amount));
			if (over) {
				return fail(__("{0}: at most {1} is left to pay.", [esc(over.reference_name), money(over.balance_amount)]));
			}
			if (this.total_paying() <= 0) {
				return fail(__("Enter the amount paid against at least one invoice."));
			}
			return true;
		}

		// The receipt as the Receipt Entry form and its allocation popup make it:
		// one Customer line of type Sales Invoice for the total, and one allocation
		// per invoice paid
		build_doc() {
			const doc = this.doc;
			const total = this.total_paying();
			const defaults = this.host.defaults || {};

			if (doc.__islocal) {
				doc.posting_date = frappe.datetime.get_today();
				doc.posting_time = frappe.datetime.now_time();
			}
			doc.company = doc.company || defaults.company;
			doc.warehouse = doc.warehouse || defaults.warehouse;
			doc.amount = total;
			doc.allocated_amount = total;
			doc.mode = this.mode;

			let line = (doc.receipt_entry_details || [])[0];
			if (!line) {
				line = frappe.model.add_child(doc, DETAIL_DOCTYPE, "receipt_entry_details");
			}
			Object.assign(line, {
				receipt_type: "Customer",
				reference_type: "Sales Invoice",
				customer: this.customer,
				account: line.account || defaults.receivable_account,
				reference_no: doc.reference_no,
				reference_date: doc.reference_date,
				project: doc.project || null,
				amount: total,
				allocated_amount: total,
			});
			doc.receipt_entry_details = [line];

			doc.receipt_allocation = [];
			this.rows.filter((row) => flt(row.paying) > 0).forEach((row) => {
				const allocation = frappe.model.add_child(doc, ALLOCATION_DOCTYPE, "receipt_allocation");
				Object.assign(allocation, {
					customer: this.customer,
					reference_type: "Sales Invoice",
					reference_name: row.reference_name,
					total_amount: row.invoice_amount,
					paid_amount: row.paid_amount,
					balance_amount: row.balance_amount,
					paying_amount: round2(row.paying),
					project: row.project || null,
				});
			});
		}

		async save(action) {
			if (this.saving || !this.is_editable()) {
				return;
			}
			if (action === "Save" && !this.check()) {
				return;
			}
			const doc = this.doc;

			const run = async () => {
				this.saving = true;
				const old_key = this.tab.key;
				const old_name = doc.name;
				try {
					if (action === "Save") {
						// A receivable account the defaults could not give is the server's
						// to report; it is a setup error, not the cashier's
						if (!this.host.defaults) {
							await this.host.get_defaults().catch(() => null);
						}
						this.build_doc();
					}
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
					await this.init_saved();
					old_key !== this.doc.name && this.host.renamed(this.tab, old_key);
					this.host.paint(this.tab);
					this.host.list.loaded = false;
					frappe.show_alert({
						message: action === "Submit" ? __("Submitted {0}", [this.doc.name]) : __("Saved {0}", [this.doc.name]),
						indicator: "green",
					});
				} catch (e) {
					// The server's message is already shown
				} finally {
					this.saving = false;
				}
			};

			if (action === "Submit") {
				frappe.confirm(__("Submit {0} for {1}? The invoices are then paid and the receipt cannot be changed.",
					[esc(doc.name), money(doc.amount)]), run);
			} else {
				await run();
			}
		}
	};
})();
