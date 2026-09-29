(()=>{(function(){let d="digitz_erp.api.counter_api.",t="digitz_erp.api.counter_session_api.",o="digitz_counter_device_secret",r=e=>frappe.utils.escape_html(e==null?"":String(e)),a=e=>format_currency(e,frappe.boot.sysdefaults.currency);function p(){try{return window.localStorage.getItem(o)}catch(e){return null}}function m(e){try{window.localStorage.setItem(o,e)}catch(n){}}function _(e){if(!e.counter)return{text:__("Unregistered device"),colour:"red"};let n=`${e.counter} \xB7 ${e.device}`,i=e.session;if(i&&i.status==="Closing")return{text:`${n} \xB7 ${__("Close awaiting approval")}`,colour:"orange"};if(i){let s=frappe.datetime.str_to_user(i.opened_on).split(" ").pop();return{text:`${n} \xB7 ${__("Day open since {0}",[s])}`,colour:"green"}}return{text:`${n} \xB7 ${__("Day not opened")}`,colour:e.must_open_day?"orange":"blue"}}function y(e){$("#digitz-counter-badge").remove();let{text:n,colour:i}=_(e),s=e.pending_approvals?` <span class="badge badge-pill" style="background: var(--orange-500, #f59e0b); color: #fff;"
				title="${r(__("Day closes waiting for your approval"))}">${e.pending_approvals}</span>`:"",l=$(`
			<li class="nav-item" id="digitz-counter-badge">
				<span class="indicator-pill ${i}" style="margin: 0 8px; white-space: nowrap; cursor: pointer;">
					${r(n)}${s}
				</span>
			</li>
		`);l.on("click",()=>h(e));let g=$("header .navbar-collapse .navbar-nav").first(),f=g.find(".dropdown-notifications").first();f.length?l.insertBefore(f):g.prepend(l)}function h(e){if(e.pending_approvals&&e.is_supervisor&&!e.session){frappe.set_route("day-close");return}if(!e.counter){e.can_register?u(e):frappe.msgprint(__("This PC is not registered as a counter. Ask a supervisor to register it."));return}frappe.set_route(e.session?"day-close":"day-open")}function u(e){if(!(e.counters||[]).length){frappe.msgprint(__("Create a Counter first, then register this device to it."));return}let n=new frappe.ui.Dialog({title:__("Register this device"),fields:[{fieldname:"counter",fieldtype:"Select",label:__("Counter"),reqd:1,options:e.counters,default:e.counter||e.counters[0]},{fieldtype:"HTML",options:`<p class="text-muted small">${e.device?__("This PC is currently {0} ({1}). Registering again gives it a new device number; disable the old one in Counter Device.",[r(e.device),r(e.counter)]):__("This PC gets its own device number. Everything saved here is recorded against the counter you choose.")}</p>`}],primary_action_label:__("Register"),primary_action(i){frappe.call({method:d+"register_device",args:{counter:i.counter},freeze:!0,callback(s){!s.message||(m(s.message.secret),n.hide(),frappe.show_alert({message:__("This PC is now {0} ({1})",[s.message.counter,s.message.device]),indicator:"green"}),c())}})}});n.show()}function c(){frappe.call({method:d+"resolve_device",args:{secret:p()},callback(){frappe.call({method:t+"get_state",callback(e){e.message&&y(e.message)}})}})}frappe.provide("digitz_erp"),digitz_erp.refresh_counter_badge=c,digitz_erp.open_register_device_dialog=u,$(document).on("app_ready",c)})();frappe.provide("digitz_erp");digitz_erp.CashCount=class{constructor(t,o,r){this.denominations=o||[],this.on_change=r,this.$el=$(`
			<table class="dayops-count">
				<thead><tr><th>${__("Note / Coin")}</th><th>${__("Count")}</th><th>${__("Amount")}</th></tr></thead>
				<tbody>${this.denominations.map(a=>`
					<tr data-value="${a}">
						<td>${format_currency(a,frappe.boot.sysdefaults.currency)}</td>
						<td><input type="number" min="0" step="1" class="form-control input-sm" inputmode="numeric"></td>
						<td class="dayops-num dayops-line">-</td>
					</tr>`).join("")}
				</tbody>
				<tfoot><tr><td colspan="2">${__("Total counted")}</td><td class="dayops-num dayops-total">-</td></tr></tfoot>
			</table>`).appendTo(t),this.$el.on("input","input",()=>this.update())}rows(){return this.$el.find("tbody tr").toArray().map(t=>({denomination:flt($(t).attr("data-value")),count:cint($(t).find("input").val())}))}total(){return this.rows().reduce((t,o)=>t+o.denomination*o.count,0)}update(){let t=r=>format_currency(r,frappe.boot.sysdefaults.currency);this.$el.find("tbody tr").each((r,a)=>{let p=flt($(a).attr("data-value"))*cint($(a).find("input").val());$(a).find(".dayops-line").text(p?t(p):"-")});let o=this.total();this.$el.find(".dayops-total").text(o?t(o):"-"),this.on_change&&this.on_change(o)}counted(){return this.rows().filter(t=>t.count)}set_counts(t){let o={};(t||[]).forEach(r=>o[flt(r.denomination)]=cint(r.count)),this.$el.find("tbody tr").each((r,a)=>{let p=o[flt($(a).attr("data-value"))];$(a).find("input").val(p||"")}),this.update()}};digitz_erp.dayops_styles=function(){if(document.getElementById("dayops-styles"))return;let d=document.createElement("style");d.id="dayops-styles",d.textContent=`
.dayops { max-width: 1100px; margin: 0 auto; }
.dayops-head { display: flex; flex-wrap: wrap; gap: 10px 28px; padding: 14px 18px; margin-bottom: 16px;
	border: 1px solid var(--border-color); border-radius: var(--border-radius-lg, 10px); background: var(--card-bg, var(--fg-color)); }
.dayops-head div { min-width: 140px; }
.dayops-head .k { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted); }
.dayops-head .v { font-size: 15px; font-weight: 600; }
.dayops-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
@media (max-width: 900px) { .dayops-grid { grid-template-columns: 1fr; } }
.dayops-card { border: 1px solid var(--border-color); border-radius: var(--border-radius-lg, 10px);
	background: var(--card-bg, var(--fg-color)); padding: 16px 18px; margin-bottom: 16px; }
.dayops-card h4 { font-size: 13px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted); margin: 0 0 12px; }
.dayops-num { text-align: right; white-space: nowrap; }
.dayops-count { width: 100%; }
.dayops-count th { font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 600; padding: 4px 6px; }
.dayops-count td { padding: 3px 6px; vertical-align: middle; }
.dayops-count td input { max-width: 110px; }
.dayops-count tfoot td { font-weight: 700; border-top: 1px solid var(--border-color); padding-top: 8px; }
.dayops-lines { width: 100%; }
.dayops-lines td { padding: 7px 4px; border-bottom: 1px solid var(--border-color); }
.dayops-lines tr.total td { font-weight: 700; font-size: 15px; border-bottom: none; border-top: 2px solid var(--text-color); }
.dayops-lines .dayops-toggle { cursor: pointer; color: var(--text-color); }
.dayops-lines .dayops-caret { display: inline-block; width: 14px; color: var(--text-muted); }
.dayops-docs td { font-size: 12px; color: var(--text-muted); padding: 3px 4px 3px 22px; border-bottom: none; }
.dayops-big { font-size: 24px; font-weight: 700; }
.dayops-result { padding: 12px 14px; border-radius: var(--border-radius, 6px); margin-top: 10px; font-weight: 600; }
.dayops-result.ok { background: var(--green-50, #ecfdf5); color: var(--green-700, #15803d); }
.dayops-result.short { background: var(--red-50, #fef2f2); color: var(--red-700, #b91c1c); }
.dayops-result.over { background: var(--orange-50, #fff7ed); color: var(--orange-700, #c2410c); }
.dayops-state { text-align: center; padding: 48px 20px; }
.dayops-state .dayops-big { margin-bottom: 8px; }
.dayops-state p { color: var(--text-muted); max-width: 520px; margin: 0 auto 16px; }
`,document.head.appendChild(d)};})();
//# sourceMappingURL=counter_device.bundle.IBJ4WDZG.js.map
