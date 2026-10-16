# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""Fresh start for go-live: remove every counter transaction and start invoice
numbers at INV/450000.

Removes all Sales Invoices, Receipt Entries, Sales Returns, Expense Entries,
Counter Sessions (Day Open / Day Close) and Medical Service Logs (token logs),
with everything that belongs to them: their child rows, their GL Postings,
stock ledger entries, stock recalculation vouchers, bank reconciliation rows,
posting-status rows and attached files (the invoice and receipt PDFs). Masters
(customers, items, accounts, price lists), opening balances and every other
voucher are left alone. Then the site's Sales Invoice series becomes
INV/###### and the next invoice is INV/450000.

It is irreversible, so it never runs on its own (it is not in patches.txt, and
nothing here can be called from the browser) and deletes nothing unless told
the site's name:

    bench --site <site> backup --with-files
    bench --site <site> execute digitz_erp.api.fresh_start.preview
    bench --site <site> execute digitz_erp.api.fresh_start.run --kwargs "{'confirm': '<site>'}"

Deleted token logs are forgotten: if the token service ever sends one of those
tokens again, the sync raises a new invoice for it.
"""

import frappe
from frappe.custom.doctype.property_setter.property_setter import make_property_setter
from frappe.utils import flt

# The documents removed, all of them
DOCTYPES = (
	"Sales Invoice",
	"Receipt Entry",
	"Sales Return",
	"Expense Entry",
	"Counter Session",
	"Medical Service Logs",
)

# Of those, the ones that post to the GL and stock and are reconciled with the bank
VOUCHERS = ("Sales Invoice", "Receipt Entry", "Sales Return", "Expense Entry")

# The new Sales Invoice numbering: INV/450000, INV/450001, ...
SERIES_OPTION = "INV/.######"
SERIES_KEY = "INV/"
FIRST_NUMBER = 450000


def present(doctype):
	return bool(frappe.db.exists("DocType", doctype))


def child_doctypes(doctype):
	"""Its child tables, each once (a table can back two fields)."""
	if not present(doctype):
		return []
	return list(dict.fromkeys(df.options for df in frappe.get_meta(doctype).get_table_fields()))


def deletions():
	"""[(label, doctype, filters)], children before parents."""
	steps = []
	for doctype in filter(present, DOCTYPES):
		for child in child_doctypes(doctype):
			steps.append((f"{doctype} / {child} rows", child, {"parenttype": doctype}))
		steps.append((doctype, doctype, {}))

	vouchers = ("in", VOUCHERS)
	steps += [
		("GL Postings of these documents", "GL Posting", {"voucher_type": vouchers}),
		("Stock Ledger entries of these documents", "Stock Ledger", {"voucher": vouchers}),
		("Project Stock Ledger entries of these documents", "Project Stock Ledger", {"voucher": vouchers}),
		("Stock Repost Detail rows of these documents", "Stock Repost Detail", {"voucher": vouchers}),
	]
	recalc_children = child_doctypes("Stock Recalculate Voucher")
	recalc_names = (frappe.get_all("Stock Recalculate Voucher", filters={"voucher": vouchers}, pluck="name")
		if present("Stock Recalculate Voucher") else [])
	for child in recalc_children:
		steps.append((f"Stock Recalculate Voucher / {child} rows", child,
			{"parenttype": "Stock Recalculate Voucher", "parent": ("in", recalc_names or [""])}))
	steps += [
		("Stock Recalculate Vouchers of these documents", "Stock Recalculate Voucher", {"voucher": vouchers}),
		("Bank Reconciliation rows of these documents", "Bank Reconciliation", {"document_type": vouchers}),
		("Document Posting Status rows of these documents", "Document Posting Status",
			{"document_type": ("in", DOCTYPES)}),
	]
	return [s for s in steps if present(s[1]) and frappe.db.table_exists(s[1])]


def attached_files():
	return frappe.get_all("File", filters={"attached_to_doctype": ("in", DOCTYPES)}, pluck="name")


def leftover_references():
	"""Other records that still name one of the removed documents, to report: the
	script does not touch them."""
	removed = set(DOCTYPES)
	for doctype in DOCTYPES:
		removed.update(child_doctypes(doctype))
	removed.update({"GL Posting", "Stock Ledger", "Project Stock Ledger", "Stock Repost Detail",
		"Stock Recalculate Voucher", "Bank Reconciliation", "Document Posting Status", "File"})

	links = frappe.get_all("DocField", filters={"fieldtype": "Link", "options": ("in", DOCTYPES)},
		fields=["parent", "fieldname", "options"])
	links += frappe.get_all("Custom Field", filters={"fieldtype": "Link", "options": ("in", DOCTYPES)},
		fields=["dt as parent", "fieldname", "options"])

	found = []
	for link in links:
		if link.parent in removed or not frappe.db.table_exists(link.parent):
			continue
		if frappe.get_meta(link.parent).issingle:
			continue
		count = frappe.db.count(link.parent, {link.fieldname: ("is", "set")})
		if count:
			found.append((link.parent, link.fieldname, link.options, count))
	return found


def preview():
	"""What run() would remove on this site. Changes nothing."""
	frappe.only_for("System Manager")
	print(f"Fresh start preview for {frappe.local.site}: nothing is changed.\n")
	total = 0
	for label, doctype, filters in deletions():
		count = frappe.db.count(doctype, filters)
		total += count
		print(f"  {count:>8}  {label}")
	files = attached_files()
	print(f"  {len(files):>8}  Attached files (invoice and receipt PDFs, ...)")

	stock = frappe.db.count("Stock Ledger", {"voucher": ("in", VOUCHERS)}) if frappe.db.table_exists("Stock Ledger") else 0
	if stock:
		print(f"\n  Stock: {stock} stock ledger entries go, so every item's stock balance is rebuilt "
			"from the entries left (purchases, stock entries, ...).")

	leftovers = leftover_references()
	if leftovers:
		print("\n  Left in place, but still naming a removed document (check these):")
		for parent, fieldname, options, count in leftovers:
			print(f"  {count:>8}  {parent}.{fieldname} -> {options}")

	current = (frappe.db.sql("SELECT current FROM `tabSeries` WHERE name = %s", SERIES_KEY) or [[None]])[0][0]
	print(f"\n  Sales Invoice numbering: {SERIES_OPTION}, next invoice {SERIES_KEY}{FIRST_NUMBER}"
		+ (f" (the {SERIES_KEY} series is at {current} now)" if current is not None else ""))
	print(f"\n  {total} rows and {len(files)} files would be removed.")
	print(f"  To do it: bench --site {frappe.local.site} execute digitz_erp.api.fresh_start.run "
		f"--kwargs \"{{'confirm': '{frappe.local.site}'}}\"")


def run(confirm=None):
	"""Remove the counter transactions and switch the invoice numbering. Needs
	confirm=<this site's name>."""
	frappe.only_for("System Manager")
	if confirm != frappe.local.site:
		frappe.throw(f"This deletes every invoice and receipt on {frappe.local.site}. "
			f"Take a backup, then pass confirm='{frappe.local.site}' to go ahead.")

	stock_items = set()
	if frappe.db.table_exists("Stock Ledger"):
		stock_items = set(frappe.get_all("Stock Ledger", filters={"voucher": ("in", VOUCHERS)}, pluck="item"))

	removed = 0
	for label, doctype, filters in deletions():
		count = frappe.db.count(doctype, filters)
		if count:
			frappe.db.delete(doctype, filters)
			removed += count
			print(f"  removed {count:>8}  {label}")

	if stock_items:
		rebuild_stock_balances()
		print(f"  rebuilt the stock balances ({len(stock_items)} items had entries removed)")

	set_invoice_series()
	print(f"  Sales Invoice numbering is now {SERIES_OPTION}: the next invoice is {SERIES_KEY}{FIRST_NUMBER}")

	# Last, once the database part has gone through: files leave the disk too
	files = attached_files()
	for name in files:
		frappe.delete_doc("File", name, ignore_permissions=True, force=True, delete_permanently=True)
	print(f"  removed {len(files):>8}  attached files")

	frappe.db.commit()
	frappe.clear_cache()
	print(f"\nDone: {removed} rows and {len(files)} files removed from {frappe.local.site}.")


