import frappe


def execute(filters=None):
    columns = get_columns(filters)
    data = get_data(filters or {})
    return columns, data


def get_columns(filters=None):
    columns = [
        {
            "fieldname": "voucher_type",
            "label": "Type",
            "fieldtype": "Data",
            "width": 110,
        },
        {
            "fieldname": "invoice_no",
            "label": "Document No",
            "fieldtype": "Dynamic Link",
            "options": "voucher_type",
            "width": 160,
        },
        {
            "fieldname": "posting_date",
            "label": "Date",
            "fieldtype": "Date",
            "width": 120,
        },
        {
            "fieldname": "customer",
            "label": "Customer",
            "fieldtype": "Link",
            "options": "Customer",
            "width": 200,
        },
        {
            "fieldname": "item_name",
            "label": "Item Name",
            "fieldtype": "Data",
            "width": 260,
        },
        {
            "fieldname": "service_charge",
            "label": "Service Charge",
            "fieldtype": "Currency",
            "width": 120,
        },
        {
            "fieldname": "typing_charges",
            "label": "Typing Charges",
            "fieldtype": "Currency",
            "width": 120,
        },
        {
            "fieldname": "gov_fee",
            "label": "Gov Fee",
            "fieldtype": "Currency",
            "width": 120,
        },
        {
            "fieldname": "gross_amount",
            "label": "Gross Amount",
            "fieldtype": "Currency",
            "width": 140,
        },
        {
            "fieldname": "tax_amount",
            "label": "Tax Amount",
            "fieldtype": "Currency",
            "width": 120,
        },
        {
            "fieldname": "net_amount",
            "label": "Net Amount",
            "fieldtype": "Currency",
            "width": 150,
        },
        {
            "fieldname": "payment_mode",
            "label": "Payment Mode",
            "fieldtype": "Data",
            "width": 150,
        },
        {
            "fieldname": "user",
            "label": "User/Counter",
            "fieldtype": "Link",
            "options": "User",
            "width": 150,
        },
    ]

    if filters and filters.get("payment_mode") == "Credit Sale":
        columns.append(
            {
                "fieldname": "credit_days",
                "label": "Credit Days",
                "fieldtype": "Int",
                "width": 120,
            }
        )

    return columns


AMOUNT_FIELDS = ("service_charge", "typing_charges", "gov_fee", "gross_amount", "tax_amount", "net_amount")


def get_data(filters):
    """One row per submitted Sales Invoice, and one per submitted Sales Return with
    its amounts negative, so the columns add up to what was actually sold. The same
    filters apply to both; the newest documents come first."""
    filters = filters or {}

    rows = get_documents("Sales Invoice", "Sales Invoice Item", filters)
    for row in get_documents("Sales Return", "Sales Return Item", filters):
        for field in AMOUNT_FIELDS:
            row[field] = -(row[field] or 0)
        rows.append(row)

    rows.sort(key=lambda r: (r.posting_date, r.net_amount if r.net_amount is not None else 0), reverse=True)
    return rows


def get_documents(doctype, item_doctype, filters):
    query = f"""
        SELECT
            '{doctype}' AS voucher_type,
            i.name AS invoice_no,
            i.posting_date AS posting_date,
            i.customer AS customer,

            GROUP_CONCAT(DISTINCT sii.item_name ORDER BY sii.idx SEPARATOR ', ') AS item_name,

            SUM(IFNULL(sii.service_charge, 0)) AS service_charge,
            SUM(IFNULL(sii.typing_charges, 0)) AS typing_charges,
            SUM(IFNULL(sii.gov, 0)) AS gov_fee,
            SUM(IFNULL(sii.gross_amount, 0)) AS gross_amount,
            SUM(IFNULL(sii.tax_amount, 0))   AS tax_amount,
            SUM(IFNULL(sii.net_amount, 0))   AS net_amount,

            CASE
                WHEN i.credit_sale = 1 THEN 'Credit Sale'
                ELSE i.payment_mode
            END AS payment_mode,

            i.owner AS user
    """

    if filters.get("payment_mode") == "Credit Sale":
        query += ", i.credit_days AS credit_days"

    query += f"""
        FROM `tab{doctype}` i
        JOIN `tab{item_doctype}` sii ON sii.parent = i.name
    """

    conditions = []

    if not filters.get("from_date") or not filters.get("to_date"):
        today = frappe.utils.today()
        filters["from_date"] = today
        filters["to_date"] = today
    conditions.append("i.posting_date BETWEEN %(from_date)s AND %(to_date)s")

    current_user = frappe.session.user
    roles = set(frappe.get_roles(current_user))
    is_privileged = current_user == "Administrator" or "System Manager" in roles

    if "Cashier" in roles and not is_privileged:
        filters["user"] = current_user
        conditions.append("i.owner = %(user)s")
    elif filters.get("user"):
        conditions.append("i.owner = %(user)s")

    if filters.get("customer"):
        conditions.append("i.customer = %(customer)s")

    if filters.get("payment_mode"):
        if filters.get("payment_mode") != "Credit Sale":
            conditions.append("i.payment_mode = %(payment_mode)s")
        else:
            conditions.append("i.credit_sale = 1")

    conditions.append("i.docstatus = 1")

    if conditions:
        query += " WHERE " + " AND ".join(conditions)

    query += """
        GROUP BY i.name
    """

    return frappe.db.sql(query, filters, as_dict=1)