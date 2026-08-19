frappe.pages['Sales Invoice Board'].on_page_load = function(wrapper) {
  const page = frappe.ui.make_app_page({
    parent: wrapper,
    title: 'Sales Invoice Board',
    single_column: true
  });

  const $wrapper = $(wrapper);

  $wrapper.find('.layout-main-section').html(`
    <div class="post-table-wrapper">
      <div id="post-table" class="table-responsive"></div>
    </div>
  `);

  const tableContainer = $wrapper.find('#post-table');

  function fetchAndRenderData() {
    console.log("Fetch Sales invoice data");
    frappe.call({
      method: "frappe.client.get_list",
      args: {
        doctype: "Sales Invoice",
        fields: ["name", "customer", "customer_token", "posting_date"],
        filters: {
          docstatus: 0
        },
        order_by: "creation desc",
        limit_page_length: 100
      },
      callback: function(r) {
        if (r.message) {
          renderTable(r.message);
        } else {
          tableContainer.html('<p>No data found.</p>');
        }
      }
    });
  }

  function renderTable(data) {
    let html = `
      <table class="table table-bordered">
        <thead>
          <tr>
            <th>ID</th>
            <th>Customer Name</th>
            <th>Date</th>
            <th>Token</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
    `;

    data.forEach(invoice => {
      html += `
        <tr>
          <td>${invoice.name}</td>
          <td>${invoice.customer}</td>
          <td>${invoice.posting_date}</td>
          <td>${invoice.customer_token || ''}</td>
          <td>
            <button class="btn btn-sm btn-primary create-invoice-btn" data-id="${invoice.name}">
              Open Invoice
            </button>
          </td>
        </tr>
      `;
    });

    html += `</tbody></table>`;
    tableContainer.html(html);
  }

  $wrapper.off('click', '.create-invoice-btn').on('click', '.create-invoice-btn', function() {
    const invoiceName = $(this).data('id');
    frappe.set_route('Form', 'Sales Invoice', invoiceName);
  });

  fetchAndRenderData();

  if (window.__sales_invoice_board_fetch_interval) {
    clearInterval(window.__sales_invoice_board_fetch_interval);
  }

  if (window.__sales_invoice_board_token_interval) {
    clearInterval(window.__sales_invoice_board_token_interval);
  }

  window.__sales_invoice_board_fetch_interval = setInterval(fetchAndRenderData, 4000);
  window.__sales_invoice_board_token_interval = setInterval(fetch_token_list, 20000);
};

async function fetch_token_list() {
  const LOCK_KEY = "__sales_invoice_board_sync_running";
  const LOCK_STARTED_KEY = "__sales_invoice_board_sync_started_at";
  const MAX_LOCK_MS = 90 * 1000;

  const now = Date.now();
  const existingStartedAt = window[LOCK_STARTED_KEY] || 0;

  if (window[LOCK_KEY] && existingStartedAt && (now - existingStartedAt > MAX_LOCK_MS)) {
    console.warn("Stale sync lock detected. Force releasing old lock.");
    window[LOCK_KEY] = false;
    window[LOCK_STARTED_KEY] = null;
  }

  if (window[LOCK_KEY]) {
    console.log("fetch_token_list skipped: previous sync still running");
    return;
  }

  window[LOCK_KEY] = true;
  window[LOCK_STARTED_KEY] = now;

  console.log("Fetching API DATA...");

  try {
    const userResp = await frappe.call({
      method: "frappe.client.get",
      args: {
        doctype: "User",
        name: frappe.session.user
      }
    });

    if (userResp && userResp.message && userResp.message.username) {
      await run_with_timeout(
        handleToken(userResp.message.username),
        MAX_LOCK_MS,
        "Token sync exceeded allowed time window"
      );
    }
  } catch (error) {
    console.error("API fetch error:", error);
  } finally {
    window[LOCK_KEY] = false;
    window[LOCK_STARTED_KEY] = null;
  }
}

