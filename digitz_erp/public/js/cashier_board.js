// Cashier Console: Sales Invoice Board.
//
// The console's Board tab: the draft (unsubmitted) Sales Invoices raised from
// medical tokens, newest first, for the whole counter. Submitting an invoice
// drops it off the board, so this is the cashier's work queue.
//
// The standalone Sales Invoice Board page (digitz_erp/page/sales_invoice_board)
// does the same and now sends console users here. Token fetching, customer
// creation and invoice creation all live on the server (digitz_erp/api/
// token_sync.py, a cron job every minute). This view only renders and reacts:
// it refreshes when the server says something changed, with a slow timer as a
// safety net in case the socket drops, and only while the tab is on screen.
//
// Open Invoice opens the draft as an inner tab of the console's Sales Invoices
// tab (public/js/cashier_invoices.js), not in the Sales Invoice form.

frappe.provide("digitz_erp");

digitz_erp.CashierBoard = class CashierBoard {
	// Only used if the realtime event never arrives (socket down, worker
	// restart). The server pushes updates, so this stays deliberately slow.
	static FALLBACK_INTERVAL_MS = 60000;
	static LIMIT = 100;

	// `on_count(n)` gets the number of today's drafts on the board after each
	// refresh (the console's tab badge): older drafts stay listed, but a cashier
	// cannot bill them (counter_session_api.restrict_cashier_to_today)
	constructor($parent, opts = {}) {
		this.on_count = opts.on_count;
		this.running = false;
		this.fetching = false;
		this.realtime_handler = () => this.refresh();

		this.make($parent);
		this.bind_events();
	}

	make($parent) {
		this.$el = $(`
			<div class="ci-list cb-board">
				<div class="ci-list-bar">
					<button type="button" class="btn btn-primary btn-sm cb-sync">
						${frappe.utils.icon("refresh", "sm")} ${__("Sync Now")}
					</button>
					<button type="button" class="btn btn-default btn-sm cb-reload">${__("Reload")}</button>
					<span class="ci-list-count text-muted cb-status"></span>
				</div>
				<div class="ci-list-table"></div>
			</div>
		`).appendTo($parent);

		this.$parent = $parent;
		this.$table = this.$el.find(".ci-list-table");
		this.$status = this.$el.find(".cb-status");
	}

	bind_events() {
		this.$el.on("click", ".cb-sync", () => this.sync_now());
		this.$el.on("click", ".cb-reload", () => this.refresh());

		const open = (e) => {
			e.stopPropagation();
			this.open_invoice($(e.currentTarget).closest("tr").attr("data-name"));
		};
		this.$el.on("click", ".cb-open, tr[data-name]", open);
		this.$el.on("keydown", "tr[data-name]", (e) => e.key === "Enter" && open(e));
	}

	open_invoice(name) {
		name && frappe.set_route("cashier-console", "invoices", name);
	}

	// The console calls start when the tab shows and stop when it hides or the
	// user leaves the console, so the board never polls in the background.
	start() {
		if (this.running) {
			return;
		}

		this.running = true;

		// The server pushes only when it actually created invoices, so a
		// refresh here is never wasted work.
		frappe.realtime.on(digitz_erp.token_notifications.EVENT, this.realtime_handler);

		this.refresh();
		this.fallback_timer = setInterval(() => this.refresh(), digitz_erp.CashierBoard.FALLBACK_INTERVAL_MS);
	}

	stop() {
		if (!this.running) {
			return;
		}

		this.running = false;
		frappe.realtime.off(digitz_erp.token_notifications.EVENT, this.realtime_handler);

		if (this.fallback_timer) {
			clearInterval(this.fallback_timer);
			this.fallback_timer = null;
		}
	}

	refresh() {
		// Guard against a realtime burst and the fallback timer overlapping.
		if (this.fetching) {
			return;
		}

		this.fetching = true;
		this.$parent.addClass("is-loading");

		frappe.call({
			method: "digitz_erp.api.token_sync.get_board_invoices",
			args: { limit: digitz_erp.CashierBoard.LIMIT },
			callback: (r) => {
				const invoices = r.message || [];
				const today = frappe.datetime.get_today();
				const today_count = invoices.filter((inv) => inv.posting_date === today).length;
				this.render(invoices);
				this.on_count && this.on_count(today_count);
				this.set_status(today_count === invoices.length
					? __("{0} pending · Updated {1}", [invoices.length, frappe.datetime.now_time()])
					: __("{0} pending today ({1} in all) · Updated {2}", [today_count, invoices.length, frappe.datetime.now_time()]));
			},
			error: () => {
				this.set_status(__("Could not refresh. Retrying shortly."));
			},
			always: () => {
				this.fetching = false;
				this.$parent.removeClass("is-loading");
			},
		});
	}

	sync_now() {
		digitz_erp.token_notifications.run_sync_now(() => this.refresh());
	}

	set_status(text) {
		this.$status.text(text);
	}

	render(invoices) {
		if (!invoices.length) {
			this.$table.html(`<div class="ci-empty-list"><p>${__("No pending invoices.")}</p></div>`);
			return;
		}

		const esc = (v) => frappe.utils.escape_html(v == null ? "" : String(v));

		// Customer names originate from the external token API, so everything
		// interpolated here has to be escaped.
		this.$table.html(`
			<div class="ci-scroll">
				<table class="ci-table ci-table-list">
					<thead><tr>
						<th>${__("ID")}</th>
						<th>${__("Customer Name")}</th>
						<th>${__("Service")}</th>
						<th>${__("Date")}</th>
						<th>${__("Token")}</th>
						<th class="ci-num">${__("Amount")}</th>
						<th>${__("Action")}</th>
					</tr></thead>
					<tbody>${invoices.map((invoice) => `
						<tr data-name="${esc(invoice.name)}" tabindex="0">
							<td class="ci-strong ci-nowrap">${esc(invoice.name)}</td>
							<td><div class="ci-ellipsis">${esc(invoice.customer)}</div></td>
							<td><div class="ci-ellipsis">${esc(invoice.medical_service)}</div></td>
							<td class="ci-nowrap">${frappe.datetime.str_to_user(invoice.posting_date)}</td>
							<td class="ci-nowrap">${esc(invoice.customer_token)}</td>
							<td class="ci-num ci-strong">${format_currency(invoice.rounded_total)}</td>
							<td><button type="button" class="btn btn-xs btn-primary cb-open">${__("Open Invoice")}</button></td>
						</tr>`).join("")}
					</tbody>
				</table>
			</div>`);
	}
};
