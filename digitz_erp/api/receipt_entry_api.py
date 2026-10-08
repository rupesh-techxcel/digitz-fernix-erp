import frappe
from frappe.utils import flt, get_datetime, getdate
import json

@frappe.whitelist()
def get_customer_pending_documents(customer, reference_type, receipt_no,only_unpaid=False, exclude_advance_in_the_other_document=False):
    
    print("reference type")
    print(reference_type)
    
    filter_paid_condition = "AND paid_amount = 0" if only_unpaid else ""
    
    exclude_advance_invoices_condition = "AND (advance_received_with_sales_order = 0 OR advance_received_with_sales_order IS NULL)" if exclude_advance_in_the_other_document else "" if exclude_advance_in_the_other_document else ""
    
    exclude_advance_orders_condition = "AND (advance_received_with_sales_invoice = 0 OR advance_received_with_sales_invoice IS NULL)" if exclude_advance_in_the_other_document else "" if exclude_advance_in_the_other_document else ""

    if reference_type == 'Sales Invoice':

        # Committed credit sales invoices with a balance, plus (below) those already
        # allocated in this receipt even when fully paid
        documents_values = frappe.db.sql("""
            SELECT
                customer,
                'Sales Invoice' as reference_type,
                name as reference_name,
                CONCAT(COALESCE(reference_no, ''), ' ', DATE_FORMAT(posting_date, '%%Y-%%m-%%d')) as reference_no,
                posting_date,
                paid_amount,
                rounded_total as invoice_amount,
                rounded_total - paid_amount as balance_amount
            FROM
                `tabSales Invoice`
            WHERE
                customer = %(customer)s
                AND docstatus = 1
                AND credit_sale = 1
                AND rounded_total > paid_amount
                {0}{1}
            ORDER BY posting_date
        """.format(filter_paid_condition, exclude_advance_invoices_condition), {"customer": customer}, as_dict=1)

        receipt_allocation_values = []
        if receipt_no != "":
            receipt_allocation_values = frappe.db.sql("""
                SELECT DISTINCT
                    si.customer,
                    si.name as reference_name,
                    'Sales Invoice' as reference_type,
                    CONCAT(COALESCE(si.reference_no, ''), ' ', DATE_FORMAT(si.posting_date, '%%Y-%%m-%%d')) as reference_no,
                    si.posting_date,
                    si.paid_amount,
                    si.rounded_total as invoice_amount,
                    si.rounded_total - si.paid_amount as balance_amount
                FROM
                    `tabSales Invoice` si
                JOIN
                    `tabReceipt Allocation` ra ON si.name = ra.reference_name and ra.reference_type='Sales Invoice'
                WHERE
                    si.customer = %(customer)s
                    AND si.docstatus = 1
                    AND si.credit_sale = 1
                    AND ra.parent = %(receipt_no)s
                    AND (ra.docstatus = 0 or ra.docstatus = 1)
                ORDER BY si.posting_date
            """, {"customer": customer, "receipt_no": receipt_no}, as_dict=1)

        return combine_pending_documents(documents_values, receipt_allocation_values)

    elif reference_type == 'Sales Order':

        # Sales Invoice Query , only consider committed sales invoices but for payment allocations with draft and committed statuses.

        # Get all pending receipts for the customer
        documents_query = """
            SELECT
                customer,
                'Sales Order' as reference_type,
                name as reference_name,
                CONCAT(COALESCE(reference_no, ''), ' ', DATE_FORMAT(posting_date, '%Y-%m-%d')) as reference_no,
                posting_date,
                paid_amount,
                rounded_total as invoice_amount,
                rounded_total - paid_amount as balance_amount
            FROM
                `tabSales Order`
            WHERE
                customer = '{0}'
                AND docstatus = 1
                AND credit_sale = 1
                AND rounded_total > paid_amount
                {1}
        """.format(customer,exclude_advance_orders_condition)

        # Additional Query for Receipt Allocation (if receipt_no is not None)
        receipt_allocation_values = []
        if receipt_no != "":
             # receipt_allocation_query to include the existing allocations for this receipt, irrespective of qty is pending
            receipt_allocation_query = """
                SELECT
                    si.customer,
                    si.name as reference_name,
                    'Sales Order' as reference_type,                    
                    CONCAT(COALESCE(si.reference_no, ''), ' ', DATE_FORMAT(si.posting_date, '%Y-%m-%d')) as reference_no,                    
                    si.posting_date,
                    si.paid_amount,
                    si.rounded_total as invoice_amount,
                    si.rounded_total - si.paid_amount as balance_amount
                FROM
                    `tabSales Order` si
                JOIN
                    `tabReceipt Allocation` ra ON si.name = ra.reference_name and ra.reference_type='Sales Order'
                WHERE
                    si.customer = '{0}'
                    AND si.docstatus = 1
                    AND si.credit_sale = 1
                    AND ra.parent = '{1}'
                    AND (ra.docstatus = 0 or ra.docstatus = 1)
            """.format(customer, receipt_no)

            receipt_allocation_values = frappe.db.sql(receipt_allocation_query, as_dict=1)
            #print("receipt allocation values")
            #print(receipt_allocation_values)

        documents_values = frappe.db.sql(documents_query, as_dict=1)
        #print("documents_values")
        #print(documents_values)

        if receipt_allocation_values !=[]:
            #  Avoid duplicates before combine
            documents_values = [invoice for invoice in documents_values if invoice['reference_name'] not in [ra['reference_name'] for ra in receipt_allocation_values]]

            # Combine Results
            combined_values = documents_values + receipt_allocation_values
            return combined_values
        else:
            return documents_values
    
    elif reference_type == 'Progressive Sales Invoice':

        # Sales Invoice Query , only consider committed sales invoices but for payment allocations with draft and committed statuses.

        # Get all pending receipts for the customer
        documents_query = """
            SELECT
                customer,
                'Progressive Sales Invoice' as reference_type,
                name as reference_name,
                CONCAT(COALESCE(reference_no, ''), ' ', DATE_FORMAT(posting_date, '%Y-%m-%d')) as reference_no,
                posting_date,
                paid_amount,
                rounded_total as invoice_amount,
                rounded_total - paid_amount as balance_amount
            FROM
                `tabProgressive Sales Invoice`
            WHERE
                customer = '{0}'
                AND docstatus = 1
                AND credit_sale = 1
                AND rounded_total > COALESCE(paid_amount, 0)
                {1}
                order by posting_date
        """.format(customer,filter_paid_condition)

        # Additional Query for Receipt Allocation (if receipt_no is not None)
        receipt_allocation_values = []
        if receipt_no != "":
             # receipt_allocation_query to include the existing allocations for this receipt, irrespective of qty is pending
            receipt_allocation_query = """
                SELECT
                    si.customer,
                    si.name as reference_name,
                    'Progressive Sales Invoice' as reference_type,                    
                    CONCAT(COALESCE(si.reference_no, ''), ' ', DATE_FORMAT(si.posting_date, '%Y-%m-%d')) as reference_no,                    
                    si.posting_date,
                    si.paid_amount,
                    si.rounded_total as invoice_amount,
                    si.rounded_total - si.paid_amount as balance_amount
                FROM
                    `tabProgressive Sales Invoice` si
                JOIN
                    `tabReceipt Allocation` ra ON si.name = ra.reference_name and ra.reference_type='Sales Invoice'
                WHERE
                    si.customer = '{0}'
                    AND si.docstatus = 1
                    AND si.credit_sale = 1
                    AND ra.parent = '{1}'
                    AND (ra.docstatus = 0 or ra.docstatus = 1)
            """.format(customer, receipt_no)

            receipt_allocation_values = frappe.db.sql(receipt_allocation_query, as_dict=1)
            #print("receipt allocation values")
            #print(receipt_allocation_values)

        print("documents_query")
        print(documents_query)
        
        documents_values = frappe.db.sql(documents_query, as_dict=1)        
        
        print("documents_values")
        print(documents_values)

        if receipt_allocation_values !=[]:
            #  Avoid duplicates before combine
            documents_values = [invoice for invoice in documents_values if invoice['reference_name'] not in [ra['reference_name'] for ra in receipt_allocation_values]]

            # Combine Results
            combined_values = documents_values + receipt_allocation_values
            return combined_values
        else:
            return documents_values

    elif reference_type == 'Sales Return':
        documents_values = frappe.db.sql("""
            SELECT
                customer,
                'Sales Return' as reference_type,
                name as reference_name,
                CONCAT(COALESCE(reference_no, ''), ' ', DATE_FORMAT(posting_date, '%%Y-%%m-%%d')) as reference_no,
                posting_date as date,
                paid_amount,
                rounded_total as invoice_amount,
                rounded_total - paid_amount as balance_amount
            FROM
                `tabSales Return`
            WHERE
                customer = %(customer)s
                AND docstatus = 1
                AND credit_sale = 1
                AND rounded_total > paid_amount
        """, {"customer": customer}, as_dict=1)

        receipt_allocation_values = []
        if receipt_no != "":
            receipt_allocation_values = frappe.db.sql("""
                SELECT DISTINCT
                    sr.customer,
                    sr.name as reference_name,
                    'Sales Return' as reference_type,
                    CONCAT(COALESCE(sr.reference_no, ''), ' ', DATE_FORMAT(sr.posting_date, '%%Y-%%m-%%d')) as reference_no,
                    sr.posting_date as date,
                    sr.paid_amount,
                    sr.rounded_total as invoice_amount,
                    sr.rounded_total - sr.paid_amount as balance_amount
                FROM
                    `tabSales Return` sr
                JOIN
                    `tabReceipt Allocation` ra ON sr.name = ra.reference_name and ra.reference_type='Sales Return'
                WHERE
                    sr.customer = %(customer)s
                    AND sr.docstatus = 1
                    AND sr.credit_sale = 1
                    AND ra.parent = %(receipt_no)s
                    AND (ra.docstatus = 0 or ra.docstatus = 1)
            """, {"customer": customer, "receipt_no": receipt_no}, as_dict=1)

        return combine_pending_documents(documents_values, receipt_allocation_values)

    elif reference_type == 'Credit Note':
        documents_values = frappe.db.sql("""
            SELECT
                customer,
                'Credit Note' as reference_type,
                name as reference_name,
                CONCAT(COALESCE(reference_no, ''), ' ', DATE_FORMAT(posting_date, '%%Y-%%m-%%d')) as reference_no,
                posting_date as date,
                paid_amount,
                grand_total as invoice_amount,
                grand_total - paid_amount as balance_amount
            FROM
                `tabCredit Note`
            WHERE
                customer = %(customer)s
                AND docstatus = 1
                AND on_credit = 1
                AND grand_total > paid_amount
        """, {"customer": customer}, as_dict=1)

        receipt_allocation_values = []
        if receipt_no != "":
            receipt_allocation_values = frappe.db.sql("""
                SELECT DISTINCT
                    cn.customer,
                    cn.name as reference_name,
                    'Credit Note' as reference_type,
                    CONCAT(COALESCE(cn.reference_no, ''), ' ', DATE_FORMAT(cn.posting_date, '%%Y-%%m-%%d')) as reference_no,
                    cn.posting_date as date,
                    cn.paid_amount,
                    cn.grand_total as invoice_amount,
                    cn.grand_total - cn.paid_amount as balance_amount
                FROM
                    `tabCredit Note` cn
                JOIN
                    `tabReceipt Allocation` ra ON cn.name = ra.reference_name and ra.reference_type='Credit Note'
                WHERE
                    cn.customer = %(customer)s
                    AND cn.docstatus = 1
                    AND cn.on_credit = 1
                    AND ra.parent = %(receipt_no)s
                    AND (ra.docstatus = 0 or ra.docstatus = 1)
            """, {"customer": customer, "receipt_no": receipt_no}, as_dict=1)

        return combine_pending_documents(documents_values, receipt_allocation_values)


