# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""Link people recorded before `Customer.company_customer` existed.

Run manually; this is deliberately not a patch, so `bench migrate` never
triggers it.

	bench --site <site> execute digitz_erp.seeds.backfill_company_customers.run

	# preview without writing anything
	bench --site <site> execute digitz_erp.seeds.backfill_company_customers.run \
		--kwargs "{'dry_run': 1}"

Walks Medical Service Logs, reads the `CompanyId` out of each stored
`api_response`, and applies the same two steps the live sync now performs:
the company Customer is resolved or created, then the person's Customer is
created and linked to it.

Logs without a `CompanyId` are ignored -- the field is optional and the vast
majority of tokens are walk-ins, whose Customer is the person already.

Re-running is safe: an existing company or an already linked person is left
alone.
"""

import json

import frappe
from frappe.utils import cint

from digitz_erp.api.token_sync import (
	TokenSkipped,
	ensure_person_customer,
	get_or_create_company_customer,
)


def run(dry_run=0, limit=None):
	"""Create and link company/person customers for historical logs.

	:param dry_run: report what would happen without writing.
	:param limit: process at most this many logs, oldest first.
	"""
	dry_run = cint(dry_run)

	logs = frappe.get_all(
		"Medical Service Logs",
		fields=["name", "customer_name", "api_response"],
		order_by="added_on asc",
		limit=cint(limit) or None,
	)

	scanned = 0
	companies_created, people_linked, problems = [], [], []
	seen_companies = {}

	for log in logs:
		item = read_item(log.api_response)

		if item is None:
			continue

		company_id = item.get("CompanyId")

		# Optional field: no company means the person is already the customer.
		if company_id in (None, "", 0) or not cint(company_id):
			continue

		scanned += 1
		company_id = cint(company_id)

		try:
			if company_id in seen_companies:
				company = seen_companies[company_id]
			else:
				company = frappe.db.get_value("Customer", {"company_id": company_id}, "name")

				if not company:
					if dry_run:
						company = f"Company {company_id}"
					else:
						company = get_or_create_company_customer(company_id)

					companies_created.append(company)

				seen_companies[company_id] = company

			person = (item.get("Name") or "").strip()

			if not person:
				continue

			existing = frappe.db.get_value(
				"Customer", {"customer_name": person}, ["name", "company_customer"], as_dict=True
			)

			if existing and existing.company_customer:
				continue

			if not dry_run:
				ensure_person_customer(item, company)

			people_linked.append((person, company))
		except TokenSkipped as skip:
			problems.append((log.name, str(skip)))
		except Exception:
			frappe.log_error(
				message=frappe.get_traceback(),
				title=f"Company customer backfill failed for {log.name}",
			)
			problems.append((log.name, frappe.get_traceback(with_context=False).strip().splitlines()[-1]))

	if not dry_run:
		frappe.db.commit()

	report(len(logs), scanned, companies_created, people_linked, problems, dry_run)

	return {
		"logs": len(logs),
		"with_company": scanned,
		"companies_created": companies_created,
		"people_linked": [p for p, _ in people_linked],
		"problems": problems,
		"dry_run": bool(dry_run),
	}


def read_item(api_response):
	"""The stored token payload, or None when it cannot be read."""
	try:
		item = json.loads(api_response or "{}")
	except (ValueError, TypeError):
		return None

	return item if isinstance(item, dict) and item else None


def report(total, scanned, companies_created, people_linked, problems, dry_run):
	prefix = "[dry run] would create/link" if dry_run else "created/linked"

	print("\nCompany customer backfill")
	print(f"  logs scanned     : {total}")
	print(f"  with a CompanyId : {scanned}")
	print(f"  {prefix:<26} :")
	print(f"    companies      : {len(companies_created)}")
	print(f"    people         : {len(people_linked)}")
	print(f"  problems         : {len(problems)}")

	for company in companies_created:
		print(f"    + company {company}")

	for person, company in people_linked:
		print(f"    ~ {person} -> {company}")

	for name, reason in problems:
		print(f"    ! {name}: {reason}")
