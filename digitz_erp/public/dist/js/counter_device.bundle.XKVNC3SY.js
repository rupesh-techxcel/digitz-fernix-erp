(()=>{var j=Object.defineProperty,M=Object.defineProperties;var L=Object.getOwnPropertyDescriptors;var T=Object.getOwnPropertySymbols;var I=Object.prototype.hasOwnProperty,N=Object.prototype.propertyIsEnumerable;var z=(d,e,t)=>e in d?j(d,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):d[e]=t,S=(d,e)=>{for(var t in e||(e={}))I.call(e,t)&&z(d,t,e[t]);if(T)for(var t of T(e))N.call(e,t)&&z(d,t,e[t]);return d},O=(d,e)=>M(d,L(e));var A=(d,e,t)=>(z(d,typeof e!="symbol"?e+"":e,t),t);(function(){let d="digitz_erp.api.counter_api.",e="digitz_erp.api.counter_session_api.",t="digitz_counter_device_secret",s=i=>frappe.utils.escape_html(i==null?"":String(i)),o=i=>format_currency(i,frappe.boot.sysdefaults.currency);function c(){try{return window.localStorage.getItem(t)}catch(i){return null}}function y(i){try{window.localStorage.setItem(t,i)}catch(p){}}function l(i){if(!i.counter){let v=i.registration_request;return v&&v.approval_status==="Pending"?{text:`${__("Approval pending")} \xB7 ${v.counter}`,colour:"orange"}:v&&v.approval_status==="Rejected"?{text:`${__("Request rejected")} \xB7 ${v.counter}`,colour:"red"}:{text:__("Unregistered device"),colour:"red"}}let p=`${i.counter} \xB7 ${i.device}`,_=i.session;if(_&&_.status==="Closing")return{text:`${p} \xB7 ${__("Close awaiting approval")}`,colour:"orange"};if(_){let v=frappe.datetime.str_to_user(_.opened_on).split(" ").pop();return{text:`${p} \xB7 ${__("Day open since {0}",[v])}`,colour:"green"}}return{text:`${p} \xB7 ${__("Day not opened")}`,colour:i.must_open_day?"orange":"blue"}}function k(i){$("#digitz-counter-badge").remove();let{text:p,colour:_}=l(i),v=(i.pending_approvals||0)+(i.device_requests||0),m=v?` <span class="badge badge-pill" style="background: var(--orange-500, #f59e0b); color: #fff;"
				title="${s(__("Day closes and device requests waiting for your approval"))}">${v}</span>`:"",h=$(`
			<li class="nav-item" id="digitz-counter-badge">
				<span class="indicator-pill ${_}" style="margin: 0 8px; white-space: nowrap; cursor: pointer;">
					${s(p)}${m}
				</span>
			</li>
		`);h.on("click",()=>n(i));let r=$("header .navbar-collapse .navbar-nav").first(),C=r.find(".dropdown-notifications").first();C.length?h.insertBefore(C):r.prepend(h)}function n(i){if(i.device_requests&&i.is_supervisor){f(i);return}if(i.pending_approvals&&i.is_supervisor&&!i.session){frappe.set_route("day-close");return}if(!i.counter){let p=i.registration_request;i.can_register?w(i):p&&p.approval_status==="Pending"?frappe.msgprint({title:__("Approval pending"),message:__("You asked for this PC to become {0}'s PC ({1}). That counter already has a PC, so a supervisor must approve it. The badge turns green when they do.",[s(p.counter),s(p.device)]),indicator:"orange"}):i.is_cashier?a(i):frappe.msgprint(__("This PC is not registered as a counter. Ask a supervisor to register it."));return}frappe.set_route(i.session?"day-close":"day-open")}let u="__new__";function g(i){let p=(i||[]).map(_=>(/^Counter (\d+)$/.exec(_)||[])[1]).filter(Boolean).map(Number);return`Counter ${Math.max(0,...p)+1}`}function w(i){let p=i.counters||[],_=new frappe.ui.Dialog({title:__("Register this device"),fields:[{fieldname:"counter",fieldtype:"Select",label:__("Counter"),reqd:1,options:[...p.map(m=>({label:m,value:m})),{label:__("+ New counter"),value:u}],default:i.counter||p[0]||u,change:()=>v()},{fieldname:"new_counter",fieldtype:"Data",label:__("New counter name"),default:g(p),depends_on:`eval:doc.counter=='${u}'`,mandatory_depends_on:`eval:doc.counter=='${u}'`,description:__("The counter is created now, and this PC registered to it.")},{fieldtype:"HTML",options:`<p class="text-muted small">${i.device?__("This PC is currently {0} ({1}). Registering again gives it a new device number.",[s(i.device),s(i.counter)]):__("This PC gets its own device number. Everything saved here is recorded against the counter you choose.")}</p>`},{fieldname:"replaced",fieldtype:"HTML"}],primary_action_label:__("Register"),primary_action(m){let h=m.counter===u;frappe.call({method:d+"register_device",args:h?{new_counter:m.new_counter}:{counter:m.counter},freeze:!0,callback(r){if(!r.message)return;y(r.message.secret),_.hide();let C=(r.message.disabled||[]).length?" "+__("Disabled: {0}",[r.message.disabled.join(", ")]):"";frappe.show_alert({message:__("This PC is now {0} ({1})",[r.message.counter,r.message.device])+C,indicator:"green"}),b()}})}});function v(){let m=_.get_value("counter"),h=_.fields_dict.replaced.$wrapper.empty();_.get_primary_btn().text(__("Register")),!(!m||m===u)&&frappe.call({method:d+"get_registration_preview",args:{counter:m},callback(r){if(_.get_value("counter")!==m)return;let C=r.message||[];if(!C.length)return;let P=x=>moment(x).format("DD-MM-YYYY, hh:mm A"),R=C.map(x=>{let q=x.last_seen?__("Last seen {0}",[P(x.last_seen)]):__("Never seen"),E=x.open_session?`
							<div class="cd-replace-open">
								${frappe.utils.icon("es-line-time","xs")}
								<span>${x.counter===m?__("{0}'s day {1} is still open. It carries on on this PC: no new Day Open is needed.",[`<b>${s(x.cashier_name)}</b>`,s(x.open_session)]):__("{0}'s day {1} is still open on {2}. Close it from any PC, or register a new {2} PC to carry on.",[`<b>${s(x.cashier_name)}</b>`,s(x.open_session),s(x.counter)])}</span>
							</div>`:"";return`
							<li class="cd-replace-item">
								<div class="cd-replace-device"><b>${s(x.device)}</b> \xB7 ${s(x.counter)} <span class="cd-replace-seen">${s(q)}</span></div>
								${E}
							</li>`}).join("");h.html(`
						<div class="cd-replace-warning" role="alert">
							<div class="cd-replace-head">
								${frappe.utils.icon("solid-warning","sm")}
								<span>${C.length===1?__("Registering replaces the PC now on {0}",[s(m)]):__("Registering replaces {0} PCs",[C.length])}</span>
							</div>
							<ul class="cd-replace-list">${R}</ul>
							<div class="cd-replace-foot">${s(__("A counter has one PC. The replaced PC stops working as a counter until it is registered again."))}</div>
						</div>`),_.get_primary_btn().text(__("Register & Replace"))}})}_.show(),v()}function a(i){frappe.call({method:d+"get_request_options",callback(p){let _=p.message||[];if(!_.length){frappe.msgprint(__("There are no counters yet. Ask a supervisor to register this PC."));return}let v=i.registration_request&&i.registration_request.approval_status==="Rejected"?`<p class="small" style="color: var(--red-600, #dc2626);">${s(__("Your last request for {0} was rejected. Ask a supervisor why before asking again.",[i.registration_request.counter]))}</p>`:"",m=new frappe.ui.Dialog({title:__("Ask to register this PC"),fields:[{fieldtype:"HTML",options:v},{fieldname:"counter",fieldtype:"Select",label:__("Counter"),reqd:1,options:_.map(h=>({value:h.counter,label:h.device?__("{0} \xB7 has a PC ({1}), needs approval",[h.counter,h.device]):__("{0} \xB7 free, ready at once",[h.counter])})),default:(_.find(h=>!h.device)||_[0]).counter},{fieldtype:"HTML",options:`<p class="text-muted small">${__("A free counter becomes this PC's at once. A counter that already has a PC needs a supervisor's approval, because this PC would replace it.")}</p>`}],primary_action_label:__("Ask"),primary_action(h){frappe.call({method:d+"request_device",args:{counter:h.counter},freeze:!0,callback(r){if(!r.message)return;y(r.message.secret),m.hide();let C=r.message.status==="Approved";frappe.show_alert({message:C?__("This PC is now {0} ({1})",[r.message.counter,r.message.device]):__("Approval pending: a supervisor must approve this PC for {0}",[r.message.counter]),indicator:C?"green":"orange"},8),b()}})}});m.show()}})}function f(i){let p=new frappe.ui.Dialog({title:__("PCs waiting for approval"),size:"large",fields:[{fieldname:"list",fieldtype:"HTML"}]});function _(){frappe.call({method:d+"get_device_requests",callback(v){let m=v.message||[],h=p.fields_dict.list.$wrapper;m.length?h.html(`
							<p class="text-muted small">${__("Approving makes the PC its counter's PC and disables the one it replaces. A day open on the old PC carries on on the new one.")}</p>
							<table class="table table-sm">
								<thead><tr><th>${__("Counter")}</th><th>${__("Asked by")}</th><th>${__("Replaces")}</th><th></th></tr></thead>
								<tbody>${m.map(r=>`
									<tr data-device="${s(r.device)}">
										<td><b>${s(r.counter)}</b><div class="text-muted small">${s(r.device)} \xB7 ${s(frappe.datetime.str_to_user(r.registered_on))}</div></td>
										<td>${s(r.requested_by_name)}<div class="text-muted small" title="${s(r.user_agent)}">${s((r.user_agent||"").slice(0,40))}</div></td>
										<td>${s(r.replaces||__("nothing"))}${r.open_session?`<div class="small" style="color: var(--orange-600, #ea580c);">${s(__("{0}'s day {1} is open",[r.cashier_name,r.open_session]))}</div>`:""}</td>
										<td class="text-right" style="white-space: nowrap;">
											<button class="btn btn-xs btn-primary" data-action="approve">${__("Approve")}</button>
											<button class="btn btn-xs btn-default" data-action="reject">${__("Reject")}</button>
										</td>
									</tr>`).join("")}
								</tbody>
							</table>`):h.html(`<p class="text-muted">${__("No requests are waiting.")}</p>`),i.pending_approvals&&h.append(`<p><a class="small" href="/app/day-close">${__("{0} day close(s) also wait for approval",[i.pending_approvals])}</a></p>`)}})}p.fields_dict.list.$wrapper.on("click","button[data-action]",v=>{let m=$(v.currentTarget).closest("tr").attr("data-device");$(v.currentTarget).attr("data-action")==="approve"?frappe.call({method:d+"approve_device_request",args:{device:m},freeze:!0,callback(h){h.message&&(frappe.show_alert({message:__("{0} is now {1}'s PC",[h.message.device,h.message.counter]),indicator:"green"}),_(),b())}}):frappe.prompt({fieldname:"reason",fieldtype:"Small Text",label:__("Reason (shown on the device record)")},h=>frappe.call({method:d+"reject_device_request",args:{device:m,reason:h.reason},callback(){_(),b()}}),__("Reject {0}",[m]),__("Reject"))}),p.show(),_()}function b(){frappe.call({method:d+"resolve_device",args:{secret:c()},callback(){frappe.call({method:e+"get_state",callback(i){i.message&&(k(i.message),digitz_erp.counter_state=i.message,$(document).trigger("digitz:counter-state",[i.message]))}})}})}frappe.provide("digitz_erp"),digitz_erp.refresh_counter_badge=b,digitz_erp.open_register_device_dialog=w,$(document).on("app_ready",()=>{b(),frappe.realtime.on("digitz_counter_devices",b)})})();frappe.provide("digitz_erp");digitz_erp.CashCount=class{constructor(e,t,s){this.denominations=t||[],this.on_change=s,this.$el=$(`
			<table class="dayops-count">
				<thead><tr><th>${__("Note / Coin")}</th><th>${__("Count")}</th><th>${__("Amount")}</th></tr></thead>
				<tbody>${this.denominations.map(o=>`
					<tr data-value="${o}">
						<td>${format_currency(o,frappe.boot.sysdefaults.currency)}</td>
						<td><input type="number" min="0" step="1" class="form-control input-sm" inputmode="numeric"></td>
						<td class="dayops-num dayops-line">-</td>
					</tr>`).join("")}
				</tbody>
				<tfoot><tr><td colspan="2">${__("Total counted")}</td><td class="dayops-num dayops-total">-</td></tr></tfoot>
			</table>`).appendTo(e),this.$el.on("input","input",()=>this.update())}rows(){return this.$el.find("tbody tr").toArray().map(e=>({denomination:flt($(e).attr("data-value")),count:cint($(e).find("input").val())}))}total(){return this.rows().reduce((e,t)=>e+t.denomination*t.count,0)}update(){let e=s=>format_currency(s,frappe.boot.sysdefaults.currency);this.$el.find("tbody tr").each((s,o)=>{let c=flt($(o).attr("data-value"))*cint($(o).find("input").val());$(o).find(".dayops-line").text(c?e(c):"-")});let t=this.total();this.$el.find(".dayops-total").text(t?e(t):"-"),this.on_change&&this.on_change(t)}counted(){return this.rows().filter(e=>e.count)}set_counts(e){let t={};(e||[]).forEach(s=>t[flt(s.denomination)]=cint(s.count)),this.$el.find("tbody tr").each((s,o)=>{let c=t[flt($(o).attr("data-value"))];$(o).find("input").val(c||"")}),this.update()}};digitz_erp.dayops_styles=function(){if(document.getElementById("dayops-styles"))return;let d=document.createElement("style");d.id="dayops-styles",d.textContent=`
.dayops { max-width: 1100px; margin: 0 auto; }
.dayops-head { display: flex; flex-wrap: wrap; gap: 10px 28px; padding: 14px 18px; margin-bottom: 16px;
	border: 1px solid var(--border-color); border-radius: var(--border-radius-lg, 10px); background: var(--card-bg, var(--fg-color)); }
.dayops-head div { min-width: 140px; }
.dayops-head .k { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted); }
.dayops-head .v { font-size: 15px; font-weight: 600; }
.dayops-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
/* Day Close: count, card & bank, close side by side so it fits without scrolling */
.dayops-grid.dayops-grid-3 { grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 1fr); }
@media (max-width: 1200px) { .dayops-grid.dayops-grid-3 { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } }
@media (max-width: 900px) { .dayops-grid, .dayops-grid.dayops-grid-3 { grid-template-columns: 1fr; } }
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
.dayops-docs td { font-size: 12px; color: var(--text-muted); padding: 3px 4px 3px 22px; border-bottom: none; }
.dayops-big { font-size: 24px; font-weight: 700; }
.dayops-result { padding: 12px 14px; border-radius: var(--border-radius, 6px); margin-top: 10px; font-weight: 600; }
.dayops-result.ok { background: var(--green-50, #ecfdf5); color: var(--green-700, #15803d); }
.dayops-result.short { background: var(--red-50, #fef2f2); color: var(--red-700, #b91c1c); }
.dayops-result.over { background: var(--orange-50, #fff7ed); color: var(--orange-700, #c2410c); }
/* Supervisor's Day Close: every counter's day side by side */
.dcb-toolbar { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px 16px; }
.dcb-toolbar .dcb-date { width: 170px; }
.dcb-toolbar .dcb-date .frappe-control { margin-bottom: 0; }
.dcb-chips { display: flex; gap: 6px; padding-bottom: 4px; }
.dcb-chip { border: 1px solid var(--border-color); background: var(--control-bg); color: var(--text-color); border-radius: 999px; padding: 3px 12px; font-size: 12px; }
.dcb-chip.active { background: var(--primary); border-color: var(--primary); color: #fff; }
.dcb-summary { font-size: 12px; padding-bottom: 6px; }
.dcb-buttons { margin-left: auto; display: flex; gap: 6px; padding-bottom: 2px; }
.dcb-card { padding: 0; overflow: hidden; }
.dcb-card > p { padding: 0 16px 12px; }
.dcb-scroll { overflow-x: auto; }
.dcb-grid { border-collapse: separate; border-spacing: 0; min-width: 100%; font-size: 13px; }
.dcb-grid th, .dcb-grid td { padding: 6px 12px; border-bottom: 1px solid var(--border-color); }
.dcb-grid th:first-child, .dcb-grid td:first-child { position: sticky; left: 0; z-index: 1; background: var(--card-bg, var(--fg-color));
	white-space: nowrap; min-width: 230px; border-right: 1px solid var(--border-color); }
.dcb-grid thead th { vertical-align: top; text-align: right; font-weight: normal; background: var(--subtle-fg, var(--fg-color)); }
.dcb-col { min-width: 150px; }
.dcb-counter { font-weight: 700; font-size: 14px; }
.dcb-cashier { font-weight: 600; }
.dcb-time, .dcb-note { font-size: 11px; color: var(--text-muted); }
.dcb-note { color: var(--orange-600, #c2410c); }
.dcb-section td { background: var(--subtle-fg, var(--gray-50)); font-size: 11px; text-transform: uppercase; letter-spacing: .05em;
	color: var(--text-muted); font-weight: 600; padding-top: 10px; }
.dcb-strong td, .dcb-difference td { font-weight: 700; }
.dcb-grid td.is-short { color: var(--red-600, #dc2626); }
.dcb-grid td.is-over { color: var(--orange-600, #ea580c); }
.dcb-grid .dcb-total { background: var(--subtle-accent, var(--gray-100)); font-weight: 700; border-left: 1px solid var(--border-color); }
.dcb-remarks { font-size: 12px; color: var(--text-muted); max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: right; }
.dcb-actions { text-align: right; white-space: nowrap; }
.dcb-actions .btn + .btn { margin-left: 4px; }
.dayops-state { text-align: center; padding: 48px 20px; }
.dayops-state .dayops-big { margin-bottom: 8px; }
.dayops-state p { color: var(--text-muted); max-width: 520px; margin: 0 auto 16px; }
`,document.head.appendChild(d)};frappe.provide("digitz_erp");digitz_erp.DayOpsBase=class{constructor(e,t={},s=null){this.page=e,this.opts=t,this.embedded=!!t.embedded,this.$parent=$(t.parent||e.main),!this.embedded&&s&&e.add_inner_button(__("Help"),()=>frappe.set_route("digitz-help",s)),digitz_erp.dayops_styles(),this.$body=$('<div class="dayops"></div>').appendTo(this.$parent)}money(e){return format_currency(e,frappe.boot.sysdefaults.currency)}esc(e){return frappe.utils.escape_html(e==null?"":String(e))}set_primary(e,t,s){!this.embedded&&this.page.set_primary_action(e,t,s)}set_secondary(e,t){!this.embedded&&this.page.set_secondary_action(e,t)}clear_actions(){this.embedded||(this.page.clear_primary_action(),this.page.clear_secondary_action())}go(e){this.embedded?frappe.set_route("cashier-console",e):frappe.set_route(e)}changed(){digitz_erp.refresh_counter_badge&&digitz_erp.refresh_counter_badge(),this.opts.on_change&&this.opts.on_change()}static print_slip(e){window.open(frappe.urllib.get_full_url(`/printview?doctype=${encodeURIComponent("Counter Session")}&name=${encodeURIComponent(e)}&format=${encodeURIComponent("Day Close Slip")}&trigger_print=1`))}};digitz_erp.DayOpen=class extends digitz_erp.DayOpsBase{constructor(e,t){super(e,t,"day-open")}async load(){this.clear_actions();let e=await frappe.call({method:"digitz_erp.api.counter_session_api.get_state"});this.state=e.message||{},this.render()}header(){let e=this.state;return`
			<div class="dayops-head">
				<div><div class="k">${__("Counter")}</div><div class="v">${frappe.utils.escape_html(e.counter||__("Unregistered"))}</div></div>
				<div><div class="k">${__("Device")}</div><div class="v">${frappe.utils.escape_html(e.device||"-")}</div></div>
				<div><div class="k">${__("Cashier")}</div><div class="v">${frappe.utils.escape_html(e.user_full_name||frappe.session.user)}</div></div>
				<div><div class="k">${__("Date")}</div><div class="v">${frappe.datetime.str_to_user(e.now)}</div></div>
			</div>`}state_panel(e,t,s,o){this.$body.html(`${this.header()}
			<div class="dayops-card dayops-state">
				<div class="dayops-big">${e}</div>
				<p>${t}</p>
				${s?`<button class="btn btn-primary btn-sm dayops-go">${s}</button>`:""}
			</div>`),this.$body.find(".dayops-go").on("click",o)}render(){let e=this.state;if(!e.counter)return this.state_panel(__("This PC is not a registered counter"),e.can_register?__("Register it to a counter first. Every day opened here then belongs to that counter."):__("Ask a supervisor to register this PC as a counter before opening the day."),e.can_register?__("Register this device"):null,()=>digitz_erp.open_register_device_dialog(e));if(e.session&&e.session.status==="Closing")return this.state_panel(__("Your last close is waiting for approval"),__("A supervisor has to approve the cash difference on {0} before a new day can be opened.",[e.session.name]),__("View Day Close"),()=>this.go("day-close"));if(e.session)return this.state_panel(__("Your day is already open"),__("Open on {0} since {1}, with a float of {2}.",[frappe.utils.escape_html(e.session.counter),frappe.datetime.str_to_user(e.session.opened_on),this.money(e.session.opening_float)]),__("Go to Day Close"),()=>this.go("day-close"));if(e.counter_taken){let l=e.counter_taken;return this.state_panel(__("{0} is in use",[frappe.utils.escape_html(e.counter)]),__("{0} has a day open here since {1} ({2}). They close it with Close & Hand Over, or a supervisor closes it for them from Day Close.",[frappe.utils.escape_html(l.cashier_name),frappe.datetime.str_to_user(l.opened_on),frappe.utils.escape_html(l.name)]),e.is_supervisor?__("Go to Day Close"):null,()=>this.go("day-close"))}let t=e.last_close,s=t&&t.closed_by&&t.closed_by!==t.cashier?`<tr><td>${__("Counted by supervisor")}</td><td class="dayops-num">${frappe.utils.escape_html(t.closed_by_name||t.closed_by)}</td></tr>`:"",o=t&&t.status==="Closing"?`<div class="dayops-result over" style="margin-bottom: 10px;">${__("This close is still waiting for a supervisor to approve its difference. The count below is what was left in the till.")}</div>`:"",c=t?`
				${o}
				<table class="dayops-lines">
					<tr><td>${__("Closed by")}</td><td class="dayops-num">${frappe.utils.escape_html(t.cashier_name||t.cashier)}</td></tr>
					<tr><td>${__("Closed on")}</td><td class="dayops-num">${frappe.datetime.str_to_user(t.closed_on)}</td></tr>
					${s}
					<tr><td>${__("Session")}</td><td class="dayops-num"><a href="/app/counter-session/${encodeURIComponent(t.name)}">${frappe.utils.escape_html(t.name)}</a></td></tr>
					<tr><td>${__("Difference at close")}</td><td class="dayops-num">${this.money(t.difference)}</td></tr>
					<tr class="total"><td>${__("Cash left in the till")}</td><td class="dayops-num">${this.money(t.counted_cash)}</td></tr>
				</table>
				<p class="text-muted small" style="margin-top: 10px;">${__("Your opening float starts from this amount. Count the till: any change since (cash banked, added or taken out) shows below.")}</p>
				<button class="btn btn-default btn-sm dayops-takeover">${__("Take over this count")}</button>
				<p class="text-muted small" style="margin: 6px 0 0;">${__("For a handover: fills the count with what was left in the till. Check it against the notes before opening.")}</p>`:`<p class="text-muted">${__("No day has been closed on this counter yet.")}</p>`,y=`<div class="dayops-card"><h4>${__("Count the Opening Cash")}</h4><div class="dayops-count-wrap"></div></div>`;this.$body.html(`${this.header()}
			<div class="dayops-grid">
				<div>
					${e.show_last_close===0?y:`<div class="dayops-card"><h4>${__("Previous Close on this Counter")}</h4>${c}</div>`}
				</div>
				<div>
					${e.show_last_close===0?"":y}
					<div class="dayops-card">
						<h4>${__("Opening Float")}</h4>
						<div class="float-field"></div>
						<div class="float-note"></div>
						<div class="remarks-field"></div>
						<button class="btn btn-primary btn-block dayops-submit" style="margin-top: 8px;">${__("Open Day")}</button>
					</div>
				</div>
			</div>`),this.float=frappe.ui.form.make_control({parent:this.$body.find(".float-field"),df:{fieldtype:"Currency",fieldname:"opening_float",label:__("Opening Float"),reqd:1,description:__("Filled from the count, or type the total."),change:()=>this.show_float_note()},render_input:!0}),this.float.set_value(t?flt(t.counted_cash):0),this.remarks=frappe.ui.form.make_control({parent:this.$body.find(".remarks-field"),df:{fieldtype:"Small Text",fieldname:"remarks",label:__("Remarks")},render_input:!0}),this.count=new digitz_erp.CashCount(this.$body.find(".dayops-count-wrap"),e.denominations,l=>{l&&this.float.set_value(l)}),this.$body.find(".dayops-takeover").on("click",()=>this.take_over()),this.show_float_note(),this.set_primary(__("Open Day"),()=>this.open_day(),"check"),this.$body.find(".dayops-submit").on("click",()=>this.open_day())}take_over(){let e=this.state.last_close;(e.denominations||[]).length?this.count.set_counts(e.denominations):this.float.set_value(flt(e.counted_cash)),this.remarks.get_value()||this.remarks.set_value(__("Taken over from {0} ({1})",[e.cashier_name||e.cashier,e.name]))}show_float_note(){let e=this.state.last_close,t=this.$body.find(".float-note").empty();if(!e)return;let s=flt(this.float.get_value())-flt(e.counted_cash);Math.abs(s)<.005?t.html(`<div class="dayops-result ok">${__("Same as the cash left at the last close")}</div>`):t.html(`<div class="dayops-result over">${s<0?__("{0} less than the last close (cash taken out or banked)",[this.money(-s)]):__("{0} more than the last close (cash added)",[this.money(s)])}</div>`)}open_day(){let e=flt(this.float.get_value());frappe.confirm(__("Open the day on {0} with a float of {1}?",[frappe.utils.escape_html(this.state.counter),this.money(e)]),()=>frappe.call({method:"digitz_erp.api.counter_session_api.open_day",args:{opening_float:e,denominations:this.count.counted(),remarks:this.remarks.get_value()},freeze:!0,freeze_message:__("Opening the day..."),callback:t=>{!t.message||(frappe.show_alert({message:__("Day opened on {0} ({1})",[t.message.counter,t.message.session]),indicator:"green"}),this.changed(),this.load())}}))}};digitz_erp.DayClose=class extends digitz_erp.DayOpsBase{constructor(e,t){super(e,t,"day-close")}async load(){this.clear_actions();let e=await frappe.call({method:"digitz_erp.api.counter_session_api.get_state"});if(this.state=e.message||{},this.state.is_supervisor){this.render_board();return}let t=this.state.session;t&&t.status==="Open"?this.render_close():this.render_state()}header(e){let t=this.state;return`
			<div class="dayops-head">
				<div><div class="k">${__("Counter")}</div><div class="v">${this.esc(t.counter||t.session&&t.session.counter||"-")}</div></div>
				<div><div class="k">${__("Device")}</div><div class="v">${this.esc(t.device||"-")}</div></div>
				<div><div class="k">${__("Cashier")}</div><div class="v">${this.esc(t.user_full_name)}</div></div>
				${e||""}
			</div>`}render_state(){let e=this.state,t,s,o,c;e.session&&e.session.status==="Closing"?(t=__("Waiting for supervisor approval"),s=__("Your count for {0} is with a supervisor. They approve it before the day is closed.",[this.esc(e.session.name)]),o=__("View Session"),c=()=>frappe.set_route("Form","Counter Session",e.session.name)):(t=__("No day is open"),s=__("Open the day with the cash in the till before billing. The day is closed from here at the end of your shift."),o=e.counter?__("Go to Day Open"):null,c=()=>this.go("day-open")),this.$body.html(`${this.header()}
			<div class="dayops-card dayops-state">
				<div class="dayops-big">${t}</div>
				<p>${s}</p>
				${o?`<button class="btn btn-primary btn-sm dayops-go">${o}</button>`:""}
			</div>`),this.$body.find(".dayops-go").on("click",c)}render_close(){let e=this.state.session,t=this.state.payment_modes||[];this.$body.html(`${this.header(`
				<div><div class="k">${__("Session")}</div><div class="v"><a href="/app/counter-session/${encodeURIComponent(e.name)}">${this.esc(e.name)}</a></div></div>
				<div><div class="k">${__("Opened")}</div><div class="v">${frappe.datetime.str_to_user(e.opened_on)}</div></div>`)}
			<div class="dayops-grid${t.length?" dayops-grid-3":""}">
				<div>
					<div class="dayops-card"><h4>${__("Count the Closing Cash")}</h4><div class="dayops-count-wrap"></div></div>
				</div>
				${t.length?`<div>
					<div class="dayops-card">
						<h4>${__("Card, Bank & Other Payments")}</h4>
						<p class="text-muted small" style="margin: 0 0 8px;">${__("Enter today's total for each, from the card machine settlement or bank slips.")}</p>
						<div class="dayops-modes"></div>
					</div>
				</div>`:""}
				<div>
					<div class="dayops-card">
						<h4>${__("Close")}</h4>
						<div class="expenditure-field"></div>
						<div class="counted-field"></div>
						<div class="remarks-field"></div>
						<button class="btn btn-primary btn-block dayops-submit" style="margin-top: 8px;">${__("Close Day")}</button>
						<button class="btn btn-default btn-block dayops-handover" style="margin-top: 6px;">${__("Close & Hand Over")}</button>
						<p class="text-muted small" style="margin: 6px 0 0;">${__("Hand Over closes your day and logs you out, so the next cashier can sign in here and open with this count.")}</p>
					</div>
				</div>
			</div>`),this.mode_controls=t.map(s=>({payment_mode:s.payment_mode,control:frappe.ui.form.make_control({parent:this.$body.find(".dayops-modes"),df:{fieldtype:"Currency",fieldname:frappe.scrub(s.payment_mode),label:s.payment_mode},render_input:!0})})),this.expenditure=frappe.ui.form.make_control({parent:this.$body.find(".expenditure-field"),df:{fieldtype:"Currency",fieldname:"expenditure",label:__("Expenditure"),description:__("Cash paid out of the till today. Explain it in Remarks.")},render_input:!0}),this.counted=frappe.ui.form.make_control({parent:this.$body.find(".counted-field"),df:{fieldtype:"Currency",fieldname:"counted_cash",label:__("Counted Cash"),reqd:1,description:__("Filled from the count, or type the total.")},render_input:!0}),this.remarks=frappe.ui.form.make_control({parent:this.$body.find(".remarks-field"),df:{fieldtype:"Small Text",fieldname:"remarks",label:__("Remarks"),description:__("Anything the supervisor should know about the count.")},render_input:!0}),this.count=new digitz_erp.CashCount(this.$body.find(".dayops-count-wrap"),this.state.denominations,s=>{s&&this.counted.set_value(s)}),this.set_primary(__("Close Day"),()=>this.close_day(),"check"),this.$body.find(".dayops-submit").on("click",()=>this.close_day()),this.$body.find(".dayops-handover").on("click",()=>this.close_day(!0)),this.set_secondary(__("Refresh"),()=>this.load())}payment_totals(){return(this.mode_controls||[]).map(e=>({payment_mode:e.payment_mode,amount:e.control.get_value()})).filter(e=>e.amount!==void 0&&e.amount!==null&&e.amount!=="")}close_day(e){let t=this.counted.get_value();if(t==null||t===""){frappe.msgprint(__("Count the till, or enter the counted cash."));return}let s=flt(this.expenditure.get_value());if(s<0){frappe.msgprint(__("Expenditure cannot be negative."));return}let o=this.payment_totals();if(o.some(y=>flt(y.amount)<0)){frappe.msgprint(__("Payment totals cannot be negative."));return}let c=s?" "+__("Expenditure: {0}.",[this.money(s)]):"";frappe.confirm((e?__("Close your day with {0} counted in the till and log out for the next cashier?",[this.money(t)]):__("Close the day with {0} counted in the till?",[this.money(t)]))+c,()=>frappe.call({method:"digitz_erp.api.counter_session_api.close_day",args:{counted_cash:t,denominations:this.count.counted(),remarks:this.remarks.get_value(),expenditure:flt(this.expenditure.get_value()),payment_totals:o},freeze:!0,freeze_message:__("Closing the day..."),callback:y=>{!y.message||(this.changed(),this.show_closed(y.message,e))}}))}show_closed(e,t){this.clear_actions();let s=e.status==="Closed",o=t?`<button class="btn btn-primary btn-sm dayops-logout" style="margin-left: 6px;">${__("Log Out for Next Cashier")}</button>`:`<button class="btn btn-default btn-sm dayops-open" style="margin-left: 6px;">${__("Go to Day Open")}</button>`;this.$body.html(`${this.header()}
			<div class="dayops-card dayops-state">
				<div class="dayops-big">${s?__("Day closed"):__("Close sent for approval")}</div>
				<p>${s?__("{0} is closed.",[this.esc(e.session)]):__("{0} will close once a supervisor approves the count.",[this.esc(e.session)])}
				${t?"<br>"+__("The counter is free: the next cashier can sign in on this PC and open with your count."):""}</p>
				<button class="btn ${t?"btn-default":"btn-primary"} btn-sm dayops-print">${__("Print Day Close Slip")}</button>
				${o}
			</div>`),this.$body.find(".dayops-print").on("click",()=>this.print(e.session)),this.$body.find(".dayops-open").on("click",()=>this.go("day-open")),this.$body.find(".dayops-logout").on("click",()=>frappe.app.logout())}print(e){digitz_erp.DayOpsBase.print_slip(e)}async render_board(e){this.board_date=e||this.board_date||frappe.datetime.get_today();let t=await frappe.call({method:"digitz_erp.api.counter_session_api.get_day_overview",args:{date:this.board_date}}),s=this.overview=t.message,o=s.sessions||[],c=a=>o.filter(f=>f.status===a).length,y=a=>`<span class="indicator-pill ${{Open:"green",Closing:"orange",Closed:"blue"}[a]||"gray"}">${a==="Closing"?__("Awaiting Approval"):__(a)}</span>`,l=a=>a?moment(a).format("hh:mm A"):"",k=o.map(a=>`
			<th class="dcb-col">
				<div class="dcb-counter">${this.esc(a.counter)}</div>
				<div class="dcb-cashier">${this.esc(a.cashier_name)}</div>
				<div><a href="/app/counter-session/${encodeURIComponent(a.name)}">${this.esc(a.name)}</a></div>
				<div class="dcb-time">${l(a.opened_on)} \u2192 ${a.closed_on?l(a.closed_on):__("open")}</div>
				${a.carried_over?`<div class="dcb-note">${__("Opened {0}",[frappe.datetime.str_to_user(String(a.opened_on).split(" ")[0])])}</div>`:""}
				${a.amended_from?`<div class="dcb-note">${__("Corrects {0}",[this.esc(a.amended_from)])}</div>`:""}
				<div style="margin-top: 4px;">${y(a.status)}</div>
			</th>`).join(""),n=(a,f)=>a==null?'<td class="dayops-num text-muted">\u2014</td>':`<td class="dayops-num ${f==="difference"&&Math.abs(a)>=.005?a<0?"is-short":"is-over":""}">${this.money(a)}</td>`,u=(s.lines||[]).map(a=>a.kind==="section"?`<tr class="dcb-section"><td colspan="${o.length+2}">${this.esc(a.label)}</td></tr>`:`<tr class="dcb-${a.kind}"><td>${this.esc(a.label)}</td>${a.values.map(f=>n(f,a.kind)).join("")}
				${n(a.total,a.kind).replace('<td class="','<td class="dcb-total ')}</tr>`).join(""),g=o.map(a=>{let f=(i,p,_="btn-default")=>`<button class="btn btn-xs ${_}" data-act="${i}" data-name="${this.esc(a.name)}">${p}</button>`;return`<td class="dcb-actions">${{Open:f("close",a.is_own?__("Close My Day"):__("Count & Close"),"btn-primary"),Closing:f("approve",__("Approve"),"btn-primary")+f("edit",__("Edit")),Closed:f("edit",__("Reopen & Edit"))+f("slip",__("Print Slip"))}[a.status]||""}</td>`}).join(""),w=o.map(a=>`<td class="dcb-remarks" title="${this.esc(a.close_remarks)}">${this.esc(a.close_remarks)}</td>`).join("");this.$body.html(`
			<div class="dayops-card dcb-toolbar">
				<div class="dcb-date"></div>
				<div class="dcb-chips">
					<button class="dcb-chip" data-day="${frappe.datetime.get_today()}">${__("Today")}</button>
					<button class="dcb-chip" data-day="${frappe.datetime.add_days(frappe.datetime.get_today(),-1)}">${__("Yesterday")}</button>
				</div>
				<div class="dcb-summary text-muted">
					${__("{0} days",[o.length])} \xB7 ${__("{0} open",[c("Open")])} \xB7 ${__("{0} awaiting approval",[c("Closing")])} \xB7 ${__("{0} closed",[c("Closed")])}
				</div>
				<div class="dcb-buttons">
					<button class="btn btn-default btn-sm" data-tool="refresh">${__("Refresh")}</button>
					${frappe.user.has_role("System Manager")?`<button class="btn btn-default btn-sm" data-tool="excel">${__("Export to Excel")}</button>`:""}
					<button class="btn btn-primary btn-sm" data-tool="print">${__("Print Summary")}</button>
				</div>
			</div>
			${o.length?`
			<div class="dayops-card dcb-card">
				<div class="dcb-scroll">
					<table class="dcb-grid">
						<thead><tr><th></th>${k}<th class="dcb-col dcb-total">${__("Total")}</th></tr></thead>
						<tbody>${u}</tbody>
						<tfoot>
							<tr><td>${__("Remarks")}</td>${w}<td class="dcb-total"></td></tr>
							<tr><td></td>${g}<td class="dcb-total"></td></tr>
						</tfoot>
					</table>
				</div>
				<p class="text-muted small" style="margin: 8px 0 0;">${__("System is what the submitted documents add up to; Entered is what the cashier counted or typed at Day Close. A day still open shows its live figures, with nothing entered yet.")}</p>
			</div>`:`
			<div class="dayops-card dayops-state"><div class="dayops-big">${__("No days")}</div><p>${__("No day was opened on any counter on this date.")}</p></div>`}
		`),this.board_date_control=frappe.ui.form.make_control({parent:this.$body.find(".dcb-date"),df:{fieldtype:"Date",fieldname:"date",label:__("Date"),change:()=>{let a=this.board_date_control.get_value();a&&a!==this.board_date&&this.render_board(a)}},render_input:!0}),this.board_date_control.set_value(this.board_date),this.$body.find(".dcb-chip").each((a,f)=>f.classList.toggle("active",f.dataset.day===this.board_date)),this.$body.find("[data-day]").on("click",a=>this.render_board($(a.currentTarget).attr("data-day"))),this.$body.find("[data-tool]").on("click",a=>{let f=$(a.currentTarget).attr("data-tool");f==="refresh"?this.render_board():f==="excel"?window.open(`/api/method/digitz_erp.api.counter_session_api.export_day_overview?date=${encodeURIComponent(this.board_date)}`):this.print_summary()}),this.$body.find("[data-act]").on("click",a=>{let f=$(a.currentTarget).attr("data-name"),b=o.find(p=>p.name===f),i=$(a.currentTarget).attr("data-act");i==="slip"?this.print(f):i==="approve"?this.approve(b):this.count_dialog(b,i)}),this.set_primary(__("Print Summary"),()=>this.print_summary(),"printer"),this.set_secondary(__("Refresh"),()=>this.render_board())}async print_summary(){let e=await frappe.call({method:"digitz_erp.api.counter_session_api.get_day_summary_html",args:{date:this.board_date}}),t=window.open("","_blank");if(!t){frappe.msgprint(__("Allow pop-ups for this site to print the summary."));return}t.document.open(),t.document.write(e.message),t.document.close()}approve(e){frappe.confirm(__("Approve {0}'s count (difference {1}) and close the day?",[this.esc(e.cashier_name),this.money(e.difference)]),()=>frappe.call({method:"digitz_erp.api.counter_session_api.approve_close",args:{session:e.name},freeze:!0,callback:()=>{frappe.show_alert({message:__("{0} closed",[e.name]),indicator:"green"}),this.changed(),this.render_board()}}))}count_dialog(e,t){let s=t==="edit",o=this.overview.modes||[],c=s||!e.is_own,y=flt(e.expected_cash)+flt(e.cash_expenditure),l=new frappe.ui.Dialog({title:s?__("Correct {0}'s day on {1}",[this.esc(e.cashier_name),this.esc(e.counter)]):__("Close {0}'s day on {1}",[this.esc(e.cashier_name),this.esc(e.counter)]),size:"large",fields:[{fieldtype:"HTML",fieldname:"summary",options:`<p>${__("Expected cash in the till")}: <b class="sv-expected"></b>
						<span class="text-muted">(${__("float")} ${this.money(e.opening_float)})</span></p>`},{fieldtype:"Currency",fieldname:"expenditure",label:__("Expenditure"),default:s?e.cash_expenditure:void 0,description:__("Cash paid out of the till."),change:()=>k()},{fieldtype:"HTML",fieldname:"count_wrap"},{fieldtype:"Column Break"},{fieldtype:"Currency",fieldname:"counted_cash",label:__("Counted Cash"),reqd:1,default:s?e.counted_cash:void 0,description:__("Filled from the count, or type the total."),change:()=>k()},{fieldtype:"HTML",fieldname:"result"},...o.map((u,g)=>({fieldtype:"Currency",fieldname:`mode_${g}`,label:u.payment_mode,default:s?e.modes[u.payment_mode].entered:void 0,description:__("System: {0}",[this.money(e.modes[u.payment_mode].system)])})),{fieldtype:"Small Text",fieldname:"remarks",label:s?__("Reason for the correction"):__("Reason"),reqd:c?1:0,description:s?__("Added to the day's remarks with your name. The original close stays on record."):__("Why you are closing this day for the cashier. Shown on the Day Close slip.")}],primary_action_label:s?e.status==="Closed"?__("Reopen & Save"):__("Save & Approve"):__("Count & Close"),primary_action:u=>{frappe.call({method:s?"digitz_erp.api.counter_session_api.edit_close":"digitz_erp.api.counter_session_api.supervisor_close",args:{session:e.name,counted_cash:u.counted_cash,denominations:n.counted(),remarks:u.remarks,expenditure:flt(u.expenditure),payment_totals:o.map((g,w)=>({payment_mode:g.payment_mode,amount:u[`mode_${w}`]})).filter(g=>g.amount!==void 0&&g.amount!==null&&g.amount!=="")},freeze:!0,freeze_message:s?__("Saving the correction..."):__("Closing the day..."),callback:g=>{!g.message||(l.hide(),frappe.show_alert({message:__("{0} closed",[g.message.session]),indicator:"green"}),this.changed(),this.render_board())}})}}),k=()=>{let u=y-flt(l.get_value("expenditure"));l.fields_dict.summary.$wrapper.find(".sv-expected").text(this.money(u));let g=l.get_value("counted_cash"),w=l.fields_dict.result.$wrapper.empty();if(g==null||g==="")return;let a=flt(g)-u;w.html(Math.abs(a)<.005?`<div class="dayops-result ok">${__("Matches the expected cash.")}</div>`:`<div class="dayops-result ${a<0?"short":"over"}">
					${a<0?__("Short by {0}",[this.money(-a)]):__("Over by {0}",[this.money(a)])}
					<div style="font-weight: normal; font-size: 12px; margin-top: 4px;">${__("Saving approves this difference in your name.")}</div>
				</div>`)},n=new digitz_erp.CashCount(l.fields_dict.count_wrap.$wrapper,this.overview.denominations,u=>{u&&l.set_value("counted_cash",u)});s&&e.denominations.length&&n.set_counts(e.denominations),l.show(),k()}};var D;digitz_erp.DayHistory=(D=class{constructor(e){this.$el=$('<div class="cc-history"></div>').appendTo(e),this.is_supervisor=!1,this.reload=frappe.utils.debounce(()=>this.load(),300),this.make()}money(e){return format_currency(e,frappe.boot.sysdefaults.currency)}esc(e){return frappe.utils.escape_html(e==null?"":String(e))}make(){this.$el.html(`
			<div class="cc-hist-filters">
				<div class="cc-hist-fields"></div>
				<div class="cc-hist-chips">
					<button type="button" class="cc-hist-chip" data-range="today">${__("Today")}</button>
					<button type="button" class="cc-hist-chip" data-range="week">${__("This Week")}</button>
					<button type="button" class="cc-hist-chip" data-range="month">${__("This Month")}</button>
					<button type="button" class="cc-hist-chip" data-range="30">${__("Last 30 Days")}</button>
				</div>
			</div>
			<div class="cc-hist-tiles"></div>
			<div class="cc-hist-table"></div>
		`);let e=this.$el.find(".cc-hist-fields"),t=(o,c)=>{let y=$(`<div class="cc-hist-field ${c||""}"></div>`).appendTo(e);return frappe.ui.form.make_control({parent:y,df:O(S({},o),{change:()=>this.reload()}),render_input:!0})},s=frappe.datetime.get_today();this.fields={from_date:t({fieldtype:"Date",fieldname:"from_date",label:__("From")}),to_date:t({fieldtype:"Date",fieldname:"to_date",label:__("To")}),status:t({fieldtype:"Select",fieldname:"status",label:__("Status"),options:[{value:"",label:__("All")},{value:"Open",label:__("Open")},{value:"Closing",label:__("Awaiting Approval")},{value:"Closed",label:__("Closed")}]}),counter:t({fieldtype:"Link",fieldname:"counter",label:__("Counter"),options:"Counter"},"cc-hist-sup hide"),cashier:t({fieldtype:"Link",fieldname:"cashier",label:__("Cashier"),options:"User"},"cc-hist-sup hide")},this.fields.from_date.set_value(frappe.datetime.add_days(s,-29)),this.fields.to_date.set_value(s),this.mark_chip("30"),this.$el.on("click",".cc-hist-chip",o=>this.set_range($(o.currentTarget).attr("data-range"))),this.$el.on("click","[data-print]",o=>digitz_erp.DayOpsBase.print_slip($(o.currentTarget).attr("data-print"))),this.$el.on("click",".cc-hist-report",()=>{frappe.route_options=this.filters(),frappe.set_route("query-report","Counter Session Summary")})}set_range(e){let t=frappe.datetime.get_today(),s={today:t,week:frappe.datetime.week_start(),month:frappe.datetime.month_start(),30:frappe.datetime.add_days(t,-29)}[e];this.fields.from_date.set_value(s),this.fields.to_date.set_value(t),this.mark_chip(e)}mark_chip(e){this.$el.find(".cc-hist-chip").each((t,s)=>s.classList.toggle("active",s.dataset.range===e))}filters(){let e={};return Object.entries(this.fields).forEach(([t,s])=>{let o=s.get_value();o&&(this.is_supervisor||!["counter","cashier"].includes(t))&&(e[t]=o)}),e}async load(){let e=this.seq=(this.seq||0)+1;this.$el.addClass("is-loading");try{let t=await frappe.call({method:"digitz_erp.api.counter_session_api.get_session_history",args:this.filters()});if(e!==this.seq||!t.message)return;this.is_supervisor=t.message.is_supervisor,this.$el.find(".cc-hist-sup").toggleClass("hide",!this.is_supervisor),this.render_tiles(t.message.totals),this.render_table(t.message.rows)}finally{e===this.seq&&this.$el.removeClass("is-loading")}}render_tiles(e){let t=Math.abs(flt(e.net_difference))<.005?"":e.net_difference<0?"is-short":"is-over",s=(o,c,y="")=>`
			<div class="cc-hist-tile ${y}">
				<div class="cc-hist-tile-label">${o}</div>
				<div class="cc-hist-tile-value">${c}</div>
			</div>`;this.$el.find(".cc-hist-tiles").html(s(__("Days"),e.days)+(this.is_supervisor?s(__("Cash Sales"),this.money(e.cash_sales))+s(__("Cash Receipts"),this.money(e.cash_receipts)):s(__("Counted Cash"),this.money(e.counted_cash)))+s(__("Card, Bank & Other"),this.money(e.non_cash_total))+s(__("Expenditure"),this.money(e.cash_expenditure))+(this.is_supervisor?s(__("Net Difference"),this.money(e.net_difference),t):"")+s(__("Open / Awaiting"),e.pending,e.pending?"is-pending":""))}render_table(e){let t=this.$el.find(".cc-hist-table"),s=this.is_supervisor?`<button type="button" class="btn btn-xs btn-default cc-hist-report">${__("Open full report")}</button>`:"";if(!e.length){t.html(`
				<div class="cc-hist-empty">
					<p>${__("No days in this range.")}</p>
					${s}
				</div>`);return}let o=n=>n?moment(n).format("hh:mm A"):"",c=n=>n?frappe.datetime.str_to_user(String(n).split(" ")[0]):"",y=n=>n.status==="Open",l=this.is_supervisor,k=e.map(n=>{let u=n.closed_on?c(n.closed_on)===c(n.opened_on)?o(n.closed_on):`${c(n.closed_on)} ${o(n.closed_on)}`:`<span class="text-muted">${__("Still open")}</span>`,g=flt(n.difference),w=y(n)||Math.abs(g)<.005?"":g<0?"is-short":"is-over",a=b=>y(n)?'<span class="text-muted">\u2014</span>':this.money(b),f=n.status==="Closing"?__("Awaiting Approval"):__(n.status);return`
				<tr>
					<td>${c(n.opened_on)}</td>
					<td><a href="/app/counter-session/${encodeURIComponent(n.name)}">${this.esc(n.name)}</a></td>
					<td>${this.esc(n.counter)}</td>
					${this.is_supervisor?`<td>${this.esc(n.cashier_name)}</td>`:""}
					<td class="cc-nowrap">${o(n.opened_on)} \u2192 ${u}</td>
					<td class="cc-num">${this.money(n.opening_float)}</td>
					${l?`<td class="cc-num">${a(n.expected_cash)}</td>`:""}
					<td class="cc-num">${a(n.counted_cash)}</td>
					<td class="cc-num">${a(n.non_cash_total)}</td>
					${l?`<td class="cc-num ${w}">${a(g)}</td>`:`<td class="cc-num">${a(n.cash_expenditure)}</td>`}
					<td><span class="indicator-pill ${digitz_erp.DayHistory.STATUS_COLOURS[n.status]||"gray"}">${f}</span></td>
					<td class="cc-num cc-nowrap">
						${y(n)?"":`<button type="button" class="btn btn-xs btn-default" data-print="${this.esc(n.name)}">${__("Print Slip")}</button>`}
					</td>
				</tr>`}).join("");t.html(`
			<div class="cc-hist-scroll">
				<table class="cc-hist-grid">
					<thead><tr>
						<th>${__("Date")}</th><th>${__("Session")}</th><th>${__("Counter")}</th>
						${this.is_supervisor?`<th>${__("Cashier")}</th>`:""}
						<th>${__("Opened \u2192 Closed")}</th>
						<th class="cc-num">${__("Float")}</th>
						${l?`<th class="cc-num">${__("Expected")}</th>`:""}
						<th class="cc-num">${__("Counted")}</th><th class="cc-num">${__("Card, Bank & Other")}</th>
						<th class="cc-num">${l?__("Difference"):__("Expenditure")}</th>
						<th>${__("Status")}</th><th></th>
					</tr></thead>
					<tbody>${k}</tbody>
				</table>
			</div>
			<div class="cc-hist-foot">
				<span class="text-muted small">${l?__("Expected and counted cash are worked out when a day is closed."):__("Your count is filled in when you close the day.")}</span>
				${s}
			</div>`)}},A(D,"STATUS_COLOURS",{Open:"green",Closing:"orange",Closed:"gray"}),D);})();
//# sourceMappingURL=counter_device.bundle.XKVNC3SY.js.map
