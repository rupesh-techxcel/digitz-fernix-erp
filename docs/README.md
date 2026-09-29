# Digitz ERP documentation

User guides live **inside the app** and are shown in the desk Help Center
(**Help → Help Center**, or `/app/digitz-help`), so users always read the version
that matches the code they run.

| Where | What |
|---|---|
| `digitz_erp/help/topics.json` | Index: groups, topic order, titles, summaries and search keywords |
| `digitz_erp/help/topics/<name>.md` | One guide per file, in Markdown (tables and fenced code are supported) |
| `digitz_erp/api/help_api.py` | Serves the index and renders a topic to HTML |
| `digitz_erp/digitz_erp/page/digitz_help/` | The Help Center page |

## Adding a guide

1. Write `digitz_erp/help/topics/<name>.md`, starting with a `# Title`.
2. Add `{"name", "title", "summary", "keywords"}` to a group in `topics.json`
   (or add a new group). The order there is the order in the sidebar and of
   Previous / Next.
3. Link to other guides with `[text](#other-topic-name)`.
4. To open a guide from a page or form, route to it:
   `frappe.set_route("digitz-help", "<name>")`.

No build or migrate is needed for text changes. Reload the page.

## Current guides

**Counters & Cash**: counters-overview, day-open, day-close, shift-handover,
supervisor-tasks, counter-setup, counter-reports, counter-troubleshooting.

**Token Sync**: token-simulator.

**Customers & Invoicing**: walk-in-customer, price-lists, invoice-receipts.

**Reports**: medical-center-reports.
