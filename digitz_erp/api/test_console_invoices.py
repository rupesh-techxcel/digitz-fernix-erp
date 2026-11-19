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
    def test_system_manager_can_check_a_card_or_bank_sale(self, _allocations):
        self.doc.payment_mode = 'RAK BANK'
        self.framework.db.get_value.return_value = 'Bank'
        result = api.correct_sales_invoice.__wrapped__(docname=self.doc.name, check_only=1)
        self.assertEqual(result, {'ok': True})

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
    def test_system_manager_can_check_a_credit_sale(self, _allocations):
        self.doc.credit_sale = 1
        self.doc.paid_amount = 0
        result = api.correct_sales_invoice.__wrapped__(docname=self.doc.name, check_only=1)
        self.assertEqual(result, {'ok': True})

    @patch('digitz_erp.api.receipt_entry_api.get_allocations_for_sales_invoice', return_value=[])
    def test_system_manager_credit_sale_needs_a_reason(self, _allocations):
        self.doc.credit_sale = 1
        self.doc.paid_amount = 0
        with self.assertRaises(ValueError):
            api.correct_sales_invoice.__wrapped__(docname=self.doc.name)
        self.framework.db.delete.assert_not_called()

    @patch('digitz_erp.api.receipt_entry_api.get_allocations_for_sales_invoice', return_value=[])
    def test_system_manager_credit_sale_with_payment_is_blocked(self, _allocations):
        self.doc.credit_sale = 1
        self.doc.paid_amount = 50
        with self.assertRaises(ValueError):
            api.correct_sales_invoice.__wrapped__(docname=self.doc.name, check_only=1)

    @patch('digitz_erp.api.receipt_entry_api.get_allocations_for_sales_invoice', return_value=[])
    def test_cashier_correction_still_rejects_cash_sales(self, _allocations):
        self.framework.get_roles.return_value = ['Cashier']
        with self.assertRaises(ValueError):
            api.correct_sales_invoice.__wrapped__(docname=self.doc.name, check_only=1)


class TestCorrectionMarkerTrust(unittest.TestCase):
    """Only a System Manager's correction comment carries a usable marker."""

    def setUp(self):
        from digitz_erp.selling.doctype.sales_invoice.sales_invoice import (
            CORRECTION_POSTING_DATETIME_MARKER,
            SalesInvoice,
        )

        patcher = patch('digitz_erp.selling.doctype.sales_invoice.sales_invoice.frappe')
        self.framework = patcher.start()
        self.addCleanup(patcher.stop)
        self.framework.get_roles.side_effect = lambda user: (
            ['System Manager'] if user == 'admin@example.com' else ['Cashier']
        )
        self.marker = f'{CORRECTION_POSTING_DATETIME_MARKER}2026-01-01T00:00:00]'
        self.get_comment = SalesInvoice.get_pending_cash_correction_comment
        self.doc = SimpleNamespace(doctype='Sales Invoice', name='SI-TEST-001', is_new=lambda: False)

    def comments(self, *rows):
        self.framework.get_all.return_value = [frappe._dict(row) for row in rows]

    def test_marker_from_a_cashier_is_ignored(self):
        self.comments({'name': 'C-1', 'owner': 'cashier@example.com',
                       'content': f'Taken back to draft for correction by X. {self.marker}'})
        self.assertIsNone(self.get_comment(self.doc))

    def test_marker_from_a_system_manager_is_used(self):
        self.comments({'name': 'C-1', 'owner': 'admin@example.com',
                       'content': f'Taken back to draft for correction by Admin. {self.marker}'})
        self.assertEqual(self.get_comment(self.doc).name, 'C-1')

    def test_newer_forged_marker_does_not_hide_the_real_one(self):
        self.comments(
            {'name': 'C-2', 'owner': 'cashier@example.com',
             'content': f'Taken back to draft for correction by X. {self.marker}'},
            {'name': 'C-1', 'owner': 'admin@example.com',
             'content': f'Taken back to draft for correction by Admin. {self.marker}'},
        )
        self.assertEqual(self.get_comment(self.doc).name, 'C-1')

    def test_query_accepts_only_correction_comments(self):
        self.comments()
        self.get_comment(self.doc)
        filters = self.framework.get_all.call_args.kwargs['filters']
        self.assertEqual(filters['comment_type'], 'Comment')
        self.assertTrue(filters['content'][1].startswith('Taken back to draft for correction by '))


class TestStampCounterSessionOnCorrection(unittest.TestCase):
    """A corrected invoice keeps its day; an ordinary draft takes today's."""

    def setUp(self):
        from digitz_erp.api import counter_session_api

        self.module = counter_session_api
        for name, value in {
            'get_request_device': SimpleNamespace(counter='Counter 1', device='PC-1'),
            'get_open_session': 'CS-TODAY',
        }.items():
            patcher = patch.object(counter_session_api, name, return_value=value)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = patch.object(counter_session_api.frappe, 'local', SimpleNamespace(request=object()))
        patcher.start()
        self.addCleanup(patcher.stop)

    def invoice(self):
        return frappe._dict(
            doctype='Sales Invoice', name='SI-TEST-001', counter_session='CS-OLD',
            counter='Counter 2', counter_device='PC-2', is_new=lambda: False,
            meta=SimpleNamespace(has_field=lambda field: True),
        )

    def test_ordinary_draft_takes_the_open_session(self):
        doc = self.invoice()
        with patch.object(self.module, 'was_taken_back_for_correction', return_value=False):
            self.module.stamp_counter_session(doc)
        self.assertEqual((doc.counter_session, doc.counter), ('CS-TODAY', 'Counter 1'))

    def test_corrected_invoice_keeps_its_session(self):
        doc = self.invoice()
        with patch.object(self.module, 'was_taken_back_for_correction', return_value=True):
            self.module.stamp_counter_session(doc)
        self.assertEqual((doc.counter_session, doc.counter), ('CS-OLD', 'Counter 2'))
