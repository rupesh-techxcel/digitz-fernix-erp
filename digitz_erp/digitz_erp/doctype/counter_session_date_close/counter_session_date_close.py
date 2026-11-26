# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""One date's close inside a Counter Session: what the date's cash documents say
the till should hold, what was counted for it, and its approval. A session that
runs over several dates is closed date by date; see counter_session_api."""

from frappe.model.document import Document


class CounterSessionDateClose(Document):
	pass
