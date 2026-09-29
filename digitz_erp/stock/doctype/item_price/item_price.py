# Copyright (c) 2023, Rupesh P and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import flt
from datetime import date

class ItemPrice(Document):

	def before_validate(self):
		# With any of the three parts set, the rate is their sum, the same way invoice
		# lines derive it. A price without them (e.g. a buying price) keeps its rate as entered.
		if flt(self.service_charge) or flt(self.typing_charges) or flt(self.gov):
			self.rate = flt(self.service_charge) + flt(self.typing_charges) + flt(self.gov)
 
	def validate(self):
		
		#print("from validate")

		if(self.from_date and self.to_date):

			existing_records = frappe.db.sql("""
			SELECT name
			FROM `tabItem Price`
			WHERE item=%(item)s AND price_list=%(price_list)s AND from_date IS NOT NULL AND to_date IS NOT NULL AND name != %(name)s
			""", {"item": self.item, "price_list": self.price_list, "name": self.name}, as_dict=1)
   
			#print(existing_records)
   
			for record_item_price in existing_records:
       
				record = frappe.get_doc("Item Price", record_item_price.name)
				   			        
				if(record.from_date and record.to_date):
					
					if ((self.from_date <= record.to_date and self.to_date >= record.from_date)
				or (self.from_date <= record.from_date and self.to_date >= record.from_date)
				or (self.from_date <= record.to_date and self.to_date >= record.to_date)):
						frappe.throw("Another ItemPrice with the same item/pricelist has overlapping date range.")
		else:
   
			prices = frappe.db.sql("""
				SELECT name
				FROM `tabItem Price`
				WHERE item=%(item)s AND price_list=%(price_list)s AND from_date IS NULL AND to_date IS NULL AND name != %(name)s
			""", {"item": self.item, "price_list": self.price_list, "name": self.name})

			#print(prices)
   
			if(prices):
					frappe.throw("Another ItemPrice with the same item/pricelist exist.")
     
	def on_update(self):
     
		item_to_update_price = frappe.get_doc("Item", self.item)
		#print(item_to_update_price)

		if self.price_list == "Standard Buying":
			if item_to_update_price.standard_buying_price != self.rate:
				sql = """
				UPDATE `tabItem`
				SET `standard_buying_price` = %s
				WHERE `name` = %s
				"""
				frappe.db.sql(sql, (self.rate, self.item))

				frappe.msgprint(f"Standard buying price updated for the item, {self.item}", alert=True)

		# The undated 'Standard Selling' price is the item's standing price: copy its
		# charges back to the Item master, which is what invoices fall back to. Dated
		# prices are temporary and leave the master alone. Skipped when the Item itself
		# made this change (Item.update_standard_selling_price), so it does not echo back.
		if (self.price_list == "Standard Selling" and not self.from_date and not self.to_date
				and not self.flags.from_item):
			charges = {f: flt(self.get(f)) for f in ("service_charge", "typing_charges", "gov")}
			# A rate-only price cannot be split into charges; it only updates the rate
			values = dict(charges) if any(charges.values()) else {}
			values["standard_selling_price"] = flt(self.rate)

			current = frappe.db.get_value("Item", self.item, list(values), as_dict=True) or {}
			if any(flt(current.get(f)) != v for f, v in values.items()):
				# db.set_value, not a save: an Item save would push the price straight back here
				frappe.db.set_value("Item", self.item, values)
				frappe.msgprint(f"Standard selling price updated for the item {self.item}", alert=True)



			

			