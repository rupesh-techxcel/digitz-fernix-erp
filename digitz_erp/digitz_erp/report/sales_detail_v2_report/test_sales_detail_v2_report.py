import unittest
from unittest.mock import Mock, patch

import frappe

from . import sales_detail_v2_report as report


class TestSalesDetailV2Report(unittest.TestCase):
    def setUp(self):
        # Frappe rounding normally reads the connected site's System Settings.
        settings = patch.object(frappe, "get_system_settings", return_value="Banker's Rounding")
        settings.start()
        self.addCleanup(settings.stop)

    def test_extended_charges_and_reconciliation(self):
        source = dict(invoice_number="SI-1", quantity=2, service_charge=50,
                      typing_charges=10, transaction_charges=5, govt_fee=100,
                      discount_amount=10, total_vat=6, line_total_with_vat=326,
                      invoice_total=321, round_off=0, additional_discount=5,
                      credit_sale=1, paid_amount=321, salesman="E-0020", salesman_name="Siddique")
        row = report.make_row(source, True)
        self.assertEqual(row["salesman"], "Siddique")
        self.assertNotIn("salesman_name", row)
        self.assertEqual(row["total_service_charge"], 100)
        self.assertEqual(row["total_govt_fee"], 200)
        self.assertEqual(row["typing_charges"], 20)
        self.assertEqual(row["transaction_charges"], 10)
        self.assertEqual(row["line_total"], 320)
        self.assertEqual(row["net_service_charge"], 120)
        self.assertEqual(row["line_total_with_vat"] - row["additional_discount"] + row["round_off"], 321)
        self.assertEqual(row["payment_status"], "Paid")
        for field in ("govt_bank", "bank_service_charge", "bank_service_charge_vat", "other_charge",
                      "mb_st_dw_id", "application_id", "ref_name", "employee_commission",
                      "customer_commission", "reward_amount"):
            self.assertNotIn(field, row)
        second = report.make_row(source, False)
        self.assertIsNone(second["additional_discount"])
        self.assertIsNone(second["round_off"])

    def test_payment_status_uses_balance_and_currency_precision(self):
        for credit, paid, expected in [(1, 0, "Credit"), (1, 20, "Partially Paid"),
                                       (1, 99.999999, "Paid"), (1, 105, "Paid"),
                                       (0, 0, "Paid")]:
            with self.subTest(credit=credit, paid=paid):
                self.assertEqual(report.payment_status(dict(credit_sale=credit, paid_amount=paid,
                                                             invoice_total=100)), expected)

    def test_summary_counts_invoice_once(self):
        data = [dict(invoice_number="SI-1", invoice_total=100, total_vat=2),
                dict(invoice_number="SI-1", invoice_total=100, total_vat=3)]
        with patch.object(report, "get_data", return_value=data), patch.object(report, "_", side_effect=lambda x: x):
            columns, _, _, _, summary = report.execute({"from_date": "2026-11-01", "to_date": "2026-11-05"})
        self.assertEqual(len(columns), 30)
        self.assertEqual([s["value"] for s in summary], [1, 100, 5])

    def test_cashier_cannot_override_owner(self):
        with patch.object(frappe, "get_roles", return_value=["Cashier"]), \
                patch.object(frappe, "session", frappe._dict(user="cashier@example.com")), \
                patch.object(frappe, "get_list", return_value=[]) as get_list, \
                patch.object(frappe, "db", new=Mock()) as db:
            db.get_table_columns.return_value = []
            self.assertEqual(report.get_data(dict(from_date="2026-11-01", to_date="2026-11-05",
                                                  user="someone@example.com")), [])
        self.assertEqual(get_list.call_args.kwargs["filters"]["owner"], "cashier@example.com")
        self.assertEqual(get_list.call_args.kwargs["filters"]["docstatus"], 1)
        db.sql.assert_not_called()

    def test_invalid_dates_do_not_query(self):
        with patch.object(report, "_", side_effect=lambda x: x), \
                patch.object(frappe, "throw", side_effect=ValueError), \
                patch.object(report, "get_data") as get_data:
            with self.assertRaises(ValueError):
                report.execute({"from_date": "2026-11-05", "to_date": "2026-11-01"})
        get_data.assert_not_called()

    def test_combined_filters_and_zero_bounds(self):
        with patch.object(frappe, "get_roles", return_value=["System Manager"]), \
                patch.object(frappe, "get_list", return_value=["SI-1"]) as get_list, \
                patch.object(frappe, "db", new=Mock()) as db:
            db.get_table_columns.return_value = ["customer_mobile_number", "service_charge"]
            db.sql.return_value = []
            report.get_data(dict(from_date="2026-11-01", to_date="2026-11-05",
                                 invoice_number="SI-1", mobile="50%_", show_trn_in_printout="No",
                                 min_quantity=0, max_invoice_total=0, min_outstanding=0,
                                 min_service_charge=5))
        conditions = get_list.call_args.kwargs["filters"]
        self.assertEqual(conditions["name"], "SI-1")
        self.assertEqual(conditions["show_trn_in_printout"], 0)
        self.assertEqual(conditions["customer_mobile_number"], ["like", "%50\\%\\_%"])
        query, params = db.sql.call_args.args
        self.assertIn("(line.qty) >= %(min_quantity)s", query)
        self.assertIn("(si.rounded_total) <= %(max_invoice_total)s", query)
        self.assertIn("GREATEST", query)
        self.assertEqual(params["min_quantity"], 0)
        self.assertEqual(params["max_invoice_total"], 0)
        self.assertEqual(params["min_service_charge"], 5)

    def test_reversed_numeric_range_does_not_query(self):
        with patch.object(report, "_", side_effect=lambda x: x), \
                patch.object(frappe, "throw", side_effect=ValueError), \
                patch.object(report, "get_data") as get_data:
            with self.assertRaises(ValueError):
                report.execute(dict(from_date="2026-11-01", to_date="2026-11-05",
                                    min_invoice_total=100, max_invoice_total=50))
        get_data.assert_not_called()
