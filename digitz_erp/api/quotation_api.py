import frappe
from frappe.utils import get_datetime

@frappe.whitelist()
def get_quotation_data(quotation_no):	
    
    return frappe.db.get_value("Quotation", quotation_no,["name","customer_name", "customer_address","reference_no","posting_date", "credit_sale", "tax_total","net_total", "rounded_total"], as_dict=1)

@frappe.whitelist()
def get_quotation_test():	    
    return "Test Success"

def get_quotation_items_data(quotation_no):	
    
    return frappe.db.sql("select item, display_name,qty,unit,rate,tax_rate, tax_amount,net_amount from `tabQuotation Item` where parent=" + quotation_no, ignore_user_permission=True)

@frappe.whitelist()
def get_sales_invoice_exists(qtn_no):    
   return frappe.db.exists('Sales Invoice', {'quotation': qtn_no,'docstatus': ('<', 2)})

@frappe.whitelist()
def get_customer_exists_for_prospect(prospect):    
   return bool(frappe.db.exists('Customer', {'prospect': prospect}))

@frappe.whitelist()
def get_sales_order_exists(qtn_no): 
   
   return frappe.db.exists('Sales Order', {'quotation': qtn_no,'docstatus': ('<', 2)})

@frappe.whitelist()
def get_delivery_note_exists(qtn_no):    
   return frappe.db.exists('Delivery Note', {'quotation': qtn_no, 'docstatus': ('<', 2)})


# For quotation we dont allow multiple documents created for a single quotation. So checking existance of the reference in any of the documents is good enough
@frappe.whitelist()
def check_references_created(quotation_name):
    
    #print("from check_reference_created")
    #print(quotation_name)

    sales_order_exists_for_quotation = frappe.db.exists("Sales Order", {"quotation": quotation_name,'docstatus': ('<', 2)})

    if sales_order_exists_for_quotation:
        frappe.throw("Sales Order already exist for the quotation and cannot create additional references.")

    delivery_note_exists_for_quotation = frappe.db.exists("Delivery Note", {"quotation": quotation_name,'docstatus': ('<', 2)})

    if(delivery_note_exists_for_quotation):
        frappe.throw("Delivery Note already exist for the quotation and cannot create additional references")

    sales_invoice_exists_for_quotation = frappe.db.exists("Sales Invoice", {"quotation": quotation_name,'docstatus': ('<', 2)})

    if(sales_invoice_exists_for_quotation):
        frappe.throw("Sales Invoice already exist for the quotation and cannot create additional references.")

def get_receipt_entry_details(sales_invoice: list):
    """
    Fetches receipt entry details for a list of sales invoices.
    """
    try:
        receipt_entries = frappe.get_all(
            "Receipt Allocation",
            fields=["name",],
            filters={"reference_name": ["in", sales_invoice],"reference_type": "Sales Invoice" ,"docstatus": 1},
            order_by="modified desc"
        )
        return receipt_entries
    except Exception as e:
        frappe.log_error(f"Error fetching receipt entry details: {e}", "Quotation API Error")
        return []


def get_sales_invoice_details(quotation_id: str):
    """
    Fetches sales invoice details for a list of quotations.
    """
    try:
        sales_invoices = frappe.get_all(
            "Sales Invoice",
            pluck="name",
            filters={"quotation": quotation_id, "docstatus": 1},
            order_by="modified desc"
        )
        return sales_invoices
    except Exception as e:
        frappe.log_error(f"Error fetching sales invoice details: {e}", "Quotation API Error")
        return []


def get_delivery_note_details(quotation_id: str):
    """
    Fetches delivery note details for a list of sales orders.
    """
    try:
        delivery_notes = frappe.get_all(
            "Delivery Note",
            fields=["name",],
            filters={"quotation": quotation_id, "docstatus": 1},
            order_by="modified desc"
        )
        
        return delivery_notes
    except Exception as e:
        frappe.log_error(f"Error fetching delivery note details: {e}", "Quotation API Error")
        return []

def get_sales_order_details(quotation_id: str):
    """
    Fetches sales order details for a list of quotations.
    """
    
    try:
        sales_orders = frappe.get_all(
            "Sales Order",
            fields=["name",],
            filters={"quotation": quotation_id, "docstatus": 1},
            order_by="modified desc"
        )
        return sales_orders
    except Exception as e:
        frappe.log_error(f"Error fetching sales order details: {e}", "Quotation API Error")
        return []




@frappe.whitelist()
def get_quotation_list_details(page_start=0):
    """
    Fetches a list of quotations with their details.
    """
    
    
    
    try:
        quotations = frappe.db.sql("""
            SELECT DISTINCT q.name, q.prospect,q.customer
            FROM `tabQuotation` q
            INNER JOIN `tabSales Order` so ON so.quotation = q.name
            WHERE q.docstatus = 1
            ORDER BY q.modified DESC
            LIMIT 20 OFFSET %s
        """, (int(page_start) * 20,), as_dict=True)

        
        if quotations:
            total_count = frappe.db.sql("""
                    SELECT COUNT(DISTINCT q.name)
                    FROM `tabQuotation` q
                    INNER JOIN `tabSales Order` so ON so.quotation = q.name
                    WHERE q.docstatus = 1
                """)[0][0]

            for quotation in quotations:
                if not quotation.get("prospect"):
                    quotation.prospect = quotation.customer
                quotation.sales_invoice = get_sales_invoice_details(quotation.name)
                quotation.delivery_notes = get_delivery_note_details(quotation.name)
                quotation.sales_order = get_sales_order_details(quotation.name)
                if quotation.sales_invoice:
                    quotation.receipt_entries = get_receipt_entry_details(quotation.sales_invoice)
                 
        return {
            "quotations": quotations,
            "total_count": total_count,
        }
    except Exception as e:
        frappe.log_error(f"Error fetching quotation list: {e}", "Quotation API Error")
        return []


@frappe.whitelist()
def get_pending_quotation_for_new_sales_invoice(customer):
    query = """select name as 'Quotation', posting_date as 'Date', rounded_total as 'Amount' from `tabQuotation` dn where dn.docstatus=1 and dn.customer=%s """
    quotations = frappe.db.sql(query,(customer), as_dict = True)
    return quotations


@frappe.whitelist()
def get_quotation_items(quotation_list):
    """
    Fetches items for a list of quotations.
    """
    import json
    quotation_list = json.loads(quotation_list)
    
    # Ensure the quotation_list is formatted correctly for the SQL IN clause
    quotation_list_tuple = tuple(quotation_list)

    query = """
    SELECT 
        name AS delivery_note_item_reference_no,
        item,
        qty,
        warehouse,
        item_name,
        display_name,
        unit,
        rate,
        base_unit,
        qty_in_base_unit,
        rate_in_base_unit,
        conversion_factor,
        rate_includes_tax,
        gross_amount,
        tax_excluded,
        tax_rate,
        tax_amount,
        discount_percentage,
        discount_amount,
        net_amount 
    FROM 
        `tabQuotation Item` 
    WHERE 
        parent IN %s 
        AND docstatus = 1
    """

    # Executing the query
    items = frappe.db.sql(query, (quotation_list_tuple,), as_dict=True)
    print(items)
    return items