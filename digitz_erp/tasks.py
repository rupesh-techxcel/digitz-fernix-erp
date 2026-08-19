import frappe
from frappe.utils import now_datetime, add_days, cint

def re_post_stock_ledgers():
    frappe.call('digitz_erp.api.stock_update.re_post_stock_ledgers')

TARGET_DOCTYPES = [
	"Sales Invoice",
	"Quotation",
	"Delivery Note",
	"Purchase Order",
	"Receipt Entry",
	"Data Import"
]

def cleanup_old_print_pdf_attachments(days: int = 3, batch_size: int = 500, dry_run: int = 0):
	"""
	Delete only print pdf attachments older than `days` where:
	- attached_to_doctype in TARGET_DOCTYPES
	- creation < cutoff
	- file is pdf
	- file_name starts with attached_to_name (docname)
	  ex: DN-101_deliverynote_XXXXX.pdf  => matches attached_to_name = DN-101

	This queries only the File table (no document iteration).
	Designed to run daily.
	"""

	days = cint(days or 3)
	batch_size = cint(batch_size or 500)
	dry_run = cint(dry_run or 0)

	cutoff = add_days(now_datetime(), -days)

	total_deleted = 0
	total_found = 0
	error_messages = []
	status = "Success"

	try:
		while True:
			rows = frappe.db.sql(
				"""
				SELECT name, attached_to_doctype, attached_to_name, file_name, file_url, creation
				FROM `tabFile`
				WHERE
					is_folder = 0
					AND attached_to_doctype IN %(doctypes)s
					AND creation < %(cutoff)s
					AND (
						LOWER(IFNULL(file_name,'')) LIKE '%%.pdf'
						OR LOWER(IFNULL(file_url,'')) LIKE '%%.pdf'
					)
					AND LOWER(IFNULL(file_name,'')) LIKE CONCAT(LOWER(IFNULL(attached_to_name,'')), '%%')
				ORDER BY creation ASC
				LIMIT %(limit)s
				""",
				{
					"doctypes": tuple(TARGET_DOCTYPES),
					"cutoff": cutoff,
					"limit": batch_size
				},
				as_dict=True,
			)

			if not rows:
				break

			total_found += len(rows)

			if dry_run:
				break

			for f in rows:
				try:
					frappe.delete_doc("File", f["name"], ignore_permissions=True, force=True)
					total_deleted += 1
				except Exception:
					status = "Partial"
					err = (
						f"Failed deleting File {f.get('name')} | "
						f"{f.get('attached_to_doctype')} / {f.get('attached_to_name')} | "
						f"{f.get('file_name')}"
					)
					error_messages.append(err)
					frappe.log_error(
						frappe.get_traceback(),
						f"Print Attachment Cleanup Failed: {f.get('attached_to_doctype')} {f.get('attached_to_name')}"
					)

			frappe.db.commit()

	except Exception:
		status = "Failed"
		error_messages.append(frappe.get_traceback())
		frappe.log_error(frappe.get_traceback(), "Print Attachment Cleanup Job Failed")

	result = {
		"cutoff": str(cutoff),
		"days_kept": days,
		"batch_size": batch_size,
		"dry_run": bool(dry_run),
		"files_found": total_found,
		"files_deleted": total_deleted,
		"status": status,
	}

	_create_cleanup_log(result, error_messages)

	return result


def _create_cleanup_log(result, error_messages=None):
	error_messages = error_messages or []

	details = (
		f"Target DocTypes: {', '.join(TARGET_DOCTYPES)}\n"
		f"Cutoff: {result.get('cutoff')}\n"
		f"Days Kept: {result.get('days_kept')}\n"
		f"Batch Size: {result.get('batch_size')}\n"
		f"Dry Run: {result.get('dry_run')}\n"
		f"Files Found: {result.get('files_found')}\n"
		f"Files Deleted: {result.get('files_deleted')}"
	)

	log_doc = frappe.get_doc({
		"doctype": "Print PDF Cleanup Log",
		"run_at": now_datetime(),
		"cutoff": result.get("cutoff"),
		"days_kept": result.get("days_kept"),
		"batch_size": result.get("batch_size"),
		"dry_run": 1 if result.get("dry_run") else 0,
		"files_found": result.get("files_found"),
		"files_deleted": result.get("files_deleted"),
		"status": result.get("status"),
		"details": details,
		"error_log": "\n".join(error_messages) if error_messages else ""
	})

	log_doc.insert(ignore_permissions=True)
	frappe.db.commit()