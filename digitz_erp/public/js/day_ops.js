// Day Open, Day Close and Day History: the cashier's shift.
//
// Shared so the same screens run in two places: on their own pages (day-open,
// day-close), which own the page header, and embedded as tabs of the Cashier
// Console, where the console owns the header and the screens only render into
// their pane. `opts.embedded` switches between the two.
// See digitz_erp.api.counter_session_api.

frappe.provide("digitz_erp");

digitz_erp.DayOpsBase = class DayOpsBase {
	// opts.parent:    element to render into (default: the page body)
	// opts.embedded:  leave the page header alone; links stay in the Cashier Console
	// opts.on_change: called after the day's state changed (opened, closed, approved)
	constructor(page, opts = {}, help_route = null) {
		this.page = page;
		this.opts = opts;
		this.embedded = !!opts.embedded;
		this.$parent = $(opts.parent || page.main);

		if (!this.embedded && help_route) {
			page.add_inner_button(__("Help"), () => frappe.set_route("digitz-help", help_route));
		}
		digitz_erp.dayops_styles();
		this.$body = $('<div class="dayops"></div>').appendTo(this.$parent);
	}

	money(v) {
		return format_currency(v, frappe.boot.sysdefaults.currency);
	}

	esc(v) {
		return frappe.utils.escape_html(v == null ? "" : String(v));
	}

	// The in-pane buttons cover every action, so the header buttons are only an
	// extra on the standalone pages.
	set_primary(label, action, icon) {
		!this.embedded && this.page.set_primary_action(label, action, icon);
	}

	set_secondary(label, action) {
		!this.embedded && this.page.set_secondary_action(label, action);
	}

	clear_actions() {
		if (!this.embedded) {
			this.page.clear_primary_action();
			this.page.clear_secondary_action();
		}
	}

	// target: "day-open" or "day-close", which are also the console's tab keys
	go(target) {
		this.embedded ? frappe.set_route("cashier-console", target) : frappe.set_route(target);
	}

	changed() {
		digitz_erp.refresh_counter_badge && digitz_erp.refresh_counter_badge();
		this.opts.on_change && this.opts.on_change();
	}

	static print_slip(session) {
		window.open(frappe.urllib.get_full_url(
			`/printview?doctype=${encodeURIComponent("Counter Session")}&name=${encodeURIComponent(session)}&format=${encodeURIComponent("Day Close Slip")}&trigger_print=1`
		));
	}
};

