# How counters and days work

▶ **[Watch the three-minute video](#counter-video)** of a day at the counter.

Every payment taken at the front desk belongs to a **counter**, a **counter PC** and a **cashier's day**. The system uses these three to work out, at any moment, how much cash should be in each till.

## The three pieces

| Piece | What it is | Example |
|---|---|---|
| **Counter** | A desk where money is taken. | Counter 1 |
| **Counter PC** (Counter Device) | A computer registered to a counter. The system gives it a number, because browsers cannot read a hardware id. | DEV-0001 |
| **Counter Session** (the "day") | One cashier's shift at one counter, from Day Open to Day Close. | CS-2026-00001 |

## A normal day

1. **Open the day.** Count the cash in the till (the *float*) and click **Open Day**. See [Opening your day](#day-open).
2. **Bill as usual.** Every Sales Invoice, Sales Return, Receipt Entry and Expense Entry you save is stamped with your counter, your PC and your day.
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
| 🔴 *Unregistered device* | This PC is not a counter. Billing is blocked for cashiers. | Supervisors can register it |

A number next to the badge (supervisors only) is the count of closes waiting for approval.

## How the expected cash is worked out

```
  Opening float
+ Cash sales            (cash Sales Invoices, not credit sales)
+ Cash receipts         (Receipt Entries: credit collections paid in cash)
− Cash refunds          (cash Sales Returns)
− Cash paid out         (Expense Entries paid in cash)
= Expected cash in the till
```

Only **submitted** documents whose **payment mode is Cash** count. Card and bank payments never touch the till. Drafts do not count until they are submitted.

## Rules worth knowing

- **One open day per counter.** A second cashier cannot open on a counter while someone else's day is open there. They take over with a [handover](#shift-handover).
- **One unfinished day per cashier.** You cannot open a new day while your last one is open or waiting for approval.
- **One login per cashier.** Signing in on another PC signs you out of the first one.
- **A day is closed only by counting the till.** The Counter Session form has no Submit button. Use the Day Close page.
