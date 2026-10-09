// Sales Invoice Board
//
// Displays today's draft (unsubmitted) Sales Invoices raised from medical tokens,
// newest first, with a search by invoice number, customer, company or token. Submitting an invoice drops it off the board, so this doubles
// as the cashier's work queue.
//
// Token fetching, customer creation and invoice creation all live on the server
// now (digitz_erp/api/token_sync.py, run by a cron job every minute). This page
// only renders and reacts: it refreshes when the server says something changed,
// with a slow timer as a safety net in case the socket drops.
//
// The board now lives in the Cashier Console (public/js/cashier_board.js).
// Anyone who can open the console is sent to its Board tab; this page stays for
// those who cannot, such as a Cashier Approver without the Cashier role.

frappe.provide("digitz_erp");

function digitz_can_open_console() {
	return !!(frappe.boot.page_info || {})["cashier-console"];
}

frappe.pages["Sales Invoice Board"].on_page_load = function (wrapper) {
	if (digitz_can_open_console()) {
		return; // on_page_show sends them to the console
	}

	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Sales Invoice Board",
		single_column: true,
	});

	wrapper.board = new digitz_erp.SalesInvoiceBoard(page, wrapper);
};

// Runs on every visit. Replaces the route, so the back button does not bounce
// off this page.
frappe.pages["Sales Invoice Board"].on_page_show = function () {
	if (digitz_can_open_console()) {
		frappe.route_flags.replace_route = true;
		frappe.set_route("cashier-console", "board");
	}
};

digitz_erp.SalesInvoiceBoard = class SalesInvoiceBoard {
	// Only used if the realtime event never arrives (socket down, worker
	// restart). The server pushes updates, so this stays deliberately slow.
	static FALLBACK_INTERVAL_MS = 60000;

	constructor(page, wrapper) {
		this.page = page;
		this.$wrapper = $(wrapper);
		this.running = false;
		this.fetching = false;
		this.realtime_handler = () => this.refresh();

		this.setup_page();
		this.bind_events();
		this.start();
	}

	setup_page() {
		this.page.set_primary_action(__("Sync Now"), () => this.sync_now(), "refresh");
		this.page.set_secondary_action(__("Reload"), () => this.refresh());
		this.search_field = this.page.add_field({
			fieldtype: "Data",
			fieldname: "search",
			placeholder: __("Search invoice no, customer, company or token"),
			change: frappe.utils.debounce(() => this.refresh(), 300),
		});

		this.$wrapper.find(".layout-main-section").html(`
			<div class="post-table-wrapper">
				<div class="text-muted small" style="margin-bottom: 8px;">
					<span class="board-status"></span>
				</div>
				<div id="post-table" class="table-responsive"></div>
			</div>
		`);

		this.$container = this.$wrapper.find("#post-table");
		this.$status = this.$wrapper.find(".board-status");
	}

	bind_events() {
		this.$wrapper.on("click", ".open-invoice-btn", (event) => {
			frappe.set_route("Form", "Sales Invoice", $(event.currentTarget).attr("data-id"));
		});

		// frappe.views.Container fires these on the page wrapper as the user
		// navigates. Without the teardown the old code kept polling forever in
		// the background, on every page, for the life of the browser tab.
		this.$wrapper.on("show", () => this.start());
		this.$wrapper.on("hide", () => this.stop());
	}

	start() {
		if (this.running) {
			return;
		}

		this.running = true;

		// The server pushes only when it actually created invoices, so a
		// refresh here is never wasted work.
		frappe.realtime.on(digitz_erp.token_notifications.EVENT, this.realtime_handler);

		this.refresh();
		this.fallback_timer = setInterval(
			() => this.refresh(),
			digitz_erp.SalesInvoiceBoard.FALLBACK_INTERVAL_MS
		);
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

		frappe.call({
			method: "digitz_erp.api.token_sync.get_board_invoices",
			args: { limit: 100, search: this.search_field.get_value() || "" },
			callback: (r) => {
				this.render(r.message || []);
				this.set_status(__("{0} pending today · Updated {1}", [(r.message || []).length, frappe.datetime.now_time()]));
			},
			error: () => {
				this.set_status(__("Could not refresh. Retrying shortly."));
			},
			always: () => {
				this.fetching = false;
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
			this.$container.html(`<p class="text-muted">${__("No pending invoices today.")}</p>`);
			return;
		}

		const esc = frappe.utils.escape_html;

		// Customer names originate from the external token API, so everything
		// interpolated here has to be escaped.
		const rows = invoices
			.map(
				(invoice) => `
				<tr>
					<td>${esc(invoice.name)}</td>
					<td>${esc(invoice.customer_display_name || invoice.customer || "")}
						${invoice.customer_company && invoice.customer_company !== invoice.customer
							? `<div class="text-muted small">${esc(invoice.customer_company)}</div>` : ""}</td>
					<td>${esc(invoice.medical_service || "")}</td>
					<td>${frappe.datetime.str_to_user(invoice.posting_date)}</td>
					<td>${esc(invoice.customer_token || "")}</td>
					<td class="text-right">${format_currency(invoice.rounded_total)}</td>
					<td>
						<button class="btn btn-sm btn-primary open-invoice-btn"
							data-id="${esc(invoice.name)}">
							${__("Open Invoice")}
						</button>
					</td>
				</tr>`
			)
			.join("");

		this.$container.html(`
			<table class="table table-bordered">
				<thead>
					<tr>
						<th>${__("ID")}</th>
						<th>${__("Customer Name")}</th>
						<th>${__("Service")}</th>
						<th>${__("Date")}</th>
						<th>${__("Token")}</th>
						<th class="text-right">${__("Amount")}</th>
						<th>${__("Action")}</th>
					</tr>
				</thead>
				<tbody>${rows}</tbody>
			</table>
		`);
	}
};
