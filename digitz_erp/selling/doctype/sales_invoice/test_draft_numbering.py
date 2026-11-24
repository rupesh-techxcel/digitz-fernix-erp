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


class TestRenameLinks(unittest.TestCase):
	"""rename_links updates only the tables that hold the draft's name, so a
	submit no longer locks whole tables (the cause of the counter deadlocks)."""

	def test_updates_only_tables_that_hold_the_old_name(self):
		link_fields = [
			{"parent": "Receipt Allocation", "fieldname": "reference_name", "issingle": 0},
			{"parent": "Stock Ledger", "fieldname": "voucher_no", "issingle": 0},
			{"parent": "Some Settings", "fieldname": "last_invoice", "issingle": 1},
		]
		dynamic = [
			frappe._dict(parent="Comment", fieldname="reference_name", options="reference_doctype"),
			frappe._dict(parent="Activity Log", fieldname="link_name", options="link_doctype"),
		]
		statements = []

		def sql(query, values=None):
			statements.append((query, values))
			if query.startswith("SELECT 1"):
				# The draft is referenced only from Receipt Allocation and Comment
				return [(1,)] if ("Receipt Allocation" in query or "Comment" in query) else []
			return []

		with patch.object(si.frappe.db, "sql", side_effect=sql), \
				patch.object(si.frappe, "get_meta", return_value=frappe._dict(is_virtual=0, issingle=0)), \
				patch("frappe.model.rename_doc.get_link_fields", return_value=link_fields), \
				patch("frappe.model.rename_doc.update_link_field_values") as update_links, \
				patch("frappe.model.dynamic_links.get_dynamic_links", return_value=dynamic):
			si.rename_links("Sales Invoice", "DINV/000007", "INV/452598")

		updated = [f["parent"] for f in update_links.call_args.args[0]]
		self.assertEqual(updated, ["Receipt Allocation", "Some Settings"])
		updates = [(q, v) for q, v in statements if q.startswith("UPDATE")]
		self.assertEqual(len(updates), 1)
		self.assertIn("`tabComment`", updates[0][0])
		self.assertEqual(updates[0][1], ("INV/452598", "Sales Invoice", "DINV/000007"))
		self.assertTrue(all("FOR UPDATE" not in q for q, _ in statements))


class TestSaveWithRetry(unittest.TestCase):
	def test_runs_again_after_a_deadlock(self):
		tries = []

		def savedocs(doc, action):
			tries.append(action)
			if len(tries) == 1:
				raise frappe.QueryDeadlockError("1213")
			return "saved"

		with patch("frappe.desk.form.save.savedocs", side_effect=savedocs), \
				patch.object(si.frappe.db, "rollback") as rollback, \
				patch("time.sleep"):
			self.assertEqual(si.save_with_retry("{}", "Submit"), "saved")
		self.assertEqual(tries, ["Submit", "Submit"])
		rollback.assert_called_once()

	def test_gives_up_after_the_last_try(self):
		with patch("frappe.desk.form.save.savedocs", side_effect=frappe.QueryDeadlockError("1213")) as savedocs, \
				patch.object(si.frappe.db, "rollback"), \
				patch("time.sleep"):
			with self.assertRaises(frappe.QueryDeadlockError):
				si.save_with_retry("{}", "Save")
		self.assertEqual(savedocs.call_count, si.DEADLOCK_RETRIES + 1)

	def test_other_errors_are_not_retried(self):
		with patch("frappe.desk.form.save.savedocs", side_effect=frappe.ValidationError("bad")) as savedocs:
			with self.assertRaises(frappe.ValidationError):
				si.save_with_retry("{}", "Submit")
		self.assertEqual(savedocs.call_count, 1)


def _bind(doc):
	"""A plain dict standing in for the document, with the methods the tests call."""
	doc.get_naming_series = lambda: doc.naming_series
	return doc
