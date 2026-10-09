# Billing in the Cashier Console

The **Cashier Console** is the cashier's whole day on one page. Open it from the button at the top of the Medical Center workspace. Its tabs follow the shift: **Day Open**, then the work (**Sales Invoice Board**, **Sales Invoices**, **Receipts**), then **Day Close** and **Day History**. Open a section for the details.

## The Sales Invoice Board

Today's draft invoices raised from patients' tokens, for every counter. Pick one and bill it.

Tokens from reception become draft Sales Invoices on the server, about once a minute. The Board lists **today's** drafts, newest first, whoever's token raised them. It updates by itself, and **Sync Now** fetches new tokens at once.

- **Search** by invoice number, customer, the customer's company or token number.
- **Open Invoice** (or click the row) opens it in the **Sales Invoices** tab.
- An invoice leaves the Board when it is submitted.
- The number on the tab counts today's drafts still to be billed.

Drafts from earlier days are not on the Board: a cashier cannot bill them (see *Today's invoices only* below). A supervisor finds them in the **Sales Invoice** list, filtered to Draft.

## The Sales Invoices tab

All your invoices, and one tab per invoice you have open.

The **All Invoices** list starts on **Today**. Change the period (This Week, This Month, Last 30 Days, All), the status (Draft, Submitted, Cancelled) or Cash / Credit. **Search** by invoice number, customer, company, mobile or token.

A cashier's list shows the invoices they own. Billing an invoice makes it yours (see below), so everything you billed is there.

Each invoice you open gets its own tab. **New Invoice** (Alt+N) starts a new one. A tab with unsaved changes shows **Not Saved**, and the browser warns you before you close the page with any.

## Billing an invoice

Pick the customer, add the items, take payment, then save and submit.

1. **Customer.** Pick the customer. For a walk-in, change the name and, if needed, the company and TRN (see [Walk-in and corporate customers](#walk-in-customer)). **Customer details** opens the rest: email, company and TRN, address, salesman, token.
2. **Items.** Search for an item to add it. Each line shows Qty, Rate, Service Charges, GOV, Typing Charges, Transaction Charges, VAT and Net. The Rate is the sum of the charges, and VAT is charged on all of them except GOV (see [Price lists](#price-lists)). The pencil on a line opens its details.
3. **Payment** (Alt+P). Choose the payment mode, or tick **Credit Sale**. For a cash payment, enter the **Received Amount**: it must cover the total, and the change is shown.
4. **Save** (Ctrl+S), then **Submit**. A submitted invoice cannot be changed, only cancelled by someone allowed to.

**Print shows** beside New Invoice chooses whether the customer's **Company** and **TRN** appear on the printout.

## Printing

Print sends the PDF straight to the printer. It saves the invoice first when it has unsaved changes.

The invoice's **Print** menu has:

| Entry | What it does |
|---|---|
| **Print Invoice** | Prints the tax invoice |
| **Preview Invoice** | Shows it in a popup first |
| **Print Receipt** / **Preview Receipt** | The same for the receipt. Shown for a cash sale, and for a credit sale once it has been paid |

- **Ctrl+P** prints the open invoice, the same as Print Invoice.
- **It saves first.** An invoice with unsaved changes, or a new one with items, is saved before it prints, so the printout always shows what is stored. If the save is stopped (a missing field, say), nothing prints.
- On a counter PC set up for kiosk printing there is no print dialog. See [Setting up counters](#counter-setup).

The **Sales Invoice form** works the same way: **Print → Print Invoice** or **Print Receipt**, and **Ctrl+P**, save first and print the PDF. What the printout shows is in [Invoice and receipt printouts](#invoice-receipts).

## Credit invoices: Record Payment and Receipts

Take a credit customer's payment from the invoice, or from the Receipts tab for several invoices at once.

- **Record Payment** appears on a submitted credit invoice that is not fully paid. It takes the payment for that invoice, in full or in part, and submits the receipt. The invoice's Print menu then has the receipt.
- The **Receipts** tab collects payment on several of a customer's credit invoices together: pick the customer and the payment mode, then how much goes to each invoice. It is saved as an ordinary **Receipt Entry**.

Invoices count as paid only once the receipt is submitted. A cashier cannot cancel a receipt.

## Keyboard shortcuts

The keys that work right now are listed in a strip under the invoice's header.

| Keys | In the console | On the Sales Invoice form |
|---|---|---|
| **Alt+N** | New invoice | |
| **Ctrl+S** | Save | Save, or Submit a saved draft |
| **Alt+P** | Payment | |
| **Ctrl+P** | Print Invoice (saves first) | Print Invoice (saves first) |
| **Ctrl+B** | | New Sales Invoice |
| **Ctrl+G** | Search | Search |
| **?** | All shortcuts | All shortcuts |

On a Mac, use ⌘ in place of Ctrl.

## Today's invoices only

A cashier saves and submits only invoices dated today, on their counter's PC, after opening the day.

- Billing is blocked until you open the day on a registered counter PC. See [Opening your day](#day-open).
- An invoice dated another day opens read-only, and its date cannot be changed. Saving it shows *Not Today's Invoice*. Ask a supervisor to handle it.
- Supervisors (System Manager, Management, or a Cashier marked **Is Supervisor**) are not held to either rule.

## Billing an invoice makes it yours

Whoever saves or submits an invoice becomes its owner, wherever its token came from.

Pick a draft off the Board that another counter's token raised, and once you save or submit it:

- it is in **your** Sales Invoice list;
- its cash counts in **your** day and on **your** counter's Day Close;
- the reports put it under you;
- the printout names you as **Billed By**, and the receipt as **Received By**.

Cancelling an invoice does not move it.
