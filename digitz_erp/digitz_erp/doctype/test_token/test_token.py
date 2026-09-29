# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""A token for the token simulator to serve. See digitz_erp.api.token_simulator."""

import frappe
from frappe.model.document import Document
from frappe.utils import cint, getdate


class TestToken(Document):
	def validate(self):
		if not (self.token_number or "").strip():
			self.token_number = next_token_number(self.created_date)
		self.token_number = self.token_number.strip()

		if self.cashier and not frappe.db.get_value("User", self.cashier, "username"):
			frappe.throw(
				f"{self.cashier} has no username. The token service identifies a desk by username, "
				"so set one on the User first."
			)


def next_token_number(created_date):
	"""One more than the highest plain number among the day's test tokens.

	Real token numbers are text ('T-104' happens), so only the numeric ones take
	part in the count.
	"""
	day = getdate(created_date)
	numbers = frappe.get_all(
		"Test Token",
		filters={"created_date": ["between", [f"{day} 00:00:00", f"{day} 23:59:59.999999"]]},
		pluck="token_number",
	)
	return str(max([cint(n) for n in numbers if str(n).strip().isdigit()] or [0]) + 1)
