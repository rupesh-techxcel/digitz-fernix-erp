import frappe 

@frappe.whitelist()
def get_supplier_schedules():
    """
    Fetches a list of suppliers with their names and contact numbers.
    """
    try:
        currency = frappe.get_last_doc("Company").default_currency
        
    except frappe.DoesNotExistError:
        currency = "AED"  # Default to AED if no company is set
    suppliers = frappe.get_all('Payment Schedule', fields=['name', 'supplier', 'scheduled_date', 'amount'])
    return {
        "suppliers": suppliers,
        "currency": currency
    }