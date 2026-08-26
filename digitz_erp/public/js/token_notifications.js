// Desk-wide notifications for medical tokens synced into Sales Invoices.
//
// The server side sync (digitz_erp/api/token_sync.py) publishes a realtime
// event per batch of new invoices. This file subscribes once for the whole desk
// session so the toast appears no matter which page the user is on. Frappe's
// #alert-container is already fixed to the bottom right, so frappe.show_alert
// lands where we want it without extra CSS.

frappe.provide("digitz_erp.token_notifications");

digitz_erp.token_notifications = {
	EVENT: "digitz_token_invoice_created",
	ALERT_SECONDS: 8,

	// Invoice names already toasted this session. The board subscribes to the
	// same event, and a reconnecting socket can redeliver, so dedupe here.
	seen: new Set(),

	setup() {
		if (this.bound || !frappe.realtime) {
			return;
		}

		this.bound = true;
		frappe.realtime.on(this.EVENT, (data) => this.handle(data));
	},

	handle(data) {
		const invoices = (data && data.invoices) || [];
		const fresh = invoices.filter((inv) => inv && inv.sales_invoice && !this.seen.has(inv.sales_invoice));

		fresh.forEach((inv) => this.seen.add(inv.sales_invoice));

		if (!fresh.length) {
			return;
		}

		// A burst of tokens should not bury the screen in toasts.
		if (fresh.length > 3) {
			this.show_summary(fresh);
		} else {
			fresh.forEach((inv) => this.show_one(inv));
		}
	},

	show_one(invoice) {
		const esc = frappe.utils.escape_html;
		const token = invoice.token_number ? `Token ${esc(String(invoice.token_number))}` : "New token";
		const customer = esc(invoice.customer_name || invoice.customer || "");
		const service = esc(invoice.service || "");

		frappe.show_alert(
			{
				message: `${token} &mdash; ${customer}`,
				subtitle: service ? `${service} &middot; ${esc(invoice.sales_invoice)}` : esc(invoice.sales_invoice),
				indicator: "green",
			},
			this.ALERT_SECONDS
		);

		this.attach_open_action(invoice.sales_invoice);
	},

	show_summary(invoices) {
		frappe.show_alert(
			{
				message: __("{0} new invoices from tokens", [invoices.length]),
				subtitle: __("Open the Sales Invoice Board to work them"),
				indicator: "green",
			},
			this.ALERT_SECONDS
		);
	},

	// show_alert gives no handle on the element it created, so grab the last one
	// appended and make the whole toast a shortcut to the invoice.
	attach_open_action(invoice_name) {
		const $alert = $("#alert-container .desk-alert").last();

		if (!$alert.length) {
			return;
		}

		$alert.css("cursor", "pointer");
		$alert.on("click", (event) => {
			if ($(event.target).closest(".close").length) {
				return;
			}
			frappe.set_route("Form", "Sales Invoice", invoice_name);
		});
	},
};

$(document).on("app_ready", function () {
	digitz_erp.token_notifications.setup();
});
