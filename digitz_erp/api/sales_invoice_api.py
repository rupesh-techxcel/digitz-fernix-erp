import frappe
from frappe.utils import get_datetime


@frappe.whitelist()
def get_allocations_for_invoice(sales_invoice_no, receipt_no):    
    if(receipt_no ==""):        
        return frappe.db.sql("""SELECT sales_invoice,parent,invoice_amount,paying_amount FROM `tabReceipt Allocation` ra inner join `tabSales Invoice` si ON si.name= ra.sales_invoice WHERE ra.sales_invoice = '{0}' AND (ra.docstatus= 1 or ra.docstatus=0) ORDER BY ra.sales_invoice """.format(sales_invoice_no),as_dict=1)    
    else:
        return frappe.db.sql("""SELECT sales_invoice,parent,invoice_amount,paying_amount FROM `tabReceipt Allocation` ra  join `tabSales Invoice` si ON si.name= ra.sales_invoice WHERE ra.sales_invoice = '{0}' AND parent!='{1}' AND (ra.docstatus= 1 or ra.docstatus=0) ORDER BY ra.sales_invoice """.format(sales_invoice_no,receipt_no),as_dict=1)

@frappe.whitelist()
def submit_sales_invoice(docname):    
    doc = frappe.get_doc('Sales Invoice',docname)    
    doc.submit()
    
@frappe.whitelist()
def get_sales_invoices_for_return(customer):
    """Submitted invoices for a customer that still have qty left to return.

    The pending test used to be `qty_returned_in_base_unit < qty_in_base_unit`. That
    silently returned nothing for most invoices: qty_in_base_unit was written by the
    client as `qty * conversion_factor`, and conversion_factor is 0 on the majority of
    historical rows, so the column holds 0 and `0 < 0` is false. Units are not used in
    this app - conversion_factor has only ever been 0 or 1, and wherever it is 1 the
    base-unit column already equals qty - so comparing against `qty` is equivalent for
    every row that was stored correctly and additionally rescues the ones that were not.
    """
    return frappe.db.sql("""
        SELECT DISTINCT si.name, si.customer, si.posting_date, si.rounded_total
        FROM `tabSales Invoice Item` sii
        INNER JOIN `tabSales Invoice` si ON si.name = sii.parent
        WHERE si.customer = %(customer)s
          AND si.docstatus = 1
          AND IFNULL(sii.qty_returned_in_base_unit, 0) < IFNULL(sii.qty, 0)
        ORDER BY si.posting_date DESC, si.name DESC
    """, {"customer": customer}, as_dict=1)

@frappe.whitelist()
def get_sales_line_items_for_return(sales_invoice):
    """The still-returnable lines of one invoice.

    Every conversion_factor term is gone. Units are not used in this app, and on rows
    where the factor is 0 the old expressions produced garbage: `rate * 0`, `service_charge * 0`,
    `typing_charges * 0`, `transaction_charges * 0` and `gov * 0` all collapsed to 0, and dividing by it made the outstanding qty NULL.
    Rate, Service Charge, Typing Charges, Transaction Charges and GOV are returned as stored, and the outstanding qty is simply
    qty - qty_returned. conversion_factor is reported as 1 so the caller's row is
    consistent with what the Sales Return form now writes.
    """
    return frappe.db.sql("""
        SELECT si.name AS si_item_reference,
               si.item, si.item_name, si.display_name,
               si.unit, si.base_unit,
               si.rate,
               -- Sales Return derives its line rate as Service Charge + Typing + Transaction Charges + GOV,
               -- so the components handed back have to add up to what the invoice actually
               -- charged. `rate` is the arbiter: on every line checked it agrees with
               -- net_amount, whereas the components can disagree with both - some legacy
               -- lines have none at all, and others carry a split that was back-filled
               -- from the Item master and does not match what was billed (e.g. rate 32.45
               -- against components of 387.00, which would refund more than ten times the
               -- amount charged).
               --
               -- So: keep the stored split when it reconciles with the rate, and
               -- otherwise fall back to the whole rate as Service Charge. Either way the
               -- components add up to the rate, and the return can never refund an amount
               -- the invoice did not charge.
               CASE WHEN ABS(si.rate - (IFNULL(si.service_charge, 0) + IFNULL(si.typing_charges, 0) + IFNULL(si.transaction_charges, 0) + IFNULL(si.gov, 0))) <= 0.005
                    THEN IFNULL(si.service_charge, 0) ELSE si.rate END AS service_charge,
               CASE WHEN ABS(si.rate - (IFNULL(si.service_charge, 0) + IFNULL(si.typing_charges, 0) + IFNULL(si.transaction_charges, 0) + IFNULL(si.gov, 0))) <= 0.005
                    THEN IFNULL(si.typing_charges, 0) ELSE 0 END AS typing_charges,
               CASE WHEN ABS(si.rate - (IFNULL(si.service_charge, 0) + IFNULL(si.typing_charges, 0) + IFNULL(si.transaction_charges, 0) + IFNULL(si.gov, 0))) <= 0.005
                    THEN IFNULL(si.transaction_charges, 0) ELSE 0 END AS transaction_charges,
               CASE WHEN ABS(si.rate - (IFNULL(si.service_charge, 0) + IFNULL(si.typing_charges, 0) + IFNULL(si.transaction_charges, 0) + IFNULL(si.gov, 0))) <= 0.005
                    THEN IFNULL(si.gov, 0) ELSE 0 END AS gov,
               si.qty - IFNULL(si.qty_returned_in_base_unit, 0) AS qty,
               si.qty - IFNULL(si.qty_returned_in_base_unit, 0) AS qty_in_base_unit,
               1 AS conversion_factor,
               si.rate AS rate_in_base_unit,
               si.tax, si.tax_rate, si.rate_includes_tax,
               si.tax_excluded, si.discount_amount, si.discount_percentage
        FROM `tabSales Invoice Item` si
        WHERE si.parent = %(sales_invoice)s
          AND IFNULL(si.qty_returned_in_base_unit, 0) < IFNULL(si.qty, 0)
        ORDER BY si.idx
    """, {"sales_invoice": sales_invoice}, as_dict=1)

