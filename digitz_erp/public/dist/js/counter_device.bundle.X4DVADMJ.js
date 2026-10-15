(() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
  var __publicField = (obj, key, value) => {
    __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
    return value;
  };

  // ../digitz_erp/digitz_erp/public/js/counter_device.js
  (function() {
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
      }
    }
    function badge_text(state) {
      if (!state.counter) {
        const req = state.registration_request;
        if (req && req.approval_status === "Pending") {
          return { text: `${__("Approval pending")} \xB7 ${req.counter}`, colour: "orange" };
        }
        if (req && req.approval_status === "Rejected") {
          return { text: `${__("Request rejected")} \xB7 ${req.counter}`, colour: "red" };
        }
        return { text: __("Unregistered device"), colour: "red" };
      }
      const where = `${state.counter} \xB7 ${state.device}`;
      const s = state.session;
      if (s && s.status === "Closing") {
        return { text: `${where} \xB7 ${__("Close awaiting approval")}`, colour: "orange" };
      }
      if (s) {
        const since = frappe.datetime.str_to_user(s.opened_on).split(" ").pop();
        return { text: `${where} \xB7 ${__("Day open since {0}", [since])}`, colour: "green" };
      }
      return { text: `${where} \xB7 ${__("Day not opened")}`, colour: state.must_open_day ? "orange" : "blue" };
    }
    function render_badge(state) {
      $("#digitz-counter-badge").remove();
      const { text, colour } = badge_text(state);
      const waiting = (state.pending_approvals || 0) + (state.device_requests || 0);
      const approvals = waiting ? ` <span class="badge badge-pill" style="background: var(--orange-500, #f59e0b); color: #fff;"
				title="${esc(__("Day closes and device requests waiting for your approval"))}">${waiting}</span>` : "";
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
            indicator: "orange"
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
    const NEW_COUNTER = "__new__";
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
            fieldname: "counter",
            fieldtype: "Select",
            label: __("Counter"),
            reqd: 1,
            options: [
              ...counters.map((c) => ({ label: c, value: c })),
              { label: __("+ New counter"), value: NEW_COUNTER }
            ],
            default: state.counter || counters[0] || NEW_COUNTER,
            change: () => show_replaced()
          },
          {
            fieldname: "new_counter",
            fieldtype: "Data",
            label: __("New counter name"),
            default: suggest_counter_name(counters),
            depends_on: `eval:doc.counter=='${NEW_COUNTER}'`,
            mandatory_depends_on: `eval:doc.counter=='${NEW_COUNTER}'`,
            description: __("The counter is created now, and this PC registered to it.")
          },
          {
            fieldtype: "HTML",
            options: `<p class="text-muted small">${state.device ? __("This PC is currently {0} ({1}). Registering again gives it a new device number.", [esc(state.device), esc(state.counter)]) : __("This PC gets its own device number. Everything saved here is recorded against the counter you choose.")}</p>`
          },
          { fieldname: "replaced", fieldtype: "HTML" }
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
              const disabled = (r.message.disabled || []).length ? " " + __("Disabled: {0}", [r.message.disabled.join(", ")]) : "";
              frappe.show_alert({
                message: __("This PC is now {0} ({1})", [r.message.counter, r.message.device]) + disabled,
                indicator: "green"
              });
              refresh();
            }
          });
        }
      });
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
								<span>${row.counter === counter ? __(
                "{0}'s day {1} is still open. It carries on on this PC: no new Day Open is needed.",
                [`<b>${esc(row.cashier_name)}</b>`, esc(row.open_session)]
              ) : __(
                "{0}'s day {1} is still open on {2}. Close it from any PC, or register a new {2} PC to carry on.",
                [`<b>${esc(row.cashier_name)}</b>`, esc(row.open_session), esc(row.counter)]
              )}</span>
							</div>`;
              return `
							<li class="cd-replace-item">
								<div class="cd-replace-device"><b>${esc(row.device)}</b> \xB7 ${esc(row.counter)} <span class="cd-replace-seen">${esc(seen)}</span></div>
								${open}
							</li>`;
            }).join("");
            $area.html(`
						<div class="cd-replace-warning" role="alert">
							<div class="cd-replace-head">
								${frappe.utils.icon("solid-warning", "sm")}
								<span>${rows.length === 1 ? __("Registering replaces the PC now on {0}", [esc(counter)]) : __("Registering replaces {0} PCs", [rows.length])}</span>
							</div>
							<ul class="cd-replace-list">${items}</ul>
							<div class="cd-replace-foot">${esc(__("A counter has one PC. The replaced PC stops working as a counter until it is registered again."))}</div>
						</div>`);
            d.get_primary_btn().text(__("Register & Replace"));
          }
        });
      }
      d.show();
      show_replaced();
    }
    function open_request_dialog(state) {
      frappe.call({
        method: DEVICE_API + "get_request_options",
        callback(r) {
          const options = r.message || [];
          if (!options.length) {
            frappe.msgprint(__("There are no counters yet. Ask a supervisor to register this PC."));
            return;
          }
          const rejected = state.registration_request && state.registration_request.approval_status === "Rejected" ? `<p class="small" style="color: var(--red-600, #dc2626);">${esc(__("Your last request for {0} was rejected. Ask a supervisor why before asking again.", [state.registration_request.counter]))}</p>` : "";
          const d = new frappe.ui.Dialog({
            title: __("Ask to register this PC"),
            fields: [
              { fieldtype: "HTML", options: rejected },
              {
                fieldname: "counter",
                fieldtype: "Select",
                label: __("Counter"),
                reqd: 1,
                options: options.map((o) => ({
                  value: o.counter,
                  label: o.device ? __("{0} \xB7 has a PC ({1}), needs approval", [o.counter, o.device]) : __("{0} \xB7 free, ready at once", [o.counter])
                })),
                default: (options.find((o) => !o.device) || options[0]).counter
              },
              {
                fieldtype: "HTML",
                options: `<p class="text-muted small">${__("A free counter becomes this PC's at once. A counter that already has a PC needs a supervisor's approval, because this PC would replace it.")}</p>`
              }
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
                    message: approved ? __("This PC is now {0} ({1})", [res.message.counter, res.message.device]) : __("Approval pending: a supervisor must approve this PC for {0}", [res.message.counter]),
                    indicator: approved ? "green" : "orange"
                  }, 8);
                  refresh();
                }
              });
            }
          });
          d.show();
        }
      });
    }
    function open_requests_dialog(state) {
      const d = new frappe.ui.Dialog({
        title: __("PCs waiting for approval"),
        size: "large",
        fields: [{ fieldname: "list", fieldtype: "HTML" }]
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
										<td><b>${esc(row.counter)}</b><div class="text-muted small">${esc(row.device)} \xB7 ${esc(frappe.datetime.str_to_user(row.registered_on))}</div></td>
										<td>${esc(row.requested_by_name)}<div class="text-muted small" title="${esc(row.user_agent)}">${esc((row.user_agent || "").slice(0, 40))}</div></td>
										<td>${esc(row.replaces || __("nothing"))}${row.open_session ? `<div class="small" style="color: var(--orange-600, #ea580c);">${esc(__("{0}'s day {1} is open", [row.cashier_name, row.open_session]))}</div>` : ""}</td>
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
          }
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
            }
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
              }
            }),
            __("Reject {0}", [device]),
            __("Reject")
          );
        }
      });
      d.show();
      load();
    }
    function refresh() {
      frappe.call({
        method: DEVICE_API + "resolve_device",
        args: { secret: read_secret() },
        callback() {
          frappe.call({
            method: SESSION_API + "get_state",
            callback(r) {
              if (r.message) {
                render_badge(r.message);
                digitz_erp.counter_state = r.message;
                $(document).trigger("digitz:counter-state", [r.message]);
              }
            }
          });
        }
      });
    }
    frappe.provide("digitz_erp");
    digitz_erp.refresh_counter_badge = refresh;
    digitz_erp.open_register_device_dialog = open_register_dialog;
    $(document).on("app_ready", () => {
      refresh();
      frappe.realtime.on("digitz_counter_devices", refresh);
    });
  })();
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
        count: cint($(tr).find("input").val())
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
    set_counts(rows) {
      const by_value = {};
      (rows || []).forEach((r) => by_value[flt(r.denomination)] = cint(r.count));
      this.$el.find("tbody tr").each((_, tr) => {
        const count = by_value[flt($(tr).attr("data-value"))];
        $(tr).find("input").val(count || "");
      });
      this.update();
    }
  };
  digitz_erp.dayops_styles = function() {
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

  // ../digitz_erp/digitz_erp/public/js/day_ops.js
  frappe.provide("digitz_erp");
  digitz_erp.DayOpsBase = class DayOpsBase {
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
          s.can_register ? __("Register it to a counter first. Every day opened here then belongs to that counter.") : __("Ask a supervisor to register this PC as a counter before opening the day."),
          s.can_register ? __("Register this device") : null,
          () => digitz_erp.open_register_device_dialog(s)
        );
      }
      if (s.session && s.session.status === "Closing") {
        return this.state_panel(
          __("Your last close is waiting for approval"),
          __("A supervisor has to approve the cash difference on {0} before a new day can be opened.", [s.session.name]),
          __("View Day Close"),
          () => this.go("day-close")
        );
      }
      if (s.session) {
        return this.state_panel(
          __("Your day is already open"),
          __(
            "Open on {0} since {1}, with a float of {2}.",
            [frappe.utils.escape_html(s.session.counter), frappe.datetime.str_to_user(s.session.opened_on), this.money(s.session.opening_float)]
          ),
          __("Go to Day Close"),
          () => this.go("day-close")
        );
      }
      if (s.counter_taken) {
        const t = s.counter_taken;
        return this.state_panel(
          __("{0} is in use", [frappe.utils.escape_html(s.counter)]),
          __(
            "{0} has a day open here since {1} ({2}). They close it with Close & Hand Over, or a supervisor closes it for them from Day Close.",
            [frappe.utils.escape_html(t.cashier_name), frappe.datetime.str_to_user(t.opened_on), frappe.utils.escape_html(t.name)]
          ),
          s.is_supervisor ? __("Go to Day Close") : null,
          () => this.go("day-close")
        );
      }
      const last = s.last_close;
      const closed_by = last && last.closed_by && last.closed_by !== last.cashier ? `<tr><td>${__("Counted by supervisor")}</td><td class="dayops-num">${frappe.utils.escape_html(last.closed_by_name || last.closed_by)}</td></tr>` : "";
      const pending = last && last.status === "Closing" ? `<div class="dayops-result over" style="margin-bottom: 10px;">${__("This close is still waiting for a supervisor to approve its difference. The count below is what was left in the till.")}</div>` : "";
      const previous = last ? `
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
				<p class="text-muted small" style="margin: 6px 0 0;">${__("For a handover: fills the count with what was left in the till. Check it against the notes before opening.")}</p>` : `<p class="text-muted">${__("No day has been closed on this counter yet.")}</p>`;
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
          fieldtype: "Currency",
          fieldname: "opening_float",
          label: __("Opening Float"),
          reqd: 1,
          description: __("Filled from the count, or type the total."),
          change: () => this.show_float_note()
        },
        render_input: true
      });
      this.float.set_value(last ? flt(last.counted_cash) : 0);
      this.remarks = frappe.ui.form.make_control({
        parent: this.$body.find(".remarks-field"),
        df: { fieldtype: "Small Text", fieldname: "remarks", label: __("Remarks") },
        render_input: true
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
      if (Math.abs(change) < 5e-3) {
        $note.html(`<div class="dayops-result ok">${__("Same as the cash left at the last close")}</div>`);
      } else {
        $note.html(`<div class="dayops-result over">${change < 0 ? __("{0} less than the last close (cash taken out or banked)", [this.money(-change)]) : __("{0} more than the last close (cash added)", [this.money(change)])}</div>`);
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
          }
        })
      );
    }
  };
  var day_close_movements = () => [
    { field: "cash_sales", label: __("Cash Sales"), sign: "+" },
    { field: "cash_receipts", label: __("Cash Receipts (Credit Collections)"), sign: "+" },
    { field: "cash_refunds", label: __("Cash Refunds"), sign: "\u2212" },
    { field: "cash_paid_out", label: __("Cash Paid Out"), sign: "\u2212" }
  ];
  digitz_erp.DayClose = class DayClose extends digitz_erp.DayOpsBase {
    constructor(page, opts) {
      super(page, opts, "day-close");
      this.$approvals = $('<div class="dayops"></div>').appendTo(this.$parent);
    }
    async load() {
      this.clear_actions();
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
				<div><div class="k">${__("Counter")}</div><div class="v">${this.esc(s.counter || s.session && s.session.counter || "-")}</div></div>
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
    render_close() {
      const p = this.preview;
      const docs = p.documents || {};
      const movement_rows = day_close_movements().map((m) => {
        const list = docs[m.field] || [];
        const detail = list.map((d) => `
				<tr class="dayops-docs" data-for="${m.field}" style="display: none;">
					<td><a href="/app/${frappe.router.slug(d.doctype)}/${encodeURIComponent(d.name)}">${this.esc(d.name)}</a>
						${d.posting_time ? " \xB7 " + this.esc(String(d.posting_time).slice(0, 5)) : ""}
						${d.party ? " \xB7 " + this.esc(d.party) : ""}</td>
					<td class="dayops-num">${this.money(d.amount)}</td>
				</tr>`).join("");
        return `
				<tr class="dayops-toggle" data-toggle="${m.field}">
					<td><span class="dayops-caret">${list.length ? "\u25B8" : ""}</span>${m.sign} ${m.label}
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
							<tr><td>\u2212 ${__("Expenditure")} <span class="text-muted small">(${__("entered below")})</span></td><td class="dayops-num dayops-exp">${this.money(0)}</td></tr>
							<tr class="total"><td>${__("Expected Cash in the Till")}</td><td class="dayops-num dayops-expected">${this.money(p.expected_cash)}</td></tr>
						</table>
						<p class="text-muted small" style="margin-top: 8px;">${__("Only submitted documents with a cash payment mode count. Click a line to see its documents.")}</p>
					</div>
				</div>
				<div>
					<div class="dayops-card"><h4>${__("Count the Closing Cash")}</h4><div class="dayops-count-wrap"></div></div>
					<div class="dayops-card">
						<h4>${__("Close")}</h4>
						<div class="expenditure-field"></div>
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
        $(e.currentTarget).find(".dayops-caret").text(open ? "\u25BE" : "\u25B8");
      });
      this.expenditure = frappe.ui.form.make_control({
        parent: this.$body.find(".expenditure-field"),
        df: {
          fieldtype: "Currency",
          fieldname: "expenditure",
          label: __("Expenditure"),
          description: __("Cash paid out of the till today. Explain it in Remarks."),
          change: () => this.update_expected()
        },
        render_input: true
      });
      this.counted = frappe.ui.form.make_control({
        parent: this.$body.find(".counted-field"),
        df: {
          fieldtype: "Currency",
          fieldname: "counted_cash",
          label: __("Counted Cash"),
          reqd: 1,
          description: __("Filled from the count, or type the total."),
          change: () => this.show_result()
        },
        render_input: true
      });
      this.remarks = frappe.ui.form.make_control({
        parent: this.$body.find(".remarks-field"),
        df: {
          fieldtype: "Small Text",
          fieldname: "remarks",
          label: __("Remarks"),
          description: __("Explain any shortage or excess for the supervisor.")
        },
        render_input: true
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
    expected() {
      return flt(this.preview.expected_cash) - flt(this.expenditure && this.expenditure.get_value());
    }
    update_expected() {
      this.$body.find(".dayops-exp").text(this.money(flt(this.expenditure.get_value())));
      this.$body.find(".dayops-expected").text(this.money(this.expected()));
      this.show_result();
    }
    show_result() {
      const $r = this.$body.find(".close-result").empty();
      const counted = this.counted.get_value();
      if (counted === void 0 || counted === null || counted === "") {
        return;
      }
      const diff = flt(counted) - this.expected();
      if (Math.abs(diff) < 5e-3) {
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
      if (counted === void 0 || counted === null || counted === "") {
        frappe.msgprint(__("Count the till, or enter the counted cash."));
        return;
      }
      const spent = flt(this.expenditure.get_value());
      if (spent < 0) {
        frappe.msgprint(__("Expenditure cannot be negative."));
        return;
      }
      const with_spent = spent ? " " + __("Expenditure: {0}.", [this.money(spent)]) : "";
      frappe.confirm(
        (handover ? __("Close your day with {0} counted in the till and log out for the next cashier?", [this.money(counted)]) : __("Close the day with {0} counted in the till?", [this.money(counted)])) + with_spent,
        () => frappe.call({
          method: "digitz_erp.api.counter_session_api.close_day",
          args: {
            counted_cash: counted,
            denominations: this.count.counted(),
            remarks: this.remarks.get_value(),
            expenditure: flt(this.expenditure.get_value())
          },
          freeze: true,
          freeze_message: __("Closing the day..."),
          callback: (r) => {
            if (!r.message) {
              return;
            }
            this.changed();
            this.show_closed(r.message, handover);
          }
        })
      );
    }
    show_closed(result, handover) {
      this.clear_actions();
      const closed = result.status === "Closed";
      const next = handover ? `<button class="btn btn-primary btn-sm dayops-logout" style="margin-left: 6px;">${__("Log Out for Next Cashier")}</button>` : `<button class="btn btn-default btn-sm dayops-open" style="margin-left: 6px;">${__("Go to Day Open")}</button>`;
      this.$body.html(`${this.header()}
			<div class="dayops-card dayops-state">
				<div class="dayops-big">${closed ? __("Day closed") : __("Close sent for approval")}</div>
				<p>${closed ? __("The till matched the expected cash. {0} is closed.", [this.esc(result.session)]) : __("The count differs by {0}. {1} will close once a supervisor approves it.", [this.money(result.difference), this.esc(result.session)])}
				${handover ? "<br>" + __("The counter is free: the next cashier can sign in on this PC and open with your count.") : ""}</p>
				<button class="btn ${handover ? "btn-default" : "btn-primary"} btn-sm dayops-print">${__("Print Day Close Slip")}</button>
				${next}
			</div>`);
      this.$body.find(".dayops-print").on("click", () => this.print(result.session));
      this.$body.find(".dayops-open").on("click", () => this.go("day-open"));
      this.$body.find(".dayops-logout").on("click", () => frappe.app.logout());
      this.render_approvals();
    }
    print(session) {
      digitz_erp.DayOpsBase.print_slip(session);
    }
    async render_approvals() {
      this.$approvals.empty();
      if (!this.state.is_supervisor) {
        return;
      }
      const [open, pending] = await Promise.all([
        frappe.call({ method: "digitz_erp.api.counter_session_api.get_open_days" }),
        frappe.call({ method: "digitz_erp.api.counter_session_api.get_pending_approvals" })
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
            fieldtype: "HTML",
            fieldname: "summary",
            options: `<p>${__("Expected cash in the till")}: <b class="sv-expected">${this.money(row.expected_cash)}</b>
						<span class="text-muted">(${__("float")} ${this.money(row.opening_float)})</span></p>`
          },
          {
            fieldtype: "Currency",
            fieldname: "expenditure",
            label: __("Expenditure"),
            description: __("Cash paid out of the till that the cashier did not enter."),
            change: () => show_result()
          },
          { fieldtype: "HTML", fieldname: "count_wrap" },
          { fieldtype: "Column Break" },
          {
            fieldtype: "Currency",
            fieldname: "counted_cash",
            label: __("Counted Cash"),
            reqd: 1,
            description: __("Filled from the count, or type the total."),
            change: () => show_result()
          },
          { fieldtype: "HTML", fieldname: "result" },
          {
            fieldtype: "Small Text",
            fieldname: "remarks",
            label: __("Reason"),
            reqd: 1,
            description: __("Why you are closing this day for the cashier. Shown on the Day Close slip.")
          }
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
              expenditure: flt(values.expenditure)
            },
            freeze: true,
            freeze_message: __("Closing the day..."),
            callback: (r) => {
              if (!r.message) {
                return;
              }
              d.hide();
              frappe.show_alert({ message: __("{0} closed. {1} is free.", [row.name, row.counter]), indicator: "green" });
              this.changed();
              this.load();
            }
          });
        }
      });
      const show_result = () => {
        const expected = flt(row.expected_cash) - flt(d.get_value("expenditure"));
        d.fields_dict.summary.$wrapper.find(".sv-expected").text(this.money(expected));
        const counted = d.get_value("counted_cash");
        const $r = d.fields_dict.result.$wrapper.empty();
        if (counted === void 0 || counted === null || counted === "") {
          return;
        }
        const diff = flt(counted) - expected;
        $r.html(Math.abs(diff) < 5e-3 ? `<div class="dayops-result ok">${__("Matches the expected cash.")}</div>` : `<div class="dayops-result ${diff < 0 ? "short" : "over"}">
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
              this.changed();
              this.load();
            }
          })
        );
      });
    }
  };
  var _a;
  digitz_erp.DayHistory = (_a = class {
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
          df: __spreadProps(__spreadValues({}, df), { change: () => this.reload() }),
          render_input: true
        });
        return control;
      };
      const today = frappe.datetime.get_today();
      this.fields = {
        from_date: field({ fieldtype: "Date", fieldname: "from_date", label: __("From") }),
        to_date: field({ fieldtype: "Date", fieldname: "to_date", label: __("To") }),
        status: field({
          fieldtype: "Select",
          fieldname: "status",
          label: __("Status"),
          options: [
            { value: "", label: __("All") },
            { value: "Open", label: __("Open") },
            { value: "Closing", label: __("Awaiting Approval") },
            { value: "Closed", label: __("Closed") }
          ]
        }),
        counter: field({ fieldtype: "Link", fieldname: "counter", label: __("Counter"), options: "Counter" }, "cc-hist-sup hide"),
        cashier: field({ fieldtype: "Link", fieldname: "cashier", label: __("Cashier"), options: "User" }, "cc-hist-sup hide")
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
        today,
        week: frappe.datetime.week_start(),
        month: frappe.datetime.month_start(),
        30: frappe.datetime.add_days(today, -29)
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
      const seq = this.seq = (this.seq || 0) + 1;
      this.$el.addClass("is-loading");
      try {
        const r = await frappe.call({
          method: "digitz_erp.api.counter_session_api.get_session_history",
          args: this.filters()
        });
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
      const diff_class = Math.abs(t.net_difference) < 5e-3 ? "" : t.net_difference < 0 ? "is-short" : "is-over";
      const tile = (label, value, cls = "") => `
			<div class="cc-hist-tile ${cls}">
				<div class="cc-hist-tile-label">${label}</div>
				<div class="cc-hist-tile-value">${value}</div>
			</div>`;
      this.$el.find(".cc-hist-tiles").html(
        tile(__("Days"), t.days) + tile(__("Cash Sales"), this.money(t.cash_sales)) + tile(__("Cash Receipts"), this.money(t.cash_receipts)) + tile(__("Expenditure"), this.money(t.cash_expenditure)) + tile(__("Net Difference"), this.money(t.net_difference), diff_class) + tile(__("Open / Awaiting"), t.pending, t.pending ? "is-pending" : "")
      );
    }
    render_table(rows) {
      const $table = this.$el.find(".cc-hist-table");
      const report_link = this.is_supervisor ? `<button type="button" class="btn btn-xs btn-default cc-hist-report">${__("Open full report")}</button>` : "";
      if (!rows.length) {
        $table.html(`
				<div class="cc-hist-empty">
					<p>${__("No days in this range.")}</p>
					${report_link}
				</div>`);
        return;
      }
      const time = (dt) => dt ? moment(dt).format("hh:mm A") : "";
      const day = (dt) => dt ? frappe.datetime.str_to_user(String(dt).split(" ")[0]) : "";
      const pending = (row) => row.status === "Open";
      const body = rows.map((row) => {
        const closed = !row.closed_on ? `<span class="text-muted">${__("Still open")}</span>` : day(row.closed_on) === day(row.opened_on) ? time(row.closed_on) : `${day(row.closed_on)} ${time(row.closed_on)}`;
        const diff = flt(row.difference);
        const diff_class = pending(row) || Math.abs(diff) < 5e-3 ? "" : diff < 0 ? "is-short" : "is-over";
        const amount = (v) => pending(row) ? `<span class="text-muted">\u2014</span>` : this.money(v);
        const status_label = row.status === "Closing" ? __("Awaiting Approval") : __(row.status);
        return `
				<tr>
					<td>${day(row.opened_on)}</td>
					<td><a href="/app/counter-session/${encodeURIComponent(row.name)}">${this.esc(row.name)}</a></td>
					<td>${this.esc(row.counter)}</td>
					${this.is_supervisor ? `<td>${this.esc(row.cashier_name)}</td>` : ""}
					<td class="cc-nowrap">${time(row.opened_on)} \u2192 ${closed}</td>
					<td class="cc-num">${this.money(row.opening_float)}</td>
					<td class="cc-num">${amount(row.expected_cash)}</td>
					<td class="cc-num">${amount(row.counted_cash)}</td>
					<td class="cc-num ${diff_class}">${amount(diff)}</td>
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
						<th>${__("Opened \u2192 Closed")}</th>
						<th class="cc-num">${__("Float")}</th><th class="cc-num">${__("Expected")}</th>
						<th class="cc-num">${__("Counted")}</th><th class="cc-num">${__("Difference")}</th>
						<th>${__("Status")}</th><th></th>
					</tr></thead>
					<tbody>${body}</tbody>
				</table>
			</div>
			<div class="cc-hist-foot">
				<span class="text-muted small">${__("Expected and counted cash are worked out when a day is closed.")}</span>
				${report_link}
			</div>`);
    }
  }, __publicField(_a, "STATUS_COLOURS", { Open: "green", Closing: "orange", Closed: "gray" }), _a);
})();
//# sourceMappingURL=counter_device.bundle.X4DVADMJ.js.map