def combine_pending_documents(documents_values, receipt_allocation_values):
    """Pending documents plus those already allocated in this receipt, each once."""
    allocated = {ra['reference_name'] for ra in receipt_allocation_values}
    return [d for d in documents_values if d['reference_name'] not in allocated] + receipt_allocation_values

# Get all supplier other payment allocations which is still pending, to reconcile with the payment entry allocations to refresh the balances and pending of each documents. This calls in the stage 1 (as per the comment in the payment entry) of the loading of pending payments.
# Eg: Suppose the purchase invoice has total amount 1000 and 500 alocated in a payment entry. To create a new payment entry it requires to check the existing payment entires (other than the current payment entry) to get the actual balance of the invoice ie, 500 in the example. Here also only pending allocations are considering because if it is fully paid , in the initial call (with get_supplier_pending_documents) it only fetch pending documents and comparing only those documents
@frappe.whitelist()
def get_all_customer_pending_receipt_allocations_with_other_receipts(customer, reference_type, receipt_no):

    if reference_type == 'Sales Invoice':
        return {'values': other_receipt_allocations('Sales Invoice', 'rounded_total', customer, receipt_no)}

    elif reference_type == 'Sales Order':
        values = frappe.db.sql("""SELECT distinct ra.reference_name,ra.parent as receipt_no,si.rounded_total as invoice_amount,ra.paying_amount FROM `tabReceipt Allocation` ra inner join `tabSales Order` si ON si.name= ra.reference_name and ra.reference_type='Sales Order' WHERE ra.customer = '{0}' AND ra.parent!='{1}' AND si.docstatus=1 AND (ra.docstatus= 1 or ra.docstatus=0) AND ((si.paid_amount<si.rounded_total) or si.name in (select distinct reference_name from `tabReceipt Allocation` where reference_type='Sales Order' and parent='{1}')) ORDER BY ra.reference_name """.format(customer, receipt_no),as_dict=1)
                
        return {'values': values}
    
    elif reference_type == 'Progressive Sales Invoice':
        values = frappe.db.sql("""SELECT distinct ra.reference_name,ra.parent as receipt_no,si.rounded_total as invoice_amount,ra.paying_amount FROM `tabReceipt Allocation` ra inner join `tabProgressive Sales Invoice` si ON si.name= ra.reference_name and ra.reference_type='Progressive Sales Invoice' WHERE ra.customer = '{0}' AND ra.parent!='{1}' AND si.docstatus=1 AND (ra.docstatus= 1 or ra.docstatus=0) AND ((si.paid_amount<si.rounded_total) or si.name in (select distinct reference_name from `tabReceipt Allocation` where reference_type='Sales Invoice' and parent='{1}')) ORDER BY ra.reference_name """.format(customer, receipt_no),as_dict=1)
                
        return {'values': values}

    elif reference_type == 'Sales Return':
        return {'values': other_receipt_allocations('Sales Return', 'rounded_total', customer, receipt_no)}

    elif reference_type == 'Credit Note':
        return {'values': other_receipt_allocations('Credit Note', 'grand_total', customer, receipt_no)}


