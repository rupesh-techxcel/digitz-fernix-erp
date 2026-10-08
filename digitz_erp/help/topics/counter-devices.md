# How counter PCs are recognised

This page explains how the system knows which counter a PC belongs to, how a PC is registered and approved, what happens when PCs, browsers or cashiers change, and how to recover when a PC breaks. For the basics, read [How counters and days work](#counters-overview) first.

## Two separate things: the PC and the day

Every payment at the front desk depends on two separate things.

| | **Counter registration** | **The cashier's day** (Counter Session) |
|---|---|---|
| Answers | *Which PC is this till's terminal?* | *Who is responsible for the cash in the till right now?* |
| Belongs to | One browser on one PC | One cashier on one **counter**, not on a PC |
| Lasts | Months, until the PC is replaced or disabled | One shift, from Day Open to Day Close |
| Set up by | A supervisor registers it, or a cashier asks for it | The cashier, with **Day Open** |
| Ended by | Disabling the Counter Device, or another PC taking over the counter | **Day Close** (or a supervisor's **Close for Cashier**) |

They depend on each other in one direction only:

- **Opening a day needs a registered PC.** Day Open is refused on a PC that is not a counter.
- **Opening or closing a day never changes the registration.** After Day Close, the PC is still the counter's PC, ready for the next day.
- **Changing the registration never closes a day.** A day left open when a PC is replaced carries on on the counter's new PC (see *Replacing a PC* below).

## How a PC is recognised

A web browser cannot read a PC's hardware id, and the clinic network gives out changing IP addresses. So the system does not try to recognise the *machine*. Instead it gives the **browser** a number when the PC is registered.

When a PC is registered:

1. A **Counter Device** record is created, such as **DEV-0007**, linked to the counter. It records who registered or asked for it, when, and from which browser.
2. A long random secret is created for that browser. The browser keeps it in two places:
   - a **cookie**, sent automatically with every request (it lasts ten years);
   - a **backup copy** in the browser's storage. If the cookie is ever cleared, the system restores it from this copy the next time the page loads.
3. The server keeps only a scrambled fingerprint (hash) of the secret. Nobody can copy the secret out of the database to pretend to be a counter PC.

From then on, **every** save is checked: the system reads the cookie, finds DEV-0007, and from that the counter. That is what is stamped on invoices, returns, receipts and expenses.

### What keeps the registration, and what loses it

| Keeps it | Loses it (the PC shows **Unregistered device**) |
|---|---|
| Logging out and in, any user | Using a **different browser** (Chrome vs Edge vs Firefox) |
| Restarting the PC | Using a different **browser profile**, or a **private / incognito** window |
| Updating the browser | Clearing **all** site data for this site, or reinstalling the browser |
| Clearing only cookies (the backup copy restores it) | The Counter Device, or its Counter, being **disabled** |
| | Another PC or browser **taking over the same counter** |

## Registering a PC

A PC is registered **on the PC itself**, by clicking the red **Unregistered device** badge at the top of the page. What happens next depends on who clicks it.

### A supervisor registers it

A supervisor's registration takes effect at once. No approval is needed.

1. Sign in on the PC as a supervisor and click the badge.
2. In **Register this device**, choose the **Counter**:
   - an existing counter, or
   - **+ New counter**. A name is suggested (the next number, such as *Counter 3*). Change it if you like. The counter is created and the PC registered to it in one step.
3. Click **Register**.

If the counter already has a PC, the dialog lists it before you click. It is disabled when you register (see *One device per counter*).

### A cashier asks for it

A cashier does not need a supervisor beside them to set up a PC.

1. The cashier signs in on the PC and clicks the badge.
2. In **Ask to register this PC**, they choose a counter. Each counter shows whether it is free:
   - *Counter 2 · free, ready at once*
   - *Counter 1 · has a PC (DEV-0001), needs approval*
3. They click **Ask**.

| The counter chosen | What happens |
|---|---|
| **Has no PC** | Approved **automatically**. The PC is the counter's PC at once and the badge turns blue (*Day not opened*). The device record notes *Approved automatically*. |
| **Already has a PC** | This PC would **take over** the counter, so the request waits for a supervisor. The badge shows **Approval pending · Counter 1** in orange. The old PC keeps working until the request is approved. |

Cashiers cannot create counters. A new counter is made by a supervisor, in **Register this device**.

### Approving and rejecting requests

Supervisors see waiting requests as a number next to the counter badge, added to any day closes waiting for approval. The number updates on every open page as soon as a request is made.

1. Click the badge. **PCs waiting for approval** lists each request: the counter, who asked and from which browser, and the PC it would replace. If a day is open on that PC, it says so.
2. Click **Approve** or **Reject**.

| Decision | Result |
|---|---|
| **Approve** | The requested PC becomes the counter's PC. The PC it replaces is disabled. A day open on the old PC carries on on the new one. The requesting PC's badge updates at once. |
| **Reject** | Give a reason, which is saved on the device record. The PC stays unregistered, and its badge shows **Request rejected · Counter 1**. The cashier can ask again. |

If the cashier asks again from the same PC, or a supervisor registers that PC directly, the earlier request is withdrawn automatically.

## One device per counter

A counter has **one** working device at a time. Whenever a PC becomes a counter's PC (registered by a supervisor, approved, or approved automatically), the system **disables**:

- the counter's other devices, and
- whatever this browser was registered as before, if it was on another counter.

A disabled device immediately counts as **Unregistered device**. Its record stays in **Counter Device** for history, and the documents billed on it keep its number. A System Manager cannot re-enable it while the counter has another working device.

## Several PCs and browsers

### Several PCs online at once

Only PCs where **cashiers bill** need to be registered. PCs used by accountants, managers or supervisors for other work do not.

| Situation | What to set up |
|---|---|
| Two cashiers billing at the same time, each with their own cash drawer | **Two counters**, one PC registered to each. |
| One desk, one drawer, cashiers taking turns | **One counter**, one PC. Change cashiers with [Close & Hand Over](#shift-handover). |
| A spare PC kept for emergencies | Do not register it until it is needed. Registering it takes over the counter. |

Rule of thumb: **one counter for each cash drawer.** Each counter's expected cash is worked out separately, so two drawers sharing one counter can never balance.

### The same PC, different browsers

The system cannot tell that two browsers are on the same PC. Each browser is a separate device.

- If only Chrome is registered and a cashier opens Edge, Edge shows **Unregistered device** and cannot bill. If they ask to register Edge to the same counter, the request needs a supervisor's approval, because it would take over from Chrome.
- If the request is approved, **Chrome stops working**, because a counter has one device.

**Use one browser on each counter PC.** A desktop shortcut that always opens that browser on the system helps. Reject requests from a second browser on the same PC unless the first one has stopped working.

### A cashier on a PC that is not their counter's

A cashier's day belongs to them, so it shows on **any** PC they sign in to. On a PC that is not their counter's, the Cashier Console shows **Day open on another PC**.

- They **cannot bill** there. Cash documents are saved only on a PC of the counter the day is open on.
- They **can close** their day there. Day Close works from any PC.

Cashiers can be signed in on only one PC at a time, so signing in here signed them out of their counter's PC.

## Replacing a PC, or a PC that has broken

Nothing is ever locked to a PC. To move a counter to another PC, on the **new PC**:

- **a supervisor** registers it to the same counter, which takes effect at once; or
- **the cashier** asks for the same counter, and a supervisor approves the request from any PC.

The old PC's device is disabled automatically. You do not need the old PC, and it does not need to be working.

**If a cashier's day is open** on the old PC, the dialogs say so, for example *Fatima's day CS-2026-00041 is open. It carries on on this PC.* Go ahead. The cashier signs in on the new PC and carries on billing **in the same day**. Nothing is lost, and the till does not need to be counted again.

> **Moving to a different cash drawer?** Close the day first. An open day keeps adding up the cash it expects, so if the new PC sits at another drawer, the expected cash would cover two drawers while only one is counted.

**If the old PC is being moved to a different counter** while a day is open on its old counter, that day loses its PC. The cashier can still close it from any PC, or another PC is registered to the old counter so they can carry on.

## Who is checked, and when

The check happens when a cash document is **saved**, not when someone logs in. Anyone can sign in on any PC and open forms and reports.

| User | Unregistered PC (or approval pending) | Registered PC, no open day | Registered PC, open day |
|---|---|---|---|
| **Cashier** | Cannot open a day. Cannot save cash documents. | Cannot save cash documents. Opens the day first. | Bills normally. Every document is stamped with the counter, the PC and the day. |
| **Supervisor** (System Manager, Management, or Cashier with *Is Supervisor*) | Can save. The document has no counter and no day. | Can save. The document has the counter and the PC, but no day. | Bills normally, stamped like a cashier. |
| **Background jobs** (token sync) | Never checked. | | |

The cash documents are **Sales Invoice, Sales Return, Receipt Entry** and **Expense Entry**.

> A supervisor's cash taken without an open day of their own belongs to no till, and no Day Close will account for it. Supervisors who take cash should open a day like a cashier.

## Who can do what

| Task | Who |
|---|---|
| Create a **Counter** in the Counter list, rename or disable one | System Manager |
| Create a counter while registering a PC (**+ New counter**) | Any supervisor |
| **Register** a PC (takes effect at once) | Any supervisor |
| **Ask** to register a PC | Any cashier |
| **Approve** or **reject** a request | Any supervisor |
| See the **Counter Device** list | System Manager, Management |
| Disable or edit a **Counter Device** by hand | System Manager |

## Checking the PCs

Open **Counter Device**. Each row shows the device number, its counter, whether it is enabled, its **Approval Status** (Approved, Pending or Rejected), when it was registered and when it was **last seen** (updated about every ten minutes while it is in use).

Open a record to see its full history:

| Section | What it shows |
|---|---|
| Main | Who registered it, when, and the browser it was registered from. |
| **Request** | The cashier who asked for it, and the supervisor who approved or rejected it, and when. *Approved / Rejected By* is empty when a request was approved automatically, and the timeline says so. |
| **Disabled** | Who disabled it and when, and **Replaced By**: the device that took over the counter. Shown only for a disabled device. |

The timeline at the bottom lists every change, including rejection reasons.

- A counter's **enabled** row is its PC. There is only ever one.
- A device not seen for days may be a PC that is no longer used.
- Each invoice, return, receipt and expense records its **Counter Device**, so you can always tell which PC it was saved on.

## Questions

**Can two PCs bill for the same counter?**
No. The second one taking over disables the first.

**Is a new counter created automatically when a new PC is set up?**
No. Every counter stands for a cash drawer, which the system cannot see, so a person decides. A supervisor creates one in a single step with **+ New counter** while registering the PC.

**Does a cashier's request always need a supervisor?**
Only when it would take over a counter that already has a PC. A request for a free counter is approved automatically.

**A PC was set up again, or its browser was reset. Is the old number still active?**
No, as soon as the PC is registered again (or its request approved). The new number disables the old one.

**Does closing the day free the PC for another counter?**
The PC is never held by a day. It can be registered to another counter at any time. The day is not closed by this, and the dialog warns about it first.

**Somebody saw "Counter 1" on a PC that is not Counter 1.**
That is the cashier's open day, which follows them to whatever PC they sign in to. The Cashier Console marks it **Day open on another PC**. They cannot bill there.

**Can the system recognise the PC itself rather than the browser?**
Not from a web browser. Use one browser per counter PC, and register only that one.

See also: [Setting up counters](#counter-setup) · [Supervisor tasks](#supervisor-tasks) · [Problems and messages](#counter-troubleshooting)
