# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""Till operator, and the counter PIN they sign in with.

The PIN is hashed here and only ever leaves the server as a digest. The POS
terminal caches that digest and verifies it locally, so a cashier can still
sign in with the network down.

The hashing parameters below are a contract with the POS: it derives the same
key with the same algorithm, iteration count and key length before comparing.
Changing any of them locks out every cashier on the estate, with no error on
either side -- the comparison simply stops matching.
"""

import base64
import hashlib
import os

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import now_datetime

# Contract with the POS terminal. Do not change without shipping a matching
# terminal build; see `kPinIterations` in the POS `pin_hasher.dart`.
PIN_ALGORITHM = "sha256"
PIN_ITERATIONS = 120000
PIN_KEY_BYTES = 32
PIN_SALT_BYTES = 16

MIN_PIN_LENGTH = 4


def hash_pin(pin):
	"""Returns (pin_hash, pin_salt), both base64, for a plaintext PIN."""
	salt = os.urandom(PIN_SALT_BYTES)
	derived = hashlib.pbkdf2_hmac(
		PIN_ALGORITHM, pin.encode("utf-8"), salt, PIN_ITERATIONS, PIN_KEY_BYTES
	)

	return (
		base64.b64encode(derived).decode("ascii"),
		base64.b64encode(salt).decode("ascii"),
	)


class Cashier(Document):
	def validate(self):
		self.set_pin_from_input()

	def set_pin_from_input(self):
		"""Hashes `new_pin` into the stored digest, then discards the plaintext.

		This runs before the row is written, so the PIN the supervisor typed
		never reaches the database.
		"""
		pin = (self.new_pin or "").strip()
		if not pin:
			# Blank means "leave the existing PIN alone".
			self.new_pin = ""
			return

		if not pin.isdigit():
			frappe.throw(_("The PIN must contain digits only."))

		if len(pin) < MIN_PIN_LENGTH:
			frappe.throw(
				_("The PIN must be at least {0} digits.").format(MIN_PIN_LENGTH)
			)

		self.pin_hash, self.pin_salt = hash_pin(pin)
		self.pin_set_on = now_datetime()
		self.new_pin = ""

	@property
	def has_pin(self):
		return bool(self.pin_hash and self.pin_salt)


@frappe.whitelist()
def set_pin(cashier, pin):
	"""Sets a cashier's PIN from script or an integration.

	Goes through `save()` on purpose. The terminals pull cashiers incrementally
	on `modified`, so a direct `db_set` would update the digest here and never
	reach a till.
	"""
	doc = frappe.get_doc("Cashier", cashier)
	doc.new_pin = pin
	doc.save()

	return {"cashier": doc.name, "pin_set_on": doc.pin_set_on}
