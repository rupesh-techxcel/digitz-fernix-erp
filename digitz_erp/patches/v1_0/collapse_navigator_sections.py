"""Open the Medical Center Navigator's sections collapsed: each shows only its
heading and count, and a click (or Enter / Space) on the heading opens or closes
its cards. Added to the site's own block, so other changes made to it there are
kept; a fresh install gets it from install_data/custom_html_block.json."""

import frappe

BLOCK = "Medical Center Navigator"
MARKER = "// Sections open collapsed"

SCRIPT = """
// Sections open collapsed: only the heading and its count show. A click, or
// Enter / Space, on the heading opens or closes that section's cards.
root_element.querySelectorAll(".mc-section").forEach(function (section) {
    const head = section.querySelector(".mc-sec-head");
    if (!head) {
        return;
    }
    section.classList.add("is-collapsed");
    head.setAttribute("role", "button");
    head.setAttribute("tabindex", "0");
    head.setAttribute("aria-expanded", "false");

    const toggle = function () {
        const collapsed = section.classList.toggle("is-collapsed");
        head.setAttribute("aria-expanded", String(!collapsed));
    };
    head.addEventListener("click", toggle);
    head.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggle();
        }
    });
});
"""

STYLE = """
/* Collapsible sections (they open collapsed) */
.mc-sec-head { cursor: pointer; user-select: none; }
.mc-sec-head:focus-visible { outline: 2px solid var(--tone, #3b82f6); outline-offset: 4px; border-radius: 6px; }
.mc-sec-head::after {
  content: "";
  margin-left: auto;
  width: 8px;
  height: 8px;
  border-right: 2px solid currentColor;
  border-bottom: 2px solid currentColor;
  color: var(--text-muted, #8d99a6);
  transform: rotate(45deg);
  transition: transform 0.2s ease;
}
.mc-section.is-collapsed { margin-bottom: 10px; }
.mc-section.is-collapsed .mc-sec-head::after { transform: rotate(-45deg); }
.mc-section.is-collapsed .mc-grid { display: none; }
"""


def add_collapse(script, style):
    """(script, style) with the collapsing added, or unchanged when it is there already."""
    if MARKER in (script or ""):
        return script, style
    return (script or "").rstrip() + "\n" + SCRIPT, (style or "").rstrip() + "\n" + STYLE


def execute():
    if not frappe.db.exists("Custom HTML Block", BLOCK):
        return
    block = frappe.db.get_value("Custom HTML Block", BLOCK, ["script", "style"], as_dict=True)
    script, style = add_collapse(block.script, block.style)
    if script != block.script:
        frappe.db.set_value("Custom HTML Block", BLOCK, {"script": script, "style": style})
