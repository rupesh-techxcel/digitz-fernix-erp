# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""Prepare existing Medical Service Logs for the server side token sync.

Before this change the browser created logs with no idempotency key and no link
to the invoice it raised. Three things have to be true before the cron job is
allowed to run, or it will happily re-invoice history:

1. Every log has a `token_key`, so a token already seen is recognised.
2. Every log that already produced an invoice is linked to it and marked
   Completed.
3. Every remaining legacy log is taken out of the retry queue, because the old
   code left rows Pending both for "not done yet" and for "deliberately
   skipped", and we can no longer tell those apart.
"""

import json

import frappe

from digitz_erp.api.token_sync import make_token_key


def execute():
	frappe.reload_doc("digitz_erp", "doctype", "medical_service_logs")
	frappe.reload_doc("digitz_erp", "doctype", "settings")
	frappe.reload_doc("selling", "doctype", "sales_invoice")

	logs = frappe.get_all(
		"Medical Service Logs",
		fields=["name", "api_response", "customer_name", "token_number", "service", "status", "added_on"],
		order_by="added_on asc, creation asc",
	)

	seen_keys = set()

	for log in logs:
		token_key = compute_key(log)

		# The old code could create two logs for the same token. Only the
		# earliest gets the key; the rest are parked so the unique index holds.
		if token_key in seen_keys:
			frappe.db.set_value(
				"Medical Service Logs",
				log.name,
				{
					"status": "Skipped",
					"error_message": "Duplicate of an earlier log for the same token.",
				},
				update_modified=False,
			)
			continue

		seen_keys.add(token_key)

		values = {"token_key": token_key}
		invoice = find_existing_invoice(log)

		if invoice:
			values["sales_invoice"] = invoice.name
			values["customer"] = invoice.customer
			values["status"] = "Completed"
		elif log.status != "Completed":
			# Cannot tell "pending" from "intentionally skipped" for legacy
			# rows, so keep them out of the retry pass rather than risk
			# inventing invoices for tokens that were settled another way.
			values["status"] = "Skipped"
			values["error_message"] = "Legacy log migrated before server side sync; not retried."

		frappe.db.set_value("Medical Service Logs", log.name, values, update_modified=False)

	frappe.db.commit()


def compute_key(log):
	"""Rebuild the idempotency key from the stored payload where possible."""
	try:
		payload = json.loads(log.api_response or "{}")
	except (ValueError, TypeError):
		payload = {}

	if isinstance(payload, dict) and payload:
		return make_token_key(payload)

	# No usable payload: fall back to the fields on the log itself so the row
	# still gets a stable, unique key.
	return make_token_key(
		{
			"ApplicationNumber": "",
			"Service": log.service,
			"TokenNumber": log.token_number,
			"CreatedDate": str(log.added_on or "")[:10],
			"Name": log.customer_name,
		}
	)


def find_existing_invoice(log):
	"""Match a legacy log to the invoice it most likely created."""
	if not log.customer_name or not log.token_number:
		return None

	customer = frappe.db.get_value("Customer", {"customer_name": log.customer_name}, "name")
	if not customer:
		return None

	return frappe.db.get_value(
		"Sales Invoice",
		{
			"customer": customer,
			"customer_token": log.token_number,
			"posting_date": str(log.added_on or "")[:10],
		},
		["name", "customer"],
		as_dict=True,
	)
