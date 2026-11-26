# Copyright (c) 2023, Rupesh P and Contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt, nowtime, today


class TestSalesInvoice(FrappeTestCase):
	"""A cash, card or bank sale is paid by its own Receipt Entry
	(SalesInvoice.create_invoice_receipt). The site has no invoice fixtures, so
	each test copies a submitted cash invoice already on it, and skips without one."""

	def new_cash_invoice(self):
		source = frappe.get_all("Sales Invoice", pluck="name", order_by="creation desc", limit=1, filters={
			"docstatus": 1, "credit_sale": 0, "for_advance_payment": 0, "for_retention_recovery": 0})
		if not source:
			self.skipTest("No submitted cash invoice to copy")
		source = frappe.get_doc("Sales Invoice", source[0])
		invoice = frappe.copy_doc(source)
		# Not the source's counter day, which may be closed or cancelled by now
		invoice.update({"posting_date": today(), "posting_time": nowtime(), "allocated_receipt_entry": None,
			"counter_session": None, "received_amount": source.rounded_total})
		invoice.insert()
		invoice.submit()
		invoice.reload()
		return invoice

	def receipts(self, invoice):
		return frappe.get_all("Receipt Entry", filters={"sales_invoice": invoice.name}, fields=["name", "docstatus", "amount"])

	def test_submit_creates_receipt_that_takes_the_payment_postings(self):
		invoice = self.new_cash_invoice()
		[receipt] = self.receipts(invoice)

		self.assertEqual(receipt.docstatus, 1)
		self.assertEqual(flt(receipt.amount), flt(invoice.rounded_total))
		self.assertEqual(invoice.allocated_receipt_entry, receipt.name)
		self.assertEqual(invoice.payment_status, invoice.payment_mode if invoice.payment_mode != "Bank" else "Cheque")
		# Receivable is debited by the invoice and credited by the receipt
		self.assertFalse(frappe.db.exists("GL Posting", {"voucher_type": "Sales Invoice", "voucher_no": invoice.name,
			"credit_amount": invoice.rounded_total, "party_type": "Customer"}))
		self.assertTrue(frappe.db.exists("GL Posting", {"voucher_type": "Receipt Entry", "voucher_no": receipt.name,
			"credit_amount": invoice.rounded_total, "party": invoice.customer}))

	def test_receipt_cannot_be_cancelled_on_its_own(self):
		invoice = self.new_cash_invoice()
		receipt = frappe.get_doc("Receipt Entry", invoice.allocated_receipt_entry)
		self.assertRaises(frappe.ValidationError, receipt.cancel)

	def test_cancelling_invoice_cancels_its_receipt(self):
		invoice = self.new_cash_invoice()
		invoice.cancel()

		self.assertEqual([r.docstatus for r in self.receipts(invoice)], [2])
		self.assertFalse(frappe.db.exists("GL Posting", {"voucher_type": "Receipt Entry",
			"voucher_no": invoice.allocated_receipt_entry}))

	def test_correction_replaces_the_receipt(self):
		from digitz_erp.api.sales_invoice_api import correct_sales_invoice

		invoice = self.new_cash_invoice()
		first = invoice.allocated_receipt_entry
		correct_sales_invoice(invoice.name, reason="test")
		self.assertEqual(frappe.db.get_value("Receipt Entry", first, "docstatus"), 2)

		invoice = frappe.get_doc("Sales Invoice", invoice.name)
		invoice.submit()
		invoice.reload()
		self.assertNotEqual(invoice.allocated_receipt_entry, first)
		self.assertEqual(frappe.db.get_value("Receipt Entry", invoice.allocated_receipt_entry, "docstatus"), 1)
