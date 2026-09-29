// Help Center
//
// Guides from digitz_erp/help (see digitz_erp.api.help_api): a topic list with
// search on the left, the guide on the right. /app/digitz-help/<topic> opens a
// topic directly, which is how the Help buttons on other pages link here.
// Links between guides arrive as /app/digitz-help/<topic> routes (help_api).
// The list shows only the groups at first; a group opens on click, when it holds
// the guide being read, or when a search matches something in it.

frappe.pages["digitz-help"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __("Help Center"), single_column: true });
	wrapper.help_center = new HelpCenter(page);
};

frappe.pages["digitz-help"].on_page_show = function (wrapper) {
	wrapper.help_center && wrapper.help_center.show(frappe.get_route()[1]);
};

class HelpCenter {
	constructor(page) {
		this.page = page;
		this.inject_styles();
		this.$root = $(`
			<div class="dzh">
				<aside class="dzh-side">
					<input type="search" class="form-control dzh-search" placeholder="${__("Search help...")}">
					<nav class="dzh-nav"></nav>
				</aside>
				<article class="dzh-body"><div class="text-muted">${__("Loading...")}</div></article>
			</div>`).appendTo(page.main);
		this.$nav = this.$root.find(".dzh-nav");
		this.$body = this.$root.find(".dzh-body");

		this.open_groups = new Set();
		this.query = "";

		this.$root.find(".dzh-search").on("input", (e) => {
			this.query = e.target.value;
			this.render_nav();
		});
		this.$root.on("click", ".dzh-content img.screenshot", (e) => window.open(e.currentTarget.src, "_blank"));
		this.$root.on("click", "[data-group]", (e) => {
			const group = $(e.currentTarget).attr("data-group");
			this.open_groups.has(group) ? this.open_groups.delete(group) : this.open_groups.add(group);
			this.render_nav();
		});
		this.$root.on("click", "[data-topic]", (e) => {
			e.preventDefault();
			frappe.set_route("digitz-help", $(e.currentTarget).attr("data-topic"));
		});
	}

	async show(topic) {
		if (!this.index) {
			const r = await frappe.call({ method: "digitz_erp.api.help_api.get_help_index" });
			this.index = r.message || [];
			this.render_nav();
		}
		if (topic && this.topic_names().includes(topic)) {
			if (topic !== this.current) {
				this.load_topic(topic);
			}
		} else {
			this.current = null;
			this.render_nav();
			this.page.set_title(__("Help Center"));
			this.$body.html(`<p class="text-muted">${__("Pick a section on the left to see its guides.")}</p>`);
		}
	}

	topic_names() {
		return (this.index || []).flatMap((g) => g.topics.map((t) => t.name));
	}

	render_nav() {
		const words = this.query.toLowerCase().split(/\s+/).filter(Boolean);
		const matches = (t) => {
			const haystack = `${t.title} ${t.summary} ${t.keywords} ${t.text}`.toLowerCase();
			return words.every((w) => haystack.includes(w));
		};

		const html = this.index
			.map((group) => {
				const topics = group.topics.filter(matches);
				if (!topics.length) {
					return "";
				}
				const open = words.length || this.open_groups.has(group.group);
				return `
					<button type="button" class="dzh-group ${open ? "open" : ""}" data-group="${frappe.utils.escape_html(group.group)}">
						<span>${frappe.utils.escape_html(group.group)}</span><small>${topics.length}</small>
					</button>
					${!open ? "" : topics.map((t) => `
						<a href="/app/digitz-help/${encodeURIComponent(t.name)}" data-topic="${frappe.utils.escape_html(t.name)}"
							class="dzh-link ${t.name === this.current ? "active" : ""}">
							<span>${frappe.utils.escape_html(t.title)}</span>
							<small>${frappe.utils.escape_html(t.summary)}</small>
						</a>`).join("")}`;
			})
			.join("");

		this.$nav.html(html || `<p class="text-muted small">${__("Nothing matches your search.")}</p>`);
	}

	async load_topic(name) {
		this.current = name;
		const group = this.index.find((g) => g.topics.some((t) => t.name === name));
		group && this.open_groups.add(group.group);
		this.render_nav();

		const r = await frappe.call({ method: "digitz_erp.api.help_api.get_help_topic", args: { name } });
		const t = r.message;
		if (!t || this.current !== name) {
			return;
		}

		const pager = (item, label, cls) =>
			item
				? `<a href="/app/digitz-help/${encodeURIComponent(item.name)}" data-topic="${frappe.utils.escape_html(item.name)}" class="dzh-pager ${cls}">
					<small>${label}</small><span>${frappe.utils.escape_html(item.title)}</span></a>`
				: "<span></span>";

		this.$body.html(`
			<div class="dzh-content">${t.html}</div>
			<div class="dzh-pagers">${pager(t.previous, __("Previous"), "")}${pager(t.next, __("Next"), "next")}</div>`);
		this.page.set_title(t.title);
		window.scrollTo(0, 0);
	}

