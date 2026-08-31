# Copyright (c) 2022, Rupesh P and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from digitz_erp.api.settings_api import get_default_company
import requests

class Customer(Document):
   
    def before_validate(self):
        
        company = get_default_company()
        area_mandatory = frappe.get_value("Company",company,"customer_area_required")
        if area_mandatory and not self.area:
            frappe.throw("Select Area.")
            
        if self.is_new():
            if area_mandatory:
                self.name = f"{self.customer_name}, {self.area}"
            else:
                self.name = self.customer_name
            
        self.validate_data()
    
    def validate_data(self):
        
        company = get_default_company()    
        
        area_mandatory,trn_mandatory,address_required,mobile_required,email_required,emirate_required = frappe.get_value("Company",company,["customer_area_required","customer_trn_required","customer_address_required","customer_mobile_required","customer_email_required","emirate_required"])
        
        if area_mandatory and not self.area:
            frappe.throw("Select Area.")
        
        if trn_mandatory and not self.tax_id:
            frappe.throw("Tax Id is mandaoty for the customer.")
            
        if address_required and not self.address_line_1:
            frappe.throw("Address Line 1 is mandaoty for the customer.")
            
        if mobile_required and not self.mobile_no:
            frappe.throw("Mobile Number is mandatory for the customer.")
        
        if email_required and not self.email_id:
            frappe.throw("Email Id is mandaoty for the customer.")
            
        if emirate_required and not self.emirate:
            frappe.throw("Emirate is mandatory for the customer")

    
    
    
    def before_save(self):
        """
        on_update hook for the Customer doctype.
        Calls the method to update enquiries when a customer is created from a prospect.
        """
        if self.customer_type == "Company" and not  self.company_id:
            self.company_id = frappe.db.count("Customer",{"customer_type":"Company"}) + 1
            add_customer_url = get_customer_company_url("add_customer_url")
            if not add_customer_url:
                # The push integration is not configured on this site. company_id
                # is still assigned, so tokens carrying it resolve locally.
                return

            params = {
                            "id": self.company_id,
                            "name": self.customer_name,
                            
            }
            flag,response = add_update_delete_customer_company(add_customer_url,params,"POST")
            if flag:
                frappe.msgprint("Company added successfully.")
            else:
                frappe.msgprint(response)
                frappe.log_error(response)
                return
        elif self.customer_type == "Company" and self.company_id:
            doc = self.get_doc_before_save()
            if doc and doc.customer_name != self.customer_name:
                update_customer_url = get_customer_company_url("update_customer_url")
                if not update_customer_url:
                    return

                params = {
                            "id": self.company_id,
                            "name": self.customer_name,
                            
            }
                flag,response = add_update_delete_customer_company(update_customer_url,params,"PUT")
                
                if flag:
                    frappe.msgprint("Customer Company updated successfully.")
                else:
                    frappe.msgprint(response)
                    frappe.log_error(response)
                    return

    def on_trash(self):
        if self.customer_type == "Company" and self.company_id:
            delete_customer_url = get_customer_company_url("delete_customer_url")
            if not delete_customer_url:
                return

            params = {
                            "id": self.company_id,
            }
            flag,response = add_update_delete_customer_company(delete_customer_url,params,"DELETE")
            if flag:
                frappe.msgprint("Customer Company deleted successfully.")
            else:
                frappe.msgprint(response)              
    def update_enquiries_for_prospect(prospect, customer_name):
        """
        Update all enquiries with the given prospect to link them to the newly created customer.
        
        :param prospect: The prospect field value from the Customer document.
        :param customer_name: The name of the newly created Customer.
        """
        if not prospect:
            return

        # Fetch all enquiries that belong to the prospect and have lead_type="Prospect"
        enquiries = frappe.get_all("Enquiry", filters={
            "prospect": prospect,
            "lead_type": "Prospect",
            "customer": ["is", None]  # Ensures only enquiries without a linked customer are updated
        }, fields=["name"])

        # Update each enquiry's customer field
        for enquiry in enquiries:
            enquiry_doc = frappe.get_doc("Enquiry", enquiry.name)
            enquiry_doc.customer = customer_name
            enquiry_doc.save()

        # Commit changes to the database
        frappe.db.commit()

        frappe.msgprint(f"Updated {len(enquiries)} enquiries linked to the prospect '{prospect}' with the customer '{customer_name}'", alert=True)
    
    # def on_update(self):
        # """
        # on_update hook for the Customer doctype.
        # Calls the method to update enquiries when a customer is created from a prospect.
        # """
        
        # Ensure the customer is being created for the first time
        # if self.is_new():
            # Call the separate method to update enquiries for the prospect
            # update_enquiries_for_prospect(doc.prospect, doc.name)

@frappe.whitelist()
def merge_customer(current_customer, merge_customer):
    if not current_customer or not merge_customer:
        frappe.throw(_('Both customers must be specified'))
        
    if(current_customer == merge_customer):
        frappe.throw(_('Select a different customer to merge.'))
    
    # Fetch both customer docs
    current_customer_doc = frappe.get_doc('Customer', current_customer)
    merge_customer_doc = frappe.get_doc('Customer', merge_customer)
    
    # Logic to merge customer details
    # Example: Merge contact info, addresses, etc.
    # You need to customize this based on your requirements
    for fieldname in ['contact_info', 'addresses']:  # Add fields to merge
        if hasattr(merge_customer_doc, fieldname):
            if not hasattr(current_customer_doc, fieldname):
                setattr(current_customer_doc, fieldname, [])
            current_customer_doc.append(fieldname, merge_customer_doc.get(fieldname))
    
    # Save the updated current customer
    current_customer_doc.save()
    
    # Delete the merged customer
    frappe.delete_doc('Customer', merge_customer)
    
    return True



def get_customer_company_url(fieldname):
    """The configured push endpoint, or None when it is not set up.

    A blank URL means this site does not mirror company customers to the token
    system, so the caller skips the HTTP call instead of failing the save.
    """
    url = frappe.db.get_value("Settings", None, fieldname)
    return url.strip() if url else None


def add_update_delete_customer_company(url: str,query_params: dict, method: str):
    if not url:
        return False, "No URL is configured for this operation in Settings."

    try:
        if method.upper() == "POST":
            response = requests.post(url, params=query_params, timeout=30)
        elif method.upper() == "PUT":
            response = requests.put(url, params=query_params, timeout=30)
        elif method.upper() == "DELETE":
            response = requests.delete(url, params=query_params, timeout=30)
        else:
            raise ValueError("Invalid HTTP method. Use 'POST', 'PUT', or 'DELETE'.")

        if response.status_code == 200:
            return True, "Operation successful."
        else:
            return False, f"Failed to perform operation. Status code: {response.status_code}"
    except requests.RequestException as e:
        return False, f"Error occurred while performing operation: {str(e)}"