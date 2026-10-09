# How tokens become invoices

Reception issues each patient a **token** in the token service. The ERP pulls the new tokens about **once a minute** and raises a **draft Sales Invoice** for each, which then waits on the Cashier Console's **Sales Invoice Board**. Every token is recorded in **Medical Service Logs**, with what happened to it. Open a section for the details.

## Set it up

A System Manager sets three things: Settings, the Cashier records, and the Medical Services.

1. **Settings → Token URL**: the token service's address. **Enable Token Sync** turns the pull on or off. A Token URL pinned in the site's `site_config.json` (`token_url`) always wins and is put back after every update.
2. **Cashier**: one record per reception desk, linked to its **User**. The user must have a **username** that matches the desk name the token service sends. A disabled Cashier is skipped. With no enabled Cashier that has a username, nothing is pulled.
3. **Medical Services**: one record per service the token service can send (see below).

To test without the real service, see [Testing with simulated tokens](#token-simulator).

## Medical Services

Each service the token service sends is a Medical Service listing the items it bills.

- **Display Name** must match the service name the token service sends, exactly. The **Title** is tried if no Display Name matches.
- **Services** lists the items it bills and their quantities.
- The prices do **not** come from this list. Each item is priced like any invoice line: from the customer's price list, else the Item's own **Service Charge**, **Typing Charges**, **Transaction Charges** and **GOV** (see [Price lists](#price-lists)). Tax follows the Item.

A token for a service with no matching Medical Service, or one with no items, is **Skipped** with that reason.

## What the invoice gets

The invoice is raised as the desk's user, for today, as a draft.

| On the invoice | Comes from |
|---|---|
| **Customer** | The company for a token with a CompanyId, else the Default Walk-in Customer (see [Walk-in and corporate customers](#walk-in-customer)) |
| **Customer Display Name**, email, mobile | The patient on the token |
| **Customer Token**, **Medical Service** | The token |
| **Items** | The Medical Service's items, priced from the customer's price list |
| **Payment Mode** | The customer's Default Payment Mode, else the company's, else Card. Never a credit sale |
| **Owner** | The user whose username matches the token's desk; Administrator when none matches |

The cashier who opens it from the Board and bills it becomes its owner. See [Billing in the Cashier Console](#cashier-console).

## Medical Service Logs

One log per token: whether it became an invoice, and why not if it did not.

| Status | Meaning |
|---|---|
| **Completed** | The invoice was raised. **Sales Invoice** links to it. |
| **Skipped** | The token was valid but deliberately not invoiced. **Error Message** says why, for example no matching Medical Service, or no name and no company. Fix the cause, then send the token again. |
| **Failed** | Something went wrong. It is retried automatically on later runs, up to 5 times over 2 days. **Attempts** counts the tries. |
| **Pending** | Being processed, or interrupted. Retried like a failure. |

- **A token is never invoiced twice.** The same token sent again is recognised and ignored.
- Cashiers see only the logs of their own desk. System Managers see them all.

## Sync Now

The Board's **Sync Now** button pulls new tokens at once, instead of waiting for the next minute.

A popup reports how many invoices were created, skipped and failed. Open **Medical Service Logs** for the reasons.

If nothing arrives: check **Enable Token Sync**, the **Token URL**, that the desk's **Cashier** is enabled with a username, and that the scheduler is running.