	inject_styles() {
		if (document.getElementById("dzh-styles")) {
			return;
		}
		const style = document.createElement("style");
		style.id = "dzh-styles";
		style.textContent = `
.dzh { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 20px; align-items: start; }
@media (max-width: 860px) { .dzh { grid-template-columns: 1fr; } }
.dzh-side { position: sticky; top: 70px; }
.dzh-search { margin-bottom: 12px; }
.dzh-group { display: flex; align-items: center; gap: 8px; width: 100%; padding: 9px 10px; margin-top: 4px; border: 0; border-radius: var(--border-radius, 6px); background: none; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--heading-color); }
.dzh-group:hover { background: var(--control-bg); }
.dzh-group::before { content: "›"; width: 10px; font-size: 16px; line-height: 1; color: var(--text-muted); transition: transform .15s; }
.dzh-group.open::before { transform: rotate(90deg); }
.dzh-group small { margin-left: auto; font-size: 11px; font-weight: 600; color: var(--text-muted); }
.dzh-nav .dzh-link { margin-left: 18px; }
.dzh-link { display: block; padding: 7px 10px; border-radius: var(--border-radius, 6px); color: var(--text-color); text-decoration: none; }
.dzh-link:hover { background: var(--control-bg); text-decoration: none; }
.dzh-link.active { background: var(--control-bg); box-shadow: inset 3px 0 0 var(--primary); }
.dzh-link span { display: block; font-size: 13px; font-weight: 600; }
.dzh-link small { display: block; font-size: 11.5px; color: var(--text-muted); line-height: 1.35; }
.dzh-body { min-width: 0; padding: 22px 28px; border: 1px solid var(--border-color); border-radius: var(--border-radius-lg, 10px); background: var(--card-bg, var(--fg-color)); }
.dzh-content { max-width: 780px; font-size: 14px; line-height: 1.6; color: var(--text-color); }
.dzh-content h1 { font-size: 22px; font-weight: 700; margin: 0 0 14px; color: var(--heading-color); }
.dzh-content h2 { font-size: 16px; font-weight: 700; margin: 26px 0 10px; padding-top: 14px; border-top: 1px solid var(--border-color); color: var(--heading-color); }
.dzh-section { border-top: 1px solid var(--border-color); }
.dzh-section:last-child { border-bottom: 1px solid var(--border-color); }
.dzh-section > summary { padding: 10px 4px 10px 28px; cursor: pointer; list-style: none; position: relative; }
.dzh-section > summary::-webkit-details-marker { display: none; }
.dzh-section > summary::before { content: "›"; position: absolute; left: 8px; top: 8px; font-size: 18px; line-height: 1.2; color: var(--text-muted); transition: transform .15s; }
.dzh-section[open] > summary::before { transform: rotate(90deg); }
.dzh-section > summary:hover { background: var(--control-bg); }
.dzh-title { display: block; font-size: 15px; font-weight: 700; color: var(--heading-color); }
.dzh-gist { display: block; margin-top: 2px; color: var(--text-muted); font-size: 13.5px; }
.dzh-section[open] { padding-bottom: 10px; }
.dzh-section > :not(summary) { margin-left: 28px; }
.dzh-content h3 { font-size: 14px; font-weight: 700; margin: 18px 0 8px; }
.dzh-content table { width: auto; max-width: 100%; margin: 10px 0 16px; font-size: 13px; }
.dzh-content th { background: var(--control-bg); font-weight: 600; }
.dzh-content th, .dzh-content td { padding: 6px 10px !important; vertical-align: top; }
.dzh-content pre { background: var(--control-bg); padding: 12px 14px; border-radius: var(--border-radius, 6px); font-size: 12.5px; }
.dzh-content blockquote { margin: 12px 0; padding: 8px 14px; border-left: 3px solid var(--primary); background: var(--control-bg); color: var(--text-color); }
.dzh-content blockquote p { margin: 0; }
.dzh-content li { margin-bottom: 4px; }
.dzh-content img.screenshot { display: block; max-width: 100%; margin: 10px 0 16px; border: 1px solid var(--border-color); border-radius: var(--border-radius, 6px); box-shadow: 0 1px 4px rgba(0,0,0,.08); cursor: zoom-in; }
.dzh-pagers { display: flex; justify-content: space-between; gap: 12px; margin-top: 28px; padding-top: 16px; border-top: 1px solid var(--border-color); }
.dzh-pager { display: block; padding: 8px 12px; border: 1px solid var(--border-color); border-radius: var(--border-radius, 6px); text-decoration: none; color: var(--text-color); }
.dzh-pager:hover { background: var(--control-bg); text-decoration: none; }
.dzh-pager.next { text-align: right; }
.dzh-pager small { display: block; font-size: 11px; color: var(--text-muted); }
.dzh-pager span { font-weight: 600; }
`;
		document.head.appendChild(style);
	}
}
