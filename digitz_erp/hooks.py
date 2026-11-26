from . import __version__ as app_version

app_name = "digitz_erp"
app_title = "Digitz ERP"
app_version = "1.0.0"
app_publisher = "Techxcel Technologies"
app_description = "A Frappe-based ERP solution tailored for SMEs in Services, Contracting, and Trading industries."
app_email = "rupesh@techxceltech.com"
app_license = "MIT"

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# Bundled (not a raw /assets path) so esbuild fingerprints the file and a
# change reaches browsers immediately instead of waiting out a 12 hour cache.
app_include_css = ["digitz_desk.bundle.css"]

# include js, css files in header of web template
# web_include_css = "/assets/digitz_erp/css/digitz_erp.css"
# web_include_js = "/assets/digitz_erp/js/digitz_erp.js"
# Framework fallback for the desk navbar and the login page, used whenever
# Website Settings has no app_logo. Shipping it as an app asset means a fresh
# install is branded before any patch or upload has run.
app_logo_url = "/assets/digitz_erp/images/weqayati-logo.png"

app_include_js = [
	"/assets/digitz_erp/js/digitz_common.js",
	"/assets/digitz_erp/js/token_notifications.js",
	# A bundle, so each build gets a new file name and browsers never keep a stale copy
	"counter_device.bundle.js",
	# The Sales Invoice rules, shared by the form and the Cashier Console's invoice editor
	"sales_invoice.bundle.js",
]

# The Help Center page (digitz_erp/help) in the navbar Help menu of new sites;
# existing sites get it from patches/v1_0/add_help_center_to_navbar.py
standard_help_items = [
	{"item_label": "Help Center", "item_type": "Route", "route": "/app/digitz-help"},
]

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "digitz_erp/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
# doctype_js =  {"Item": "public/js/item_restrictions.js"}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# Role list opens on the enabled roles (the unused ones are disabled by api/role_visibility.py)
doctype_list_js = {"Role": "public/js/role_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}
# No fixtures: Frappe re-imports them with force on every migrate, overwriting a
# live site's own settings (its permissions above all). The setup records are in
# install_data and imported only on a fresh install (api/install_setup.py).
# Home Pages
# ----------

# application home page (will override Website Settings)




# website user home page (by Role)
# role_home_page = {
#	"Role": "home_page"
# }
on_login = "digitz_erp.notifications.send_notification.login_notification"
# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
#	"methods": "digitz_erp.utils.jinja_methods",
#	"filters": "digitz_erp.utils.jinja_filters"
# }
jinja = {
	# The Day Close Slip prints the day's figures for supervisors only
	"methods": [
		"digitz_erp.api.counter_api.is_supervisor",
		"digitz_erp.api.counter_session_api.get_slip_payment_rows",
		"digitz_erp.api.counter_session_api.get_slip_close",
	],
}

# Installation
# ------------

# before_install = "digitz_erp.install.before_install"
after_install = "digitz_erp.api.install_api.after_install"
# A migrate changes no permission, role or setup record. It only keeps
# Settings > Token URL safe after a database is copied between sites (a live site
# never polls the test token feed).
after_migrate = [
	"digitz_erp.api.token_simulator.update_token_url_after_migrate",
]

# Fresh install only (after after_install): the setup records from install_data,
# then the Cashier rights on top of them, then the unused roles hidden
after_sync = [
	"digitz_erp.api.install_setup.import_install_data",
	"digitz_erp.api.cashier_permissions.apply",
	"digitz_erp.api.role_visibility.apply",
]

# Uninstallation
# ------------

# before_uninstall = "digitz_erp.uninstall.before_uninstall"
# after_uninstall = "digitz_erp.uninstall.after_uninstall"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "digitz_erp.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways
permission_query_conditions = {
    "Sales Invoice": "digitz_erp.api.sales_invoice_api.get_sales_invoice_permission_query",
    "Medical Service Logs": "digitz_erp.api.medical_services.get_medical_service_logs_permission_query",
	
}

# permission_query_conditions = {
#	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# Cashiers add and edit Customers, and only pick Items (api/cashier_permissions.py RULES)

# DocType Class
# ---------------
# Override standard doctype classes

# override_doctype_class = {
#	"ToDo": "custom_app.overrides.CustomToDo"
# }

# Document Events
# ---------------
# Hook on document methods and events

# doc_events = {
#	"*": {
#		"on_update": "method",
#		"on_cancel": "method",
#		"on_trash": "method"
#	}
# }

doc_events = {
	"User": {
		# Cashiers are held to one login at a time
		"validate": "digitz_erp.api.session_policy.enforce_on_user",
	},
}

# Scheduled Tasks
# ---------------

scheduler_events = {
	# "all": [
	# 	"digitz_erp.api.stock_update.re_post_stock_ledgers"
	# ],
	"daily": [
		"digitz_erp.tasks.cleanup_old_print_pdf_attachments"
	],
	"hourly": [
		"digitz_erp.api.scheduler_api.post_depreciation_for_depreciation_schedulers",
		"digitz_erp.tasks.re_post_stock_ledgers"
	],
	"cron": {
		# Pulls medical tokens and raises Sales Invoices. Replaces the browser
		# driven loop that used to run in the Sales Invoice Board page.
		# Every 20 seconds: the sixth field is seconds (croniter). Needs
		# "scheduler_tick_interval" of 10 in common_site_config.json, or the
		# scheduler only checks once a minute and the job runs once a minute.
		"* * * * * */20": [
			"digitz_erp.api.token_sync.enqueue_medical_token_sync"
		],
		# Drafts more than 48 hours old move to Archived Sales Invoice, at 02:00
		# in the site's time zone, when no counter is busy
		"0 2 * * *": [
			"digitz_erp.api.draft_archive.archive_stale_drafts"
		]
	}
	# "weekly": [
	# 	"digitz_erp.tasks.weekly"
	# ],
	# "monthly": [
	# 	"digitz_erp.tasks.monthly"
	# ],
}

# Testing
# -------

# before_tests = "digitz_erp.install.before_tests"

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
#	"frappe.desk.doctype.event.event.get_events": "digitz_erp.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
#	"Task": "digitz_erp.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]


# User Data Protection
# --------------------

# user_data_fields = [
#	{
#		"doctype": "{doctype_1}",
#		"filter_by": "{filter_by}",
#		"redact_fields": ["{field_1}", "{field_2}"],
#		"partial": 1,
#	},
#	{
#		"doctype": "{doctype_2}",
#		"filter_by": "{filter_by}",
#		"partial": 1,
#	},
#	{
#		"doctype": "{doctype_3}",
#		"strict": False,
#	},
#	{
#		"doctype": "{doctype_4}"
#	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
#	"digitz_erp.auth.validate"
# ]
