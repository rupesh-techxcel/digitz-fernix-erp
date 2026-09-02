# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""Brand images, applied from the app rather than from site data.

The logo ships inside the app at `digitz_erp/public/images/`, which Frappe
serves from `/assets/digitz_erp/images/`. That matters: a logo uploaded through
the UI becomes a File record plus a blob under the *site's* files directory, and
neither travels with the app. A site restored from a database backup without the
files tarball ends up with the settings still pointing at paths that 404 -- which
is exactly the state this site was found in.

Serving the logo as an app asset means every install and every migration gets a
working logo with nothing to copy across.
"""

import frappe

LOGO_URL = "/assets/digitz_erp/images/weqayati-logo.png"

# Website Settings.app_name -- the product name shown in the browser tab, on the
# login page and in outgoing email subjects. The logo is the client's; the
# product name is ours.
APP_NAME = "Fernix ERP"

# Values that mean "nobody has set this yet", so adopting the name over them is
# safe on an ordinary migration.
UNSET_APP_NAMES = (None, "", "Frappe", "Frappe Framework")

# Website Settings fields and the surface each one drives:
#   app_logo     -> desk navbar (via boot.app_logo_url) and the login page
#   splash_image -> the splash shown while the desk boots
#   banner_image -> the website/home page brand
BRANDING_FIELDS = ("app_logo", "splash_image", "banner_image")


def apply_branding(force=False):
	"""Point the branding fields at the bundled logo.

	Idempotent. By default a field is only written when it is empty or still
	points at a file that no longer exists, so an administrator who has
	deliberately set their own logo is not overridden on every migration.
	Pass force=True to reset all three regardless.
	"""
	settings = frappe.get_single("Website Settings")
	changed = []

	for field in BRANDING_FIELDS:
		current = settings.get(field)

		if not force and current and not is_broken(current):
			continue

		if current == LOGO_URL:
			continue

		settings.set(field, LOGO_URL)
		changed.append(field)

	if not changed:
		return []

	settings.flags.ignore_permissions = True
	settings.save(ignore_permissions=True)

	# get_app_logo() caches, and the navbar reads it out of bootinfo.
	frappe.clear_cache()

	return changed


def is_broken(file_url):
	"""True when a stored branding URL points at something that is not there.

	Covers the common case of a database restored without its files: the
	setting still holds `/files/whatever.png` but the blob is gone, so the
	navbar renders a broken image. An `/assets/...` path is served from the app
	and is always considered present.
	"""
	if not file_url or not isinstance(file_url, str):
		return True

	if file_url.startswith("/assets/"):
		return False

	if file_url.startswith("/files/"):
		path = frappe.get_site_path("public", "files", file_url.split("/files/", 1)[1])
	elif file_url.startswith("/private/files/"):
		# Private files are unreadable for the anonymous visitors who see the
		# login page and the splash, so these count as broken here regardless.
		return True
	else:
		return False

	import os

	return not os.path.exists(path)


def apply_app_name(force=False):
	"""Set Website Settings.app_name to the product name.

	Idempotent. By default it only writes over a value nobody chose (see
	UNSET_APP_NAMES), so a site that has deliberately renamed itself is not
	reset on every migration. Pass force=True to set it regardless.
	"""
	current = frappe.db.get_single_value("Website Settings", "app_name")

	if current == APP_NAME:
		return False

	if not force and current not in UNSET_APP_NAMES:
		return False

	settings = frappe.get_single("Website Settings")
	settings.app_name = APP_NAME
	settings.flags.ignore_permissions = True
	settings.save(ignore_permissions=True)

	# app_name reaches the browser through bootinfo, which is cached.
	frappe.clear_cache()

	return True