def other_receipt_allocations(doctype, total_field, customer, receipt_no):
    """Allocations of `customer`'s documents of `doctype` in receipts other than
    `receipt_no` (drafts included), for documents still pending or allocated in
    `receipt_no`."""
    return frappe.db.sql(f"""
        SELECT DISTINCT ra.reference_name, ra.parent as receipt_no, d.`{total_field}` as invoice_amount, ra.paying_amount
        FROM `tabReceipt Allocation` ra
        INNER JOIN `tab{doctype}` d ON d.name = ra.reference_name AND ra.reference_type = %(doctype)s
        WHERE ra.customer = %(customer)s AND ra.parent != %(receipt_no)s AND d.docstatus = 1
            AND (ra.docstatus = 1 OR ra.docstatus = 0)
            AND (d.paid_amount < d.`{total_field}` OR d.name IN (
                SELECT DISTINCT reference_name FROM `tabReceipt Allocation`
                WHERE reference_type = %(doctype)s AND parent = %(receipt_no)s))
        ORDER BY ra.reference_name
    """, {"doctype": doctype, "customer": customer, "receipt_no": receipt_no or ""}, as_dict=1)


@frappe.whitelist()
def get_allocations_for_sales_invoice(sales_invoice_no, receipt_no, submitted_only=False):
    return get_document_allocations("Sales Invoice", "rounded_total", sales_invoice_no, receipt_no, submitted_only)

