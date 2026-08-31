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

	// ------------------------------------------------------------ manual sync

	// Shared by the Sales Invoice Board and the Medical Center Dashboard, which
	// both carry a "Sync Now" button. The server runs the sync inline and hands
	// back a report, so the popup can say what actually happened.
	run_sync_now(on_done) {
		frappe.call({
			method: "digitz_erp.api.token_sync.run_token_sync_now",
			freeze: true,
			freeze_message: __("Syncing tokens..."),
			callback: (r) => {
				if (r.message) {
					this.show_sync_report(r.message);
				}

				if (on_done) {
					on_done(r.message);
				}
			},
		});
	},

	show_sync_report(report) {
		frappe.msgprint({
			title: __("Token Sync Result"),
			message: this.sync_report_html(report),
			wide: true,
		});
	},

	sync_report_html(report) {
		const esc = frappe.utils.escape_html;
		const totals = report.totals || {};
		const desks = report.desks || [];
		const retried = report.retried || [];

		const desk_error = desks.some((desk) => desk.error);
		const bad = !report.ok || totals.failed || desk_error;

		const parts = [];

		parts.push(`
			<div class="${bad ? "text-danger" : "text-success"}" style="font-weight:600;margin-bottom:8px;">
				${esc(this.sync_headline(report))}
			</div>
		`);

		if (report.message) {
			parts.push(`<p>${esc(report.message)}</p>`);
		}

		if (report.scheduler_inactive) {
			parts.push(`
				<p class="text-warning">
					${__("The scheduler is inactive, so tokens are not syncing automatically.")}
				</p>
			`);
		}

		if (report.url) {
			parts.push(`
				<div class="text-muted" style="margin-bottom:2px;">${__("Token URL")}</div>
				<div style="margin-bottom:10px;word-break:break-all;"><code>${esc(report.url)}</code></div>
			`);
		}

		if (report.ok && !desks.length) {
			parts.push(`<p class="text-muted">${__("No desks to poll. Check the Cashier records.")}</p>`);
		}

		desks.forEach((desk) => parts.push(this.sync_desk_html(desk)));

		if (retried.length) {
			parts.push(`<h5 style="margin-top:16px;">${__("Retried earlier tokens")}</h5>`);
			parts.push(this.sync_table_html(retried));
		}

		return parts.join("");
	},

	sync_headline(report) {
		if (!report.ok) {
			return __("Sync did not run");
		}

		const t = report.totals || {};

		return __("{0} fetched · {1} invoiced · {2} already done · {3} skipped · {4} failed", [
			t.fetched || 0,
			t.created || 0,
			t.already || 0,
			t.skipped || 0,
			t.failed || 0,
		]);
	},

	sync_desk_html(desk) {
		const esc = frappe.utils.escape_html;
		const parts = [];

		parts.push(`
			<h5 style="margin-top:16px;">
				${esc(desk.username || __("Unknown desk"))}
				<span class="text-muted" style="font-weight:normal;">
					&middot; ${__("{0} fetched", [desk.fetched || 0])}
				</span>
			</h5>
		`);

		if (desk.request_url) {
			parts.push(`
				<div style="margin-bottom:6px;word-break:break-all;">
					<code>${esc(desk.request_url)}</code>
				</div>
			`);
		}

		if (desk.error) {
			parts.push(`<p class="text-danger">${esc(desk.error)}</p>`);
		}

		if (desk.outcomes && desk.outcomes.length) {
			parts.push(this.sync_table_html(desk.outcomes));
		} else if (!desk.error) {
			parts.push(`<p class="text-muted">${__("No new tokens.")}</p>`);
		}

		return parts.join("");
	},

	sync_table_html(outcomes) {
		const esc = frappe.utils.escape_html;

		const rows = outcomes
			.map(
				(o) => `
					<tr>
						<td>${esc(String(o.token_number || ""))}</td>
						<td>${esc(o.customer_name || "")}</td>
						<td>${esc(o.service || "")}</td>
						<td>${this.sync_status_html(o)}</td>
						<td>${this.sync_details_html(o)}</td>
					</tr>
				`
			)
			.join("");

		return `
			<div class="table-responsive">
				<table class="table table-bordered table-condensed" style="margin-bottom:0;">
					<thead>
						<tr>
							<th>${__("Token")}</th>
							<th>${__("Person")}</th>
							<th>${__("Service")}</th>
							<th>${__("Status")}</th>
							<th>${__("Details")}</th>
						</tr>
					</thead>
					<tbody>${rows}</tbody>
				</table>
			</div>
		`;
	},

	sync_status_html(outcome) {
		const esc = frappe.utils.escape_html;
		const colour = {
			Completed: "green",
			"Already invoiced": "blue",
			Skipped: "orange",
			Failed: "red",
		}[outcome.status];

		return `<span class="indicator ${colour || "gray"}">${esc(outcome.status || "")}</span>`;
	},

	sync_details_html(outcome) {
		const esc = frappe.utils.escape_html;
		const bits = [];

		if (outcome.sales_invoice) {
			const name = esc(outcome.sales_invoice);
			bits.push(`<a href="/app/sales-invoice/${encodeURIComponent(outcome.sales_invoice)}">${name}</a>`);
		}

		if (outcome.reason) {
			bits.push(esc(outcome.reason));
		}

		// The log holds the full traceback for a failure; keep the popup short
		// and let the reader click through for the rest.
		if (outcome.log && outcome.status !== "Completed") {
			bits.push(
				`<a href="/app/medical-service-logs/${encodeURIComponent(outcome.log)}">${__("View log")}</a>`
			);
		}

		return bits.join(" &middot; ") || "&mdash;";
	},
};

$(document).on("app_ready", function () {
	digitz_erp.token_notifications.setup();
});
