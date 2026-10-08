import frappe
from frappe.utils import get_datetime
from digitz_erp.api.settings_api import get_default_currency
from datetime import datetime
from frappe.utils import getdate, flt
import json

@frappe.whitelist()
def update_item_price(item, price_list, currency, rate, date):
   
    # Check if there's a matching Item Price record for the given item, price_list, currency, and date
    item_price = frappe.get_all("Item Price", filters={
        "item": item,
        "price_list": price_list,
        "currency": currency,
    }, fields=["rate","name","from_date", "to_date"])    
    
    date = str(date)
    
    date = datetime.strptime(date, '%Y-%m-%d').date()  # Convert date to datetime object
   
    item_price_doc_no_dates_name = ""

    if item_price:
        for ip in item_price:           
            
            if ip.from_date and ip.to_date:
                if ip.from_date <= date and ip.to_date >=date:                    
                    item_price_with_dates =frappe.get_doc("Item Price", ip.name)
                    item_price_with_dates.rate = rate
                    item_price_with_dates.save()
                    return
             
            if(ip.from_date == None and ip.to_date == None):
                 item_price_doc_no_dates_name = ip.name   
        
        if(item_price_doc_no_dates_name !="" ):
            item_price_no_dates =frappe.get_doc("Item Price", item_price_doc_no_dates_name)
            item_price_no_dates.rate = rate
            item_price_no_dates.save()
            return
        else: 
            # This case happens only if there is an item price already exists which has
            # different date range and not with even default price with out dates
            # and its not likely to occur
            item_doc = frappe.get_doc("Item", item)
            
            
            doc = frappe.new_doc("Item Price")
            doc.item = item	
            doc.item_name = item_doc.item_name
            doc.unit = item_doc.base_unit			
            doc.price_list = price_list
            doc.currency = currency
            doc.rate = rate
            doc.insert()
    else:
        item_doc = frappe.get_doc("Item", item)
        doc = frappe.new_doc("Item Price")
        doc.item = item	
        doc.item_name = item_doc.item_name
        doc.unit = item_doc.base_unit			
        doc.price_list = price_list
        doc.currency = currency
        doc.rate = rate
        doc.insert()
        
@frappe.whitelist()
def get_item_price(item, price_list, currency, date):
   
    # Check if there's a matching Item Price record for the given item, price_list, currency, and date
    item_price = frappe.get_all("Item Price", filters={
        "item": item,
        "price_list": price_list,
        "currency": currency,
    }, fields=["rate","name","from_date", "to_date"]) 
   
    date = datetime.strptime(date, '%Y-%m-%d').date()  # Convert date to datetime object
   
    item_price_doc_no_dates_name = ""
    
    #print("from get_price" )
    #print(item_price)

    if item_price:
        for ip in item_price:           
            
            if ip.from_date and ip.to_date:
                if ip.from_date <= date and ip.to_date >= date:                
                    return ip.rate
             
            if(ip.from_date == None and ip.to_date == None):
                 item_price_doc_no_dates_name = ip.name   
        
        if(item_price_doc_no_dates_name !="" ):
            item_price_with_rate =  frappe.get_doc("Item Price", item_price_doc_no_dates_name)
            #print("item price")
            #print(item_price_with_rate)
            
            if item_price_with_rate:
                return item_price_with_rate.rate    
        
        return 0
        
@frappe.whitelist()
def get_customer_last_price_for_item(item, customer):
    # Assuming "Customer Item" is a child table and you have a field named 'price' in it.
    # Also assuming that 'parent' in the filter refers to the item's ID in the main table where "Customer Item" is linked.
    customer_item_price = frappe.get_value("Customer Item", {'parent': item, 'customer': customer}, 'price')

    return customer_item_price if customer_item_price is not None else 0

@frappe.whitelist()
def get_supplier_last_price_for_item(item, supplier):
    # Assuming "Customer Item" is a child table and you have a field named 'price' in it.
    # Also assuming that 'parent' in the filter refers to the item's ID in the main table where "Customer Item" is linked.
    supplier_item_price = frappe.get_value("Supplier Item", {'parent': item, 'supplier': supplier}, 'price')

    return supplier_item_price if supplier_item_price is not None else 0

def update_customer_item_price(item_code, customer, price, price_date):
    """Record `price` as `customer`'s latest rate for the item (Item > Customer
    Rates), when it is newer than the one there.

    Called from Sales Invoice and Sales Order on submit, as the system's own
    bookkeeping: whoever submits (a Cashier included) need not have write
    access to Item, so it saves with ignore_permissions. Not whitelisted for
    that reason, and it does not commit: the submit it is part of does.
    """
    try:
        # Fetch the parent Item document
        item_doc = frappe.get_doc("Item", item_code)
        if not item_doc:
            return {"status": "Error", "message": "Item not found"}

        # Initialize a flag to track whether an update is needed
        update_needed = False

        # Search for an existing entry for the specified customer
        existing_entry = next((d for d in item_doc.get("customer_rates") if d.customer == customer), None)

        # If an entry exists, compare the price dates
        if existing_entry:
            existing_date = getdate(existing_entry.price_date)
            new_date = getdate(price_date)

            # Only proceed if the new price_date is later than the existing one
            if new_date > existing_date:
                update_needed = True
                # Remove the existing entry
                item_doc.remove(existing_entry)
        else:
            # If no existing entry, proceed with the update
            update_needed = True

        # Append a new entry if update is needed
        if update_needed:
            item_doc.append("customer_rates", {
                "customer": customer,
                "price": price,
                "price_date": price_date
            })
            
            # Save the changes to the Item document
            item_doc.save(ignore_permissions=True)

            return {"status": "Success", "message": "Customer Item updated successfully"}
        else:
            return {"status": "No Update", "message": "Existing data is newer or same; no update performed."}

    except Exception as e:
        # Log the error and return an error message
        frappe.log_error(frappe.get_traceback(), "update_customer_item_if_newer API error")
        return {"status": "Error", "message": str(e)}