@frappe.whitelist()
def get_allocations_for_progressive_sales_invoice(sales_invoice_no, receipt_no):
    if(receipt_no ==""):
        return frappe.db.sql("""SELECT ra.reference_name,ra.parent as receipt_no,si.rounded_total as invoice_amount,ra.paying_amount FROM `tabReceipt Allocation` ra inner join `tabProgressive Sales Invoice` si ON si.name= ra.reference_name AND ra.reference_type='Sales Invoice' WHERE ra.reference_name = '{0}' AND (ra.docstatus= 1 or ra.docstatus = 0) AND si.docstatus=1 ORDER BY ra.reference_name """.format(sales_invoice_no),as_dict=1)
    else:
        # Note that the parent!{0} means it fetches the allocations for the invoice not in the current payment entry but from the other existing payment entries

        return frappe.db.sql("""SELECT ra.reference_name,ra.parent as receipt_no,si.rounded_total as invoice_amount,ra.paying_amount FROM `tabReceipt Allocation` ra inner join `tabProgressive Sales Invoice` si ON si.name= ra.reference_name AND ra.reference_type='Sales Invoice' WHERE ra.reference_name = '{0}' AND ra.parent!='{1}' AND (ra.docstatus= 1 or ra.docstatus = 0) AND si.docstatus=1 ORDER BY ra.reference_name """.format(sales_invoice_no, receipt_no),as_dict=1)

