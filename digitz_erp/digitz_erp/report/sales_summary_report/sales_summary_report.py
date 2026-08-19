# Copyright (c) 2025, Techxcel Technologies
# For license information, please see license.txt

import frappe
from frappe.utils import get_first_day, get_last_day, today


def execute(filters=None):
    if not filters:
        filters = {}

    set_default_filters(filters)

    columns = get_columns()
    grouped_rows = get_grouped_data(filters)     # rows grouped by user & payment_mode
    data = shape_grouped_display(grouped_rows)   # add user header + total lines + grand total

    return columns, data


def set_default_filters(filters):
    """Default to current month if not provided."""
    if not filters.get("from_date"):
        filters["from_date"] = get_first_day(today())
    if not filters.get("to_date"):
        filters["to_date"] = get_last_day(today())


def get_columns():
    return [
        {"fieldname": "username",     "label": "User",         "fieldtype": "Data",     "width": 260},
        {"fieldname": "payment_mode", "label": "Payment Mode", "fieldtype": "Data",     "width": 220},
        {"fieldname": "total_amount", "label": "Total Amount", "fieldtype": "Currency", "width": 160},
    ]


def get_grouped_data(filters):
    """
    Return aggregate sums grouped by user and payment mode.
    - Applies date range.
    - If logged-in user has 'Cashier' role → restrict to their own records.
    - Else: apply 'user' filter if provided; otherwise returns all users.
    - If credit_sale=1 → group as 'Credit Sale'
      else group by payment_mode.
    """
    conditions = [
        "i.docstatus = 1",
        "i.posting_date BETWEEN %(from_date)s AND %(to_date)s",
    ]

    current_user = frappe.session.user
    roles = set(frappe.get_roles(current_user))

    # Treat these as 'administrator privilege'
    is_privileged = (current_user == "Administrator")

    if "Cashier" in roles and not is_privileged:
        # Cashier but not privileged → restrict to own records
        filters["user"] = current_user          # reuse existing %(user)s param
        conditions.append("i.owner = %(user)s")
    elif filters.get("user"):
        # Non-cashiers (or privileged users) behave as before
        conditions.append("i.owner = %(user)s")
        
    print("conditions")
    print(conditions)        

    where_sql = " AND ".join(conditions)

    payment_mode_label = """
        CASE
            WHEN i.credit_sale = 1 THEN 'Credit Sale'
            ELSE COALESCE(i.payment_mode, 'Unknown')
        END
    """

    sql = f"""
        SELECT
            COALESCE(u.full_name, u.name) AS username,
            {payment_mode_label}           AS payment_mode,
            SUM(i.net_total)               AS total_amount
        FROM `tabSales Invoice` i
        LEFT JOIN `tabUser` u ON u.name = i.owner
        WHERE {where_sql}
        GROUP BY COALESCE(u.full_name, u.name), {payment_mode_label}
        ORDER BY username, payment_mode
    """

    return frappe.db.sql(sql, filters, as_dict=True)


def shape_grouped_display(rows):
    """
    Produce a grouped display:
      1) Bold header row with the User name
      2) Indented detail rows for each payment_mode
      3) Bold 'Total' row for the user
      4) Final 'Grand Total' row
    """
    if not rows:
        return []

    out = []
    current_user = None
    running_total = 0.0
    grand_total = 0.0

    def flush_user(user, total):
        if user is None:
            return
        out.append({
            "username": "",
            "payment_mode": "Total",
            "total_amount": total,
            "bold": 1
        })

    for r in rows:
        user = r.get("username") or "Unknown User"

        if user != current_user:
            flush_user(current_user, running_total)
            out.append({
                "username": user,
                "payment_mode": "",
                "total_amount": None,
                "is_user_header": 1,
                "bold": 1
            })
            current_user = user
            running_total = 0.0

        amt = float(r.get("total_amount") or 0)
        running_total += amt
        grand_total += amt

        out.append({
            "username": "",
            "payment_mode": r.get("payment_mode"),
            "total_amount": r.get("total_amount"),
            "indent": 1
        })

    flush_user(current_user, running_total)

    out.append({
        "username": "",
        "payment_mode": "Grand Total",
        "total_amount": grand_total,
        "bold": 1
    })

    return out
