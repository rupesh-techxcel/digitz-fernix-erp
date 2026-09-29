// Counter badge: which counter PC this is, and the cashier's day on it.
//
// Each counter PC is registered once by a supervisor, which gives it a number
// (DEV-0007) tied to a Counter. The server identifies the PC on every request from
// an HttpOnly cookie (digitz_erp.api.counter_api); this script keeps a localStorage
// copy of the secret so the cookie can be restored if it is ever cleared.
//
// The badge also carries the day (digitz_erp.api.counter_session_api): a cashier
// opens the day with a float, bills, and closes it by counting the till. Clicking
// the badge offers whatever comes next: register the PC, open the day, close it.

(function () {
	const DEVICE_API = "digitz_erp.api.counter_api.";
	const SESSION_API = "digitz_erp.api.counter_session_api.";
	const STORAGE_KEY = "digitz_counter_device_secret";

	const esc = (v) => frappe.utils.escape_html(v == null ? "" : String(v));
	const money = (v) => format_currency(v, frappe.boot.sysdefaults.currency);

	function read_secret() {
		try {
			return window.localStorage.getItem(STORAGE_KEY);
		} catch (e) {
			return null;
		}
	}

	function keep_secret(secret) {
		try {
			window.localStorage.setItem(STORAGE_KEY, secret);
		} catch (e) {
			// The cookie still identifies the PC; only the backup copy is lost
		}
	}

	// ------------------------------------------------------------------ badge

	function badge_text(state) {
		if (!state.counter) {
			return { text: __("Unregistered device"), colour: "red" };
		}
		const where = `${state.counter} · ${state.device}`;
		const s = state.session;
		if (s && s.status === "Closing") {
			return { text: `${where} · ${__("Close awaiting approval")}`, colour: "orange" };
		}
		if (s) {
			const since = frappe.datetime.str_to_user(s.opened_on).split(" ").pop();
			return { text: `${where} · ${__("Day open since {0}", [since])}`, colour: "green" };
		}
		return { text: `${where} · ${__("Day not opened")}`, colour: state.must_open_day ? "orange" : "blue" };
	}

	function render_badge(state) {
		$("#digitz-counter-badge").remove();

		const { text, colour } = badge_text(state);
		const approvals = state.pending_approvals
			? ` <span class="badge badge-pill" style="background: var(--orange-500, #f59e0b); color: #fff;"
				title="${esc(__("Day closes waiting for your approval"))}">${state.pending_approvals}</span>`
			: "";

		const $badge = $(`
			<li class="nav-item" id="digitz-counter-badge">
				<span class="indicator-pill ${colour}" style="margin: 0 8px; white-space: nowrap; cursor: pointer;">
					${esc(text)}${approvals}
				</span>
			</li>
		`);
		$badge.on("click", () => on_badge_click(state));

		const $nav = $("header .navbar-collapse .navbar-nav").first();
		const $bell = $nav.find(".dropdown-notifications").first();
		if ($bell.length) {
			$badge.insertBefore($bell);
		} else {
			$nav.prepend($badge);
		}
	}

	function on_badge_click(state) {
		if (state.pending_approvals && state.is_supervisor && !state.session) {
			frappe.set_route("day-close");
			return;
		}
		if (!state.counter) {
			if (state.can_register) {
				open_register_dialog(state);
			} else {
				frappe.msgprint(__("This PC is not registered as a counter. Ask a supervisor to register it."));
			}
			return;
		}
		frappe.set_route(state.session ? "day-close" : "day-open");
	}

	// ---------------------------------------------------------- register PC

	function open_register_dialog(state) {
		if (!(state.counters || []).length) {
			frappe.msgprint(__("Create a Counter first, then register this device to it."));
			return;
		}

		const d = new frappe.ui.Dialog({
			title: __("Register this device"),
			fields: [
				{
					fieldname: "counter", fieldtype: "Select", label: __("Counter"), reqd: 1,
					options: state.counters, default: state.counter || state.counters[0],
				},
				{
					fieldtype: "HTML",
					options: `<p class="text-muted small">${state.device
						? __("This PC is currently {0} ({1}). Registering again gives it a new device number; disable the old one in Counter Device.", [esc(state.device), esc(state.counter)])
						: __("This PC gets its own device number. Everything saved here is recorded against the counter you choose.")}</p>`,
				},
			],
			primary_action_label: __("Register"),
			primary_action(values) {
				frappe.call({
					method: DEVICE_API + "register_device",
					args: { counter: values.counter },
					freeze: true,
					callback(r) {
						if (!r.message) {
							return;
						}
						keep_secret(r.message.secret);
						d.hide();
						frappe.show_alert({
							message: __("This PC is now {0} ({1})", [r.message.counter, r.message.device]),
							indicator: "green",
						});
						refresh();
					},
				});
			},
		});
		d.show();
	}

	// ---------------------------------------------------------------- state

	function refresh() {
		// Restore the device cookie from the localStorage copy if it was lost, then
		// read the whole state for the badge.
		frappe.call({
			method: DEVICE_API + "resolve_device",
			args: { secret: read_secret() },
			callback() {
				frappe.call({
					method: SESSION_API + "get_state",
					callback(r) {
						if (r.message) {
							render_badge(r.message);
						}
					},
				});
			},
		});
	}

	// Other pages (the Counter Session form) can ask the badge to update
	frappe.provide("digitz_erp");
	digitz_erp.refresh_counter_badge = refresh;
	digitz_erp.open_register_device_dialog = open_register_dialog;

	$(document).on("app_ready", refresh);
})();