@frappe.whitelist()
def get_allocations_for_sales_return(sales_invoice_no, receipt_no, submitted_only=False):
    return get_document_allocations("Sales Return", "rounded_total", sales_invoice_no, receipt_no, submitted_only)

@frappe.whitelist()
def get_allocations_for_credit_note(credit_note_no, receipt_no, submitted_only=False):
    return get_document_allocations("Credit Note", "grand_total", credit_note_no, receipt_no, submitted_only)

def get_document_allocations(doctype, total_field, document_no, receipt_no, submitted_only=False):
    """The allocations of a submitted `doctype` document in receipts other than
    `receipt_no` (all receipts when it is ""). Drafts are included unless
    `submitted_only`: they hold the balance for the popup and the excess check,
    but only submitted receipts make the document paid."""
    docstatus = "ra.docstatus = 1" if frappe.utils.cint(submitted_only) else "(ra.docstatus = 1 OR ra.docstatus = 0)"
    return frappe.db.sql(f"""
        SELECT ra.reference_name, ra.parent as receipt_no, d.`{total_field}` as invoice_amount, ra.paying_amount
        FROM `tabReceipt Allocation` ra
        INNER JOIN `tab{doctype}` d ON d.name = ra.reference_name AND ra.reference_type = %(doctype)s
        WHERE ra.reference_name = %(document_no)s AND ra.parent != %(receipt_no)s AND {docstatus} AND d.docstatus = 1
        ORDER BY ra.reference_name
    """, {"doctype": doctype, "document_no": document_no, "receipt_no": receipt_no or ""}, as_dict=1)

