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

frappe.pages["day-close"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __("Day Close"), single_column: true });
	wrapper.day_close = new DayClose(page);
};

frappe.pages["day-close"].on_page_show = function (wrapper) {
	wrapper.day_close && wrapper.day_close.load();
};

const DAY_CLOSE_MOVEMENTS = [
	{ field: "cash_sales", label: __("Cash Sales"), sign: "+" },
	{ field: "cash_receipts", label: __("Cash Receipts (Credit Collections)"), sign: "+" },
	{ field: "cash_refunds", label: __("Cash Refunds"), sign: "−" },
	{ field: "cash_paid_out", label: __("Cash Paid Out"), sign: "−" },
];

class DayClose {
	constructor(page) {
		this.page = page;
		this.page.add_inner_button(__("Help"), () => frappe.set_route("digitz-help", "day-close"));
		if (!(window.digitz_erp && digitz_erp.dayops_styles && digitz_erp.CashCount)) {
			$(page.main).html(`<div class="text-center text-muted" style="padding: 60px 20px;">
				${__("This page needs the latest app scripts. Reload the browser (Ctrl+Shift+R) and open it again.")}</div>`);
			this.broken = true;
			return;
		}
		digitz_erp.dayops_styles();
		this.$body = $('<div class="dayops"></div>').appendTo(page.main);
		this.$approvals = $('<div class="dayops"></div>').appendTo(page.main);
	}

	money(v) {
		return format_currency(v, frappe.boot.sysdefaults.currency);
	}

	esc(v) {
		return frappe.utils.escape_html(v == null ? "" : String(v));
	}

	async load() {
		if (this.broken) {
			return;
		}
		this.page.clear_primary_action();
		this.page.clear_secondary_action();
		const r = await frappe.call({ method: "digitz_erp.api.counter_session_api.get_state" });
		this.state = r.message || {};

		const session = this.state.session;
		if (session && session.status === "Open") {
			const p = await frappe.call({ method: "digitz_erp.api.counter_session_api.get_close_preview" });
			this.preview = p.message;
			this.render_close();
		} else {
			this.render_state();
		}
		this.render_approvals();
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
			text = __("Your count for {0} differs from the expected cash. A supervisor has to approve it before the day is closed.", [this.esc(s.session.name)]);
			label = __("View Session");
			action = () => frappe.set_route("Form", "Counter Session", s.session.name);
		} else {
			title = __("No day is open");
			text = __("Open the day with the cash in the till before billing. The day is closed from here at the end of your shift.");
			label = s.counter ? __("Go to Day Open") : null;
			action = () => frappe.set_route("day-open");
		}

