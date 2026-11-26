# Copyright (c) 2022, Rupesh P and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint
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

        self.validate_customer_code()
        self.validate_company_customer()
        self.validate_pro_customer()

    def validate_customer_code(self):

        if self.customer_code:
            self.customer_code = self.customer_code.strip()

        if not frappe.db.get_single_value("Settings", "customer_code_required"):
            return

        if not self.customer_code:
            frappe.throw("Customer Code is mandatory for the customer.")

        duplicate = frappe.db.get_value("Customer",
            {"customer_code": self.customer_code, "name": ["!=", self.name]}, "name")
        if duplicate:
            frappe.throw(f"Customer Code {self.customer_code} is already used by customer {duplicate}.")

    def validate_company_customer(self):
        """`company_customer` points an individual at the company they belong to.

        Kept one level deep and pointing only at companies, so the link can be
        followed without walking a chain or looping back on itself.
        """
        if not self.company_customer:
            return

        if self.customer_type == "Corporate":
            frappe.throw("A Corporate customer cannot itself belong to another corporate.")

        if self.company_customer == self.name:
            frappe.throw("A customer cannot be its own corporate.")

        if frappe.db.get_value("Customer", self.company_customer, "customer_type") != "Corporate":
            frappe.throw(
                f"'{self.company_customer}' is not a Corporate customer, so it cannot be set as Corporate."
            )

    def validate_pro_customer(self):
        """`pro_customer` points a customer at the Typing Center acting for them.

        Same shape as `company_customer`: one level deep, pointing only at Typing
        Center customers, and never at itself.
        """
        if not self.pro_customer:
            return

        if self.customer_type == "Typing Center":
            frappe.throw("A Typing Center customer cannot itself be assigned to another Typing Center.")

        if self.pro_customer == self.name:
            frappe.throw("A customer cannot be its own Typing Center.")

        if frappe.db.get_value("Customer", self.pro_customer, "customer_type") != "Typing Center":
            frappe.throw(
                f"'{self.pro_customer}' is not a Typing Center customer, so it cannot be set as Typing Center."
            )


    
    
    def before_save(self):
        """
        on_update hook for the Customer doctype.
        Calls the method to update enquiries when a customer is created from a prospect.
        """
        if self.customer_type == "Corporate" and not  self.company_id:
            self.company_id = frappe.db.count("Customer",{"customer_type":"Corporate"}) + 1
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
        elif self.customer_type == "Corporate" and self.company_id:
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
        if self.customer_type == "Corporate" and self.company_id:
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

@frappe.whitelist()
def get_customer_code_required():
    # Settings is readable only by System Manager, so the Customer form reads the flag through here
    return frappe.db.get_single_value("Settings", "customer_code_required")


# ------------------------------------------------------------ rename
# A customer is renamed with its references: every Link to it (invoices,
# returns, receipts and their lines, orders, projects...) through Frappe's own
# rename, the text fields that hold its ID (GL Posting party, archived
# invoices), and, when asked, the Customer Name copied onto documents.

# Text fields that hold the customer's ID, not a link, so a rename does not
# reach them on its own: (doctype, field, extra condition)
CUSTOMER_TEXT_REFERENCES = (
    ("GL Posting", "party", "party_type = 'Customer'"),
    ("Archived Sales Invoice", "customer", ""),
)


def can_rename_customer():
    return frappe.session.user == "Administrator" or bool({"System Manager", "Management"} & set(frappe.get_roles()))


def new_customer_id(doc, new_name):
    """The ID a customer called `new_name` takes, as before_validate names a new one."""
    area_mandatory = frappe.get_value("Company", get_default_company(), "customer_area_required")
    return f"{new_name}, {doc.area}" if area_mandatory and doc.area else new_name


def customer_name_copies():
    """Doctypes that copy the customer's name next to their customer link."""
    from frappe.model.rename_doc import get_link_fields

    doctypes = {"Archived Sales Invoice"}
    for field in get_link_fields("Customer"):
        if field.fieldname != "customer" or field.issingle:
            continue
        meta = frappe.get_meta(field.parent)
        if not meta.istable and meta.has_field("customer_name"):
            doctypes.add(field.parent)
    return sorted(doctypes)


