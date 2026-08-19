// Copyright (c) 2025, Techxcel Technologies and contributors
// For license information, please see license.txt

frappe.ui.form.on("Settings", {

    refresh(frm) {
        // Add a Test button only once
        if (!frm.test_btn) {
            frm.test_btn = frm.add_custom_button("Test Connection", async () => {
                let url = frm.doc.url;
                let username = frappe.session.user;  // logged-in user

                if (!url) {
                    frappe.msgprint("Please enter URL first");
                    return;
                }

                try {
                    let response = await fetch(`${url}?username=${encodeURIComponent(username)}`);
                    
                    if (response.ok) {
                        let text = await response.text();
                        frm.test_result.html(
                            `<b style="color:green">✅ Passed (status ${response.status})</b><br>${text}`
                        );
                    } else {
                        frm.test_result.html(
                            `<b style="color:red">❌ Failed (status ${response.status})</b>`
                        );
                    }
                } catch (err) {
                    frm.test_result.html(
                        `<b style="color:red">❌ Error: ${err.message}</b>`
                    );
                }

                frm.test_result.show();
            });
            frm.test_btn.hide();
        }

        // Add a result area (only once)
        if (!frm.test_result) {
            frm.test_result = $(
                '<div style="margin-top:10px; font-size:14px;"></div>'
            ).appendTo(frm.fields_dict.url.$wrapper.parent());
            frm.test_result.hide();
        }

        // Show button only when url is entered
        if (frm.doc.url) {
            frm.test_btn.show();
        } else {
            frm.test_btn.hide();
            frm.test_result.hide();
        }
    },

    url(frm) {
        if (frm.doc.url) {
            frm.test_btn.show();
        } else {
            frm.test_btn.hide();
            frm.test_result.hide();
        }
    }
});
