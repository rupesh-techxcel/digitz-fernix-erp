# Copyright (c) 2022, Rupesh P and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

class ItemGroup(Document):
	def before_validate(self):

		if not self.description:
			self.description = self.item_group_name

		self.validate_item_group_code()

	def validate_item_group_code(self):

		if self.item_group_code:
			self.item_group_code = self.item_group_code.strip()

		if not frappe.db.get_single_value("Settings", "item_group_code_required"):
			return

		if not self.item_group_code:
			frappe.throw("Item Group Code is mandatory for the item group.")

		duplicate = frappe.db.get_value("Item Group",
			{"item_group_code": self.item_group_code, "name": ["!=", self.name]}, "name")
		if duplicate:
			frappe.throw(f"Item Group Code {self.item_group_code} is already used by item group {duplicate}.")

@frappe.whitelist()
def get_item_group_code_required():
	# Settings is readable only by System Manager, so the Item Group form reads the flag through here
	return frappe.db.get_single_value("Settings", "item_group_code_required")

