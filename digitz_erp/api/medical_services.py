import frappe





@frappe.whitelist()
def get_medical_service_items(medical_service: str):
    try:
        print(medical_service)
        doc = frappe.get_doc("Medical Services",{"title":medical_service})
        for item in doc.services:
            item_doc = frappe.get_doc("Item",item.item)
            if item_doc.com == item.com and item_doc.gov == item.gov:
                pass
            else:
                item.rate = item_doc.com + item_doc.gov
                item.com = item_doc.com
                item.gov = item_doc.gov
                item.gross_amount = item_doc.com + item_doc.gov
                item.net_amount = item_doc.com + item_doc.gov
                item.tax = item_doc.tax
                item.tax_excluded = item_doc.tax_excluded
                item.tax_amount = item_doc.com * (5 /100)



        
        return doc
    except Exception as e:
        

        frappe.log_error()

    return None



def get_medical_service_logs_permission_query(user):
    if not user or user == "Administrator":
        return None  # full access for admin

    # If not Cashier → full access
    if "Cashier" not in frappe.get_roles(user):
        return None

    # Restrict Cashier to their own records (safe escaping)
    return f"`tabMedical Service Logs`.owner = {frappe.db.escape(user)}"

def item_has_permission(doc,user):
    """Restrict Reception role from creating Items"""
    roles = frappe.get_roles(user)
    
    print("roles")
    print(roles)
    
    if "Administrator" in roles:
        print("Administrator")
        return True

    # if user has cashier role and is trying to create
    if "Cashier" in roles:
        # check if doc is new
        if doc.is_new():
            return False  # No permission to create
        
    return True  # default allow
