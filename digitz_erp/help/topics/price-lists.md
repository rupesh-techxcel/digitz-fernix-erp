# Price lists

Every item has a normal price. A **price list** gives chosen customers different prices, for example a typing centre that pays less. Open a section for the details.

## How an invoice gets its prices

The customer's Default Price List prices each line. Items not in that list use the Item's own charges.

When you pick a customer on a Sales Invoice, **Price List** is set to the customer's **Default Price List**. Then, for each item, the price comes from the first of these that exists:

1. a price for the item in that list **with dates covering the invoice date**;
2. the item's **undated** price in that list;
3. the **Service Charge**, **Typing Charges** and **GOV** on the Item itself.

The line's **Rate** is Service Charge + Typing Charges + GOV. VAT is charged on the Service Charge and Typing Charges only, never on GOV.

- Only selling price lists can be picked on an invoice.
- Changing **Price List** on a draft re-prices every line. Picking an item prices that line. Changing the date does not re-price, so pick the price list again after changing the date.
- You can still change a line's charges by hand on a draft.
- If an orange message says an item *has only a rate in price list …*, that price has no charges entered. The Item's charges were used instead. Fix the price in the Price List Manager.

## Standard Selling and the Item

**Standard Selling** holds each item's normal price. It always matches the charges on the Item.

- Change Service Charge, Typing Charges or GOV on the **Item**, and its undated Standard Selling price changes to match.
- Change the undated Standard Selling price, and the **Item**'s charges change to match.
- Dated prices in Standard Selling are temporary. They never change the Item.

New customers get Standard Selling as their Default Price List.

## Open the Price List Manager

Go to the Medical Center workspace and click Price List Manager. System Managers and Management can use it.

![The Price List Manager](/assets/digitz_erp/images/help/price-list-manager.png)

- **Left:** every price list, marked **Selling** or **Buying**, with the number of items in it. Search to find one.
- **Right:** the items in the selected list with their charges, rate and dates. Search to find an item. Each row has **Edit** and **Delete**.

## Create a price list

Click New Price List, type a name and keep Is Selling ticked.

Tick **Is Selling** for a list used on invoices. Only selling lists can be picked on a Sales Invoice or as a customer's Default Price List.

The new list is empty. Add the items whose price is different. Items you leave out are charged at their normal Item price.

## Add or change an item's price

Select the list, click Add Item, pick the item and adjust its charges. The rate is their sum.

1. Select the price list on the left, then click **Add Item**.
2. Pick the **Item**. Its Service Charge, Typing Charges, GOV, Unit and Currency are filled in from the Item.
3. Change the charges for this list. **Rate** is worked out as their sum.
4. Leave **From Date** and **To Date** empty for a price that always applies.
5. Click **Add**.

![The Add / Edit price dialog](/assets/digitz_erp/images/help/price-list-add-item.png)

To change a price, click **Edit** on its row. To remove it, click **Delete**. Invoices then use the Item's charges for that item again.

Always enter the charges, not just a Rate. A price with only a Rate cannot be split into taxable and non-taxable parts, so invoices ignore it and use the Item's charges.

**Rules the system checks:**

- one undated price per item in each list;
- dated prices for the same item and list cannot overlap;
- enter both dates or neither;
- no negative amounts.

## Temporary prices

Add a second price for the item with a From and To Date. It is used for invoices dated inside that range.

For example, an offer for October: add the item again with From Date 01-10 and To Date 31-10. Invoices dated in October use the offer. Before and after, they use the undated price.

The undated price stays as it is. When the dates pass, you can delete the dated price or leave it.

## The Discount column

For a selling list other than Standard Selling, each price shows how far it is below the normal price.

| Column | Meaning |
|---|---|
| **Standard** | The item's normal price in Standard Selling |
| **Discount** | Standard less this list's rate, and the percentage. Green is a discount. Red *(… above)* means this list charges more. |

The line under the list name gives the **average discount** across its items. The Add and Edit dialogs show the same discount while you type.

## Give a customer a price list

Set Default Price List on the Customer. Their invoices, including token invoices, then use it.

1. Open the **Customer**.
2. Set **Default Price List** and save.

![Default Price List on a customer](/assets/digitz_erp/images/help/customer-price-list.png)

- New invoices for the customer start with this list. The cashier can change **Price List** on a draft.
- **Token invoices** use the Default Price List of the customer they are billed to. That is the Corporate customer for a token with a CompanyId, and the Default Walk-in Customer for the rest. See [Walk-in and corporate customers](#walk-in-customer).
- A customer with no Default Price List is charged the Item's own charges.
