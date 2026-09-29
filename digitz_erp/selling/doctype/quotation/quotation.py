# Copyright (c) 2023, Rupesh P and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from digitz_erp.api.quotation_api import check_references_created 
from frappe.utils import money_in_words
from fpdf import FPDF
from PyPDF2 import PdfReader, PdfWriter, Transformation
import io
from frappe.utils.print_format import get_pdf
from frappe.utils.jinja import render_template
import os
from PIL import Image

class Quotation(Document):

	def before_validate(self):
		if self.rounded_total>0:
			self.in_words = money_in_words(self.rounded_total, "AED")
   
		self.update_print_lines()
	def autoname(self):
		allow_edit_quotation_no = frappe.get_value("Company", self.company, "allow_edit_quotation_no")
		if self.quotation_no and allow_edit_quotation_no:
			self.name = self.quotation_no

	def on_update(self):
		generate_custom_invoice_pdf(self)
	def update_print_lines(self):
		if not self.items:  # Ensure there are items to process
			return

		grouped_items = {}

		# Step 1: Group items by item_group
		for item in self.items:
			item_group_name = item.item_group or "Ungrouped"
			grouped_items.setdefault(item_group_name, []).append(item)

		self.set("print_lines", [])  # Properly initialize the child table

		sl_no = 1  # Initialize serial number for groups

		print("Grouped Items:", grouped_items)

		for group, items in grouped_items.items():
      
			print("Processing Group:", group)
			print("items", items)

			# Add group header as the first row with serial number
			self.append("print_lines", {
				"sl_no": str(sl_no),
				"description": group,  # Group name as header
				"qty": "",  # No quantity for group header
				"rate": "",
				"gross_amount": "",
				"tax_amount": "",
				"net_amount": ""
			})
   
			


			# Add each item under the respective group
			sub_sl_no = 1  # Sub-serial number for items
			for item in items:
       
				item_sl_no = f"{sl_no}.{sub_sl_no}"  # Example: 1.1, 1.2, etc.

				self.append("print_lines", {
					"sl_no": item_sl_no,
					"description": item.display_name or "",
					"qty": item.qty or "",
					"rate": f"{item.rate:.2f}" if item.rate else "",
					"gross_amount": f"{item.gross_amount:.2f}" if item.gross_amount else "",
					"tax_amount": f"{item.tax_amount:.2f}" if item.tax_amount else "",
					"net_amount": f"{item.net_amount:.2f}" if item.net_amount else ""
            	})
    
				sub_sl_no += 1  # Increment sub-serial number

			sl_no += 1  # Increment main serial number for the next group
   
@frappe.whitelist()
def generate_quotation(self):

	quotation = frappe.new_doc('Quotation')

	quotation.customer = self.customer
	quotation.customer_name = self.customer_name
	quotation.customer_display_name = self.customer_display_name
	quotation.customer_address = self.customer_address        
	quotation.posting_date = self.posting_date
	quotation.posting_time = self.posting_time
	quotation.ship_to_location = self.ship_to_location
	quotation.salesman = self.salesman
	quotation.salesman_code = self.salesman_code
	quotation.tax_id = self.tax_id
	
	quotation.price_list = self.price_list
	quotation.rate_includes_tax = self.rate_includes_tax
	quotation.warehouse = self.warehouse        
	quotation.credit_sale = self.credit_sale
	quotation.credit_days = self.credit_days
	quotation.payment_terms = self.payment_terms
	quotation.payment_mode = self.payment_mode
	quotation.payment_account = self.payment_account
	quotation.remarks = self.remarks
	quotation.gross_total = self.gross_total
	quotation.total_discount_in_line_items = self.total_discount_in_line_items
	quotation.tax_total = self.tax_total
	quotation.net_total = self.net_total
	quotation.round_off = self.round_off
	quotation.rounded_total = self.rounded_total
	quotation.terms = self.terms
	quotation.terms_and_conditions = self.terms_and_conditions
	quotation.auto_generated_from_delivery_note = False
	quotation.address_line_1 = self.address_line_1
	quotation.address_line_2 = self.address_line_2
	quotation.area_name = self.area_name
	quotation.country = self.country
	quotation.company = self.company


	idx = 0

	for item in self.items:
		idx = idx + 1
		quotation_item = frappe.new_doc("Quotation Item")
		quotation_item.warehouse = item.warehouse
		quotation_item.item = item.item
		quotation_item.item_name = item.item_name
		quotation_item.display_name = item.display_name
		quotation_item.qty =item.qty
		quotation_item.unit = item.unit
		quotation_item.rate = item.rate
		quotation_item.base_unit = item.base_unit
		quotation_item.qty_in_base_unit = item.qty_in_base_unit
		quotation_item.rate_in_base_unit = item.rate_in_base_unit
		quotation_item.conversion_factor = item.conversion_factor
		quotation_item.rate_includes_tax = item.rate_includes_tax
		quotation_item.rate_excluded_tax = item.rate_excluded_tax
		quotation_item.gross_amount = item.gross_amount
		quotation_item.tax_excluded = item.tax_excluded
		quotation_item.tax = item.tax
		quotation_item.tax_rate = item.tax_rate
		quotation_item.tax_amount = item.tax_amount
		quotation_item.discount_percentage = item.discount_percentage
		quotation_item.discount_amount = item.discount_amount
		quotation_item.net_amount = item.net_amount
		quotation_item.unit_conversion_details = item.unit_conversion_details
		quotation_item.idx = idx

		quotation.append('items', quotation_item)            

	quotation.save()

	frappe.msgprint("Quotation duplicated successfully.",indicator="green", alert=True)
	
	return quotation.name



