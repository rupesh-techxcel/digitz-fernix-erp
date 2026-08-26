// Medical Center Dashboard
//
// Live operations view: what each counter is doing right now, who is on, what
// is still in the queue, and whether the token pull is healthy. All of it comes
// from one whitelisted call (digitz_erp.api.dashboard.get_live_dashboard) so a
// refresh is a single round trip.
//
// It refreshes when the server pushes a new invoice, plus a slow timer as a
// safety net, and tears both down when you navigate away.
//
// Colour rules worth preserving if you edit this:
//   * counter colour comes from the server and follows the COUNTER, not its
//     rank, so the list is ordered by user id rather than by takings;
//   * every bar is directly labelled. The palette clears the dataviz validator
//     at --pairs all in both themes, but with two WARNs (violet/blue CVD, and
//     dark-mode contrast) whose required relief is exactly those labels.
//     Never let colour be the only thing carrying identity here.

frappe.provide("digitz_erp");

frappe.pages["Medical Center Dashboard"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Medical Center Dashboard",
		single_column: true,
	});

	wrapper.dashboard = new digitz_erp.MedicalCenterDashboard(page, wrapper);
};

digitz_erp.MedicalCenterDashboard = class MedicalCenterDashboard {
	static POLL_MS = 15000;

	constructor(page, wrapper) {
		this.page = page;
		this.$wrapper = $(wrapper);
		this.running = false;
		this.fetching = false;
		this.realtime_handler = () => this.refresh();

		this.inject_styles();
		this.setup_page();
		this.bind_events();
		this.start();
	}

	// The page owns its stylesheet; injected once per desk session.
	inject_styles() {
		if (document.getElementById("mcd-styles")) {
			return;
		}

		const style = document.createElement("style");
		style.id = "mcd-styles";
		style.textContent = digitz_erp.MedicalCenterDashboard.CSS;
		document.head.appendChild(style);
	}

	setup_page() {
		this.page.set_primary_action(__("Sync Now"), () => this.sync_now(), "refresh");
		this.page.set_secondary_action(__("Workspace"), () =>
			frappe.set_route("Workspaces", "Medical Center")
		);

		this.$wrapper.find(".layout-main-section").html('<div class="mcd-root"></div>');
		this.$root = this.$wrapper.find(".mcd-root");
		this.$root.html('<div class="mcd-loading">' + __("Loading live data...") + "</div>");
	}

	bind_events() {
		this.$wrapper.on("show", () => this.start());
		this.$wrapper.on("hide", () => this.stop());

		this.$wrapper.on("click", "[data-route-name]", (event) => {
			frappe.set_route("Form", "Sales Invoice", $(event.currentTarget).attr("data-route-name"));
		});

		this.$wrapper.on("click", "[data-open-board]", () => {
			frappe.set_route("Sales Invoice Board");
		});
	}

	start() {
		if (this.running) {
			return;
		}

		this.running = true;
		frappe.realtime.on(digitz_erp.token_notifications.EVENT, this.realtime_handler);
		this.refresh();
		this.timer = setInterval(
			() => this.refresh(),
			digitz_erp.MedicalCenterDashboard.POLL_MS
		);
	}

	stop() {
		if (!this.running) {
			return;
		}

		this.running = false;
		frappe.realtime.off(digitz_erp.token_notifications.EVENT, this.realtime_handler);

		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	refresh() {
		if (this.fetching) {
			return;
		}

		this.fetching = true;

		frappe.call({
			method: "digitz_erp.api.dashboard.get_live_dashboard",
			callback: (r) => {
				if (r.message) {
					this.data = r.message;
					this.render();
				}
			},
			error: () => {
				this.$root.find(".mcd-stamp-live").text(__("Reconnecting..."));
			},
			always: () => {
				this.fetching = false;
			},
		});
	}

	sync_now() {
		frappe.call({
			method: "digitz_erp.api.token_sync.run_token_sync_now",
			freeze: true,
			freeze_message: __("Queueing token sync..."),
			callback: () => {
				frappe.show_alert({ message: __("Token sync queued"), indicator: "blue" }, 4);
				setTimeout(() => this.refresh(), 2500);
			},
		});
	}

	// ---------------------------------------------------------------- render

	render() {
		const d = this.data;

		this.$root.html(`
			${this.render_hero(d)}
			${this.render_kpis(d)}
			${this.render_counters(d)}
			${this.render_activity(d)}
			${this.render_queue(d)}
		`);
	}

	render_hero(d) {
		const sync = d.sync;
		const state_label = {
			good: __("Token sync healthy"),
			warning: __("Tokens pending"),
			critical: __("Tokens failed"),
			off: __("Token sync is off"),
		}[sync.state];

		return `
			<div class="mcd-hero">
				<div>
					<div class="mcd-eyebrow">${__("Live Operations")}</div>
					<h2>${__("Medical Center")}</h2>
					<p>${frappe.datetime.str_to_user(d.date)} &middot;
						<span class="mcd-stamp-live">${__("updated")} ${this.time_of(d.generated_at)}</span>
					</p>
				</div>
				<div class="mcd-hero-side">
					<span class="mcd-pulse"><i></i>${__("Live")}</span>
					<span class="mcd-health mcd-h-${esc_attr(sync.state)}">
						${state_label}
						${sync.failed ? " &middot; " + sync.failed + " " + __("failed") : ""}
						${sync.pending ? " &middot; " + sync.pending + " " + __("pending") : ""}
					</span>
				</div>
			</div>`;
	}

	render_kpis(d) {
		const t = d.totals;

		const tiles = [
			{
				label: __("Active Counters"),
				value: `${t.active_counters}<span class="mcd-of">/${t.total_counters}</span>`,
				sub: __("desks signed in"),
				tone: ["#3b82f6", "#2563eb"],
				icon: '<path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6"/>',
			},
			{
				label: __("Users Online"),
				value: d.online.length,
				sub: __("last 15 minutes"),
				tone: ["#a855f7", "#9333ea"],
				icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/>',
			},
			{
				label: __("In Progress"),
				value: t.drafts,
				sub: format_currency(t.draft_amount) + " " + __("pending"),
				tone: ["#f59e0b", "#d97706"],
				icon: '<path d="M12 2v4M12 18v4M4.9 4.9l2.9 2.9M16.2 16.2l2.9 2.9M2 12h4M18 12h4M4.9 19.1l2.9-2.9M16.2 7.8l2.9-2.9"/>',
			},
			{
				label: __("Collected Today"),
				value: format_currency(t.amount),
				sub: t.submitted + " " + __("submitted"),
				tone: ["#10b981", "#059669"],
				icon: '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
			},
			{
				label: __("Tokens Today"),
				value: t.tokens,
				sub: `${d.sync.completed} ${__("done")} &middot; ${d.sync.skipped} ${__("skipped")}`,
				tone: ["#0ea5e9", "#0284c7"],
				icon: '<path d="M20 12a2 2 0 0 1 0-4V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v2a2 2 0 0 1 0 4v2a2 2 0 0 1 0 4v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2a2 2 0 0 1 0-4z"/>',
			},
		];

		return `<div class="mcd-kpis">${tiles
			.map(
				(t) => `
			<div class="mcd-kpi" style="--tone:${t.tone[0]};--tone-2:${t.tone[1]};--tone-soft:${soft(t.tone[0])}">
				<span class="mcd-chip">${svg(t.icon)}</span>
				<div class="mcd-kpi-body">
					<div class="mcd-kpi-label">${t.label}</div>
					<div class="mcd-kpi-value">${t.value}</div>
					<div class="mcd-kpi-sub">${t.sub}</div>
				</div>
			</div>`
			)
			.join("")}</div>`;
	}

	render_counters(d) {
		if (!d.counters.length) {
			return this.panel(
				__("Counter Split"),
				__("Today"),
				`<p class="mcd-empty">${__("No counter has raised an invoice today.")}</p>`
			);
		}

		// Two-state stacked bar, so a legend is required: identity of the
		// segments must not rest on colour alone.
		const legend = `
			<div class="mcd-legend">
				<span><i class="mcd-sw mcd-sw-solid"></i>${__("Collected")}</span>
				<span><i class="mcd-sw mcd-sw-soft"></i>${__("In progress")}</span>
			</div>`;

		const rows = d.counters
			.map((c) => {
				const collected = c.total_amount ? (c.amount / c.total_amount) * 100 : 0;
				const pending = c.total_amount ? (c.draft_amount / c.total_amount) * 100 : 0;

				// Only emit segments that have width: a zero-width flex child
				// still consumes the 2px gap and leaves a floating sliver.
				const segments =
					(collected > 0
						? `<span class="mcd-seg mcd-seg-solid" style="width:${collected}%"></span>`
						: "") +
					(pending > 0
						? `<span class="mcd-seg mcd-seg-soft" style="width:${pending}%"></span>`
						: "");

				return `
				<div class="mcd-counter" style="--tone:${esc_attr(c.color)}">
					<div class="mcd-c-id">
						<span class="mcd-avatar">${frappe.utils.escape_html(c.initials)}</span>
						<div>
							<div class="mcd-c-name">
								${frappe.utils.escape_html(c.full_name)}
								<span class="mcd-dot ${c.online ? "on" : "off"}"
									title="${c.online ? __("Signed in") : __("Not signed in")}"></span>
							</div>
							<div class="mcd-c-meta">
								${c.invoices} ${__("invoices")} &middot; ${c.tokens} ${__("tokens")}
							</div>
						</div>
					</div>
					<div class="mcd-c-bar-wrap">
						<div class="mcd-c-track" style="width:${c.share}%"
							title="${frappe.utils.escape_html(c.full_name)}: ${__("handled")} ${format_currency(c.total_amount)}">
							${segments}
						</div>
					</div>
					<div class="mcd-c-values">
						<div class="mcd-c-amount">${format_currency(c.total_amount)}</div>
						<div class="mcd-c-draft">${format_currency(c.amount)} ${__("collected")}
							&middot; ${format_currency(c.draft_amount)} ${__("open")}</div>
					</div>
				</div>`;
			})
			.join("");

		return this.panel(__("Counter Split"), legend, `<div class="mcd-counters">${rows}</div>`);
	}

	render_activity(d) {
		const peak = Math.max(...d.hourly.map((h) => h.invoices), 1);
		const any = d.hourly.some((h) => h.invoices);

		if (!any) {
			return this.panel(
				__("Activity by Hour"),
				"",
				`<p class="mcd-empty">${__("No invoices raised yet today.")}</p>`
			);
		}

		const bars = d.hourly
			.map(
				(h) => `
			<div class="mcd-hbar ${h.current ? "now" : ""}"
				title="${String(h.hour).padStart(2, "0")}:00 — ${h.invoices} ${__("invoices")}, ${format_currency(h.amount)}">
				<span style="height:${Math.max((h.invoices / peak) * 100, h.invoices ? 6 : 0)}%"></span>
				<b>${h.hour % 6 === 0 ? String(h.hour).padStart(2, "0") : "&nbsp;"}</b>
			</div>`
			)
			.join("");

		return this.panel(
			__("Activity by Hour"),
			`<span class="mcd-note">${__("peak")} ${peak} ${__("in an hour")}
				&middot; <i class="mcd-sw mcd-sw-now"></i> ${__("current hour")}</span>`,
			`<div class="mcd-hours">${bars}</div>`
		);
	}

	render_queue(d) {
		if (!d.queue.length) {
			return this.panel(
				__("Live Queue"),
				"",
				`<p class="mcd-empty">${__("Nothing waiting. Every invoice is settled.")}</p>`
			);
		}

		const rows = d.queue
			.map(
				(q) => `
			<tr data-route-name="${esc_attr(q.name)}">
				<td><span class="mcd-owner-dot" style="background:${esc_attr(q.color)}"
					title="${frappe.utils.escape_html(q.owner_name)}"></span>
					${frappe.utils.escape_html(q.owner_name)}</td>
				<td>${frappe.utils.escape_html(q.customer || "")}</td>
				<td>${frappe.utils.escape_html(q.medical_service || "")}</td>
				<td>${frappe.utils.escape_html(q.customer_token || "")}</td>
				<td class="mcd-num">${format_currency(q.rounded_total)}</td>
				<td class="mcd-ago">${comment_when(q.creation)}</td>
			</tr>`
			)
			.join("");

		return this.panel(
			__("Live Queue"),
			`<button class="mcd-link" data-open-board>${__("Open board")}</button>`,
			`<table class="mcd-table">
				<thead><tr>
					<th>${__("Counter")}</th><th>${__("Customer")}</th><th>${__("Service")}</th>
					<th>${__("Token")}</th><th class="mcd-num">${__("Amount")}</th><th>${__("Raised")}</th>
				</tr></thead>
				<tbody>${rows}</tbody>
			</table>`
		);
	}

	panel(title, aside, body) {
		return `
			<section class="mcd-panel">
				<div class="mcd-panel-head">
					<h3>${title}</h3>
					<div class="mcd-panel-aside">${aside || ""}</div>
				</div>
				${body}
			</section>`;
	}

	time_of(datetime_string) {
		return (datetime_string || "").split(" ")[1]?.slice(0, 8) || "";
	}
};

function svg(paths) {
	return (
		'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
		'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
		paths +
		"</svg>"
	);
}

// CSS cannot add alpha to a hex custom property without color-mix(), which is
// newer than the browsers this desk supports, so the resting border colour is
// precomputed here.
function soft(hex, alpha = 0.45) {
	const h = hex.replace("#", "");
	const n = parseInt(h, 16);
	return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function esc_attr(value) {
	return frappe.utils.escape_html(String(value == null ? "" : value));
}

digitz_erp.MedicalCenterDashboard.CSS = `
.mcd-root { padding: 2px; }
.mcd-root *, .mcd-root *::before, .mcd-root *::after { box-sizing: border-box; }
.mcd-loading, .mcd-empty { color: var(--text-muted); font-size: 13px; padding: 18px 2px; margin: 0; }

/* hero — same language as the workspace navigator block */
.mcd-hero {
  position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: space-between;
  gap: 18px; flex-wrap: wrap;
  padding: 20px 22px; margin-bottom: 18px;
  border: 1px solid var(--border-color); border-radius: var(--border-radius-lg, 10px);
  background:
    radial-gradient(105% 150% at 100% 0%, rgba(168,85,247,.24) 0%, rgba(168,85,247,0) 58%),
    radial-gradient(95% 140% at 62% 120%, rgba(236,72,153,.18) 0%, rgba(236,72,153,0) 60%),
    radial-gradient(85% 130% at 0% 100%, rgba(14,165,233,.24) 0%, rgba(14,165,233,0) 62%),
    var(--card-bg, var(--fg-color));
}
.mcd-hero::before {
  content: ""; position: absolute; inset: 0 0 auto 0; height: 3px;
  background: linear-gradient(90deg,#0ea5e9,#8b5cf6 38%,#ec4899 68%,#f97316);
}
.mcd-eyebrow {
  font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
  background: linear-gradient(90deg,#0ea5e9,#8b5cf6);
  -webkit-background-clip: text; background-clip: text; color: transparent; margin-bottom: 4px;
}
.mcd-hero h2 { margin: 0 0 5px; font-size: 21px; font-weight: 750; letter-spacing: -.015em; color: var(--heading-color); }
.mcd-hero p { margin: 0; font-size: 12.5px; color: var(--text-muted); }
.mcd-hero-side { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

.mcd-pulse {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em;
  color: #fff; background: linear-gradient(135deg,#10b981,#059669);
  padding: 4px 11px; border-radius: 999px;
}
.mcd-pulse i { width: 7px; height: 7px; border-radius: 50%; background: #fff; animation: mcd-blink 1.8s ease-in-out infinite; }
@keyframes mcd-blink { 0%,100% { opacity: 1 } 50% { opacity: .35 } }

.mcd-health { font-size: 11.5px; font-weight: 650; padding: 4px 11px; border-radius: 999px; color: #fff; }
.mcd-h-good { background: linear-gradient(135deg,#10b981,#059669); }
.mcd-h-warning { background: linear-gradient(135deg,#f59e0b,#d97706); }
.mcd-h-critical { background: linear-gradient(135deg,#f43f5e,#e11d48); }
.mcd-h-off { background: linear-gradient(135deg,#94a3b8,#64748b); }

/* KPI row */
.mcd-kpis { display: grid; grid-template-columns: repeat(auto-fit,minmax(196px,1fr)); gap: 12px; margin-bottom: 20px; }
.mcd-kpi {
  display: flex; align-items: flex-start; gap: 11px; padding: 14px;
  border: 1px solid var(--tone-soft, var(--border-color));
  border-radius: var(--border-radius-md, 8px);
  background: var(--card-bg, var(--fg-color));
  box-shadow: 0 1px 2px rgba(0,0,0,.05);
}
.mcd-chip {
  display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; border-radius: 9px; flex: none; color: #fff;
  background: linear-gradient(135deg,var(--tone),var(--tone-2));
  box-shadow: 0 3px 9px -3px var(--tone);
}
.mcd-chip svg { width: 18px; height: 18px; }
.mcd-kpi-body { min-width: 0; }
.mcd-kpi-label { font-size: 10.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--text-muted); }
.mcd-kpi-value { font-size: 21px; font-weight: 750; line-height: 1.25; color: var(--heading-color); letter-spacing: -.02em; }
.mcd-kpi-value .mcd-of { font-size: 13px; font-weight: 600; color: var(--text-muted); }
.mcd-kpi-sub { font-size: 11.5px; color: var(--text-muted); }

/* panels */
.mcd-panel {
  padding: 16px; margin-bottom: 16px;
  border: 1px solid var(--border-color); border-radius: var(--border-radius-md, 8px);
  background: var(--card-bg, var(--fg-color));
  box-shadow: 0 1px 2px rgba(0,0,0,.05);
}
.mcd-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
.mcd-panel-head h3 { margin: 0; font-size: 13.5px; font-weight: 700; color: var(--heading-color); }
.mcd-panel-aside { font-size: 11.5px; color: var(--text-muted); }
.mcd-note { font-size: 11.5px; color: var(--text-muted); }
.mcd-link { border: none; background: none; padding: 0; font-size: 11.5px; font-weight: 650; color: var(--primary); cursor: pointer; }

.mcd-legend { display: flex; gap: 14px; font-size: 11.5px; color: var(--text-muted); }
.mcd-legend span { display: inline-flex; align-items: center; gap: 5px; }
.mcd-sw { width: 11px; height: 11px; border-radius: 3px; display: inline-block; background: var(--text-muted); }
.mcd-sw-solid { background: #64748b; }
.mcd-sw-soft { background: #64748b; opacity: .45; }
.mcd-sw-now { background: linear-gradient(180deg,#a855f7,#7c3aed); }

/* counter split */
.mcd-counters { display: flex; flex-direction: column; gap: 12px; }
.mcd-counter { display: grid; grid-template-columns: minmax(150px,1.1fr) minmax(90px,2fr) minmax(110px,auto); gap: 14px; align-items: center; }
.mcd-c-id { display: flex; align-items: center; gap: 9px; min-width: 0; }
.mcd-avatar {
  width: 30px; height: 30px; border-radius: 8px; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700; color: #fff; background: var(--tone);
}
.mcd-c-name { font-size: 12.5px; font-weight: 650; color: var(--heading-color); display: flex; align-items: center; gap: 6px; }
.mcd-c-meta { font-size: 11px; color: var(--text-muted); }
.mcd-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.mcd-dot.on { background: #10b981; box-shadow: 0 0 0 3px rgba(16,185,129,.18); }
.mcd-dot.off { background: var(--text-muted); opacity: .45; }

.mcd-c-bar-wrap { min-width: 0; }
/* the 2px gap between segments is a surface gap, not decoration: it keeps
   adjacent fills separable for CVD readers */
.mcd-c-track { display: flex; gap: 2px; height: 15px; min-width: 3px; }
.mcd-seg { display: block; height: 100%; min-width: 3px; background: var(--tone); }
.mcd-seg:first-child { border-radius: 4px 0 0 4px; }
.mcd-seg:last-child { border-radius: 0 4px 4px 0; }
.mcd-seg-solid:only-child, .mcd-seg-soft:only-child { border-radius: 4px; }
.mcd-seg-soft { opacity: .45; }

.mcd-c-values { text-align: right; }
.mcd-c-amount { font-size: 13px; font-weight: 700; color: var(--heading-color); }
.mcd-c-draft { font-size: 11px; color: var(--text-muted); }

/* hourly strip */
.mcd-hours { display: flex; align-items: flex-end; gap: 3px; height: 96px; }
.mcd-hbar { flex: 1 1 0; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: stretch; gap: 4px; }
.mcd-hbar span { display: block; background: linear-gradient(180deg,#3b82f6,#2563eb); border-radius: 4px 4px 0 0; min-height: 0; }
.mcd-hbar.now span { background: linear-gradient(180deg,#a855f7,#7c3aed); }
.mcd-hbar b { font-size: 9.5px; font-weight: 600; color: var(--text-muted); text-align: center; }

/* queue */
.mcd-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.mcd-table th { text-align: left; font-size: 10.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--text-muted); padding: 0 10px 8px; border-bottom: 1px solid var(--border-color); }
.mcd-table td { padding: 9px 10px; border-bottom: 1px solid var(--border-color); color: var(--text-color); }
.mcd-table tbody tr { cursor: pointer; }
.mcd-table tbody tr:hover td { background: var(--control-bg); }
.mcd-table tbody tr:last-child td { border-bottom: none; }
.mcd-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.mcd-table td:first-child { white-space: nowrap; }
/* long customer / service names must not stretch the table */
.mcd-table td:nth-child(2), .mcd-table td:nth-child(3) {
  max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mcd-ago { color: var(--text-muted); white-space: nowrap; }
.mcd-owner-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 7px; vertical-align: middle; }

@media (max-width: 700px) {
  .mcd-counter { grid-template-columns: 1fr; gap: 6px; }
  .mcd-c-values { text-align: left; }
  .mcd-hours { height: 72px; }
}
@media (prefers-reduced-motion: reduce) { .mcd-pulse i { animation: none } }
`;
