import frappe


# Customer Type options renamed: Company -> Corporate, PRO -> Typing Center.
RENAMES = {"Company": "Corporate", "PRO": "Typing Center"}


def execute():
	for old, new in RENAMES.items():
		frappe.db.sql("UPDATE `tabCustomer` SET customer_type = %s WHERE customer_type = %s", (new, old))