@frappe.whitelist()
def generate_sale_invoice(quotation):

	check_references_created(quotation)
	quotation_doc = frappe.get_doc('Quotation',quotation)
	sales_invoice_doc = frappe.new_doc('Sales Invoice')
	sales_invoice_doc.company = quotation_doc.company		
	sales_invoice_doc.customer = quotation_doc.customer
	sales_invoice_doc.customer_name = quotation_doc.customer_name
	sales_invoice_doc.customer_display_name = quotation_doc.customer_display_name
	sales_invoice_doc.customer_address = quotation_doc.customer_address
	sales_invoice_doc.reference_no = quotation_doc.reference_no
	sales_invoice_doc.posting_date = quotation_doc.posting_date
	sales_invoice_doc.posting_time = quotation_doc.posting_time
	sales_invoice_doc.ship_to_location = quotation_doc.ship_to_location
	sales_invoice_doc.salesman = quotation_doc.salesman
	# sales_invoice_doc.salesman_code = quotation_doc.salesman_code
	sales_invoice_doc.tax_id = quotation_doc.tax_id
	sales_invoice_doc.lpo_no = None
	sales_invoice_doc.lpo_date = None
	sales_invoice_doc.price_list = quotation_doc.price_list
	sales_invoice_doc.rate_includes_tax = quotation_doc.rate_includes_tax
	sales_invoice_doc.warehouse = quotation_doc.warehouse
	sales_invoice_doc.credit_sale = quotation_doc.credit_sale
	sales_invoice_doc.credit_days = quotation_doc.credit_days
	sales_invoice_doc.payment_terms = quotation_doc.payment_terms
	sales_invoice_doc.payment_mode = quotation_doc.payment_mode
	sales_invoice_doc.payment_account = quotation_doc.payment_account
	sales_invoice_doc.remarks = quotation_doc.remarks
	sales_invoice_doc.gross_total = quotation_doc.gross_total
	sales_invoice_doc.total_discount_in_line_items = quotation_doc.total_discount_in_line_items
	sales_invoice_doc.tax_total = quotation_doc.tax_total
	sales_invoice_doc.net_total = quotation_doc.net_total
	sales_invoice_doc.round_off = quotation_doc.round_off
	sales_invoice_doc.rounded_total = quotation_doc.rounded_total
	sales_invoice_doc.terms = quotation_doc.terms
	sales_invoice_doc.terms_and_conditions = quotation_doc.terms_and_conditions		
	# sales_invoice_doc.address_line_1 = quotation_doc.address_line_1
	# sales_invoice_doc.address_line_2 = quotation_doc.address_line_2
	# sales_invoice_doc.area_name = quotation_doc.area_name
	# sales_invoice_doc.country = quotation_doc.country
 
	sales_invoice_doc.quotation = quotation_doc.name

	idx = 0

	for item in quotation_doc.items:
		idx = idx + 1
		delivery_note_item = frappe.new_doc("Sales Invoice Item")
		delivery_note_item.warehouse = item.warehouse
		delivery_note_item.item = item.item
		delivery_note_item.item_name = item.item_name
		delivery_note_item.display_name = item.display_name
		delivery_note_item.qty =item.qty
		delivery_note_item.unit = item.unit
		delivery_note_item.rate = item.rate
		delivery_note_item.base_unit = item.base_unit
		delivery_note_item.qty_in_base_unit = item.qty_in_base_unit
		delivery_note_item.rate_in_base_unit = item.rate_in_base_unit
		delivery_note_item.conversion_factor = item.conversion_factor
		delivery_note_item.rate_includes_tax = item.rate_includes_tax
		delivery_note_item.rate_excluded_tax = item.rate_excluded_tax
		delivery_note_item.gross_amount = item.gross_amount
		delivery_note_item.tax_excluded = item.tax_excluded
		delivery_note_item.tax = item.tax
		delivery_note_item.tax_rate = item.tax_rate
		delivery_note_item.tax_amount = item.tax_amount
		delivery_note_item.discount_percentage = item.discount_percentage
		delivery_note_item.discount_amount = item.discount_amount
		delivery_note_item.net_amount = item.net_amount
		delivery_note_item.unit_conversion_details = item.unit_conversion_details
		delivery_note_item.idx = idx
		delivery_note_item.quotation_item_reference_no = item.name

		sales_invoice_doc.append('items', delivery_note_item )
		#  target_items.append(target_item)

	# Not paid yet: the Received Amount of a cash sale is asked for when it is first saved
	sales_invoice_doc.flags.received_amount_later = True
	sales_invoice_doc.insert()
	frappe.msgprint("Sales Invoice successfully created in draft mode.", indicator="green",alert
				=True)
	return sales_invoice_doc.name