		this.$body.html(`${this.header()}
			<div class="dayops-card dayops-state">
				<div class="dayops-big">${title}</div>
				<p>${text}</p>
				${label ? `<button class="btn btn-primary btn-sm dayops-go">${label}</button>` : ""}
			</div>`);
		this.$body.find(".dayops-go").on("click", action);
	}

	render_close() {
		const p = this.preview;
		const docs = p.documents || {};

		const movement_rows = DAY_CLOSE_MOVEMENTS.map((m) => {
			const list = docs[m.field] || [];
			const detail = list.map((d) => `
				<tr class="dayops-docs" data-for="${m.field}" style="display: none;">
					<td><a href="/app/${frappe.router.slug(d.doctype)}/${encodeURIComponent(d.name)}">${this.esc(d.name)}</a>
						${d.posting_time ? " · " + this.esc(String(d.posting_time).slice(0, 5)) : ""}
						${d.party ? " · " + this.esc(d.party) : ""}</td>
					<td class="dayops-num">${this.money(d.amount)}</td>
				</tr>`).join("");
			return `
				<tr class="dayops-toggle" data-toggle="${m.field}">
					<td><span class="dayops-caret">${list.length ? "▸" : ""}</span>${m.sign} ${m.label}
						<span class="text-muted small">(${list.length})</span></td>
					<td class="dayops-num">${this.money(p[m.field])}</td>
				</tr>${detail}`;
		}).join("");

		this.$body.html(`${this.header(`
				<div><div class="k">${__("Session")}</div><div class="v"><a href="/app/counter-session/${encodeURIComponent(p.name)}">${this.esc(p.name)}</a></div></div>
				<div><div class="k">${__("Opened")}</div><div class="v">${frappe.datetime.str_to_user(p.opened_on)}</div></div>`)}
			<div class="dayops-grid">
				<div>
					<div class="dayops-card">
						<h4>${__("Cash for the Day")}</h4>
						<table class="dayops-lines">
							<tr><td>${__("Opening Float")}</td><td class="dayops-num">${this.money(p.opening_float)}</td></tr>
							${movement_rows}
							<tr class="total"><td>${__("Expected Cash in the Till")}</td><td class="dayops-num">${this.money(p.expected_cash)}</td></tr>
						</table>
						<p class="text-muted small" style="margin-top: 8px;">${__("Only submitted documents with a cash payment mode count. Click a line to see its documents.")}</p>
					</div>
				</div>
				<div>
					<div class="dayops-card"><h4>${__("Count the Closing Cash")}</h4><div class="dayops-count-wrap"></div></div>
					<div class="dayops-card">
						<h4>${__("Close")}</h4>
						<div class="counted-field"></div>
						<div class="close-result"></div>
						<div class="remarks-field"></div>
						<button class="btn btn-primary btn-block dayops-submit" style="margin-top: 8px;">${__("Close Day")}</button>
						<button class="btn btn-default btn-block dayops-handover" style="margin-top: 6px;">${__("Close & Hand Over")}</button>
						<p class="text-muted small" style="margin: 6px 0 0;">${__("Hand Over closes your day and logs you out, so the next cashier can sign in here and open with this count.")}</p>
					</div>
				</div>
			</div>`);

		this.$body.off("click", "tr.dayops-toggle").on("click", "tr.dayops-toggle", (e) => {
			const field = $(e.currentTarget).attr("data-toggle");
			const $rows = this.$body.find(`tr.dayops-docs[data-for="${field}"]`);
			if (!$rows.length) {
				return;
			}
			const open = !$rows.first().is(":visible");
			$rows.toggle(open);
			$(e.currentTarget).find(".dayops-caret").text(open ? "▾" : "▸");
		});

		this.counted = frappe.ui.form.make_control({
			parent: this.$body.find(".counted-field"),
			df: {
				fieldtype: "Currency", fieldname: "counted_cash", label: __("Counted Cash"), reqd: 1,
				description: __("Filled from the count, or type the total."),
				change: () => this.show_result(),
			},
			render_input: true,
		});
		this.remarks = frappe.ui.form.make_control({
			parent: this.$body.find(".remarks-field"),
			df: { fieldtype: "Small Text", fieldname: "remarks", label: __("Remarks"),
				description: __("Explain any shortage or excess for the supervisor.") },
			render_input: true,
		});
		this.count = new digitz_erp.CashCount(this.$body.find(".dayops-count-wrap"), this.state.denominations, (total) => {
			if (total) {
				this.counted.set_value(total);
			}
		});

		this.page.set_primary_action(__("Close Day"), () => this.close_day(), "check");
		this.$body.find(".dayops-submit").on("click", () => this.close_day());
		this.$body.find(".dayops-handover").on("click", () => this.close_day(true));
		this.page.set_secondary_action(__("Refresh"), () => this.load());
	}

	show_result() {
		const $r = this.$body.find(".close-result").empty();
		const counted = this.counted.get_value();
		if (counted === undefined || counted === null || counted === "") {
			return;
		}
		const diff = flt(counted) - flt(this.preview.expected_cash);
		if (Math.abs(diff) < 0.005) {
			$r.html(`<div class="dayops-result ok">${__("The till matches the expected cash. The day will close.")}</div>`);
		} else {
			$r.html(`<div class="dayops-result ${diff < 0 ? "short" : "over"}">
				${diff < 0 ? __("Short by {0}", [this.money(-diff)]) : __("Over by {0}", [this.money(diff)])}
				<div style="font-weight: normal; font-size: 12px; margin-top: 4px;">${__("A supervisor will have to approve this close.")}</div>
			</div>`);
		}
	}

	close_day(handover) {
		const counted = this.counted.get_value();
		if (counted === undefined || counted === null || counted === "") {
			frappe.msgprint(__("Count the till, or enter the counted cash."));
			return;
		}
		frappe.confirm(
			handover
				? __("Close your day with {0} counted in the till and log out for the next cashier?", [this.money(counted)])
				: __("Close the day with {0} counted in the till?", [this.money(counted)]),
			() => frappe.call({
				method: "digitz_erp.api.counter_session_api.close_day",
				args: { counted_cash: counted, denominations: this.count.counted(), remarks: this.remarks.get_value() },
				freeze: true,
				freeze_message: __("Closing the day..."),
				callback: (r) => {
					if (!r.message) {
						return;
					}
					digitz_erp.refresh_counter_badge && digitz_erp.refresh_counter_badge();
					this.show_closed(r.message, handover);
				},
			})
		);
	}

	show_closed(result, handover) {
		this.page.clear_primary_action();
		this.page.clear_secondary_action();
		const closed = result.status === "Closed";
		const next = handover
			? `<button class="btn btn-primary btn-sm dayops-logout" style="margin-left: 6px;">${__("Log Out for Next Cashier")}</button>`
			: `<button class="btn btn-default btn-sm dayops-open" style="margin-left: 6px;">${__("Go to Day Open")}</button>`;
		this.$body.html(`${this.header()}
			<div class="dayops-card dayops-state">
				<div class="dayops-big">${closed ? __("Day closed") : __("Close sent for approval")}</div>
				<p>${closed
					? __("The till matched the expected cash. {0} is closed.", [this.esc(result.session)])
					: __("The count differs by {0}. {1} will close once a supervisor approves it.", [this.money(result.difference), this.esc(result.session)])}
				${handover ? "<br>" + __("The counter is free: the next cashier can sign in on this PC and open with your count.") : ""}</p>
				<button class="btn ${handover ? "btn-default" : "btn-primary"} btn-sm dayops-print">${__("Print Day Close Slip")}</button>
				${next}
			</div>`);
		this.$body.find(".dayops-print").on("click", () => this.print(result.session));
		this.$body.find(".dayops-open").on("click", () => frappe.set_route("day-open"));
		this.$body.find(".dayops-logout").on("click", () => frappe.app.logout());
		this.render_approvals();
	}

	print(session) {
		window.open(frappe.urllib.get_full_url(
			`/printview?doctype=${encodeURIComponent("Counter Session")}&name=${encodeURIComponent(session)}&format=${encodeURIComponent("Day Close Slip")}&trigger_print=1`
		));
	}

	async render_approvals() {
		this.$approvals.empty();
		if (!this.state.is_supervisor) {
			return;
		}
		const [open, pending] = await Promise.all([
			frappe.call({ method: "digitz_erp.api.counter_session_api.get_open_days" }),
			frappe.call({ method: "digitz_erp.api.counter_session_api.get_pending_approvals" }),
		]);
		this.$approvals.empty();
		this.render_open_days(open.message || []);
		this.render_pending(pending.message || []);
	}

	render_open_days(rows) {
		if (!rows.length) {
			return;
		}
		const $card = $(`
			<div class="dayops-card">
				<h4>${__("Open Days")} (${rows.length})</h4>
				<table class="table table-sm" style="margin: 0;">
					<thead><tr>
						<th>${__("Session")}</th><th>${__("Counter")}</th><th>${__("Cashier")}</th><th>${__("Opened")}</th>
						<th class="dayops-num">${__("Float")}</th><th class="dayops-num">${__("Expected Now")}</th><th></th>
					</tr></thead>
					<tbody>${rows.map((row) => `
						<tr>
							<td><a href="/app/counter-session/${encodeURIComponent(row.name)}">${this.esc(row.name)}</a></td>
							<td>${this.esc(row.counter)}</td>
							<td>${this.esc(row.cashier_name)}</td>
							<td>${frappe.datetime.str_to_user(row.opened_on)}</td>
							<td class="dayops-num">${this.money(row.opening_float)}</td>
							<td class="dayops-num">${this.money(row.expected_cash)}</td>
							<td class="dayops-num"><button class="btn btn-xs btn-default" data-force-close="${this.esc(row.name)}">${__("Close for Cashier")}</button></td>
						</tr>`).join("")}
					</tbody>
				</table>
				<p class="text-muted small" style="margin: 8px 0 0;">${__("For a cashier who left without closing: count their till and close the day for them, which frees the counter.")}</p>
			</div>`).appendTo(this.$approvals);
		$card.find("[data-force-close]").on("click", (e) => {
			const name = $(e.currentTarget).attr("data-force-close");
			this.supervisor_close(rows.find((x) => x.name === name));
		});
	}

	supervisor_close(row) {
		const d = new frappe.ui.Dialog({
			title: __("Close {0}'s day on {1}", [this.esc(row.cashier_name), this.esc(row.counter)]),
			size: "large",
			fields: [
				{
					fieldtype: "HTML", fieldname: "summary",
					options: `<p>${__("Expected cash in the till")}: <b>${this.money(row.expected_cash)}</b>
						<span class="text-muted">(${__("float")} ${this.money(row.opening_float)})</span></p>`,
				},
				{ fieldtype: "HTML", fieldname: "count_wrap" },
				{ fieldtype: "Column Break" },
				{ fieldtype: "Currency", fieldname: "counted_cash", label: __("Counted Cash"), reqd: 1,
					description: __("Filled from the count, or type the total."),
					change: () => show_result() },
				{ fieldtype: "HTML", fieldname: "result" },
				{ fieldtype: "Small Text", fieldname: "remarks", label: __("Reason"), reqd: 1,
					description: __("Why you are closing this day for the cashier. Shown on the Day Close slip.") },
			],
			primary_action_label: __("Count & Close"),
			primary_action: (values) => {
				frappe.call({
					method: "digitz_erp.api.counter_session_api.supervisor_close",
					args: {
						session: row.name,
						counted_cash: values.counted_cash,
						denominations: count.counted(),
						remarks: values.remarks,
					},
					freeze: true,
					freeze_message: __("Closing the day..."),
					callback: (r) => {
						if (!r.message) {
							return;
						}
						d.hide();
						frappe.show_alert({ message: __("{0} closed. {1} is free.", [row.name, row.counter]), indicator: "green" });
						digitz_erp.refresh_counter_badge && digitz_erp.refresh_counter_badge();
						this.load();
					},
				});
			},
		});

		const show_result = () => {
			const counted = d.get_value("counted_cash");
			const $r = d.fields_dict.result.$wrapper.empty();
			if (counted === undefined || counted === null || counted === "") {
				return;
			}
			const diff = flt(counted) - flt(row.expected_cash);
			$r.html(Math.abs(diff) < 0.005
				? `<div class="dayops-result ok">${__("Matches the expected cash.")}</div>`
				: `<div class="dayops-result ${diff < 0 ? "short" : "over"}">
					${diff < 0 ? __("Short by {0}", [this.money(-diff)]) : __("Over by {0}", [this.money(diff)])}
					<div style="font-weight: normal; font-size: 12px; margin-top: 4px;">${__("Closing approves this difference in your name.")}</div>
				</div>`);
		};

		const count = new digitz_erp.CashCount(d.fields_dict.count_wrap.$wrapper, this.state.denominations, (total) => {
			if (total) {
				d.set_value("counted_cash", total);
			}
		});
		d.show();
	}

	render_pending(rows) {
		if (!rows.length) {
			return;
		}
		$(`
			<div class="dayops-card">
				<h4>${__("Pending Approvals")} (${rows.length})</h4>
				<table class="table table-sm" style="margin: 0;">
					<thead><tr>
						<th>${__("Session")}</th><th>${__("Counter")}</th><th>${__("Cashier")}</th><th>${__("Opened")}</th>
						<th class="dayops-num">${__("Expected")}</th><th class="dayops-num">${__("Counted")}</th>
						<th class="dayops-num">${__("Difference")}</th><th>${__("Remarks")}</th><th></th>
					</tr></thead>
					<tbody>${rows.map((row) => `
						<tr>
							<td><a href="/app/counter-session/${encodeURIComponent(row.name)}">${this.esc(row.name)}</a></td>
							<td>${this.esc(row.counter)}</td>
							<td>${this.esc(row.cashier_name)}</td>
							<td>${frappe.datetime.str_to_user(row.opened_on)}</td>
							<td class="dayops-num">${this.money(row.expected_cash)}</td>
							<td class="dayops-num">${this.money(row.counted_cash)}</td>
							<td class="dayops-num" style="color: ${row.difference < 0 ? "var(--red-600)" : "var(--orange-600)"}; font-weight: 600;">${this.money(row.difference)}</td>
							<td>${this.esc(row.close_remarks)}</td>
							<td class="dayops-num"><button class="btn btn-xs btn-primary" data-approve="${this.esc(row.name)}">${__("Approve & Close")}</button></td>
						</tr>`).join("")}
					</tbody>
				</table>
			</div>`).appendTo(this.$approvals);
		this.$approvals.find("[data-approve]").on("click", (e) => {
			const name = $(e.currentTarget).attr("data-approve");
			const row = rows.find((x) => x.name === name);
			frappe.confirm(
				__("Approve a difference of {0} for {1} and close the day?", [this.money(row.difference), this.esc(row.cashier_name)]),
				() => frappe.call({
					method: "digitz_erp.api.counter_session_api.approve_close",
					args: { session: name },
					freeze: true,
					callback: () => {
						frappe.show_alert({ message: __("{0} closed", [name]), indicator: "green" });
						digitz_erp.refresh_counter_badge && digitz_erp.refresh_counter_badge();
						this.load();
					},
				})
			);
		});
	}
}
