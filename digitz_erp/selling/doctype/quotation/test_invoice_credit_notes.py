import unittest
from datetime import date
from unittest.mock import patch

import frappe

from digitz_erp.selling.doctype.quotation import quotation


class TestInvoiceCreditNotes(unittest.TestCase):
	def setUp(self):
		# Frappe rounding normally reads the connected site's System Settings.
		settings = patch.object(frappe, "get_system_settings", return_value="Banker's Rounding")
		settings.start()
		self.addCleanup(settings.stop)

	def credit_notes(self, returns, lines, paid=385):
		doc = frappe._dict(name="SI-1", paid_amount=paid)
		with patch.object(quotation, "frappe") as framework:
			framework._dict = frappe._dict
			framework.db.sql.side_effect = [returns, *[[frappe._dict(l)] for l in lines]]
			with patch("frappe.utils.formatdate", side_effect=lambda d, fmt: str(d)):
				return quotation.get_sales_invoice_credit_notes(doc)

	def test_no_credit_notes(self):
		self.assertIsNone(self.credit_notes([], []))

	def test_rows_totals_and_paid_after(self):
		returns = [
			frappe._dict(name="SR-1", posting_date=date(2026, 11, 20), rounded_total=100, credit_sale=0, payment_mode="Cash"),
			frappe._dict(name="SR-2", posting_date=date(2026, 11, 21), rounded_total=50, credit_sale=1, payment_mode="Cash"),
		]
		cn = self.credit_notes(returns, [dict(total=95, this_invoice=95), dict(total=48, this_invoice=48)])
		self.assertEqual([(r.number, r.amount, r.refund_mode) for r in cn.rows],
			[("SR-1", 100, "Cash"), ("SR-2", 50, "Credit")])
		self.assertEqual((cn.total_refunded, cn.original_paid, cn.net_paid), (150, 385, 235))

	def test_return_of_several_invoices_shows_this_invoices_part(self):
		returns = [frappe._dict(name="SR-1", posting_date=date(2026, 11, 20), rounded_total=300, credit_sale=0, payment_mode="Card")]
		cn = self.credit_notes(returns, [dict(total=300, this_invoice=100)])
		self.assertEqual(cn.rows[0].amount, 100)
		self.assertEqual(cn.net_paid, 285)
