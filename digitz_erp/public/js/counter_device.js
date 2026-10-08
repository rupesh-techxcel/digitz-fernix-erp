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
//
// A cashier on an unregistered PC asks for it to be registered instead. A counter
// with no PC is theirs at once; taking over a counter that has one waits for a
// supervisor, who sees the requests on the badge and approves or rejects them.

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
			const req = state.registration_request;
			if (req && req.approval_status === "Pending") {
				return { text: `${__("Approval pending")} · ${req.counter}`, colour: "orange" };
			}
			if (req && req.approval_status === "Rejected") {
				return { text: `${__("Request rejected")} · ${req.counter}`, colour: "red" };
			}
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
		const waiting = (state.pending_approvals || 0) + (state.device_requests || 0);
		const approvals = waiting
			? ` <span class="badge badge-pill" style="background: var(--orange-500, #f59e0b); color: #fff;"
				title="${esc(__("Day closes and device requests waiting for your approval"))}">${waiting}</span>`
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
		if (state.device_requests && state.is_supervisor) {
			open_requests_dialog(state);
			return;
		}
		if (state.pending_approvals && state.is_supervisor && !state.session) {
			frappe.set_route("day-close");
			return;
		}
		if (!state.counter) {
			const req = state.registration_request;
			if (state.can_register) {
				open_register_dialog(state);
			} else if (req && req.approval_status === "Pending") {
				frappe.msgprint({
					title: __("Approval pending"),
					message: __("You asked for this PC to become {0}'s PC ({1}). That counter already has a PC, so a supervisor must approve it. The badge turns green when they do.", [esc(req.counter), esc(req.device)]),
					indicator: "orange",
				});
			} else if (state.is_cashier) {
				open_request_dialog(state);
			} else {
				frappe.msgprint(__("This PC is not registered as a counter. Ask a supervisor to register it."));
			}
			return;
		}
		frappe.set_route(state.session ? "day-close" : "day-open");
	}

	// ---------------------------------------------------------- register PC

	const NEW_COUNTER = "__new__";

	// Counter N+1, after the highest numbered "Counter N"
	function suggest_counter_name(counters) {
		const numbers = (counters || []).map((c) => (/^Counter (\d+)$/.exec(c) || [])[1]).filter(Boolean).map(Number);
		return `Counter ${Math.max(0, ...numbers) + 1}`;
	}

	function open_register_dialog(state) {
		const counters = state.counters || [];
		const d = new frappe.ui.Dialog({
			title: __("Register this device"),
			fields: [
				{
					fieldname: "counter", fieldtype: "Select", label: __("Counter"), reqd: 1,
					options: [
						...counters.map((c) => ({ label: c, value: c })),
						{ label: __("+ New counter"), value: NEW_COUNTER },
					],
					default: state.counter || counters[0] || NEW_COUNTER,
					change: () => show_replaced(),
				},
				{
					fieldname: "new_counter", fieldtype: "Data", label: __("New counter name"),
					default: suggest_counter_name(counters),
					depends_on: `eval:doc.counter=='${NEW_COUNTER}'`,
					mandatory_depends_on: `eval:doc.counter=='${NEW_COUNTER}'`,
					description: __("The counter is created now, and this PC registered to it."),
				},
				{
					fieldtype: "HTML",
					options: `<p class="text-muted small">${state.device
						? __("This PC is currently {0} ({1}). Registering again gives it a new device number.", [esc(state.device), esc(state.counter)])
						: __("This PC gets its own device number. Everything saved here is recorded against the counter you choose.")}</p>`,
				},
				{ fieldname: "replaced", fieldtype: "HTML" },
			],
			primary_action_label: __("Register"),
			primary_action(values) {
				const is_new = values.counter === NEW_COUNTER;
				frappe.call({
					method: DEVICE_API + "register_device",
					args: is_new ? { new_counter: values.new_counter } : { counter: values.counter },
					freeze: true,
					callback(r) {
						if (!r.message) {
							return;
						}
						keep_secret(r.message.secret);
						d.hide();
						const disabled = (r.message.disabled || []).length
							? " " + __("Disabled: {0}", [r.message.disabled.join(", ")])
							: "";
						frappe.show_alert({
							message: __("This PC is now {0} ({1})", [r.message.counter, r.message.device]) + disabled,
							indicator: "green",
						});
						refresh();
					},
				});
			},
		});

		// A counter has one device: warn about what registering here disables. A
		// day open on one of them is not stopped; it carries on on this counter's
		// new device
		function show_replaced() {
			const counter = d.get_value("counter");
			const $area = d.fields_dict.replaced.$wrapper.empty();
			d.get_primary_btn().text(__("Register"));
			if (!counter || counter === NEW_COUNTER) {
				return;
			}
			frappe.call({
				method: DEVICE_API + "get_registration_preview",
				args: { counter },
				callback(r) {
					if (d.get_value("counter") !== counter) {
						return;
					}
					const rows = r.message || [];
					if (!rows.length) {
						return;
					}
					const when = (value) => moment(value).format("DD-MM-YYYY, hh:mm A");
					const items = rows.map((row) => {
						const seen = row.last_seen ? __("Last seen {0}", [when(row.last_seen)]) : __("Never seen");
						const open = !row.open_session ? "" : `
							<div class="cd-replace-open">
								${frappe.utils.icon("es-line-time", "xs")}
								<span>${row.counter === counter
									? __("{0}'s day {1} is still open. It carries on on this PC: no new Day Open is needed.",
										[`<b>${esc(row.cashier_name)}</b>`, esc(row.open_session)])
									: __("{0}'s day {1} is still open on {2}. Close it from any PC, or register a new {2} PC to carry on.",
										[`<b>${esc(row.cashier_name)}</b>`, esc(row.open_session), esc(row.counter)])}</span>
							</div>`;
						return `
							<li class="cd-replace-item">
								<div class="cd-replace-device"><b>${esc(row.device)}</b> · ${esc(row.counter)} <span class="cd-replace-seen">${esc(seen)}</span></div>
								${open}
							</li>`;
					}).join("");
					$area.html(`
						<div class="cd-replace-warning" role="alert">
							<div class="cd-replace-head">
								${frappe.utils.icon("solid-warning", "sm")}
								<span>${rows.length === 1
									? __("Registering replaces the PC now on {0}", [esc(counter)])
									: __("Registering replaces {0} PCs", [rows.length])}</span>
							</div>
							<ul class="cd-replace-list">${items}</ul>
							<div class="cd-replace-foot">${esc(__("A counter has one PC. The replaced PC stops working as a counter until it is registered again."))}</div>
						</div>`);
					d.get_primary_btn().text(__("Register & Replace"));
				},
			});
		}

		d.show();
		show_replaced();
	}

	// ------------------------------------------------- cashier asks for a PC

	function open_request_dialog(state) {
		frappe.call({
			method: DEVICE_API + "get_request_options",
			callback(r) {
				const options = r.message || [];
				if (!options.length) {
					frappe.msgprint(__("There are no counters yet. Ask a supervisor to register this PC."));
					return;
				}
				const rejected = state.registration_request && state.registration_request.approval_status === "Rejected"
					? `<p class="small" style="color: var(--red-600, #dc2626);">${esc(__("Your last request for {0} was rejected. Ask a supervisor why before asking again.", [state.registration_request.counter]))}</p>`
					: "";
				const d = new frappe.ui.Dialog({
					title: __("Ask to register this PC"),
					fields: [
						{ fieldtype: "HTML", options: rejected },
						{
							fieldname: "counter", fieldtype: "Select", label: __("Counter"), reqd: 1,
							options: options.map((o) => ({
								value: o.counter,
								label: o.device
									? __("{0} · has a PC ({1}), needs approval", [o.counter, o.device])
									: __("{0} · free, ready at once", [o.counter]),
							})),
							default: (options.find((o) => !o.device) || options[0]).counter,
						},
						{
							fieldtype: "HTML",
							options: `<p class="text-muted small">${__("A free counter becomes this PC's at once. A counter that already has a PC needs a supervisor's approval, because this PC would replace it.")}</p>`,
						},
					],
					primary_action_label: __("Ask"),
					primary_action(values) {
						frappe.call({
							method: DEVICE_API + "request_device",
							args: { counter: values.counter },
							freeze: true,
							callback(res) {
								if (!res.message) {
									return;
								}
								keep_secret(res.message.secret);
								d.hide();
								const approved = res.message.status === "Approved";
								frappe.show_alert({
									message: approved
										? __("This PC is now {0} ({1})", [res.message.counter, res.message.device])
										: __("Approval pending: a supervisor must approve this PC for {0}", [res.message.counter]),
									indicator: approved ? "green" : "orange",
								}, 8);
								refresh();
							},
						});
					},
				});
				d.show();
			},
		});
	}

	// --------------------------------------------- supervisor: device requests

	function open_requests_dialog(state) {
		const d = new frappe.ui.Dialog({
			title: __("PCs waiting for approval"),
			size: "large",
			fields: [{ fieldname: "list", fieldtype: "HTML" }],
		});

		function load() {
			frappe.call({
				method: DEVICE_API + "get_device_requests",
				callback(r) {
					const rows = r.message || [];
					const $area = d.fields_dict.list.$wrapper;
					if (!rows.length) {
						$area.html(`<p class="text-muted">${__("No requests are waiting.")}</p>`);
					} else {
						$area.html(`
							<p class="text-muted small">${__("Approving makes the PC its counter's PC and disables the one it replaces. A day open on the old PC carries on on the new one.")}</p>
							<table class="table table-sm">
								<thead><tr><th>${__("Counter")}</th><th>${__("Asked by")}</th><th>${__("Replaces")}</th><th></th></tr></thead>
								<tbody>${rows.map((row) => `
									<tr data-device="${esc(row.device)}">
										<td><b>${esc(row.counter)}</b><div class="text-muted small">${esc(row.device)} · ${esc(frappe.datetime.str_to_user(row.registered_on))}</div></td>
										<td>${esc(row.requested_by_name)}<div class="text-muted small" title="${esc(row.user_agent)}">${esc((row.user_agent || "").slice(0, 40))}</div></td>
										<td>${esc(row.replaces || __("nothing"))}${row.open_session
											? `<div class="small" style="color: var(--orange-600, #ea580c);">${esc(__("{0}'s day {1} is open", [row.cashier_name, row.open_session]))}</div>`
											: ""}</td>
										<td class="text-right" style="white-space: nowrap;">
											<button class="btn btn-xs btn-primary" data-action="approve">${__("Approve")}</button>
											<button class="btn btn-xs btn-default" data-action="reject">${__("Reject")}</button>
										</td>
									</tr>`).join("")}
								</tbody>
							</table>`);
					}
					if (state.pending_approvals) {
						$area.append(`<p><a class="small" href="/app/day-close">${__("{0} day close(s) also wait for approval", [state.pending_approvals])}</a></p>`);
					}
				},
			});
		}

		d.fields_dict.list.$wrapper.on("click", "button[data-action]", (e) => {
			const device = $(e.currentTarget).closest("tr").attr("data-device");
			if ($(e.currentTarget).attr("data-action") === "approve") {
				frappe.call({
					method: DEVICE_API + "approve_device_request",
					args: { device },
					freeze: true,
					callback(r) {
						if (r.message) {
							frappe.show_alert({ message: __("{0} is now {1}'s PC", [r.message.device, r.message.counter]), indicator: "green" });
							load();
							refresh();
						}
					},
				});
			} else {
				frappe.prompt(
					{ fieldname: "reason", fieldtype: "Small Text", label: __("Reason (shown on the device record)") },
					(values) => frappe.call({
						method: DEVICE_API + "reject_device_request",
						args: { device, reason: values.reason },
						callback() {
							load();
							refresh();
						},
					}),
					__("Reject {0}", [device]),
					__("Reject"),
				);
			}
		});

		d.show();
		load();
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
							// The Cashier Console's shift card reads the same state
							digitz_erp.counter_state = r.message;
							$(document).trigger("digitz:counter-state", [r.message]);
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

	$(document).on("app_ready", () => {
		refresh();
		// A request made or decided anywhere: update this badge at once
		frappe.realtime.on("digitz_counter_devices", refresh);
	});
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
