// Copyright (c) 2025, Techxcel Technologies and contributors
// For license information, please see license.txt

// frappe.ui.form.on("Supplier Calendar", {
// 	refresh(frm) {

// 	},
// });
// Copyright (c) 2025, Techxcel Technologies
// All rights reserved.

 // 🔧 Global declaration so it can be accessed by updateCalendarEvents()
let calendar2 = null;               // Holds the calendar instance
let fullcalendar_loaded2 = false;  // Tracks whether assets are loaded

// 🛠 Setup tooltip styling and container
function setupTooltip() {
    console.log("Setting up tooltip...");
    if (!document.getElementById("tooltip-style")) {
        const style = document.createElement("style");
        style.id = "tooltip-style";
        style.innerHTML = `
            #event-tooltip {
                position: absolute;
                background: #2f3542;
                color: #fff;
                padding: 10px 15px;
                border-radius: 8px;
                box-shadow: 0 4px 10px rgba(0,0,0,0.2);
                z-index: 9999;
                pointer-events: none;
                display: none;
                font-size: 14px;
                max-width: 250px;
                text-align: left;
                white-space: normal;
            }
        `;
        document.head.appendChild(style);
    }

    if (!document.getElementById("event-tooltip")) {
        const tooltip = document.createElement("div");
        tooltip.id = "event-tooltip";
        document.body.appendChild(tooltip);
    }
}

// 📍 Position tooltip near mouse
function positionTooltip(e) {
    const tooltip = document.getElementById("event-tooltip");
    if (!tooltip) return;
    tooltip.style.left = `${e.pageX + 15}px`;
    tooltip.style.top = `${e.pageY + 15}px`;
}

// 📦 Frappe Form Trigger
frappe.ui.form.on('Supplier Calendar', {
    refresh(frm) {
        setupTooltip();
         setTimeout(() => render_calendar(frm), 200);
    }
});

// 🚀 Render FullCalendar and load events
function render_calendar(frm) {
    const wrapper = frm.fields_dict.calendar_html_2.$wrapper;
    wrapper.html(`<div id="custom-calendar2" style="width:100%; min-height:600px;"></div>`);

    load_calendar_assets(() => {
        frappe.call({
            method: "digitz_erp.api.supplier.get_supplier_schedules",
            args: { docname: frm.doc.name },
            callback: function (r) {
                if (!r.message) return;

                const schedules = r.message.suppliers || [];
                const currency = r.message.currency || "AED"; // Default to AED if not set
                console.log("Fetched schedules:", schedules);

                // Group schedules by date and compute totals
                const groupedByDate = {};

                schedules.forEach(schedule => {
                    const date = schedule.scheduled_date;
                    if (!groupedByDate[date]) {
                        groupedByDate[date] = {
                            total: 0,
                            items: []
                        };
                    }

                    const amount = parseFloat(schedule.amount || 0);
                    groupedByDate[date].total += amount;
                    groupedByDate[date].items.push(schedule);
                });

                // Build events array
                const scheduleEvents = [];

                for (const [date, data] of Object.entries(groupedByDate)) {
                    // Add total event with high priority (low number)
                    scheduleEvents.push({
                        title: `Total: ${data.total}` + ` ${currency}`,
                        start: date,
                        color: "#ff9800",
                        textColor: "#000000",
                         order_priority: 0 ,// ⬅️ will appear first
                        extendedProps: {
                            description: "Day Total",
                           
                        }
                    });

                    // Add each schedule entry with lower priority
                    data.items.forEach(schedule => {
                        scheduleEvents.push({
                           title: schedule.amount ? `${schedule.amount} ${currency} - ${schedule.supplier?.slice(0, 23)}...` : '',
                            start: schedule.scheduled_date,
                            color: "#28a745",
                            textColor: "#ffffff",
                             order_priority: 1, // ⬅️ will appear after "Total"
                            extendedProps: {
                                description: schedule.supplier,
                               
                            }
                        });
                    });
                }
                console.log("Task events:", scheduleEvents);
                const calendarEl = document.getElementById('custom-calendar2');

                calendar = new FullCalendar.Calendar(calendarEl, {
                    initialView: 'dayGridMonth',
                     dayMaxEventRows: 2, 
                    height: 'auto',
                    events: scheduleEvents,
                     eventOrder: "order_priority,title",
                   

                    eventMouseEnter(info) {
                        const tooltip = document.getElementById("event-tooltip");
                        tooltip.innerHTML = `
                            <strong>${info.event.title}</strong><br>
                            ${info.event.extendedProps.description || ''}
                        `;
                        tooltip.style.display = "block";
                        document.addEventListener("mousemove", positionTooltip);
                    },

                    eventMouseLeave() {
                        const tooltip = document.getElementById("event-tooltip");
                        tooltip.style.display = "none";
                        document.removeEventListener("mousemove", positionTooltip);
                    },

                    eventDidMount(info) {
                        info.el.addEventListener('contextmenu', function (e) {
                            e.preventDefault();
                            frappe.msgprint(`Right-clicked on: ${info.event.title}`);
                        });
                    }
                });

                calendar.render();

                // ✅ Now it's safe to call this after calendar exists
                updateCalendarEvents(scheduleEvents);
            }
        });
    });
}

// 🧩 Load FullCalendar assets from CDN
function load_calendar_assets(callback) {
    if (fullcalendar_loaded2 || typeof FullCalendar !== "undefined") {
        fullcalendar_loaded2 = true;
        callback();
        return;
    }

    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.8/index.min.css';
    document.head.appendChild(css);

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.8/index.global.min.js';
    script.onload = () => {
        fullcalendar_loaded2 = true;
        callback();
    };
    document.body.appendChild(script);
}

// 🔁 Dynamically update calendar events
function updateCalendarEvents(events) {
    if (!calendar2 || typeof calendar2.removeAllEvents !== "function") {
        console.warn("Calendar instance is not ready");
        return;
    }

    console.log("Refreshing events in calendar...");
    calendar2.removeAllEvents();
    events.forEach(evt => calendar2.addEvent(evt));
}