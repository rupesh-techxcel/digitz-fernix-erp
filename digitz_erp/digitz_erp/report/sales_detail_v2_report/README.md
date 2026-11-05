# Sales Detail V2 Report

One row per service line of a submitted Sales Invoice. Drafts, cancelled invoices,
Sales Returns and receipts are excluded. Standard report files are installed on
production by `bench migrate`. Access matches Sales Details Report (Management
and System Manager), with Sales Invoice permissions enforced. Cashiers, if granted
report access later, are restricted to their own invoices.

The mapped columns follow the supplied SERVICE_REPORT workbook order. The workbook is
a layout reference, not data to import. Values come from saved invoice lines;
Category and Stock ID come from the current Item master. Salesman is the saved
invoice Salesman, not the customer's current assignment.

## Amount definitions

- Service Charge and Govt.Fee are per-unit rates. Their Total columns multiply
  those rates by Quantity. Additional columns show extended Typing Charges and
  Transaction Charges separately, rather than mislabel them as bank charges.
- Total VAT is the saved line tax. Discount Amount is the saved line discount.
- Line Total is saved line net amount minus VAT. Line Total With VAT is also
  provided. Net Service Charge is Line Total minus Total Govt.Fee, including typing
  and transaction revenue and reflecting line discounts. This intentionally
  excludes pass-through government fees, including on government-only lines.
- Invoice Total repeats the saved rounded total on each service row, matching
  the reference. The summary counts each invoice only once; automatic column
  totals are disabled. The invoice total includes all lines even if a Service or
  Category filter displays only some lines. VAT summary covers selected lines.
- Round Off is the invoice round-off only; no separate extra-charge
  data exists. Round-off and Invoice Additional Discount appear on the first
  displayed line per invoice, without arbitrary allocation across services.
  Sum(Line Total With VAT) - Additional Discount + Round Off reconciles to the
  invoice total when all lines are selected and saved totals are consistent.

## Other mappings and unavailable data

- Card Type is Payment Mode, or Credit for a credit sale. Payment Status is
  calculated from paid amount and invoice total at currency precision; a fully
  paid credit sale shows Paid. Cash sales are paid at submission.
- Customer is the invoice Customer link; Display Customer, Mobile and Email are
  saved invoice values, preserving applicant details from tokens.
- Created By is the invoice creator's login ID (User). No reliable creator-to-HR
  Employee relationship is stored. Sales Man displays the assigned employee's
  name rather than their code; the Salesman filter still selects an Employee.
- Invoice Payment Reference is the invoice's Reference No, not a reference from
  subsequent receipts (there may be several receipts per invoice).
- Govt.Bank, Bank Service Charge, Bank Service Charge VAT, Other Charge,
  MB/ST/DW-ID, Application ID / Receipt ID, Ref.Name, Employee Commission,
  Customer Commission and Reward Amount are omitted. There are no
  corresponding stored invoice fields.

Export is available through Frappe's standard report Export action.

## Filters

Invoice Number selects a submitted invoice. Qmatic / Customer Token, Applicant /
Display Customer, Mobile, Email and TRN use literal contains searches against saved
invoice values. Show Company / Show TRN allow All (blank), Yes or No.

Numeric minimum / maximum bounds are inclusive, and zero is a valid limit:
Invoice Total, Round Off, Amount Paid, Outstanding Balance, Quantity, Govt. Fee
(per unit), Service / Centre Charge (per unit), Line VAT and Line Total With VAT.
Outstanding Balance is the remaining invoice receivable (total minus paid amount,
never below zero); cash invoices have no receivable. It is not cash change or the
customer's current aggregate credit balance. Amount Paid includes recorded receipts,
rather than the cash Given Amount field from the reference entry screen.

Line filters restrict displayed service lines; the Invoice Total summary still
counts each matching invoice's full total once. Government Account, Bank Charge
and Application ID filters are unavailable because those values are not stored.
