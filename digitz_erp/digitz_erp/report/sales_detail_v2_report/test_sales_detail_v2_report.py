import unittest
from datetime import date, time, timedelta
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
        with patch.object(report, "get_data", return_value=data), patch.object(report, "_", side_effect=lambda x: x), \
                patch.object(report, "hides_live_day", return_value=False):
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

    def test_chronological_sort_across_batches_and_invoice_lines(self):
        def row(invoice, day, clock, idx=1):
            return frappe._dict(invoice_number=invoice, posting_date=day,
                                posting_time=clock, idx=idx)

        later = date(2026, 11, 14)
        earlier = date(2026, 11, 13)
        batches = [
            [row("SI-10", earlier, timedelta(hours=10)),
             row("SI-NEXT", later, timedelta(0)),
             row("SI-09", earlier, timedelta(hours=9), 2)],
            [row("SI-09", earlier, timedelta(hours=9)),
             row("SI-EARLY", earlier, "08:59:59.999999"),
             row("SI-TIE", earlier, time(9)),
             row("SI-MIDNIGHT", earlier, None)],
        ]
        # More than 500 invoices forces the real multi-batch retrieval path.
        with patch.object(frappe, "get_roles", return_value=["System Manager"]), \
                patch.object(frappe, "get_list", return_value=[f"SI-{i}" for i in range(501)]), \
                patch.object(frappe, "db", new=Mock()) as db, \
                patch.object(report, "make_row", side_effect=lambda source, first: (source.invoice_number, source.idx, first)):
            db.get_table_columns.return_value = []
            db.sql.side_effect = batches
            result = report.get_data(dict(from_date=earlier, to_date=later))
        self.assertEqual(db.sql.call_count, 2)
        self.assertEqual(result, [
            ("SI-MIDNIGHT", 1, True),
            ("SI-EARLY", 1, True),
            ("SI-09", 1, True),
            ("SI-09", 2, False),
            ("SI-TIE", 1, True),
            ("SI-10", 1, True),
            ("SI-NEXT", 1, True),
        ])


class TestCashierSeesClosedDaysOnly(unittest.TestCase):
    def run_report(self, hide_live, from_date, to_date):
        with patch.object(report, "hides_live_day", return_value=hide_live), \
                patch.object(report, "today", return_value="2026-11-20"), \
                patch.object(report, "get_data", return_value=[]) as get_data:
            result = report.execute({"from_date": from_date, "to_date": to_date})
        return result, get_data

    def test_cashier_range_stops_at_yesterday(self):
        result, get_data = self.run_report(True, "2026-11-18", "2026-11-20")
        self.assertEqual(get_data.call_args.args[0]["to_date"], date(2026, 11, 19))
        self.assertTrue(get_data.call_args.args[0]["hide_live"])
        self.assertIn("not shown to cashiers", result[2])

    def test_cashier_asking_for_today_gets_nothing(self):
        result, get_data = self.run_report(True, "2026-11-20", "2026-11-20")
        get_data.assert_not_called()
        self.assertEqual(result[1], [])

    def test_supervisor_sees_today(self):
        _result, get_data = self.run_report(False, "2026-11-20", "2026-11-20")
        self.assertEqual(get_data.call_args.args[0]["to_date"], date(2026, 11, 20))

    def test_open_days_left_out_for_cashier(self):
        with patch.object(report, "frappe") as framework:
            framework.db.get_table_columns.return_value = []
            framework.get_roles.return_value = ["Cashier"]
            framework.session.user = "cashier@example.com"
            framework.get_all.return_value = ["CS-OPEN"]
            framework.get_list.return_value = []
            report.get_data({"from_date": date(2026, 11, 18), "to_date": date(2026, 11, 19), "hide_live": True})
            conditions = framework.get_list.call_args.kwargs["filters"]
        self.assertEqual(conditions["counter_session"], ["not in", ["CS-OPEN"]])
        self.assertEqual(conditions["owner"], "cashier@example.com")