@frappe.whitelist()
def get_receipts_unallocated(customer):
    # Get 'On Account' and 'Sales Order' data for the customer
    # Note that for 'On Account' there is no entries in the 'Receipt Allocation' table so in 'Receipt Reconciliation' there is no replacing required for 'On Account' records
    
    #  Open issue related to this method. Now only 'Receipt Entry Detail' is fetching and not allocation, so it does not give reference_name eg: sales order number and hence cannot specifically allocate as well. So this works for receipt entries which congains only one sales order record as there is no way to find out the matching sales order.
    data = frappe.db.sql("""
        SELECT 
            trd.parent as receipt_no, 
            trd.reference_type,            
            tr.posting_date as receipt_date,
            trd.amount as receipt_amount            
        FROM 
            `tabReceipt Entry Detail` trd 
        INNER JOIN 
            `tabReceipt Entry` tr 
        ON 
            tr.name = trd.parent  
        WHERE 
            trd.receipt_type = 'Customer' and trd.customer = %s 
            AND (trd.reference_type = 'On Account' OR trd.reference_type = 'Sales Order')
    """, (customer), as_dict=True)

    return data

@frappe.whitelist()
def get_project_for_allocation(doc_type, doc_name):
    """
    Retrieve the associated project based on the document type and document name.
    """
    project = None

    # Check for valid document types
    if doc_type in ["Sales Invoice", "Progressive Sales Invoice", "Credit Note", "Sales Return"]:
        # Retrieve the project field from the given document type and name
        project = frappe.get_value(doc_type, doc_name, "project")  # Ensure the field name matches your database schema
    elif doc_type == "Sales Order":
        # Retrieve the project associated with a Sales Order
        project = frappe.get_value("Project", {"sales_order": doc_name}, "name")
    
    return project



@frappe.whitelist()
def get_console_receivables(customer, receipt_no=""):
    """The Cashier Console's receipt screen: `customer`'s credit Sales Invoices
    still to be paid, oldest first, as the Receipt Entry allocation popup works
    them out.

    Each row's `paid_amount` is what other receipts (drafts included) have
    allocated to it, `balance_amount` what is left for this receipt, and
    `paying_amount` what `receipt_no` (when given) allocates to it now. Invoices
    raised for an advance payment are left out: they post to the advance account.
    """
    frappe.has_permission("Receipt Entry", "create", throw=True)
    receipt_no = receipt_no or ""

    documents = get_customer_pending_documents(customer, "Sales Invoice", receipt_no,
        exclude_advance_in_the_other_document=True)
    if not documents:
        return []

    paid_by_others = {}
    for allocation in other_receipt_allocations("Sales Invoice", "rounded_total", customer, receipt_no):
        paid_by_others[allocation.reference_name] = paid_by_others.get(allocation.reference_name, 0) + flt(allocation.paying_amount)

    paying_here = {}
    if receipt_no:
        for allocation in frappe.get_all("Receipt Allocation",
                filters={"parent": receipt_no, "parenttype": "Receipt Entry", "reference_type": "Sales Invoice"},
                fields=["reference_name", "paying_amount"]):
            paying_here[allocation.reference_name] = paying_here.get(allocation.reference_name, 0) + flt(allocation.paying_amount)

    details = {d.name: d for d in frappe.get_all("Sales Invoice",
        filters={"name": ["in", [d.reference_name for d in documents]]},
        fields=["name", "project", "for_advance_payment", "customer_display_name"])}

    rows = []
    for d in documents:
        info = details.get(d.reference_name) or frappe._dict()
        if info.for_advance_payment:
            continue
        paid = flt(paid_by_others.get(d.reference_name), 2)
        balance = flt(flt(d.invoice_amount) - paid, 2)
        paying = flt(paying_here.get(d.reference_name), 2)
        if balance <= 0 and not paying:
            continue
        rows.append(frappe._dict(
            reference_name=d.reference_name,
            reference_no=(d.reference_no or "").strip(),
            posting_date=d.posting_date,
            customer_display_name=info.customer_display_name,
            invoice_amount=flt(d.invoice_amount, 2),
            paid_amount=paid,
            balance_amount=balance,
            paying_amount=paying,
            project=info.project,
        ))

    rows.sort(key=lambda r: (getdate(r.posting_date), r.reference_name))
    return rows


