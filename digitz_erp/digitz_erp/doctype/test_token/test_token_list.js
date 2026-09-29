// Test Token list: the token simulator's control panel.
//
// Add tokens here (or Generate Test Tokens), point Settings > Token URL at the
// simulator, and Sync Now: the sync fetches these tokens from
// digitz_erp.api.token_simulator.feed exactly as it would from the real service
// and raises the Sales Invoices.

const SIMULATOR_API = "digitz_erp.api.token_simulator.";

frappe.listview_settings["Test Token"] = {
	onload(listview) {
		listview.page.add_inner_button(__("Generate Test Tokens"), () => generate_dialog(listview));
		listview.page.add_inner_button(__("Sync Now"), () =>
			digitz_erp.token_notifications.run_sync_now(() => listview.refresh())
		);
		listview.page.add_menu_item(__("Use Simulator URL"), () => use_simulator(listview));
		listview.page.add_menu_item(__("Restore Token URL"), () => restore_url(listview));
		listview.page.add_menu_item(__("Help"), () => frappe.set_route("digitz-help", "token-simulator"));
		show_status(listview);
	},
};

function show_status(listview) {
	frappe.call({ method: SIMULATOR_API + "get_status" }).then((r) => {
		const s = r.message;
		if (!s) {
			return;
		}
		const esc = frappe.utils.escape_html;
		let html, colour;
		if (!s.enabled) {
			colour = "red";
			html = __("The simulator is off on this site: it needs developer_mode, or token_simulator_enabled in site_config.json.");
		} else if (!s.using_simulator) {
			colour = "orange";
			html = __("Token URL is not the simulator ({0}). Use the menu: Use Simulator URL.", [esc(s.token_url || __("empty"))]);
		} else if (!s.sync_enabled) {
			colour = "orange";
			html = __("Token URL is the simulator, but Enable Token Sync is off in Settings.");
		} else {
			colour = "green";
			html = __("Token URL is the simulator: {0}. The sync picks these tokens up every minute, or click Sync Now.", [esc(s.token_url)]);
		}
		if (s.enabled && s.site_by_name) {
			html += " " + __("This site is reached by its own name, which must resolve on this server (e.g. through /etc/hosts).");
		}
		listview.page.wrapper.find(".tt-status").remove();
		$(`<div class="tt-status alert alert-${colour === "green" ? "success" : colour === "red" ? "danger" : "warning"}"
			style="margin: 0 0 10px;">${html}</div>`).prependTo(listview.page.main.find(".frappe-list").first().parent());
	});
}

function generate_dialog(listview) {
	const d = new frappe.ui.Dialog({
		title: __("Generate Test Tokens"),
		fields: [
			{ fieldtype: "Int", fieldname: "count", label: __("How many"), default: 5, reqd: 1,
				description: __("Up to 50, dated now, a millisecond apart.") },
			{ fieldtype: "Link", fieldname: "cashier", options: "User", label: __("Cashier"),
				description: __("Empty spreads them over every Cashier with a username.") },
			{ fieldtype: "Percent", fieldname: "company_share", label: __("Company tokens (%)"), default: 30,
				description: __("The share billed to an existing company customer; the rest are walk-ins.") },
		],
		primary_action_label: __("Generate"),
		primary_action(values) {
			frappe.call({
				method: SIMULATOR_API + "generate_tokens",
				args: { count: values.count, cashier: values.cashier, company_share: (values.company_share || 0) / 100 },
				freeze: true,
				callback(r) {
					d.hide();
					frappe.show_alert({ message: __("{0} test tokens added", [r.message.created.length]), indicator: "green" });
					listview.refresh();
				},
			});
		},
	});
	d.show();
}

function use_simulator(listview) {
	frappe.call({ method: SIMULATOR_API + "get_status" }).then((r) => {
		const s = r.message;
		frappe.confirm(
			__("Set Settings > Token URL to {0} and enable token sync?", [`<br><code>${frappe.utils.escape_html(s.simulator_url)}</code><br>`]) +
				(s.token_url && !s.using_simulator
					? "<br>" + __("The current URL is kept, and Restore Token URL puts it back.")
					: ""),
			() => frappe.call({ method: SIMULATOR_API + "use_simulator", args: { enable_sync: 1 } }).then(() => {
				frappe.show_alert({ message: __("Token sync now reads the simulator"), indicator: "green" });
				show_status(listview);
			})
		);
	});
}

function restore_url(listview) {
	frappe.call({ method: SIMULATOR_API + "get_status" }).then((r) => {
		const previous = r.message.previous_url;
		frappe.confirm(
			previous
				? __("Put the Token URL back to {0}?", [`<code>${frappe.utils.escape_html(previous)}</code>`])
				: __("No earlier Token URL was saved. Clear the Token URL?"),
			() => frappe.call({ method: SIMULATOR_API + "restore_token_url" }).then(() => {
				frappe.show_alert({ message: __("Token URL restored"), indicator: "green" });
				show_status(listview);
			})
		);
	});
}
