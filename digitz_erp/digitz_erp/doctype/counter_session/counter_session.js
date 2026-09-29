// Copyright (c) 2026, Rupesh P and contributors
// For license information, please see license.txt

// Sessions are opened and closed from the counter badge in the navbar
// (public/js/counter_device.js). This form is for reviewing them, and for a
// supervisor to approve a close whose count differs from the expected cash.

frappe.ui.form.on("Counter Session", {
	refresh(frm) {
		const status_colour = { Open: "green", Closing: "orange", Closed: "blue", Cancelled: "red" };
		frm.page.set_indicator(__(frm.doc.status), status_colour[frm.doc.status] || "gray");
		frm.add_custom_button(__("Help"), () => frappe.set_route("digitz-help", "counters-overview"));

		// A day is opened and closed only from Day Open / Day Close, never by
		// saving or submitting this form (the server refuses a bare submit too).
		// An amendment -- a corrected count of a cancelled close -- is the one
		// draft that is saved and submitted here.
		if (frm.doc.docstatus === 0 && !frm.doc.amended_from) {
			frm.disable_save();
		}

		if (frm.doc.docstatus === 0 && frm.doc.status === "Open") {
			frm.add_custom_button(__("Go to Day Close"), () => frappe.set_route("day-close"));
		}

		if (frm.doc.docstatus !== 0 || frm.doc.status !== "Closing") {
			return;
		}

		frm.dashboard.set_headline(
			__("The counted cash differs from the expected cash by {0}. Waiting for a supervisor.",
				[format_currency(frm.doc.difference, frappe.boot.sysdefaults.currency)]),
			flt(frm.doc.difference) < 0 ? "red" : "orange"
		);

		frappe.call({ method: "digitz_erp.api.counter_session_api.get_state" }).then((r) => {
			if (!(r.message && r.message.is_supervisor)) {
				return;
			}
			frm.add_custom_button(__("Approve & Close"), () => {
				frappe.confirm(
					__("Approve a difference of {0} and close this day?",
						[format_currency(frm.doc.difference, frappe.boot.sysdefaults.currency)]),
					() => frappe.call({
						method: "digitz_erp.api.counter_session_api.approve_close",
						args: { session: frm.doc.name },
						freeze: true,
						callback() {
							frappe.show_alert({ message: __("Day closed"), indicator: "green" });
							frm.reload_doc();
							digitz_erp.refresh_counter_badge && digitz_erp.refresh_counter_badge();
						},
					})
				);
			}).addClass("btn-primary");
		});
	},
});
