// Day Open
//
// A cashier starts their day at a registered counter PC: the page shows how the
// last day on this counter closed, the cashier counts the float now in the till
// (note by note, or as a total), and opens the day. Billing is blocked until then.
// After a handover the last close is the outgoing cashier's count, which the next
// cashier can take over as their float in one click.
// See digitz_erp.api.counter_session_api.
//
// The screen itself is digitz_erp.DayOpen (public/js/day_ops.js), shared with
// the Cashier Console, which shows it as a tab.

frappe.pages["day-open"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __("Day Open"), single_column: true });
	if (!(window.digitz_erp && digitz_erp.DayOpen)) {
		$(page.main).html(`<div class="text-center text-muted" style="padding: 60px 20px;">
			${__("This page needs the latest app scripts. Reload the browser (Ctrl+Shift+R) and open it again.")}</div>`);
		return;
	}
	wrapper.day_open = new digitz_erp.DayOpen(page);
};

frappe.pages["day-open"].on_page_show = function (wrapper) {
	wrapper.day_open && wrapper.day_open.load();
};