async function handleToken(username) {
  const url = await frappe.db.get_single_value('Settings', 'url');

  if (!url) {
    frappe.throw("Please add url in Service URL to get new tokens");
    return;
  }

  const today = frappe.datetime.get_today();
  const start = `${today} 00:00:00`;
  const end = `${frappe.datetime.add_days(today, 1)} 00:00:00`;

  const logs = await frappe.db.get_list('Medical Service Logs', {
    fields: ['created_date', 'token_number', 'name', 'api_response'],
    filters: [
      ['added_on', '>=', start],
      ['added_on', '<', end]
    ],
    order_by: 'created_date desc, token_number desc',
    limit: 1
  });

  let secondApiUrl = `${url}?username=${encodeURIComponent(username)}`;
  let current_date = frappe.datetime.get_today();
  let added_on = `${current_date}T00:00:00.0000000`;
  let token_number = 0;

  if (logs && logs.length > 0) {
    let responseData = {};

    try {
      responseData = JSON.parse(logs[0].api_response || '{}');
    } catch (e) {
      console.warn("Invalid api_response JSON in Medical Service Logs:", logs[0].name, e);
      responseData = {};
    }

    if (responseData.CreatedDate && typeof responseData.CreatedDate === "string") {
      const parts = responseData.CreatedDate.split('.');
      let fractionalPart = parts[1] || '';

      if (fractionalPart.length >= 7) {
        fractionalPart = fractionalPart.substring(0, 7);
      } else {
        fractionalPart = fractionalPart.padEnd(7, '0');
      }

      added_on = `${parts[0]}.${fractionalPart}`;
    }

    token_number = logs[0].token_number || 0;
  }

  secondApiUrl = `${secondApiUrl}&timestamp=${encodeURIComponent(added_on)}&last_token_no=${encodeURIComponent(token_number)}`;
  console.log("Second API URL:", secondApiUrl);

  const body = await fetch_json_with_timeout(secondApiUrl, 30000);
  console.log("Token verified successfully.");
  console.log(body);

  if (!Array.isArray(body) || body.length === 0) {
    return;
  }

  for (const item of body) {
    try {
      const log_name = await create_medical_service_log(item);
      await create_sales_invoice_with_customer_async(item, log_name);
    } catch (err) {
      console.error("Error while processing token item:", item, err);
    }
  }
}

async function create_medical_service_log(data) {
  console.log(data);

  try {
    const existing_log = await frappe.call({
      method: "frappe.client.get_value",
      args: {
        doctype: "Medical Service Logs",
        filters: {
          customer_name: data.Name,
          token_number: data.TokenNumber,
          service: data.Service
        },
        fieldname: "name"
      }
    });

    if (existing_log.message && existing_log.message.name) {
      console.log(existing_log.message.name);
      console.log("Received response from Medical service logs", existing_log.message.name);
      return existing_log.message.name;
    }

    console.log("Creating new log");
    const new_log = await frappe.call({
      method: "frappe.client.insert",
      args: {
        doc: {
          doctype: "Medical Service Logs",
          customer_name: data.Name,
          token_number: data.TokenNumber,
          service: data.Service,
          status: "Pending",
          api_response: JSON.stringify(data),
          created_date: data.CreatedDate,
          added_on: frappe.datetime.now_datetime()
        }
      }
    });

    if (new_log.message) {
      console.log("API Call", new_log.message);
      return new_log.message.name;
    }

    throw new Error("Medical Service Log creation failed: no response message returned");
  } catch (err) {
    console.error("Error in create_medical_service_log:", err);
    throw err;
  }
}

