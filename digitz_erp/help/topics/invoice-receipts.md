# Invoice and receipt printouts

Every Sales Invoice gets its tax invoice as a PDF attachment. A cash sale gets its receipt at the same time. A credit sale gets its receipt later, when a Receipt Entry pays it, and the receipt is still attached to the invoice. Open a section for the details.

## Where to find the printouts

The invoice and receipt PDFs are attached to the Sales Invoice. Find them under Attachments in the form's sidebar.

| Attachment | What it is |
|---|---|
| **SI-00016-09-2026-invoice….pdf** | The tax invoice, with a **RECEIPT INFO** block once the invoice is paid |
| **SI-00016-09-2026-receipt….pdf** | The receipt, when there is one |

- The PDFs are made again each time the invoice is saved, so they always match the invoice.
- **Print → Attach PDF** makes them again at any time.
- Printout PDFs are deleted automatically after **3 days** to save space. Click **Print → Attach PDF** to make them again.

## Cash sales: the receipt is automatic

A sale that is not a credit sale is paid at the counter. It is its own receipt, numbered RCPT- plus the invoice number.

Nothing extra is needed. When the invoice is saved, both PDFs are attached:

- the **receipt**, numbered after the invoice: **SI-00016-09-2026** gets **RCPT-00016-09-2026**. It shows the Applicant Name, amount, payment mode, and the token and service if there are any;
- the **invoice**, with a **RECEIPT INFO** block giving the same receipt number.

![The receipt for a cash sale](/assets/digitz_erp/images/help/cash-receipt.png)

The **RECEIPT INFO** block shows:

| Column | Comes from |
|---|---|
| Receipt Number | RCPT- plus the invoice number |
| Amount | The amount paid |
| Date | The invoice date |
| Collected By | The username of whoever created the invoice |
| Payment Mode | The invoice's payment mode, with the **Authorization Code** (Reference No) for a card payment |

![RECEIPT INFO at the bottom of the invoice](/assets/digitz_erp/images/help/invoice-receipt-info.png)

## Credit sales: add the receipt later

A credit sale has no receipt at first. When a Receipt Entry pays it, the receipt is attached to the invoice automatically.

1. **Submit the credit invoice** with **Credit Sale** ticked. Its invoice PDF has no RECEIPT INFO, and no receipt PDF is attached.
2. **When the customer pays**, create a **Receipt Entry**. It can be made by someone else, on another day:
   - choose the **Payment Mode**;
   - in **Receipt Entry Details**, add a row with the **Customer**, **Reference Type** *Sales Invoice* and the **Amount**;
   - click **Allocations** on the row and enter the **Paying Amount** against the invoice;
   - **Submit** the Receipt Entry.
3. **The invoice is updated for you.** For every submitted credit invoice the receipt pays:
   - **Allocated Receipt Entry** on the invoice shows the receipt's number (read-only);
   - the invoice PDF is made again with **RECEIPT INFO**: the Receipt Entry's number, the amount it paid on this invoice, its date, who created it, and its payment mode;
   - a **receipt PDF** is attached to the invoice next to it.

   The RECEIPT INFO block looks the same as for a cash sale, with the Receipt Entry's number in place of RCPT-….

You do not need to open or change the invoice. It stays submitted, and its receipt appears in its Attachments.

**Things to know:**

- One Receipt Entry can pay several credit invoices. Each gets its own receipt attached.
- Pay each credit invoice with **one** Receipt Entry. If two receipts pay the same invoice, the printout shows only the latest receipt and its amount.
- The invoice and the Receipt Entry are not linked to each other. **Allocated Receipt Entry** is only a record of the number.

## Cancelling the receipt

Cancel the Receipt Entry, and the invoice goes back to having no receipt.

When the Receipt Entry is cancelled, each credit invoice it paid is updated:

- **Allocated Receipt Entry** is cleared;
- the receipt PDF is removed;
- the invoice PDF is made again without RECEIPT INFO.

The invoice is unpaid again, and a new Receipt Entry can pay it.

## If a printout did not update

Click Print → Attach PDF on the invoice to make the PDFs again.

If submitting a Receipt Entry shows *The printout of SI-… could not be refreshed with this receipt*, the receipt itself was still saved and the payment counts. Only the PDFs were not made. Open that invoice and click **Print → Attach PDF**. The error is recorded in the **Error Log**.

Use **Attach PDF** too when the attachments were deleted after 3 days, or when you want a fresh copy.
