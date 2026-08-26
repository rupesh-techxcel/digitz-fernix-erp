# Copyright (c) 2026, Rupesh P and contributors
# See license.txt

"""The PIN contract with the POS terminal.

The reference vector below is the same pair asserted by the terminal's
`pin_interop_test.dart`. If these two ever disagree, cashiers can be saved here
and still be unable to sign in at the counter, with nothing logged anywhere.
"""

import base64

import frappe
from frappe.tests.utils import FrappeTestCase

from digitz_erp.setup.doctype.cashier.cashier import (
	PIN_ITERATIONS,
	PIN_KEY_BYTES,
	hash_pin,
)

# The pair the POS test suite verifies against, for PIN "1234".
REFERENCE_SALT = "UjtvgTDtx5gHnkccOrWynQ=="
REFERENCE_HASH = "Dl/XyjRikRbjQgP98STijcGhbCucSqhBSDgkn366Ox0="


class TestCashier(FrappeTestCase):
	def test_matches_the_terminal_reference_vector(self):
		import hashlib

		salt = base64.b64decode(REFERENCE_SALT)
		derived = hashlib.pbkdf2_hmac(
			"sha256", b"1234", salt, PIN_ITERATIONS, PIN_KEY_BYTES
		)

		self.assertEqual(base64.b64encode(derived).decode(), REFERENCE_HASH)

	def test_hash_pin_is_salted(self):
		first_hash, first_salt = hash_pin("1234")
		second_hash, second_salt = hash_pin("1234")

		self.assertNotEqual(first_salt, second_salt)
		self.assertNotEqual(
			first_hash, second_hash, "the same PIN must not produce a stable digest"
		)

	def test_hash_and_salt_are_the_sizes_the_terminal_expects(self):
		pin_hash, pin_salt = hash_pin("1234")

		self.assertEqual(len(base64.b64decode(pin_hash)), PIN_KEY_BYTES)
		self.assertEqual(len(base64.b64decode(pin_salt)), 16)

	def _cashier_for(self, user):
		if frappe.db.exists("Cashier", user):
			frappe.delete_doc("Cashier", user, force=True)

		return frappe.get_doc({"doctype": "Cashier", "user": user})

	def test_plaintext_pin_is_never_stored(self):
		doc = self._cashier_for("Administrator")
		doc.new_pin = "4821"
		doc.insert()

		self.assertEqual(doc.new_pin, "")
		self.assertTrue(doc.pin_hash)
		self.assertTrue(doc.pin_salt)
		self.assertEqual(frappe.db.get_value("Cashier", doc.name, "new_pin"), "")

		frappe.delete_doc("Cashier", doc.name, force=True)

	def test_blank_pin_keeps_the_existing_one(self):
		doc = self._cashier_for("Administrator")
		doc.new_pin = "4821"
		doc.insert()
		original = doc.pin_hash

		doc.full_name = "Renamed"
		doc.save()

		self.assertEqual(doc.pin_hash, original)

		frappe.delete_doc("Cashier", doc.name, force=True)

	def test_rejects_a_short_or_non_numeric_pin(self):
		doc = self._cashier_for("Administrator")

		doc.new_pin = "12"
		self.assertRaises(frappe.ValidationError, doc.insert)

		doc.new_pin = "abcd"
		self.assertRaises(frappe.ValidationError, doc.insert)
