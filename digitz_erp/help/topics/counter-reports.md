# Reports and the dashboard

## Day Close Slip

This is printed from Day Close after closing, or from any Counter Session with **Print → Day Close Slip**. It shows:

- the counter, PC, cashier, and opening and closing times;
- the previous close and the opening float;
- each cash movement, the expected cash, the counted cash and the difference;
- the opening and closing note-by-note counts;
- remarks, who closed the day if a supervisor did, and who approved a difference;
- signature lines for the cashier and supervisor.

## Counter Session Summary

**Report → Counter Session Summary** (System Manager and Management) lists every day in a date range, one row per session.

![The Counter Session Summary report](/assets/digitz_erp/images/help/session-summary.png)

| Filter | Use |
|---|---|
| From / To Date | By the day's opening date. Defaults to this month. |
| Counter, Cashier | Narrow it to one desk or one person. |
| Status | Open, Closing (waiting for approval) or Closed. |

The columns are the float, each cash movement, expected, counted, **difference** (highlighted when not zero), **Closed By** and **Approved By**.

Useful views:

- **Status = Closing**: differences still waiting for a supervisor.
- **Status = Open**: days not closed yet. Check these at the end of the day.
- **Filter by Cashier** over a month: a cashier's pattern of shortages.

## Medical Center Dashboard

The **Counters** panel on the Medical Center Dashboard shows one card per counter, refreshed live:

![The Counters panel on the Medical Center Dashboard](/assets/digitz_erp/images/help/dashboard-counters.png)

| Card shows | Meaning |
|---|---|
| **Day open** (green) | Cashier, time opened, **cash in till now** and float |
| **Awaiting approval** (amber) | Counted, waiting for a supervisor |
| **Closed** (grey) | Counted cash and whether it balanced, or was short or over |
| **Not opened** | No day today |
| Footer | Invoices submitted on this counter today and their total, plus the number of PCs and when one was last seen |

Click a card to open its Counter Session.

The **Open Counters** tile counts counters with a day open. When closes are waiting, supervisors also see an amber **closes awaiting approval** pill at the top, which leads to Day Close.

Cashiers see only their own counter and figures.
