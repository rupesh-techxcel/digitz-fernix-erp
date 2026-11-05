"""Service-line detail from submitted Sales Invoices; see README for mappings."""

import frappe
from frappe import _
from frappe.utils import flt, getdate, today


# Keep logically mapped reference columns in their original order.
COLUMNS = (
    ("posting_date", "Invoice Date", "Date", None),
    ("posting_time", "Invoice Time", "Time", None),
    ("invoice_number", "Invoice Number", "Link", "Sales Invoice"),
    ("card_type", "Card Type", "Data", None),
    ("stock_id", "Stock ID", "Data", None),
    ("service_name", "Service Name", "Data", None),
    ("category", "Category", "Link", "Item Group"),
    ("customer", "Customer", "Link", "Customer"),
    ("salesman", "Sales Man", "Data", None),
    ("display_customer", "Display Customer", "Data", None),
    ("customer_mobile", "Customer Mobile", "Data", None),
    ("customer_email", "Customer Email", "Data", None),
    ("quantity", "Quantity", "Float", None),
    ("service_charge", "Service Charge", "Currency", None),
    ("total_service_charge", "Total Service Charge", "Currency", None),
    ("round_off", "Round Off", "Currency", None),
    ("total_vat", "Total VAT", "Currency", None),
    ("govt_fee", "Govt.Fee", "Currency", None),
    ("total_govt_fee", "Total Govt.Fee", "Currency", None),
    ("bank_reference_number", "Invoice Payment Reference", "Data", None),
    ("discount_amount", "Discount Amount", "Currency", None),
    ("payment_status", "Payment Status", "Data", None),
    ("employee", "Created By", "Link", "User"),
    ("line_total", "Line Total", "Currency", None),
    ("invoice_total", "Invoice Total", "Currency", None),
    ("net_service_charge", "Net Service Charge", "Currency", None),
    ("typing_charges", "Typing Charges", "Currency", None),
    ("transaction_charges", "Transaction Charges", "Currency", None),
    ("line_total_with_vat", "Line Total With VAT", "Currency", None),
    ("additional_discount", "Invoice Additional Discount", "Currency", None),
)

TEXT_FILTERS = {
    "customer_token": "customer_token", "applicant_name": "customer_display_name",
    "mobile": "customer_mobile_number", "email": "customer_email", "customer_trn": "tax_id",
}
AMOUNT_FILTERS = {
    "invoice_total": "si.rounded_total", "round_off": "si.round_off",
    "paid_amount": "si.paid_amount",
    "outstanding": "CASE WHEN si.credit_sale = 1 THEN GREATEST(COALESCE(si.rounded_total, 0) - COALESCE(si.paid_amount, 0), 0) ELSE 0 END",
    "quantity": "line.qty", "govt_fee": "line.gov", "service_charge": "line.service_charge",
    "vat": "line.tax_amount", "line_total": "line.net_amount",
}


def execute(filters=None):
    filters = dict(filters or {})
    filters["from_date"] = getdate(filters.get("from_date") or today())
    filters["to_date"] = getdate(filters.get("to_date") or today())
    if filters["from_date"] > filters["to_date"]:
        frappe.throw(_("From Date cannot be after To Date."))
    for field in AMOUNT_FILTERS:
        low, high = filters.get(f"min_{field}"), filters.get(f"max_{field}")
        if has_value(low) and has_value(high) and flt(low) > flt(high):
            frappe.throw(_("Minimum {0} cannot exceed maximum.").format(_(field.replace("_", " ").title())))

    data = get_data(filters)
    # Invoice Total repeats on service lines, as in the source. Never auto-sum it.
    invoices = {r["invoice_number"]: r["invoice_total"] for r in data}
    summary = [
        {"label": _("Invoices"), "value": len(invoices), "datatype": "Int"},
        {"label": _("Invoice Total"), "value": sum(invoices.values()), "datatype": "Currency"},
        {"label": _("VAT (Selected Lines)"), "value": sum(r["total_vat"] for r in data), "datatype": "Currency"},
    ]
    message = _(
        "Submitted Sales Invoices only. Invoice Total repeats on each service line; "
        "the summary counts each invoice once. Round Off and Invoice Additional Discount "
        "appear once per invoice. Created By identifies the user who created the invoice. "
        "Line Total excludes VAT; Net Service Charge also excludes government fees."
    )
    return get_columns(), data, message, None, summary


def get_columns():
    columns = []
    for fieldname, label, fieldtype, options in COLUMNS:
        column = dict(fieldname=fieldname, label=_(label), fieldtype=fieldtype,
                      width=230 if fieldname in ("service_name", "display_customer", "customer") else 150)
        if options:
            column["options"] = options
        columns.append(column)
    return columns


