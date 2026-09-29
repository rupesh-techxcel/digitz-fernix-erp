// Day Open
//
// A cashier starts their day at a registered counter PC: the page shows how the
// last day on this counter closed, the cashier counts the float now in the till
// (note by note, or as a total), and opens the day. Billing is blocked until then.
// After a handover the last close is the outgoing cashier's count, which the next
// cashier can take over as their float in one click.
// See digitz_erp.api.counter_session_api.

frappe.pages["day-open"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __("Day Open"), single_column: true });
	wrapper.day_open = new DayOpen(page);
};

frappe.pages["day-open"].on_page_show = function (wrapper) {
	wrapper.day_open && wrapper.day_open.load();
};

class DayOpen {
	constructor(page) {
		this.page = page;
		this.page.add_inner_button(__("Help"), () => frappe.set_route("digitz-help", "day-open"));
		if (!(window.digitz_erp && digitz_erp.dayops_styles && digitz_erp.CashCount)) {
			$(page.main).html(`<div class="text-center text-muted" style="padding: 60px 20px;">
				${__("This page needs the latest app scripts. Reload the browser (Ctrl+Shift+R) and open it again.")}</div>`);
			this.broken = true;
			return;
		}
		digitz_erp.dayops_styles();
		this.$body = $('<div class="dayops"></div>').appendTo(page.main);
	}

	money(v) {
		return format_currency(v, frappe.boot.sysdefaults.currency);
	}

	async load() {
		if (this.broken) {
			return;
		}
		this.page.clear_primary_action();
		this.page.clear_secondary_action();
		const r = await frappe.call({ method: "digitz_erp.api.counter_session_api.get_state" });
		this.state = r.message || {};
		this.render();
	}

	header() {
		const s = this.state;
		return `
			<div class="dayops-head">
				<div><div class="k">${__("Counter")}</div><div class="v">${frappe.utils.escape_html(s.counter || __("Unregistered"))}</div></div>
				<div><div class="k">${__("Device")}</div><div class="v">${frappe.utils.escape_html(s.device || "-")}</div></div>
				<div><div class="k">${__("Cashier")}</div><div class="v">${frappe.utils.escape_html(s.user_full_name || frappe.session.user)}</div></div>
				<div><div class="k">${__("Date")}</div><div class="v">${frappe.datetime.str_to_user(s.now)}</div></div>
			</div>`;
	}

	state_panel(title, text, button_label, action) {
		this.$body.html(`${this.header()}
			<div class="dayops-card dayops-state">
				<div class="dayops-big">${title}</div>
				<p>${text}</p>
				${button_label ? `<button class="btn btn-primary btn-sm dayops-go">${button_label}</button>` : ""}
			</div>`);
		this.$body.find(".dayops-go").on("click", action);
	}