def set_invoice_series():
	"""This site's Sales Invoice series becomes INV/######, starting at 450000. A
	Property Setter, so only this site changes and app updates keep it."""
	for prop, value in (("options", SERIES_OPTION), ("default", SERIES_OPTION)):
		make_property_setter("Sales Invoice", "naming_series", prop, value, "Text", validate_fields_for_doctype=False)

	# The series counter holds the last number used
	frappe.db.sql(
		"""INSERT INTO `tabSeries` (name, current) VALUES (%(key)s, %(current)s)
		ON DUPLICATE KEY UPDATE current = %(current)s""",
		{"key": SERIES_KEY, "current": FIRST_NUMBER - 1},
	)


def rebuild_stock_balances():
	"""Stock Balance and each item's stock, from the stock ledger entries left.
	Direct updates: saving an Item would also rewrite its price lists."""
	frappe.db.delete("Stock Balance")
	rows = frappe.db.sql(
		"""SELECT item, warehouse, SUM(qty_in) - SUM(qty_out) AS qty, SUM(change_in_stock_value) AS value
		FROM `tabStock Ledger` GROUP BY item, warehouse""",
		as_dict=True,
	)
	for row in rows:
		item_name, unit = frappe.db.get_value("Item", row.item, ["item_name", "base_unit"]) or (None, None)
		qty, value = flt(row.qty), flt(row.value)
		balance = frappe.new_doc("Stock Balance")
		balance.update({
			"item": row.item, "item_name": item_name, "unit": unit, "warehouse": row.warehouse,
			"stock_qty": qty, "stock_value": value,
		})
		balance.insert(ignore_permissions=True)

	totals = {}
	for row in rows:
		t = totals.setdefault(row.item, [0, 0])
		t[0] += flt(row.qty)
		t[1] += flt(row.value)
	for item in frappe.get_all("Item", filters={"stock_balance": ("!=", 0)}, pluck="name"):
		totals.setdefault(item, [0, 0])
	for item, (qty, value) in totals.items():
		frappe.db.set_value("Item", item, {"stock_balance": qty, "stock_value": value}, update_modified=False)