@frappe.whitelist()
def generate_delivery_note(quotation):

	check_references_created(quotation)
	quotation_doc = frappe.get_doc('Quotation',quotation)
	delivery_note_doc = frappe.new_doc('Delivery Note')
	delivery_note_doc.company = quotation_doc.company		
	delivery_note_doc.customer = quotation_doc.customer
	delivery_note_doc.customer_name = quotation_doc.customer_name
	delivery_note_doc.customer_display_name = quotation_doc.customer_display_name
	delivery_note_doc.customer_address = quotation_doc.customer_address
	delivery_note_doc.reference_no = quotation_doc.reference_no
	delivery_note_doc.posting_date = quotation_doc.posting_date
	delivery_note_doc.posting_time = quotation_doc.posting_time
	delivery_note_doc.ship_to_location = quotation_doc.ship_to_location
	delivery_note_doc.salesman = quotation_doc.salesman
	# delivery_note_doc.salesman_code = quotation_doc.salesman_code
	delivery_note_doc.tax_id = quotation_doc.tax_id
	delivery_note_doc.lpo_no = None
	delivery_note_doc.lpo_date = None
	delivery_note_doc.price_list = quotation_doc.price_list
	delivery_note_doc.rate_includes_tax = quotation_doc.rate_includes_tax
	delivery_note_doc.warehouse = quotation_doc.warehouse
	delivery_note_doc.credit_sale = quotation_doc.credit_sale
	delivery_note_doc.credit_days = quotation_doc.credit_days
	delivery_note_doc.payment_terms = quotation_doc.payment_terms
	delivery_note_doc.payment_mode = quotation_doc.payment_mode
	delivery_note_doc.payment_account = quotation_doc.payment_account
	delivery_note_doc.remarks = quotation_doc.remarks
	delivery_note_doc.gross_total = quotation_doc.gross_total
	delivery_note_doc.total_discount_in_line_items = quotation_doc.total_discount_in_line_items
	delivery_note_doc.tax_total = quotation_doc.tax_total
	delivery_note_doc.net_total = quotation_doc.net_total
	delivery_note_doc.round_off = quotation_doc.round_off
	delivery_note_doc.rounded_total = quotation_doc.rounded_total
	delivery_note_doc.terms = quotation_doc.terms
	delivery_note_doc.terms_and_conditions = quotation_doc.terms_and_conditions		
	# delivery_note_doc.address_line_1 = quotation_doc.address_line_1
	# delivery_note_doc.address_line_2 = quotation_doc.address_line_2
	# delivery_note_doc.area_name = quotation_doc.area_name
	# delivery_note_doc.country = quotation_doc.country
	delivery_note_doc.quotation = quotation_doc.name


	idx = 0

	for item in quotation_doc.items:
		idx = idx + 1
		delivery_note_item = frappe.new_doc("Delivery Note Item")
		delivery_note_item.warehouse = item.warehouse
		delivery_note_item.item = item.item
		delivery_note_item.item_name = item.item_name
		delivery_note_item.display_name = item.display_name
		delivery_note_item.qty =item.qty
		delivery_note_item.unit = item.unit
		delivery_note_item.rate = item.rate
		delivery_note_item.base_unit = item.base_unit
		delivery_note_item.qty_in_base_unit = item.qty_in_base_unit
		delivery_note_item.rate_in_base_unit = item.rate_in_base_unit
		delivery_note_item.conversion_factor = item.conversion_factor
		delivery_note_item.rate_includes_tax = item.rate_includes_tax
		delivery_note_item.rate_excluded_tax = item.rate_excluded_tax
		delivery_note_item.gross_amount = item.gross_amount
		delivery_note_item.tax_excluded = item.tax_excluded
		delivery_note_item.tax = item.tax
		delivery_note_item.tax_rate = item.tax_rate
		delivery_note_item.tax_amount = item.tax_amount
		delivery_note_item.discount_percentage = item.discount_percentage
		delivery_note_item.discount_amount = item.discount_amount
		delivery_note_item.net_amount = item.net_amount
		delivery_note_item.unit_conversion_details = item.unit_conversion_details
		delivery_note_item.idx = idx
		delivery_note_item.quotation_item_reference_no = item.name

		delivery_note_doc.append('items', delivery_note_item )
		#  target_items.append(target_item)

	delivery_note_doc.insert()
	frappe.msgprint("Delivery Note successfully created in draft mode.", indicator="green",alert
				=True)
	return delivery_note_doc.name

