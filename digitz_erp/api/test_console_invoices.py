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
            posting_date='2026-11-18',
            posting_time='12:34:56',
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
        from digitz_erp.selling.doctype.sales_invoice.sales_invoice import CORRECTION_POSTING_DATETIME_MARKER

        self.framework.utils.get_fullname.return_value = 'Admin User'
        result = api.correct_sales_invoice.__wrapped__(
            docname=self.doc.name, reason='Correcting the recorded cash amount'
        )
        self.assertEqual(result, {'ok': True, 'name': self.doc.name})
        self.doc.add_comment.assert_called_once_with(
            'Comment',
            'Taken back to draft for correction by Admin User. Reason: Correcting the recorded cash amount '
            f'{CORRECTION_POSTING_DATETIME_MARKER}2026-11-18T12:34:56]',
        )

    @patch('digitz_erp.selling.doctype.sales_invoice.sales_invoice.frappe')
    def test_correction_restores_original_posting_date_time_and_modified_by(self, framework):
        from digitz_erp.selling.doctype.sales_invoice.sales_invoice import SalesInvoice

        framework.db.get_value.return_value = 'cashier@example.com'
        doc = SimpleNamespace(
            name='SI-TEST-001',
            doctype='Sales Invoice',
            docstatus=0,
            posting_date='2026-11-19',
            posting_time='16:00:00',
            flags=frappe._dict(),
            is_new=lambda: False,
            get_pending_cash_correction_comment=lambda: frappe._dict(
                content='Correction [invoice-correction-original-posting-datetime:2026-11-18T12:34:56]'
            ),
        )
        self.assertTrue(SalesInvoice.preserve_correction_posting_datetime(doc))
        self.assertEqual(str(doc.posting_date), '2026-11-18')
        self.assertEqual(str(doc.posting_time), '12:34:56')
        self.assertTrue(doc.flags.preserve_owner_for_cash_correction)
        self.assertEqual(doc.flags.cash_correction_modified_by, 'cashier@example.com')

    @patch('digitz_erp.selling.doctype.sales_invoice.sales_invoice.frappe')
    def test_correction_preserves_metadata_during_resubmission(self, framework):
        from digitz_erp.selling.doctype.sales_invoice.sales_invoice import SalesInvoice

        framework.db.get_value.return_value = 'cashier@example.com'
        doc = SimpleNamespace(
            name='SI-TEST-001',
            doctype='Sales Invoice',
            docstatus=1,
            posting_date='2026-11-19',
            posting_time='16:00:00',
            flags=frappe._dict(),
            is_new=lambda: False,
            get_pending_cash_correction_comment=lambda: frappe._dict(
                content='Correction [invoice-correction-original-posting-datetime:2026-11-18T12:34:56]'
            ),
        )

        self.assertTrue(SalesInvoice.preserve_correction_posting_datetime(doc))
        self.assertEqual(str(doc.posting_date), '2026-11-18')
        self.assertEqual(str(doc.posting_time), '12:34:56')
        self.assertEqual(doc.flags.cash_correction_modified_by, 'cashier@example.com')

    @patch('digitz_erp.selling.doctype.sales_invoice.sales_invoice.frappe')
    def test_pending_correction_keeps_original_invoice_owner(self, framework):
        from digitz_erp.selling.doctype.sales_invoice.sales_invoice import SalesInvoice

        doc = SimpleNamespace(
            flags=frappe._dict(
                preserve_owner_for_cash_correction=True,
                cash_correction_modified_by='cashier@example.com',
            ),
            owner='cashier@example.com',
            name='SI-TEST-001',
            modified_by='admin@example.com',
        )
        framework.session.user = 'admin@example.com'

        SalesInvoice.take_ownership(doc)

        self.assertEqual(doc.owner, 'cashier@example.com')
        self.assertEqual(doc.modified_by, 'cashier@example.com')
        framework.db.set_value.assert_called_once_with(
            'Sales Invoice', 'SI-TEST-001', 'modified_by', 'cashier@example.com', update_modified=False
        )

    @patch('digitz_erp.selling.doctype.sales_invoice.sales_invoice.frappe')
    def test_submitted_correction_logs_editor_and_consumes_marker(self, framework):
        from digitz_erp.selling.doctype.sales_invoice.sales_invoice import (
            CORRECTION_POSTING_DATETIME_MARKER,
            SalesInvoice,
        )

        marker_comment = frappe._dict(
            name='COMMENT-1',
            content=f'Correction reason {CORRECTION_POSTING_DATETIME_MARKER}2026-11-18T12:34:56]',
        )
        doc = SimpleNamespace(
            get_pending_cash_correction_comment=lambda: marker_comment,
            add_comment=Mock(),
        )
        framework.session.user = 'admin@example.com'
        framework.utils.get_fullname.return_value = 'Admin User'

        SalesInvoice.finish_cash_correction_audit(doc)

        framework.db.set_value.assert_called_once_with(
            'Comment', 'COMMENT-1', 'content', 'Correction reason', update_modified=False
        )
        doc.add_comment.assert_called_once_with(
            'Comment', 'Cash invoice correction submitted by Admin User.'
        )

    @patch('digitz_erp.api.receipt_entry_api.get_allocations_for_sales_invoice', return_value=[])
    def test_cashier_correction_still_rejects_cash_sales(self, _allocations):
        self.framework.get_roles.return_value = ['Cashier']
        with self.assertRaises(ValueError):
            api.correct_sales_invoice.__wrapped__(docname=self.doc.name, check_only=1)