// --------------------------------------------------------------- cash count
// The note-and-coin grid Day Open and Day Close count the till with. `on_change`
// gets the total whenever a count changes.

frappe.provide("digitz_erp");

digitz_erp.CashCount = class CashCount {
	constructor($parent, denominations, on_change) {
		this.denominations = denominations || [];
		this.on_change = on_change;
		this.$el = $(`
			<table class="dayops-count">
				<thead><tr><th>${__("Note / Coin")}</th><th>${__("Count")}</th><th>${__("Amount")}</th></tr></thead>
				<tbody>${this.denominations.map((d) => `
					<tr data-value="${d}">
						<td>${format_currency(d, frappe.boot.sysdefaults.currency)}</td>
						<td><input type="number" min="0" step="1" class="form-control input-sm" inputmode="numeric"></td>
						<td class="dayops-num dayops-line">-</td>
					</tr>`).join("")}
				</tbody>
				<tfoot><tr><td colspan="2">${__("Total counted")}</td><td class="dayops-num dayops-total">-</td></tr></tfoot>
			</table>`).appendTo($parent);
		this.$el.on("input", "input", () => this.update());
	}

	rows() {
		return this.$el.find("tbody tr").toArray().map((tr) => ({
			denomination: flt($(tr).attr("data-value")),
			count: cint($(tr).find("input").val()),
		}));
	}

	total() {
		return this.rows().reduce((t, r) => t + r.denomination * r.count, 0);
	}

	update() {
		const money = (v) => format_currency(v, frappe.boot.sysdefaults.currency);
		this.$el.find("tbody tr").each((_, tr) => {
			const amount = flt($(tr).attr("data-value")) * cint($(tr).find("input").val());
			$(tr).find(".dayops-line").text(amount ? money(amount) : "-");
		});
		const total = this.total();
		this.$el.find(".dayops-total").text(total ? money(total) : "-");
		this.on_change && this.on_change(total);
	}

	counted() {
		return this.rows().filter((r) => r.count);
	}

	// Fill the grid from [{denomination, count}], e.g. the last close on the counter
	set_counts(rows) {
		const by_value = {};
		(rows || []).forEach((r) => (by_value[flt(r.denomination)] = cint(r.count)));
		this.$el.find("tbody tr").each((_, tr) => {
			const count = by_value[flt($(tr).attr("data-value"))];
			$(tr).find("input").val(count || "");
		});
		this.update();
	}
};

digitz_erp.dayops_styles = function () {
	if (document.getElementById("dayops-styles")) {
		return;
	}
	const style = document.createElement("style");
	style.id = "dayops-styles";
	style.textContent = `
.dayops { max-width: 1100px; margin: 0 auto; }
.dayops-head { display: flex; flex-wrap: wrap; gap: 10px 28px; padding: 14px 18px; margin-bottom: 16px;
	border: 1px solid var(--border-color); border-radius: var(--border-radius-lg, 10px); background: var(--card-bg, var(--fg-color)); }
.dayops-head div { min-width: 140px; }
.dayops-head .k { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted); }
.dayops-head .v { font-size: 15px; font-weight: 600; }
.dayops-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
@media (max-width: 900px) { .dayops-grid { grid-template-columns: 1fr; } }
.dayops-card { border: 1px solid var(--border-color); border-radius: var(--border-radius-lg, 10px);
	background: var(--card-bg, var(--fg-color)); padding: 16px 18px; margin-bottom: 16px; }
.dayops-card h4 { font-size: 13px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted); margin: 0 0 12px; }
.dayops-num { text-align: right; white-space: nowrap; }
.dayops-count { width: 100%; }
.dayops-count th { font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 600; padding: 4px 6px; }
.dayops-count td { padding: 3px 6px; vertical-align: middle; }
.dayops-count td input { max-width: 110px; }
.dayops-count tfoot td { font-weight: 700; border-top: 1px solid var(--border-color); padding-top: 8px; }
.dayops-lines { width: 100%; }
.dayops-lines td { padding: 7px 4px; border-bottom: 1px solid var(--border-color); }
.dayops-lines tr.total td { font-weight: 700; font-size: 15px; border-bottom: none; border-top: 2px solid var(--text-color); }
.dayops-lines .dayops-toggle { cursor: pointer; color: var(--text-color); }
.dayops-lines .dayops-caret { display: inline-block; width: 14px; color: var(--text-muted); }
.dayops-docs td { font-size: 12px; color: var(--text-muted); padding: 3px 4px 3px 22px; border-bottom: none; }
.dayops-big { font-size: 24px; font-weight: 700; }
.dayops-result { padding: 12px 14px; border-radius: var(--border-radius, 6px); margin-top: 10px; font-weight: 600; }
.dayops-result.ok { background: var(--green-50, #ecfdf5); color: var(--green-700, #15803d); }
.dayops-result.short { background: var(--red-50, #fef2f2); color: var(--red-700, #b91c1c); }
.dayops-result.over { background: var(--orange-50, #fff7ed); color: var(--orange-700, #c2410c); }
.dayops-state { text-align: center; padding: 48px 20px; }
.dayops-state .dayops-big { margin-bottom: 8px; }
.dayops-state p { color: var(--text-muted); max-width: 520px; margin: 0 auto 16px; }
`;
	document.head.appendChild(style);
};
