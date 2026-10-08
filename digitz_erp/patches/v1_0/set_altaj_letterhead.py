# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""Put the Al Taj corporate letterhead on the invoice and receipt PDFs.

Attaches the bundled header and footer images as public Files (the letterhead
seed) and sets them on the Company, which generate_custom_invoice_pdf stamps on
every invoice and receipt. The invoice header also carries the TAX INVOICE
title and the TRN; the receipt keeps the plain header.

Only a site whose Company is Al Taj is touched: the app also runs for other
centres (dev is Rapid Way) whose letterhead must stay as it is.
"""

import frappe

from digitz_erp.seeds import company_letterhead_seed

HEADER = "/files/altaj-letterhead-header.png"
INVOICE_HEADER = "/files/altaj-letterhead-invoice-header.png"
FOOTER = "/files/altaj-letterhead-footer.png"


def execute():
	companies = frappe.get_all("Company", filters={"name": ["like", "Al Taj%"]}, pluck="name")
	if not companies:
		return

	company_letterhead_seed.run()

	for company in companies:
		frappe.db.set_value("Company", company, {
			"header_image": HEADER,
			"invoice_header_image": INVOICE_HEADER,
			"footer_image": FOOTER,
		})