@frappe.whitelist()
def generate_sales_order(quotation):
	quotation_doc = frappe.get_doc('Quotation', quotation)
	
	# Create a copy of the Quotation doc fields into a new Sales Order dictionary
	sales_order = quotation_doc.as_dict()  # Use as_dict to get a clean dictionary representation
	# Function to check if references are already created (assumed to be a custom function)
	check_references_created(quotation)
	customer = ""    

	if quotation_doc.lead_from == "Prospect":        
		customer = frappe.get_doc("Customer",{"prospect": quotation_doc.prospect})
		sales_order.customer = customer

	sales_order['doctype'] = 'Sales Order'
	sales_order['naming_series'] = ""
	sales_order['posting_date'] = quotation_doc.posting_date
	sales_order['posting_time'] = quotation_doc.posting_time
	sales_order["quotation"] = quotation_doc.name

	# Handling project fields with fallback to None
	sales_order['project_name_from_boq'] = quotation_doc.get('project_name', None)
	sales_order['project_short_name_from_boq'] = quotation_doc.get('project_short_name', None)

	# Set document status to draft
	sales_order['docstatus'] = 0

	# Adjusting each item in the items list
	for item in sales_order['items']:
		item['doctype'] = "Sales Order Item"
		item['quotation_item_reference_no'] = item['name']
		item['_meta'] = ""  # Clean meta data

	# Insert the new Sales Order into the database
	new_so = frappe.get_doc(sales_order).insert()
	frappe.db.commit()

	# Notify the user about the successful creation
	frappe.msgprint("Sales Order successfully created in draft mode.", indicator="green", alert=True)

	return new_so.name

