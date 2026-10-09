// Sales Invoice engine: the rules of a Sales Invoice, shared by the Sales Invoice
// form (selling/doctype/sales_invoice/sales_invoice.js) and the Cashier Console's
// invoice editor (cashier_invoices.js), so the two can never disagree.
//
// Everything here works on the document itself (a doc in `locals`), never on a
// form, and never refreshes a screen: the caller does that. A caller that needs
// a field change to behave like a form edit (dirty flag, change events) passes
// its own `set_value(fieldname, value)`; without one the value is just assigned.
//
// The code was moved from sales_invoice.js unchanged in its arithmetic.

frappe.provide("digitz_erp.si_engine");

(function (engine) {
	const ITEM_DOCTYPE = "Sales Invoice Item";

	// precision() in Frappe reads cur_frm, which on the Cashier Console can be some
	// other form opened earlier. This is the same lookup it does for the form.
	function prec(fieldname, row) {
		const df = frappe.meta.get_docfield(row.doctype || ITEM_DOCTYPE, fieldname, row.parent || row.name);
		return frappe.meta.get_field_precision(df, row);
	}

	function assign(doc) {
		return (fieldname, value) => {
			doc[fieldname] = value;
		};
	}

	// ------------------------------------------------------------ taxes & totals

	// Rate is Service Charge + Typing Charges + Transaction Charges + GOV; tax applies to all but
	// GOV. Fills every row's amounts and the document totals, and returns the
	// calculation trace (also kept on window.digitz_last_tax_debug).
	engine.calculate = function (doc, set_value) {
		set_value = set_value || assign(doc);

		// NOTE: never call console.clear() here. This method runs on every qty/rate/
		// discount change, and clearing wipes the very logs needed to debug a live site.
		const DBG = (typeof window !== "undefined" && window.DIGITZ_TAX_DEBUG !== false);

		const trace = {
			rate_includes_tax_parent: doc.rate_includes_tax,
			additional_discount_raw: doc.additional_discount,
			item_count: (doc.items || []).length,
			rows: [],
			warnings: []
		};

		frappe.model.clear_table(doc, "taxes");

		var gross_total = 0;
		var taxable_total = 0;
		var tax_total = 0;
		var net_total = 0;
		var discount_total = 0;
		var gov_only_rows = 0;
		var taxable_rows = 0;

		// The parent flag is the single source of truth for inclusive/exclusive.
		// It is a Check field, but can arrive as undefined/null/"0"/"1" depending on
		// how the doc was created (new doc, amend, import, API), so normalise it once.
		const rate_includes_tax = cint(doc.rate_includes_tax) ? 1 : 0;
		if (doc.rate_includes_tax === undefined || doc.rate_includes_tax === null) {
			trace.warnings.push("doc.rate_includes_tax was undefined/null - treated as EXCLUSIVE (0). Check Company.rate_includes_tax.");
		}

		// Avoid Possible NaN
		doc.gross_total = 0;
		doc.net_total = 0;
		doc.tax_total = 0;
		doc.total_discount_in_line_items = 0;
		doc.round_off = 0;
		doc.rounded_total = 0;
		doc.taxable_total = 0;

		(doc.items || []).forEach(function (entry, idx) {

			// rate_includes_tax column in items table is readonly and it depends the form's rate_includes_tax column
			entry.rate_includes_tax = rate_includes_tax;
			entry.gross_amount = 0;
			entry.taxable_amount = 0;
			entry.tax_amount = 0;
			entry.net_amount = 0;

			const qty = flt(entry.qty);

			// A blank discount column comes through as undefined/null/"" - never let it
			// reach the arithmetic, and never let it exceed the line value.
			let discount_amount = flt(entry.discount_amount);
			if (!isFinite(discount_amount) || discount_amount < 0) {
				discount_amount = 0;
			}
			entry.discount_amount = discount_amount;
			entry.discount_percentage = flt(entry.discount_percentage);

			// Service Charge, Typing Charges and Transaction Charges (all taxable) and GOV
			// (non-taxable pass-through fee) come from the Item master and are the ONLY source
			// of the rate - the rate column is derived, never entered. So all of them at 0 is not a rate of zero to be
			// worked around, it is missing Item master data, and it is the single most
			// likely reason a live site shows no tax at all. Flag it loudly.
			const service_charge_rate = flt(entry.service_charge);
			const typing_charges_rate = flt(entry.typing_charges);
			const transaction_charges_rate = flt(entry.transaction_charges);
			const gov_rate = flt(entry.gov);
			// The taxable part of the rate
			const taxable_rate = service_charge_rate + typing_charges_rate + transaction_charges_rate;

			if (taxable_rate === 0 && gov_rate === 0) {
				trace.warnings.push(
					"Row " + (idx + 1) + " (" + (entry.item || "?") +
					"): Service Charge, Typing Charges, Transaction Charges and GOV are all 0, so rate is 0 and no tax can be calculated. " +
					"Fill them on the Item master, then re-pick the item on this row " +
					"(the row copies them at selection time and does not re-read them later)."
				);
			}

			entry.rate = taxable_rate + gov_rate;

			const tax_rate = flt(entry.tax_rate);
			const tax_excluded = cint(entry.tax_excluded) ? 1 : 0;

			// qty * (Service Charge + Typing Charges + Transaction Charges), net of the line discount. This is the
			// only part tax applies to.
			let taxable_base = (qty * taxable_rate) - discount_amount;
			if (taxable_base < 0) {
				taxable_base = 0;
			}
			const gov_amount = qty * gov_rate;

			if (!tax_excluded && tax_rate > 0) {

				// Round each line to the field precision before it is totalled, so the
				// totals are the sum of the amounts the rows actually show and store.
				if (rate_includes_tax) {
					// Rate already carries the tax: strip it back out. Tax is the
					// remainder, so taxable + tax always equals the taxable base exactly.
					entry.taxable_amount = flt(taxable_base / (1 + (tax_rate / 100)), prec("taxable_amount", entry));
					entry.tax_amount = flt(taxable_base - entry.taxable_amount, prec("tax_amount", entry));
					entry.net_amount = taxable_base + gov_amount;
				} else {
					// Rate is net of tax: add it on top.
					entry.taxable_amount = taxable_base;
					entry.tax_amount = flt(entry.taxable_amount * (tax_rate / 100), prec("tax_amount", entry));
					entry.net_amount = taxable_base + gov_amount + flt(entry.tax_amount);
				}
			}
			else {
				entry.taxable_amount = 0;
				entry.tax_amount = 0;
				entry.net_amount = taxable_base + gov_amount;
			}

			entry.gross_amount = qty * (taxable_rate + gov_rate);

			gross_total = gross_total + flt(entry.gross_amount);
			tax_total = tax_total + flt(entry.tax_amount);
			net_total = net_total + flt(entry.net_amount);
			taxable_total = taxable_total + flt(entry.taxable_amount);
			discount_total = discount_total + discount_amount;

			// Units are not used in this document: there is no unit conversion, so the
			// factor is pinned to 1. qty_in_base_unit / rate_in_base_unit still have to
			// be populated - the stock ledger postings, the stock-balance check and the
			// sales-return quantities all read them - they are simply qty and rate now.
			// Pinning the factor to 1 also keeps the returns query, which divides by
			// conversion_factor, away from a divide-by-zero.
			entry.conversion_factor = 1;
			entry.qty_in_base_unit = qty;
			entry.rate_in_base_unit = flt(entry.rate);

			// Per-row trace. `why_no_tax` is the field to read first when a live site
			// reports "tax is not calculating".
			let why_no_tax = "";
			if (!tax_excluded && tax_rate > 0 && taxable_rate > 0) {
				taxable_rows++;
			}
			if (tax_excluded) {
				why_no_tax = "tax_excluded is checked on this row (comes from Company.tax_excluded or Item.tax_excluded, whose default is 1)";
			} else if (tax_rate <= 0) {
				why_no_tax = "tax_rate is " + tax_rate + " - the Item has no Tax link, or the linked Tax record has no rate. NOTE: tax_rate is an Int field, so a rate like 2.5 cannot be stored";
			} else if (taxable_rate === 0 && gov_rate > 0) {
				why_no_tax = "OK - GOV-only line. A government fee is a disbursement outside VAT scope, so no VAT applies. This is correct, not a fault";
				gov_only_rows++;
			} else if (taxable_rate === 0) {
				why_no_tax = "Service Charge, Typing Charges, Transaction Charges and GOV are all 0, so the rate is 0 and there is nothing to tax. Set them on the Item master and re-pick the item on this row";
			} else if (taxable_base === 0) {
				why_no_tax = "taxable base is 0 - qty=" + qty + ", service_charge=" + service_charge_rate + ", typing_charges=" + typing_charges_rate + ", transaction_charges=" + transaction_charges_rate + ", discount=" + discount_amount;
			}

			trace.rows.push({
				"#": idx + 1,
				item: entry.item,
				qty: qty,
				service_charge: service_charge_rate,
				typing_charges: typing_charges_rate,
				transaction_charges: transaction_charges_rate,
				gov: gov_rate,
				rate: entry.rate,
				discount: discount_amount,
				tax_excluded: tax_excluded,
				tax: entry.tax,
				tax_rate: tax_rate,
				incl: rate_includes_tax,
				taxable_amount: flt(entry.taxable_amount),
				tax_amount: flt(entry.tax_amount),
				net_amount: flt(entry.net_amount),
				why_no_tax: why_no_tax
			});
		});

		// Blank Currency fields arrive as undefined/null, and "" * 1 is NaN.
		doc.additional_discount = flt(doc.additional_discount);

		doc.gross_total = flt(gross_total);
		doc.taxable_total = flt(taxable_total);
		doc.tax_total = flt(tax_total);
		doc.total_discount_in_line_items = flt(discount_total);
		doc.net_total = flt(net_total) - flt(doc.additional_discount);

		if (cint(doc.is_round_off)) {
			doc.round_off = Math.round(doc.net_total) - doc.net_total;
			set_value("rounded_total", Math.round(doc.net_total));
		}
		else {
			doc.round_off = 0;
			set_value("rounded_total", flt(doc.net_total));
		}

		trace.totals = {
			gross_total: doc.gross_total,
			taxable_total: doc.taxable_total,
			tax_total: doc.tax_total,
			discount_in_lines: doc.total_discount_in_line_items,
			additional_discount: doc.additional_discount,
			net_total: doc.net_total,
			round_off: doc.round_off,
			rounded_total: doc.rounded_total
		};

		trace.gov_only_rows = gov_only_rows;
		trace.taxable_rows = taxable_rows;

		if (tax_total === 0 && trace.item_count > 0) {
			if (taxable_rows > 0) {
				trace.warnings.push("TAX TOTAL IS 0 even though " + taxable_rows +
					" row(s) should have been taxed - read the `why_no_tax` column above.");
			} else if (gov_only_rows === trace.item_count) {
				// Expected: every line is a government fee, which is outside VAT scope.
				trace.warnings.push("Tax total is 0 because every line is a GOV-only government fee (outside VAT scope). This is correct.");
			}
		}

		// Kept on window so it can be inspected after the fact on a live site:
		//   copy(JSON.stringify(window.digitz_last_tax_debug, null, 2))
		if (typeof window !== "undefined") {
			window.digitz_last_tax_debug = trace;
		}

		if (DBG) {
			console.groupCollapsed(
				"[digitz-tax] " + (rate_includes_tax ? "INCLUSIVE" : "EXCLUSIVE") +
				" | rows=" + trace.item_count + " | tax=" + trace.totals.tax_total +
				" | net=" + trace.totals.net_total
			);
			console.table(trace.rows);
			console.log("totals", trace.totals);
			trace.warnings.forEach(w => console.warn("[digitz-tax]", w));
			console.groupEnd();
		}

		return trace;
	};

	// Toggling Apply Round off on its own: what the form's is_round_off handler does.
	engine.apply_round_off = function (doc, set_value) {
		set_value = set_value || assign(doc);
		if (!doc.is_round_off) {
			set_value("rounded_total", doc.net_total);
			set_value("round_off", 0);
		} else {
			if (doc.net_total != Math.round(doc.net_total)) {
				doc.round_off = Math.round(doc.net_total) - doc.net_total;
			}
			set_value("rounded_total", Math.round(doc.net_total));
		}
	};

	// ------------------------------------------------------------ line discount

	// Base a line discount is calculated against: qty * (Service Charge + Typing Charges + Transaction Charges + GOV). Mirrors
	// calculate() so the two can never disagree.
	engine.line_discount_base = function (row) {
		// Rate is always Service Charge + Typing Charges + Transaction Charges + GOV; the rate column is derived and never entered directly,
		// so the discount base must be built from the same fields.
		let base = flt(row.qty) * (flt(row.service_charge) + flt(row.typing_charges) + flt(row.transaction_charges) + flt(row.gov));
		return isFinite(base) && base > 0 ? base : 0;
	};

	// Discount % entered: sets the amount. Returns a message to show, or null.
	engine.apply_discount_percentage = function (row) {
		// gross_amount is only populated after calculate() has run, so on a
		// freshly added row it is still undefined. Derive the base from qty * (Service Charge + Typing Charges + Transaction Charges + GOV)
		// instead of trusting it, otherwise a percentage silently becomes a 0 discount.
		let base = engine.line_discount_base(row);
		let pct = flt(row.discount_percentage);
		let message = null;

		if (!isFinite(pct) || pct <= 0) {
			row.discount_percentage = 0;
			row.discount_amount = 0;
		}
		else {
			if (pct > 100) {
				pct = 100;
				message = __("Discount percentage cannot exceed 100.");
			}
			row.discount_percentage = pct;
			row.discount_amount = flt(base) * (pct / 100);
		}
		return message;
	};

	// Discount amount entered: sets the percentage. Returns a message to show, or null.
	engine.apply_discount_amount = function (row) {
		let base = engine.line_discount_base(row);
		let discount = flt(row.discount_amount);
		let message = null;

		if (!isFinite(discount) || discount <= 0) {
			row.discount_amount = 0;
			row.discount_percentage = 0;
		}
		else if (!base) {
			// Base is qty * (Service Charge + Typing Charges + Transaction Charges + GOV). With no qty, or with them all missing on the
			// Item, a percentage here would be Infinity or NaN and would be written
			// straight into the document.
			row.discount_amount = 0;
			row.discount_percentage = 0;
			message = __("Enter Qty first, and make sure Service Charge, Typing Charges, Transaction Charges or GOV is set on the Item - the rate is derived from them.");
		}
		else {
			if (discount > base) {
				discount = base;
				row.discount_amount = discount;
				message = __("Discount amount cannot exceed the line amount.");
			}
			row.discount_percentage = (discount * 100) / base;
		}
		return message;
	};

	// ---------------------------------------------------------- receipt schedule

	// A credit sale is paid by the dates in its receipt schedule: one row for the
	// whole total by default, due credit_days after the posting date. With more than
	// one row the user manages it by hand. A cash sale has none.
	engine.fill_receipt_schedule = function (doc, refresh = false, refresh_credit_days = false) {
		if (refresh) {
			doc.receipt_schedule = [];
		}

		if (doc.credit_sale) {
			var postingDate = doc.posting_date;
			var creditDays = doc.credit_days;

			if (!doc.receipt_schedule) {
				doc.receipt_schedule = [];
			}

			var receiptRow = null;
			let row_count = 0;

			// Check if a Payment Schedule row already exists
			doc.receipt_schedule.forEach(function (row) {
				if (row) {
					receiptRow = row;
					if (refresh || refresh_credit_days) {
						receiptRow.date = creditDays ? frappe.datetime.add_days(postingDate, creditDays) : postingDate;
					}
					row_count++;
				}
			});

			//If there is no row exits create one with the relevant values
			if (!receiptRow) {
				receiptRow = frappe.model.add_child(doc, "Receipt Schedule", "receipt_schedule");
				receiptRow.date = creditDays ? frappe.datetime.add_days(postingDate, creditDays) : postingDate;
				receiptRow.payment_mode = "Cash";
				receiptRow.amount = doc.rounded_total;
			}
			else if (row_count == 1) {
				//If there is only one row update the amount. If there is more than one row that means there is manual
				//entry and user need to manage it by themself
				receiptRow.payment_mode = "Cash";
				receiptRow.amount = doc.rounded_total;
			}

			//Update date based on credit_days if there is a credit days change or change in the credit_sales checkbox
			if (refresh || refresh_credit_days) {
				receiptRow.date = creditDays ? frappe.datetime.add_days(postingDate, creditDays) : postingDate;
			}
		}
		else {
			doc.receipt_schedule = [];
		}
	};

	// --------------------------------------------------------------- cash, mobile

	// Received Amount is the cash tendered and Balance the change to give back. Both
	// apply only to a cash payment mode on a sale that is not on credit; the server
	// works Balance out again on save.
	engine.set_cash_balance = function (doc, set_value) {
		set_value = set_value || assign(doc);
		if (doc.docstatus !== 0) {
			return;
		}

		if (cint(doc.credit_sale) || doc.payment_mode_type !== "Cash") {
			if (flt(doc.received_amount) || flt(doc.balance_amount)) {
				set_value("received_amount", 0);
				set_value("balance_amount", 0);
			}
			return;
		}

		const received = flt(doc.received_amount);
		set_value("balance_amount", received ? received - flt(doc.rounded_total) : 0);
	};

	// A cash sale needs the cash tendered, covering the total. Returns
	// {title, message} when it does not, else null. The server enforces the same
	// (validate_received_amount).
	engine.cash_received_error = function (doc) {
		if (cint(doc.credit_sale) || doc.payment_mode_type !== "Cash") {
			return null;
		}
		if (!flt(doc.received_amount)) {
			return {
				title: __("Received Amount Needed"),
				message: __("Enter the Received Amount: the cash the customer handed over. It is required for a cash sale."),
			};
		}
		if (flt(doc.received_amount) < flt(doc.rounded_total) - 0.005) {
			return {
				title: __("Received Amount Too Low"),
				message: __("The Received Amount ({0}) is less than the invoice total ({1}). Collect the full amount, or make it a credit sale.",
					[format_currency(doc.received_amount), format_currency(doc.rounded_total)]),
			};
		}
		return null;
	};

	// Same rule as is_placeholder_mobile in sales_invoice.py: 0000, or any all-zero number
	engine.is_placeholder_mobile = function (number) {
		const digits = String(number || "").replace(/\D/g, "");
		return digits.length > 0 && /^0+$/.test(digits);
	};

	// ------------------------------------------------------------- server reads

	// A new invoice's company defaults: the default company and its warehouse,
	// whether rates include tax, update stock, the price-list update flag and the
	// terms. Returns {allow_edit_sales_invoice_no, hidden_fields} for the screen, or
	// null when no default company is set.
	engine.company_defaults = async function (doc) {
		const r = await frappe.call({
			method: "frappe.client.get_value",
			args: { doctype: "Global Settings", fieldname: "default_company" },
		});
		const default_company = r.message?.default_company || "";
		if (!default_company) {
			return null;
		}
		doc.company = default_company;

		const r2 = await frappe.call({
			method: "frappe.client.get_value",
			args: {
				doctype: "Company",
				filters: { company_name: default_company },
				fieldname: [
					"default_warehouse",
					"rate_includes_tax",
					"delivery_note_integrated_with_sales_invoice",
					"update_price_list_price_with_sales_invoice",
					"use_customer_last_price",
					"customer_terms",
					"update_stock_in_sales_invoice",
					"allow_edit_sales_invoice_no",
					"hidden_sales_invoice"
				]
			}
		});
		const company_data = r2.message || {};

		doc.warehouse = company_data.default_warehouse;
		doc.rate_includes_tax = company_data.rate_includes_tax;
		doc.update_stock = company_data.update_stock_in_sales_invoice;
		doc.auto_save_delivery_note = false;

		if (company_data.use_customer_last_price == 0) {
			doc.update_rates_in_price_list = company_data.update_price_list_price_with_sales_invoice;
		}

		if (company_data.customer_terms) {
			doc.terms = company_data.customer_terms;
			const terms_res = await frappe.call({
				method: "digitz_erp.api.settings_api.get_terms_for_template",
				args: { template: company_data.customer_terms }
			});
			doc.terms_and_conditions = terms_res.message?.terms || "";
		}

		return {
			allow_edit_sales_invoice_no: company_data.allow_edit_sales_invoice_no,
			hidden_fields: (company_data.hidden_sales_invoice || "").split(",").map(f => f.trim()).filter(Boolean),
		};
	};

	// Terms for a customer: {template_name, terms}
	engine.customer_terms = function (customer) {
		return frappe.call({
			method: "digitz_erp.api.settings_api.get_customer_terms",
			args: { customer },
		}).then((r) => r.message || {});
	};

	engine.party_balance = function (customer) {
		return frappe.call({
			method: "digitz_erp.accounts.doctype.gl_posting.gl_posting.get_party_balance",
			args: { party_type: "Customer", party: customer },
		}).then((r) => r.message);
	};

	// How a new invoice is paid by default (the same rule the token sync and data
	// import use): the customer's Default Payment Mode, else the company's.
	engine.payment_defaults = function (doc) {
		return frappe.call({
			method: "digitz_erp.selling.doctype.sales_invoice.sales_invoice.get_sales_payment_defaults",
			args: { customer: doc.customer || null, company: doc.company || null },
		}).then((r) => r.message || {});
	};

	// An item was picked on `row`: fill its name, unit, tax and Service Charge /
	// Typing Charges / Transaction Charges / GOV from the Item master. The charges are then re-read from
	// the price list by apply_item_charges. Returns {found, advance_message}.
	engine.load_item = async function (doc, row) {
		row.warehouse = doc.warehouse;

		let tax_excluded_for_company = false;
		const settings = await frappe.call({ method: "digitz_erp.api.settings_api.get_company_settings" });
		if (settings.message && settings.message.length) {
			tax_excluded_for_company = settings.message[0].tax_excluded;
		}

		const r = await frappe.call({
			method: "frappe.client.get_value",
			args: {
				doctype: "Item",
				filters: { item_code: row.item },
				fieldname: ["item_name", "description", "base_unit", "tax", "tax_excluded", "service_charge", "typing_charges", "transaction_charges", "gov"]
			},
		});
		if (!r.message) {
			return { found: false };
		}

		row.item_name = r.message.item_name;
		row.display_name = r.message.description;
		row.tax_excluded = tax_excluded_for_company ? true : r.message.tax_excluded;
		row.base_unit = r.message.base_unit;
		row.unit = r.message.base_unit;
		row.conversion_factor = 1;
		row.rate = flt(r.message.service_charge) + flt(r.message.typing_charges) + flt(r.message.transaction_charges) + flt(r.message.gov);
		row.service_charge = flt(r.message.service_charge);
		row.typing_charges = flt(r.message.typing_charges);
		row.transaction_charges = flt(r.message.transaction_charges);
		row.gov = flt(r.message.gov);
		row.qty = 1;

		let advance_message = null;
		if (doc.project && doc.for_advance_payment && doc.project_value > 0 && doc.advance_percentage > 0) {
			let advance_value = (doc.project_value * doc.advance_percentage / 100);
			row.rate = advance_value;
			advance_message = doc.advance_percentage + "% advance = " + advance_value + " allocated in the line item.";
		}

		if (!row.tax_excluded) {
			const r2 = await frappe.call({
				method: "frappe.client.get_value",
				args: { doctype: "Tax", filters: { tax_name: r.message.tax }, fieldname: ["tax_name", "tax_rate"] },
			});
			if (r2.message) {
				row.tax = r2.message.tax_name;
				row.tax_rate = flt(r2.message.tax_rate);
			} else {
				row.tax = "";
				row.tax_rate = 0;
			}
		} else {
			row.tax = "";
			row.tax_rate = 0;
		}

		return { found: true, advance_message };
	};

	// The rate of a picked Tax.
	engine.load_tax_rate = async function (row) {
		const r = await frappe.call({
			method: "frappe.client.get_value",
			args: { doctype: "Tax", filters: { tax_name: row.tax }, fieldname: ["tax_name", "tax_rate"] },
		});
		row.tax_rate = r.message.tax_rate;
	};

	// Set Service Charge, Typing Charges, Transaction Charges and GOV on `rows` (default: every row with an
	// item) from the invoice's price list, falling back to the Item master. Only a
	// draft is re-priced. Returns the items priced from the Item master because the
	// price list had a rate only, or null when nothing was looked up.
	engine.apply_item_charges = async function (doc, rows) {
		if (doc.docstatus !== 0) {
			return null;
		}
		rows = (rows || doc.items || []).filter((row) => row.item);
		if (!rows.length) {
			return null;
		}

		const r = await frappe.call({
			method: "digitz_erp.api.item_price_api.get_item_charges",
			args: {
				items: rows.map((row) => row.item),
				price_list: doc.price_list || null,
				posting_date: doc.posting_date,
			},
		});
		const charges = r.message || {};
		const rate_only = [];

		rows.forEach((row) => {
			const c = charges[row.item];
			if (!c) {
				return;
			}
			row.service_charge = flt(c.service_charge);
			row.typing_charges = flt(c.typing_charges);
			row.transaction_charges = flt(c.transaction_charges);
			row.gov = flt(c.gov);
			row.rate = row.service_charge + row.typing_charges + row.transaction_charges + row.gov;
			if (c.source === "Item (price list has rate only)") {
				rate_only.push(row.item);
			}
		});
		return [...new Set(rate_only)];
	};

	engine.rate_only_alert = function (doc, rate_only) {
		if (rate_only && rate_only.length) {
			frappe.show_alert({
				message: __("{0} has only a rate in price list {1}, with no Service Charge / Typing Charges / Transaction Charges / GOV, so the Item master charges were used.",
					[rate_only.join(", "), doc.price_list]),
				indicator: "orange",
			}, 8);
		}
	};

	// Customer Company and Tax Id: read-only, except on the Default Walk-in Customer,
	// where the user types the applicant's company and TRN.
	engine.customer_billing_details = function (customer) {
		return frappe.call({
			method: "digitz_erp.selling.doctype.sales_invoice.sales_invoice.get_customer_billing_details",
			args: { customer },
		}).then((r) => r.message || {});
	};

	// ---------------------------------------------------------- posting dialogs

	engine.show_gl_postings = function (doctype, name) {
		frappe.call({
			method: "digitz_erp.api.accounts_api.get_gl_postings",
			args: { voucher: doctype, voucher_no: name },
			callback: function (response) {
				let gl_postings = response.message.gl_postings;
				let totalDebit = parseFloat(response.message.total_debit).toFixed(2);
				let totalCredit = parseFloat(response.message.total_credit).toFixed(2);

				let htmlContent = '<div style="max-height: 680px; overflow-y: auto;">' +
					'<table class="table table-bordered" style="width: 100%;">' +
					'<thead>' +
					'<tr>' +
					'<th style="width: 15%;">Account</th>' +
					'<th style="width: 25%;">Remarks</th>' +
					'<th style="width: 10%;">Debit Amount</th>' +
					'<th style="width: 10%;">Credit Amount</th>' +
					'<th style="width: 10%;">Party</th>' +
					'<th style="width: 10%;">Against Account</th>' +
					'<th style="width: 10%;">Project</th>' +
					'<th style="width: 10%;">Cost Center</th>' +
					'</tr>' +
					'</thead>' +
					'<tbody>';

				gl_postings.forEach(function (gl_posting) {
					let remarksText = gl_posting.remarks || '';
					let debitAmount = parseFloat(gl_posting.debit_amount).toFixed(2);
					let creditAmount = parseFloat(gl_posting.credit_amount).toFixed(2);

					htmlContent += '<tr>' +
						`<td>${gl_posting.account}</td>` +
						`<td>${remarksText}</td>` +
						`<td style="text-align: right;">${debitAmount}</td>` +
						`<td style="text-align: right;">${creditAmount}</td>` +
						`<td>${gl_posting.party}</td>` +
						`<td>${gl_posting.against_account}</td>` +
						`<td>${gl_posting.project}</td>` +
						`<td>${gl_posting.cost_center}</td>` +
						'</tr>';
				});

				htmlContent += '<tr>' +
					'<td style="font-weight: bold;">Total</td>' +
					'<td></td>' +
					`<td style="text-align: right; font-weight: bold;">${totalDebit}</td>` +
					`<td style="text-align: right; font-weight: bold;">${totalCredit}</td>` +
					'<td colspan="5"></td>' +
					'</tr>';

				htmlContent += '</tbody></table></div>';

				let d = new frappe.ui.Dialog({
					title: 'General Ledgers',
					fields: [{ fieldtype: 'HTML', fieldname: 'general_ledgers_html', options: htmlContent }],
					primary_action_label: 'Close',
					primary_action: function () {
						d.hide();
					}
				});
				d.$wrapper.find('.modal-dialog').css('max-width', '90%');
				d.show();
			}
		});
	};

	engine.show_stock_ledgers = function (doctype, name) {
		frappe.call({
			method: "digitz_erp.api.accounts_api.get_stock_ledgers",
			args: { voucher: doctype, voucher_no: name },
			callback: function (response) {
				let stock_ledgers_data = response.message;

				let htmlContent = '<div style="max-height: 400px; overflow-y: auto;">' +
					'<table class="table table-bordered" style="width: 100%;">' +
					'<thead>' +
					'<tr>' +
					'<th style="width: 10%;">Item Code</th>' +
					'<th style="width: 20%;">Item Name</th>' +
					'<th style="width: 15%;">Warehouse</th>' +
					'<th style="width: 10%;">Qty In</th>' +
					'<th style="width: 10%;">Qty Out</th>' +
					'<th style="width: 15%;">Valuation Rate</th>' +
					'<th style="width: 15%;">Balance Qty</th>' +
					'<th style="width: 15%;">Balance Value</th>' +
					'</tr>' +
					'</thead>' +
					'<tbody>';

				stock_ledgers_data.forEach(function (ledger) {
					htmlContent += '<tr>' +
						`<td><a href="/app/item/${ledger.item}" target="_blank">${ledger.item}</a></td>` +
						`<td>${ledger.item_name}</td>` +
						`<td>${ledger.warehouse}</td>` +
						`<td>${ledger.qty_in}</td>` +
						`<td>${ledger.qty_out}</td>` +
						`<td>${ledger.valuation_rate}</td>` +
						`<td>${ledger.balance_qty}</td>` +
						`<td>${ledger.balance_value}</td>` +
						'</tr>';
				});

				htmlContent += '</tbody></table></div>';

				let d = new frappe.ui.Dialog({
					title: 'Stock Ledgers',
					fields: [{ fieldtype: 'HTML', fieldname: 'stock_ledgers_html', options: htmlContent }],
					primary_action_label: 'Close',
					primary_action: function () {
						d.hide();
					}
				});
				d.$wrapper.find('.modal-dialog').css('max-width', '85%');
				d.show();
			}
		});
	};

	// ------------------------------------------------------------ printing

	// Send a PDF straight to the printer: it loads in a hidden frame and the
	// browser's print starts on it -- no dialog on a counter PC whose Chrome runs
	// with --kiosk-printing, the usual print dialog anywhere else. `on_fail` runs
	// if the browser will not print the frame (it then shows the PDF instead).
	engine.print_pdf = function (file_url, label, on_fail) {
		$(".ci-print-frame").remove();
		const frame = $(`<iframe class="ci-print-frame" title="${frappe.utils.escape_html(label || "")}"
			style="position: fixed; right: 0; bottom: 0; width: 1px; height: 1px; border: 0; opacity: 0;"></iframe>`)
			.appendTo(document.body)[0];
		frame.onload = () => {
			// The PDF viewer needs a moment after load before it can print
			setTimeout(() => {
				try {
					frame.contentWindow.focus();
					frame.contentWindow.print();
					frappe.show_alert({ message: __("Sent {0} to the printer", [label]), indicator: "green" });
				} catch (e) {
					on_fail ? on_fail() : window.open(file_url, "_blank");
				}
				// Removed later, not now: printing reads from it
				setTimeout(() => frame.remove(), 60000);
			}, 600);
		};
		// A new URL each time, so a regenerated PDF is never served from cache
		frame.src = `${encodeURI(file_url)}?v=${Date.now()}`;
	};

	// The invoice's PDF links, {invoice, receipt}. `fresh` means a save has just
	// regenerated them (Sales Invoice before_save), so they are only looked up;
	// otherwise they are generated again, as Print always has.
	engine.get_print_pdfs = async function (docname, fresh) {
		const r = await frappe.call({
			method: fresh
				? "digitz_erp.selling.doctype.sales_invoice.sales_invoice.get_print_pdf_urls"
				: "digitz_erp.selling.doctype.sales_invoice.sales_invoice.print_sales_invoice_pdf",
			args: { docname },
			freeze: true,
			freeze_message: __("Generating PDF..."),
		});
		return (fresh ? r.message : r.message && r.message.files) || {};
	};

	// ------------------------------------------------------------ Ctrl+P

	// Ctrl+P on a Sales Invoice prints the invoice PDF instead of opening
	// Frappe's print view (or the browser's print of the page). Screens register
	// {applies(), print()}; the first that applies takes the key. Caught in the
	// capture phase, before the desk's own Ctrl+P handler sees it.
	engine.ctrl_p_handlers = [];
	engine.on_ctrl_p = function (handler) {
		engine.ctrl_p_handlers.push(handler);
	};
	if (!engine.ctrl_p_bound) {
		engine.ctrl_p_bound = true;
		document.addEventListener("keydown", (e) => {
			if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || (e.key || "").toLowerCase() !== "p") {
				return;
			}
			const handler = engine.ctrl_p_handlers.find((h) => h.applies());
			if (!handler) {
				return;
			}
			e.preventDefault();
			e.stopImmediatePropagation();
			e.repeat || handler.print();
		}, true);
	}

	// ------------------------------------------------------------ shortcuts strip

	// A row of key hints, e.g. [["Ctrl+S", "Save"], ["Ctrl+P", "Print Invoice"]]
	engine.shortcuts_html = function (shortcuts) {
		const esc = (v) => frappe.utils.escape_html(v == null ? "" : String(v));
		const is_mac = /Mac/i.test(navigator.platform || "");
		return `<div class="si-shortcuts" aria-label="${__("Keyboard shortcuts")}">
			<span class="si-shortcuts-title">${__("Shortcuts")}</span>
			${shortcuts.map(([keys, label]) => `
				<span class="si-shortcut">${keys.split("+").map((k) =>
					`<kbd>${esc(is_mac && k === "Ctrl" ? "⌘" : k)}</kbd>`).join("+")} ${esc(label)}</span>`).join("")}
		</div>`;
	};
})(digitz_erp.si_engine);