@frappe.whitelist()
def get_console_receipt_defaults():
    """What the Receipt Entry form fills in on a new receipt: the company, the
    user's warehouse (else the company's) and the receivable account."""
    frappe.has_permission("Receipt Entry", "create", throw=True)
    company = frappe.db.get_single_value("Global Settings", "default_company")
    values = frappe.db.get_value("Company", company, ["default_warehouse", "default_receivable_account"], as_dict=True) or frappe._dict()
    warehouse = frappe.db.get_value("User Warehouse", {"user": frappe.session.user}, "warehouse")
    return {
        "company": company,
        "warehouse": warehouse or values.default_warehouse,
        "receivable_account": values.default_receivable_account,
    }


@frappe.whitelist()
def get_quick_receipt_info(sales_invoice):
    """What the Cashier Console's Record Payment shows for a submitted credit
    invoice: its total, what submitted receipts have paid, what draft receipts
    hold, and the balance a new receipt can take."""
    frappe.has_permission("Receipt Entry", "create", throw=True)
    si = get_quick_receipt_invoice(sales_invoice)

    row = next((r for r in get_console_receivables(si.customer) if r.reference_name == si.name), None)
    balance = row.balance_amount if row else 0
    paid = flt(si.paid_amount, 2)

    return {
        "sales_invoice": si.name,
        "customer": si.customer,
        "customer_display_name": si.customer_display_name,
        "invoice_amount": flt(si.rounded_total, 2),
        "paid_amount": paid,
        # Allocated in receipts not yet submitted: not paid, but not available either
        "held_by_drafts": flt(flt(si.rounded_total) - paid - balance, 2) if row else 0,
        "balance_amount": balance,
        "payment_mode": frappe.db.get_value("Payment Mode", {"mode": "Cash"}, "name"),
    }


@frappe.whitelist()
def create_quick_receipt(sales_invoice, amount, payment_mode, reference_no=None, reference_date=None, remarks=None):
    """Record a payment on one submitted credit invoice from the Cashier Console:
    a Receipt Entry shaped as the console's Receipts tab and the Receipt Entry
    form make one (one Customer line of type Sales Invoice, one allocation),
    saved and submitted at once. Returns the receipt's name."""
    frappe.has_permission("Receipt Entry", "create", throw=True)
    frappe.has_permission("Receipt Entry", "submit", throw=True)
    si = get_quick_receipt_invoice(sales_invoice)

    row = next((r for r in get_console_receivables(si.customer) if r.reference_name == si.name), None)
    amount = flt(amount, 2)
    if not row or row.balance_amount <= 0:
        frappe.throw(f"{si.name} has nothing left to pay. Draft receipts may hold its balance: submit or delete them first.")
    if amount <= 0:
        frappe.throw("Enter the amount received.")
    if amount > row.balance_amount:
        frappe.throw(f"{si.name}: at most {row.balance_amount} is left to pay.")

    mode = frappe.db.get_value("Payment Mode", payment_mode, ["account", "mode"], as_dict=True)
    if not mode:
        frappe.throw("Select the payment mode.")
    if not mode.account:
        frappe.throw(f"Payment mode {payment_mode} has no account set. Ask a supervisor to set it.")
    if mode.mode == "Bank" and not reference_no:
        frappe.throw("Reference No is required for a bank payment.")
    if mode.mode == "Bank":
        reference_date = reference_date or frappe.utils.nowdate()
    else:
        reference_no = reference_date = None

    defaults = get_console_receipt_defaults()
    receipt = frappe.get_doc({
        "doctype": "Receipt Entry",
        "posting_date": frappe.utils.nowdate(),
        "posting_time": frappe.utils.nowtime(),
        "company": defaults["company"],
        "warehouse": defaults["warehouse"],
        "payment_mode": payment_mode,
        "account": mode.account,
        "mode": mode.mode,
        "reference_no": reference_no,
        "reference_date": reference_date,
        "remarks": remarks,
        "amount": amount,
        "allocated_amount": amount,
        "receipt_entry_details": [{
            "receipt_type": "Customer",
            "reference_type": "Sales Invoice",
            "customer": si.customer,
            "account": defaults["receivable_account"],
            "reference_no": reference_no,
            "reference_date": reference_date,
            "amount": amount,
            "allocated_amount": amount,
        }],
        "receipt_allocation": [{
            "customer": si.customer,
            "reference_type": "Sales Invoice",
            "reference_name": si.name,
            "total_amount": row.invoice_amount,
            "paid_amount": row.paid_amount,
            "balance_amount": row.balance_amount,
            "paying_amount": amount,
            "project": row.project,
        }],
    })
    receipt.insert()
    receipt.submit()
    return receipt.name