@frappe.whitelist()
def get_pending_invoices_for_customer(customer):
    result = frappe.db.sql("""SELECT si.name as 'sales_invoice', si.posting_date as date, si.rounded_total as amount,si.paid_amount, si.rounded_total-si.paid_amount as balance_amount where si.customer='%s' and si.docstatus=1 and si.paid_amount< si.rounded_total""" .format(customer))
    return result


    
@frappe.whitelist()
def generate_sales_invoice_for_delivery_note(delivery_note: str):
    sales_invoice_name = ""
    doc = frappe.get_doc("Delivery Note",delivery_note)
    deliveryNoteName =  doc.name
    sales_invoice = doc.__dict__
    sales_invoice['doctype'] = 'Sales Invoice'
    sales_invoice['name'] = sales_invoice_name
    sales_invoice['naming_series'] = ""
    sales_invoice['posting_date'] = doc.posting_date
    sales_invoice['posting_time'] = doc.posting_time
    sales_invoice['delivery_notes_to_print'] =deliveryNoteName
    # Change the document status to draft to avoid error while submitting child table
    sales_invoice['docstatus'] = 0
    for item in sales_invoice['items']:
        item.doctype = "Sales Invoice Item"
        item.delivery_note_item_reference_no = item.name
        item._meta = ""

    sales_invoice_doc = frappe.get_doc(
        sales_invoice).insert(ignore_permissions=True)

    frappe.db.commit()

    #print(sales_invoice_doc.name)

    si =  frappe.get_doc('Sales Invoice',sales_invoice_doc.name)

    # Add reference link to the 'Sales Invoice Delivery NOtes' child doctype

    si.append('delivery_notes', {'delivery_note': deliveryNoteName})

    # si.docstatus = 1

    si.save()
    return {"si_name": si.name}







def get_sales_invoice_permission_query(user):
    if not user or user == "Administrator":
        return None  # Full access for Administrator

    roles = frappe.get_roles(user)

    # Cashier Approver supervises billing for the whole counter, so it sees
    # every invoice, not just its own. Checked before Cashier because an
    # approver usually holds both roles -- Cashier Approver alone reaches
    # nothing but Sales Invoice -- and the narrower role must not win.
    if "Cashier Approver" in roles:
        return None

    if "Cashier" not in roles:
        return None  # None = no filter, full access

    # Otherwise, restrict to only their own records
    return f"`tabSales Invoice`.owner = {frappe.db.escape(user)}"


# ------------------------------------------------------------ cashier correction
# A cashier corrects a submitted credit invoice, of any date, by taking it back
# to draft under the same number, editing it and submitting it again. Only where
# that is clean: a credit sale (no cash in any till) with no payment, return, stock
# or project tied to it. Anything else is for a supervisor (Cancel / Amend, or
# Revert To Draft). A corrected invoice keeps its date when submitted again,
# however old (is_under_correction, counter_session_api.restrict_cashier_posting_date).

