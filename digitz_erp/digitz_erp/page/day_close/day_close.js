// Day Close
//
// A cashier ends their day: the page works out the cash the till should hold
// (float + cash sales + cash receipts - refunds - cash paid out, each expandable
// to the documents behind it), the cashier counts the till, and closes the day.
// A count that matches closes it; a difference waits for a supervisor, who
// approves it from the Pending Approvals list on this same page.
//
// Shift change: Close & Hand Over closes the day and logs the cashier out, so the
// next one can sign in on this PC and open with the counted cash. A supervisor
// also sees every other open day here and can count and close one for a cashier
// who has left.
// See digitz_erp.api.counter_session_api.
//
// The screen itself is digitz_erp.DayClose (public/js/day_ops.js), shared with
// the Cashier Console, which shows it as a tab.

frappe.pages["day-close"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __("Day Close"), single_column: true });
	if (!(window.digitz_erp && digitz_erp.DayClose)) {
		$(page.main).html(`<div class="text-center text-muted" style="padding: 60px 20px;">
			${__("This page needs the latest app scripts. Reload the browser (Ctrl+Shift+R) and open it again.")}</div>`);
		return;
	}
	wrapper.day_close = new digitz_erp.DayClose(page);
};

frappe.pages["day-close"].on_page_show = function (wrapper) {
	wrapper.day_close && wrapper.day_close.load();
};
