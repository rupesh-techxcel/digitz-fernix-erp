# Testing with simulated tokens

The **token simulator** stands in for the external token service, so the token sync can be tested without it. You create tokens in the desk. The sync fetches them from the simulator exactly as it would from the real service and raises the Sales Invoices.

It works only on sites in **developer mode**, or where `site_config.json` has `"token_simulator_enabled": 1`. Everywhere else the simulator answers with an error.

## Set it up (once)

1. Open **Test Token** (search for it in the awesome bar).
2. In the list's menu (**⋯**), click **Use Simulator URL** and confirm. This:
   - sets **Settings → Token URL** to the simulator, for example
     `http://127.0.0.1:8508/api/method/digitz_erp.api.token_simulator.feed`;
   - turns on **Enable Token Sync**;
   - remembers the Token URL you had before, so **Restore Token URL** can put it back.

The banner above the list says whether everything is connected.

![The Test Token list with the simulator banner](/assets/digitz_erp/images/help/test-token-list.png)

> On a bench with several sites, `127.0.0.1` reaches only the **default site**. For another site the URL uses the site's own name, which must resolve on the server. Add it to `/etc/hosts` if it does not.

## Make tokens

**Generate Test Tokens** adds up to 50 tokens dated now. They are spread over the services and over every Cashier that has a username, and a share of them are billed to existing company customers.

To test one case exactly, click **+ Add Test Token**:

| Field | Sent to the sync as | Notes |
|---|---|---|
| Token Number | `TokenNumber` | Empty gives the next number of the day. Text such as `T-104` is allowed. |
| Patient Name | `Name` | |
| Service | `Service` | Sent as the service's **Display Name**, as the real service does. |
| Cashier | `UserName` | The user's **username**. The invoice is raised as this cashier. |
| Created Date | `CreatedDate` | Must be **today**, and later than the last token the sync has already seen. |
| Company / Company ID | `CompanyId` | Billed to that company. An unknown id tests automatic company creation. Empty means a walk-in. |
| Contact & personal details | `Email`, `Mobile`, `Gender`, … | Optional. |

## Run the sync

- **Sync Now** on the Test Token list or on a token runs it at once and shows the result popup.
- Otherwise the scheduler picks the tokens up within a minute.

Open a token afterwards: the banner at the top shows its **Medical Service Log** and **Sales Invoice**, or why it was skipped or failed.

## Things to know

- **A token is fetched once.** The sync asks only for tokens *after* the last one it stored today. Editing a token that has already been fetched does nothing. To test again, add a new token.
- **Re-sending the same token** (same number, service, name, application number and day) is recognised as *Already invoiced*. That is how you test duplicate protection.
- **Tokens from another day are never fetched**, because the sync reads one day at a time.
- **The payment mode** of a token invoice is the customer's **Default Payment Mode**, else the company's, else **Card**, the same as on the Sales Invoice form. A token invoice is never a credit sale. A Cash token invoice is saved without a Received Amount, and the cashier enters it when saving or submitting. See [Setting up counters](#counter-setup).
- **A token without Mobile or WhatsApp,** when Settings makes the mobile number mandatory, gets the placeholder **0000** on its invoice. The draft is saved, but it cannot be submitted until the cashier enters the real number. The form shows an orange banner until then.
- **Cleaning up:** deleting Test Tokens does not delete the invoices or logs they produced.
- **When you are done,** use **Restore Token URL**, and turn token sync off in Settings if the real service is not in use.
