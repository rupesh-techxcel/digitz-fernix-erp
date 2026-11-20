"""Archive stale draft Sales Invoices.

Drafts are numbered on their own D series and take an invoice number only on
submit (SalesInvoice.assign_submitted_number), so a draft left behind holds no
number. This removes such drafts from Sales Invoice once they are more than
ARCHIVE_AFTER_HOURS old -- both by their posting date and time and by their last
change, so a back-dated draft a cashier is still working on is left alone -- and
keeps a full copy of each in Archived Sales Invoice. There is no restore.

Runs nightly (hooks.py scheduler_events); a System Manager can run it from the
Archived Sales Invoice list (archive_drafts_now).
"""

import json

import frappe
from frappe.utils import add_to_date, now_datetime

ARCHIVE_AFTER_HOURS = 48
REASON = f"Draft older than {ARCHIVE_AFTER_HOURS} hours"


def get_stale_drafts(hours=ARCHIVE_AFTER_HOURS, limit=None):
	"""Names of the drafts dated, and last changed, more than `hours` ago, oldest first."""
	cutoff = add_to_date(now_datetime(), hours=-hours)
	return frappe.db.sql_list(
		f"""
		SELECT name FROM `tabSales Invoice`
		WHERE docstatus = 0
		  AND TIMESTAMP(posting_date, IFNULL(posting_time, '00:00:00')) < %(cutoff)s
		  AND modified < %(cutoff)s
		ORDER BY posting_date, creation
		{"LIMIT %(limit)s" if limit else ""}
		""",
		{"cutoff": cutoff, "limit": limit},
	)


def archive_draft(name):
	"""Copy draft `name` into Archived Sales Invoice and delete it. False if it is
	no longer a draft (submitted or removed since it was listed)."""
	doc = frappe.get_doc("Sales Invoice", name)
	if doc.docstatus != 0:
		return False
	frappe.get_doc({
		"doctype": "Archived Sales Invoice",
		"invoice": doc.name,
		"customer": doc.customer,
		"customer_name": doc.customer_name,
		"customer_display_name": doc.get("customer_display_name"),
		"posting_date": doc.posting_date,
		"rounded_total": doc.rounded_total,
		"counter_session": doc.get("counter_session"),
		"draft_owner": doc.owner,
		"draft_created": doc.creation,
		"draft_modified": doc.modified,
		"archived_on": now_datetime(),
		"reason": REASON,
		"snapshot": json.dumps(doc.as_dict(convert_dates_to_str=True), indent=1, default=str),
	}).insert(ignore_permissions=True)
	# The normal delete, so on_trash runs (it unlinks the medical service logs)
	frappe.delete_doc("Sales Invoice", name, ignore_permissions=True)
	return True


def archive_stale_drafts(hours=ARCHIVE_AFTER_HOURS, limit=None):
	"""Archive every stale draft, each in its own transaction: one that cannot be
	deleted (still linked from another document, say) is logged and skipped, and
	the rest go ahead. Returns {"archived": n, "failed": n}."""
	archived = failed = 0
	for name in get_stale_drafts(hours, limit):
		try:
			if archive_draft(name):
				archived += 1
			frappe.db.commit()
		except Exception:
			frappe.db.rollback()
			frappe.log_error(title=f"Draft archive: could not archive {name}")
			failed += 1
	return {"archived": archived, "failed": failed}


@frappe.whitelist()
def archive_drafts_now():
	"""The nightly archive, run now from the Archived Sales Invoice list."""
	frappe.only_for("System Manager")
	return archive_stale_drafts()
