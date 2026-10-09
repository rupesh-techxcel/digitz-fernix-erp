# Roles and who can do what

What a person can do depends on their **roles**, given on their **User**. A person can hold more than one. The **Permissions Help** button on the Medical Center workspace shows the full table, record by record. Open a section for the details.

## The roles

Four roles run the Medical Center. Give each person only the ones they need.

| Role | For | In short |
|---|---|---|
| **Cashier** | Counter staff | Opens and closes their day, bills today's invoices, takes payment, collects credit payments, adds customers. Never cancels, never changes prices or masters. |
| **Cashier Approver** | A billing lead | Sees every counter's invoices and can cancel, amend and delete them. Give it **with** Cashier: on its own it reaches nothing but invoices. |
| **Management** | Supervisors | Approves cash differences and counter PCs, closes days for others, manages price lists. |
| **System Manager** | Setup and oversight | Manages customers, items, prices, services, counters, settings and users. Reads every invoice but does not change them. |

Report Manager, Workspace Manager, Dashboard Manager and Prepared Report User are also offered, for building reports, workspaces and dashboards.

## Who is a supervisor

System Manager, Management, or a Cashier record marked Is Supervisor.

A supervisor can approve cash differences, approve and register counter PCs, close another cashier's day, and bill without opening a day or on another day's invoice. **Cashier Approver is not a supervisor**: it cannot do any of these. See [Supervisor tasks](#supervisor-tasks).

To make a cashier a shift lead without the Management role, tick **Is Supervisor** on their **Cashier** record.

## Rules that apply to cashiers

These hold for anyone with Cashier who is not a supervisor.

- **Today only.** They save and submit only invoices dated today.
- **Open day, registered PC.** Billing is blocked until they open the day on a registered counter PC.
- **One session.** Signing in on another PC signs them out of the first.
- **Their own list.** The Sales Invoice list and the token logs show only what they own. The **Sales Invoice Board** shows every counter's drafts for today, and billing one makes it theirs.

See [Billing in the Cashier Console](#cashier-console).

## Roles you will not see

Roles the Medical Center never uses are switched off and hidden.

Accounts, Sales, Purchase, Stock and Item roles, Tab User, Maintenance, Website, Blog, Newsletter, Knowledge Base, Inbox and Translator are disabled. They do not appear in the User form's role list or in Role Permission Manager. The **Role** list opens on the enabled roles; clear its filter to see the rest.

A role that someone still holds is left switched on, so nobody loses access on an update.

## Changing permissions

Ask a developer. Changes to the cashier roles in Role Permission Manager do not last.

The permissions of **Cashier** and **Cashier Approver** ship with the app and are set again on every update. A change made to them by hand in **Role Permission Manager** is undone at the next update.
