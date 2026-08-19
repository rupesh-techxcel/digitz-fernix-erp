let currentPage = 0; 


frappe.pages['customer-summary-boa'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Customer Summary Board',
		single_column: true
	});

    function loadQuotationList(page_start=0){
        currentPage = page_start;
        console.log("Loading Quotation List for page:", page_start);
        frappe.call({
            method: "digitz_erp.api.quotation_api.get_quotation_list_details",
            args: {
                page_start: page_start // Start from the first page
            },
            callback: function (r) {
                console.log(r.message);
                const data = r.message.quotations || [];
                const totalCount = r.message.total_count || 0;
                const pageSize = 20;
                const totalPages = Math.ceil(totalCount / pageSize);

                // Extract unique customers and action statuses
                const uniqueCustomers = [...new Set(data.map(row => row.prospect || ''))].sort();
                const actionStatuses = ['Completed', 'Sales Order', 'Sales Invoice', 'Delivery Note',];

                const filterHtml = `
                    <div class="mb-3 d-flex gap-3">
                        <select id="customer-filter" class="form-control" style="max-width: 200px;text-align: center;">
                            <option value="">All Customers</option>
                            ${uniqueCustomers.map(c => `<option value="${c}">${c}</option>`).join('')}
                        </select>
                        <select id="action-filter" class="form-control" style="max-width: 200px; text-align: center; margin-left: 10px;">
                            <option value="">Status</option>
                            ${actionStatuses.map(a => `<option value="${a}">${a}</option>`).join('')}
                        </select>
                    </div>
                `;

                const generateTableRows = (rows) => {
                    return rows.map(row => {
                        const quotationHtml = row.name
                            ? `<a href="/app/quotation/${row.name}">${row.name}</a>`
                            : `<button class="btn btn-sm btn-outline-primary create-btn" data-doctype="Quotation" data-quotation="">Create</button>`;

                        const salesOrderHtml = row.sales_order && Array.isArray(row.sales_order) && row.sales_order.length > 0
                            ? row.sales_order.map(so => `<a href="/app/sales-order/${so.name}">${so.name}</a>`).join("<br>")
                            : `<button class="btn btn-sm btn-outline-primary create-btn" data-doctype="Sales Order" data-quotation="${row.name}">Create</button>`;

                        const salesInvoiceHtml = row.sales_invoice && Array.isArray(row.sales_invoice) && row.sales_invoice.length > 0
                            ? row.sales_invoice.map(si => `<a href="/app/sales-invoice/${si}">${si}</a>`).join("<br>")
                            : `<button class="btn btn-sm btn-outline-primary create-btn" data-doctype="Sales Invoice" data-quotation="${row.name}">Create</button>`;

                        const deliveryNotesHtml = row.delivery_notes && Array.isArray(row.delivery_notes) && row.delivery_notes.length > 0
                            ? row.delivery_notes.map(dn => `<a href="/app/delivery-note/${dn.name}">${dn.name}</a>`).join("<br>")
                            : `<button class="btn btn-sm btn-outline-primary create-btn" data-doctype="Delivery Note" data-quotation="${row.name}">Create</button>`;
                        const receiptEntriesHtml = row.receipt_entries && Array.isArray(row.receipt_entries) && row.receipt_entries.length > 0
                            ? row.receipt_entries.map(rp => `<a href="/app/receipt-entry/${rp.name}">${rp.name}</a>`).join("<br>")
                            : `<button class="btn btn-sm btn-outline-primary create-btn" data-doctype="Receipt Entry" data-quotation="${row.name}">Create</button>`;
                        
                        
                            let lastCompleted = "Quotation";
                            if (row.receipt_entries && row.receipt_entries.length > 0) {
                            lastCompleted = "Receipt Entry";  
                        } else if (row.sales_invoice && row.sales_invoice.length > 0) {
                            lastCompleted = "Sales Invoice";
                        }
                            else if (row.delivery_notes && row.delivery_notes.length > 0) {
                            lastCompleted = "Delivery Note";
                        
                        } else if (row.sales_order && row.sales_order.length > 0) {
                            lastCompleted = "Sales Order";
                           
                        } else if (!row.name) {
                            lastCompleted = "Pending";
                        }
                        
                        const actionHtml = (row.name && row.sales_order && row.sales_invoice && row.delivery_notes && row.delivery_notes.length && row.receipt_entries > 0)
                            ? `<span class="badge bg-success">Completed</span>`
                            : `<span class="badge bg-info">${lastCompleted}</span>`;

                        return `
                            <tr data-customer="${row.prospect || ''}" data-action="${(actionHtml.match(/>(.*?)</) || [])[1]}">
                                <td>${row.prospect || ''}</td>
                                <td>${quotationHtml}</td>
                                <td>${salesOrderHtml}</td>
                                <td>${deliveryNotesHtml}</td>
                                <td>${salesInvoiceHtml}</td>
                                <td>${receiptEntriesHtml}</td>
                                <td>${actionHtml}</td>
                            </tr>
                        `;
                    }).join('');
                };
                  const getPaginationNumbers = () => {
                let pages = [];
                let maxVisiblePages = 3;
                let half = Math.floor(maxVisiblePages / 2);

                let start = Math.max(0, currentPage - half);
                let end = Math.min(totalPages, start + maxVisiblePages);

                // Adjust start if near the end
                if (end - start < maxVisiblePages) {
                    start = Math.max(0, end - maxVisiblePages);
                }

                for (let i = start; i < end; i++) {
                    pages.push(i);
                }
                return pages;
            };
                 const pageNumbersHtml = getPaginationNumbers().map(p =>
                `<button class="btn btn-sm ${p === currentPage ? 'btn-primary' : 'btn-outline-primary'} page-number" data-page="${p}">${p + 1}</button>`
            ).join(" ");
                const paginationHtml = `
                <div class="d-flex justify-content-between mt-3 align-items-center">
                    <button class="btn btn-sm btn-outline-primary" id="prev-page" ${currentPage <= 0 ? 'disabled' : ''}>Previous</button>
                    <div class="d-flex gap-1">${pageNumbersHtml}</div>
                    <button class="btn btn-sm btn-outline-primary" id="next-page" ${currentPage >= totalPages - 1 ? 'disabled' : ''}>Next</button>
                </div>
            `;
                const html = `
                    ${filterHtml}
                    <table class="table table-bordered">
                        <thead>
                            <tr>
                                <th>Customer</th>
                                <th>Quotation</th>
                                <th>Sales Order</th>
                                <th>Delivery Notes</th>
                                <th>Sales Invoice</th>
                                <th>Receipt Entries</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody id="quotation-table-body">
                            ${generateTableRows(data)}
                        </tbody>
                    </table>
                    ${paginationHtml}
                `;

                const $section = $(wrapper).find('.layout-main-section');
                $section.html(html);

                // Filter logic
                function applyFilters() {
                    const selectedCustomer = $('#customer-filter').val();
                    const selectedAction = $('#action-filter').val();

                    $('#quotation-table-body tr').each(function () {
                        const matchesCustomer = !selectedCustomer || $(this).data('customer') === selectedCustomer;
                        const matchesAction = !selectedAction || $(this).data('action') === selectedAction;
                        $(this).toggle(matchesCustomer && matchesAction);
                    });
                }

                $('#customer-filter, #action-filter').on('change', applyFilters);

                // Button to create docs
                // $section.find('.create-btn').on('click', function () {
                //     const doctype = $(this).data('doctype');
                //     const quotation = $(this).data('quotation');
                //     const doc = {};
                //     if (quotation) doc.quotation = quotation;
                //     frappe.new_doc(doctype, doc);
                // });
                $section.find('.create-btn').on('click', async function () {
                    const doctypeToCreate = $(this).data('doctype');
                    console.log(doctypeToCreate)
                    const quotation = $(this).data('quotation');
                    const $row = $(this).closest('tr');
                    const lastCompletedDoctype = $row.data('action');  // Use value from "Status" column

                    const doc = {};
                    if (quotation) doc.quotation = quotation;

                    // Map display names to actual doctypes
                   

                    

                    // If creating Delivery Note from Sales Order, use the existing backend method
                        if (doctypeToCreate === "Delivery Note" && $row.data('action') === "Sales Order") {
                            // Find the last Sales Order name from column 3
                            const soLinks = $row.find('td:nth-child(3) a');
                            if (soLinks.length > 0) {
                                const lastSalesOrderName = $(soLinks[soLinks.length - 1]).text().trim();
                                
                                frappe.call({
                                    method: 'digitz_erp.selling.doctype.sales_order.sales_order.generate_do',
                                    args: {
                                        sales_order_name: lastSalesOrderName
                                    },
                                    callback: function(r) {
                                        if (r.message) {
                                            frappe.set_route('Form', 'Delivery Note', r.message);
                                        } else {
                                            frappe.msgprint("Failed to create Delivery Note");
                                        }
                                    }
                                });
                            }
                        } 
                       if (doctypeToCreate === "Sales Invoice") {
                            // Find the last Delivery Note name from column 4
                            const dnLinks = $row.find('td:nth-child(4) a');
                            if (dnLinks.length > 0) {
                                const lastDNName = $(dnLinks[dnLinks.length - 1]).text().trim();

                                frappe.call({
                                    method: "digitz_erp.api.sales_invoice_api.generate_sales_invoice_for_delivery_note",
                                    args: {
                                        delivery_note: lastDNName
                                    },
                                    callback: function(r) {
                                        if (r.message && r.message.si_name) {
                                            frappe.set_route('Form', 'Sales Invoice', r.message.si_name);
                                            frappe.show_alert({
                                                message: __('The Sales Invoice has been successfully generated and saved in draft mode.'),
                                                indicator: 'green'
                                            }, 3);
                                        } else {
                                            frappe.show_alert({
                                                message: __('The Sales Invoice Creation Failed'),
                                                indicator: 'red'
                                            }, 3);
                                        }
                                    }
                                });
                            }
                        }
                       

                    // WITH THIS:
                  
              if (doctypeToCreate === "Receipt Entry") {
    const dnLinks = $row.find('td:nth-child(5) a');
    
    if (dnLinks.length > 0) {
        let lastDNName;
        const options = dnLinks.map((i, el) => {
                return $(el).text().trim();
            }).get();
        console.log(options)    
        if (dnLinks.length > 1) {
            // Show popup if more than one sales invoice
           
            
            let checkboxFields = options.map(opt => {
                    return {
                        fieldname: `invoice_${opt}`,
                        label: opt,
                        fieldtype: 'Check'
                    };
            });
            frappe.prompt(
                checkboxFields,
                function (data) {
                    // Collect only the checked invoices
                    let selectedInvoices = options.filter(opt => data[`invoice_${opt}`]);

                    if (selectedInvoices.length === 0) {
                        frappe.msgprint("Please select at least one Sales Invoice.");
                        return;
                    }

                    // Pass the array of selected invoices
                    createReceiptEntry(selectedInvoices);
                },
                "Select Sales Invoices",
                "Proceed"
            );

        } else {
            // Only one sales invoice → proceed directly
            
            createReceiptEntry(options);
        }
    }

    function createReceiptEntry(sales_invoices) {
        frappe.call({
            method: "digitz_erp.api.receipt_entry_api.save_reciept_entry",
            args: {
                sales_invoices: sales_invoices
            },
            callback: function (r) {
                if (r.message) {
                   
                    frappe.msgprint("Receipt Entry saved successfully!");
                    frappe.set_route("Form", "Receipt Entry", r.message);
                } else {
                    frappe.msgprint("It looks you have already make payment for the invoice");
                }
            }
        });
    }
}


        
                       
                     
                         
                   

                   
    


            

                });

                // Pagination click
                    $('#prev-page').on('click', () => loadQuotationList(currentPage - 1));
                    $('#next-page').on('click', () => loadQuotationList(currentPage + 1));
                    $('.page-number').on('click', function () {
                    const page = parseInt($(this).data('page'));
                        loadQuotationList(page);
                    });
                }
        });

    }
    

    loadQuotationList();
		
}