	render() {
		const s = this.state;

		if (!s.counter) {
			return this.state_panel(
				__("This PC is not a registered counter"),
				s.can_register
					? __("Register it to a counter first. Every day opened here then belongs to that counter.")
					: __("Ask a supervisor to register this PC as a counter before opening the day."),
				s.can_register ? __("Register this device") : null,
				() => digitz_erp.open_register_device_dialog(s)
			);
		}

		if (s.session && s.session.status === "Closing") {
			return this.state_panel(
				__("Your last close is waiting for approval"),
				__("A supervisor has to approve the cash difference on {0} before a new day can be opened.", [s.session.name]),
				__("View Day Close"), () => frappe.set_route("day-close")
			);
		}

		if (s.session) {
			return this.state_panel(
				__("Your day is already open"),
				__("Open on {0} since {1}, with a float of {2}.",
					[frappe.utils.escape_html(s.session.counter), frappe.datetime.str_to_user(s.session.opened_on), this.money(s.session.opening_float)]),
				__("Go to Day Close"), () => frappe.set_route("day-close")
			);
		}

		if (s.counter_taken) {
			const t = s.counter_taken;
			return this.state_panel(
				__("{0} is in use", [frappe.utils.escape_html(s.counter)]),
				__("{0} has a day open here since {1} ({2}). They close it with Close & Hand Over, or a supervisor closes it for them from Day Close.",
					[frappe.utils.escape_html(t.cashier_name), frappe.datetime.str_to_user(t.opened_on), frappe.utils.escape_html(t.name)]),
				s.is_supervisor ? __("Go to Day Close") : null,
				() => frappe.set_route("day-close")
			);
		}

		const last = s.last_close;
		const closed_by = last && last.closed_by && last.closed_by !== last.cashier
			? `<tr><td>${__("Counted by supervisor")}</td><td class="dayops-num">${frappe.utils.escape_html(last.closed_by_name || last.closed_by)}</td></tr>`
			: "";
		const pending = last && last.status === "Closing"
			? `<div class="dayops-result over" style="margin-bottom: 10px;">${__("This close is still waiting for a supervisor to approve its difference. The count below is what was left in the till.")}</div>`
			: "";
		const previous = last
			? `
				${pending}
				<table class="dayops-lines">
					<tr><td>${__("Closed by")}</td><td class="dayops-num">${frappe.utils.escape_html(last.cashier_name || last.cashier)}</td></tr>
					<tr><td>${__("Closed on")}</td><td class="dayops-num">${frappe.datetime.str_to_user(last.closed_on)}</td></tr>
					${closed_by}
					<tr><td>${__("Session")}</td><td class="dayops-num"><a href="/app/counter-session/${encodeURIComponent(last.name)}">${frappe.utils.escape_html(last.name)}</a></td></tr>
					<tr><td>${__("Difference at close")}</td><td class="dayops-num">${this.money(last.difference)}</td></tr>
					<tr class="total"><td>${__("Cash left in the till")}</td><td class="dayops-num">${this.money(last.counted_cash)}</td></tr>
				</table>
				<p class="text-muted small" style="margin-top: 10px;">${__("Your opening float starts from this amount. Count the till: any change since (cash banked, added or taken out) shows below.")}</p>
				<button class="btn btn-default btn-sm dayops-takeover">${__("Take over this count")}</button>
				<p class="text-muted small" style="margin: 6px 0 0;">${__("For a handover: fills the count with what was left in the till. Check it against the notes before opening.")}</p>`
			: `<p class="text-muted">${__("No day has been closed on this counter yet.")}</p>`;

		this.$body.html(`${this.header()}
			<div class="dayops-grid">
				<div>
					<div class="dayops-card"><h4>${__("Previous Close on this Counter")}</h4>${previous}</div>
				</div>
				<div>
					<div class="dayops-card"><h4>${__("Count the Opening Cash")}</h4><div class="dayops-count-wrap"></div></div>
					<div class="dayops-card">
						<h4>${__("Opening Float")}</h4>
						<div class="float-field"></div>
						<div class="float-note"></div>
						<div class="remarks-field"></div>
						<button class="btn btn-primary btn-block dayops-submit" style="margin-top: 8px;">${__("Open Day")}</button>
					</div>
				</div>
			</div>`);

		this.float = frappe.ui.form.make_control({
			parent: this.$body.find(".float-field"),
			df: {
				fieldtype: "Currency", fieldname: "opening_float", label: __("Opening Float"), reqd: 1,
				description: __("Filled from the count, or type the total."),
				change: () => this.show_float_note(),
			},
			render_input: true,
		});
		this.float.set_value(last ? flt(last.counted_cash) : 0);

		this.remarks = frappe.ui.form.make_control({
			parent: this.$body.find(".remarks-field"),
			df: { fieldtype: "Small Text", fieldname: "remarks", label: __("Remarks") },
			render_input: true,
		});

		this.count = new digitz_erp.CashCount(this.$body.find(".dayops-count-wrap"), s.denominations, (total) => {
			if (total) {
				this.float.set_value(total);
			}
		});

		this.$body.find(".dayops-takeover").on("click", () => this.take_over());

		this.show_float_note();
		this.page.set_primary_action(__("Open Day"), () => this.open_day(), "check");
		this.$body.find(".dayops-submit").on("click", () => this.open_day());
	}

	take_over() {
		const last = this.state.last_close;
		if ((last.denominations || []).length) {
			this.count.set_counts(last.denominations);
		} else {
			this.float.set_value(flt(last.counted_cash));
		}
		if (!this.remarks.get_value()) {
			this.remarks.set_value(__("Taken over from {0} ({1})", [last.cashier_name || last.cashier, last.name]));
		}
	}

	show_float_note() {
		const last = this.state.last_close;
		const $note = this.$body.find(".float-note").empty();
		if (!last) {
			return;
		}
		const change = flt(this.float.get_value()) - flt(last.counted_cash);
		if (Math.abs(change) < 0.005) {
			$note.html(`<div class="dayops-result ok">${__("Same as the cash left at the last close")}</div>`);
		} else {
			$note.html(`<div class="dayops-result over">${change < 0
				? __("{0} less than the last close (cash taken out or banked)", [this.money(-change)])
				: __("{0} more than the last close (cash added)", [this.money(change)])}</div>`);
		}
	}

	open_day() {
		const float = flt(this.float.get_value());
		frappe.confirm(
			__("Open the day on {0} with a float of {1}?", [frappe.utils.escape_html(this.state.counter), this.money(float)]),
			() => frappe.call({
				method: "digitz_erp.api.counter_session_api.open_day",
				args: { opening_float: float, denominations: this.count.counted(), remarks: this.remarks.get_value() },
				freeze: true,
				freeze_message: __("Opening the day..."),
				callback: (r) => {
					if (!r.message) {
						return;
					}
					frappe.show_alert({ message: __("Day opened on {0} ({1})", [r.message.counter, r.message.session]), indicator: "green" });
					digitz_erp.refresh_counter_badge && digitz_erp.refresh_counter_badge();
					this.load();
				},
			})
		);
	}
}
