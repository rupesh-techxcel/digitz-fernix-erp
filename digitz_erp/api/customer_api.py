import frappe
from frappe import _

@frappe.whitelist()
def merge_customer(current_customer, merge_customer):
    """The Customer form's Merge Customer: see the Customer doctype's merge_customer."""
    from digitz_erp.accounts.doctype.customer.customer import merge_customer as merge

    return merge(current_customer, merge_customer)

@frappe.whitelist()
def get_customer_details(customer):
    
    customer_doc = frappe.get_doc('Customer', customer)
    return customer_doc

@frappe.whitelist()
def convert_prospect_to_customer(prospect):
    # Check if the prospect already exists as the prospect field in any customer
    existing_customer = frappe.db.exists("Customer", {"prospect": prospect})
    if existing_customer:
        frappe.throw(f"The prospect {prospect} is already linked to a customer.")
    
    # Get the Prospect document
    prospect_doc = frappe.get_doc("Sales Prospect", prospect)
    
    # Create a new Customer document but do not insert (save) it yet
    customer_doc = frappe.new_doc("Customer")
    
    # Assign relevant fields from the prospect to the customer
    customer_doc.customer_name = prospect_doc.company_name if prospect_doc.company_name else prospect_doc.prospect_name
    
    customer_doc.prospect = prospect
    customer_doc.contact_person = prospect_doc.contact_person
    customer_doc.contact_person_designation = prospect_doc.contact_person_designation
    customer_doc.phone = prospect_doc.phone
    customer_doc.mobile_no = prospect_doc.mobile_no
    customer_doc.email_id = prospect_doc.email_id
    
    customer_doc.address_line_1 = prospect_doc.address_line_1
    customer_doc.address_line_2 = prospect_doc.address_line_2
    customer_doc.emirate = prospect_doc.emirate
    customer_doc.area = prospect_doc.area
    customer_doc.country = prospect_doc.country
    
    customer_doc.full_address = prospect_doc.full_address    
    
    # Return the new customer document to be opened in the UI
    return customer_doc.as_dict()

    


@frappe.whitelist()
def get_customer_schedules():
    """Fetch all receipt schedules for customers."""
    try:
        currency = frappe.get_last_doc("Company").default_currency
        
    except frappe.DoesNotExistError:
        currency = "AED"  # Default to AED if no company is set
    receipts = frappe.get_all("Receipt Schedule",
       fields=["name", "customer", "scheduled_date", "amount"],)
    return {
        "receipts": receipts,
        "currency": currency
    }


@frappe.whitelist()
def create_customer(customer_name: str):
    frappe.db.sql(
        """
            INSERT INTO tabCustomer cusotomer_name VALUES(%s)
""",(customer_name,)
    )
    frappe.db.commit()