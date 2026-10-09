# Problems and messages

## "Unregistered Device": *This device is not registered as a counter*

This PC is not a counter, so a cashier cannot save cash documents on it.

![Day Open on a PC that is not a registered counter](/assets/digitz_erp/images/help/day-open.png)

- **New PC, or a new browser or profile on it?** A supervisor registers it. See [Setting up counters](#counter-setup).
- **It worked yesterday?** The browser's data may have been cleared, the device or counter was disabled, or another PC or browser was registered to the same counter (a counter has one device). Reload once with Ctrl+Shift+R. If the badge is still red, a supervisor registers it again.

## *Approval pending · Counter 1*

You asked for this PC to become Counter 1's PC, and Counter 1 already has one. A supervisor must approve it. The badge turns blue as soon as they do. You do not need to reload. Until then, bill on Counter 1's current PC.

## *Request rejected · Counter 1*

A supervisor rejected your request. Ask them why. Click the badge to ask again.

## Cashier Console: *Day open on another PC*

Your day is open on a different counter's PC. Your day follows you to any PC you sign in to, but you can bill only on its counter's PC. Go back to that PC, or close the day here. If that PC has broken, a supervisor registers this PC to your counter and you carry on. See [How counter PCs are recognised](#counter-devices).

## "Day Not Opened": *Open the day on Counter 1 before billing*

You have no open day on this counter. Click the badge and open the day. See [Opening your day](#day-open).

If you **do** have an open day, it is on a **different counter**. Close that one first.

## "Not Today's Invoice": *… is dated … A cashier can save and submit only today's invoices*

Cashiers bill only invoices dated today. An invoice from another day opens read-only in the Cashier Console, and its date cannot be changed. Ask a supervisor to handle it. See [Supervisor tasks](#supervisor-tasks).

## A draft from yesterday is not on the Sales Invoice Board

The Board lists today's drafts only. Older ones are in the **Sales Invoice** list for a supervisor. See [Supervisor tasks](#supervisor-tasks).

## Print did nothing

Print saves the invoice first. If the save was stopped, for example by a missing field or the *Not Today's Invoice* message, nothing prints: fix what the message says and print again. *Items are required before printing* means the invoice has no items yet.

## *Counter 1 is in use* / *already has a day open by …*

Another cashier's day is still open on this counter.

- They are still here: they use **Close & Hand Over**. See [Handing over a counter](#shift-handover).
- They have left: a supervisor uses **Close for Cashier**. See [Supervisor tasks](#supervisor-tasks).

## *You already have an unfinished day*

Your previous day is still open, or waiting for approval. Close it, or ask a supervisor to approve it.

## *Logged In From Another Session*

Cashiers can be signed in on only one PC at a time. Signing in on another PC ended this one. Sign in again here if this is where you are working.

## *A day is closed by counting the till on the Day Close page*

Someone tried to submit a Counter Session from its form. Days are closed only from **Day Close**, so that a count is always recorded.

## The expected cash looks wrong

- **Too low?** A cash invoice may still be a **draft**. Submit it. Also check that its Payment Mode's **Mode** is **Cash**.
- **Too high?** A refund or expense paid from the till may not have been entered, or was entered as non-cash.
- Click each line in **Cash for the Day** to see exactly which documents are counted.

## A closed day has the wrong count

A closed day cannot be edited. A System Manager can:

1. open the Counter Session and click **Cancel**;
2. click **Amend**, correct the count and remarks, then **Save** and **Submit**.

The amended copy (such as CS-2026-00012-1) replaces the cancelled one in reports. It does not block the counter.

## The badge does not update

Reload the page. The badge is read when the desk loads, and after you open or close a day.