digitz_erp.DayOpen = class DayOpen extends digitz_erp.DayOpsBase {
	constructor(page, opts) {
		super(page, opts, "day-open");
	}

	async load() {
		this.clear_actions();
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
				__("View Day Close"), () => this.go("day-close")
			);
		}

		if (s.session) {
			return this.state_panel(
				__("Your day is already open"),
				__("Open on {0} since {1}, with a float of {2}.",
					[frappe.utils.escape_html(s.session.counter), frappe.datetime.str_to_user(s.session.opened_on), this.money(s.session.opening_float)]),
				__("Go to Day Close"), () => this.go("day-close")
			);
		}

		if (s.counter_taken) {
			const t = s.counter_taken;
			return this.state_panel(
				__("{0} is in use", [frappe.utils.escape_html(s.counter)]),
				__("{0} has a day open here since {1} ({2}). They close it with Close & Hand Over, or a supervisor closes it for them from Day Close.",
					[frappe.utils.escape_html(t.cashier_name), frappe.datetime.str_to_user(t.opened_on), frappe.utils.escape_html(t.name)]),
				s.is_supervisor ? __("Go to Day Close") : null,
				() => this.go("day-close")
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

		// Settings can hide the previous close for a blind count: then the count and
		// the float take the two columns
		const count_card = `<div class="dayops-card"><h4>${__("Count the Opening Cash")}</h4><div class="dayops-count-wrap"></div></div>`;
		this.$body.html(`${this.header()}
			<div class="dayops-grid">
				<div>
					${s.show_last_close === 0 ? count_card : `<div class="dayops-card"><h4>${__("Previous Close on this Counter")}</h4>${previous}</div>`}
				</div>
				<div>
					${s.show_last_close === 0 ? "" : count_card}
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
		this.set_primary(__("Open Day"), () => this.open_day(), "check");
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
					this.changed();
					this.load();
				},
			})
		);
	}
};

digitz_erp.DayClose = class DayClose extends digitz_erp.DayOpsBase {
	constructor(page, opts) {
		super(page, opts, "day-close");
	}

	async load() {
		this.clear_actions();
		const r = await frappe.call({ method: "digitz_erp.api.counter_session_api.get_state" });
		this.state = r.message || {};

		// A supervisor sees every counter's day side by side (render_board); a
		// cashier counts their own till blind
		if (this.state.is_supervisor) {
			this.render_board();
			return;
		}
		const session = this.state.session;
		if (session && session.status === "Open") {
			this.render_close();
		} else {
			this.render_state();
		}
	}

	header(extra) {
		const s = this.state;
		return `
			<div class="dayops-head">
				<div><div class="k">${__("Counter")}</div><div class="v">${this.esc(s.counter || (s.session && s.session.counter) || "-")}</div></div>
				<div><div class="k">${__("Device")}</div><div class="v">${this.esc(s.device || "-")}</div></div>
				<div><div class="k">${__("Cashier")}</div><div class="v">${this.esc(s.user_full_name)}</div></div>
				${extra || ""}
			</div>`;
	}

	render_state() {
		const s = this.state;
		let title, text, label, action;

		if (s.session && s.session.status === "Closing") {
			title = __("Waiting for supervisor approval");
			text = __("Your count for {0} is with a supervisor. They approve it before the day is closed.", [this.esc(s.session.name)]);
			label = __("View Session");
			action = () => frappe.set_route("Form", "Counter Session", s.session.name);
		} else {
			title = __("No day is open");
			text = __("Open the day with the cash in the till before billing. The day is closed from here at the end of your shift.");
			label = s.counter ? __("Go to Day Open") : null;
			action = () => this.go("day-open");
		}

		this.$body.html(`${this.header()}
			<div class="dayops-card dayops-state">
				<div class="dayops-big">${title}</div>
				<p>${text}</p>
				${label ? `<button class="btn btn-primary btn-sm dayops-go">${label}</button>` : ""}
			</div>`);
		this.$body.find(".dayops-go").on("click", action);
	}

	// A blind close, for cashiers and supervisors alike: the page asks for the
	// count (cash, then card, bank and other modes) and never shows the day's
	// sales or the expected cash. Supervisors check the figures afterwards.
	render_close() {
		const session = this.state.session;
		const modes = this.state.payment_modes || [];

		this.$body.html(`${this.header(`
				<div><div class="k">${__("Session")}</div><div class="v"><a href="/app/counter-session/${encodeURIComponent(session.name)}">${this.esc(session.name)}</a></div></div>
				<div><div class="k">${__("Opened")}</div><div class="v">${frappe.datetime.str_to_user(session.opened_on)}</div></div>`)}
			<div class="dayops-grid${modes.length ? " dayops-grid-3" : ""}">
				<div>
					<div class="dayops-card"><h4>${__("Count the Closing Cash")}</h4><div class="dayops-count-wrap"></div></div>
				</div>
				${modes.length ? `<div>
					<div class="dayops-card">
						<h4>${__("Card, Bank & Other Payments")}</h4>
						<p class="text-muted small" style="margin: 0 0 8px;">${__("Enter today's total for each, from the card machine settlement or bank slips.")}</p>
						<div class="dayops-modes"></div>
					</div>
				</div>` : ""}
				<div>
					<div class="dayops-card">
						<h4>${__("Close")}</h4>
						<div class="expenditure-field"></div>
						<div class="counted-field"></div>
						<div class="remarks-field"></div>
						<button class="btn btn-primary btn-block dayops-submit" style="margin-top: 8px;">${__("Close Day")}</button>
						<button class="btn btn-default btn-block dayops-handover" style="margin-top: 6px;">${__("Close & Hand Over")}</button>
						<p class="text-muted small" style="margin: 6px 0 0;">${__("Hand Over closes your day and logs you out, so the next cashier can sign in here and open with this count.")}</p>
					</div>
				</div>
			</div>`);

		this.mode_controls = modes.map((m) => ({
			payment_mode: m.payment_mode,
			control: frappe.ui.form.make_control({
				parent: this.$body.find(".dayops-modes"),
				df: { fieldtype: "Currency", fieldname: frappe.scrub(m.payment_mode), label: m.payment_mode },
				render_input: true,
			}),
		}));
		this.expenditure = frappe.ui.form.make_control({
			parent: this.$body.find(".expenditure-field"),
			df: {
				fieldtype: "Currency", fieldname: "expenditure", label: __("Expenditure"),
				description: __("Cash paid out of the till today. Explain it in Remarks."),
			},
			render_input: true,
		});
		this.counted = frappe.ui.form.make_control({
			parent: this.$body.find(".counted-field"),
			df: {
				fieldtype: "Currency", fieldname: "counted_cash", label: __("Counted Cash"), reqd: 1,
				description: __("Filled from the count, or type the total."),
			},
			render_input: true,
		});
		this.remarks = frappe.ui.form.make_control({
			parent: this.$body.find(".remarks-field"),
			df: { fieldtype: "Small Text", fieldname: "remarks", label: __("Remarks"),
				description: __("Anything the supervisor should know about the count.") },
			render_input: true,
		});
		this.count = new digitz_erp.CashCount(this.$body.find(".dayops-count-wrap"), this.state.denominations, (total) => {
			if (total) {
				this.counted.set_value(total);
			}
		});

		this.set_primary(__("Close Day"), () => this.close_day(), "check");
		this.$body.find(".dayops-submit").on("click", () => this.close_day());
		this.$body.find(".dayops-handover").on("click", () => this.close_day(true));
		this.set_secondary(__("Refresh"), () => this.load());
	}

	// [{payment_mode, amount}] for the modes given an amount
	payment_totals() {
		return (this.mode_controls || [])
			.map((m) => ({ payment_mode: m.payment_mode, amount: m.control.get_value() }))
			.filter((m) => m.amount !== undefined && m.amount !== null && m.amount !== "");
	}

	close_day(handover) {
		const counted = this.counted.get_value();
		if (counted === undefined || counted === null || counted === "") {
			frappe.msgprint(__("Count the till, or enter the counted cash."));
			return;
		}
		const spent = flt(this.expenditure.get_value());
		if (spent < 0) {
			frappe.msgprint(__("Expenditure cannot be negative."));
			return;
		}
		const totals = this.payment_totals();
		if (totals.some((m) => flt(m.amount) < 0)) {
			frappe.msgprint(__("Payment totals cannot be negative."));
			return;
		}
		const with_spent = spent ? " " + __("Expenditure: {0}.", [this.money(spent)]) : "";
		frappe.confirm(
			(handover
				? __("Close your day with {0} counted in the till and log out for the next cashier?", [this.money(counted)])
				: __("Close the day with {0} counted in the till?", [this.money(counted)])) + with_spent,
			() => frappe.call({
				method: "digitz_erp.api.counter_session_api.close_day",
				args: {
					counted_cash: counted,
					denominations: this.count.counted(),
					remarks: this.remarks.get_value(),
					expenditure: flt(this.expenditure.get_value()),
					payment_totals: totals,
				},
				freeze: true,
				freeze_message: __("Closing the day..."),
				callback: (r) => {
					if (!r.message) {
						return;
					}
					this.changed();
					this.show_closed(r.message, handover);
				},
			})
		);
	}

	show_closed(result, handover) {
		this.clear_actions();
		const closed = result.status === "Closed";
		const next = handover
			? `<button class="btn btn-primary btn-sm dayops-logout" style="margin-left: 6px;">${__("Log Out for Next Cashier")}</button>`
			: `<button class="btn btn-default btn-sm dayops-open" style="margin-left: 6px;">${__("Go to Day Open")}</button>`;
		this.$body.html(`${this.header()}
			<div class="dayops-card dayops-state">
				<div class="dayops-big">${closed ? __("Day closed") : __("Close sent for approval")}</div>
				<p>${closed
					? __("{0} is closed.", [this.esc(result.session)])
					: __("{0} will close once a supervisor approves the count.", [this.esc(result.session)])}
				${handover ? "<br>" + __("The counter is free: the next cashier can sign in on this PC and open with your count.") : ""}</p>
				<button class="btn ${handover ? "btn-default" : "btn-primary"} btn-sm dayops-print">${__("Print Day Close Slip")}</button>
				${next}
			</div>`);
		this.$body.find(".dayops-print").on("click", () => this.print(result.session));
		this.$body.find(".dayops-open").on("click", () => this.go("day-open"));
		this.$body.find(".dayops-logout").on("click", () => frappe.app.logout());
	}

	print(session) {
		digitz_erp.DayOpsBase.print_slip(session);
	}

	// ------------------------------------------------------- supervisor's board
	// Every counter's day for a date, one column per session and the totals
	// last: the system's figures next to what each cashier entered. From here a
	// supervisor closes a day for a cashier (or their own), approves a count, and
	// reopens a closed day to correct it. See counter_session_api.build_day_overview.

	async render_board(date) {
		this.board_date = date || this.board_date || frappe.datetime.get_today();
		const r = await frappe.call({
			method: "digitz_erp.api.counter_session_api.get_day_overview",
			args: { date: this.board_date },
		});
		const o = (this.overview = r.message);
		const sessions = o.sessions || [];
		const count = (status) => sessions.filter((x) => x.status === status).length;
		const pill = (status) => `<span class="indicator-pill ${{ Open: "green", Closing: "orange", Closed: "blue" }[status] || "gray"}">${status === "Closing" ? __("Awaiting Approval") : __(status)}</span>`;
		const time = (dt) => (dt ? moment(dt).format("hh:mm A") : "");

		const head = sessions.map((x) => `
			<th class="dcb-col">
				<div class="dcb-counter">${this.esc(x.counter)}</div>
				<div class="dcb-cashier">${this.esc(x.cashier_name)}</div>
				<div><a href="/app/counter-session/${encodeURIComponent(x.name)}">${this.esc(x.name)}</a></div>
				<div class="dcb-time">${time(x.opened_on)} → ${x.closed_on ? time(x.closed_on) : __("open")}</div>
				${x.carried_over ? `<div class="dcb-note">${__("Opened {0}", [frappe.datetime.str_to_user(String(x.opened_on).split(" ")[0])])}</div>` : ""}
				${x.amended_from ? `<div class="dcb-note">${__("Corrects {0}", [this.esc(x.amended_from)])}</div>` : ""}
				<div style="margin-top: 4px;">${pill(x.status)}</div>
			</th>`).join("");

		const cell = (v, kind) => {
			if (v === null || v === undefined) {
				return `<td class="dayops-num text-muted">—</td>`;
			}
			const cls = kind === "difference" && Math.abs(v) >= 0.005 ? (v < 0 ? "is-short" : "is-over") : "";
			return `<td class="dayops-num ${cls}">${this.money(v)}</td>`;
		};
		const body = (o.lines || []).map((ln) => ln.kind === "section"
			? `<tr class="dcb-section"><td colspan="${sessions.length + 2}">${this.esc(ln.label)}</td></tr>`
			: `<tr class="dcb-${ln.kind}"><td>${this.esc(ln.label)}</td>${ln.values.map((v) => cell(v, ln.kind)).join("")}
				${cell(ln.total, ln.kind).replace("<td class=\"", "<td class=\"dcb-total ")}</tr>`
		).join("");

		const actions = sessions.map((x) => {
			const b = (action, label, cls = "btn-default") =>
				`<button class="btn btn-xs ${cls}" data-act="${action}" data-name="${this.esc(x.name)}">${label}</button>`;
			const buttons = {
				Open: b("close", x.is_own ? __("Close My Day") : __("Count & Close"), "btn-primary"),
				Closing: b("approve", __("Approve"), "btn-primary") + b("edit", __("Edit")),
				Closed: b("edit", __("Reopen & Edit")) + b("slip", __("Print Slip")),
			}[x.status] || "";
			return `<td class="dcb-actions">${buttons}</td>`;
		}).join("");
		const remarks = sessions.map((x) => `<td class="dcb-remarks" title="${this.esc(x.close_remarks)}">${this.esc(x.close_remarks)}</td>`).join("");

		this.$body.html(`
			<div class="dayops-card dcb-toolbar">
				<div class="dcb-date"></div>
				<div class="dcb-chips">
					<button class="dcb-chip" data-day="${frappe.datetime.get_today()}">${__("Today")}</button>
					<button class="dcb-chip" data-day="${frappe.datetime.add_days(frappe.datetime.get_today(), -1)}">${__("Yesterday")}</button>
				</div>
				<div class="dcb-summary text-muted">
					${__("{0} days", [sessions.length])} · ${__("{0} open", [count("Open")])} · ${__("{0} awaiting approval", [count("Closing")])} · ${__("{0} closed", [count("Closed")])}
				</div>
				<div class="dcb-buttons">
					<button class="btn btn-default btn-sm" data-tool="refresh">${__("Refresh")}</button>
					${frappe.user.has_role("System Manager") ? `<button class="btn btn-default btn-sm" data-tool="excel">${__("Export to Excel")}</button>` : ""}
					<button class="btn btn-primary btn-sm" data-tool="print">${__("Print Summary")}</button>
				</div>
			</div>
			${sessions.length ? `
			<div class="dayops-card dcb-card">
				<div class="dcb-scroll">
					<table class="dcb-grid">
						<thead><tr><th></th>${head}<th class="dcb-col dcb-total">${__("Total")}</th></tr></thead>
						<tbody>${body}</tbody>
						<tfoot>
							<tr><td>${__("Remarks")}</td>${remarks}<td class="dcb-total"></td></tr>
							<tr><td></td>${actions}<td class="dcb-total"></td></tr>
						</tfoot>
					</table>
				</div>
				<p class="text-muted small" style="margin: 8px 0 0;">${__("System is what the submitted documents add up to; Entered is what the cashier counted or typed at Day Close. A day still open shows its live figures, with nothing entered yet.")}</p>
			</div>` : `
			<div class="dayops-card dayops-state"><div class="dayops-big">${__("No days")}</div><p>${__("No day was opened on any counter on this date.")}</p></div>`}
		`);

		this.board_date_control = frappe.ui.form.make_control({
			parent: this.$body.find(".dcb-date"),
			df: { fieldtype: "Date", fieldname: "date", label: __("Date"),
				change: () => {
					const value = this.board_date_control.get_value();
					value && value !== this.board_date && this.render_board(value);
				} },
			render_input: true,
		});
		this.board_date_control.set_value(this.board_date);
		this.$body.find(".dcb-chip").each((_, el) => el.classList.toggle("active", el.dataset.day === this.board_date));
		this.$body.find("[data-day]").on("click", (e) => this.render_board($(e.currentTarget).attr("data-day")));
		this.$body.find("[data-tool]").on("click", (e) => {
			const tool = $(e.currentTarget).attr("data-tool");
			if (tool === "refresh") {
				this.render_board();
			} else if (tool === "excel") {
				window.open(`/api/method/digitz_erp.api.counter_session_api.export_day_overview?date=${encodeURIComponent(this.board_date)}`);
			} else {
				this.print_summary();
			}
		});
		this.$body.find("[data-act]").on("click", (e) => {
			const name = $(e.currentTarget).attr("data-name");
			const x = sessions.find((row) => row.name === name);
			const act = $(e.currentTarget).attr("data-act");
			if (act === "slip") {
				this.print(name);
			} else if (act === "approve") {
				this.approve(x);
			} else {
				this.count_dialog(x, act);
			}
		});

		this.set_primary(__("Print Summary"), () => this.print_summary(), "printer");
		this.set_secondary(__("Refresh"), () => this.render_board());
	}

	async print_summary() {
		const r = await frappe.call({
			method: "digitz_erp.api.counter_session_api.get_day_summary_html",
			args: { date: this.board_date },
		});
		const w = window.open("", "_blank");
		if (!w) {
			frappe.msgprint(__("Allow pop-ups for this site to print the summary."));
			return;
		}
		w.document.open();
		w.document.write(r.message);
		w.document.close();
	}

	approve(x) {
		frappe.confirm(
			__("Approve {0}'s count (difference {1}) and close the day?", [this.esc(x.cashier_name), this.money(x.difference)]),
			() => frappe.call({
				method: "digitz_erp.api.counter_session_api.approve_close",
				args: { session: x.name },
				freeze: true,
				callback: () => {
					frappe.show_alert({ message: __("{0} closed", [x.name]), indicator: "green" });
					this.changed();
					this.render_board();
				},
			})
		);
	}

	// Count a day for the cashier (act "close"), or correct a counted one ("edit":
	// a close awaiting approval in place, a closed day by reopening it)
	count_dialog(x, act) {
		const editing = act === "edit";
		const modes = this.overview.modes || [];
		const needs_reason = editing || !x.is_own;
		// The expected cash before any expenditure, which the dialog may change
		const before_spent = flt(x.expected_cash) + flt(x.cash_expenditure);
		const d = new frappe.ui.Dialog({
			title: editing
				? __("Correct {0}'s day on {1}", [this.esc(x.cashier_name), this.esc(x.counter)])
				: __("Close {0}'s day on {1}", [this.esc(x.cashier_name), this.esc(x.counter)]),
			size: "large",
			fields: [
				{ fieldtype: "HTML", fieldname: "summary",
					options: `<p>${__("Expected cash in the till")}: <b class="sv-expected"></b>
						<span class="text-muted">(${__("float")} ${this.money(x.opening_float)})</span></p>` },
				{ fieldtype: "Currency", fieldname: "expenditure", label: __("Expenditure"),
					default: editing ? x.cash_expenditure : undefined,
					description: __("Cash paid out of the till."), change: () => show_result() },
				{ fieldtype: "HTML", fieldname: "count_wrap" },
				{ fieldtype: "Column Break" },
				{ fieldtype: "Currency", fieldname: "counted_cash", label: __("Counted Cash"), reqd: 1,
					default: editing ? x.counted_cash : undefined,
					description: __("Filled from the count, or type the total."), change: () => show_result() },
				{ fieldtype: "HTML", fieldname: "result" },
				...modes.map((m, i) => ({
					fieldtype: "Currency", fieldname: `mode_${i}`, label: m.payment_mode,
					default: editing ? x.modes[m.payment_mode].entered : undefined,
					description: __("System: {0}", [this.money(x.modes[m.payment_mode].system)]),
				})),
				{ fieldtype: "Small Text", fieldname: "remarks", label: editing ? __("Reason for the correction") : __("Reason"),
					reqd: needs_reason ? 1 : 0,
					description: editing
						? __("Added to the day's remarks with your name. The original close stays on record.")
						: __("Why you are closing this day for the cashier. Shown on the Day Close slip.") },
			],
			primary_action_label: editing ? (x.status === "Closed" ? __("Reopen & Save") : __("Save & Approve")) : __("Count & Close"),
			primary_action: (values) => {
				frappe.call({
					method: editing
						? "digitz_erp.api.counter_session_api.edit_close"
						: "digitz_erp.api.counter_session_api.supervisor_close",
					args: {
						session: x.name,
						counted_cash: values.counted_cash,
						denominations: count.counted(),
						remarks: values.remarks,
						expenditure: flt(values.expenditure),
						payment_totals: modes
							.map((m, i) => ({ payment_mode: m.payment_mode, amount: values[`mode_${i}`] }))
							.filter((m) => m.amount !== undefined && m.amount !== null && m.amount !== ""),
					},
					freeze: true,
					freeze_message: editing ? __("Saving the correction...") : __("Closing the day..."),
					callback: (r) => {
						if (!r.message) {
							return;
						}
						d.hide();
						frappe.show_alert({ message: __("{0} closed", [r.message.session]), indicator: "green" });
						this.changed();
						this.render_board();
					},
				});
			},
		});

		const show_result = () => {
			const expected = before_spent - flt(d.get_value("expenditure"));
			d.fields_dict.summary.$wrapper.find(".sv-expected").text(this.money(expected));
			const counted = d.get_value("counted_cash");
			const $r = d.fields_dict.result.$wrapper.empty();
			if (counted === undefined || counted === null || counted === "") {
				return;
			}
			const diff = flt(counted) - expected;
			$r.html(Math.abs(diff) < 0.005
				? `<div class="dayops-result ok">${__("Matches the expected cash.")}</div>`
				: `<div class="dayops-result ${diff < 0 ? "short" : "over"}">
					${diff < 0 ? __("Short by {0}", [this.money(-diff)]) : __("Over by {0}", [this.money(diff)])}
					<div style="font-weight: normal; font-size: 12px; margin-top: 4px;">${__("Saving approves this difference in your name.")}</div>
				</div>`);
		};

		const count = new digitz_erp.CashCount(d.fields_dict.count_wrap.$wrapper, this.overview.denominations, (total) => {
			if (total) {
				d.set_value("counted_cash", total);
			}
		});
		if (editing && x.denominations.length) {
			count.set_counts(x.denominations);
		}
		d.show();
		show_result();
	}
};

// ------------------------------------------------------------- day history
// Past days in a date range: a cashier's own, or every cashier's for a
// supervisor (the server decides, see get_session_history). Shown in the
// Cashier Console; the full Counter Session Summary report has the same data.

digitz_erp.DayHistory = class DayHistory {
	static STATUS_COLOURS = { Open: "green", Closing: "orange", Closed: "gray" };

	constructor(parent) {
		this.$el = $('<div class="cc-history"></div>').appendTo(parent);
		this.is_supervisor = false;
		this.reload = frappe.utils.debounce(() => this.load(), 300);
		this.make();
	}

	money(v) {
		return format_currency(v, frappe.boot.sysdefaults.currency);
	}

	esc(v) {
		return frappe.utils.escape_html(v == null ? "" : String(v));
	}

	make() {
		this.$el.html(`
			<div class="cc-hist-filters">
				<div class="cc-hist-fields"></div>
				<div class="cc-hist-chips">
					<button type="button" class="cc-hist-chip" data-range="today">${__("Today")}</button>
					<button type="button" class="cc-hist-chip" data-range="week">${__("This Week")}</button>
					<button type="button" class="cc-hist-chip" data-range="month">${__("This Month")}</button>
					<button type="button" class="cc-hist-chip" data-range="30">${__("Last 30 Days")}</button>
				</div>
			</div>
			<div class="cc-hist-tiles"></div>
			<div class="cc-hist-table"></div>
		`);

		const $fields = this.$el.find(".cc-hist-fields");
		const field = (df, cls) => {
			const $wrap = $(`<div class="cc-hist-field ${cls || ""}"></div>`).appendTo($fields);
			const control = frappe.ui.form.make_control({
				parent: $wrap,
				df: { ...df, change: () => this.reload() },
				render_input: true,
			});
			return control;
		};

		const today = frappe.datetime.get_today();
		this.fields = {
			from_date: field({ fieldtype: "Date", fieldname: "from_date", label: __("From") }),
			to_date: field({ fieldtype: "Date", fieldname: "to_date", label: __("To") }),
			status: field({
				fieldtype: "Select", fieldname: "status", label: __("Status"),
				options: [
					{ value: "", label: __("All") },
					{ value: "Open", label: __("Open") },
					{ value: "Closing", label: __("Awaiting Approval") },
					{ value: "Closed", label: __("Closed") },
				],
			}),
			// Supervisor-only; shown once the server confirms the role
			counter: field({ fieldtype: "Link", fieldname: "counter", label: __("Counter"), options: "Counter" }, "cc-hist-sup hide"),
			cashier: field({ fieldtype: "Link", fieldname: "cashier", label: __("Cashier"), options: "User" }, "cc-hist-sup hide"),
		};
		this.fields.from_date.set_value(frappe.datetime.add_days(today, -29));
		this.fields.to_date.set_value(today);
		this.mark_chip("30");

		this.$el.on("click", ".cc-hist-chip", (e) => this.set_range($(e.currentTarget).attr("data-range")));
		this.$el.on("click", "[data-print]", (e) => digitz_erp.DayOpsBase.print_slip($(e.currentTarget).attr("data-print")));
		this.$el.on("click", ".cc-hist-report", () => {
			frappe.route_options = this.filters();
			frappe.set_route("query-report", "Counter Session Summary");
		});
	}

	set_range(range) {
		const today = frappe.datetime.get_today();
		const from = {
			today: today,
			week: frappe.datetime.week_start(),
			month: frappe.datetime.month_start(),
			30: frappe.datetime.add_days(today, -29),
		}[range];
		this.fields.from_date.set_value(from);
		this.fields.to_date.set_value(today);
		this.mark_chip(range);
	}

	mark_chip(range) {
		this.$el.find(".cc-hist-chip").each((_, el) => el.classList.toggle("active", el.dataset.range === range));
	}

	filters() {
		const out = {};
		Object.entries(this.fields).forEach(([key, control]) => {
			const value = control.get_value();
			if (value && (this.is_supervisor || !["counter", "cashier"].includes(key))) {
				out[key] = value;
			}
		});
		return out;
	}

	async load() {
		const seq = (this.seq = (this.seq || 0) + 1);
		this.$el.addClass("is-loading");
		try {
			const r = await frappe.call({
				method: "digitz_erp.api.counter_session_api.get_session_history",
				args: this.filters(),
			});
			// A slower, older request must not overwrite a newer one
			if (seq !== this.seq || !r.message) {
				return;
			}
			this.is_supervisor = r.message.is_supervisor;
			this.$el.find(".cc-hist-sup").toggleClass("hide", !this.is_supervisor);
			this.render_tiles(r.message.totals);
			this.render_table(r.message.rows);
		} finally {
			seq === this.seq && this.$el.removeClass("is-loading");
		}
	}

	render_tiles(t) {
		const diff_class = Math.abs(flt(t.net_difference)) < 0.005 ? "" : t.net_difference < 0 ? "is-short" : "is-over";
		const tile = (label, value, cls = "") => `
			<div class="cc-hist-tile ${cls}">
				<div class="cc-hist-tile-label">${label}</div>
				<div class="cc-hist-tile-value">${value}</div>
			</div>`;
		// A cashier is sent only their own inputs, never the day's sales (a blind close)
		this.$el.find(".cc-hist-tiles").html(
			tile(__("Days"), t.days) +
			(this.is_supervisor
				? tile(__("Cash Sales"), this.money(t.cash_sales)) +
					tile(__("Cash Receipts"), this.money(t.cash_receipts))
				: tile(__("Counted Cash"), this.money(t.counted_cash))) +
			tile(__("Card, Bank & Other"), this.money(t.non_cash_total)) +
			tile(__("Expenditure"), this.money(t.cash_expenditure)) +
			(this.is_supervisor ? tile(__("Net Difference"), this.money(t.net_difference), diff_class) : "") +
			tile(__("Open / Awaiting"), t.pending, t.pending ? "is-pending" : "")
		);
	}

	render_table(rows) {
		const $table = this.$el.find(".cc-hist-table");
		const report_link = this.is_supervisor
			? `<button type="button" class="btn btn-xs btn-default cc-hist-report">${__("Open full report")}</button>`
			: "";

		if (!rows.length) {
			$table.html(`
				<div class="cc-hist-empty">
					<p>${__("No days in this range.")}</p>
					${report_link}
				</div>`);
			return;
		}

		const time = (dt) => (dt ? moment(dt).format("hh:mm A") : "");
		const day = (dt) => (dt ? frappe.datetime.str_to_user(String(dt).split(" ")[0]) : "");
		const pending = (row) => row.status === "Open";

		const sup = this.is_supervisor;
		const body = rows.map((row) => {
			// A day closed after midnight shows its closing date too
			const closed = !row.closed_on
				? `<span class="text-muted">${__("Still open")}</span>`
				: day(row.closed_on) === day(row.opened_on) ? time(row.closed_on) : `${day(row.closed_on)} ${time(row.closed_on)}`;
			const diff = flt(row.difference);
			const diff_class = pending(row) || Math.abs(diff) < 0.005 ? "" : diff < 0 ? "is-short" : "is-over";
			const amount = (v) => (pending(row) ? `<span class="text-muted">—</span>` : this.money(v));
			const status_label = row.status === "Closing" ? __("Awaiting Approval") : __(row.status);
			return `
				<tr>
					<td>${day(row.opened_on)}</td>
					<td><a href="/app/counter-session/${encodeURIComponent(row.name)}">${this.esc(row.name)}</a></td>
					<td>${this.esc(row.counter)}</td>
					${this.is_supervisor ? `<td>${this.esc(row.cashier_name)}</td>` : ""}
					<td class="cc-nowrap">${time(row.opened_on)} → ${closed}</td>
					<td class="cc-num">${this.money(row.opening_float)}</td>
					${sup ? `<td class="cc-num">${amount(row.expected_cash)}</td>` : ""}
					<td class="cc-num">${amount(row.counted_cash)}</td>
					<td class="cc-num">${amount(row.non_cash_total)}</td>
					${sup ? `<td class="cc-num ${diff_class}">${amount(diff)}</td>` : `<td class="cc-num">${amount(row.cash_expenditure)}</td>`}
					<td><span class="indicator-pill ${digitz_erp.DayHistory.STATUS_COLOURS[row.status] || "gray"}">${status_label}</span></td>
					<td class="cc-num cc-nowrap">
						${pending(row) ? "" : `<button type="button" class="btn btn-xs btn-default" data-print="${this.esc(row.name)}">${__("Print Slip")}</button>`}
					</td>
				</tr>`;
		}).join("");

		$table.html(`
			<div class="cc-hist-scroll">
				<table class="cc-hist-grid">
					<thead><tr>
						<th>${__("Date")}</th><th>${__("Session")}</th><th>${__("Counter")}</th>
						${this.is_supervisor ? `<th>${__("Cashier")}</th>` : ""}
						<th>${__("Opened → Closed")}</th>
						<th class="cc-num">${__("Float")}</th>
						${sup ? `<th class="cc-num">${__("Expected")}</th>` : ""}
						<th class="cc-num">${__("Counted")}</th><th class="cc-num">${__("Card, Bank & Other")}</th>
						<th class="cc-num">${sup ? __("Difference") : __("Expenditure")}</th>
						<th>${__("Status")}</th><th></th>
					</tr></thead>
					<tbody>${body}</tbody>
				</table>
			</div>
			<div class="cc-hist-foot">
				<span class="text-muted small">${sup
					? __("Expected and counted cash are worked out when a day is closed.")
					: __("Your count is filled in when you close the day.")}</span>
				${report_link}
			</div>`);
	}
};
