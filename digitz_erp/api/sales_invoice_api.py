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
    
    result = frappe.db.sql("""
        SELECT distinct si.name,si.customer,si.posting_date,si.rounded_total FROM `tabSales Invoice Item` sii inner join `tabSales Invoice` si on si.name=sii.parent where sii.qty_returned_in_base_unit < sii.qty_in_base_unit and  si.customer='{0}' and si.docstatus=1 """.format(customer), as_dict=1)
    
    return result

@frappe.whitelist()
def get_sales_line_items_for_return(sales_invoice):
    
    result = frappe.db.sql("""
                SELECT si.name as si_item_reference, si.item, si.item_name,si.display_name, si.unit,si.base_unit, si.rate * si.conversion_factor as rate, (si.qty_in_base_unit-si.qty_returned_in_base_unit)/si.conversion_factor as qty,si.qty_in_base_unit,si.conversion_factor, si.rate_in_base_unit, si.tax, si.tax_rate, rate_includes_tax from `tabSales Invoice Item` si where si.parent ='{0}' and si.qty_in_base_unit> si.qty_returned_in_base_unit order by si.parent,idx""".format(sales_invoice), as_dict =1
                )
    
    return result

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

    # Check if user has 'System Manager' role
    if "Cashier" not in frappe.get_roles(user):
        return None  # None = no filter, full access

    # Otherwise, restrict to only their own records
    return f"`tabSales Invoice`.owner = {frappe.db.escape(user)}"
