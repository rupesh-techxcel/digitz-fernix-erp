# Walk-in and corporate customers

Walk-ins are all billed to one **Default Walk-in Customer**, and you type the person's details on the invoice. Companies are **Corporate** customers, and their name and TRN are filled in for you. Open a section for the details.

## What prints on the invoice

Applicant Name, Company and TRN on the printout come from Customer Display Name, Customer Company and Tax Id.

| On the printout | Comes from the invoice field | Filled in by |
|---|---|---|
| **Applicant Name** | Customer Display Name | The customer's name when you pick a customer. The patient's name on a token invoice. You can change it. |
| **Company** | Customer Company | The Corporate customer (see below). Typed by you only on the walk-in customer. |
| **TRN** | Tax Id | The customer's Tax Id (see below). Typed by you only on the walk-in customer. |

**Company** and **TRN** print only when **Show Company In Printout** and **Show TRN In Printout** are ticked on the invoice. Both are unticked on a new invoice. The Receipt uses the same fields.

## Set up the Default Walk-in Customer

A System Manager creates one Customer for walk-ins and picks it in Settings → Default Walk-in Customer.

1. Create a Customer for walk-ins, for example *Walk-in Customer*. Set **Customer Type** to **Individual**.
2. Set its **Default Payment Mode** to **Cash**, and its **Default Price List** to the list walk-ins pay.
3. Go to **Settings**. In the **Sales Invoice** section, set **Default Walk-in Customer** to this customer and save.

![Default Walk-in Customer in Settings](/assets/digitz_erp/images/help/walk-in-settings.png)

## Change the walk-in customer

Pick another customer in Settings. New invoices use it at once; saved invoices keep theirs.

- New invoices and new token invoices use the new customer straight away.
- Saved and submitted invoices keep the customer they were made with.
- Draft invoices on the old customer now behave like any other customer. When they are saved, their Customer Company and Tax Id are replaced with the old customer's own, which is usually blank.

Clear the field to stop using a walk-in customer. Token invoices then create one Customer per patient name instead.

## Bill a walk-in

Pick the walk-in customer, then type the person's name and, if needed, their company and TRN.

1. Pick the walk-in customer in **Customer**.
2. Change **Customer Display Name** to the person's name. This is the **Applicant Name** on the printout.
3. If the person wants a company on the invoice, type it in **Customer Company**, and the company's TRN in **Tax Id**. Tick **Show Company In Printout** and **Show TRN In Printout**.
4. Enter the mobile number if needed, then save as usual.

![A new invoice for the walk-in customer, with Customer Display Name and Customer Company to fill in](/assets/digitz_erp/images/help/walk-in-invoice.png)

On the walk-in customer, **Customer Company** and **Tax Id** start empty and stay as you typed them. After the invoice is submitted they cannot be changed.

## Corporate customers

A Corporate customer's own name and Tax Id become the invoice's Company and TRN.

Set **Customer Type** to **Corporate** for a company you bill regularly. Enter its **Tax Id** (TRN).

![A Corporate customer with its Tax Id](/assets/digitz_erp/images/help/corporate-customer.png)

When you pick a Corporate customer on an invoice:

- **Customer Company** is the Corporate customer's **Customer Name**.
- **Tax Id** is the Corporate customer's Tax Id.
- **Applicant Name** starts as the company's name. Change **Customer Display Name** to the person the service is for.

A Corporate customer can also have a **Discount** %, applied to token invoices billed to it. The **Company ID** is assigned by the system and matches the company in the token service.

## People who belong to a company

Link an Individual to a Corporate customer, and their invoices show that company and its TRN.

Open the Individual customer and pick the company in the **Corporate** field. Only Corporate customers can be picked there.

![An Individual customer linked to a company in the Corporate field](/assets/digitz_erp/images/help/linked-person.png)

When you invoice that person:

- **Customer Company** is the linked company's name.
- **Tax Id** is the person's own Tax Id if they have one. Otherwise it is the company's.
- **Applicant Name** is the person's name.

A Corporate customer cannot itself be linked to another company.

## Why Company and Tax Id cannot be edited

Except on the walk-in customer, they always come from the Customer record. Fix them there.

On every customer except the walk-in customer, **Customer Company** and **Tax Id** are read-only on the invoice. They are set again from the customer each time the invoice is saved.

To correct them, fix the **Customer** record (its name, Tax Id or Corporate link), then open the draft invoice, pick the customer again and save.

## Invoices from tokens

Tokens with a CompanyId bill that company; the rest bill the walk-in customer, with the patient's name as Applicant Name.

| The token has | The invoice is billed to | Applicant Name |
|---|---|---|
| A **CompanyId** | The Corporate customer with that Company ID. It is created if it does not exist yet, and its Discount is applied. | The patient's name from the token |
| No CompanyId | The Default Walk-in Customer | The patient's name from the token |
| No CompanyId, and no walk-in customer set | A Customer with the patient's name, created if needed | The patient's name |

The patient's name, email and mobile stay on a token invoice even if you change its Customer.

See also: [Setting up counters](#counter-setup) for default payment modes per customer, and [Testing with simulated tokens](#token-simulator).
