# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""Load the previous system's invoices bundled with the app into Historical Invoice.

See digitz_erp.seeds.historical_invoice_seed. The bundled reports are Al Taj's,
so only a site whose Company is Al Taj is touched: the app also runs for other
centres (dev is Rapid Way) that must not get these invoices.
"""

import frappe

from digitz_erp.seeds import historical_invoice_seed


def execute():
	if not frappe.get_all("Company", filters={"name": ["like", "Al Taj%"]}, limit=1):
		return

	historical_invoice_seed.run()