def generate_custom_invoice_pdf(doc, template_override=None, file_suffix_override=None):
	"""Render `doc` to a PDF and attach it.

	`template_override` / `file_suffix_override` let the same pipeline -- context,
	header/footer overlay, page transform -- produce a second document for the
	same record, which is how the RECEIPT for a non credit Sales Invoice is
	made. Left unset, behaviour is unchanged.
	"""
	import io, os
	from PyPDF2 import PdfReader, PdfWriter, Transformation
	from PIL import Image
	from frappe.utils import formatdate, money_in_words
	from frappe.utils.pdf import get_pdf
	from frappe.utils.jinja import render_template
	import frappe

	company_doc = frappe.get_doc("Company", doc.company)
	

	# Initialize variables
	customer_address = ""
	customer_name = ""
	supplier_address = ""
	supplier_name = ""
	trn_no = ""
	party_trn_no = ""
	terms_and_conditions = ""
	lpo_no = ""
	payment_terms = ""
	receipt_number = ""
	receipt_info = None
	file_suffix = "document"

	# Doctype-specific logic
	if doc.doctype == "Delivery Note":
		customer_address = doc.customer_address
		customer_name = doc.customer
		lpo_no = doc.lpo_no or ""
		file_suffix = "delivery_note"
		terms_and_conditions = doc.terms_and_conditions
		party_trn_no = doc.tax_id

	elif doc.doctype == "Quotation":
		customer_address = doc.customer_address  
		customer_name = doc.prospect if doc.lead_from == "Prospect" else doc.customer_name
		terms_and_conditions = doc.terms_and_conditions
		file_suffix = "quotation"
		party_trn_no = doc.tax_id  

	elif doc.doctype == "Sales Invoice":
		customer_address = doc.customer_address
		party_trn_no = doc.tax_id
		customer_name = doc.customer_name
		lpo_no = doc.lpo_no or ""
		file_suffix = "invoice"
		terms_and_conditions = doc.terms_and_conditions
		payment_terms = doc.payment_terms or ""
		trn_no = frappe.db.get_value("Company", doc.company, "tax_id")
		receipt_info = get_sales_invoice_receipt_info(doc)
		receipt_number = receipt_info.number if receipt_info else ""

	elif doc.doctype == "Purchase Order":
		supplier_name = doc.supplier
		supplier_address = doc.supplier_address or ""
		trn_no = doc.tax_id or ""
		terms_and_conditions = doc.terms
		file_suffix = "purchase_order"
		party_trn_no = doc.tax_id
	
	# Final context
	context = {
		"doc": doc,
		
		"quotation_name": doc.name,
		"date": formatdate(getattr(doc, "posting_date", doc.get("transaction_date")), "dd-mm-yyyy"),
		"items": doc.items,
		"customer_address": customer_address,
		"customer_name": customer_name,
		"supplier_address": supplier_address,
		"supplier_name": supplier_name,
		"supplier_trn": trn_no,
		"trn_no": trn_no,
		"terms_and_conditions": (terms_and_conditions or "").strip(),
		"lpo_no": lpo_no,
		"payment_terms": payment_terms,
		"receipt_number": receipt_number,
		"receipt_info": receipt_info,
		"party_trn_no": party_trn_no,
		# The templates' own top padding. Header clearance now comes from the page
		# margin below, which repeats on every page; padding only cleared page one,
		# so the header covered the top of every page after it.
		"total_pixels": 0,
	}

	# Template selection
	template_path = (
		"digitz_erp/templates/delivery_template.html"
		if doc.doctype == "Delivery Note"
		else "digitz_erp/templates/sales_invoice_template.html"
		if doc.doctype == "Sales Invoice"
		else "digitz_erp/templates/purchase_order_template.html"
		if doc.doctype == "Purchase Order"
		else "digitz_erp/templates/quotation_template.html"
	)

	if template_override:
		template_path = template_override

	if file_suffix_override:
		file_suffix = file_suffix_override

	html = render_template(template_path, context)

	# Check if header/footer images are set and exist
	site_path = frappe.get_site_path("public")

	header_image_path = os.path.join(site_path, (company_doc.header_image or "").strip("/"))
	footer_image_path = os.path.join(site_path, (company_doc.footer_image or "").strip("/"))

	has_header = company_doc.header_image and os.path.exists(header_image_path)
	has_footer = company_doc.footer_image and os.path.exists(footer_image_path)

	# The header and footer images are stamped over the rendered pages, so the page
	# margins keep that space clear on every page: the header's full height at the
	# top, and at the bottom the footer plus the line "Page X of Y" sits on.
	footer_height_pt = get_footer_size_pt(footer_image_path, A4_WIDTH_PT)[1] if has_footer else 0
	page_number_bottom_pt = footer_height_pt + 8
	margin_top_pt = (get_header_height_pt(header_image_path, A4_WIDTH_PT) if has_header else 0) + 12
	margin_bottom_pt = max(page_number_bottom_pt + 22, 99)  # 99pt = the 35mm this used before

	# frappe.utils.pdf.get_pdf forces margin-top/bottom to 15mm when the HTML has no
	# #header-html / #footer-html block, overriding `options`. It does honour a
	# `.print-format { margin-... }` rule in the page itself, applied after that, so
	# the vertical margins are set there.
	margin_css = (
		f"<style>.print-format {{ margin-top: {margin_top_pt * PT_TO_MM:.1f}mm; "
		f"margin-bottom: {margin_bottom_pt * PT_TO_MM:.1f}mm; }}</style>"
	)
	html = html.replace("</head>", margin_css + "</head>", 1) if "</head>" in html else margin_css + html

	options = {
		"page-size": "A4",
		"margin-left": "5mm",
		"margin-right": "5mm",
	}

	# Render HTML to PDF
	pdf = get_pdf(html, options)
	pdf_buffer = io.BytesIO(pdf)
	original_pdf = PdfReader(pdf_buffer)
	output_pdf = PdfWriter()

	# Page numbers go only on multi page documents, in the blank strip the bottom
	# margin leaves, lifted clear of the footer image the last page carries.
	total_pages = len(original_pdf.pages)

	for i, page in enumerate(original_pdf.pages):
		overlay_pdf = None
		if has_header and has_footer and i == len(original_pdf.pages) - 1:
			overlay_pdf = create_header_footer_pdf(float(page.mediabox.width), float(page.mediabox.height), company_doc)
		elif has_header:
			overlay_pdf = create_header_pdf(float(page.mediabox.width), float(page.mediabox.height), company_doc)

		if overlay_pdf:
			page.merge_page(overlay_pdf.pages[0])

		if total_pages > 1:
			page_number_pdf = create_page_number_pdf(float(page.mediabox.width), float(page.mediabox.height),
				f"Page {i + 1} of {total_pages}", page_number_bottom_pt)
			page.merge_page(page_number_pdf.pages[0])

		output_pdf.add_page(page)

	# Write final PDF
	output_stream = io.BytesIO()
	output_pdf.write(output_stream)

	from frappe.utils.file_manager import save_file

	file_name = f"{doc.name}-{file_suffix}.pdf"

	# Match on the file name, not just the document: an invoice and its receipt
	# are both attached to the same record, and deleting "the first attachment"
	# would let one wipe the other. The LIKE catches the hashed variants
	# save_file produces when a name is already taken.
	stale = frappe.get_all(
		"File",
		filters={
			"attached_to_doctype": doc.doctype,
			"attached_to_name": doc.name,
			"file_name": ["like", f"{doc.name}-{file_suffix}%"],
		},
		pluck="name",
	)
	for name in stale:
		frappe.get_doc("File", name).delete()

	save_file(
		fname=file_name,
		content=output_stream.getvalue(),
		dt=doc.doctype,
		dn=doc.name,
		folder="Home/Attachments",
		is_private=0
	)

	frappe.msgprint(f"Print format attached to the document as <b>{file_name}</b>.", alert=True)


