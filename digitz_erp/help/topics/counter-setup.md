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

1. Give their **User** the **Cashier** role. Give a billing lead **Cashier Approver** as well, and supervisors **Management**. See [Roles and who can do what](#roles-permissions).
2. Create a **Cashier** record for them. Tick **Is Supervisor** for shift leads who may approve differences and close days for others.
3. Give the **User** a **username** that matches the desk name the token service sends, so their tokens' invoices are raised in their name. See [How tokens become invoices](#token-sync).

![A Cashier record](/assets/digitz_erp/images/help/cashier-form.png)

Cashiers are automatically limited to **one login at a time**. Signing in elsewhere ends the older session. Users who also have System Manager or Management are not limited.

## 4. Register each counter PC

On each PC that takes money, either:

- **a supervisor** signs in on the PC, clicks the red **Unregistered device** badge, chooses the **Counter** and clicks **Register**. To create the counter at the same time, choose **+ New counter**; or
- **the cashier** signs in on the PC, clicks the badge and asks for a counter. A free counter is theirs at once. A counter that already has a PC needs a supervisor's approval (the badge shows **Approval pending**).

![The Register this device dialog](/assets/digitz_erp/images/help/register-device.png)

The PC is given a number such as DEV-0003. It is remembered in that browser (a cookie, plus a backup copy that restores the cookie if it is cleared).

**Things that make a PC unregistered again:**

- using a different browser or browser profile, or a private window;
- clearing *all* site data for this site in the browser;
- the Counter Device, or its Counter, being disabled;
- another PC or browser taking over the same counter.

Just register it again (or ask again). It gets a new number. See [How counter PCs are recognised](#counter-devices) for requests, approvals and replacing a PC.

### One device per counter

A counter has **one** registered device at a time. Registering a PC or browser to a counter disables the counter's other devices, and whatever that browser was registered as before. The dialog lists them before you click **Register**.

So use **one browser** on each counter PC. If a cashier opens another browser on the same PC, it shows *Unregistered device* and cannot bill. If you register that browser as well, the first one stops working.

A day open on a disabled device is not closed. The dialog warns about it, and the cashier carries on in the same day on the counter's new PC. See [How counter PCs are recognised](#counter-devices) for replacing a PC that has broken.

### Print invoices without the print dialog

In the Cashier Console, an invoice's **Print** menu has **Print Invoice** and **Print Receipt**, which send the PDF straight to the printer, and **Preview Invoice** and **Preview Receipt**, which show it in a popup first. The receipt entries appear for a cash sale, and for a credit sale once it has been paid. **Ctrl+P** prints the invoice, here and on the Sales Invoice form, and every print saves the invoice first. Browsers always show their print dialog unless Chrome is started for kiosk printing. To print with no dialog on a counter PC:

1. Right-click the Chrome shortcut the cashier uses, open **Properties**, and add ` --kiosk-printing` at the end of **Target** (after the closing quote).
2. Make the invoice printer the PC's **default printer** in Windows.
3. Print one invoice through the dialog first (start Chrome once without the flag) and set the paper size, margins, and **Headers and footers** off. Chrome keeps these settings.
4. Close every Chrome window and start Chrome from the shortcut again. The flag only takes effect on a fresh start.

Use that one shortcut and browser for the console, the same one the PC is registered in. Without the flag, **Print** still works but shows the usual print dialog.

## 5. Retire or replace a PC

Open **Counter Device** and find the PC by its number. The list shows its counter, when it was registered and when it was last seen. Open the record to see who registered it and from which browser, then untick **Enabled**. That browser immediately counts as unregistered. Only a System Manager can edit Counter Devices.

![The Counter Device list](/assets/digitz_erp/images/help/counter-device-list.png)

To replace a PC, just register the new one to the same counter. The old PC is disabled for you.

## 6. Where to find everything

The **Medical Center** workspace has the **Cashier Console** (Day Open, the Sales Invoice Board, Sales Invoices, Receipts, Day Close and Day History in one place), and cards for Counter Sessions, Counter Session Summary, Counter, Counter Device and Cashier. **Permissions Help** at the top shows what each role can do, and **Help Center** opens these pages.
