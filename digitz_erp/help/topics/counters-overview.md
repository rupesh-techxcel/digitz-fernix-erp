# How counters and days work

Every payment taken at the front desk belongs to a **counter**, a **counter PC** and a **cashier's day**. The system uses these three to work out, at any moment, how much cash should be in each till.

## The three pieces

| Piece | What it is | Example |
|---|---|---|
| **Counter** | A desk where money is taken. | Counter 1 |
| **Counter PC** (Counter Device) | A computer registered to a counter. The system gives it a number, because browsers cannot read a hardware id. | DEV-0001 |
| **Counter Session** (the "day") | One cashier's shift at one counter, from Day Open to Day Close. | CS-2026-00001 |

## A normal day

1. **Open the day.** Count the cash in the till (the *float*) and click **Open Day**. See [Opening your day](#day-open).
2. **Bill from the Cashier Console.** Patients' tokens arrive as draft invoices on its **Sales Invoice Board** tab, which updates by itself. Click **Open Invoice**, take payment and submit; the invoice opens in the console's **Sales Invoices** tab and leaves the board once submitted. **Sync Now** fetches new tokens at once. Every Sales Invoice, Sales Return, Receipt Entry and Expense Entry you save is stamped with your counter, your PC and your day.
3. **Close the day.** The system shows how much cash the till *should* hold. Count what it *does* hold and click **Close Day**. See [Closing your day](#day-close).

Billing is blocked until the day is open. Only cashiers are held to this. Supervisors and the automatic token sync are not.

## The counter badge

The coloured badge at the top of every page shows where you are and what to do next. Click it to go there.

![The counter badge in the top bar, here on an unregistered PC](/assets/digitz_erp/images/help/counter-badge.png)

| Badge | Meaning | Clicking it |
|---|---|---|
| 🟢 *Counter 1 · DEV-0001 · Day open since 09:02* | You are billing on an open day. | Opens Day Close |
| 🟠 *Counter 1 · DEV-0001 · Day not opened* | You must open the day before billing. | Opens Day Open |
| 🟠 *… · Close awaiting approval* | Your close had a difference and waits for a supervisor. | Opens Day Close |
| 🟠 *Approval pending · Counter 1* | A cashier asked to make this PC Counter 1's PC. That counter already has one, so a supervisor must approve. | Explains what is pending |
| 🔴 *Request rejected · Counter 1* | A supervisor rejected the request. | Cashiers can ask again |
| 🔴 *Unregistered device* | This PC is not a counter. Billing is blocked for cashiers. | Supervisors register it; cashiers ask for it |

A number next to the badge (supervisors only) counts the day closes and PC registration requests waiting for approval.

## How the expected cash is worked out

```
  Opening float
+ Cash sales            (cash Sales Invoices, not credit sales)
+ Cash receipts         (Receipt Entries: credit collections paid in cash)
− Cash refunds          (cash Sales Returns)
− Cash paid out         (Expense Entries paid in cash)
− Expenditure           (cash paid out of the till, entered at Day Close)
= Expected cash in the till
```

Only **submitted** documents whose **payment mode is Cash** count. Card and bank payments never touch the till. Drafts do not count until they are submitted.

## Rules worth knowing

- **One open day per counter.** A second cashier cannot open on a counter while someone else's day is open there. They take over with a [handover](#shift-handover).
- **One unfinished day per cashier.** You cannot open a new day while your last one is open or waiting for approval.
- **One login per cashier.** Signing in on another PC signs you out of the first one.
- **A day is closed only by counting the till.** The Counter Session form has no Submit button. Use the Day Close page.
