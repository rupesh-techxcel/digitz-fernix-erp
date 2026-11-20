// Drafts are archived every night; a System Manager can also run it now.
frappe.listview_settings["Archived Sales Invoice"] = {
	onload(listview) {
		if (!frappe.user.has_role("System Manager")) {
			return;
		}
		listview.page.add_inner_button(__("Archive Drafts Now"), () => {
			frappe.confirm(
				__("Archive every draft Sales Invoice not changed and dated more than 48 hours ago? They are removed from Sales Invoice and kept here."),
				() => frappe.call({
					method: "digitz_erp.api.draft_archive.archive_drafts_now",
					freeze: true,
					freeze_message: __("Archiving drafts..."),
					callback: (r) => {
						const m = r.message || {};
						frappe.msgprint(__("{0} drafts archived, {1} could not be (see the Error Log).", [m.archived || 0, m.failed || 0]));
						listview.refresh();
					},
				})
			);
		});
	},
};
