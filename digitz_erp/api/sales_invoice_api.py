import frappe
from frappe.utils import get_datetime


@frappe.whitelist()
def get_allocations_for_invoice(sales_invoice_no, receipt_no):    
    if(receipt_no ==""):        
        return frappe.db.sql("""SELECT sales_invoice,parent,invoice_amount,paying_amount FROM `tabReceipt Allocation` ra inner join `tabSales Invoice` si ON si.name= ra.sales_invoice WHERE ra.sales_invoice = '{0}' AND (ra.docstatus= 1 or ra.docstatus=0) ORDER BY ra.sales_invoice """.format(sales_invoice_no),as_dict=1)    
    else:
        return frappe.db.sql("""SELECT sales_invoice,parent,invoice_amount,paying_amount FROM `tabReceipt Allocation` ra  join `tabSales Invoice` si ON si.name= ra.sales_invoice WHERE ra.sales_invoice = '{0}' AND parent!='{1}' AND (ra.docstatus= 1 or ra.docstatus=0) ORDER BY ra.sales_invoice """.format(sales_invoice_no,receipt_no),as_dict=1)

@frappe.whitelist()
def submit_sales_invoice(docname):    
    doc = frappe.get_doc('Sales Invoice',docname)    
    doc.submit()
    
@frappe.whitelist()
def get_sales_invoices_for_return(customer):
    """Submitted invoices for a customer that still have qty left to return.

    The pending test used to be `qty_returned_in_base_unit < qty_in_base_unit`. That
    silently returned nothing for most invoices: qty_in_base_unit was written by the
    client as `qty * conversion_factor`, and conversion_factor is 0 on the majority of
    historical rows, so the column holds 0 and `0 < 0` is false. Units are not used in
    this app - conversion_factor has only ever been 0 or 1, and wherever it is 1 the
    base-unit column already equals qty - so comparing against `qty` is equivalent for
    every row that was stored correctly and additionally rescues the ones that were not.
    """
    return frappe.db.sql("""
        SELECT DISTINCT si.name, si.customer, si.posting_date, si.rounded_total
        FROM `tabSales Invoice Item` sii
        INNER JOIN `tabSales Invoice` si ON si.name = sii.parent
        WHERE si.customer = %(customer)s
          AND si.docstatus = 1
          AND IFNULL(sii.qty_returned_in_base_unit, 0) < IFNULL(sii.qty, 0)
        ORDER BY si.posting_date DESC, si.name DESC
    """, {"customer": customer}, as_dict=1)

@frappe.whitelist()
def get_sales_line_items_for_return(sales_invoice):
    """The still-returnable lines of one invoice.

    Every conversion_factor term is gone. Units are not used in this app, and on rows
    where the factor is 0 the old expressions produced garbage: `rate * 0`, `com * 0`
    and `gov * 0` all collapsed to 0, and dividing by it made the outstanding qty NULL.
    Rate, COM and GOV are returned as stored, and the outstanding qty is simply
    qty - qty_returned. conversion_factor is reported as 1 so the caller's row is
    consistent with what the Sales Return form now writes.
    """
    return frappe.db.sql("""
        SELECT si.name AS si_item_reference,
               si.item, si.item_name, si.display_name,
               si.unit, si.base_unit,
               si.rate,
               -- Sales Return derives its line rate as COM + GOV, so the components
               -- handed back have to add up to what the invoice actually charged.
               -- `rate` is the arbiter: on every line checked it agrees with
               -- net_amount, whereas COM/GOV can disagree with both - some legacy
               -- lines have no components at all, and others carry a split that was
               -- back-filled from the Item master and does not match what was billed
               -- (e.g. rate 32.45 against COM+GOV of 387.00, which would refund more
               -- than ten times the amount charged).
               --
               -- So: keep the stored split when it reconciles with the rate, and
               -- otherwise fall back to the whole rate as COM. Either way
               -- COM + GOV = rate, and the return can never refund an amount the
               -- invoice did not charge.
               CASE WHEN ABS(si.rate - (IFNULL(si.com, 0) + IFNULL(si.gov, 0))) <= 0.005
                    THEN IFNULL(si.com, 0) ELSE si.rate END AS com,
               CASE WHEN ABS(si.rate - (IFNULL(si.com, 0) + IFNULL(si.gov, 0))) <= 0.005
                    THEN IFNULL(si.gov, 0) ELSE 0 END AS gov,
               si.qty - IFNULL(si.qty_returned_in_base_unit, 0) AS qty,
               si.qty - IFNULL(si.qty_returned_in_base_unit, 0) AS qty_in_base_unit,
               1 AS conversion_factor,
               si.rate AS rate_in_base_unit,
               si.tax, si.tax_rate, si.rate_includes_tax,
               si.tax_excluded, si.discount_amount, si.discount_percentage
        FROM `tabSales Invoice Item` si
        WHERE si.parent = %(sales_invoice)s
          AND IFNULL(si.qty_returned_in_base_unit, 0) < IFNULL(si.qty, 0)
        ORDER BY si.idx
    """, {"sales_invoice": sales_invoice}, as_dict=1)

@frappe.whitelist()
def get_pending_invoices_for_customer(customer):
    result = frappe.db.sql("""SELECT si.name as 'sales_invoice', si.posting_date as date, si.rounded_total as amount,si.paid_amount, si.rounded_total-si.paid_amount as balance_amount where si.customer='%s' and si.docstatus=1 and si.paid_amount< si.rounded_total""" .format(customer))
    return result


    
@frappe.whitelist()
def generate_sales_invoice_for_delivery_note(delivery_note: str):
    sales_invoice_name = ""
    doc = frappe.get_doc("Delivery Note",delivery_note)
    deliveryNoteName =  doc.name
    sales_invoice = doc.__dict__
    sales_invoice['doctype'] = 'Sales Invoice'
    sales_invoice['name'] = sales_invoice_name
    sales_invoice['naming_series'] = ""
    sales_invoice['posting_date'] = doc.posting_date
    sales_invoice['posting_time'] = doc.posting_time
    sales_invoice['delivery_notes_to_print'] =deliveryNoteName
    # Change the document status to draft to avoid error while submitting child table
    sales_invoice['docstatus'] = 0
    for item in sales_invoice['items']:
        item.doctype = "Sales Invoice Item"
        item.delivery_note_item_reference_no = item.name
        item._meta = ""

    sales_invoice_doc = frappe.get_doc(
        sales_invoice).insert(ignore_permissions=True)

    frappe.db.commit()

    #print(sales_invoice_doc.name)

    si =  frappe.get_doc('Sales Invoice',sales_invoice_doc.name)

    # Add reference link to the 'Sales Invoice Delivery NOtes' child doctype

    si.append('delivery_notes', {'delivery_note': deliveryNoteName})

    # si.docstatus = 1

    si.save()
    return {"si_name": si.name}







def get_sales_invoice_permission_query(user):
    if not user or user == "Administrator":
        return None  # Full access for Administrator

    roles = frappe.get_roles(user)

    # Cashier Approver supervises billing for the whole counter, so it sees
    # every invoice, not just its own. Checked before Cashier because an
    # approver usually holds both roles -- Cashier Approver alone reaches
    # nothing but Sales Invoice -- and the narrower role must not win.
    if "Cashier Approver" in roles:
        return None

    if "Cashier" not in roles:
        return None  # None = no filter, full access

    # Otherwise, restrict to only their own records
    return f"`tabSales Invoice`.owner = {frappe.db.escape(user)}"
