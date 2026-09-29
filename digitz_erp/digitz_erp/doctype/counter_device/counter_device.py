# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class CounterDevice(Document):
	"""A PC registered to a Counter. Its browser holds a secret whose SHA-256 hash is
	`secret_hash`; see digitz_erp.api.counter_api."""
	pass