@frappe.whitelist()
def get_customer_references(customer, new_name=None):
    """What renaming `customer` touches: [{doctype, field, count, lines}] of the
    records pointing at it, and the ID `new_name` would give it."""
    if not can_rename_customer():
        frappe.throw(_("Only an administrator can rename a customer."), frappe.PermissionError)
    from frappe.model.rename_doc import get_link_fields

    references = []
    for field in get_link_fields("Customer"):
        if field.issingle:
            count = 1 if frappe.db.get_single_value(field.parent, field.fieldname) == customer else 0
            lines = False
        elif frappe.get_meta(field.parent).istable:
            # Lines of a document: count the documents they belong to
            count = frappe.db.sql(
                f"SELECT COUNT(DISTINCT parent) FROM `tab{field.parent}` WHERE `{field.fieldname}` = %s",
                customer,
            )[0][0]
            lines = True
        else:
            count = frappe.db.count(field.parent, {field.fieldname: customer})
            lines = False
        if count:
            references.append({"doctype": field.parent, "field": field.fieldname, "count": count, "lines": lines})

    for doctype, field, condition in CUSTOMER_TEXT_REFERENCES:
        where = f"`{field}` = %s" + (f" AND {condition}" if condition else "")
        count = frappe.db.sql(f"SELECT COUNT(*) FROM `tab{doctype}` WHERE {where}", customer)[0][0]
        if count:
            references.append({"doctype": doctype, "field": field, "count": count, "lines": False})

    doc = frappe.get_doc("Customer", customer)
    new_name = (new_name or "").strip()
    return {
        "references": sorted(references, key=lambda r: (-r["count"], r["doctype"])),
        "new_id": new_customer_id(doc, new_name) if new_name else None,
    }


@frappe.whitelist()
def rename_customer(customer, new_name, update_copies=1):
    """Rename `customer` to `new_name` everywhere: its ID in every record that
    points at it, and its Customer Name; with `update_copies`, the Customer
    Name copied onto its documents too. Returns the new ID."""
    if not can_rename_customer():
        frappe.throw(_("Only an administrator can rename a customer."), frappe.PermissionError)
    new_name = (new_name or "").strip()
    if not new_name:
        frappe.throw(_("Enter the new name."))

    doc = frappe.get_doc("Customer", customer)
    new_id = new_customer_id(doc, new_name)
    if new_id != customer:
        if frappe.db.exists("Customer", new_id):
            frappe.throw(_("Another customer is already called {0}. Use Merge Customer instead.").format(new_id))
        # Every Link to the customer, in documents and their lines, submitted or not
        frappe.rename_doc("Customer", customer, new_id, force=True, show_alert=False)
        update_text_references(customer, new_id)

    if doc.customer_name != new_name:
        frappe.db.set_value("Customer", new_id, "customer_name", new_name)
        push_company_name(new_id)

    if cint(update_copies):
        update_name_copies(new_id, new_name)

    return {"name": new_id, "customer_name": new_name}


def update_text_references(old, new):
    """The text fields holding a customer's ID (CUSTOMER_TEXT_REFERENCES)."""
    for doctype, field, condition in CUSTOMER_TEXT_REFERENCES:
        frappe.db.sql(
            f"UPDATE `tab{doctype}` SET `{field}` = %(new)s WHERE `{field}` = %(old)s"
            + (f" AND {condition}" if condition else ""),
            {"new": new, "old": old},
        )


def update_name_copies(customer, customer_name):
    """The Customer Name copied onto `customer`'s documents."""
    for doctype in customer_name_copies():
        frappe.db.sql(
            f"UPDATE `tab{doctype}` SET customer_name = %(name)s WHERE customer = %(customer)s",
            {"name": customer_name, "customer": customer},
        )


@frappe.whitelist()
def merge_customer(current_customer, merge_customer):
    """Merge `current_customer` into `merge_customer`: every record pointing at
    the current customer -- in documents and their lines, submitted or not,
    and the text fields holding its ID (GL Posting party) -- moves to the
    selected customer, whose name it then carries, and the current customer
    is deleted. Irreversible."""
    if not can_rename_customer():
        frappe.throw(_("Only an administrator can merge customers."), frappe.PermissionError)
    if not current_customer or not merge_customer:
        frappe.throw(_("Both customers must be specified."))
    if current_customer == merge_customer:
        frappe.throw(_("Select a different customer to merge."))
    if not frappe.db.exists("Customer", merge_customer):
        frappe.throw(_("Customer {0} does not exist.").format(merge_customer))

    # Every Link moves to the selected customer, and the current one is deleted
    frappe.rename_doc("Customer", current_customer, merge_customer, merge=True, force=True, show_alert=False)
    update_text_references(current_customer, merge_customer)
    update_name_copies(merge_customer, frappe.db.get_value("Customer", merge_customer, "customer_name"))
    return {"name": merge_customer}


def push_company_name(customer):
    """A corporate customer's new name to the token system, as saving it does."""
    doc = frappe.get_doc("Customer", customer)
    if doc.customer_type != "Corporate" or not doc.company_id:
        return
    url = get_customer_company_url("update_customer_url")
    if not url:
        return
    ok, response = add_update_delete_customer_company(url, {"id": doc.company_id, "name": doc.customer_name}, "PUT")
    if not ok:
        frappe.msgprint(response)
        frappe.log_error(response)
