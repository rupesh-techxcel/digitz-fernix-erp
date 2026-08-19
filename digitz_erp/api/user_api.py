import frappe

@frappe.whitelist()
def get_user_default_warehouse():
    
    user = frappe.session.user

    # returnValue = frappe.db.sql("""SELECT warehouse FROM `tabUser Warehouse` WHERE user = '{}' AND is_default = 1""".format(user), as_dict=1)
    
    user_default_warehouse = frappe.get_value('User Warehouse', {'user':user, 'is_default':1}, ['warehouse'])
    
    return user_default_warehouse

@frappe.whitelist()
def get_user_default_warehouse_2():
    
    user = frappe.session.user

    # returnValue = frappe.db.sql("""SELECT warehouse FROM `tabUser Warehouse` WHERE user = '{}' AND is_default = 1""".format(user), as_dict=1)
    
    user_default_warehouse = frappe.get_value('User Warehouse', {'user':user, 'is_default':1}, ['warehouse'])
    
    if(not user_default_warehouse):        
         return frappe.get_value('Company', ['warehouse'])
    else:
        return user_default_warehouse
    
@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def user_with_name(doctype, txt, searchfield, start, page_len, filters):
    return frappe.db.sql("""
        SELECT u.name, u.full_name
        FROM `tabUser` u
        INNER JOIN `tabHas Role` r ON r.parent = u.name
        WHERE u.enabled = 1
          AND r.role = 'Cashier'
          AND (u.full_name LIKE %(txt)s OR u.name LIKE %(txt)s)
        ORDER BY u.full_name ASC
        LIMIT %(start)s, %(page_len)s
    """, {
        "txt": "%%%s%%" % txt,
        "start": start,
        "page_len": page_len
    })

@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def search_payment_modes_with_credit_sale(doctype, txt, searchfield, start, page_len, filters):
    """
    Link-field search that prepends a synthetic 'Credit Sale' option,
    then lists actual Payment Mode records.
    """
    txt = txt or ""
    like_txt = f"%{txt}%"

    # fetch actual Payment Mode names
    modes = frappe.db.sql(
        """
        SELECT name
        FROM `tabPayment Mode`
        WHERE name LIKE %(like)s
        ORDER BY
            CASE WHEN name LIKE %(prefix)s THEN 0 ELSE 1 END,
            name
        LIMIT %(start)s, %(page_len)s
        """,
        {
            "like": like_txt,
            "prefix": f"{txt}%",
            "start": start,
            "page_len": page_len,
        },
    )

    out = []

    # include 'Credit Sale' if it matches the typed text or when no text typed
    if not txt or "credit" in txt.lower():
        out.append(("Credit Sale",))

    # append actual payment modes
    out.extend(modes)

    return out



    