def get_sales_invoice_receipt_info(doc):
	"""What the invoice's RECEIPT INFO block and its receipt PDF show, or None.

	A cash sale is settled at the counter, so the invoice is its own receipt,
	numbered RCPT-<invoice no> (SI-00016-09-2026 -> RCPT-00016-09-2026; a hand
	keyed number without the SI- prefix just gets RCPT- in front).

	A credit sale is paid later by a Receipt Entry, often raised by someone else.
	Once that receipt is submitted, ReceiptEntry.refresh_credit_invoice_prints
	records its name in `allocated_receipt_entry` (a plain Data field, not a Link,
	so the two documents do not link to each other), and the receipt's own
	number, date, payment details and creator are shown, with the amount it
	allocated to this invoice.
	"""
	from frappe.utils import formatdate, flt

	def username(user):
		return frappe.db.get_value("User", user, "username") or user

	if not doc.credit_sale:
		return frappe._dict(
			number="RCPT-" + (doc.name[3:] if doc.name.startswith("SI-") else doc.name),
			amount=flt(doc.paid_amount or doc.rounded_total),
			date=formatdate(doc.posting_date, "dd-mm-yyyy"),
			collected_by=username(doc.owner),
			payment_mode=doc.payment_mode or "",
			reference_no=doc.reference_no or "",
		)

	if not doc.get("allocated_receipt_entry"):
		return None

	receipt = frappe.db.get_value("Receipt Entry", doc.allocated_receipt_entry,
		["name", "docstatus", "posting_date", "payment_mode", "reference_no", "owner"], as_dict=True)
	if not receipt or receipt.docstatus != 1:
		return None

	amount = frappe.db.get_value("Receipt Allocation",
		{"parent": receipt.name, "reference_type": "Sales Invoice", "reference_name": doc.name}, "sum(paying_amount)")

	return frappe._dict(
		number=receipt.name,
		amount=flt(amount),
		date=formatdate(receipt.posting_date, "dd-mm-yyyy"),
		collected_by=username(receipt.owner),
		payment_mode=receipt.payment_mode or "",
		reference_no=receipt.reference_no or "",
	)


