// Cashier Console
//
// One page for the cashier's whole day. The tabs along the top follow the shift
// from start to finish: Day Open, then the work (Sales Invoice Board, Sales
// Invoices, Receipts), then Day Close and Day History. The active tab lives in
// the route (/app/cashier-console/<tab>), so reloads, links and the browser's
// back button all land on the right tab.
//
// The header carries the shift: whether the day is open, on which counter, and
// the one next step (Open Day / Close Day). It reads the same state as the
// navbar counter badge (digitz:counter-state, from counter_device.js), so the
// two never disagree.
//
// Day Open / Day Close / Day History are the shared screens in
// public/js/day_ops.js, Sales Invoice Board is public/js/cashier_board.js,
// Sales Invoices is public/js/cashier_invoices.js and Receipts is
// public/js/cashier_receipts.js, all embedded here. Each tab's
// content plugs in through `render` / `on_show` / `on_route` / `on_reselect` /
// `on_hide` in CashierConsole.TABS.

frappe.provide("digitz_erp");

frappe.pages["cashier-console"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Cashier Console"),
		single_column: true,
	});
	wrapper.cashier_console = new digitz_erp.CashierConsole(page, wrapper);
};

frappe.pages["cashier-console"].on_page_show = function (wrapper) {
	wrapper.cashier_console && wrapper.cashier_console.show();
};

