# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class ArchivedSalesInvoice(Document):
	"""A draft Sales Invoice removed by the daily archive: see digitz_erp.api.draft_archive."""
