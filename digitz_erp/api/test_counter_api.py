import unittest
from unittest.mock import MagicMock, patch

import frappe

from digitz_erp.api import counter_api as api


class TestPreviousCounter(unittest.TestCase):
	"""get_previous_counter: which counter a PC was on, from its secret."""

	def lookup(self, row):
		with patch.object(api.frappe.db, "get_value", return_value=row) as get_value:
			result = api.get_previous_counter("secret")
		filters = get_value.call_args.args[1]
		self.assertEqual(filters, {"secret_hash": api.hash_secret("secret")})
		return result

	def test_an_approved_device_was_on_its_counter_even_when_disabled(self):
		row = frappe._dict(name="DEV-0007", counter="Counter 1", enabled=0, approval_status="Approved", previous_counter=None)
		self.assertEqual(self.lookup(row), {"device": "DEV-0007", "counter": "Counter 1", "enabled": 0})

	def test_a_device_registered_before_approvals_counts_as_approved(self):
		row = frappe._dict(name="DEV-0001", counter="Counter 1", enabled=1, approval_status=None, previous_counter=None)
		self.assertEqual(self.lookup(row).counter, "Counter 1")

	def test_a_request_keeps_the_counter_the_pc_was_on(self):
		row = frappe._dict(name="DEV-0009", counter="Counter 2", enabled=0, approval_status="Rejected", previous_counter="Counter 1")
		self.assertEqual(self.lookup(row), {"device": None, "counter": "Counter 1", "enabled": 0})

	def test_a_new_pcs_request_has_no_previous_counter(self):
		row = frappe._dict(name="DEV-0009", counter="Counter 2", enabled=0, approval_status="Pending", previous_counter=None)
		self.assertIsNone(self.lookup(row))

	def test_no_secret_or_unknown_secret(self):
		self.assertIsNone(api.get_previous_counter(None))
		self.assertIsNone(self.lookup(None))


class TestRequestDevice(unittest.TestCase):
	"""request_device: a cashier cannot move a PC to another counter on their own."""

	def request(self, counter, previous, active_device=None):
		doc = MagicMock(name="doc")
		doc.name = "DEV-0010"
		patches = [
			patch.object(api.frappe, "get_roles", return_value=["Cashier"]),
			patch.object(api.frappe.db, "get_value", return_value=1),
			patch.object(api, "get_request_device", return_value=None),
			patch.object(api, "get_previous_counter", return_value=previous),
			patch.object(api, "get_active_device", return_value=active_device),
			patch.object(api, "lock_counter"),
			patch.object(api, "reject_own_pending"),
			patch.object(api, "request_secret", return_value="old-secret"),
			patch.object(api, "set_device_cookie"),
			patch.object(api, "notify_devices_changed"),
		]
		for p in patches:
			p.start()
			self.addCleanup(p.stop)

		def new_device(counter, secret, **fields):
			doc.counter = counter
			doc.approval_status = fields["approval_status"]
			doc.previous_counter = fields.get("previous_counter")
			return doc

		with patch.object(api, "new_device", side_effect=new_device), \
				patch.object(api, "take_over_counter") as take_over:
			result = api.request_device(counter)
		return result, doc, take_over

	def test_a_new_pc_gets_a_free_counter_at_once(self):
		result, doc, take_over = self.request("Counter 2", previous=None)
		self.assertEqual(result["status"], "Approved")
		take_over.assert_called_once_with(doc)

	def test_a_pc_that_was_counter_1_is_not_moved_to_a_free_counter_2(self):
		previous = frappe._dict(device="DEV-0007", counter="Counter 1", enabled=0)
		result, doc, take_over = self.request("Counter 2", previous=previous)
		self.assertEqual(result["status"], "Pending")
		self.assertEqual(doc.previous_counter, "Counter 1")
		take_over.assert_not_called()
		self.assertIn("Moves this PC from Counter 1", doc.add_comment.call_args.args[1])

	def test_a_pc_gets_its_own_free_counter_back_at_once(self):
		previous = frappe._dict(device="DEV-0007", counter="Counter 1", enabled=0)
		result, doc, take_over = self.request("Counter 1", previous=previous)
		self.assertEqual(result["status"], "Approved")
		take_over.assert_called_once_with(doc)

	def test_its_own_counter_taken_by_another_pc_waits(self):
		previous = frappe._dict(device="DEV-0007", counter="Counter 1", enabled=0)
		result, doc, take_over = self.request("Counter 1", previous=previous, active_device="DEV-0008")
		self.assertEqual(result["status"], "Pending")
		self.assertEqual(result["replaces"], "DEV-0008")
		take_over.assert_not_called()


class TestRequestOptions(unittest.TestCase):
	def test_marks_this_pcs_counter_and_the_moves(self):
		previous = frappe._dict(device="DEV-0007", counter="Counter 1", enabled=0)
		with patch.object(api, "get_previous_counter", return_value=previous), \
				patch.object(api, "request_secret", return_value="old-secret"), \
				patch.object(api.frappe, "get_all", return_value=["Counter 1", "Counter 2"]), \
				patch.object(api, "get_active_device", return_value=None):
			options = api.get_request_options()
		self.assertEqual(
			[(o["counter"], o["previous"], o["moves"]) for o in options],
			[("Counter 1", True, False), ("Counter 2", False, True)],
		)

	def test_a_new_pc_moves_nothing(self):
		with patch.object(api, "get_previous_counter", return_value=None), \
				patch.object(api, "request_secret", return_value=None), \
				patch.object(api.frappe, "get_all", return_value=["Counter 1"]), \
				patch.object(api, "get_active_device", return_value=None):
			options = api.get_request_options()
		self.assertEqual((options[0]["previous"], options[0]["moves"]), (False, False))


class TestSupervisorRegister(unittest.TestCase):
	def test_a_supervisor_moves_a_pc_to_any_counter(self):
		previous = frappe._dict(device="DEV-0007", counter="Counter 1", enabled=0)
		doc = MagicMock(name="doc")
		doc.name = "DEV-0011"
		with patch.object(api, "check_supervisor"), \
				patch.object(api.frappe.db, "get_value", return_value=1), \
				patch.object(api, "lock_counter"), \
				patch.object(api, "get_request_device", return_value=None), \
				patch.object(api, "get_previous_counter", return_value=previous), \
				patch.object(api, "request_secret", return_value="old-secret"), \
				patch.object(api, "reject_own_pending"), \
				patch.object(api, "new_device", return_value=doc) as new_device, \
				patch.object(api, "take_over_counter") as take_over, \
				patch.object(api, "set_device_cookie"), \
				patch.object(api, "notify_devices_changed"), \
				patch.object(api.frappe, "get_all", return_value=[]):
			result = api.register_device(counter="Counter 2")
		self.assertEqual(result["counter"], "Counter 2")
		self.assertEqual(new_device.call_args.kwargs["previous_counter"], "Counter 1")
		take_over.assert_called_once_with(doc)
