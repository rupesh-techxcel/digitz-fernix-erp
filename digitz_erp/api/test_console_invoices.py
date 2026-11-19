import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import frappe
from digitz_erp.api import sales_invoice_api as api


class TestConsoleInvoiceScope(unittest.TestCase):
    def setUp(self):
        patcher = patch.object(api, 'frappe')
        self.framework = patcher.start()
        self.addCleanup(patcher.stop)
        self.framework.flags = frappe._dict(console_invoice_scope=False)
        self.framework.session.user = 'cashier@example.com'
        self.framework.parse_json.side_effect = lambda value: value
        self.framework.has_permission.return_value = True
        self.framework.get_roles.return_value = ['Cashier']
        self.framework.db.escape.return_value = "'cashier@example.com'"
        self.framework.throw.side_effect = ValueError

    def test_scope_is_local_and_normal_permissions_stay_in_effect(self):
        f = self.framework
        def listing(*args, **kwargs):
            self.assertIsNone(api.get_sales_invoice_permission_query(f.session.user))
            return [{'name': 'SI-1'}]
        f.get_list.side_effect = listing
        for scope, operator in [('mine', '='), ('others', '!='), ('all', None)]:
            with self.subTest(scope=scope):
                self.assertEqual(api.get_console_invoices.__wrapped__(scope=scope), [{'name': 'SI-1'}])
                filters = f.get_list.call_args.kwargs['filters']
                expected = [['Sales Invoice', 'owner', operator, f.session.user]] if operator else []
                self.assertEqual(filters, expected)
                self.assertFalse(f.flags.console_invoice_scope)
                self.assertIn('owner =', api.get_sales_invoice_permission_query(f.session.user))
                self.assertNotIn('ignore_permissions', f.get_list.call_args.kwargs)

    def test_exception_restores_ownership_filter(self):
        self.framework.get_list.side_effect = RuntimeError('query failed')
        with self.assertRaises(RuntimeError):
            api.get_console_invoices.__wrapped__(scope='all')
        self.assertFalse(self.framework.flags.console_invoice_scope)

    def test_permission_and_invalid_scope_rejected(self):
        self.framework.has_permission.return_value = False
        with self.assertRaises(ValueError):
            api.get_console_invoices.__wrapped__(scope='all')
        self.framework.get_list.assert_not_called()
        self.framework.has_permission.return_value = True
        with self.assertRaises(ValueError):
            api.get_console_invoices.__wrapped__(scope='invalid')
        self.framework.get_list.assert_not_called()


class TestInvoiceCorrection(unittest.TestCase):
    def setUp(self):
        patcher = patch.object(api, 'frappe')
        self.framework = patcher.start()
        self.addCleanup(patcher.stop)
        self.framework.session.user = 'admin@example.com'
        self.framework.get_roles.return_value = ['System Manager']
        self.framework.throw.side_effect = ValueError
        self.doc = SimpleNamespace(
            name='SI-TEST-001',
            docstatus=1,
            credit_sale=0,
            payment_mode='Cash',
            paid_amount=100,
            update_stock=0,
            tab_sales=0,
            project=None,
            sales_order=None,
            for_advance_payment=0,
            delivery_notes=[],
            customer='CUST-TEST-001',
            meta=SimpleNamespace(get_table_fields=lambda: []),
            add_comment=Mock(),
            check_permission=lambda permission: None,
            get=lambda fieldname: [],
        )
        self.framework.get_doc.return_value = self.doc
        self.framework.db.get_value.return_value = 'Cash'
        self.framework.db.exists.return_value = False
        self.framework.get_all.return_value = []

    @patch('digitz_erp.api.receipt_entry_api.get_allocations_for_sales_invoice', return_value=[])
    def test_system_manager_can_check_an_unlinked_cash_sale(self, _allocations):
        result = api.correct_sales_invoice.__wrapped__(docname=self.doc.name, check_only=1)
        self.assertEqual(result, {'ok': True})

    @patch('digitz_erp.api.receipt_entry_api.get_allocations_for_sales_invoice', return_value=[])
    def test_system_manager_must_give_a_reason_before_reverting(self, _allocations):
        with self.assertRaises(ValueError):
            api.correct_sales_invoice.__wrapped__(docname=self.doc.name)
        self.framework.db.delete.assert_not_called()

    @patch('digitz_erp.api.receipt_entry_api.get_allocations_for_sales_invoice', return_value=[])
    def test_system_manager_cannot_use_cash_correction_for_non_cash_mode(self, _allocations):
        self.framework.db.get_value.return_value = 'Bank'
        with self.assertRaises(ValueError):
            api.correct_sales_invoice.__wrapped__(docname=self.doc.name, check_only=1)

    @patch('digitz_erp.selling.doctype.sales_invoice.sales_invoice.get_utilized_credit', return_value=0)
    @patch('digitz_erp.api.gl_posting_api.update_accounts_for_doc_type')
    @patch('digitz_erp.api.bank_reconciliation_api.cancel_bank_reconciliation')
    @patch('digitz_erp.api.receipt_entry_api.get_allocations_for_sales_invoice', return_value=[])
    def test_system_manager_correction_records_reason(
        self, _allocations, _cancel_reconciliation, _update_accounts, _utilized_credit
    ):
        self.framework.utils.get_fullname.return_value = 'Admin User'
        result = api.correct_sales_invoice.__wrapped__(
            docname=self.doc.name, reason='Correcting the recorded cash amount'
        )
        self.assertEqual(result, {'ok': True, 'name': self.doc.name})
        self.doc.add_comment.assert_called_once_with(
            'Comment',
            'Taken back to draft for correction by Admin User. Reason: Correcting the recorded cash amount',
        )

    @patch('digitz_erp.api.receipt_entry_api.get_allocations_for_sales_invoice', return_value=[])
    def test_cashier_correction_still_rejects_cash_sales(self, _allocations):
        self.framework.get_roles.return_value = ['Cashier']
        with self.assertRaises(ValueError):
            api.correct_sales_invoice.__wrapped__(docname=self.doc.name, check_only=1)