function fetch_json_with_timeout(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, {
    method: "GET",
    signal: controller.signal
  })
    .then(async (response) => {
      let data = null;

      try {
        data = await response.json();
      } catch (e) {
        throw new Error(`Invalid JSON response from API. Status: ${response.status}`);
      }

      if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}`);
      }

      return data;
    })
    .finally(() => {
      clearTimeout(timeoutId);
    });
}

function run_with_timeout(promise, timeoutMs, message = "Operation timed out") {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    })
  ]);
}

function create_sales_invoice_with_customer_async(data, log_name) {
  return new Promise((resolve, reject) => {
    try {
      create_sales_invoice_with_customer(data, log_name, resolve, reject);
    } catch (err) {
      reject(err);
    }
  });
}

function create_sales_invoice_with_customer(data, log_name, resolve, reject) {
  console.log("Checking for customer", data.Name);

  if (data.CompanyId !== undefined && data.CompanyId !== null && data.CompanyId !== '') {
    console.log("Company id found, checking for customer with company id", data.CompanyId);

    frappe.call({
      method: "frappe.client.get_list",
      args: {
        doctype: 'Customer',
        filters: { company_id: data.CompanyId },
        fields: ['name', 'discount'],
        limit_page_length: 1
      },
      callback: function(r) {
        if (r.message && r.message.length > 0) {
          const existing_customer = r.message[0].name;
          const discount = r.message[0].discount;
          console.log("Customer discount", discount);
          create_sales_invoice(existing_customer, data.Service, data.TokenNumber, data.Email, log_name, discount, true);
        } else {
          resolve();
        }
      },
      error: function(err) {
        console.error("Error fetching company customer:", err);
        reject(err);
      }
    });
  } else {
    console.log("No company id found, creating customer without company id");

    frappe.call({
      method: 'frappe.client.get_list',
      args: {
        doctype: 'Customer',
        filters: { customer_name: data.Name },
        fields: ['name'],
        limit_page_length: 1
      },
      callback: function(r) {
        if (r.message && r.message.length > 0) {
          console.log("Recieved response", r.message);
          const existing_customer = r.message[0].name;
          create_sales_invoice(existing_customer, data.Service, data.TokenNumber, data.Email, log_name);
        } else {
          frappe.call({
            method: 'frappe.client.insert',
            args: {
              doc: {
                doctype: 'Customer',
                customer_name: data.Name,
                customer_group: 'Default Customer Group'
              }
            },
            callback: function(res) {
              if (res.message) {
                console.log("Successfully Created Customer", res.message.name);
                create_sales_invoice(res.message.name, data.Service, data.TokenNumber, data.Email, log_name);
              } else {
                reject(new Error("Customer creation failed: empty response"));
              }
            },
            error: function(err) {
              console.error("Error creating customer:", err);
              reject(err);
            }
          });
        }
      },
      error: function(err) {
        console.error("Error getting customer:", err);
        reject(err);
      }
    });
  }

  function add_sales_invoice(customer_name, service_name, token, email, log_name, discount = 0) {
    frappe.call({
      method: 'frappe.client.get_list',
      args: {
        doctype: "Sales Invoice",
        filters: {
          customer: customer_name,
          customer_token: token,
          posting_date: frappe.datetime.get_today()
        },
        fields: ["name"]
      },
      callback: function(r) {
        if (r.message && r.message.length > 0) {
          resolve();
          return;
        } else {
          let gross_total = 0;
          let tax_total = 0;
          let net_total = 0;
          let allocated_amount = 0;
          let paid_amount = 0;
          let amount = 0;
          let rounded_total = 0;
          let net_amount = 0;

          get_service_items(service_name, function(service_doc) {
            console.log(service_doc);

            let items_data = service_doc.services.map(s => {
              gross_total += s.com || 0;
              tax_total += s.tax_amount || 0;
              net_total += s.com || 0;
              paid_amount += s.com || 0;
              allocated_amount += s.com || 0;
              amount += s.com || 0;
              net_amount += s.com || 0;

              return {
                item: s.item,
                item_code: s.item,
                item_name: s.item_name,
                display_name: s.item_name,
                qty: s.qty || 1,
                rate: s.com || 0,
                gross_amount: s.com || 0,
                tax: s.tax || 0,
                tax_rate: s.tax_excluded ? 0 : 5,
                tax_amount: s.tax_amount || 0,
                net_amount: s.com || 0,
                com: s.com || 0,
                gov: s.gov || 0
              };
            });

            const calculated_discount = (gross_total * discount) / 100;

            frappe.call({
              method: 'frappe.client.insert',
              args: {
                doc: {
                  doctype: 'Sales Invoice',
                  customer: customer_name,
                  customer_email: email,
                  payment_mode: "Card",
                  customer_token: token,
                  items: items_data,
                  gross_total: gross_total - calculated_discount,
                  tax_total: tax_total,
                  net_total: (gross_total + tax_total) - calculated_discount,
                  net_amount: gross_total - calculated_discount,
                  rounded_total: (gross_total + tax_total) - calculated_discount,
                  paid_amount: (paid_amount * discount) - calculated_discount
                }
              },
              callback: function(res) {
                if (res.message) {
                  console.log("Sales Invoice created succesffully");

                  frappe.call({
                    method: "frappe.client.set_value",
                    args: {
                      doctype: "Medical Service Logs",
                      name: log_name,
                      fieldname: "status",
                      value: "Completed"
                    },
                    callback: function(statusRes) {
                      if (statusRes.message) {
                        console.log("Status changed from pending to completed in medical service logs");
                      }
                      resolve();
                    },
                    error: function(err) {
                      console.error("Error updating Medical Service Logs status:", err);
                      reject(err);
                    }
                  });
                } else {
                  reject(new Error("Sales Invoice creation failed: empty response"));
                }
              },
              error: function(err) {
                console.error("Error inserting Sales Invoice:", err);
                reject(err);
              }
            });
          }, reject);
        }
      },
      error: function(err) {
        console.error("Error checking existing Sales Invoice:", err);
        reject(err);
      }
    });
  }

  function create_sales_invoice(customer_name, service_name, token, email, log_name, discount = 0, company = null) {
    if (company) {
      frappe.call({
        method: "frappe.client.get_list",
        args: {
          doctype: 'Sales Invoice',
          filters: {
            customer: customer_name,
            posting_date: frappe.datetime.get_today()
          },
          order_by: 'name desc',
          limit_page_length: 1,
          fields: ['name']
        },
        callback: function(r) {
          if (r.message && r.message.length > 0) {
            console.log("Sales Invoice already created for today for the company", customer_name);
            resolve();
            return;
          } else {
            add_sales_invoice(customer_name, service_name, token, email, log_name, discount);
          }
        },
        error: function(err) {
          console.error("Error checking company Sales Invoice:", err);
          reject(err);
        }
      });
    } else {
      add_sales_invoice(customer_name, service_name, token, email, log_name, discount);
    }
  }

  function get_service_items(service_name, callbackFn, errorFn) {
    console.log(service_name);

    frappe.call({
      method: "digitz_erp.api.medical_services.get_medical_service_items",
      args: {
        medical_service: service_name
      },
      callback: function(r) {
        console.log(r);
        if (!r.message) {
          frappe.msgprint("Looks like service doesn't exist please check again.");
          if (errorFn) {
            errorFn(new Error("Service items not found"));
          }
        } else {
          callbackFn(r.message);
        }
      },
      error: function(err) {
        console.error("Error fetching service items:", err);
        if (errorFn) {
          errorFn(err);
        }
      }
    });
  }
}