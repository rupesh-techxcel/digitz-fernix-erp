# Medical Center reports

The **Reports** section of the Medical Center workspace has seven reports. They answer "how much did we sell, where, by whom and for what". Open a section for the details of each.

![The Reports section of the Medical Center workspace](/assets/digitz_erp/images/help/workspace-reports.png)

## Which report to use

Pick the report by the question you are asking. Most start on today's date.

| Question | Report |
|---|---|
| How much did each person take, by payment mode? | Sales Summary Report |
| How much was taken at each counter, and by whom? | Counter based Sales report |
| Which invoices make up the takings, with their charges and VAT? | Sales Details Report |
| Which medical services sold, day by day? | Service wise Sales Report |
| Which items sold, day by day? | Itemwise Sales Report |
| Which item categories sold, day by day? | Item Category Wise Sales |
| Did each cashier's till balance? | Counter Session Summary |

**For every report:**

- **Sales Returns are taken off.** A submitted Sales Return reduces the sales on the date of the return, not the date of the original invoice. Drafts and cancelled documents never count.

- Change the filters at the top, and the report refreshes.
- Click **⋯** (or **Menu**) → **Export** to download it as Excel or CSV, or use **Print**.
- A row that links to an invoice or item opens it when clicked.

## Who sees what

Cashiers see only their own sales. Some reports are for System Managers only.

| Report | Who can open it |
|---|---|
| Sales Summary Report | System Manager, Cashier |
| Service wise Sales Report | System Manager, Cashier |
| Itemwise Sales Report | System Manager, Cashier |
| Counter based Sales report | System Manager |
| Sales Details Report | System Manager |
| Item Category Wise Sales | System Manager |
| Counter Session Summary | System Manager, Management |

**Anyone with the Cashier role sees only the invoices they own**, in every sales report except Counter based Sales report. Their **User** filter is ignored. System Managers and the Administrator see everyone's sales, even if they also have the Cashier role.

The workspace shows each person only the report cards they can open.

An invoice belongs to whoever last saved or submitted it. Picking a job off the Sales Invoice Board makes it yours.

## Sales Summary Report

Total sales per user, split by payment mode, with a line for credit sales and a total for each user.

![Sales Summary Report](/assets/digitz_erp/images/help/report-sales-summary.png)

| Filter | Use |
|---|---|
| From Date / To Date | Required. Defaults to this month. |
| User | One person's sales. Ignored for cashiers. |

For each user it shows a heading, one line per **Payment Mode** (Cash, Card, …), a **Credit Sale** line for credit invoices, and their **Total**. A **Grand Total** ends the report.

- Only **submitted** invoices count.
- Sales Returns come off the same user's line for their payment mode, or off **Credit Sale** for a credit return.
- The amount is each invoice's **net total**: after VAT, before rounding. It can differ by a few fils from the rounded totals in other reports.

## Counter based Sales report

Takings per counter, with the users who worked each counter underneath. Split into cash, card and credit.

![Counter based Sales report](/assets/digitz_erp/images/help/report-counter-sales.png)

| Filter | Use |
|---|---|
| From Date / To Date | A date range. When both are set, **Today** is ignored. |
| Counter | One counter only. |
| User | One person only. |
| Today | A single day. Defaults to today, and is used when From and To are not both set. |

Each counter is a bold row with its totals. Click its arrow to show the users who billed on it. The columns are:

| Column | Meaning |
|---|---|
| Invoices | How many submitted invoices |
| Cash | Invoices paid by a payment mode whose **Mode** is **Cash** |
| Card / Bank | Invoices paid by any other payment mode |
| Credit | Credit sales |
| Returns | How much was given back by Sales Returns |
| Tax | VAT |
| Total | The rounded totals charged |

**Cash**, **Card / Bank**, **Credit**, **Tax** and **Total** are after returns. **Returns** shows what was taken off, and **Invoices** counts invoices only.

- The counter is the registered PC the invoice was saved or submitted on. Invoices from before counters were set up show as **Not recorded**.
- A Sales Return is counted on the counter of the day it was saved in. A return saved outside an open day shows as **Not recorded**.
- A **Total** row ends the report.
- To check a till against its count, use [Counter Session Summary](#counter-reports) instead. This report counts sales, not cash movements such as refunds or expenses.

## Sales Details Report

One row per invoice or Sales Return, with its items, charges, VAT, payment mode and user. Returns are negative.

![Sales Details Report](/assets/digitz_erp/images/help/report-sales-details.png)

| Filter | Use |
|---|---|
| From Date / To Date | Defaults to today. |
| User | One person's invoices. Ignored for cashiers. |
| Customer | One customer's invoices. |
| Payment Mode | One payment mode, or **Credit Sale** for credit invoices only. Choosing Credit Sale adds a **Credit Days** column. |

| Column | Meaning |
|---|---|
| Type | **Sales Invoice** or **Sales Return** |
| Document No | Click to open the invoice or return |
| Item Name | All the items on the invoice |
| Service Charge, Typing Charges | The taxable charges |
| Gov Fee | The government fee, not taxed |
| Gross Amount, Tax Amount, Net Amount | Before VAT, the VAT, and after VAT |
| Payment Mode | The payment mode, or **Credit Sale** |
| User/Counter | Who owns the invoice |

Only **submitted** documents are shown. The newest are at the top.

A **Sales Return** has its own row, with its charges and amounts **negative**. Add up a column, and returns are already taken off. The filters apply to returns too; choose **Credit Sale** to see credit returns.

## Service wise Sales Report

For each day, the amount sold for each medical service, largest first.

| Filter | Use |
|---|---|
| From Date / To Date | Defaults to today. |

Each day is a bold row with that day's total, then one row per **Service** with its amount after VAT. Only **submitted** invoices count.

- The service is the **Medical Service** on the invoice. Token invoices always have one.
- Invoices without a Medical Service, such as ones keyed in by hand, are grouped as **No service**.
- A Sales Return comes off the service of the invoice each returned line came from.

## Itemwise Sales Report

For each day, the amount sold for each item, largest first.

| Filter | Use |
|---|---|
| From Date / To Date | Defaults to today. |
| Item | One item only. |

Each day is a bold row with that day's total, then one row per **Item**. Amounts are **before VAT**. Only **submitted** invoices count, and Sales Returns come off the items returned.

## Item Category Wise Sales

For each day, the amount sold in each item category (Item Group), largest first.

| Filter | Use |
|---|---|
| From Date / To Date | Defaults to today. |

Each day is a bold row with that day's total, then one row per **Item Category**. Amounts are **before VAT**. Only **submitted** invoices count, and Sales Returns come off the categories of the items returned.

## Counter Session Summary

Every cashier's day in a date range: float, cash movements, expected and counted cash, and any difference.

Cash Sales Returns are already in it as **Refunds**. Use it to check that tills balanced, to find differences still waiting for approval, and to spot a cashier's pattern of shortages. See [Reports and the dashboard](#counter-reports) for its filters and columns.
