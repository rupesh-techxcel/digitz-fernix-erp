import frappe
from frappe.utils import today

def login_notification(login_manager):
   
    user = login_manager.user
    

    # Fetch due payments today (replace with your actual Doctype and filters)
    # IMPORTANT: Include 'name' in fields to ensure payment.name is available
    # IMPORTANT: Filter by user if these are user-specific payments
    c_payments = frappe.db.sql("""
    SELECT name, customer, amount, 'Receipt Schedule' AS doctype
    FROM `tabReceipt Schedule`
    WHERE scheduled_date = %s
""", today(), as_dict=True)

    # Payment Schedule query
    s_payments = frappe.db.sql("""
        SELECT name, supplier, amount, 'Payment Schedule' AS doctype
        FROM `tabPayment Schedule`
        WHERE scheduled_date = %s
    """, today(), as_dict=True)

    # Combine both lists of payments
    payments = c_payments + s_payments

    # Create message
    for payment in payments:
        name = payment.get("customer") if payment.get("customer") else payment.get("supplier")
        user_type = "Customer" if payment.get("customer") else "Supplier"
        try:
            if frappe.db.exists("Notification Log",{"document_name": payment.name}):
                pass
            else:
                log = frappe.get_doc({
                    "doctype": "Notification Log",
                    "subject": f"Scheduled Payment for {user_type} {name} Due Today",
                    "for_user": user,
                    "type": "Alert",
                    "document_type": payment.doctype,  # Use the correct doctype name
                    "document_name": payment.name, # This needs to be available from frappe.get_all
                    "email_content": f"You need to pay ₹{payment.amount} to {name} today."
                })
                log.insert(ignore_permissions=True)
                frappe.db.commit() # Commit the transaction after insertion

               

          

        except Exception as e:
            frappe.log_error(
                f"Error processing payment {payment.get('name', 'N/A')} for user {user}: {e}",
                "Login Notification Error"
            )
            frappe.db.rollback()
           

   