@frappe.whitelist()
def update_supplier_item_price(item_code, supplier, price, price_date):
        
    try:
        # Fetch the parent Item document
        item_doc = frappe.get_doc("Item", item_code)
        if not item_doc:
            return {"status": "Error", "message": "Item not found"}

        # Initialize a flag to track whether an update is needed
        update_needed = False

        # Search for an existing entry for the specified customer
        existing_entry = next((d for d in item_doc.get("supplier_rates") if d.supplier == supplier), None)

        # If an entry exists, compare the price dates
        if existing_entry:
            existing_date = getdate(existing_entry.price_date)
            new_date = getdate(price_date)

            # Only proceed if the new price_date is later than the existing one
            if new_date > existing_date:
                update_needed = True
                # Remove the existing entry
                item_doc.remove(existing_entry)
        else:
            # If no existing entry, proceed with the update
            update_needed = True

        # Append a new entry if update is needed
        if update_needed:
            item_doc.append("supplier_rates", {
                "supplier": supplier,
                "price": price,
                "price_date": price_date
            })
            
            # Save the changes to the Item document
            item_doc.save()

            # Commit the transaction to ensure changes are saved
            frappe.db.commit()

            return {"status": "Success", "message": "Customer Item updated successfully"}
        else:
            return {"status": "No Update", "message": "Existing data is newer or same; no update performed."}

    except Exception as e:
        # Log the error and return an error message
        frappe.log_error(frappe.get_traceback(), "update_customer_item_if_newer API error")
        return {"status": "Error", "message": str(e)}



@frappe.whitelist()
def get_item_price_list(item_list):
    item_list = json.loads(item_list)
    item_details = []
    if item_list:
        for item in item_list:
            print(item)
            item_doc = frappe.get_doc("Item",item["item"])

            itm = {
                "item_name": item_doc.item_name,
                "item_code": item_doc.item_code,
                "valuation_rate": item_doc.item_valuation_rate,
                "item_price_rate": item_doc.supplier_rates[-1].price if item_doc.supplier_rates else 0,
            }
            item_details.append(itm)


        return item_details       
    else:
        return None 

CHARGE_FIELDS = ("service_charge", "typing_charges", "transaction_charges", "gov")


@frappe.whitelist()
def get_item_charges(items, price_list=None, posting_date=None):
    """Service Charge, Typing Charges, Transaction Charges and GOV to bill for each item.

    Taken from the price list's Item Price when it has one for the item, otherwise
    from the Item master. A dated Item Price covering `posting_date` wins over an
    undated one. An Item Price with only a rate and no charges cannot be split into
    the taxable and non-taxable parts, so it is skipped for the Item master and the
    caller is told (`source` = "Item (price list has rate only)").

    Returns {item: {"service_charge", "typing_charges", "transaction_charges", "gov", "source"}}.
    """
    if isinstance(items, str):
        items = json.loads(items)

    posting_date = getdate(posting_date) if posting_date else getdate()
    charges = {}

    for item in set(filter(None, items)):
        master = frappe.db.get_value("Item", item, list(CHARGE_FIELDS), as_dict=True) or {}
        result = {f: flt(master.get(f)) for f in CHARGE_FIELDS}
        result["source"] = "Item"

        price = get_price_list_charges(item, price_list, posting_date) if price_list else None
        if price:
            if any(flt(price.get(f)) for f in CHARGE_FIELDS):
                result = {f: flt(price.get(f)) for f in CHARGE_FIELDS}
                result["source"] = f"Price List: {price_list}"
            else:
                result["source"] = "Item (price list has rate only)"

        charges[item] = result

    return charges


def get_price_list_charges(item, price_list, posting_date):
    fields = list(CHARGE_FIELDS) + ["rate"]

    dated = frappe.get_all("Item Price",
        filters={"item": item, "price_list": price_list,
                 "from_date": ["<=", posting_date], "to_date": [">=", posting_date]},
        fields=fields, order_by="from_date desc", limit=1)
    if dated:
        return dated[0]

    undated = frappe.get_all("Item Price",
        filters={"item": item, "price_list": price_list, "from_date": ["is", "not set"], "to_date": ["is", "not set"]},
        fields=fields, limit=1)
    return undated[0] if undated else None
