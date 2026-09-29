"""Move the seeded P.R.O names from Customer (Typing Center) to Employee (salesman).

The customer seed created one Customer per "P.R.O Name" in the client sheet and
linked each client to it through `pro_customer` (labelled Typing Center). Those
people are the centre's salesmen, not typing centres, so:

1. each Typing Center customer that clients point at gets a salesman Employee of
   the same name (reused if one exists);
2. those clients get it as their Salesman, unless they already have one, and
   their Typing Center link is cleared;
3. the Typing Center customer is deleted, or, when a transaction uses it, kept as
   an ordinary customer: KEEP_AS_CORPORATE ones as Corporate, others Individual.

A Typing Center customer that no client points at is not one of the seeded
salesmen (e.g. "Walking Customer", set to PRO by hand); it only becomes Individual.

Re-running does nothing once there are no Typing Center customers left.
"""

import frappe

# Salesmen who are also genuine customers, confirmed by the business.
KEEP_AS_CORPORATE = {"Gehad"}


def execute():
	for name, customer_name in frappe.get_all(
		"Customer", filters={"customer_type": "Typing Center"}, fields=["name", "customer_name"], as_list=True
	):
		clients = frappe.get_all("Customer", filters={"pro_customer": name}, fields=["name", "salesman"])

		if not clients:
			frappe.db.set_value("Customer", name, "customer_type", "Individual", update_modified=False)
			continue

		employee = get_or_create_salesman(customer_name or name)

		for client in clients:
			values = {"pro_customer": None}
			if not client.salesman:
				values.update({"salesman": employee, "salesman_name": customer_name or name})
			frappe.db.set_value("Customer", client.name, values, update_modified=False)

		retire_customer(name)


def get_or_create_salesman(employee_name):
	existing = frappe.db.get_value("Employee", {"employee_name": employee_name}, "name")
	if existing:
		return existing

	employee = frappe.get_doc({"doctype": "Employee", "employee_name": employee_name})
	employee.insert(ignore_permissions=True)
	return employee.name


def retire_customer(name):
	if name not in KEEP_AS_CORPORATE:
		try:
			frappe.delete_doc("Customer", name, ignore_permissions=True)
			return
		except frappe.LinkExistsError:
			# Used by a transaction: it stays, as an ordinary customer
			frappe.clear_last_message()

	customer_type = "Corporate" if name in KEEP_AS_CORPORATE else "Individual"
	frappe.db.set_value("Customer", name, "customer_type", customer_type, update_modified=False)
