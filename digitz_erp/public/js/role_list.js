// Role list: open on the enabled roles only.
//
// The roles the Medical Center never assigns are disabled
// (digitz_erp/api/role_visibility.py), which hides them from the User form and
// Role Permission Manager but not from this master list. So the list opens
// filtered to Enabled each time; clear the filter to see the disabled ones.
// Applied on load rather than as a default filter, because a list the user has
// opened before restores its last filters and ignores the default.

frappe.listview_settings["Role"] = Object.assign(frappe.listview_settings["Role"] || {}, {
	onload(listview) {
		const has_disabled_filter = (listview.filters || []).some((f) => f[1] === "disabled");
		if (!has_disabled_filter) {
			listview.filter_area.add([["Role", "disabled", "=", 0]]);
		}
	},
});