digitz_erp.CashierConsole = class CashierConsole {
	// Where a bare /app/cashier-console lands when the day is already open (or
	// this PC is not a counter). With a day still to open, it lands on Day Open.
	static DEFAULT_TAB = "invoices";

	// How long a bare route waits for the counter state before using DEFAULT_TAB
	static STATE_WAIT_MS = 1500;

	static ICONS = {
		"day-open": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v2M5.6 6.6 7 8M3 13h2M19 13h2M17 8l1.4-1.4"/><path d="M7.5 17a4.5 4.5 0 0 1 9 0"/><path d="M3 21h18"/></svg>`,
		board: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>`,
		invoices: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></svg>`,
		receipts: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="13" rx="2"/><circle cx="12" cy="12.5" r="2.6"/><path d="M6 10v5M18 10v5"/></svg>`,
		"day-close": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>`,
		"day-history": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>`,
		user: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/></svg>`,
		calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>`,
		clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
	};

	// Order here is the order on screen and sets the shortcuts (Alt+1 ...).
	// A divider is drawn wherever `group` changes. Shift tabs are compact.
	static TABS = [
		{
			key: "day-open",
			group: "start",
			compact: true,
			label: __("Day Open"),
			hint: __("Start shift"),
			render($pane) {
				return new digitz_erp.DayOpen(this.page, { parent: $pane, embedded: true });
			},
			on_show(view) {
				view.load();
			},
		},
		{
			key: "board",
			group: "work",
			label: __("Sales Invoice Board"),
			hint: __("Pending queue"),
			// Drafts raised from tokens (public/js/cashier_board.js); live only while shown
			render($pane) {
				return new digitz_erp.CashierBoard($pane, { on_count: (n) => this.set_count("board", n) });
			},
			on_show(view) {
				view.start();
			},
			on_hide(view) {
				view.stop();
			},
			on_reselect(view) {
				view.refresh();
			},
		},
		{
			key: "invoices",
			group: "work",
			label: __("Sales Invoices"),
			hint: __("Billing"),
			// The list and one inner tab per invoice (public/js/cashier_invoices.js)
			render($pane) {
				return new digitz_erp.CashierInvoices(this.page, $pane);
			},
			on_route(view, sub) {
				view.route(sub);
			},
			on_reselect(view) {
				view.refresh();
			},
		},
		{
			key: "receipts",
			group: "work",
			label: __("Receipts"),
			hint: __("Collections"),
			// The list and one inner tab per receipt (public/js/cashier_receipts.js)
			render($pane) {
				return new digitz_erp.CashierReceipts(this.page, $pane);
			},
			on_route(view, sub) {
				view.route(sub);
			},
			on_reselect(view) {
				view.refresh();
			},
		},
		{
			key: "day-close",
			group: "end",
			compact: true,
			label: __("Day Close"),
			hint: __("End shift"),
			render($pane) {
				return new digitz_erp.DayClose(this.page, { parent: $pane, embedded: true });
			},
			on_show(view) {
				view.load();
			},
		},
		{
			key: "day-history",
			group: "end",
			compact: true,
			label: __("Day History"),
			hint: __("Past days"),
			render($pane) {
				return new digitz_erp.DayHistory($pane);
			},
			on_show(view) {
				view.load();
			},
		},
	];

	constructor(page, wrapper) {
		this.page = page;
		this.$wrapper = $(wrapper);
		this.tabs = digitz_erp.CashierConsole.TABS;
		this.views = {};
		this.sub_routes = {};
		this.active = null;
		this.state_handler = (e, state) => this.render_shift(state);

		this.make();
		this.bind_events();
		this.setup_shortcuts();
	}

	make() {
		let group = null;
		const tabs = this.tabs
			.map((tab, i) => {
				const divider = group && tab.group !== group ? `<span class="cc-tab-divider" aria-hidden="true"></span>` : "";
				group = tab.group;
				return divider + this.tab_html(tab, i);
			})
			.join("");

		this.$root = $(`
			<div class="cashier-console">
				${this.header_html()}
				<nav class="cc-tabs" role="tablist" aria-label="${__("Cashier Console sections")}">${tabs}</nav>
				<div class="cc-panes">
					${this.tabs.map((tab) => this.pane_html(tab)).join("")}
				</div>
			</div>
		`).appendTo(this.page.main);

		this.$clock = this.$root.find(".cc-clock");
		this.$date = this.$root.find(".cc-date");
		this.$shift = this.$root.find(".cc-shift");
	}

	header_html() {
		const icons = digitz_erp.CashierConsole.ICONS;
		const esc = frappe.utils.escape_html;
		const user = frappe.user.full_name() || frappe.session.user;

		return `
			<header class="cc-header">
				<div class="cc-greeting">
					<div class="cc-eyebrow">${__("Cashier Zone")}</div>
					<h2 class="cc-title">${__("Welcome back, {0}", [esc(user.split(" ")[0])])}</h2>
					<div class="cc-meta">
						<div class="cc-meta-item">
							<span class="cc-meta-icon">${icons.user}</span>
							<span><span class="cc-meta-label">${__("Cashier")}</span>
							<span class="cc-meta-value">${esc(user)}</span></span>
						</div>
						<div class="cc-meta-item">
							<span class="cc-meta-icon">${icons.calendar}</span>
							<span><span class="cc-meta-label">${__("Date")}</span>
							<span class="cc-meta-value cc-date"></span></span>
						</div>
						<div class="cc-meta-item">
							<span class="cc-meta-icon">${icons.clock}</span>
							<span><span class="cc-meta-label">${__("Time")}</span>
							<span class="cc-meta-value cc-clock"></span></span>
						</div>
					</div>
				</div>
				<div class="cc-shift is-loading" aria-live="polite">
					<div class="cc-shift-label">${__("Shift")}</div>
					<div class="cc-shift-status">
						<span class="cc-shift-dot"></span>
						<span class="cc-shift-text">${__("Checking the counter...")}</span>
					</div>
					<div class="cc-shift-detail"></div>
					<button type="button" class="cc-shift-btn hide"></button>
				</div>
			</header>
		`;
	}

	tab_html(tab, index) {
		const compact = tab.compact ? " cc-tab-compact" : "";
		return `
			<button type="button" class="cc-tab${compact}" role="tab" data-tab="${tab.key}"
				id="cc-tab-${tab.key}" aria-controls="cc-pane-${tab.key}" aria-selected="false"
				title="${__("{0}: {1} (Alt+{2})", [tab.label, tab.hint, index + 1])}">
				<span class="cc-tab-icon">${digitz_erp.CashierConsole.ICONS[tab.key]}<span class="cc-tab-dot"></span></span>
				<span class="cc-tab-text">
					<span class="cc-tab-label">${tab.label}</span>
					<span class="cc-tab-hint">${tab.hint}</span>
				</span>
				<span class="cc-tab-count hide"></span>
				<kbd class="cc-tab-key">Alt ${index + 1}</kbd>
			</button>
		`;
	}

	pane_html(tab) {
		const attrs = `role="tabpanel" id="cc-pane-${tab.key}" aria-labelledby="cc-tab-${tab.key}" data-pane="${tab.key}" hidden`;

		// Tabs with a screen of their own render into an empty pane
		if (tab.render) {
			return `<section class="cc-pane cc-pane-flush" ${attrs}></section>`;
		}

		const links = (tab.links || [])
			.map(
				(link, i) => `
				<button type="button" class="btn btn-sm ${link.primary ? "btn-primary" : "btn-default"} cc-link"
					data-tab="${tab.key}" data-link="${i}">${link.label}</button>`
			)
			.join("");

		return `
			<section class="cc-pane" ${attrs}>
				<div class="cc-empty">
					<div class="cc-empty-icon">${digitz_erp.CashierConsole.ICONS[tab.key]}</div>
					<span class="cc-chip">${__("Coming in the next phase")}</span>
					<h3>${tab.label}</h3>
					<p>${tab.empty_text}</p>
					<div class="cc-empty-actions">${links}</div>
				</div>
			</section>
		`;
	}

	bind_events() {
		this.$root.on("click", ".cc-tab", (e) => {
			this.go_to($(e.currentTarget).attr("data-tab"));
		});

		// Arrow keys move between tabs, as in any standard tab strip.
		this.$root.on("keydown", ".cc-tab", (e) => {
			const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
			if (!step) {
				return;
			}
			const i = this.tabs.findIndex((t) => t.key === this.active);
			const next = this.tabs[(i + step + this.tabs.length) % this.tabs.length];
			this.go_to(next.key);
			this.$root.find(`.cc-tab[data-tab="${next.key}"]`).trigger("focus");
			e.preventDefault();
		});

		this.$root.on("click", ".cc-link", (e) => {
			const $btn = $(e.currentTarget);
			const tab = this.tabs.find((t) => t.key === $btn.attr("data-tab"));
			const link = tab.links[cint($btn.attr("data-link"))];
			link.new_doc ? frappe.new_doc(link.new_doc) : frappe.set_route(...link.route);
		});

		this.$shift.on("click", ".cc-shift-btn", (e) => {
			this.go_to($(e.currentTarget).attr("data-tab"));
		});

		// frappe.views.Container fires "hide" when the user leaves the page.
		this.$wrapper.on("hide", () => this.on_leave());
	}

	setup_shortcuts() {
		this.tabs.forEach((tab, i) => {
			frappe.ui.keys.add_shortcut({
				shortcut: `alt+${i + 1}`,
				action: () => this.go_to(tab.key),
				description: __("Cashier Console: {0}", [tab.label]),
				page: this.page,
				ignore_inputs: true,
			});
		});
	}

	// Fired on every visit and on every tab change, since a tab change is a
	// route change within this page.
	show() {
		if (!this.listening) {
			this.listening = true;
			$(document).on("digitz:counter-state", this.state_handler);
			digitz_erp.counter_state && this.render_shift(digitz_erp.counter_state);
			// Fresh state on every visit; the badge updates along with the header
			digitz_erp.refresh_counter_badge && digitz_erp.refresh_counter_badge();
			this.start_clock();
		}

		const key = frappe.get_route()[1];
		const tab = this.tabs.find((t) => t.key === key);
		if (tab) {
			this.activate(tab);
			// The rest of the route (an invoice), for tabs with views of their own
			const sub = frappe.get_route().slice(2);
			this.sub_routes[tab.key] = sub;
			tab.on_route && tab.on_route.call(this, this.views[tab.key], sub);
		} else {
			this.redirect_to_default();
		}
	}

	// Bare /app/cashier-console or an unknown tab: Day Open while the day still
	// has to be opened on this counter, else Sales Invoices. Replaces the route,
	// so the back button does not bounce off it.
	redirect_to_default() {
		let done = false;
		const go = (state) => {
			const route = frappe.get_route();
			if (done || route[0] !== "cashier-console" || this.tabs.some((t) => t.key === route[1])) {
				return;
			}
			done = true;
			$(document).off("digitz:counter-state.cc-default");
			frappe.route_flags.replace_route = true;
			frappe.set_route("cashier-console", this.default_tab(state));
		};

		if (digitz_erp.counter_state) {
			go(digitz_erp.counter_state);
			return;
		}
		$(document).one("digitz:counter-state.cc-default", (e, state) => go(state));
		setTimeout(() => go(null), digitz_erp.CashierConsole.STATE_WAIT_MS);
	}

	default_tab(state) {
		return state && state.counter && !state.session ? "day-open" : digitz_erp.CashierConsole.DEFAULT_TAB;
	}

	go_to(key) {
		if (key !== this.active) {
			// Back to where that tab was left (e.g. the invoice that was open)
			frappe.set_route("cashier-console", key, ...(this.sub_routes[key] || []));
			return;
		}
		// Clicking the open tab again refreshes it
		const tab = this.tabs.find((t) => t.key === key);
		const hook = tab && (tab.on_reselect || tab.on_show);
		tab && this.views[key] && hook && hook.call(this, this.views[key]);
	}

	activate(tab) {
		if (this.active === tab.key) {
			return;
		}

		const previous = this.tabs.find((t) => t.key === this.active);
		previous && previous.on_hide && previous.on_hide.call(this, this.views[previous.key]);

		this.active = tab.key;

		this.$root.find(".cc-tab").each((_, el) => {
			const on = el.dataset.tab === tab.key;
			el.classList.toggle("active", on);
			el.setAttribute("aria-selected", on ? "true" : "false");
			el.tabIndex = on ? 0 : -1;
			// On a narrow screen the tab bar scrolls; keep the active tab in view
			on && el.scrollIntoView && el.scrollIntoView({ block: "nearest", inline: "nearest" });
		});
		this.$root.find(".cc-pane").each((_, el) => {
			el.hidden = el.dataset.pane !== tab.key;
		});

		const $pane = this.$root.find(`.cc-pane[data-pane="${tab.key}"]`);
		if (tab.render && !this.views[tab.key]) {
			this.views[tab.key] = tab.render.call(this, $pane);
		}
		tab.on_show && tab.on_show.call(this, this.views[tab.key]);

		// The work tabs need the room: the header shrinks to a slim bar there
		const compact = tab.group === "work";
		this.$root.toggleClass("cc-compact", compact);
		// Hidden inside an open invoice (cashier_invoices.js); the Sales Invoices
		// tab sets it again when it shows an invoice
		this.$root.removeClass("cc-in-invoice");
		// The page's title bar repeats the console header; the work tabs hide it
		$(this.page.wrapper).find(".page-head").toggleClass("hide", compact);

		frappe.utils.set_title(`${tab.label} · ${__("Cashier Console")}`);
	}

	// A tab can show a live count (pending approvals, later pending invoices).
	set_count(key, count) {
		this.$root
			.find(`.cc-tab[data-tab="${key}"] .cc-tab-count`)
			.text(count > 99 ? "99+" : count)
			.toggleClass("hide", !count);
	}

	// ------------------------------------------------------------ shift card

	// The states of the navbar badge (badge_text in counter_device.js), with the
	// one next step as a button. Unlike the badge, the cashier's own day comes
	// first: it is open (and has to be closed) whichever PC they are on.
	shift_view(state) {
		const esc = frappe.utils.escape_html;
		const s = state.session;

		if (!state.counter && !s) {
			const req = state.registration_request;
			if (req && req.approval_status === "Pending") {
				return { tone: "orange", text: __("Approval pending"),
					detail: __("{0} · waiting for a supervisor to approve this PC", [esc(req.counter)]) };
			}
			if (req && req.approval_status === "Rejected") {
				return { tone: "red", text: __("Request rejected"),
					detail: __("{0} · ask a supervisor", [esc(req.counter)]) };
			}
			return { tone: "red", text: __("Device not registered"),
				detail: __("This PC is not a counter yet") };
		}
		if (s && s.status === "Closing") {
			return { tone: "orange", text: __("Close awaiting approval"),
				detail: esc(s.counter || state.counter), action: __("View Day Close"), tab: "day-close" };
		}
		if (s && s.counter !== state.counter) {
			// The day is the cashier's, so it shows on any PC they sign in to, but
			// billing for it happens only on a PC of its counter
			return { tone: "orange", text: __("Day open on another PC"),
				detail: __("{0} · bill on its PC. This PC is {1}", [esc(s.counter),
					esc(state.counter || __("not registered"))]),
				action: __("Close Day"), tab: "day-close" };
		}
		if (s) {
			const since = moment(s.opened_on).format("hh:mm A");
			return { tone: "green", text: __("Day open"),
				detail: __("{0} · since {1}", [esc(s.counter || state.counter), since]),
				action: __("Close Day"), tab: "day-close" };
		}
		if (state.counter_taken) {
			return { tone: "orange", text: __("Counter in use"),
				detail: __("{0} by {1}", [esc(state.counter), esc(state.counter_taken.cashier_name)]) };
		}
		return { tone: state.must_open_day ? "orange" : "blue", text: __("Day not opened"),
			detail: esc(state.counter), action: __("Open Day"), tab: "day-open", primary: true };
	}

	render_shift(state) {
		if (!state) {
			return;
		}
		const view = this.shift_view(state);

		this.$shift.removeClass("is-loading").attr("data-tone", view.tone);
		this.$shift.find(".cc-shift-text").text(view.text);
		this.$shift.find(".cc-shift-detail").html(view.detail || "");
		this.$shift
			.find(".cc-shift-btn")
			.text(view.action || "")
			.attr("data-tab", view.tab || "")
			.toggleClass("is-primary", !!view.primary)
			.toggleClass("hide", !view.action);

		// The Day Open tab's dot: green while the day is open, orange while it is due
		const due = state.counter && !state.session;
		this.$root
			.find('.cc-tab[data-tab="day-open"] .cc-tab-dot')
			.toggleClass("is-open", !!state.session)
			.toggleClass("is-due", !!due);

		this.set_count("day-close", state.is_supervisor ? state.pending_approvals : 0);
	}

	on_leave() {
		this.stop_clock();
		this.listening = false;
		$(document).off("digitz:counter-state", this.state_handler);
		const tab = this.tabs.find((t) => t.key === this.active);
		tab && tab.on_hide && tab.on_hide.call(this, this.views[tab.key]);
		// Re-run on_show for the same tab when the user comes back.
		this.active = null;
	}

	// ----------------------------------------------------------------- clock

	start_clock() {
		this.tick();
		if (!this.clock_timer) {
			this.clock_timer = setInterval(() => this.tick(), 15000);
		}
	}

	stop_clock() {
		clearInterval(this.clock_timer);
		this.clock_timer = null;
	}

	tick() {
		const now = moment(frappe.datetime.now_datetime());
		this.$date.text(now.format("ddd, D MMM YYYY"));
		this.$clock.text(now.format("hh:mm A"));
	}
};