CORRECTION_COMMENT = "Taken back to draft for correction"


def correction_date(doc):
    """The posting date a cashier's correction of `doc` keeps, or None when `doc`
    is not a draft taken back for correction."""
    if doc.is_new() or doc.docstatus != 0:
        return None
    if not frappe.db.exists("Comment", {"reference_doctype": doc.doctype, "reference_name": doc.name,
            "comment_type": "Comment", "content": ("like", f"{CORRECTION_COMMENT}%")}):
        return None
    return frappe.db.get_value(doc.doctype, doc.name, "posting_date")


def correction_blocked_reason(doc):
    """Why `doc` cannot be corrected by a cashier, or None when it can."""
    from frappe.utils import flt

    from digitz_erp.api.receipt_entry_api import get_allocations_for_sales_invoice

    name = doc.name
    if doc.docstatus != 1:
        return f"{name} is not submitted. Only a submitted invoice is corrected this way; a draft can be edited as it is."
    if not doc.credit_sale:
        return (f"{name} is a cash sale. Only credit sale invoices can be corrected: a cash sale's money is "
                "already in the till and the day's count. Ask a supervisor.")

    receipts = sorted({a.receipt_no for a in get_allocations_for_sales_invoice(name, "") if a.get("receipt_no")})
    if receipts or flt(doc.paid_amount) > 0:
        return (f"A payment is recorded against {name}" + (f" ({', '.join(receipts)})" if receipts else "")
                + ". Ask a supervisor to correct it.")

    returns = frappe.get_all("Sales Return Invoices", filters={"sales_invoice": name, "docstatus": ("<", 2)}, pluck="parent")
    if returns:
        return f"{name} has a Sales Return ({', '.join(sorted(set(returns)))}). Ask a supervisor to correct it."

    if doc.update_stock or doc.tab_sales or frappe.db.exists("Stock Ledger", {"voucher": "Sales Invoice", "voucher_no": name}):
        return f"{name} updated stock. Ask a supervisor to correct it."

    if doc.project or doc.sales_order or doc.for_advance_payment or doc.get("delivery_notes"):
        return f"{name} is linked to a project, sales order or delivery note. Ask a supervisor to correct it."

    return None


@frappe.whitelist()
def correct_sales_invoice(docname, check_only=0):
    """The cashier's Correct: a submitted credit invoice, of any date, goes back
    to draft under the same number. With check_only, only says whether it may
    (the reason is thrown when not)."""
    from frappe.utils import cint

    from digitz_erp.api.bank_reconciliation_api import cancel_bank_reconciliation
    from digitz_erp.api.gl_posting_api import update_accounts_for_doc_type
    from digitz_erp.selling.doctype.sales_invoice.sales_invoice import get_utilized_credit

    if "Cashier" not in frappe.get_roles():
        frappe.throw("Correct is the cashier's option. A supervisor uses Revert To Draft or Cancel / Amend.",
                     frappe.PermissionError)

    doc = frappe.get_doc("Sales Invoice", docname)
    doc.check_permission("write")
    reason = correction_blocked_reason(doc)
    if reason:
        frappe.throw(reason, title="Cannot Correct This Invoice")
    if cint(check_only):
        return {"ok": True}

    # Undo what submitting posted: its GL Postings (and the account balances built
    # from them), any bank reconciliation row and its posting-status record
    frappe.db.delete("GL Posting", {"voucher_type": "Sales Invoice", "voucher_no": doc.name})
    cancel_bank_reconciliation("Sales Invoice", doc.name)
    frappe.db.delete("Document Posting Status", {"document_type": "Sales Invoice", "document_name": doc.name})

    # Back to draft, the child rows with it, so it saves and submits as any draft
    for df in doc.meta.get_table_fields():
        frappe.db.sql(f"UPDATE `tab{df.options}` SET docstatus = 0 WHERE parenttype = %s AND parent = %s",
                      ("Sales Invoice", doc.name))
    frappe.db.set_value("Sales Invoice", doc.name, "docstatus", 0, update_modified=False)
    update_accounts_for_doc_type("Sales Invoice", doc.name)

    # A draft is not a debt: the customer's used credit drops by this invoice
    frappe.db.set_value("Customer", doc.customer, "utilized_credit", get_utilized_credit(doc.customer),
                        update_modified=False)

    doc.add_comment("Comment", f"{CORRECTION_COMMENT} by {frappe.utils.get_fullname(frappe.session.user)}.")
    return {"ok": True, "name": doc.name}
