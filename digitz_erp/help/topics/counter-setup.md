# Setting up counters

This is done once. A **System Manager** creates the counters and manages PCs. Any supervisor can register a PC (step 4).

## 1. Create the counters

Go to **Counter**, then **+ Add Counter**, and enter a name such as *Counter 1*. Leave **Enabled** ticked.

Untick **Enabled** to take a counter out of use. Its PCs then count as unregistered.

## 2. Mark cash payment modes

The till only counts documents whose **Payment Mode** has **Mode** set to **Cash**. Open each Payment Mode and check the setting:

| Payment Mode | Mode |
|---|---|
| Cash | **Cash** |
| Card, Bank Transfer, … | Card / Bank / Other |

If a cash payment mode is not marked **Cash**, those payments are missing from the expected cash, and every close will be short.

### Default payment mode per customer

A new invoice starts with the customer's **Default Payment Mode** (on the Customer, under Default Price List). When the customer has none, it uses **Company → Default Payment Mode for Sales**. The same applies on the Sales Invoice form, to invoices raised from tokens, and to imported invoices. Token invoices use **Card** only if neither is set.

For example, set Cash on the walk-in customer and Card on a typing centre that pays by card. The cashier can still change the mode on the invoice.

An invoice never starts as a **Credit Sale**. The cashier ticks it when a sale is on credit.

For a **Cash** mode, the invoice asks for the **Received Amount** (the cash handed over) before it can be saved or submitted. It must cover the invoice total.

## 3. Set up the cashiers

For each person who takes money:

1. Give their **User** the **Cashier** role.
2. Create a **Cashier** record for them. Tick **Is Supervisor** for shift leads who may approve differences and close days for others.

![A Cashier record](/assets/digitz_erp/images/help/cashier-form.png)

Cashiers are automatically limited to **one login at a time**. Signing in elsewhere ends the older session. Users who also have System Manager or Management are not limited.

## 4. Register each counter PC

On each PC that takes money:

1. Sign in as a supervisor.
2. Click the red **Unregistered device** badge. Choose the **Counter** and click **Register**.

![The Register this device dialog](/assets/digitz_erp/images/help/register-device.png)

The PC is given a number such as DEV-0003. It is remembered in that browser (a cookie, plus a backup copy that restores the cookie if it is cleared).

**Things that make a PC unregistered again:**

- using a different browser or browser profile, or a private window;
- clearing *all* site data for this site in the browser;
- the Counter Device, or its Counter, being disabled.

Just register it again. It gets a new number.

## 5. Retire or replace a PC

Open **Counter Device** and find the PC by its number. The list shows its counter, when it was registered and when it was last seen. Open the record to see who registered it and from which browser, then untick **Enabled**. That browser immediately counts as unregistered. Only a System Manager can edit Counter Devices.

![The Counter Device list](/assets/digitz_erp/images/help/counter-device-list.png)

Registering a PC again does not disable its old number. Disable the old one yourself.

## 6. Where to find everything

The **Medical Center** workspace has shortcuts to Day Open, Day Close, Counter Sessions, Counter Session Summary, Counter, Counter Device and Cashier.
