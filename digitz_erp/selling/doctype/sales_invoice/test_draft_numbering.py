import unittest
from unittest.mock import patch

import frappe

from digitz_erp.selling.doctype.sales_invoice import sales_invoice as si


class TestDraftNumbering(unittest.TestCase):
	def setUp(self):
		# Frappe's parser needs a site; this stands in for it, for November 2026
		dates = {"MM": "11", "YYYY": "2026"}
		parser = patch.object(si, "parse_naming_series",
			side_effect=lambda parts, doc=None: "".join(dates.get(p, p) for p in parts))
		parser.start()
		self.addCleanup(parser.stop)

	def test_split_series(self):
		self.assertEqual(si.split_series("INV/.######"), ("INV/", 6, ""))
		self.assertEqual(si.split_series("SI-.#####.-.MM.-.YYYY."), ("SI-", 5, "-11-2026"))

	def test_draft_series_is_d_plus_naming_series(self):
		doc = frappe._dict(naming_series="INV/.######", name="DINV/000007")
		self.assertTrue(si.SalesInvoice.is_draft_numbered(_bind(doc)))
		doc.name = "INV/452597"
		self.assertFalse(si.SalesInvoice.is_draft_numbered(_bind(doc)))

	def test_last_submitted_skips_names_off_the_series(self):
		with patch.object(si, "frappe") as framework:
			framework.db.sql.return_value = [("INV/HAND-KEYED",), ("INV/452597",)]
			self.assertEqual(si.last_submitted_number("INV/", 6), 452597)
			query, params = framework.db.sql.call_args.args
		self.assertIn("docstatus > 0", query)
		self.assertIn("ORDER BY name DESC", query)
		self.assertEqual(params, ("INV/%",))

	def test_next_number_locks_series_then_skips_old_drafts(self):
		doc = _bind(frappe._dict(naming_series="INV/.######", name="DINV/000007"))
		calls = []

		def sql(query, params=None):
			calls.append(query)
			if "FOR UPDATE" in query:
				return [(452600,)]
			if "SELECT 1" in query:
				# INV/452598 is still held by a draft saved before draft numbering
				return [(1,)] if params == ("INV/452598%",) else []
			return []

		with patch.object(si, "frappe") as framework, \
				patch.object(si, "last_submitted_number", return_value=452597):
			framework.db.sql.side_effect = sql
			self.assertEqual(si.SalesInvoice.next_submitted_name(doc), "INV/452599")
		self.assertIn("FOR UPDATE", calls[0])
		self.assertIn("GREATEST", calls[-1])

	def test_like_pattern_escapes_wildcards(self):
		self.assertEqual(si.starts_with("A_B%"), "A\\_B\\%%")


def _bind(doc):
	"""A plain dict standing in for the document, with the methods the tests call."""
	doc.get_naming_series = lambda: doc.naming_series
	return doc
