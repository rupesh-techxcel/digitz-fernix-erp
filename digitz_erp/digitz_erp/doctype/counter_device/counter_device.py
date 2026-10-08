# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import now_datetime


class CounterDevice(Document):
	"""A PC registered to a Counter. Its browser holds a secret whose SHA-256 hash is
	`secret_hash`; see digitz_erp.api.counter_api.

	A counter has one enabled device. Disabling one, by hand or because another
	device took over the counter, records who did it and when."""

	def validate(self):
		before = self.get_doc_before_save()
		was_enabled = bool(before and before.enabled)

		if self.enabled and not was_enabled:
			self.validate_can_enable()
			self.disabled_by = self.disabled_on = self.replaced_by = None
		elif was_enabled and not self.enabled and not self.disabled_on:
			self.disabled_by = frappe.session.user
			self.disabled_on = now_datetime()

	def validate_can_enable(self):
		if (self.approval_status or "Approved") != "Approved":
			frappe.throw(f"{self.name} is a registration request ({self.approval_status}). "
						 "A supervisor approves it from the counter badge.")

		other = frappe.db.get_value(
			"Counter Device",
			{"counter": self.counter, "enabled": 1, "name": ["!=", self.name or ""]},
			"name",
		)
		if other:
			frappe.throw(f"{self.counter} already has {other}. A counter has one device: disable {other} first.")