def get_quick_receipt_invoice(sales_invoice):
    si = frappe.db.get_value("Sales Invoice", sales_invoice,
        ["name", "customer", "customer_display_name", "docstatus", "credit_sale", "for_advance_payment",
         "rounded_total", "paid_amount"], as_dict=True)
    if not si:
        frappe.throw(f"Sales Invoice {sales_invoice} not found.")
    if si.docstatus != 1 or not si.credit_sale:
        frappe.throw(f"{si.name} is not a submitted credit sale.")
    if si.for_advance_payment:
        frappe.throw(f"{si.name} is an advance payment invoice. Record its payment in the Receipt Entry form.")
    return si


def add_child_item(new_doc : object,doc: object):
    new_doc.append("receipt_entry_details", {
            "receipt_type": "Customer",
            "reference_type": "Sales Invoice",
            "reference_no": doc.name,  # Matches your JS `reference_no`
            
            "customer": doc.customer,
            "amount":  doc.rounded_total - doc.paid_amount,
            "allocated_amount":  doc.rounded_total - doc.paid_amount,
            "account": "Accounts Receivables"
        })

    # ---- Add to receipt_allocation child table ----
    new_doc.append("receipt_allocation", {
        "reference_type": "Sales Invoice",
        "reference_name": doc.name,  # Matches your JS `reference_name`
        "customer": doc.customer,
        "total_amount": doc.rounded_total,
        "balance_amount":doc.rounded_total - doc.paid_amount,
        "paid_amount": doc.paid_amount,
        "paying_amount": doc.rounded_total - doc.paid_amount,
    })


@frappe.whitelist()
def save_reciept_entry(sales_invoices: object):
    sales_invoices = json.loads(sales_invoices)
    print(sales_invoices)
    amount = 0
    allocated_amount = 0
    new_doc = frappe.new_doc("Receipt Entry")
    new_doc.payment_mode = "Cash"
    new_doc.account = "Main Cash"
    if len(sales_invoices) == 1:
        doc = frappe.get_doc("Sales Invoice", sales_invoices[0])
        if not doc.credit_sale:
                return None
        amount = doc.rounded_total - doc.paid_amount
        allocated_amount = doc.rounded_total - doc.paid_amount
        
        add_child_item(new_doc,doc)
    else:    
        for invoice in sales_invoices:
            doc = frappe.get_doc("Sales Invoice", invoice)
            if not doc.credit_sale:
                continue
            amount += (doc.rounded_total - doc.paid_amount)
            allocated_amount += (doc.rounded_total - doc.paid_amount)
           
            add_child_item(new_doc,doc)
        
   

   
    new_doc.amount = amount
    new_doc.allocated_amount = allocated_amount
    new_doc.insert(ignore_permissions=True)
    return new_doc.name