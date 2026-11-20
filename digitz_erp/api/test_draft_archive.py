import unittest
from unittest.mock import MagicMock, patch

import frappe

from digitz_erp.api import draft_archive as da


class TestDraftArchive(unittest.TestCase):
	def test_stale_means_dated_and_changed_over_48_hours_ago(self):
		from datetime import datetime
		with patch.object(da, "frappe") as framework, \
				patch.object(da, "now_datetime", return_value=datetime(2026, 11, 20, 2, 0)):
			framework.db.sql_list.return_value = ["DINV/000001"]
			self.assertEqual(da.get_stale_drafts(), ["DINV/000001"])
			query, params = framework.db.sql_list.call_args.args
		self.assertIn("docstatus = 0", query)
		self.assertIn("TIMESTAMP(posting_date", query)
		self.assertIn("modified < %(cutoff)s", query)
		self.assertEqual(params["cutoff"], datetime(2026, 11, 18, 2, 0))

	def test_one_failure_does_not_stop_the_rest(self):
		with patch.object(da, "get_stale_drafts", return_value=["A", "B", "C"]), \
				patch.object(da, "archive_draft", side_effect=[True, Exception("linked"), True]), \
				patch.object(da, "frappe") as framework:
			result = da.archive_stale_drafts()
		self.assertEqual(result, {"archived": 2, "failed": 1})
		framework.db.rollback.assert_called_once()
		framework.log_error.assert_called_once()

	def test_a_draft_submitted_meanwhile_is_left_alone(self):
		with patch.object(da, "frappe") as framework:
			framework.get_doc.return_value = frappe._dict(docstatus=1)
			self.assertFalse(da.archive_draft("INV/452598"))
			framework.delete_doc.assert_not_called()
