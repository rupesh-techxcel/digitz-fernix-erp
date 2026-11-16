import unittest
from unittest.mock import patch

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