# --- Header and Footer PDF classes ---

class HeaderPDF(FPDF):
	def header(self):
		absolute_path = os.path.join(frappe.get_site_path("public"), self.header_image.strip("/"))
		self.image(absolute_path, x=0, y=0, w=self.w)

	def get_company_details(self, company_doc):	
		self.header_image = company_doc.header_image or ""


class HeaderFooterPDF(FPDF):
	def header(self):
		absolute_path = os.path.join(frappe.get_site_path("public"), self.header_image.strip("/"))
		self.image(absolute_path, x=0, y=0, w=self.w)

	def footer(self):
		absolute_path = os.path.join(frappe.get_site_path("public"), self.footer_image.strip("/"))
		width_pt, height_pt = get_footer_size_pt(absolute_path, self.w)

		# Centred at the bottom edge, in the image's own proportions
		self.image(absolute_path, x=(self.w - width_pt) / 2, y=self.h - height_pt, w=width_pt, h=height_pt)

	def get_company_details(self, company_doc):	
		self.header_image = company_doc.header_image or ""
		self.footer_image = company_doc.footer_image or ""

# --- PDF Generator Utilities ---

A4_WIDTH_PT = 595.28
PT_TO_MM = 25.4 / 72

# Share of the footer image's natural height it is drawn at
FOOTER_SCALE = 0.45


def get_header_height_pt(header_image_path, page_width_pt):
	"""Height the header image is drawn at: it spans the page width in its own proportions."""
	img = Image.open(header_image_path)
	return page_width_pt * img.height / img.width


def get_footer_size_pt(footer_image_path, page_width_pt):
	"""(width, height) the footer image is drawn at, in points.

	FOOTER_SCALE of its natural height, keeping its proportions so it is not
	stretched across the page, and never wider than the page.
	"""
	img = Image.open(footer_image_path)
	dpi = img.info.get("dpi", (72, 72))[1] or 72
	height_pt = (img.height / dpi) * 72 * FOOTER_SCALE
	width_pt = height_pt * img.width / img.height

	if width_pt > page_width_pt:
		width_pt = page_width_pt
		height_pt = width_pt * img.height / img.width

	return width_pt, height_pt

def create_page_number_pdf(width, height, text, bottom_pt):
	"""A blank page carrying `text` centred `bottom_pt` above the bottom edge."""
	pdf = FPDF(unit="pt", format=(width, height))
	pdf.set_auto_page_break(False)
	pdf.add_page()
	pdf.set_font("Helvetica", size=9)
	pdf.set_text_color(80, 80, 80)
	pdf.set_xy(0, height - bottom_pt - 12)
	pdf.cell(width, 12, text, align="C")
	buffer = io.BytesIO(pdf.output(dest='S').encode('latin1'))
	buffer.seek(0)
	return PdfReader(buffer)

def create_header_pdf(width, height, company_doc):
	pdf = HeaderPDF(unit="pt", format=(width, height))
	pdf.get_company_details(company_doc)
	pdf.add_page()
	pdf_bytes = pdf.output(dest='S').encode('latin1')
	buffer = io.BytesIO(pdf_bytes)
	buffer.seek(0)
	return PdfReader(buffer)

def create_header_footer_pdf(width, height, company_doc):
	pdf = HeaderFooterPDF(unit="pt", format=(width, height))
	pdf.get_company_details(company_doc)
	pdf.add_page()
	pdf_bytes = pdf.output(dest='S').encode('latin1')
	buffer = io.BytesIO(pdf_bytes)
	buffer.seek(0)
	return PdfReader(buffer)
