"""Put the Print or View Invoices card on the Medical Center Navigator of
existing sites, in Daily Operations just before Expense Entry. A fresh install
gets it from install_data/custom_html_block.json. The card is inserted into
the site's own block, so other changes made to it there are kept."""

import frappe

BLOCK = "Medical Center Navigator"
ROUTE = "[&quot;print-or-view-invoices&quot;]"
BEFORE = '<button type="button" class="mc-card" data-route="[&quot;List&quot;, &quot;Expense Entry&quot;]"'
SECTION_COUNT = ('<h3>Daily Operations</h3>\n<span class="mc-sec-count">4</span>',
	'<h3>Daily Operations</h3>\n<span class="mc-sec-count">5</span>')

CARD = (
	'<button type="button" class="mc-card" data-route="' + ROUTE + '" data-page="print-or-view-invoices" '
	'style="--tone:#2563eb;--tone-2:#1d4ed8;--tone-soft:rgba(37, 99, 235, 0.45)" aria-label="Print or View Invoices">\n'
	'<div class="mc-card-top">\n'
	'<span class="mc-chip"><svg class="mc-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" '
	'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V2h12v7"/>'
	'<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/></svg></span>\n'
	'<span class="mc-tag" style="--tag:#2563eb;--tag-2:#1d4ed8"><svg class="mc-ic mc-ic-xs" viewBox="0 0 24 24" fill="none" '
	'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
	'<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg><span>View</span></span>\n'
	'</div>\n'
	'<div class="mc-card-title">Print or View Invoices</div>\n'
	'<p class="mc-card-sum">Find any sales invoice by date, customer, mobile or number, see its printout and print the invoice or its receipt.</p>\n'
	'<span class="mc-open">Open<svg class="mc-ic mc-ic-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" '
	'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>\n'
	'</button>\n'
)


def add_card(html):
	"""`html` with the card inserted before Expense Entry, or unchanged when it is there already or Expense Entry is not."""
	if ROUTE in html or BEFORE not in html:
		return html
	return html.replace(BEFORE, CARD + BEFORE, 1).replace(*SECTION_COUNT)


def execute():
	if not frappe.db.exists("Custom HTML Block", BLOCK):
		return
	html = frappe.db.get_value("Custom HTML Block", BLOCK, "html") or ""
	new_html = add_card(html)
	if new_html != html:
		frappe.db.set_value("Custom HTML Block", BLOCK, "html", new_html)
