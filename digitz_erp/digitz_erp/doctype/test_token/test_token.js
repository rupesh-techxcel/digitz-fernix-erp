// Test Token: one token for the token simulator (digitz_erp.api.token_simulator).
// Once saved, the form shows what the sync made of it: its Medical Service Log
// and Sales Invoice, or why it was skipped or failed.

frappe.ui.form.on("Test Token", {
	setup(frm) {
		frm.set_query("company", () => ({ filters: { company_id: ["is", "set"] } }));
		frm.set_query("cashier", () => ({ filters: { enabled: 1, username: ["is", "set"] } }));
	},

	refresh(frm) {
		frm.add_custom_button(__("Help"), () => frappe.set_route("digitz-help", "token-simulator"));
		if (frm.is_new()) {
			return;
		}

		frm.add_custom_button(__("Sync Now"), () =>
			digitz_erp.token_notifications.run_sync_now(() => frm.refresh())
		);

		frappe.call({
			method: "digitz_erp.api.token_simulator.get_token_result",
			args: { name: frm.doc.name },
		}).then((r) => {
			const log = r.message && r.message.log;
			const esc = frappe.utils.escape_html;
			if (!log) {
				frm.dashboard.set_headline(
					__("Not picked up yet. The sync fetches tokens dated today, after the last token it saw."), "blue"
				);
				return;
			}
			const link = (doctype, name) => `<a href="/app/${frappe.router.slug(doctype)}/${encodeURIComponent(name)}">${esc(name)}</a>`;
			let text = `${__("Log")} ${link("Medical Service Logs", log.name)}: <b>${esc(log.status)}</b>`;
			if (log.sales_invoice) {
				text += ` &middot; ${__("Invoice")} ${link("Sales Invoice", log.sales_invoice)}`;
			}
			if (log.error_message && log.status !== "Completed") {
				text += `<br><span class="text-muted">${esc(String(log.error_message).split("\n").filter(Boolean).pop())}</span>`;
			}
			frm.dashboard.set_headline(text, log.status === "Completed" ? "green" : log.status === "Failed" ? "red" : "orange");
		});
	},
});