def get_data(filters):
    invoice_fields = set(frappe.db.get_table_columns("Sales Invoice"))
    conditions = {"docstatus": 1, "posting_date": ["between", [filters["from_date"], filters["to_date"]]]}
    for field in ("company", "customer", "salesman", "counter"):
        if filters.get(field):
            conditions[field] = filters[field]
    if filters.get("invoice_number"):
        conditions["name"] = filters["invoice_number"]
    for key, field in TEXT_FILTERS.items():
        if filters.get(key):
            if field not in invoice_fields:
                return []
            # Literal contains search: % and _ entered by a user are not wildcards.
            value = str(filters[key]).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            conditions[field] = ["like", f"%{value}%"]
    for field in ("show_company_in_printout", "show_trn_in_printout"):
        if filters.get(field) in ("Yes", "No"):
            conditions[field] = int(filters[field] == "Yes")
    roles = set(frappe.get_roles())
    if "Cashier" in roles and frappe.session.user != "Administrator" and "System Manager" not in roles:
        conditions["owner"] = frappe.session.user
    elif filters.get("user"):
        conditions["owner"] = filters["user"]
    if filters.get("sale_type"):
        conditions["credit_sale"] = int(filters["sale_type"] == "Credit")
    if filters.get("payment_mode"):
        conditions["payment_mode"] = filters["payment_mode"]

    # get_list applies Frappe's document and user permissions before any joins.
    invoices = frappe.get_list("Sales Invoice", filters=conditions, pluck="name", limit_page_length=0)
    if not invoices:
        return []
    item_fields = set(frappe.db.get_table_columns("Sales Invoice Item"))
    data = []
    for start in range(0, len(invoices), 500):
        params = {"invoices": invoices[start:start + 500]}
        line_conditions = []
        for field, expression in (("item", "line.item"), ("category", "item.item_group")):
            if filters.get(field):
                line_conditions.append(f"{expression} = %({field})s")
                params[field] = filters[field]
        for field, expression in AMOUNT_FILTERS.items():
            # A missing optional charge field cannot match a numeric filter.
            if field == "service_charge" and "service_charge" not in item_fields:
                expression = "NULL"
            for bound, operator in (("min", ">="), ("max", "<=")):
                key = f"{bound}_{field}"
                if has_value(filters.get(key)):
                    line_conditions.append(f"({expression}) {operator} %({key})s")
                    params[key] = flt(filters[key])
        where = " AND " + " AND ".join(line_conditions) if line_conditions else ""
        query = """
            SELECT si.name AS invoice_number, si.posting_date, si.posting_time,
                si.customer, si.salesman, si.customer_display_name AS display_customer,
                si.customer_mobile_number AS customer_mobile, si.customer_email,
                si.credit_sale, si.payment_mode, si.paid_amount,
                si.rounded_total AS invoice_total, si.round_off,
                si.additional_discount, si.reference_no AS bank_reference_number,
                si.owner AS employee,
                salesman.employee_name AS salesman_name,
                line.name AS line_id, line.idx, line.item,
                COALESCE(NULLIF(item.item_code, ''), line.item) AS stock_id,
                COALESCE(NULLIF(line.item_name, ''), item.item_name) AS service_name,
                item.item_group AS category, line.qty AS quantity,
                line.service_charge, line.typing_charges, line.transaction_charges,
                line.gov AS govt_fee, line.tax_amount AS total_vat,
                line.discount_amount, line.net_amount AS line_total_with_vat
            FROM `tabSales Invoice` si
            JOIN `tabSales Invoice Item` line ON line.parent = si.name
                AND line.parenttype = 'Sales Invoice' AND line.parentfield = 'items'
            LEFT JOIN `tabItem` item ON item.name = line.item
            LEFT JOIN `tabEmployee` salesman ON salesman.name = si.salesman
            WHERE si.name IN %(invoices)s
        """ + where
        # Older installations may not yet store these contact / charge fields.
        if "customer_mobile_number" not in invoice_fields:
            query = query.replace("si.customer_mobile_number", "NULL")
        for field in ("service_charge", "typing_charges", "transaction_charges"):
            if field not in item_fields:
                query = query.replace(f"line.{field}", f"NULL AS {field}")
        rows = frappe.db.sql(query, params, as_dict=True)
        data.extend(rows)
    data.sort(key=lambda r: (str(r.posting_date), str(r.posting_time), r.invoice_number, r.idx))
    seen = set()
    result = []
    for row in data:
        status = payment_status(row)
        if filters.get("payment_status") and status != filters["payment_status"]:
            continue
        result.append(make_row(row, row.invoice_number not in seen))
        seen.add(row.invoice_number)
    return result


def has_value(value):
    """Zero is a valid numeric bound; blank inputs mean no restriction."""
    return value is not None and value != ""


def payment_status(row):
    if not row.get("credit_sale") or flt(row.get("paid_amount"), 2) >= flt(row.get("invoice_total"), 2):
        return "Paid"
    return "Partially Paid" if flt(row.get("paid_amount"), 2) > 0 else "Credit"


def make_row(source, first_line):
    row = dict(source)
    row["salesman"] = source.get("salesman_name") or ""
    qty = flt(row.get("quantity"))
    for field in ("total_vat", "govt_fee", "discount_amount", "line_total_with_vat", "invoice_total"):
        row[field] = flt(row.get(field))
    row["service_charge"] = flt(source["service_charge"]) if source.get("service_charge") is not None else None
    row["total_service_charge"] = flt(qty * row["service_charge"], 2) if row["service_charge"] is not None else None
    row["total_govt_fee"] = flt(qty * row["govt_fee"], 2)
    for field in ("typing_charges", "transaction_charges"):
        row[field] = flt(qty * flt(source[field]), 2) if source.get(field) is not None else None
    row["line_total"] = flt(row["line_total_with_vat"] - row["total_vat"], 2)
    row["net_service_charge"] = flt(row["line_total"] - row["total_govt_fee"], 2)
    row["round_off"] = flt(source.get("round_off")) if first_line else None
    row["additional_discount"] = flt(source.get("additional_discount")) if first_line else None
    row["card_type"] = "Credit" if source.get("credit_sale") else source.get("payment_mode") or ""
    row["payment_status"] = payment_status(source)
    return {field: row.get(field) for field, *_ in COLUMNS}
