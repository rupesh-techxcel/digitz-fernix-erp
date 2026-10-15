(() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
  var __publicField = (obj, key, value) => {
    __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
    return value;
  };

  // ../digitz_erp/digitz_erp/public/js/sales_invoice_engine.js
  frappe.provide("digitz_erp.si_engine");
  (function(engine) {
    const ITEM_DOCTYPE = "Sales Invoice Item";
    function prec(fieldname, row) {
      const df = frappe.meta.get_docfield(row.doctype || ITEM_DOCTYPE, fieldname, row.parent || row.name);
      return frappe.meta.get_field_precision(df, row);
    }
    function assign(doc) {
      return (fieldname, value) => {
        doc[fieldname] = value;
      };
    }
    engine.calculate = function(doc, set_value) {
      set_value = set_value || assign(doc);
      const DBG = typeof window !== "undefined" && window.DIGITZ_TAX_DEBUG !== false;
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
      const rate_includes_tax = cint(doc.rate_includes_tax) ? 1 : 0;
      if (doc.rate_includes_tax === void 0 || doc.rate_includes_tax === null) {
        trace.warnings.push("doc.rate_includes_tax was undefined/null - treated as EXCLUSIVE (0). Check Company.rate_includes_tax.");
      }
      doc.gross_total = 0;
      doc.net_total = 0;
      doc.tax_total = 0;
      doc.total_discount_in_line_items = 0;
      doc.round_off = 0;
      doc.rounded_total = 0;
      doc.taxable_total = 0;
      (doc.items || []).forEach(function(entry, idx) {
        entry.rate_includes_tax = rate_includes_tax;
        entry.gross_amount = 0;
        entry.taxable_amount = 0;
        entry.tax_amount = 0;
        entry.net_amount = 0;
        const qty = flt(entry.qty);
        let discount_amount = flt(entry.discount_amount);
        if (!isFinite(discount_amount) || discount_amount < 0) {
          discount_amount = 0;
        }
        entry.discount_amount = discount_amount;
        entry.discount_percentage = flt(entry.discount_percentage);
        const service_charge_rate = flt(entry.service_charge);
        const typing_charges_rate = flt(entry.typing_charges);
        const transaction_charges_rate = flt(entry.transaction_charges);
        const gov_rate = flt(entry.gov);
        const taxable_rate = service_charge_rate + typing_charges_rate + transaction_charges_rate;
        if (taxable_rate === 0 && gov_rate === 0) {
          trace.warnings.push(
            "Row " + (idx + 1) + " (" + (entry.item || "?") + "): Service Charge, Typing Charges, Transaction Charges and GOV are all 0, so rate is 0 and no tax can be calculated. Fill them on the Item master, then re-pick the item on this row (the row copies them at selection time and does not re-read them later)."
          );
        }
        entry.rate = taxable_rate + gov_rate;
        const tax_rate = flt(entry.tax_rate);
        const tax_excluded = cint(entry.tax_excluded) ? 1 : 0;
        let taxable_base = qty * taxable_rate - discount_amount;
        if (taxable_base < 0) {
          taxable_base = 0;
        }
        const gov_amount = qty * gov_rate;
        if (!tax_excluded && tax_rate > 0) {
          if (rate_includes_tax) {
            entry.taxable_amount = flt(taxable_base / (1 + tax_rate / 100), prec("taxable_amount", entry));
            entry.tax_amount = flt(taxable_base - entry.taxable_amount, prec("tax_amount", entry));
            entry.net_amount = taxable_base + gov_amount;
          } else {
            entry.taxable_amount = taxable_base;
            entry.tax_amount = flt(entry.taxable_amount * (tax_rate / 100), prec("tax_amount", entry));
            entry.net_amount = taxable_base + gov_amount + flt(entry.tax_amount);
          }
        } else {
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
        entry.conversion_factor = 1;
        entry.qty_in_base_unit = qty;
        entry.rate_in_base_unit = flt(entry.rate);
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
          qty,
          service_charge: service_charge_rate,
          typing_charges: typing_charges_rate,
          transaction_charges: transaction_charges_rate,
          gov: gov_rate,
          rate: entry.rate,
          discount: discount_amount,
          tax_excluded,
          tax: entry.tax,
          tax_rate,
          incl: rate_includes_tax,
          taxable_amount: flt(entry.taxable_amount),
          tax_amount: flt(entry.tax_amount),
          net_amount: flt(entry.net_amount),
          why_no_tax
        });
      });
      doc.additional_discount = flt(doc.additional_discount);
      doc.gross_total = flt(gross_total);
      doc.taxable_total = flt(taxable_total);
      doc.tax_total = flt(tax_total);
      doc.total_discount_in_line_items = flt(discount_total);
      doc.net_total = flt(net_total) - flt(doc.additional_discount);
      if (cint(doc.is_round_off)) {
        doc.round_off = Math.round(doc.net_total) - doc.net_total;
        set_value("rounded_total", Math.round(doc.net_total));
      } else {
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
          trace.warnings.push("TAX TOTAL IS 0 even though " + taxable_rows + " row(s) should have been taxed - read the `why_no_tax` column above.");
        } else if (gov_only_rows === trace.item_count) {
          trace.warnings.push("Tax total is 0 because every line is a GOV-only government fee (outside VAT scope). This is correct.");
        }
      }
      if (typeof window !== "undefined") {
        window.digitz_last_tax_debug = trace;
      }
      if (DBG) {
        console.groupCollapsed(
          "[digitz-tax] " + (rate_includes_tax ? "INCLUSIVE" : "EXCLUSIVE") + " | rows=" + trace.item_count + " | tax=" + trace.totals.tax_total + " | net=" + trace.totals.net_total
        );
        console.table(trace.rows);
        console.log("totals", trace.totals);
        trace.warnings.forEach((w) => console.warn("[digitz-tax]", w));
        console.groupEnd();
      }
      return trace;
    };
    engine.apply_round_off = function(doc, set_value) {
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
    engine.line_discount_base = function(row) {
      let base = flt(row.qty) * (flt(row.service_charge) + flt(row.typing_charges) + flt(row.transaction_charges) + flt(row.gov));
      return isFinite(base) && base > 0 ? base : 0;
    };
    engine.apply_discount_percentage = function(row) {
      let base = engine.line_discount_base(row);
      let pct = flt(row.discount_percentage);
      let message = null;
      if (!isFinite(pct) || pct <= 0) {
        row.discount_percentage = 0;
        row.discount_amount = 0;
      } else {
        if (pct > 100) {
          pct = 100;
          message = __("Discount percentage cannot exceed 100.");
        }
        row.discount_percentage = pct;
        row.discount_amount = flt(base) * (pct / 100);
      }
      return message;
    };
    engine.apply_discount_amount = function(row) {
      let base = engine.line_discount_base(row);
      let discount = flt(row.discount_amount);
      let message = null;
      if (!isFinite(discount) || discount <= 0) {
        row.discount_amount = 0;
        row.discount_percentage = 0;
      } else if (!base) {
        row.discount_amount = 0;
        row.discount_percentage = 0;
        message = __("Enter Qty first, and make sure Service Charge, Typing Charges, Transaction Charges or GOV is set on the Item - the rate is derived from them.");
      } else {
        if (discount > base) {
          discount = base;
          row.discount_amount = discount;
          message = __("Discount amount cannot exceed the line amount.");
        }
        row.discount_percentage = discount * 100 / base;
      }
      return message;
    };
    engine.fill_receipt_schedule = function(doc, refresh = false, refresh_credit_days = false) {
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
        doc.receipt_schedule.forEach(function(row) {
          if (row) {
            receiptRow = row;
            if (refresh || refresh_credit_days) {
              receiptRow.date = creditDays ? frappe.datetime.add_days(postingDate, creditDays) : postingDate;
            }
            row_count++;
          }
        });
        if (!receiptRow) {
          receiptRow = frappe.model.add_child(doc, "Receipt Schedule", "receipt_schedule");
          receiptRow.date = creditDays ? frappe.datetime.add_days(postingDate, creditDays) : postingDate;
          receiptRow.payment_mode = "Cash";
          receiptRow.amount = doc.rounded_total;
        } else if (row_count == 1) {
          receiptRow.payment_mode = "Cash";
          receiptRow.amount = doc.rounded_total;
        }
        if (refresh || refresh_credit_days) {
          receiptRow.date = creditDays ? frappe.datetime.add_days(postingDate, creditDays) : postingDate;
        }
      } else {
        doc.receipt_schedule = [];
      }
    };
    engine.set_cash_balance = function(doc, set_value) {
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
    engine.cash_received_error = function(doc) {
      if (cint(doc.credit_sale) || doc.payment_mode_type !== "Cash") {
        return null;
      }
      if (!flt(doc.received_amount)) {
        return {
          title: __("Received Amount Needed"),
          message: __("Enter the Received Amount: the cash the customer handed over. It is required for a cash sale.")
        };
      }
      if (flt(doc.received_amount) < flt(doc.rounded_total) - 5e-3) {
        return {
          title: __("Received Amount Too Low"),
          message: __(
            "The Received Amount ({0}) is less than the invoice total ({1}). Collect the full amount, or make it a credit sale.",
            [format_currency(doc.received_amount), format_currency(doc.rounded_total)]
          )
        };
      }
      return null;
    };
    engine.is_placeholder_mobile = function(number) {
      const digits = String(number || "").replace(/\D/g, "");
      return digits.length > 0 && /^0+$/.test(digits);
    };
    engine.company_defaults = async function(doc) {
      var _a2, _b;
      const r = await frappe.call({
        method: "frappe.client.get_value",
        args: { doctype: "Global Settings", fieldname: "default_company" }
      });
      const default_company = ((_a2 = r.message) == null ? void 0 : _a2.default_company) || "";
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
        doc.terms_and_conditions = ((_b = terms_res.message) == null ? void 0 : _b.terms) || "";
      }
      return {
        allow_edit_sales_invoice_no: company_data.allow_edit_sales_invoice_no,
        hidden_fields: (company_data.hidden_sales_invoice || "").split(",").map((f) => f.trim()).filter(Boolean)
      };
    };
    engine.customer_terms = function(customer) {
      return frappe.call({
        method: "digitz_erp.api.settings_api.get_customer_terms",
        args: { customer }
      }).then((r) => r.message || {});
    };
    engine.party_balance = function(customer) {
      return frappe.call({
        method: "digitz_erp.accounts.doctype.gl_posting.gl_posting.get_party_balance",
        args: { party_type: "Customer", party: customer }
      }).then((r) => r.message);
    };
    engine.payment_defaults = function(doc) {
      return frappe.call({
        method: "digitz_erp.selling.doctype.sales_invoice.sales_invoice.get_sales_payment_defaults",
        args: { customer: doc.customer || null, company: doc.company || null }
      }).then((r) => r.message || {});
    };
    engine.load_item = async function(doc, row) {
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
        }
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
        let advance_value = doc.project_value * doc.advance_percentage / 100;
        row.rate = advance_value;
        advance_message = doc.advance_percentage + "% advance = " + advance_value + " allocated in the line item.";
      }
      if (!row.tax_excluded) {
        const r2 = await frappe.call({
          method: "frappe.client.get_value",
          args: { doctype: "Tax", filters: { tax_name: r.message.tax }, fieldname: ["tax_name", "tax_rate"] }
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
    engine.load_tax_rate = async function(row) {
      const r = await frappe.call({
        method: "frappe.client.get_value",
        args: { doctype: "Tax", filters: { tax_name: row.tax }, fieldname: ["tax_name", "tax_rate"] }
      });
      row.tax_rate = r.message.tax_rate;
    };
    engine.apply_item_charges = async function(doc, rows) {
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
          posting_date: doc.posting_date
        }
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
    engine.rate_only_alert = function(doc, rate_only) {
      if (rate_only && rate_only.length) {
        frappe.show_alert({
          message: __(
            "{0} has only a rate in price list {1}, with no Service Charge / Typing Charges / Transaction Charges / GOV, so the Item master charges were used.",
            [rate_only.join(", "), doc.price_list]
          ),
          indicator: "orange"
        }, 8);
      }
    };
    engine.customer_billing_details = function(customer) {
      return frappe.call({
        method: "digitz_erp.selling.doctype.sales_invoice.sales_invoice.get_customer_billing_details",
        args: { customer }
      }).then((r) => r.message || {});
    };
    engine.show_gl_postings = function(doctype, name) {
      frappe.call({
        method: "digitz_erp.api.accounts_api.get_gl_postings",
        args: { voucher: doctype, voucher_no: name },
        callback: function(response) {
          let gl_postings = response.message.gl_postings;
          let totalDebit = parseFloat(response.message.total_debit).toFixed(2);
          let totalCredit = parseFloat(response.message.total_credit).toFixed(2);
          let htmlContent = '<div style="max-height: 680px; overflow-y: auto;"><table class="table table-bordered" style="width: 100%;"><thead><tr><th style="width: 15%;">Account</th><th style="width: 25%;">Remarks</th><th style="width: 10%;">Debit Amount</th><th style="width: 10%;">Credit Amount</th><th style="width: 10%;">Party</th><th style="width: 10%;">Against Account</th><th style="width: 10%;">Project</th><th style="width: 10%;">Cost Center</th></tr></thead><tbody>';
          gl_postings.forEach(function(gl_posting) {
            let remarksText = gl_posting.remarks || "";
            let debitAmount = parseFloat(gl_posting.debit_amount).toFixed(2);
            let creditAmount = parseFloat(gl_posting.credit_amount).toFixed(2);
            htmlContent += `<tr><td>${gl_posting.account}</td><td>${remarksText}</td><td style="text-align: right;">${debitAmount}</td><td style="text-align: right;">${creditAmount}</td><td>${gl_posting.party}</td><td>${gl_posting.against_account}</td><td>${gl_posting.project}</td><td>${gl_posting.cost_center}</td></tr>`;
          });
          htmlContent += `<tr><td style="font-weight: bold;">Total</td><td></td><td style="text-align: right; font-weight: bold;">${totalDebit}</td><td style="text-align: right; font-weight: bold;">${totalCredit}</td><td colspan="5"></td></tr>`;
          htmlContent += "</tbody></table></div>";
          let d = new frappe.ui.Dialog({
            title: "General Ledgers",
            fields: [{ fieldtype: "HTML", fieldname: "general_ledgers_html", options: htmlContent }],
            primary_action_label: "Close",
            primary_action: function() {
              d.hide();
            }
          });
          d.$wrapper.find(".modal-dialog").css("max-width", "90%");
          d.show();
        }
      });
    };
    engine.show_stock_ledgers = function(doctype, name) {
      frappe.call({
        method: "digitz_erp.api.accounts_api.get_stock_ledgers",
        args: { voucher: doctype, voucher_no: name },
        callback: function(response) {
          let stock_ledgers_data = response.message;
          let htmlContent = '<div style="max-height: 400px; overflow-y: auto;"><table class="table table-bordered" style="width: 100%;"><thead><tr><th style="width: 10%;">Item Code</th><th style="width: 20%;">Item Name</th><th style="width: 15%;">Warehouse</th><th style="width: 10%;">Qty In</th><th style="width: 10%;">Qty Out</th><th style="width: 15%;">Valuation Rate</th><th style="width: 15%;">Balance Qty</th><th style="width: 15%;">Balance Value</th></tr></thead><tbody>';
          stock_ledgers_data.forEach(function(ledger) {
            htmlContent += `<tr><td><a href="/app/item/${ledger.item}" target="_blank">${ledger.item}</a></td><td>${ledger.item_name}</td><td>${ledger.warehouse}</td><td>${ledger.qty_in}</td><td>${ledger.qty_out}</td><td>${ledger.valuation_rate}</td><td>${ledger.balance_qty}</td><td>${ledger.balance_value}</td></tr>`;
          });
          htmlContent += "</tbody></table></div>";
          let d = new frappe.ui.Dialog({
            title: "Stock Ledgers",
            fields: [{ fieldtype: "HTML", fieldname: "stock_ledgers_html", options: htmlContent }],
            primary_action_label: "Close",
            primary_action: function() {
              d.hide();
            }
          });
          d.$wrapper.find(".modal-dialog").css("max-width", "85%");
          d.show();
        }
      });
    };
    engine.print_pdf = function(file_url, label, on_fail) {
      $(".ci-print-frame").remove();
      const frame = $(`<iframe class="ci-print-frame" title="${frappe.utils.escape_html(label || "")}"
			style="position: fixed; right: 0; bottom: 0; width: 1px; height: 1px; border: 0; opacity: 0;"></iframe>`).appendTo(document.body)[0];
      frame.onload = () => {
        setTimeout(() => {
          try {
            frame.contentWindow.focus();
            frame.contentWindow.print();
            frappe.show_alert({ message: __("Sent {0} to the printer", [label]), indicator: "green" });
          } catch (e) {
            on_fail ? on_fail() : window.open(file_url, "_blank");
          }
          setTimeout(() => frame.remove(), 6e4);
        }, 600);
      };
      frame.src = `${encodeURI(file_url)}?v=${Date.now()}`;
    };
    engine.get_print_pdfs = async function(docname, fresh) {
      const r = await frappe.call({
        method: fresh ? "digitz_erp.selling.doctype.sales_invoice.sales_invoice.get_print_pdf_urls" : "digitz_erp.selling.doctype.sales_invoice.sales_invoice.print_sales_invoice_pdf",
        args: { docname },
        freeze: true,
        freeze_message: __("Generating PDF...")
      });
      return (fresh ? r.message : r.message && r.message.files) || {};
    };
    engine.ctrl_p_handlers = [];
    engine.on_ctrl_p = function(handler) {
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
    engine.shortcuts_html = function(shortcuts) {
      const esc = (v) => frappe.utils.escape_html(v == null ? "" : String(v));
      const is_mac = /Mac/i.test(navigator.platform || "");
      return `<div class="si-shortcuts" aria-label="${__("Keyboard shortcuts")}">
			<span class="si-shortcuts-title">${__("Shortcuts")}</span>
			${shortcuts.map(([keys, label]) => `
				<span class="si-shortcut">${keys.split("+").map((k) => `<kbd>${esc(is_mac && k === "Ctrl" ? "\u2318" : k)}</kbd>`).join("+")} ${esc(label)}</span>`).join("")}
		</div>`;
    };
  })(digitz_erp.si_engine);

  // ../digitz_erp/digitz_erp/public/js/cashier_invoices.js
  frappe.provide("digitz_erp");
  (function() {
    var _a2;
    const DOCTYPE = "Sales Invoice";
    const ITEM_DOCTYPE = "Sales Invoice Item";
    const ROUTE = ["cashier-console", "invoices"];
    const E = () => digitz_erp.si_engine;
    const esc = (v) => frappe.utils.escape_html(v == null ? "" : String(v));
    const money = (v) => format_currency(flt(v), frappe.boot.sysdefaults.currency);
    const num = (v) => format_number(flt(v), null, 2);
    const storage_key = () => `digitz_cashier_invoices:${frappe.session.user}`;
    const LINKED = ["sales_order", "quotation", "project", "for_advance_payment", "for_retention_recovery"];
    const PAYMENT_FIELDS = ["credit_sale", "payment_mode", "payment_account", "reference_no", "received_amount"];
    const ROW_LINKED = ["sales_order_item_reference_no", "delivery_note_item_reference_no", "quotation_item_reference_no"];
    async function read_values(doctype, name, fields) {
      try {
        return (await frappe.db.get_value(doctype, name, fields)).message || {};
      } catch (err) {
        return {};
      }
    }
    function compact_textarea(control) {
      control.$input && control.$input.is("textarea") && control.$input.css("height", "72px");
    }
    function today_only() {
      const state = digitz_erp.counter_state;
      return state ? !!state.must_open_day : frappe.user.has_role("Cashier") && !frappe.user.has_role("System Manager");
    }
    function other_day(doc) {
      return !doc.__islocal && doc.docstatus === 0 && !!doc.posting_date && doc.posting_date !== frappe.datetime.get_today();
    }
    function linked_to(doc) {
      const found = LINKED.filter((f) => doc[f]).map((f) => frappe.meta.get_label(DOCTYPE, f));
      if ((doc.delivery_notes || []).length || (doc.items || []).some((r) => ROW_LINKED.some((f) => r[f]))) {
        found.push(__("Delivery Note / Sales Order / Quotation items"));
      }
      return [...new Set(found)];
    }
    digitz_erp.CashierInvoices = class CashierInvoices {
      constructor(page, parent) {
        this.page = page;
        this.tabs = [];
        this.active = "list";
        this.new_count = 0;
        this.mobile_mandatory = null;
        this.$el = $(`
				<div class="ci">
					<div class="ci-strip" role="tablist" aria-label="${__("Open invoices")}">
						<button type="button" class="ci-stab ci-stab-list active" data-key="list" role="tab">
							${frappe.utils.icon("list", "sm")}<span>${__("All Invoices")}</span>
						</button>
						<div class="ci-stab-docs"></div>
						<div class="ci-strip-files"></div>
						<button type="button" class="ci-new" title="${__("New Invoice (Alt+N)")}">
							${frappe.utils.icon("add", "sm")}<span>${__("New Invoice")}</span>
						</button>
					</div>
					<div class="ci-views">
						<div class="ci-view" data-key="list"></div>
					</div>
				</div>
			`).appendTo(parent);
        this.$docs = this.$el.find(".ci-stab-docs");
        this.list = new digitz_erp.InvoiceList(this, this.$el.find('.ci-view[data-key="list"]'));
        this.bind();
        this.restore();
      }
      bind() {
        this.$el.on("click", ".ci-stab", (e) => {
          if ($(e.target).closest(".ci-stab-close").length) {
            return;
          }
          this.go($(e.currentTarget).attr("data-key"));
        });
        this.$el.on("click", ".ci-stab-close", (e) => {
          e.stopPropagation();
          this.close($(e.currentTarget).closest(".ci-stab").attr("data-key"));
        });
        this.$el.on("click", ".ci-new", () => this.new_invoice());
        this.$el.on("click", ".ci-strip-file", (e) => {
          const editor = this.active_editor();
          if (!editor || e.ctrlKey || e.metaKey || e.shiftKey) {
            return;
          }
          e.preventDefault();
          editor.show_pdf(cint(e.currentTarget.dataset.pdfIndex));
        });
        this.$el.on("change", "[data-print-flag]", (e) => {
          const editor = this.active_editor();
          editor && editor.set_print_flag(e.currentTarget.dataset.printFlag, e.currentTarget.checked ? 1 : 0);
        });
        frappe.ui.keys.add_shortcut({
          shortcut: "alt+n",
          action: () => this.is_visible() && this.new_invoice(),
          description: __("Cashier Console: New Sales Invoice"),
          page: this.page,
          ignore_inputs: true
        });
        frappe.ui.keys.add_shortcut({
          shortcut: "alt+p",
          action: () => {
            const editor = this.active_editor();
            editor && this.is_visible() && editor.open_payment_dialog();
          },
          description: __("Cashier Console: Payment"),
          page: this.page,
          ignore_inputs: true
        });
        E().on_ctrl_p({
          applies: () => frappe.get_route()[0] === ROUTE[0] && this.is_visible() && !!this.active_editor(),
          print: () => this.active_editor().print_direct("invoice")
        });
        frappe.ui.keys.add_shortcut({
          shortcut: "ctrl+s",
          action: () => {
            const editor = this.active_editor();
            if (editor && this.is_visible()) {
              editor.save("Save");
              return true;
            }
            return false;
          },
          description: __("Cashier Console: Save Sales Invoice"),
          page: this.page,
          ignore_inputs: true
        });
        $(window).on("beforeunload", () => {
          if (this.tabs.some((t) => t.editor && t.editor.dirty)) {
            return true;
          }
        });
      }
      is_visible() {
        return this.$el.is(":visible");
      }
      active_editor() {
        const tab = this.tabs.find((t) => t.key === this.active);
        return tab && tab.editor;
      }
      go(key) {
        key && key !== "list" ? frappe.set_route(...ROUTE, key) : frappe.set_route(...ROUTE);
      }
      new_invoice() {
        frappe.set_route(...ROUTE, "new");
      }
      open_invoice(name) {
        this.go(name);
      }
      replace_route(key) {
        frappe.route_flags.replace_route = true;
        this.go(key);
      }
      async route(sub) {
        const key = sub && sub[0] ? decodeURIComponent(sub[0]) : "list";
        await frappe.model.with_doctype(DOCTYPE);
        if (key === "list") {
          this.show("list");
          return;
        }
        if (key === "new") {
          const tab2 = await this.add_new();
          tab2 && this.replace_route(tab2.key);
          return;
        }
        let tab = this.tabs.find((t) => t.key === key);
        if (!tab) {
          if (key.startsWith("new-sales-invoice")) {
            this.replace_route("new");
            return;
          }
          tab = this.add_tab(key);
        }
        this.show(key);
        if (!tab.editor && !tab.loading) {
          await this.load(tab);
        }
      }
      refresh() {
        if (this.active === "list") {
          this.list.load(true);
        } else {
          const editor = this.active_editor();
          editor && !editor.dirty && !editor.doc.__islocal && editor.reload();
        }
      }
      add_tab(key, label) {
        const tab = { key, label: label || key };
        tab.$tab = $(`
				<button type="button" class="ci-stab ci-stab-doc" role="tab" data-key="${esc(key)}">
					<span class="ci-stab-dot"></span>
					<span class="ci-stab-label"></span>
					<span class="ci-stab-close" role="button" title="${__("Close")}">${frappe.utils.icon("close", "xs")}</span>
				</button>`).appendTo(this.$docs);
        tab.$view = $(`<div class="ci-view" data-key="${esc(key)}" hidden></div>`).appendTo(this.$el.find(".ci-views"));
        this.tabs.push(tab);
        this.paint(tab);
        return tab;
      }
      async add_new(doc, opts = {}) {
        this.new_count++;
        const editor_doc = doc || frappe.model.get_new_doc(DOCTYPE);
        const tab = this.add_tab(editor_doc.name, __("New Invoice {0}", [this.new_count]));
        tab.editor = new digitz_erp.InvoiceEditor(this, tab, editor_doc);
        await tab.editor.init_new(opts);
        return tab;
      }
      async load(tab) {
        tab.loading = true;
        tab.$view.html(`<div class="ci-loading">${__("Loading {0}...", [esc(tab.key)])}</div>`);
        try {
          if (frappe.get_doc(DOCTYPE, tab.key)) {
            frappe.model.remove_from_locals(DOCTYPE, tab.key);
          }
          await frappe.model.with_doc(DOCTYPE, tab.key);
          const doc = frappe.get_doc(DOCTYPE, tab.key);
          if (!doc) {
            throw new Error("not found");
          }
          tab.editor = new digitz_erp.InvoiceEditor(this, tab, doc);
          tab.editor.render();
        } catch (e) {
          tab.$view.html(`<div class="ci-loading">${__("Could not open {0}. It may have been deleted or you may not have access.", [esc(tab.key)])}</div>`);
        } finally {
          tab.loading = false;
          this.paint(tab);
          this.persist();
        }
      }
      show(key) {
        this.active = key;
        this.$el.find(".ci-stab").each((_, el) => {
          const on = el.dataset.key === key;
          el.classList.toggle("active", on);
          el.setAttribute("aria-selected", on ? "true" : "false");
          on && el.scrollIntoView && el.scrollIntoView({ block: "nearest", inline: "nearest" });
        });
        this.$el.find(".ci-view").each((_, el) => {
          el.hidden = el.dataset.key !== key;
        });
        if (key === "list") {
          this.list.show();
        }
        const editor = this.active_editor();
        editor && editor.on_show();
        this.paint_files();
        this.$el.closest(".cashier-console").toggleClass("cc-in-invoice", key !== "list");
      }
      paint_files() {
        const editor = this.active_editor();
        if (!editor) {
          this.$el.find(".ci-strip-files").empty();
          return;
        }
        const doc = editor.doc;
        const pdfs = !doc.__islocal ? editor.pdfs || [] : [];
        const can_change = editor.can_change_print_flags();
        const flag = (fieldname, label) => `
				<label class="ci-print-flag" title="${__("Shown on the invoice and receipt printouts")}">
					<input type="checkbox" data-print-flag="${fieldname}" ${cint(doc[fieldname]) ? "checked" : ""} ${can_change ? "" : "disabled"}>
					<span>${label}</span>
				</label>`;
        this.$el.find(".ci-strip-files").html(`
				<div class="ci-print-flags">
					<span class="ci-print-caption">${__("Print shows")}</span>
					${flag("show_company_in_printout", __("Company"))}
					${flag("show_trn_in_printout", __("TRN"))}
				</div>
				${pdfs.map((f, i) => `
					<a class="ci-strip-file" href="${encodeURI(f.file_url)}" target="_blank" rel="noopener" title="${esc(f.file_name)}" data-pdf-index="${i}">
						${frappe.utils.icon("file", "sm")}<span>${f.label}</span>
					</a>`).join("")}`);
      }
      paint(tab) {
        const editor = tab.editor;
        const doc = editor && editor.doc;
        let state = "loading";
        if (doc) {
          state = doc.__islocal ? "new" : ["draft", "submitted", "cancelled"][doc.docstatus] || "draft";
        }
        tab.$tab.attr("data-state", state).toggleClass("is-dirty", !!(editor && editor.dirty));
        tab.$tab.find(".ci-stab-label").text(doc && !doc.__islocal ? doc.name : tab.label);
        tab.$tab.attr("title", doc && doc.customer_display_name ? `${tab.$tab.find(".ci-stab-label").text()} \xB7 ${doc.customer_display_name}` : "");
      }
      close(key) {
        const tab = this.tabs.find((t) => t.key === key);
        if (!tab) {
          return;
        }
        const remove = () => {
          const i = this.tabs.indexOf(tab);
          this.tabs.splice(i, 1);
          tab.$tab.remove();
          tab.$view.remove();
          if (tab.editor && frappe.get_doc(DOCTYPE, tab.editor.doc.name)) {
            frappe.model.remove_from_locals(DOCTYPE, tab.editor.doc.name);
          }
          this.persist();
          if (this.active === key) {
            const next = this.tabs[i] || this.tabs[i - 1];
            this.replace_route(next ? next.key : "list");
          }
        };
        if (tab.editor && tab.editor.dirty) {
          frappe.confirm(__("{0} has unsaved changes. Close it and lose them?", [esc(tab.$tab.find(".ci-stab-label").text())]), remove);
        } else {
          remove();
        }
      }
      renamed(tab, old_key) {
        tab.key = tab.editor.doc.name;
        tab.$tab.attr("data-key", tab.key);
        tab.$view.attr("data-key", tab.key);
        if (this.active === old_key) {
          this.active = tab.key;
          this.replace_route(tab.key);
        }
        this.persist();
      }
      persist() {
        const names = this.tabs.filter((t) => !t.key.startsWith("new-")).map((t) => t.key);
        try {
          localStorage.setItem(storage_key(), JSON.stringify(names.slice(-10)));
        } catch (e) {
        }
      }
      restore() {
        let names = [];
        try {
          names = JSON.parse(localStorage.getItem(storage_key()) || "[]");
        } catch (e) {
          names = [];
        }
        (Array.isArray(names) ? names : []).forEach((name) => typeof name === "string" && this.add_tab(name));
      }
      async get_mobile_mandatory() {
        if (this.mobile_mandatory === null) {
          const r = await frappe.call({ method: "digitz_erp.selling.doctype.sales_invoice.sales_invoice.get_customer_mobile_number_mandatory" });
          this.mobile_mandatory = cint(r.message);
        }
        return this.mobile_mandatory;
      }
    };
    digitz_erp.InvoiceList = (_a2 = class {
      constructor(host, $el) {
        this.host = host;
        this.$el = $el;
        this.range = "today";
        this.status = "";
        this.payment = "";
        this.search = "";
        this.rows = [];
        this.reload = frappe.utils.debounce(() => this.load(true), 300);
        this.make();
      }
      make() {
        const chips = (name, items, value) => `
				<div class="ci-chips" data-filter="${name}">
					${items.map(([v, label]) => `<button type="button" class="ci-chip${v === value ? " active" : ""}" data-value="${v}">${label}</button>`).join("")}
				</div>`;
        this.$el.html(`
				<div class="ci-list">
					<div class="ci-list-bar">
						<div class="ci-search">
							${frappe.utils.icon("search", "sm")}
							<input type="search" class="form-control" placeholder="${__("Search invoice no, customer, company, mobile or token")}" aria-label="${__("Search invoices")}">
						</div>
						<select class="form-control ci-range" aria-label="${__("Period")}">
							${[["today", __("Today")], ["week", __("This Week")], ["month", __("This Month")], ["30", __("Last 30 Days")], ["all", __("All")]].map(([v, label]) => `<option value="${v}"${v === this.range ? " selected" : ""}>${label}</option>`).join("")}
						</select>
						${chips("status", [["", __("Any Status")], ["0", __("Draft")], ["1", __("Submitted")], ["2", __("Cancelled")]], this.status)}
						${chips("payment", [["", __("Cash & Credit")], ["cash", __("Cash")], ["credit", __("Credit")]], this.payment)}
						<span class="ci-list-count text-muted"></span>
					</div>
					<div class="ci-list-table"></div>
					<div class="ci-list-more" hidden>
						<button type="button" class="btn btn-default btn-sm">${__("Load more")}</button>
					</div>
				</div>
			`);
        this.$el.on("input", ".ci-search input", (e) => {
          this.search = e.currentTarget.value.trim();
          this.reload();
        });
        this.$el.on("change", ".ci-range", (e) => {
          this.range = e.currentTarget.value;
          this.load(true);
        });
        this.$el.on("click", ".ci-chip", (e) => {
          const $chip = $(e.currentTarget);
          const filter = $chip.closest(".ci-chips").attr("data-filter");
          this[filter] = $chip.attr("data-value");
          $chip.addClass("active").siblings().removeClass("active");
          this.load(true);
        });
        this.$el.on("click", "tr[data-name]", (e) => this.host.open_invoice($(e.currentTarget).attr("data-name")));
        this.$el.on("keydown", "tr[data-name]", (e) => {
          if (e.key === "Enter") {
            this.host.open_invoice($(e.currentTarget).attr("data-name"));
          }
        });
        this.$el.on("click", ".ci-list-more button", () => this.load(false));
      }
      show() {
        this.loaded ? this.paint_open() : this.load(true);
      }
      filters() {
        const today = frappe.datetime.get_today();
        const from = {
          today,
          week: frappe.datetime.week_start(),
          month: frappe.datetime.month_start(),
          30: frappe.datetime.add_days(today, -29)
        }[this.range];
        const filters = [];
        from && filters.push([DOCTYPE, "posting_date", ">=", from]);
        this.status !== "" && filters.push([DOCTYPE, "docstatus", "=", cint(this.status)]);
        this.payment && filters.push([DOCTYPE, "credit_sale", "=", this.payment === "credit" ? 1 : 0]);
        return filters;
      }
      async load(reset) {
        const seq = this.seq = (this.seq || 0) + 1;
        const start = reset ? 0 : this.rows.length;
        const like = `%${this.search}%`;
        this.$el.addClass("is-loading");
        try {
          const r = await frappe.call({
            method: "frappe.client.get_list",
            args: {
              doctype: DOCTYPE,
              fields: [
                "name",
                "posting_date",
                "posting_time",
                "customer",
                "customer_name",
                "customer_display_name",
                "customer_company",
                "customer_mobile_number",
                "customer_token",
                "medical_service",
                "credit_sale",
                "payment_mode",
                "payment_status",
                "rounded_total",
                "docstatus"
              ],
              filters: this.filters(),
              or_filters: this.search ? ["name", "customer", "customer_display_name", "customer_company", "customer_mobile_number", "customer_token"].map((f) => [DOCTYPE, f, "like", like]) : [],
              order_by: "posting_date desc, posting_time desc, creation desc",
              limit_start: start,
              limit_page_length: digitz_erp.InvoiceList.PAGE + 1
            }
          });
          if (seq !== this.seq) {
            return;
          }
          const rows = r.message || [];
          const more = rows.length > digitz_erp.InvoiceList.PAGE;
          this.rows = (reset ? [] : this.rows).concat(rows.slice(0, digitz_erp.InvoiceList.PAGE));
          this.loaded = true;
          this.render(more);
        } finally {
          seq === this.seq && this.$el.removeClass("is-loading");
        }
      }
      render(more) {
        const $table = this.$el.find(".ci-list-table");
        this.$el.find(".ci-list-more").prop("hidden", !more);
        this.$el.find(".ci-list-count").text(
          this.rows.length ? __("{0} invoice(s){1}", [this.rows.length, more ? "+" : ""]) : ""
        );
        if (!this.rows.length) {
          $table.html(`
					<div class="ci-empty-list">
						<p>${this.search ? __("No invoices match your search.") : __("No invoices in this period.")}</p>
						<button type="button" class="btn btn-primary btn-sm ci-new">${__("New Invoice")}</button>
					</div>`);
          return;
        }
        const status = (row) => {
          const [label, colour] = [[__("Draft"), "orange"], [__("Submitted"), "green"], [__("Cancelled"), "red"]][row.docstatus] || ["", "gray"];
          return `<span class="indicator-pill ${colour}">${label}</span>`;
        };
        const time = (row) => row.posting_time ? moment(String(row.posting_time), "HH:mm:ss").format("HH:mm") : "";
        $table.html(`
				<div class="ci-scroll">
					<table class="ci-table ci-table-list">
						<thead><tr>
							<th>${__("Invoice")}</th><th>${__("Date")}</th><th>${__("Customer")}</th><th>${__("Mobile")}</th>
							<th>${__("Token / Service")}</th><th>${__("Payment")}</th><th class="ci-num">${__("Total")}</th><th>${__("Status")}</th>
						</tr></thead>
						<tbody>${this.rows.map((row) => `
							<tr data-name="${esc(row.name)}" tabindex="0">
								<td class="ci-strong ci-nowrap"><span class="ci-open-mark" title="${__("Open in a tab")}"></span>${esc(row.name)}</td>
								<td class="ci-nowrap">${frappe.datetime.str_to_user(row.posting_date)} <span class="text-muted">${time(row)}</span></td>
								<td><div class="ci-ellipsis">${esc(row.customer_display_name || row.customer_name || row.customer)}</div>
									${row.customer_display_name && row.customer_display_name !== row.customer ? `<div class="ci-sub ci-ellipsis">${esc(row.customer)}</div>` : ""}
									${row.customer_company && row.customer_company !== row.customer ? `<div class="ci-sub ci-ellipsis">${esc(row.customer_company)}</div>` : ""}</td>
								<td class="ci-nowrap">${esc(row.customer_mobile_number)}</td>
								<td><div class="ci-ellipsis">${esc(row.customer_token)}</div><div class="ci-sub ci-ellipsis">${esc(row.medical_service)}</div></td>
								<td>${row.credit_sale ? `<span class="ci-tag ci-tag-credit">${__("Credit")}</span>` : `<span class="ci-tag">${esc(row.payment_mode || row.payment_status || __("Cash"))}</span>`}</td>
								<td class="ci-num ci-strong">${money(row.rounded_total)}</td>
								<td>${status(row)}</td>
							</tr>`).join("")}
						</tbody>
					</table>
				</div>`);
        this.paint_open();
      }
      paint_open() {
        const open = new Set(this.host.tabs.map((t) => t.key));
        this.$el.find("tr[data-name]").each((_, tr) => tr.classList.toggle("is-open", open.has(tr.dataset.name)));
      }
    }, __publicField(_a2, "PAGE", 50), _a2);
    digitz_erp.InvoiceEditor = class InvoiceEditor {
      constructor(host, tab, doc) {
        this.host = host;
        this.tab = tab;
        this.doc = doc;
        this.dirty = !!doc.__islocal;
        this.settings = { allow_edit_sales_invoice_no: 0, hidden_fields: [] };
        this.controls = {};
        this.row_controls = {};
        this.walk_in = false;
        this.$el = tab.$view;
      }
      async init_new() {
        this.tab.$view.html(`<div class="ci-loading">${__("Preparing a new invoice...")}</div>`);
        try {
          const settings = await E().company_defaults(this.doc);
          if (settings) {
            this.settings = settings;
          }
        } catch (err) {
          console.error("Error loading Sales Invoice company defaults:", err);
        }
        await this.set_default_payment_mode();
        this.render();
      }
      async reload() {
        frappe.model.remove_from_locals(DOCTYPE, this.doc.name);
        await frappe.model.with_doc(DOCTYPE, this.doc.name);
        this.doc = frappe.get_doc(DOCTYPE, this.doc.name);
        this.dirty = false;
        this.render();
      }
      on_show() {
        this.update_stock_hint();
      }
      is_editable() {
        return this.doc.docstatus === 0 && !this.doc.tab_sales && !linked_to(this.doc).length && !(today_only() && other_day(this.doc));
      }
      visible(fieldname) {
        const df = frappe.meta.get_docfield(DOCTYPE, fieldname);
        if (!df || this.settings.hidden_fields.includes(fieldname)) {
          return false;
        }
        if (fieldname === "credit_days") {
          return !!this.doc.credit_sale;
        }
        if (fieldname === "sales_inv_no") {
          return !!this.settings.allow_edit_sales_invoice_no;
        }
        return !cint(df.hidden);
      }
      render() {
        this.controls = {};
        this.row_controls = {};
        const doc = this.doc;
        const editable = this.is_editable();
        this.$el.html(`
				<div class="ci-editor${editable ? "" : " is-readonly"}">
					<div class="ci-banners"></div>
					<header class="ci-head">
						<div class="ci-head-main">
							<h3 class="ci-docname"></h3>
							<span class="ci-status indicator-pill"></span>
							<div class="ci-head-meta"></div>
						</div>
						<div class="ci-actions"></div>
					</header>
					<div class="ci-shortcuts-slot"></div>
					<div class="ci-layout">
						<div class="ci-main">
							<section class="ci-card ci-card-customer">
								<div class="ci-fields ci-fields-customer-main"></div>
								<div class="ci-cust-foot">
									<button type="button" class="ci-cust-toggle" aria-expanded="false">
										${frappe.utils.icon("down", "xs")}
										<span class="ci-strong">${__("Customer details")}</span>
										<span class="ci-cust-summary text-muted">${__("Email, company & TRN, address, salesman, token")}</span>
									</button>
									<div class="ci-cust-chips">
										<span class="ci-chip-info ci-token" hidden></span>
										<span class="ci-balance" hidden></span>
									</div>
								</div>
								<div class="ci-cust-body" hidden>
									<div class="ci-fields ci-fields-customer"></div>
								</div>
							</section>
							<section class="ci-card ci-card-items">
								<div class="ci-items-bar">
									<div class="ci-item-search"></div>
									<button type="button" class="btn btn-primary btn-sm ci-pay-btn" title="${__("Payment (Alt+P)")}">${__("Payment")}</button>
									<button type="button" class="ci-pay-info" title="${__("Payment (Alt+P)")}"></button>
									<span class="ci-count"></span>
								</div>
								<div class="ci-scroll"><table class="ci-table ci-items">
									<thead><tr>
										<th class="ci-col-item">${__("Item")}</th>
										<th class="ci-num">${__("Qty")}</th>
										<th class="ci-num" title="${__("Service Charge + Typing Charges + Transaction Charges + GOV")}">${__("Rate")}</th>
										<th class="ci-num">${__("Service Charges")}</th>
										<th class="ci-num">${__("GOV")}</th>
										<th class="ci-num">${__("Typing Charges")}</th>
										<th class="ci-num">${__("Transaction Charges")}</th>
										<th class="ci-num">${__("VAT")}</th>
										<th class="ci-num">${__("Net")}</th>
										<th></th>
									</tr></thead>
									<tbody></tbody>
								</table></div>
								<div class="ci-stock-hint text-muted"></div>
							</section>
							<!-- Total under the items. Payment is the summary and popup in the items bar -->
							<div class="ci-side">
								<section class="ci-card ci-card-total">
									<div class="ci-total-label">${__("Total")}</div>
									<div class="ci-total-value"></div>
									<div class="ci-total-words text-muted"></div>
									<div class="ci-sums"></div>
								</section>
							</div>
							<section class="ci-card ci-card-more">
								<button type="button" class="ci-more-toggle" aria-expanded="false">
									<h4>${__("More Details")}</h4>
									<span class="ci-more-hint text-muted">${__("Date & time, price list, remarks")}</span>
									${frappe.utils.icon("down", "sm")}
								</button>
								<div class="ci-more-body" hidden>
									<div class="ci-fields ci-fields-more"></div>
									<div class="ci-info"></div>
								</div>
							</section>
						</div>
					</div>
				</div>
			`);
        this.make_fields(".ci-fields-customer-main", ["customer", "customer_display_name", "customer_mobile_number"]);
        this.make_fields(".ci-fields-customer", [
          "customer_email",
          "customer_token",
          "customer_company",
          "tax_id",
          ["customer_address", { span: 2 }],
          "salesman",
          "medical_service"
        ]);
        this.make_fields(".ci-fields-more", [
          "edit_posting_date_and_time",
          "posting_date",
          "posting_time",
          "naming_series",
          "sales_inv_no",
          "price_list",
          "rate_includes_tax",
          ["remarks", { span: 2 }],
          ["reason_for_unfilled_invoice", { span: 2 }]
        ]);
        this.make_item_search();
        this.bind();
        this.render_rows();
        this.refresh();
        this.load_files();
        if (doc.customer && editable) {
          E().customer_billing_details(doc.customer).then((d) => {
            this.walk_in = !!d.is_walk_in;
            this.refresh_states();
          });
        }
        if (editable && !doc.customer) {
          setTimeout(() => this.focus_field("customer"), 50);
        }
      }
      toggle_customer_details(open) {
        const $btn = this.$el.find(".ci-cust-toggle");
        open = open === void 0 ? $btn.attr("aria-expanded") !== "true" : open;
        $btn.attr("aria-expanded", open ? "true" : "false");
        this.$el.find(".ci-cust-body").prop("hidden", !open);
      }
      make_fields(selector, fields) {
        const $wrap = this.$el.find(selector);
        fields.forEach((entry) => {
          const [fieldname, opts] = Array.isArray(entry) ? entry : [entry, {}];
          const meta_df = frappe.meta.get_docfield(DOCTYPE, fieldname);
          if (!meta_df) {
            return;
          }
          const df = Object.assign({}, meta_df, {
            hidden: 0,
            depends_on: null,
            mandatory_depends_on: null,
            read_only_depends_on: null,
            change: () => this.on_change(fieldname)
          });
          df.get_query = this.query_for(fieldname);
          const $cell = $(`<div class="ci-field${opts.span ? " ci-span-2" : ""}" data-fieldname="${fieldname}"></div>`).appendTo($wrap);
          const control = frappe.ui.form.make_control({ df, parent: $cell, render_input: true, doc: this.doc });
          control.refresh();
          compact_textarea(control);
          this.controls[fieldname] = control;
        });
      }
      query_for(fieldname) {
        const doc = () => this.doc;
        return {
          customer: () => ({ filters: { disabled: 0 } }),
          salesman: () => ({ filters: { disabled: 0, status: ["!=", "On Boarding"] } }),
          price_list: () => ({ filters: { is_selling: 1 } }),
          ship_to_location: () => ({ filters: { parent: doc().customer } }),
          warehouse: () => ({ filters: { disabled: 0 } })
        }[fieldname];
      }
      make_item_search() {
        const $wrap = this.$el.find(".ci-item-search");
        if (!this.is_editable()) {
          $wrap.remove();
          this.$el.find(".ci-pay-btn").remove();
          this.$el.find(".ci-pay-info").prop("disabled", true);
          return;
        }
        this.item_search = frappe.ui.form.make_control({
          parent: $wrap,
          df: {
            fieldtype: "Link",
            fieldname: "item_search",
            options: "Item",
            placeholder: __("Search an item"),
            get_query: () => ({ filters: { item_type: ["not in", ["Labour"]] } }),
            change: () => {
              const value = this.item_search.get_value();
              if (value) {
                this.item_search.set_value("");
                this.add_item(value);
              }
            }
          },
          render_input: true
        });
        this.item_search.refresh();
        this.item_search.$wrapper.find(".control-label").remove();
      }
      bind() {
        this.$el.off();
        this.$el.on("click", ".ci-pay-btn, .ci-pay-info", () => this.open_payment_dialog());
        this.$el.on("click", ".ci-cust-toggle", () => this.toggle_customer_details());
        this.$el.on("click", ".ci-more-toggle", (e) => {
          const $btn = $(e.currentTarget);
          const open = $btn.attr("aria-expanded") !== "true";
          $btn.attr("aria-expanded", open ? "true" : "false");
          this.$el.find(".ci-more-body").prop("hidden", !open);
        });
        this.$el.on("change", ".ci-items input[data-f]", (e) => this.on_row_input(e.currentTarget));
        this.$el.on("keydown", ".ci-items input[data-f]", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        });
        this.$el.on("focus", ".ci-items input[data-f]", (e) => e.currentTarget.select());
        this.$el.on("click", ".ci-row-del", (e) => this.remove_row($(e.currentTarget).closest("tr").attr("data-row")));
        this.$el.on("click", ".ci-row-more", (e) => this.open_row_dialog($(e.currentTarget).closest("tr").attr("data-row")));
        this.$el.on("click", "[data-action]", (e) => {
          e.preventDefault();
          this.action($(e.currentTarget).attr("data-action"));
        });
      }
      refresh() {
        this.refresh_head();
        this.refresh_states();
        this.refresh_values();
        this.refresh_rows();
        this.refresh_totals();
        this.render_schedule();
        this.refresh_banners();
        this.host.paint(this.tab);
      }
      refresh_head() {
        const doc = this.doc;
        const [label, colour] = doc.__islocal ? [__("Not Saved"), "orange"] : [[__("Draft"), "orange"], [__("Submitted"), "green"], [__("Cancelled"), "red"]][doc.docstatus];
        this.$el.find(".ci-docname").text(doc.__islocal ? __("New Sales Invoice") : doc.name);
        this.$el.find(".ci-status").attr("class", `ci-status indicator-pill ${this.dirty && !doc.__islocal ? "orange" : colour}`).text(this.dirty && !doc.__islocal ? __("Not Saved") : label);
        const meta = [
          `${frappe.utils.icon("calendar", "xs")} ${frappe.datetime.str_to_user(doc.posting_date)} ${doc.posting_time ? moment(String(doc.posting_time), "HH:mm:ss").format("HH:mm") : ""}`
        ];
        doc.counter && meta.push(`${esc(doc.counter)}${doc.counter_session ? ` \xB7 ${esc(doc.counter_session)}` : ""}`);
        doc.payment_status && !doc.__islocal && meta.push(esc(doc.payment_status));
        doc.amended_from && meta.push(__("Amended from {0}", [esc(doc.amended_from)]));
        this.$el.find(".ci-head-meta").html(meta.map((m) => `<span>${m}</span>`).join(""));
        this.render_actions();
      }
      render_actions() {
        const doc = this.doc;
        const saved = !doc.__islocal;
        const manager = frappe.user.has_role("Management");
        const can_revert = ["Administrator", "it-admin"].includes(frappe.session.user) || manager;
        const btn = (action, label, cls = "btn-default", icon = "") => `<button type="button" class="btn btn-sm ${cls}" data-action="${action}">${icon ? frappe.utils.icon(icon, "sm") : ""}<span>${label}</span></button>`;
        const item = (action, label) => `<li><a class="dropdown-item" href="#" data-action="${action}">${label}</a></li>`;
        const buttons = [];
        const menu = [];
        if (this.is_editable()) {
          buttons.push(btn("save", __("Save"), saved && !this.dirty ? "btn-default" : "btn-primary", "check"));
          saved && !this.dirty && buttons.push(btn("submit", __("Submit"), "btn-primary"));
        }
        this.can_record_payment() && buttons.push(btn("record-payment", __("Record Payment"), "btn-primary"));
        const can_print = saved || this.is_editable() && (doc.items || []).some((r) => r.item);
        if (can_print) {
          const has_receipt = !cint(doc.credit_sale) || !!doc.allocated_receipt_entry;
          buttons.push(`
					<div class="btn-group">
						<button type="button" class="btn btn-sm btn-default dropdown-toggle" data-toggle="dropdown" aria-expanded="false">
							${frappe.utils.icon("printer", "sm")}<span>${__("Print")}</span>
						</button>
						<ul class="dropdown-menu dropdown-menu-right">
							${item("print-invoice", __("Print Invoice"))}
							${item("preview-invoice", __("Preview Invoice"))}
							${has_receipt ? `<li class="dropdown-divider ci-menu-divider" role="separator"></li>
								${item("print-receipt", __("Print Receipt"))}
								${item("preview-receipt", __("Preview Receipt"))}` : ""}
						</ul>
					</div>`);
        }
        if (saved) {
          doc.docstatus === 1 && menu.push(item("cancel", __("Cancel")));
          doc.docstatus === 2 && menu.push(item("amend", __("Amend")));
          doc.docstatus === 0 && menu.push(item("delete", __("Delete")));
          doc.docstatus === 1 && can_revert && menu.push(item("revert", __("Revert To Draft")));
          if (doc.docstatus === 1 && manager) {
            menu.push(item("gl", __("General Ledgers")), item("stock", __("Stock Ledgers")));
          }
          menu.push(item("reload", __("Reload")), item("form", __("Open in Standard Form")));
        }
        if (menu.length) {
          buttons.push(`
					<div class="btn-group">
						<button type="button" class="btn btn-sm btn-default dropdown-toggle ci-menu" data-toggle="dropdown" aria-expanded="false" aria-label="${__("More actions")}">
							${frappe.utils.icon("dot-horizontal", "sm")}
						</button>
						<ul class="dropdown-menu dropdown-menu-right">${menu.join("")}</ul>
					</div>`);
        }
        this.$el.find(".ci-actions").html(buttons.join(""));
        const shortcuts = [["Alt+N", __("New Invoice")]];
        this.is_editable() && shortcuts.push(["Ctrl+S", __("Save")], ["Alt+P", __("Payment")]);
        can_print && shortcuts.push(["Ctrl+P", __("Print Invoice")]);
        shortcuts.push(["?", __("All Shortcuts")]);
        this.$el.find(".ci-shortcuts-slot").html(E().shortcuts_html(shortcuts));
      }
      refresh_states() {
        const doc = this.doc;
        const editable = this.is_editable();
        const credit = cint(doc.credit_sale);
        const bank = doc.mode === "Bank";
        const cash = !credit && doc.payment_mode_type === "Cash";
        const shown = {
          payment_mode: !credit,
          payment_account: !credit,
          reference_no: bank,
          received_amount: cash,
          reason_for_unfilled_invoice: !doc.invoice_fullfilled
        };
        const cashier = today_only();
        const read_only = {
          edit_posting_date_and_time: cashier,
          posting_date: cashier || !cint(doc.edit_posting_date_and_time),
          posting_time: cashier || !cint(doc.edit_posting_date_and_time),
          customer_company: !this.walk_in,
          tax_id: !this.walk_in,
          naming_series: !doc.__islocal
        };
        const reqd = {
          reference_no: bank,
          received_amount: cash,
          customer_mobile_number: !!this.host.mobile_mandatory
        };
        Object.entries(this.controls).forEach(([fieldname, control]) => {
          const meta_df = frappe.meta.get_docfield(DOCTYPE, fieldname);
          control.df.read_only = !editable || cint(meta_df.read_only) || read_only[fieldname] ? 1 : 0;
          const value = doc[fieldname];
          const empty = control.df.read_only && meta_df.fieldtype !== "Check" && (value === void 0 || value === null || value === "");
          const visible = this.visible(fieldname) && (shown[fieldname] === void 0 || shown[fieldname]) && !empty;
          control.$wrapper.closest(".ci-field").prop("hidden", !visible);
          control.df.reqd = cint(meta_df.reqd) || reqd[fieldname] ? 1 : 0;
        });
        this.refresh_pay_info();
      }
      refresh_pay_info() {
        const doc = this.doc;
        const credit = cint(doc.credit_sale);
        const cash = !credit && doc.payment_mode_type === "Cash";
        const part = (label, value, cls = "") => `<span class="ci-pay-part ${cls}"><span>${label}</span><b>${value}</b></span>`;
        const parts = [];
        if (credit) {
          parts.push(`<span class="ci-pay-mode is-credit">${__("Credit Sale")}</span>`);
          const due = (doc.receipt_schedule || []).map((r) => r.date).filter(Boolean).sort().pop();
          due && parts.push(part(__("Due"), frappe.datetime.str_to_user(due)));
        } else if (doc.payment_mode) {
          parts.push(`<span class="ci-pay-mode">${esc(doc.payment_mode)}</span>`);
          doc.payment_account && parts.push(`<span class="ci-pay-part ci-pay-account">${esc(doc.payment_account)}</span>`);
          if (cash) {
            parts.push(part(__("Received"), money(doc.received_amount)));
            flt(doc.received_amount) && parts.push(part(__("Change"), money(doc.balance_amount), flt(doc.balance_amount) < 0 ? "is-short" : ""));
          }
          if (doc.mode === "Bank") {
            doc.reference_no && parts.push(part(__("Ref"), esc(doc.reference_no)));
          }
        } else {
          parts.push(`<span class="ci-pay-mode is-missing">${__("No payment mode")}</span>`);
        }
        this.$el.find(".ci-pay-info").html(parts.join(""));
      }
      refresh_values() {
        Object.values(this.controls).forEach((control) => {
          control.doc = this.doc;
          if (control.$input && control.$input.is(":focus")) {
            return;
          }
          control.refresh();
        });
      }
      refresh_banners() {
        const doc = this.doc;
        const banners = [];
        const links = linked_to(doc);
        if (links.length) {
          banners.push(["blue", __("This invoice is linked to {0}. Invoices with Sales Order, Quotation, Delivery Note or Project links are edited in the standard form.", [links.map(esc).join(", ")]), "form", __("Open in Standard Form")]);
        }
        if (doc.tab_sales) {
          banners.push(["blue", __("Created from Tab Sales {0}. Change it from the Tab Sale.", [esc(doc.tab_sales)])]);
        }
        if (doc.docstatus === 0 && E().is_placeholder_mobile(doc.customer_mobile_number)) {
          banners.push(["orange", __("Mobile number {0} is a placeholder. Enter the customer's real mobile number before submitting.", [esc(doc.customer_mobile_number)])]);
        }
        if (doc.docstatus === 2) {
          banners.push(["red", __("This invoice is cancelled. Amend it to make a corrected copy."), "amend", __("Amend")]);
        }
        if (today_only() && other_day(doc)) {
          banners.push(["orange", __("This draft is dated {0}. A cashier can save and submit only today's invoices: ask a supervisor to handle it.", [frappe.datetime.str_to_user(doc.posting_date)])]);
        }
        this.$el.find(".ci-banners").html(banners.map(([tone, text, action, label]) => `
				<div class="ci-banner ci-banner-${tone}">
					<span>${text}</span>
					${action ? `<button type="button" class="btn btn-xs btn-default" data-action="${action}">${label}</button>` : ""}
				</div>`).join(""));
      }
      refresh_totals() {
        const doc = this.doc;
        this.$el.find(".ci-total-value").text(money(doc.rounded_total));
        this.$el.find(".ci-total-words").text(doc.in_words && !this.dirty ? doc.in_words : "");
        const line = (label, value, cls = "") => `<div class="ci-sum ${cls}"><span>${label}</span><span>${value}</span></div>`;
        const sums = [line(__("Gross"), money(doc.gross_total))];
        flt(doc.total_discount_in_line_items) && sums.push(line(__("Line Discounts"), "\u2212 " + money(doc.total_discount_in_line_items)));
        flt(doc.additional_discount) && sums.push(line(__("Additional Discount"), "\u2212 " + money(doc.additional_discount)));
        sums.push(line(__("Taxable"), money(doc.taxable_total)));
        sums.push(line(cint(doc.rate_includes_tax) ? __("VAT (included)") : __("VAT"), money(doc.tax_total)));
        flt(doc.round_off) && sums.push(line(__("Round Off"), `${flt(doc.round_off) < 0 ? "\u2212" : "+"} ${money(Math.abs(flt(doc.round_off)))}`));
        this.$el.find(".ci-sums").html(sums.join(""));
        this.refresh_pay_info();
        const balance_text = doc.customer_balance ? __("Balance {0}", [money(doc.customer_balance)]) : "";
        this.$el.find(".ci-balance").text(balance_text).prop("hidden", !balance_text);
        const token = [doc.customer_token && __("Token {0}", [doc.customer_token]), doc.medical_service].filter(Boolean).join(" \xB7 ");
        this.$el.find(".ci-token").text(token).prop("hidden", !token);
      }
      render_rows() {
        const editable = this.is_editable();
        const items = this.doc.items || [];
        const input = (row, f) => editable ? `<input type="text" inputmode="decimal" class="ci-input" data-row="${row.name}" data-f="${f}" aria-label="${esc(frappe.meta.get_label(ITEM_DOCTYPE, f))}">` : `<span data-show="${f}"></span>`;
        this.$el.find(".ci-items tbody").html(items.length ? items.map((row) => `
				<tr data-row="${row.name}">
					<td class="ci-col-item">
						<div class="ci-item-name"></div>
						<div class="ci-sub"><span class="ci-item-code"></span><span class="ci-tax-badge"></span></div>
					</td>
					<td class="ci-num" data-label="${__("Qty")}">${input(row, "qty")}</td>
					<td class="ci-num ci-strong" data-label="${__("Rate")}"><span data-show="rate"></span></td>
					<td class="ci-num" data-label="${__("Service Charges")}">${input(row, "service_charge")}</td>
					<td class="ci-num" data-label="${__("GOV")}">${input(row, "gov")}</td>
					<td class="ci-num" data-label="${__("Typing Charges")}">${input(row, "typing_charges")}</td>
					<td class="ci-num" data-label="${__("Transaction Charges")}">${input(row, "transaction_charges")}</td>
					<td class="ci-num" data-label="${__("VAT")}"><span data-show="tax_amount"></span></td>
					<td class="ci-num ci-strong" data-label="${__("Net")}"><span data-show="net_amount"></span></td>
					<td class="ci-row-actions">
						<button type="button" class="btn btn-xs btn-default ci-row-more" title="${__("Row details")}" aria-label="${__("Row details")}">${frappe.utils.icon("edit", "xs")}</button>
						${editable ? `<button type="button" class="btn btn-xs btn-default ci-row-del" title="${__("Remove")}" aria-label="${__("Remove row")}">${frappe.utils.icon("delete", "xs")}</button>` : ""}
					</td>
				</tr>
				`).join("") : `<tr class="ci-items-empty"><td colspan="10">${editable ? __("No items yet. Search for an item above to add it.") : __("No items.")}</td></tr>`);
        this.row_controls = {};
      }
      refresh_rows() {
        const items = this.doc.items || [];
        this.$el.find(".ci-count").text(items.length ? __("{0} line(s)", [items.length]) : "");
        items.forEach((row) => {
          const $tr = this.$el.find(`tr[data-row="${row.name}"]`);
          if (!$tr.length) {
            return;
          }
          $tr.find(".ci-item-name").text(row.display_name || row.item_name || row.item || "");
          $tr.find(".ci-item-code").text(row.item || "");
          $tr.find(".ci-tax-badge").html(
            cint(row.tax_excluded) || !flt(row.tax_rate) ? `<span class="ci-tag">${__("No VAT")}</span>` : `<span class="ci-tag ci-tag-vat">${__("VAT {0}%", [flt(row.tax_rate)])}</span>`
          );
          $tr.find("input[data-f]").each((_, el) => {
            if (document.activeElement !== el) {
              el.value = num(row[el.dataset.f]);
            }
          });
          $tr.find("[data-show]").each((_, el) => {
            el.textContent = num(row[el.dataset.show]);
          });
          Object.values(this.row_controls[row.name] || {}).forEach((c) => c.refresh());
          this.row_dialog && this.row_dialog.rowname === row.name && Object.values(this.row_dialog.controls).forEach((c) => c.refresh());
        });
      }
      open_row_dialog(rowname) {
        const row = (this.doc.items || []).find((r) => r.name === rowname);
        if (!row) {
          return;
        }
        const d = new frappe.ui.Dialog({
          title: row.display_name || row.item_name || row.item || __("Item"),
          size: "large",
          fields: [{ fieldtype: "HTML", fieldname: "fields" }],
          primary_action_label: __("Done"),
          primary_action: () => d.hide()
        });
        d.$wrapper.addClass("ci-pay-dialog");
        const $wrap = $(`<div class="ci-fields ci-fields-row"></div>`).appendTo(d.fields_dict.fields.$wrapper);
        this.make_row_controls(rowname, $wrap);
        this.row_dialog = { rowname, controls: this.row_controls[rowname] || {} };
        d.onhide = () => {
          this.row_dialog = null;
          delete this.row_controls[rowname];
          this.refresh();
        };
        d.show();
      }
      make_row_controls(rowname, $wrap) {
        const row = (this.doc.items || []).find((r) => r.name === rowname);
        if (!row) {
          return;
        }
        const editable = this.is_editable();
        const controls = {};
        const queries = {
          item: () => ({ filters: { item_type: ["not in", ["Labour"]] } }),
          warehouse: () => ({ filters: { disabled: 0 } })
        };
        ["item", "display_name", "service_charge", "typing_charges", "transaction_charges", "gov", "tax", "tax_excluded"].forEach((fieldname) => {
          const meta_df = frappe.meta.get_docfield(ITEM_DOCTYPE, fieldname);
          const df = Object.assign({}, meta_df, {
            hidden: 0,
            read_only: editable ? cint(meta_df.read_only) : 1,
            depends_on: null,
            mandatory_depends_on: null,
            change: () => this.on_row_change(row, fieldname)
          });
          queries[fieldname] && (df.get_query = queries[fieldname]);
          const $cell = $(`<div class="ci-field${fieldname === "display_name" ? " ci-span-2" : ""}"></div>`).appendTo($wrap);
          const control = frappe.ui.form.make_control({ df, parent: $cell, render_input: true, doc: row });
          control.refresh();
          compact_textarea(control);
          controls[fieldname] = control;
        });
        this.row_controls[rowname] = controls;
      }
      on_row_input(input) {
        const row = (this.doc.items || []).find((r) => r.name === input.dataset.row);
        if (!row) {
          return;
        }
        const f = input.dataset.f;
        row[f] = flt(input.value);
        this.mark_dirty();
        this.recalc();
        input.value = num(row[f]);
      }
      async on_row_change(row, fieldname) {
        this.mark_dirty();
        if (fieldname === "item") {
          if (!row.item) {
            return;
          }
          await this.load_item(row);
        } else if (fieldname === "tax_excluded") {
          if (row.tax_excluded) {
            row.tax = "";
            row.tax_rate = 0;
            this.recalc();
          }
        } else if (fieldname === "tax") {
          if (!row.tax_excluded && row.tax) {
            await E().load_tax_rate(row);
            this.recalc();
          }
        } else if (fieldname === "warehouse") {
          this.stock_item = { item: row.item, warehouse: row.warehouse };
          this.update_stock_hint();
        } else if (["service_charge", "typing_charges", "transaction_charges", "gov"].includes(fieldname)) {
          this.recalc();
        } else if (fieldname === "display_name") {
          this.refresh_rows();
        }
      }
      add_item(item_code) {
        if (!this.doc.customer) {
          frappe.msgprint(__("Select customer."));
          return;
        }
        const row = frappe.model.add_child(this.doc, ITEM_DOCTYPE, "items");
        if (this.doc.default_cost_center) {
          row.cost_center = this.doc.default_cost_center;
        }
        row.warehouse = this.doc.warehouse;
        row.item = item_code;
        this.mark_dirty();
        this.render_rows();
        this.recalc();
        this.load_item(row);
      }
      async load_item(row) {
        const r = await E().load_item(this.doc, row);
        if (!r.found) {
          return;
        }
        r.advance_message && frappe.show_alert(r.advance_message);
        this.stock_item = { item: row.item, warehouse: row.warehouse };
        this.update_stock_hint();
        await this.apply_charges([row]);
      }
      remove_row(rowname) {
        const row = (this.doc.items || []).find((r) => r.name === rowname);
        if (!row) {
          return;
        }
        this.doc.items = this.doc.items.filter((r) => r !== row);
        this.doc.items.forEach((r, i) => r.idx = i + 1);
        frappe.model.remove_from_locals(ITEM_DOCTYPE, rowname);
        this.mark_dirty();
        this.render_rows();
        this.recalc();
      }
      async update_stock_hint() {
        const target = this.stock_item;
        const $hint = this.$el.find(".ci-stock-hint");
        if (!target || !target.item || !target.warehouse) {
          $hint.text("");
          return;
        }
        const r = await frappe.call({
          method: "frappe.client.get_value",
          args: { doctype: "Stock Balance", filters: { item: target.item, warehouse: target.warehouse }, fieldname: ["stock_qty"] }
        });
        if (this.stock_item === target) {
          $hint.text(r.message && r.message.stock_qty !== void 0 ? __("Stock balance: {0} of {1} at {2}", [r.message.stock_qty, target.item, target.warehouse]) : "");
        }
      }
      recalc() {
        E().calculate(this.doc);
        E().fill_receipt_schedule(this.doc);
        E().set_cash_balance(this.doc);
        this.refresh_rows();
        this.refresh_totals();
        this.render_schedule();
        this.refresh_states();
        this.refresh_values();
      }
      async apply_charges(rows) {
        if (this.doc.docstatus !== 0) {
          return;
        }
        const rate_only = await E().apply_item_charges(this.doc, rows);
        E().rate_only_alert(this.doc, rate_only);
        this.recalc();
      }
      mark_dirty() {
        if (!this.dirty) {
          this.dirty = true;
          this.refresh_head();
          this.host.paint(this.tab);
        }
      }
      async on_change(fieldname) {
        this.mark_dirty();
        const doc = this.doc;
        switch (fieldname) {
          case "customer":
            await this.on_customer();
            this.walk_in && this.toggle_customer_details(true);
            break;
          case "payment_mode":
            await this.on_payment_mode();
            break;
          case "credit_sale":
            await this.set_default_payment_mode();
            E().fill_receipt_schedule(doc, true);
            E().set_cash_balance(doc);
            break;
          case "credit_days":
            E().fill_receipt_schedule(doc, true);
            break;
          case "price_list":
            await this.apply_charges();
            break;
          case "received_amount":
            E().set_cash_balance(doc);
            break;
          case "additional_discount":
            this.recalc();
            break;
          case "rate_includes_tax":
            await new Promise((resolve) => {
              frappe.confirm(
                __("Are you sure you want to change this setting which will change the tax calculation in the line items ?"),
                () => {
                  this.recalc();
                  resolve();
                },
                () => {
                  doc.rate_includes_tax = cint(doc.rate_includes_tax) ? 0 : 1;
                  resolve();
                }
              );
            });
            break;
        }
        this.refresh();
        if (fieldname === "customer" && doc.customer && !(doc.items || []).length && this.item_search) {
          this.item_search.$input && this.item_search.$input.trigger("focus");
        }
      }
      async on_customer() {
        const doc = this.doc;
        if (!doc.customer) {
          return;
        }
        const c = await read_values(
          "Customer",
          doc.customer,
          [
            "customer_name",
            "full_address",
            "salesman",
            "credit_days",
            "address_line_1",
            "address_line_2",
            "area_name",
            "country",
            "default_price_list",
            "mobile_no"
          ]
        );
        Object.assign(doc, {
          customer_name: c.customer_name,
          customer_address: c.full_address,
          salesman: c.salesman,
          credit_days: c.credit_days,
          address_line_1: c.address_line_1,
          address_line_2: c.address_line_2,
          area_name: c.area_name,
          country: c.country
        });
        if (!doc.customer_token) {
          doc.customer_display_name = doc.customer_name;
          doc.customer_mobile_number = c.mobile_no || "";
        }
        const [details, balance, terms] = await Promise.all([
          E().customer_billing_details(doc.customer),
          E().party_balance(doc.customer),
          E().customer_terms(doc.customer)
        ]);
        this.walk_in = !!details.is_walk_in;
        doc.customer_company = details.customer_company || "";
        doc.tax_id = details.tax_id || "";
        doc.customer_balance = balance;
        terms.template_name && (doc.terms = terms.template_name);
        terms.terms && (doc.terms_and_conditions = terms.terms);
        await this.set_default_payment_mode();
        const price_list = c.default_price_list || "";
        if (price_list !== (doc.price_list || "")) {
          doc.price_list = price_list;
          await this.apply_charges();
        }
        E().fill_receipt_schedule(doc);
      }
      async on_payment_mode() {
        const doc = this.doc;
        const pm = doc.payment_mode ? await read_values("Payment Mode", doc.payment_mode, ["mode", "account"]) : {};
        doc.mode = pm.mode || "";
        doc.payment_mode_type = pm.mode || "";
        doc.payment_account = pm.account || "";
        if (doc.payment_mode === "Cash" || doc.payment_mode === "Card") {
          await this.apply_charges();
        }
        E().set_cash_balance(doc);
      }
      async set_default_payment_mode() {
        const doc = this.doc;
        if (doc.docstatus !== 0) {
          return;
        }
        if (cint(doc.credit_sale) === 0) {
          const d = await E().payment_defaults(doc);
          if (d.payment_mode) {
            if (d.payment_mode !== doc.payment_mode || !doc.payment_mode_type) {
              doc.payment_mode = d.payment_mode;
              await this.on_payment_mode();
            }
          } else {
            frappe.msgprint(__("Default payment mode for sales not found."));
          }
        } else if (doc.payment_mode) {
          doc.payment_mode = "";
          await this.on_payment_mode();
        }
      }
      bind_schedule($root) {
        $root.on("change", ".ci-schedule input[data-f]", (e) => {
          const input = e.currentTarget;
          const row = (this.doc.receipt_schedule || []).find((r) => r.name === input.dataset.row);
          if (!row) {
            return;
          }
          row[input.dataset.f] = input.dataset.f === "amount" ? flt(input.value) : input.value;
          this.mark_dirty();
        });
        $root.on("click", ".ci-schedule-add", () => {
          const row = frappe.model.add_child(this.doc, "Receipt Schedule", "receipt_schedule");
          row.date = this.doc.posting_date;
          row.payment_mode = "Cash";
          row.amount = 0;
          this.mark_dirty();
          this.render_schedule();
        });
        $root.on("click", ".ci-schedule-del", (e) => {
          const name = $(e.currentTarget).attr("data-row");
          this.doc.receipt_schedule = (this.doc.receipt_schedule || []).filter((r) => r.name !== name);
          this.doc.receipt_schedule.forEach((r, i) => r.idx = i + 1);
          this.mark_dirty();
          this.render_schedule();
        });
      }
      render_schedule() {
        const doc = this.doc;
        const $wrap = this.$schedule;
        if (!$wrap) {
          return;
        }
        const show = cint(doc.credit_sale) && this.visible("receipt_schedule");
        $wrap.prop("hidden", !show);
        if (!show) {
          return;
        }
        const editable = this.is_editable();
        const rows = doc.receipt_schedule || [];
        const focused = document.activeElement && $.contains($wrap[0], document.activeElement);
        if (focused) {
          return;
        }
        $wrap.html(`
				<div class="ci-schedule-head">
					<span>${__("Receipt Schedule")}</span>
					${editable ? `<button type="button" class="btn btn-xs btn-default ci-schedule-add">${__("Add")}</button>` : ""}
				</div>
				<table class="ci-table ci-schedule-table">
					<thead><tr><th>${__("Due")}</th><th>${__("Mode")}</th><th class="ci-num">${__("Amount")}</th><th></th></tr></thead>
					<tbody>${rows.map((r) => `
						<tr>
							<td>${editable ? `<input type="date" class="ci-input" data-row="${r.name}" data-f="date" value="${esc(r.date || "")}">` : frappe.datetime.str_to_user(r.date)}</td>
							<td>${editable ? `<input type="text" class="ci-input" data-row="${r.name}" data-f="payment_mode" value="${esc(r.payment_mode || "")}">` : esc(r.payment_mode)}</td>
							<td class="ci-num">${editable ? `<input type="text" inputmode="decimal" class="ci-input" data-row="${r.name}" data-f="amount" value="${num(r.amount)}">` : money(r.amount)}</td>
							<td>${editable ? `<button type="button" class="btn btn-xs btn-default ci-schedule-del" data-row="${r.name}" aria-label="${__("Remove")}">${frappe.utils.icon("delete", "xs")}</button>` : ""}</td>
						</tr>`).join("")}
					</tbody>
				</table>`);
      }
      action(name) {
        const doc = this.doc;
        const handlers = {
          save: () => this.save("Save"),
          submit: () => this.save("Submit"),
          cancel: () => this.cancel(),
          amend: () => this.amend(),
          delete: () => this.delete(),
          revert: () => this.revert_to_draft(),
          reload: () => this.dirty ? frappe.confirm(__("Discard your unsaved changes and reload?"), () => this.reload()) : this.reload(),
          form: () => frappe.set_route("Form", DOCTYPE, doc.name),
          gl: () => E().show_gl_postings(DOCTYPE, doc.name),
          stock: () => E().show_stock_ledgers(DOCTYPE, doc.name),
          "preview-invoice": () => this.preview_pdf("invoice"),
          "print-invoice": () => this.print_direct("invoice"),
          "preview-receipt": () => this.preview_pdf("receipt"),
          "print-receipt": () => this.print_direct("receipt"),
          "record-payment": () => this.record_payment()
        };
        handlers[name] && handlers[name]();
      }
      can_record_payment() {
        const doc = this.doc;
        return doc.docstatus === 1 && !this.dirty && !!cint(doc.credit_sale) && !cint(doc.for_advance_payment) && flt(doc.paid_amount, 2) < flt(doc.rounded_total, 2);
      }
      async record_payment() {
        const receipt = await digitz_erp.record_quick_payment(this.doc.name);
        if (receipt) {
          await this.reload();
          this.host.list.loaded = false;
        }
      }
      check(action) {
        const doc = this.doc;
        if (doc.tab_sales) {
          frappe.msgprint(__("Cannot change Sales Invoice created from a Tab Sales. Do it from the correspodning Tab Sale"));
          return false;
        }
        if (!cint(doc.credit_sale) && !doc.payment_account) {
          frappe.msgprint(__("Select payment account"));
        }
        if (!cint(doc.credit_sale) && !doc.payment_mode) {
          frappe.msgprint(__("Select payment mode"));
        }
        const missing = [];
        let first_payment_field = null;
        const need = (fieldname, ok) => {
          if (!ok) {
            missing.push(frappe.meta.get_label(DOCTYPE, fieldname));
            PAYMENT_FIELDS.includes(fieldname) && (first_payment_field || (first_payment_field = fieldname));
          }
        };
        need("customer", doc.customer);
        need("items", (doc.items || []).length);
        if (!cint(doc.credit_sale) && doc.payment_mode_type === "Cash") {
          need("received_amount", flt(doc.received_amount));
        }
        if (doc.mode === "Bank") {
          need("reference_no", doc.reference_no);
        }
        if (this.host.mobile_mandatory) {
          need("customer_mobile_number", doc.customer_mobile_number);
        }
        if (missing.length) {
          frappe.msgprint({
            title: __("Missing Fields"),
            message: __("Fill these before saving: {0}", [missing.map((m) => `<b>${esc(m)}</b>`).join(", ")]),
            indicator: "orange"
          });
          first_payment_field && this.focus_field(first_payment_field);
          return false;
        }
        const cash_error = E().cash_received_error(doc);
        if (cash_error) {
          frappe.msgprint(__spreadProps(__spreadValues({}, cash_error), { indicator: "red" }));
          this.focus_field("received_amount");
          return false;
        }
        if (action === "Submit" && this.host.mobile_mandatory && E().is_placeholder_mobile(doc.customer_mobile_number)) {
          frappe.msgprint({
            title: __("Mobile Number Needed"),
            message: __("{0} is a placeholder. Enter the customer's real mobile number before submitting.", [esc(doc.customer_mobile_number)]),
            indicator: "red"
          });
          this.focus_field("customer_mobile_number");
          return false;
        }
        return true;
      }
      focus_field(fieldname) {
        const control = this.controls[fieldname];
        if (control) {
          control.$input && control.$input.trigger("focus");
        } else if (PAYMENT_FIELDS.includes(fieldname)) {
          this.open_payment_dialog(fieldname);
        }
      }
      async save(action) {
        if (this.saving || !this.is_editable()) {
          return;
        }
        const doc = this.doc;
        await this.host.get_mobile_mandatory();
        doc.items = (doc.items || []).filter((r) => r.item);
        doc.items.forEach((r, i) => r.idx = i + 1);
        if (doc.__islocal) {
          delete doc.delivery_notes;
        }
        if (!this.check(action)) {
          this.render_rows();
          this.refresh();
          return;
        }
        const run = async () => {
          this.saving = true;
          const old_key = this.tab.key;
          const old_name = doc.name;
          try {
            const r = await frappe.call({
              method: "frappe.desk.form.save.savedocs",
              args: { doc, action },
              freeze: true,
              freeze_message: action === "Submit" ? __("Submitting...") : __("Saving...")
            });
            const saved = r.docs && r.docs[0];
            if (!saved) {
              return;
            }
            if (saved.name !== old_name) {
              frappe.model.remove_from_locals(DOCTYPE, old_name);
            }
            this.doc = frappe.get_doc(DOCTYPE, saved.name) || saved;
            this.dirty = false;
            this.render();
            old_key !== this.doc.name && this.host.renamed(this.tab, old_key);
            this.host.paint(this.tab);
            this.host.list.loaded = false;
            frappe.show_alert({ message: action === "Submit" ? __("Submitted {0}", [this.doc.name]) : __("Saved {0}", [this.doc.name]), indicator: "green" });
          } catch (e) {
          } finally {
            this.saving = false;
          }
        };
        if (action === "Submit") {
          frappe.confirm(__("Permanently Submit {0}?", [esc(doc.name)]), run);
        } else {
          await run();
        }
      }
      cancel() {
        frappe.confirm(__("Permanently Cancel {0}?", [esc(this.doc.name)]), async () => {
          await frappe.call({
            method: "frappe.desk.form.save.cancel",
            args: { doctype: DOCTYPE, name: this.doc.name },
            freeze: true,
            freeze_message: __("Cancelling...")
          });
          this.host.list.loaded = false;
          await this.reload();
        });
      }
      async amend() {
        const is_amended = await frappe.xcall("frappe.client.is_document_amended", { doctype: DOCTYPE, docname: this.doc.name });
        if (is_amended) {
          frappe.throw(__("This document is already amended, you cannot ammend it again"));
        }
        const newdoc = frappe.model.copy_doc(this.doc, true);
        newdoc.idx = null;
        newdoc.__run_link_triggers = false;
        newdoc.amended_from = this.doc.name;
        const tab = await this.host.add_new(newdoc);
        this.host.go(tab.key);
      }
      delete() {
        frappe.model.delete_doc(DOCTYPE, this.doc.name, () => {
          this.host.list.loaded = false;
          this.dirty = false;
          this.host.close(this.tab.key);
        });
      }
      revert_to_draft() {
        frappe.confirm(__("This will delete GL Posting rows for this voucher and reset the document to Draft. Do you want to continue?"), () => {
          frappe.call({
            method: "digitz_erp.api.gl_posting_api.reset_gl_for_voucher",
            args: { voucher_doctype: DOCTYPE, voucher_name: this.doc.name },
            freeze: true,
            freeze_message: __("Reverting to Draft..."),
            callback: (r) => {
              if (!r.exc) {
                frappe.msgprint({ title: __("Success"), message: r.message || __("Document succesfully reverted to draft."), indicator: "green" });
                this.reload();
              }
            }
          });
        });
      }
      open_payment_dialog(focus) {
        if (!this.is_editable()) {
          return;
        }
        const doc = this.doc;
        const FIELDS = PAYMENT_FIELDS;
        let syncing = false;
        const fields = [{ fieldtype: "HTML", fieldname: "summary" }];
        FIELDS.forEach((fieldname, i) => {
          const meta_df = frappe.meta.get_docfield(DOCTYPE, fieldname);
          if (!meta_df) {
            return;
          }
          i === 3 && fields.push({ fieldtype: "Column Break" });
          fields.push(Object.assign({}, meta_df, {
            hidden: 0,
            depends_on: null,
            mandatory_depends_on: null,
            read_only_depends_on: null,
            get_query: this.query_for(fieldname),
            change: () => {
              var _a3;
              if (syncing) {
                return;
              }
              const value = d.get_value(fieldname);
              if (((_a3 = doc[fieldname]) != null ? _a3 : "") === (value != null ? value : "") || meta_df.fieldtype === "Check" && cint(doc[fieldname]) === cint(value)) {
                return;
              }
              doc[fieldname] = value;
              this.on_change(fieldname).then(() => sync());
            }
          }));
        });
        fields.push({ fieldtype: "Section Break", fieldname: "schedule_section" }, { fieldtype: "HTML", fieldname: "schedule" });
        const d = new frappe.ui.Dialog({
          title: __("Payment"),
          size: "large",
          fields,
          primary_action_label: __("Done"),
          primary_action: () => d.hide()
        });
        d.$wrapper.addClass("ci-pay-dialog");
        this.$schedule = d.fields_dict.schedule.$wrapper.addClass("ci-schedule");
        this.bind_schedule(this.$schedule);
        d.onhide = () => {
          this.$schedule = null;
          this.refresh();
        };
        const sync = () => {
          syncing = true;
          const credit = cint(doc.credit_sale);
          const bank = doc.mode === "Bank";
          const cash = !credit && doc.payment_mode_type === "Cash";
          const shown = {
            payment_mode: !credit,
            payment_account: !credit,
            reference_no: bank,
            received_amount: cash
          };
          const reqd = { reference_no: bank, received_amount: cash };
          FIELDS.forEach((fieldname) => {
            var _a3, _b;
            const field = d.fields_dict[fieldname];
            if (!field) {
              return;
            }
            const visible = this.visible(fieldname) && (shown[fieldname] === void 0 || shown[fieldname]);
            d.set_df_property(fieldname, "hidden", visible ? 0 : 1);
            d.set_df_property(fieldname, "reqd", reqd[fieldname] ? 1 : 0);
            if (((_a3 = field.get_value()) != null ? _a3 : "") !== ((_b = doc[fieldname]) != null ? _b : "")) {
              field.set_value(doc[fieldname]);
            }
          });
          const balance = flt(doc.balance_amount);
          d.fields_dict.summary.$wrapper.html(`
					<div class="ci-pay-summary">
						<div><span>${__("Total")}</span><strong>${money(doc.rounded_total || doc.grand_total)}</strong></div>
						${cash ? `<div class="${balance < 0 ? "is-short" : ""}"><span>${__("Change to return")}</span><strong>${money(balance)}</strong></div>` : ""}
					</div>`);
          d.set_df_property("schedule_section", "hidden", credit ? 0 : 1);
          this.render_schedule();
          setTimeout(() => syncing = false, 0);
        };
        d.show();
        sync();
        setTimeout(() => {
          const target = focus || (doc.payment_mode_type === "Cash" && !cint(doc.credit_sale) ? "received_amount" : "payment_mode");
          d.fields_dict[target] && d.fields_dict[target].$input && d.fields_dict[target].$input.trigger("focus");
        }, 300);
      }
      can_change_print_flags() {
        return this.doc.docstatus === 0 ? this.is_editable() : this.doc.docstatus === 1;
      }
      async set_print_flag(fieldname, value) {
        const doc = this.doc;
        if (!this.can_change_print_flags() || cint(doc[fieldname]) === value) {
          return;
        }
        if (doc.docstatus === 0) {
          doc[fieldname] = value;
          this.mark_dirty();
          return;
        }
        try {
          await frappe.call({
            method: "frappe.client.set_value",
            args: { doctype: DOCTYPE, name: doc.name, fieldname, value },
            freeze: true,
            freeze_message: __("Updating the printout...")
          });
          await frappe.call({
            method: "digitz_erp.selling.doctype.sales_invoice.sales_invoice.print_sales_invoice_pdf",
            args: { docname: doc.name },
            freeze: true,
            freeze_message: __("Generating PDF...")
          });
          await this.reload();
          frappe.show_alert({ message: __("Printout updated"), indicator: "green" });
        } finally {
          this.host.active_editor() === this && this.host.paint_files();
        }
      }
      async generate_pdfs(kind = "invoice", fresh = false) {
        try {
          fresh || await frappe.call({
            method: "digitz_erp.selling.doctype.sales_invoice.sales_invoice.print_sales_invoice_pdf",
            args: { docname: this.doc.name },
            freeze: true,
            freeze_message: __("Generating PDF...")
          });
          await this.reload();
          await this.load_files();
        } catch (e) {
          return -1;
        }
        if (!(this.pdfs || []).length) {
          frappe.msgprint(__("The PDF was not found. Try again."));
          return -1;
        }
        const index = this.pdfs.findIndex((f) => /receipt/i.test(f.file_name) === (kind === "receipt"));
        if (kind === "receipt" && index < 0) {
          frappe.msgprint(__("This invoice has no receipt yet."));
        }
        return kind === "receipt" ? index : Math.max(0, index);
      }
      async save_for_print() {
        if (!this.is_editable() || !this.dirty && !this.doc.__islocal) {
          return false;
        }
        await this.save("Save");
        return this.dirty || this.doc.__islocal ? null : true;
      }
      async preview_pdf(kind = "invoice") {
        const fresh = await this.save_for_print();
        if (fresh === null) {
          return;
        }
        const index = await this.generate_pdfs(kind, fresh);
        index >= 0 && this.show_pdf(index);
      }
      async print_direct(kind = "invoice") {
        const fresh = await this.save_for_print();
        if (fresh === null) {
          return;
        }
        const index = await this.generate_pdfs(kind, fresh);
        if (index < 0) {
          return;
        }
        const pdf = this.pdfs[index];
        E().print_pdf(pdf.file_url, pdf.label, () => this.show_pdf(index));
      }
      show_pdf(index = 0) {
        const pdfs = this.pdfs || [];
        let current = pdfs[index] ? index : 0;
        if (!pdfs.length) {
          return;
        }
        const url = (f) => `${encodeURI(f.file_url)}?v=${Date.now()}`;
        const d = new frappe.ui.Dialog({
          title: this.doc.name,
          size: "extra-large",
          fields: [{ fieldtype: "HTML", fieldname: "viewer" }],
          primary_action_label: __("Print"),
          primary_action: () => {
            const frame = d.$wrapper.find(".ci-pdf-frame")[0];
            try {
              frame.contentWindow.focus();
              frame.contentWindow.print();
            } catch (e) {
              window.open(url(pdfs[current]), "_blank");
            }
          },
          secondary_action_label: __("Open in New Tab"),
          secondary_action: () => window.open(url(pdfs[current]), "_blank")
        });
        const $viewer = d.fields_dict.viewer.$wrapper;
        const paint = () => {
          $viewer.html(`
					${pdfs.length > 1 ? `
						<div class="ci-pdf-switch" role="tablist">
							${pdfs.map((f, i) => `<button type="button" class="btn btn-sm ${i === current ? "btn-primary" : "btn-default"}" data-pdf="${i}">${f.label}</button>`).join("")}
						</div>` : ""}
					<iframe class="ci-pdf-frame" src="${url(pdfs[current])}#navpanes=0&view=FitH" title="${esc(pdfs[current].label)}"></iframe>`);
        };
        $viewer.on("click", "[data-pdf]", (e) => {
          current = cint(e.currentTarget.dataset.pdf);
          paint();
        });
        paint();
        d.show();
      }
      async load_files() {
        this.pdfs = [];
        if (!this.doc.__islocal) {
          const files = await frappe.db.get_list("File", {
            filters: { attached_to_doctype: DOCTYPE, attached_to_name: this.doc.name },
            fields: ["file_name", "file_url"],
            order_by: "creation desc",
            limit: 10
          });
          const latest = {};
          (files || []).filter((f) => /\.pdf$/i.test(f.file_name || "")).forEach((f) => {
            var _a3;
            const receipt = /receipt/i.test(f.file_name);
            latest[_a3 = receipt ? "receipt" : "invoice"] || (latest[_a3] = __spreadProps(__spreadValues({}, f), { label: receipt ? __("Receipt PDF") : __("Invoice PDF") }));
          });
          this.pdfs = [latest.invoice, latest.receipt].filter(Boolean);
        }
        this.host.active_editor() === this && this.host.paint_files();
      }
    };
  })();

  // ../digitz_erp/digitz_erp/public/js/cashier_board.js
  frappe.provide("digitz_erp");
  var _a;
  digitz_erp.CashierBoard = (_a = class {
    constructor($parent, opts = {}) {
      this.on_count = opts.on_count;
      this.running = false;
      this.fetching = false;
      this.search = "";
      this.search_later = frappe.utils.debounce(() => this.refresh(), 300);
      this.realtime_handler = () => this.refresh();
      this.make($parent);
      this.bind_events();
    }
    make($parent) {
      this.$el = $(`
			<div class="ci-list cb-board">
				<div class="ci-list-bar">
					<div class="ci-search">
						${frappe.utils.icon("search", "sm")}
						<input type="search" class="form-control" placeholder="${__("Search invoice no, customer, company or token")}" aria-label="${__("Search the board")}">
					</div>
					<button type="button" class="btn btn-primary btn-sm cb-sync">
						${frappe.utils.icon("refresh", "sm")} ${__("Sync Now")}
					</button>
					<button type="button" class="btn btn-default btn-sm cb-reload">${__("Reload")}</button>
					<span class="ci-list-count text-muted cb-status"></span>
				</div>
				<div class="ci-list-table"></div>
			</div>
		`).appendTo($parent);
      this.$parent = $parent;
      this.$table = this.$el.find(".ci-list-table");
      this.$status = this.$el.find(".cb-status");
    }
    bind_events() {
      this.$el.on("click", ".cb-sync", () => this.sync_now());
      this.$el.on("click", ".cb-reload", () => this.refresh());
      this.$el.on("input", ".ci-search input", (e) => {
        this.search = e.currentTarget.value.trim();
        this.search_later();
      });
      const open = (e) => {
        e.stopPropagation();
        this.open_invoice($(e.currentTarget).closest("tr").attr("data-name"));
      };
      this.$el.on("click", ".cb-open, tr[data-name]", open);
      this.$el.on("keydown", "tr[data-name]", (e) => e.key === "Enter" && open(e));
    }
    open_invoice(name) {
      name && frappe.set_route("cashier-console", "invoices", name);
    }
    start() {
      if (this.running) {
        return;
      }
      this.running = true;
      frappe.realtime.on(digitz_erp.token_notifications.EVENT, this.realtime_handler);
      this.refresh();
      this.fallback_timer = setInterval(() => this.refresh(), digitz_erp.CashierBoard.FALLBACK_INTERVAL_MS);
    }
    stop() {
      if (!this.running) {
        return;
      }
      this.running = false;
      frappe.realtime.off(digitz_erp.token_notifications.EVENT, this.realtime_handler);
      if (this.fallback_timer) {
        clearInterval(this.fallback_timer);
        this.fallback_timer = null;
      }
    }
    refresh() {
      if (this.fetching) {
        this.pending = true;
        return;
      }
      this.fetching = true;
      this.$parent.addClass("is-loading");
      frappe.call({
        method: "digitz_erp.api.token_sync.get_board_invoices",
        args: { limit: digitz_erp.CashierBoard.LIMIT, search: this.search },
        callback: (r) => {
          const invoices = r.message || [];
          this.render(invoices);
          this.search || this.on_count && this.on_count(invoices.length);
          this.set_status(this.search ? __("{0} matching today \xB7 Updated {1}", [invoices.length, frappe.datetime.now_time()]) : __("{0} pending today \xB7 Updated {1}", [invoices.length, frappe.datetime.now_time()]));
        },
        error: () => {
          this.set_status(__("Could not refresh. Retrying shortly."));
        },
        always: () => {
          this.fetching = false;
          this.$parent.removeClass("is-loading");
          if (this.pending) {
            this.pending = false;
            this.refresh();
          }
        }
      });
    }
    sync_now() {
      digitz_erp.token_notifications.run_sync_now(() => this.refresh());
    }
    set_status(text) {
      this.$status.text(text);
    }
    render(invoices) {
      if (!invoices.length) {
        this.$table.html(`<div class="ci-empty-list"><p>${this.search ? __("No invoice today matches your search.") : __("No pending invoices today.")}</p></div>`);
        return;
      }
      const esc = (v) => frappe.utils.escape_html(v == null ? "" : String(v));
      this.$table.html(`
			<div class="ci-scroll">
				<table class="ci-table ci-table-list">
					<thead><tr>
						<th>${__("ID")}</th>
						<th>${__("Customer Name")}</th>
						<th>${__("Service")}</th>
						<th>${__("Date")}</th>
						<th>${__("Token")}</th>
						<th class="ci-num">${__("Amount")}</th>
						<th>${__("Action")}</th>
					</tr></thead>
					<tbody>${invoices.map((invoice) => `
						<tr data-name="${esc(invoice.name)}" tabindex="0">
							<td class="ci-strong ci-nowrap">${esc(invoice.name)}</td>
							<td><div class="ci-ellipsis">${esc(invoice.customer_display_name || invoice.customer)}</div>
								${invoice.customer_company && invoice.customer_company !== invoice.customer ? `<div class="ci-sub ci-ellipsis">${esc(invoice.customer_company)}</div>` : ""}</td>
							<td><div class="ci-ellipsis">${esc(invoice.medical_service)}</div></td>
							<td class="ci-nowrap">${frappe.datetime.str_to_user(invoice.posting_date)}</td>
							<td class="ci-nowrap">${esc(invoice.customer_token)}</td>
							<td class="ci-num ci-strong">${format_currency(invoice.rounded_total)}</td>
							<td><button type="button" class="btn btn-xs btn-primary cb-open">${__("Open Invoice")}</button></td>
						</tr>`).join("")}
					</tbody>
				</table>
			</div>`);
    }
  }, __publicField(_a, "FALLBACK_INTERVAL_MS", 6e4), __publicField(_a, "LIMIT", 100), _a);

  // ../digitz_erp/digitz_erp/public/js/cashier_receipts.js
  frappe.provide("digitz_erp");
  (function() {
    var _a2;
    const DOCTYPE = "Receipt Entry";
    const DETAIL_DOCTYPE = "Receipt Entry Detail";
    const ALLOCATION_DOCTYPE = "Receipt Allocation";
    const ROUTE = ["cashier-console", "receipts"];
    const API = "digitz_erp.api.receipt_entry_api";
    const esc = (v) => frappe.utils.escape_html(v == null ? "" : String(v));
    const money = (v) => format_currency(flt(v), frappe.boot.sysdefaults.currency);
    const round2 = (v) => flt(v, 2);
    const storage_key = () => `digitz_cashier_receipts:${frappe.session.user}`;
    function fits_console(doc) {
      const details = doc.receipt_entry_details || [];
      if (doc.__islocal && !details.length) {
        return true;
      }
      return details.length === 1 && details[0].receipt_type === "Customer" && details[0].reference_type === "Sales Invoice" && !!details[0].customer && (doc.receipt_allocation || []).every((a) => a.reference_type === "Sales Invoice" && a.customer === details[0].customer);
    }
    digitz_erp.record_quick_payment = async function(sales_invoice) {
      const info = await frappe.xcall(`${API}.get_quick_receipt_info`, { sales_invoice });
      if (flt(info.balance_amount) <= 0) {
        frappe.msgprint({
          title: __("Nothing to pay"),
          indicator: "orange",
          message: flt(info.held_by_drafts) > 0 ? __("Draft receipts hold the rest of {0} ({1}). Submit or delete them in the Receipts tab first.", [esc(sales_invoice), money(info.held_by_drafts)]) : __("{0} is fully paid.", [esc(sales_invoice)])
        });
        return null;
      }
      return new Promise((resolve) => {
        let mode = null;
        let done = false;
        const set_mode = async (payment_mode) => {
          mode = null;
          if (payment_mode) {
            const r = await frappe.db.get_value("Payment Mode", payment_mode, "mode");
            mode = (r.message || {}).mode || null;
          }
          const bank = mode === "Bank";
          d.set_df_property("reference_no", "hidden", bank ? 0 : 1);
          d.set_df_property("reference_no", "reqd", bank ? 1 : 0);
          d.set_df_property("reference_date", "hidden", bank ? 0 : 1);
          bank && !d.get_value("reference_date") && d.set_value("reference_date", frappe.datetime.get_today());
        };
        const sums = [
          [__("Invoice Total"), money(info.invoice_amount)],
          [__("Paid"), money(info.paid_amount)]
        ];
        flt(info.held_by_drafts) > 0 && sums.push([__("Held by draft receipts"), money(info.held_by_drafts)]);
        sums.push([__("Balance"), money(info.balance_amount)]);
        const d = new frappe.ui.Dialog({
          title: __("Record Payment \xB7 {0}", [sales_invoice]),
          fields: [
            {
              fieldtype: "HTML",
              fieldname: "summary",
              options: `
							<div class="ci-pay-summary cr-quick-summary">
								<div class="cr-quick-customer">${esc(info.customer_display_name || info.customer)}</div>
								${sums.map(([l, v]) => `<div><span>${l}</span><strong>${v}</strong></div>`).join("")}
							</div>`
            },
            {
              fieldtype: "Link",
              fieldname: "payment_mode",
              label: __("Payment Mode"),
              options: "Payment Mode",
              reqd: 1,
              default: info.payment_mode,
              change: () => set_mode(d.get_value("payment_mode"))
            },
            {
              fieldtype: "Currency",
              fieldname: "amount",
              label: __("Amount Received"),
              reqd: 1,
              default: info.balance_amount,
              description: __("The full balance, or less for a part payment.")
            },
            { fieldtype: "Column Break" },
            { fieldtype: "Data", fieldname: "reference_no", label: __("Reference No"), hidden: 1 },
            { fieldtype: "Date", fieldname: "reference_date", label: __("Reference Date"), hidden: 1 },
            { fieldtype: "Small Text", fieldname: "remarks", label: __("Remarks") }
          ],
          primary_action_label: __("Record & Submit"),
          primary_action: async (values) => {
            const amount = round2(values.amount);
            if (amount <= 0) {
              frappe.msgprint(__("Enter the amount received."));
              return;
            }
            if (amount > round2(info.balance_amount)) {
              frappe.msgprint(__("At most {0} is left to pay on {1}.", [money(info.balance_amount), esc(sales_invoice)]));
              return;
            }
            if (mode === "Bank" && !values.reference_no) {
              frappe.msgprint(__("Reference No is required for a bank payment."));
              return;
            }
            d.get_primary_btn().prop("disabled", true);
            try {
              const receipt = await frappe.xcall(`${API}.create_quick_receipt`, {
                sales_invoice,
                amount,
                payment_mode: values.payment_mode,
                reference_no: mode === "Bank" ? values.reference_no : null,
                reference_date: mode === "Bank" ? values.reference_date : null,
                remarks: values.remarks || null
              }, { freeze: true, freeze_message: __("Recording the payment...") });
              done = true;
              d.hide();
              $(document).trigger("digitz:receipt-saved", [receipt]);
              frappe.show_alert({ message: __("Payment of {0} recorded in {1}", [money(amount), receipt]), indicator: "green" }, 7);
              resolve(receipt);
            } catch (e) {
              d.get_primary_btn().prop("disabled", false);
            }
          }
        });
        d.onhide = () => !done && resolve(null);
        d.show();
        set_mode(info.payment_mode);
        setTimeout(() => {
          const $amount = d.fields_dict.amount.$input;
          $amount && $amount.trigger("focus").trigger("select");
        }, 300);
      });
    };
    digitz_erp.CashierReceipts = class CashierReceipts {
      constructor(page, parent) {
        this.page = page;
        this.tabs = [];
        this.active = "list";
        this.new_count = 0;
        this.defaults = null;
        this.$el = $(`
				<div class="ci cr">
					<div class="ci-strip" role="tablist" aria-label="${__("Open receipts")}">
						<button type="button" class="ci-stab ci-stab-list active" data-key="list" role="tab">
							${frappe.utils.icon("list", "sm")}<span>${__("All Receipts")}</span>
						</button>
						<div class="ci-stab-docs"></div>
						<button type="button" class="ci-new cr-new" title="${__("New Receipt")}">
							${frappe.utils.icon("add", "sm")}<span>${__("New Receipt")}</span>
						</button>
					</div>
					<div class="ci-views">
						<div class="ci-view" data-key="list"></div>
					</div>
				</div>
			`).appendTo(parent);
        this.$docs = this.$el.find(".ci-stab-docs");
        this.list = new digitz_erp.ReceiptList(this, this.$el.find('.ci-view[data-key="list"]'));
        this.bind();
        this.restore();
      }
      bind() {
        this.$el.on("click", ".ci-stab", (e) => {
          if ($(e.target).closest(".ci-stab-close").length) {
            return;
          }
          this.go($(e.currentTarget).attr("data-key"));
        });
        this.$el.on("click", ".ci-stab-close", (e) => {
          e.stopPropagation();
          this.close($(e.currentTarget).closest(".ci-stab").attr("data-key"));
        });
        this.$el.on("click", ".cr-new", () => this.new_receipt());
        $(document).on("digitz:receipt-saved", () => this.list.loaded = false);
        $(window).on("beforeunload", () => {
          if (this.tabs.some((t) => t.editor && t.editor.dirty)) {
            return true;
          }
        });
      }
      active_editor() {
        const tab = this.tabs.find((t) => t.key === this.active);
        return tab && tab.editor;
      }
      async get_defaults() {
        if (!this.defaults) {
          const [defaults, cash_mode] = await Promise.all([
            frappe.xcall(`${API}.get_console_receipt_defaults`),
            frappe.db.get_value("Payment Mode", { mode: "Cash" }, "name").then((r) => (r.message || {}).name)
          ]);
          this.defaults = Object.assign({ payment_mode: cash_mode }, defaults);
        }
        return this.defaults;
      }
      go(key) {
        key && key !== "list" ? frappe.set_route(...ROUTE, key) : frappe.set_route(...ROUTE);
      }
      new_receipt() {
        frappe.set_route(...ROUTE, "new");
      }
      open_receipt(name) {
        this.go(name);
      }
      replace_route(key) {
        frappe.route_flags.replace_route = true;
        this.go(key);
      }
      async route(sub) {
        const key = sub && sub[0] ? decodeURIComponent(sub[0]) : "list";
        await frappe.model.with_doctype(DOCTYPE);
        if (key === "list") {
          this.show("list");
          return;
        }
        if (key === "new") {
          const tab2 = await this.add_new();
          tab2 && this.replace_route(tab2.key);
          return;
        }
        let tab = this.tabs.find((t) => t.key === key);
        if (!tab) {
          if (key.startsWith("new-receipt-entry")) {
            this.replace_route("new");
            return;
          }
          tab = this.add_tab(key);
        }
        this.show(key);
        if (!tab.editor && !tab.loading) {
          await this.load(tab);
        }
      }
      refresh() {
        if (this.active === "list") {
          this.list.load(true);
        } else {
          const editor = this.active_editor();
          editor && !editor.dirty && !editor.doc.__islocal && editor.reload();
        }
      }
      add_tab(key, label) {
        const tab = { key, label: label || key };
        tab.$tab = $(`
				<button type="button" class="ci-stab ci-stab-doc" role="tab" data-key="${esc(key)}">
					<span class="ci-stab-dot"></span>
					<span class="ci-stab-label"></span>
					<span class="ci-stab-close" role="button" title="${__("Close")}">${frappe.utils.icon("close", "xs")}</span>
				</button>`).appendTo(this.$docs);
        tab.$view = $(`<div class="ci-view" data-key="${esc(key)}" hidden></div>`).appendTo(this.$el.find(".ci-views"));
        this.tabs.push(tab);
        this.paint(tab);
        return tab;
      }
      async add_new() {
        this.new_count++;
        const doc = frappe.model.get_new_doc(DOCTYPE);
        const tab = this.add_tab(doc.name, __("New Receipt {0}", [this.new_count]));
        tab.editor = new digitz_erp.ReceiptEditor(this, tab, doc);
        await tab.editor.init_new();
        return tab;
      }
      async load(tab) {
        tab.loading = true;
        tab.$view.html(`<div class="ci-loading">${__("Loading {0}...", [esc(tab.key)])}</div>`);
        try {
          if (frappe.get_doc(DOCTYPE, tab.key)) {
            frappe.model.remove_from_locals(DOCTYPE, tab.key);
          }
          await frappe.model.with_doc(DOCTYPE, tab.key);
          const doc = frappe.get_doc(DOCTYPE, tab.key);
          if (!doc) {
            throw new Error("not found");
          }
          tab.editor = new digitz_erp.ReceiptEditor(this, tab, doc);
          await tab.editor.init_saved();
        } catch (e) {
          tab.$view.html(`<div class="ci-loading">${__("Could not open {0}. It may have been deleted or you may not have access.", [esc(tab.key)])}</div>`);
        } finally {
          tab.loading = false;
          this.paint(tab);
          this.persist();
        }
      }
      show(key) {
        this.active = key;
        this.$el.find(".ci-stab").each((_, el) => {
          const on = el.dataset.key === key;
          el.classList.toggle("active", on);
          el.setAttribute("aria-selected", on ? "true" : "false");
          on && el.scrollIntoView && el.scrollIntoView({ block: "nearest", inline: "nearest" });
        });
        this.$el.find(".ci-view").each((_, el) => {
          el.hidden = el.dataset.key !== key;
        });
        if (key === "list") {
          this.list.show();
        }
        this.$el.closest(".cashier-console").toggleClass("cc-in-invoice", key !== "list");
      }
      paint(tab) {
        const editor = tab.editor;
        const doc = editor && editor.doc;
        let state = "loading";
        if (doc) {
          state = doc.__islocal ? "new" : ["draft", "submitted", "cancelled"][doc.docstatus] || "draft";
        }
        tab.$tab.attr("data-state", state).toggleClass("is-dirty", !!(editor && editor.dirty));
        tab.$tab.find(".ci-stab-label").text(doc && !doc.__islocal ? doc.name : tab.label);
        const customer = editor && editor.customer;
        tab.$tab.attr("title", customer ? `${tab.$tab.find(".ci-stab-label").text()} \xB7 ${customer}` : "");
      }
      close(key) {
        const tab = this.tabs.find((t) => t.key === key);
        if (!tab) {
          return;
        }
        const remove = () => {
          const i = this.tabs.indexOf(tab);
          this.tabs.splice(i, 1);
          tab.$tab.remove();
          tab.$view.remove();
          if (tab.editor && frappe.get_doc(DOCTYPE, tab.editor.doc.name)) {
            frappe.model.remove_from_locals(DOCTYPE, tab.editor.doc.name);
          }
          this.persist();
          if (this.active === key) {
            const next = this.tabs[i] || this.tabs[i - 1];
            this.replace_route(next ? next.key : "list");
          }
        };
        if (tab.editor && tab.editor.dirty) {
          frappe.confirm(__("{0} has unsaved changes. Close it and lose them?", [esc(tab.$tab.find(".ci-stab-label").text())]), remove);
        } else {
          remove();
        }
      }
      renamed(tab, old_key) {
        tab.key = tab.editor.doc.name;
        tab.$tab.attr("data-key", tab.key);
        tab.$view.attr("data-key", tab.key);
        if (this.active === old_key) {
          this.active = tab.key;
          this.replace_route(tab.key);
        }
        this.persist();
      }
      persist() {
        const names = this.tabs.filter((t) => !t.key.startsWith("new-")).map((t) => t.key);
        try {
          localStorage.setItem(storage_key(), JSON.stringify(names.slice(-10)));
        } catch (e) {
        }
      }
      restore() {
        let names = [];
        try {
          names = JSON.parse(localStorage.getItem(storage_key()) || "[]");
        } catch (e) {
          names = [];
        }
        (Array.isArray(names) ? names : []).forEach((name) => typeof name === "string" && this.add_tab(name));
      }
    };
    digitz_erp.ReceiptList = (_a2 = class {
      constructor(host, $el) {
        this.host = host;
        this.$el = $el;
        this.range = "today";
        this.status = "";
        this.search = "";
        this.rows = [];
        this.reload = frappe.utils.debounce(() => this.load(true), 300);
        this.make();
      }
      make() {
        const chips = (name, items, value) => `
				<div class="ci-chips" data-filter="${name}">
					${items.map(([v, label]) => `<button type="button" class="ci-chip${v === value ? " active" : ""}" data-value="${v}">${label}</button>`).join("")}
				</div>`;
        this.$el.html(`
				<div class="ci-list">
					<div class="ci-list-bar">
						<div class="ci-search">
							${frappe.utils.icon("search", "sm")}
							<input type="search" class="form-control" placeholder="${__("Search receipt no, customer or reference")}" aria-label="${__("Search receipts")}">
						</div>
						<select class="form-control ci-range" aria-label="${__("Period")}">
							${[["today", __("Today")], ["week", __("This Week")], ["month", __("This Month")], ["30", __("Last 30 Days")], ["all", __("All")]].map(([v, label]) => `<option value="${v}"${v === this.range ? " selected" : ""}>${label}</option>`).join("")}
						</select>
						${chips("status", [["", __("Any Status")], ["0", __("Draft")], ["1", __("Submitted")], ["2", __("Cancelled")]], this.status)}
						<span class="ci-list-count text-muted"></span>
					</div>
					<div class="ci-list-table"></div>
					<div class="ci-list-more" hidden>
						<button type="button" class="btn btn-default btn-sm">${__("Load more")}</button>
					</div>
				</div>
			`);
        this.$el.on("input", ".ci-search input", (e) => {
          this.search = e.currentTarget.value.trim();
          this.reload();
        });
        this.$el.on("change", ".ci-range", (e) => {
          this.range = e.currentTarget.value;
          this.load(true);
        });
        this.$el.on("click", ".ci-chip", (e) => {
          const $chip = $(e.currentTarget);
          const filter = $chip.closest(".ci-chips").attr("data-filter");
          this[filter] = $chip.attr("data-value");
          $chip.addClass("active").siblings().removeClass("active");
          this.load(true);
        });
        this.$el.on("click", "tr[data-name]", (e) => this.host.open_receipt($(e.currentTarget).attr("data-name")));
        this.$el.on("keydown", "tr[data-name]", (e) => {
          if (e.key === "Enter") {
            this.host.open_receipt($(e.currentTarget).attr("data-name"));
          }
        });
        this.$el.on("click", ".ci-list-more button", () => this.load(false));
      }
      show() {
        this.loaded ? this.paint_open() : this.load(true);
      }
      filters() {
        const today = frappe.datetime.get_today();
        const from = {
          today,
          week: frappe.datetime.week_start(),
          month: frappe.datetime.month_start(),
          30: frappe.datetime.add_days(today, -29)
        }[this.range];
        const filters = [];
        from && filters.push([DOCTYPE, "posting_date", ">=", from]);
        this.status !== "" && filters.push([DOCTYPE, "docstatus", "=", cint(this.status)]);
        return filters;
      }
      async load(reset) {
        const seq = this.seq = (this.seq || 0) + 1;
        const start = reset ? 0 : this.rows.length;
        const like = `%${this.search}%`;
        this.$el.addClass("is-loading");
        try {
          const r = await frappe.call({
            method: "frappe.client.get_list",
            args: {
              doctype: DOCTYPE,
              fields: ["name", "posting_date", "posting_time", "customers", "payment_mode", "reference_no", "amount", "docstatus"],
              filters: this.filters(),
              or_filters: this.search ? ["name", "customers", "reference_no"].map((f) => [DOCTYPE, f, "like", like]) : [],
              order_by: "posting_date desc, posting_time desc, creation desc",
              limit_start: start,
              limit_page_length: digitz_erp.ReceiptList.PAGE + 1
            }
          });
          if (seq !== this.seq) {
            return;
          }
          const rows = r.message || [];
          const more = rows.length > digitz_erp.ReceiptList.PAGE;
          this.rows = (reset ? [] : this.rows).concat(rows.slice(0, digitz_erp.ReceiptList.PAGE));
          this.loaded = true;
          this.render(more);
        } finally {
          seq === this.seq && this.$el.removeClass("is-loading");
        }
      }
      render(more) {
        const $table = this.$el.find(".ci-list-table");
        this.$el.find(".ci-list-more").prop("hidden", !more);
        this.$el.find(".ci-list-count").text(
          this.rows.length ? __("{0} receipt(s){1}", [this.rows.length, more ? "+" : ""]) : ""
        );
        if (!this.rows.length) {
          $table.html(`
					<div class="ci-empty-list">
						<p>${this.search ? __("No receipts match your search.") : __("No receipts in this period.")}</p>
						<button type="button" class="btn btn-primary btn-sm cr-new">${__("New Receipt")}</button>
					</div>`);
          return;
        }
        const status = (row) => {
          const [label, colour] = [[__("Draft"), "orange"], [__("Submitted"), "green"], [__("Cancelled"), "red"]][row.docstatus] || ["", "gray"];
          return `<span class="indicator-pill ${colour}">${label}</span>`;
        };
        const time = (row) => row.posting_time ? moment(String(row.posting_time), "HH:mm:ss").format("HH:mm") : "";
        $table.html(`
				<div class="ci-scroll">
					<table class="ci-table ci-table-list">
						<thead><tr>
							<th>${__("Receipt")}</th><th>${__("Date")}</th><th>${__("Customer")}</th>
							<th>${__("Payment")}</th><th>${__("Reference")}</th><th class="ci-num">${__("Amount")}</th><th>${__("Status")}</th>
						</tr></thead>
						<tbody>${this.rows.map((row) => `
							<tr data-name="${esc(row.name)}" tabindex="0">
								<td class="ci-strong ci-nowrap"><span class="ci-open-mark" title="${__("Open in a tab")}"></span>${esc(row.name)}</td>
								<td class="ci-nowrap">${frappe.datetime.str_to_user(row.posting_date)} <span class="text-muted">${time(row)}</span></td>
								<td><div class="ci-ellipsis">${esc(row.customers)}</div></td>
								<td><span class="ci-tag">${esc(row.payment_mode)}</span></td>
								<td class="ci-nowrap">${esc(row.reference_no)}</td>
								<td class="ci-num ci-strong">${money(row.amount)}</td>
								<td>${status(row)}</td>
							</tr>`).join("")}
						</tbody>
					</table>
				</div>`);
        this.paint_open();
      }
      paint_open() {
        const open = new Set(this.host.tabs.map((t) => t.key));
        this.$el.find("tr[data-name]").each((_, tr) => tr.classList.toggle("is-open", open.has(tr.dataset.name)));
      }
    }, __publicField(_a2, "PAGE", 50), _a2);
    digitz_erp.ReceiptEditor = class ReceiptEditor {
      constructor(host, tab, doc) {
        this.host = host;
        this.tab = tab;
        this.doc = doc;
        this.dirty = !!doc.__islocal;
        this.$el = tab.$view;
        this.controls = {};
        this.customer = null;
        this.mode = null;
        this.rows = [];
        this.rows_loading = false;
      }
      async init_new() {
        this.tab.$view.html(`<div class="ci-loading">${__("Preparing a new receipt...")}</div>`);
        try {
          const defaults = await this.host.get_defaults();
          const doc = this.doc;
          doc.company = defaults.company;
          doc.warehouse = defaults.warehouse;
          defaults.payment_mode && await this.set_payment_mode(defaults.payment_mode);
        } catch (err) {
          console.error("Error loading receipt defaults:", err);
        }
        this.render();
      }
      async init_saved() {
        const doc = this.doc;
        const line = (doc.receipt_entry_details || [])[0];
        this.customer = line ? line.customer : null;
        if (doc.payment_mode) {
          const r = await frappe.db.get_value("Payment Mode", doc.payment_mode, "mode");
          this.mode = (r.message || {}).mode || doc.mode;
        }
        if (this.is_editable() && this.customer) {
          await this.load_rows();
        }
        this.render();
      }
      async reload() {
        frappe.model.remove_from_locals(DOCTYPE, this.doc.name);
        await frappe.model.with_doc(DOCTYPE, this.doc.name);
        this.doc = frappe.get_doc(DOCTYPE, this.doc.name);
        this.dirty = false;
        await this.init_saved();
        this.host.paint(this.tab);
      }
      is_editable() {
        return this.doc.docstatus === 0 && fits_console(this.doc);
      }
      async set_payment_mode(payment_mode) {
        const doc = this.doc;
        doc.payment_mode = payment_mode || null;
        doc.account = null;
        this.mode = null;
        if (payment_mode) {
          const r = await frappe.db.get_value("Payment Mode", payment_mode, ["account", "mode"]);
          const values = r.message || {};
          doc.account = values.account || null;
          doc.mode = values.mode || null;
          this.mode = values.mode || null;
        }
        if (this.mode !== "Bank") {
          doc.reference_no = null;
          doc.reference_date = null;
        } else if (!doc.reference_date) {
          doc.reference_date = frappe.datetime.get_today();
        }
      }
      async load_rows() {
        if (!this.customer) {
          this.rows = [];
          return;
        }
        this.rows_loading = true;
        this.render_rows();
        try {
          const rows = await frappe.xcall(`${API}.get_console_receivables`, {
            customer: this.customer,
            receipt_no: this.doc.__islocal ? "" : this.doc.name
          });
          this.rows = (rows || []).map((row) => Object.assign(row, { paying: round2(row.paying_amount) }));
        } finally {
          this.rows_loading = false;
        }
      }
      total_paying() {
        return round2(this.rows.reduce((sum, row) => sum + flt(row.paying), 0));
      }
      total_balance() {
        return round2(this.rows.reduce((sum, row) => sum + flt(row.balance_amount), 0));
      }
      spread(amount) {
        let left = round2(amount);
        this.rows.forEach((row) => {
          row.paying = round2(Math.max(0, Math.min(left, flt(row.balance_amount))));
          left = round2(left - row.paying);
        });
        return left;
      }
      mark_dirty() {
        this.dirty = true;
        this.refresh();
      }
      render() {
        this.controls = {};
        const doc = this.doc;
        const editable = this.is_editable();
        this.$el.html(`
				<div class="ci-editor cr-editor${editable ? "" : " is-readonly"}">
					<div class="ci-banners"></div>
					<header class="ci-head">
						<div class="ci-head-main">
							<h3 class="ci-docname"></h3>
							<span class="ci-status indicator-pill"></span>
							<div class="ci-head-meta"></div>
						</div>
						<div class="ci-actions"></div>
					</header>
					<div class="ci-layout">
						<div class="ci-main">
							<section class="ci-card cr-card-party">
								<div class="ci-fields cr-fields-party"></div>
							</section>
							<section class="ci-card cr-card-invoices">
								<div class="ci-card-head">
									<h4>${editable ? __("Invoices to pay") : __("Invoices paid")}</h4>
									<div class="cr-received"></div>
								</div>
								<div class="cr-rows"></div>
							</section>
							<div class="ci-side">
								<section class="ci-card ci-card-total">
									<div class="ci-total-label">${__("Amount Received")}</div>
									<div class="ci-total-value"></div>
									<div class="ci-sums"></div>
								</section>
							</div>
							<section class="ci-card cr-card-remarks">
								<div class="ci-fields cr-fields-remarks"></div>
							</section>
						</div>
					</div>
				</div>
			`);
        this.make_party_fields();
        this.bind();
        this.render_received();
        this.render_rows();
        this.refresh();
        if (editable && !this.customer) {
          setTimeout(() => this.focus("customer"), 50);
        }
      }
      make_control(selector, df, value) {
        const editable = this.is_editable();
        const $cell = $(`<div class="ci-field${df.span ? " ci-span-2" : ""}" data-fieldname="${df.fieldname}"></div>`).appendTo(this.$el.find(selector));
        const control = frappe.ui.form.make_control({
          df: Object.assign({}, df, { read_only: editable ? 0 : 1 }),
          parent: $cell,
          render_input: true
        });
        control.refresh();
        control.set_value(value != null ? value : "");
        this.controls[df.fieldname] = control;
        return control;
      }
      make_party_fields() {
        const doc = this.doc;
        const label = (fieldname) => __(frappe.meta.get_label(DOCTYPE, fieldname));
        this.make_control(".cr-fields-party", {
          fieldtype: "Link",
          fieldname: "customer",
          options: "Customer",
          label: __("Customer"),
          reqd: 1,
          get_query: () => ({ filters: { disabled: 0 } }),
          change: () => this.on_customer(this.controls.customer.get_value())
        }, this.customer);
        this.make_control(".cr-fields-party", {
          fieldtype: "Link",
          fieldname: "payment_mode",
          options: "Payment Mode",
          label: label("payment_mode"),
          reqd: 1,
          change: () => this.on_payment_mode(this.controls.payment_mode.get_value())
        }, doc.payment_mode);
        this.make_control(".cr-fields-party", {
          fieldtype: "Data",
          fieldname: "reference_no",
          label: label("reference_no"),
          reqd: 1,
          change: () => this.on_value("reference_no")
        }, doc.reference_no);
        this.make_control(".cr-fields-party", {
          fieldtype: "Date",
          fieldname: "reference_date",
          label: label("reference_date"),
          reqd: 1,
          change: () => this.on_value("reference_date")
        }, doc.reference_date);
        this.make_control(".cr-fields-remarks", {
          fieldtype: "Small Text",
          fieldname: "remarks",
          label: label("remarks"),
          span: 1,
          change: () => this.on_value("remarks")
        }, doc.remarks);
        const remarks = this.controls.remarks;
        remarks.$input && remarks.$input.is("textarea") && remarks.$input.css("height", "72px");
      }
      render_received() {
        const $wrap = this.$el.find(".cr-received");
        if (!this.is_editable()) {
          $wrap.empty();
          return;
        }
        $wrap.html(`
				<label class="cr-received-label" for="cr-received-${esc(this.tab.key)}">${__("Amount received")}</label>
				<input type="text" inputmode="decimal" class="ci-input cr-received-input" id="cr-received-${esc(this.tab.key)}"
					placeholder="0.00" title="${__("Fills the invoices oldest first")}">
				<button type="button" class="btn btn-default btn-xs" data-action="pay-all">${__("Pay all")}</button>
				<button type="button" class="btn btn-default btn-xs" data-action="clear">${__("Clear")}</button>`);
      }
      render_rows() {
        const $wrap = this.$el.find(".cr-rows");
        if (!$wrap.length) {
          return;
        }
        if (!this.is_editable()) {
          $wrap.html(this.saved_rows_html());
          return;
        }
        if (!this.customer) {
          $wrap.html(`<div class="cr-empty text-muted">${__("Select the customer to see their unpaid credit invoices.")}</div>`);
          return;
        }
        if (this.rows_loading) {
          $wrap.html(`<div class="cr-empty text-muted">${__("Loading the customer's invoices...")}</div>`);
          return;
        }
        if (!this.rows.length) {
          $wrap.html(`<div class="cr-empty text-muted">${__("{0} has no unpaid credit invoices.", [esc(this.customer)])}</div>`);
          return;
        }
        $wrap.html(`
				<div class="ci-scroll">
					<table class="ci-table cr-table">
						<thead><tr>
							<th class="cr-col-check"><input type="checkbox" class="cr-check-all" aria-label="${__("Pay all invoices in full")}"></th>
							<th>${__("Invoice")}</th><th>${__("Date")}</th><th>${__("Reference")}</th>
							<th class="ci-num">${__("Invoice Amount")}</th>
							<th class="ci-num" title="${__("Allocated in other receipts, drafts included")}">${__("Other Receipts")}</th>
							<th class="ci-num">${__("Balance")}</th>
							<th class="ci-num">${__("Paying")}</th>
						</tr></thead>
						<tbody>${this.rows.map((row, i) => `
							<tr data-row="${i}">
								<td class="cr-col-check"><input type="checkbox" class="cr-check" aria-label="${__("Pay {0} in full", [esc(row.reference_name)])}"></td>
								<td class="ci-strong ci-nowrap">${esc(row.reference_name)}</td>
								<td class="ci-nowrap">${frappe.datetime.str_to_user(row.posting_date)}</td>
								<td><div class="ci-ellipsis">${esc(row.reference_no)}</div></td>
								<td class="ci-num">${money(row.invoice_amount)}</td>
								<td class="ci-num">${flt(row.paid_amount) ? money(row.paid_amount) : `<span class="text-muted">-</span>`}</td>
								<td class="ci-num ci-strong">${money(row.balance_amount)}</td>
								<td class="ci-num"><input type="text" inputmode="decimal" class="ci-input cr-pay" data-row="${i}"></td>
							</tr>`).join("")}
						</tbody>
					</table>
				</div>`);
        this.refresh_rows();
      }
      saved_rows_html() {
        const allocations = (this.doc.receipt_allocation || []).filter((a) => flt(a.paying_amount) > 0);
        if (!allocations.length) {
          return `<div class="cr-empty text-muted">${__("This receipt pays no invoices.")}</div>`;
        }
        const can_open = (a) => a.reference_type === "Sales Invoice" && this.doc.docstatus === 1;
        return `
				<div class="ci-scroll">
					<table class="ci-table cr-table">
						<thead><tr>
							<th>${__("Document")}</th><th>${__("Customer")}</th>
							<th class="ci-num">${__("Total")}</th><th class="ci-num">${__("Paid")}</th><th></th>
						</tr></thead>
						<tbody>${allocations.map((a) => `
							<tr>
								<td class="ci-strong ci-nowrap">${esc(a.reference_name)}<div class="ci-sub">${esc(__(a.reference_type))}</div></td>
								<td><div class="ci-ellipsis">${esc(a.customer)}</div></td>
								<td class="ci-num">${money(a.total_amount)}</td>
								<td class="ci-num ci-strong">${money(a.paying_amount)}</td>
								<td class="ci-row-actions">${can_open(a) ? `<button type="button" class="btn btn-default btn-xs" data-open-invoice="${esc(a.reference_name)}"
										title="${__("Open the invoice to print it and its receipt")}">${__("Open Invoice")}</button>` : ""}</td>
							</tr>`).join("")}
						</tbody>
					</table>
				</div>`;
      }
      bind() {
        this.$el.off();
        this.$el.on("click", "[data-action]", (e) => {
          e.preventDefault();
          this.action($(e.currentTarget).attr("data-action"));
        });
        this.$el.on("click", "[data-open-invoice]", (e) => {
          frappe.set_route("cashier-console", "invoices", $(e.currentTarget).attr("data-open-invoice"));
        });
        this.$el.on("change", ".cr-received-input", (e) => {
          const value = flt(e.currentTarget.value);
          const left = this.spread(value);
          left > 0 && frappe.show_alert({
            message: __("{0} is more than the invoices' balance. Only {1} is allocated.", [money(value), money(value - left)]),
            indicator: "orange"
          });
          this.mark_dirty();
        });
        this.$el.on("keydown", ".cr-received-input, .cr-pay", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        });
        this.$el.on("focus", ".cr-received-input, .cr-pay", (e) => e.currentTarget.select());
        this.$el.on("change", ".cr-pay", (e) => {
          const row = this.rows[cint(e.currentTarget.dataset.row)];
          let value = round2(e.currentTarget.value);
          if (value < 0) {
            value = 0;
          }
          if (value > flt(row.balance_amount)) {
            frappe.show_alert({ message: __("{0}: at most {1} is left to pay.", [row.reference_name, money(row.balance_amount)]), indicator: "orange" });
            value = round2(row.balance_amount);
          }
          row.paying = value;
          this.mark_dirty();
        });
        this.$el.on("change", ".cr-check", (e) => {
          const row = this.rows[cint($(e.currentTarget).closest("tr").attr("data-row"))];
          row.paying = e.currentTarget.checked ? round2(row.balance_amount) : 0;
          this.mark_dirty();
        });
        this.$el.on("change", ".cr-check-all", (e) => {
          const on = e.currentTarget.checked;
          this.rows.forEach((row) => row.paying = on ? round2(row.balance_amount) : 0);
          this.mark_dirty();
        });
      }
      async on_customer(customer) {
        customer = customer || null;
        if (customer === this.customer) {
          return;
        }
        this.customer = customer;
        this.rows = [];
        this.dirty = true;
        await this.load_rows();
        this.render_rows();
        this.refresh();
        this.host.paint(this.tab);
        customer && !this.doc.payment_mode && this.focus("payment_mode");
      }
      async on_payment_mode(payment_mode) {
        payment_mode = payment_mode || null;
        if (payment_mode === (this.doc.payment_mode || null)) {
          return;
        }
        await this.set_payment_mode(payment_mode);
        this.controls.reference_no.set_value(this.doc.reference_no || "");
        this.controls.reference_date.set_value(this.doc.reference_date || "");
        this.mark_dirty();
        this.mode === "Bank" ? this.focus("reference_no") : this.$el.find(".cr-received-input").trigger("focus");
      }
      on_value(fieldname) {
        const value = this.controls[fieldname].get_value() || null;
        if ((this.doc[fieldname] || null) === value) {
          return;
        }
        this.doc[fieldname] = value;
        this.mark_dirty();
      }
      focus(fieldname) {
        const control = this.controls[fieldname];
        control && control.$input && control.$input.trigger("focus");
      }
      refresh() {
        this.refresh_head();
        this.refresh_fields();
        this.refresh_rows();
        this.refresh_totals();
        this.refresh_banners();
        this.host.paint(this.tab);
      }
      refresh_head() {
        const doc = this.doc;
        const [label, colour] = doc.__islocal ? [__("Not Saved"), "orange"] : [[__("Draft"), "orange"], [__("Submitted"), "green"], [__("Cancelled"), "red"]][doc.docstatus];
        this.$el.find(".ci-docname").text(doc.__islocal ? __("New Receipt") : doc.name);
        this.$el.find(".ci-status").attr("class", `ci-status indicator-pill ${this.dirty && !doc.__islocal ? "orange" : colour}`).text(this.dirty && !doc.__islocal ? __("Not Saved") : label);
        const meta = [];
        doc.posting_date && meta.push(`${frappe.utils.icon("calendar", "xs")} ${frappe.datetime.str_to_user(doc.posting_date)} ${doc.posting_time ? moment(String(doc.posting_time), "HH:mm:ss").format("HH:mm") : ""}`);
        doc.counter_session && meta.push(esc(doc.counter_session));
        doc.amended_from && meta.push(__("Amended from {0}", [esc(doc.amended_from)]));
        this.$el.find(".ci-head-meta").html(meta.map((m) => `<span>${m}</span>`).join(""));
        this.render_actions();
      }
      render_actions() {
        const doc = this.doc;
        const saved = !doc.__islocal;
        const btn = (action, label, cls = "btn-default", icon = "") => `<button type="button" class="btn btn-sm ${cls}" data-action="${action}">${icon ? frappe.utils.icon(icon, "sm") : ""}<span>${label}</span></button>`;
        const item = (action, label) => `<li><a class="dropdown-item" href="#" data-action="${action}">${label}</a></li>`;
        const buttons = [];
        if (this.is_editable()) {
          buttons.push(btn("save", __("Save"), saved && !this.dirty ? "btn-default" : "btn-primary", "check"));
          saved && !this.dirty && buttons.push(btn("submit", __("Submit"), "btn-primary"));
        }
        if (saved) {
          buttons.push(`
					<div class="btn-group">
						<button type="button" class="btn btn-sm btn-default dropdown-toggle ci-menu" data-toggle="dropdown" aria-expanded="false" aria-label="${__("More actions")}">
							${frappe.utils.icon("dot-horizontal", "sm")}
						</button>
						<ul class="dropdown-menu dropdown-menu-right">
							${item("reload", __("Reload"))}
							${item("form", __("Open in Standard Form"))}
						</ul>
					</div>`);
        }
        this.$el.find(".ci-actions").html(buttons.join(""));
      }
      refresh_fields() {
        const bank = this.mode === "Bank";
        ["reference_no", "reference_date"].forEach((fieldname) => {
          const shown = bank || !this.is_editable() && !!this.doc[fieldname];
          this.$el.find(`.ci-field[data-fieldname="${fieldname}"]`).prop("hidden", !shown);
        });
      }
      refresh_rows() {
        if (!this.is_editable()) {
          return;
        }
        const $rows = this.$el.find(".cr-table tbody tr[data-row]");
        $rows.each((_, tr) => {
          const row = this.rows[cint(tr.dataset.row)];
          if (!row) {
            return;
          }
          const paying = flt(row.paying);
          const $input = $(tr).find(".cr-pay");
          !$input.is(":focus") && $input.val(paying ? format_number(paying, null, 2) : "");
          $(tr).find(".cr-check").prop("checked", paying > 0 && round2(paying) === round2(row.balance_amount));
          tr.classList.toggle("is-paying", paying > 0);
        });
        const full = this.rows.length && this.rows.every((row) => round2(row.paying) === round2(row.balance_amount));
        this.$el.find(".cr-check-all").prop("checked", !!full);
      }
      refresh_totals() {
        const editable = this.is_editable();
        const total = editable ? this.total_paying() : flt(this.doc.amount);
        this.$el.find(".ci-total-value").text(money(total));
        const sums = [];
        if (editable) {
          const paying = this.rows.filter((row) => flt(row.paying) > 0).length;
          sums.push([__("Invoices paid"), paying ? `${paying} / ${this.rows.length}` : "-"]);
          sums.push([__("Customer's balance"), money(this.total_balance())]);
          this.rows.length && sums.push([__("Left after this receipt"), money(this.total_balance() - total)]);
        } else {
          const line = (this.doc.receipt_entry_details || [])[0];
          line && line.customer && sums.push([__("Customer"), esc(line.customer)]);
        }
        this.doc.payment_mode && sums.push([__("Payment Mode"), esc(this.doc.payment_mode)]);
        this.$el.find(".ci-sums").html(sums.map(([l, v]) => `<div class="ci-sum"><span>${l}</span><span>${v}</span></div>`).join(""));
      }
      refresh_banners() {
        const banners = [];
        if (this.doc.docstatus === 0 && !fits_console(this.doc)) {
          banners.push([
            "orange",
            __("This receipt has lines the console does not handle (other customers, reference types or receipts). Open it in the standard form to change it."),
            `<button type="button" class="btn btn-xs btn-default" data-action="form">${__("Open in Standard Form")}</button>`
          ]);
        } else if (this.doc.docstatus === 0 && !this.doc.__islocal && !this.dirty) {
          banners.push(["blue", __("Saved as a draft. The invoices are paid once the receipt is submitted."), ""]);
        } else if (this.doc.docstatus === 2) {
          banners.push(["red", __("This receipt is cancelled. The invoices it paid are unpaid again."), ""]);
        }
        this.$el.find(".ci-banners").html(banners.map(([tone, text, extra]) => `<div class="ci-banner ci-banner-${tone}"><span>${text}</span>${extra}</div>`).join(""));
      }
      action(name) {
        ({
          save: () => this.save("Save"),
          submit: () => this.save("Submit"),
          "pay-all": () => {
            this.rows.forEach((row) => row.paying = round2(row.balance_amount));
            this.$el.find(".cr-received-input").val("");
            this.mark_dirty();
          },
          clear: () => {
            this.rows.forEach((row) => row.paying = 0);
            this.$el.find(".cr-received-input").val("");
            this.mark_dirty();
          },
          reload: () => this.reload(),
          form: () => frappe.set_route("Form", DOCTYPE, this.doc.name)
        }[name] || (() => {
        }))();
      }
      check() {
        const doc = this.doc;
        const fail = (message, fieldname) => {
          frappe.msgprint({ message, indicator: "orange", title: __("Cannot save the receipt") });
          fieldname && this.focus(fieldname);
          return false;
        };
        if (!this.customer) {
          return fail(__("Select the customer."), "customer");
        }
        if (!doc.payment_mode) {
          return fail(__("Select the payment mode."), "payment_mode");
        }
        if (!doc.account) {
          return fail(__("Payment mode {0} has no account set. Ask a supervisor to set it.", [esc(doc.payment_mode)]));
        }
        if (this.mode === "Bank" && !doc.reference_no) {
          return fail(__("Reference No is required for a bank payment."), "reference_no");
        }
        if (this.mode === "Bank" && !doc.reference_date) {
          return fail(__("Reference Date is required for a bank payment."), "reference_date");
        }
        const over = this.rows.find((row) => round2(row.paying) > round2(row.balance_amount));
        if (over) {
          return fail(__("{0}: at most {1} is left to pay.", [esc(over.reference_name), money(over.balance_amount)]));
        }
        if (this.total_paying() <= 0) {
          return fail(__("Enter the amount paid against at least one invoice."));
        }
        return true;
      }
      build_doc() {
        const doc = this.doc;
        const total = this.total_paying();
        const defaults = this.host.defaults || {};
        if (doc.__islocal) {
          doc.posting_date = frappe.datetime.get_today();
          doc.posting_time = frappe.datetime.now_time();
        }
        doc.company = doc.company || defaults.company;
        doc.warehouse = doc.warehouse || defaults.warehouse;
        doc.amount = total;
        doc.allocated_amount = total;
        doc.mode = this.mode;
        let line = (doc.receipt_entry_details || [])[0];
        if (!line) {
          line = frappe.model.add_child(doc, DETAIL_DOCTYPE, "receipt_entry_details");
        }
        Object.assign(line, {
          receipt_type: "Customer",
          reference_type: "Sales Invoice",
          customer: this.customer,
          account: line.account || defaults.receivable_account,
          reference_no: doc.reference_no,
          reference_date: doc.reference_date,
          project: doc.project || null,
          amount: total,
          allocated_amount: total
        });
        doc.receipt_entry_details = [line];
        doc.receipt_allocation = [];
        this.rows.filter((row) => flt(row.paying) > 0).forEach((row) => {
          const allocation = frappe.model.add_child(doc, ALLOCATION_DOCTYPE, "receipt_allocation");
          Object.assign(allocation, {
            customer: this.customer,
            reference_type: "Sales Invoice",
            reference_name: row.reference_name,
            total_amount: row.invoice_amount,
            paid_amount: row.paid_amount,
            balance_amount: row.balance_amount,
            paying_amount: round2(row.paying),
            project: row.project || null
          });
        });
      }
      async save(action) {
        if (this.saving || !this.is_editable()) {
          return;
        }
        if (action === "Save" && !this.check()) {
          return;
        }
        const doc = this.doc;
        const run = async () => {
          this.saving = true;
          const old_key = this.tab.key;
          const old_name = doc.name;
          try {
            if (action === "Save") {
              if (!this.host.defaults) {
                await this.host.get_defaults().catch(() => null);
              }
              this.build_doc();
            }
            const r = await frappe.call({
              method: "frappe.desk.form.save.savedocs",
              args: { doc, action },
              freeze: true,
              freeze_message: action === "Submit" ? __("Submitting...") : __("Saving...")
            });
            const saved = r.docs && r.docs[0];
            if (!saved) {
              return;
            }
            if (saved.name !== old_name) {
              frappe.model.remove_from_locals(DOCTYPE, old_name);
            }
            this.doc = frappe.get_doc(DOCTYPE, saved.name) || saved;
            this.dirty = false;
            await this.init_saved();
            old_key !== this.doc.name && this.host.renamed(this.tab, old_key);
            this.host.paint(this.tab);
            this.host.list.loaded = false;
            frappe.show_alert({
              message: action === "Submit" ? __("Submitted {0}", [this.doc.name]) : __("Saved {0}", [this.doc.name]),
              indicator: "green"
            });
          } catch (e) {
          } finally {
            this.saving = false;
          }
        };
        if (action === "Submit") {
          frappe.confirm(__(
            "Submit {0} for {1}? The invoices are then paid and the receipt cannot be changed.",
            [esc(doc.name), money(doc.amount)]
          ), run);
        } else {
          await run();
        }
      }
    };
  })();
})();
//# sourceMappingURL=sales_invoice.bundle.D36KE7OJ.js.map
