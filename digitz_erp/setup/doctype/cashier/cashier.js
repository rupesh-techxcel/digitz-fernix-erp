// Copyright (c) 2026, Rupesh P and contributors
// For license information, please see license.txt

frappe.ui.form.on("Cashier", {
	refresh(frm) {
		const has_pin = Boolean(frm.doc.pin_hash);

		// The stored digest is hidden, so without this there is no way to tell
		// a cashier who can sign in from one who cannot.
		frm.dashboard.clear_headline();
		frm.dashboard.set_headline(
			has_pin
				? __("A PIN is set. Type a new one below to replace it.")
				: __("No PIN set — this cashier cannot sign in at a till yet.")
		);

		frm.set_df_property(
			"new_pin",
			"label",
			has_pin ? __("Replace PIN") : __("Set PIN")
		);
	},
});
