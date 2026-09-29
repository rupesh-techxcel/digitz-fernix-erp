# Copyright (c) 2025, Techxcel Technologies and contributors
# For license information, please see license.txt

import frappe


def execute(filters=None):
	columns, data = get_columns(), get_data(filters)
	return columns, data


AMOUNTS = ("cash_amount", "card_amount", "credit_amount", "returns_amount", "tax_amount", "total_amount")


def get_columns():
	currency = lambda fieldname, label: {"fieldname": fieldname, "label": label, "fieldtype": "Currency", "width": 130}
	return [
		{"fieldname": "counter", "label": "Counter", "fieldtype": "Data", "width": 170},
		{"fieldname": "user", "label": "User", "fieldtype": "Data", "width": 200},
		{"fieldname": "invoice_count", "label": "Invoices", "fieldtype": "Int", "width": 90},
		currency("cash_amount", "Cash"),
		currency("card_amount", "Card / Bank"),
		currency("credit_amount", "Credit"),
		currency("returns_amount", "Returns"),
		currency("tax_amount", "Tax"),
		currency("total_amount", "Total"),
	]


def get_data(filters):
	"""Submitted sales per counter, and per user within each counter.

	The counter is the registered PC the invoice was saved or submitted on
	(Sales Invoice.counter); invoices from before counters existed show as
	"Not recorded". Amounts are the rounded totals actually charged, split by how
	they were settled: Cash (payment mode whose Mode is Cash), Card / Bank (any
	other mode) and Credit (credit sales). Rows form a tree: each counter with its
	totals, then the users who worked it, and a grand total at the end.

	Submitted Sales Returns are taken off the same way, on the day of the return:
	Cash, Card / Bank, Credit, Tax and Total are net of them, and Returns shows how
	much was returned. A return has no counter field of its own; its counter is
	that of the Counter Session it was saved in.

	A From/To range wins when both dates are given; otherwise the Today date is used.
	"""
	filters = filters or {}

	def where(doc, counter):
		conditions = [f"{doc}.docstatus = 1"]
		if filters.get("from_date") and filters.get("to_date"):
			conditions.append(f"{doc}.posting_date BETWEEN %(from_date)s AND %(to_date)s")
		elif filters.get("current_date"):
			conditions.append(f"{doc}.posting_date = %(current_date)s")
		if filters.get("counter"):
			conditions.append(f"{counter} = %(counter)s")
		if filters.get("user"):
			conditions.append(f"{doc}.owner = %(user)s")
		return " AND ".join(conditions)

	# One row per document: +1 for an invoice, -1 for a return
	documents = f"""
		SELECT si.owner, si.counter, si.credit_sale, si.payment_mode, si.rounded_total, si.tax_total, 1 AS sign
		FROM `tabSales Invoice` si
		WHERE {where("si", "si.counter")}
		UNION ALL
		SELECT sr.owner, cs.counter, sr.credit_sale, sr.payment_mode, sr.rounded_total, sr.tax_total, -1
		FROM `tabSales Return` sr
		LEFT JOIN `tabCounter Session` cs ON cs.name = sr.counter_session
		WHERE {where("sr", "cs.counter")}
	"""

	rows = frappe.db.sql(
		f"""
		SELECT
			IFNULL(NULLIF(doc.counter, ''), 'Not recorded') AS counter,
			doc.owner AS user,
			SUM(doc.sign = 1) AS invoice_count,
			SUM(CASE WHEN doc.credit_sale = 0 AND pm.mode = 'Cash' THEN doc.sign * doc.rounded_total ELSE 0 END) AS cash_amount,
			SUM(CASE WHEN doc.credit_sale = 0 AND IFNULL(pm.mode, '') != 'Cash' THEN doc.sign * doc.rounded_total ELSE 0 END) AS card_amount,
			SUM(CASE WHEN doc.credit_sale = 1 THEN doc.sign * doc.rounded_total ELSE 0 END) AS credit_amount,
			SUM(CASE WHEN doc.sign = -1 THEN doc.rounded_total ELSE 0 END) AS returns_amount,
			SUM(doc.sign * doc.tax_total) AS tax_amount,
			SUM(doc.sign * doc.rounded_total) AS total_amount
		FROM ({documents}) doc
		LEFT JOIN `tabPayment Mode` pm ON pm.name = doc.payment_mode
		GROUP BY counter, doc.owner
		""",
		filters,
		as_dict=True,
	)

	counters = {}
	for row in rows:
		counters.setdefault(row.counter, []).append(row)

	def totals(group):
		out = {"invoice_count": sum(r.invoice_count for r in group)}
		out.update({f: sum(r[f] or 0 for r in group) for f in AMOUNTS})
		return out

	full_names = dict(frappe.get_all("User", filters={"name": ["in", [r.user for r in rows] or [""]]},
		fields=["name", "full_name"], as_list=True))

	data = []
	for counter, users in sorted(counters.items(), key=lambda c: -sum(u.total_amount or 0 for u in c[1])):
		data.append({"name": counter, "indent": 0, "counter": counter, "user": "", **totals(users)})
		for user in sorted(users, key=lambda u: -(u.total_amount or 0)):
			data.append({
				"name": f"{counter}::{user.user}",
				"parent": counter,
				"indent": 1,
				"counter": counter,
				"user": full_names.get(user.user) or user.user,
				"invoice_count": user.invoice_count,
				**{f: user[f] or 0 for f in AMOUNTS},
			})

	if rows:
		data.append({"name": "__total__", "indent": 0, "counter": "Total", "user": "", "is_total": 1, **totals(rows)})

	return data
