(()=>{var j=Object.defineProperty,M=Object.defineProperties;var I=Object.getOwnPropertyDescriptors;var D=Object.getOwnPropertySymbols;var U=Object.prototype.hasOwnProperty,L=Object.prototype.propertyIsEnumerable;var z=(d,e,t)=>e in d?j(d,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):d[e]=t,O=(d,e)=>{for(var t in e||(e={}))U.call(e,t)&&z(d,t,e[t]);if(D)for(var t of D(e))L.call(e,t)&&z(d,t,e[t]);return d},S=(d,e)=>M(d,I(e));var P=(d,e,t)=>(z(d,typeof e!="symbol"?e+"":e,t),t);(function(){let d="digitz_erp.api.counter_api.",e="digitz_erp.api.counter_session_api.",t="digitz_counter_device_secret",s=i=>frappe.utils.escape_html(i==null?"":String(i)),a=i=>format_currency(i,frappe.boot.sysdefaults.currency);function o(){try{return window.localStorage.getItem(t)}catch(i){return null}}function l(i){try{window.localStorage.setItem(t,i)}catch(u){}}function p(i){if(!i.counter){let f=i.registration_request;return f&&f.approval_status==="Pending"?{text:`${__("Approval pending")} \xB7 ${f.counter}`,colour:"orange"}:f&&f.approval_status==="Rejected"?{text:`${__("Request rejected")} \xB7 ${f.counter}`,colour:"red"}:{text:__("Unregistered device"),colour:"red"}}let u=`${i.counter} \xB7 ${i.device}`,_=i.session;if(_&&_.status==="Closing")return{text:`${u} \xB7 ${__("Close awaiting approval")}`,colour:"orange"};if(_){let f=frappe.datetime.str_to_user(_.opened_on).split(" ").pop();return{text:`${u} \xB7 ${__("Day open since {0}",[f])}`,colour:"green"}}return{text:`${u} \xB7 ${__("Day not opened")}`,colour:i.must_open_day?"orange":"blue"}}function n(i){$("#digitz-counter-badge").remove();let{text:u,colour:_}=p(i),f=(i.pending_approvals||0)+(i.device_requests||0),h=f?` <span class="badge badge-pill" style="background: var(--orange-500, #f59e0b); color: #fff;"
				title="${s(__("Day closes and device requests waiting for your approval"))}">${f}</span>`:"",c=$(`
			<li class="nav-item" id="digitz-counter-badge">
				<span class="indicator-pill ${_}" style="margin: 0 8px; white-space: nowrap; cursor: pointer;">
					${s(u)}${h}
				</span>
			</li>
		`);c.on("click",()=>x(i));let r=$("header .navbar-collapse .navbar-nav").first(),y=r.find(".dropdown-notifications").first();y.length?c.insertBefore(y):r.prepend(c)}function x(i){if(i.device_requests&&i.is_supervisor){w(i);return}if(i.pending_approvals&&i.is_supervisor&&!i.session){frappe.set_route("day-close");return}if(!i.counter){let u=i.registration_request;i.can_register?b(i):u&&u.approval_status==="Pending"?frappe.msgprint({title:__("Approval pending"),message:__("You asked for this PC to become {0}'s PC ({1}). That counter already has a PC, so a supervisor must approve it. The badge turns green when they do.",[s(u.counter),s(u.device)]),indicator:"orange"}):i.is_cashier?k(i):frappe.msgprint(__("This PC is not registered as a counter. Ask a supervisor to register it."));return}frappe.set_route(i.session?"day-close":"day-open")}let g="__new__";function C(i){let u=(i||[]).map(_=>(/^Counter (\d+)$/.exec(_)||[])[1]).filter(Boolean).map(Number);return`Counter ${Math.max(0,...u)+1}`}function b(i){let u=i.counters||[],_=new frappe.ui.Dialog({title:__("Register this device"),fields:[{fieldname:"counter",fieldtype:"Select",label:__("Counter"),reqd:1,options:[...u.map(h=>({label:h,value:h})),{label:__("+ New counter"),value:g}],default:i.counter||u[0]||g,change:()=>f()},{fieldname:"new_counter",fieldtype:"Data",label:__("New counter name"),default:C(u),depends_on:`eval:doc.counter=='${g}'`,mandatory_depends_on:`eval:doc.counter=='${g}'`,description:__("The counter is created now, and this PC registered to it.")},{fieldtype:"HTML",options:`<p class="text-muted small">${i.device?__("This PC is currently {0} ({1}). Registering again gives it a new device number.",[s(i.device),s(i.counter)]):__("This PC gets its own device number. Everything saved here is recorded against the counter you choose.")}</p>`},{fieldname:"replaced",fieldtype:"HTML"}],primary_action_label:__("Register"),primary_action(h){let c=h.counter===g;frappe.call({method:d+"register_device",args:c?{new_counter:h.new_counter}:{counter:h.counter},freeze:!0,callback(r){if(!r.message)return;l(r.message.secret),_.hide();let y=(r.message.disabled||[]).length?" "+__("Disabled: {0}",[r.message.disabled.join(", ")]):"";frappe.show_alert({message:__("This PC is now {0} ({1})",[r.message.counter,r.message.device])+y,indicator:"green"}),v()}})}});function f(){let h=_.get_value("counter"),c=_.fields_dict.replaced.$wrapper.empty();_.get_primary_btn().text(__("Register")),!(!h||h===g)&&frappe.call({method:d+"get_registration_preview",args:{counter:h},callback(r){if(_.get_value("counter")!==h)return;let y=r.message||[];if(!y.length)return;let R=m=>moment(m).format("DD-MM-YYYY, hh:mm A"),A=y.map(m=>{let q=m.last_seen?__("Last seen {0}",[R(m.last_seen)]):__("Never seen"),E=m.open_session?`
							<div class="cd-replace-open">
								${frappe.utils.icon("es-line-time","xs")}
								<span>${m.counter===h?__("{0}'s day {1} is still open. It carries on on this PC: no new Day Open is needed.",[`<b>${s(m.cashier_name)}</b>`,s(m.open_session)]):__("{0}'s day {1} is still open on {2}. Close it from any PC, or register a new {2} PC to carry on.",[`<b>${s(m.cashier_name)}</b>`,s(m.open_session),s(m.counter)])}</span>
							</div>`:"";return`
							<li class="cd-replace-item">
								<div class="cd-replace-device"><b>${s(m.device)}</b> \xB7 ${s(m.counter)} <span class="cd-replace-seen">${s(q)}</span></div>
								${E}
							</li>`}).join("");c.html(`
						<div class="cd-replace-warning" role="alert">
							<div class="cd-replace-head">
								${frappe.utils.icon("solid-warning","sm")}
								<span>${y.length===1?__("Registering replaces the PC now on {0}",[s(h)]):__("Registering replaces {0} PCs",[y.length])}</span>
							</div>
							<ul class="cd-replace-list">${A}</ul>
							<div class="cd-replace-foot">${s(__("A counter has one PC. The replaced PC stops working as a counter until it is registered again."))}</div>
						</div>`),_.get_primary_btn().text(__("Register & Replace"))}})}_.show(),f()}function k(i){frappe.call({method:d+"get_request_options",callback(u){let _=u.message||[];if(!_.length){frappe.msgprint(__("There are no counters yet. Ask a supervisor to register this PC."));return}let f=i.registration_request&&i.registration_request.approval_status==="Rejected"?`<p class="small" style="color: var(--red-600, #dc2626);">${s(__("Your last request for {0} was rejected. Ask a supervisor why before asking again.",[i.registration_request.counter]))}</p>`:"",h=new frappe.ui.Dialog({title:__("Ask to register this PC"),fields:[{fieldtype:"HTML",options:f},{fieldname:"counter",fieldtype:"Select",label:__("Counter"),reqd:1,options:_.map(c=>({value:c.counter,label:c.device?__("{0} \xB7 has a PC ({1}), needs approval",[c.counter,c.device]):__("{0} \xB7 free, ready at once",[c.counter])})),default:(_.find(c=>!c.device)||_[0]).counter},{fieldtype:"HTML",options:`<p class="text-muted small">${__("A free counter becomes this PC's at once. A counter that already has a PC needs a supervisor's approval, because this PC would replace it.")}</p>`}],primary_action_label:__("Ask"),primary_action(c){frappe.call({method:d+"request_device",args:{counter:c.counter},freeze:!0,callback(r){if(!r.message)return;l(r.message.secret),h.hide();let y=r.message.status==="Approved";frappe.show_alert({message:y?__("This PC is now {0} ({1})",[r.message.counter,r.message.device]):__("Approval pending: a supervisor must approve this PC for {0}",[r.message.counter]),indicator:y?"green":"orange"},8),v()}})}});h.show()}})}function w(i){let u=new frappe.ui.Dialog({title:__("PCs waiting for approval"),size:"large",fields:[{fieldname:"list",fieldtype:"HTML"}]});function _(){frappe.call({method:d+"get_device_requests",callback(f){let h=f.message||[],c=u.fields_dict.list.$wrapper;h.length?c.html(`
							<p class="text-muted small">${__("Approving makes the PC its counter's PC and disables the one it replaces. A day open on the old PC carries on on the new one.")}</p>
							<table class="table table-sm">
								<thead><tr><th>${__("Counter")}</th><th>${__("Asked by")}</th><th>${__("Replaces")}</th><th></th></tr></thead>
								<tbody>${h.map(r=>`
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
							</table>`):c.html(`<p class="text-muted">${__("No requests are waiting.")}</p>`),i.pending_approvals&&c.append(`<p><a class="small" href="/app/day-close">${__("{0} day close(s) also wait for approval",[i.pending_approvals])}</a></p>`)}})}u.fields_dict.list.$wrapper.on("click","button[data-action]",f=>{let h=$(f.currentTarget).closest("tr").attr("data-device");$(f.currentTarget).attr("data-action")==="approve"?frappe.call({method:d+"approve_device_request",args:{device:h},freeze:!0,callback(c){c.message&&(frappe.show_alert({message:__("{0} is now {1}'s PC",[c.message.device,c.message.counter]),indicator:"green"}),_(),v())}}):frappe.prompt({fieldname:"reason",fieldtype:"Small Text",label:__("Reason (shown on the device record)")},c=>frappe.call({method:d+"reject_device_request",args:{device:h,reason:c.reason},callback(){_(),v()}}),__("Reject {0}",[h]),__("Reject"))}),u.show(),_()}function v(){frappe.call({method:d+"resolve_device",args:{secret:o()},callback(){frappe.call({method:e+"get_state",callback(i){i.message&&(n(i.message),digitz_erp.counter_state=i.message,$(document).trigger("digitz:counter-state",[i.message]))}})}})}frappe.provide("digitz_erp"),digitz_erp.refresh_counter_badge=v,digitz_erp.open_register_device_dialog=b,$(document).on("app_ready",()=>{v(),frappe.realtime.on("digitz_counter_devices",v)})})();frappe.provide("digitz_erp");digitz_erp.CashCount=class{constructor(e,t,s){this.denominations=t||[],this.on_change=s,this.$el=$(`
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
			</table>`).appendTo(e),this.$el.on("input","input",()=>this.update())}rows(){return this.$el.find("tbody tr").toArray().map(e=>({denomination:flt($(e).attr("data-value")),count:cint($(e).find("input").val())}))}total(){return this.rows().reduce((e,t)=>e+t.denomination*t.count,0)}update(){let e=s=>format_currency(s,frappe.boot.sysdefaults.currency);this.$el.find("tbody tr").each((s,a)=>{let o=flt($(a).attr("data-value"))*cint($(a).find("input").val());$(a).find(".dayops-line").text(o?e(o):"-")});let t=this.total();this.$el.find(".dayops-total").text(t?e(t):"-"),this.on_change&&this.on_change(t)}counted(){return this.rows().filter(e=>e.count)}set_counts(e){let t={};(e||[]).forEach(s=>t[flt(s.denomination)]=cint(s.count)),this.$el.find("tbody tr").each((s,a)=>{let o=t[flt($(a).attr("data-value"))];$(a).find("input").val(o||"")}),this.update()}};digitz_erp.dayops_styles=function(){if(document.getElementById("dayops-styles"))return;let d=document.createElement("style");d.id="dayops-styles",d.textContent=`
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
`,document.head.appendChild(d)};frappe.provide("digitz_erp");digitz_erp.DayOpsBase=class{constructor(e,t={},s=null){this.page=e,this.opts=t,this.embedded=!!t.embedded,this.$parent=$(t.parent||e.main),!this.embedded&&s&&e.add_inner_button(__("Help"),()=>frappe.set_route("digitz-help",s)),digitz_erp.dayops_styles(),this.$body=$('<div class="dayops"></div>').appendTo(this.$parent)}money(e){return format_currency(e,frappe.boot.sysdefaults.currency)}esc(e){return frappe.utils.escape_html(e==null?"":String(e))}set_primary(e,t,s){!this.embedded&&this.page.set_primary_action(e,t,s)}set_secondary(e,t){!this.embedded&&this.page.set_secondary_action(e,t)}clear_actions(){this.embedded||(this.page.clear_primary_action(),this.page.clear_secondary_action())}go(e){this.embedded?frappe.set_route("cashier-console",e):frappe.set_route(e)}changed(){digitz_erp.refresh_counter_badge&&digitz_erp.refresh_counter_badge(),this.opts.on_change&&this.opts.on_change()}static print_slip(e){window.open(frappe.urllib.get_full_url(`/printview?doctype=${encodeURIComponent("Counter Session")}&name=${encodeURIComponent(e)}&format=${encodeURIComponent("Day Close Slip")}&trigger_print=1`))}};digitz_erp.DayOpen=class extends digitz_erp.DayOpsBase{constructor(e,t){super(e,t,"day-open")}async load(){this.clear_actions();let e=await frappe.call({method:"digitz_erp.api.counter_session_api.get_state"});this.state=e.message||{},this.render()}header(){let e=this.state;return`
			<div class="dayops-head">
				<div><div class="k">${__("Counter")}</div><div class="v">${frappe.utils.escape_html(e.counter||__("Unregistered"))}</div></div>
				<div><div class="k">${__("Device")}</div><div class="v">${frappe.utils.escape_html(e.device||"-")}</div></div>
				<div><div class="k">${__("Cashier")}</div><div class="v">${frappe.utils.escape_html(e.user_full_name||frappe.session.user)}</div></div>
				<div><div class="k">${__("Date")}</div><div class="v">${frappe.datetime.str_to_user(e.now)}</div></div>
			</div>`}state_panel(e,t,s,a){this.$body.html(`${this.header()}
			<div class="dayops-card dayops-state">
				<div class="dayops-big">${e}</div>
				<p>${t}</p>
				${s?`<button class="btn btn-primary btn-sm dayops-go">${s}</button>`:""}
			</div>`),this.$body.find(".dayops-go").on("click",a)}render(){let e=this.state;if(!e.counter)return this.state_panel(__("This PC is not a registered counter"),e.can_register?__("Register it to a counter first. Every day opened here then belongs to that counter."):__("Ask a supervisor to register this PC as a counter before opening the day."),e.can_register?__("Register this device"):null,()=>digitz_erp.open_register_device_dialog(e));if(e.session&&e.session.status==="Closing")return this.state_panel(__("Your last close is waiting for approval"),__("A supervisor has to approve the cash difference on {0} before a new day can be opened.",[e.session.name]),__("View Day Close"),()=>this.go("day-close"));if(e.session)return this.state_panel(__("Your day is already open"),__("Open on {0} since {1}, with a float of {2}.",[frappe.utils.escape_html(e.session.counter),frappe.datetime.str_to_user(e.session.opened_on),this.money(e.session.opening_float)]),__("Go to Day Close"),()=>this.go("day-close"));if(e.counter_taken){let p=e.counter_taken;return this.state_panel(__("{0} is in use",[frappe.utils.escape_html(e.counter)]),__("{0} has a day open here since {1} ({2}). They close it with Close & Hand Over, or a supervisor closes it for them from Day Close.",[frappe.utils.escape_html(p.cashier_name),frappe.datetime.str_to_user(p.opened_on),frappe.utils.escape_html(p.name)]),e.is_supervisor?__("Go to Day Close"):null,()=>this.go("day-close"))}let t=e.last_close,s=t&&t.closed_by&&t.closed_by!==t.cashier?`<tr><td>${__("Counted by supervisor")}</td><td class="dayops-num">${frappe.utils.escape_html(t.closed_by_name||t.closed_by)}</td></tr>`:"",a=t&&t.status==="Closing"?`<div class="dayops-result over" style="margin-bottom: 10px;">${__("This close is still waiting for a supervisor to approve its difference. The count below is what was left in the till.")}</div>`:"",o=t?`
				${a}
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
				<p class="text-muted small" style="margin: 6px 0 0;">${__("For a handover: fills the count with what was left in the till. Check it against the notes before opening.")}</p>`:`<p class="text-muted">${__("No day has been closed on this counter yet.")}</p>`,l=`<div class="dayops-card"><h4>${__("Count the Opening Cash")}</h4><div class="dayops-count-wrap"></div></div>`;this.$body.html(`${this.header()}
			<div class="dayops-grid">
				<div>
					${e.show_last_close===0?l:`<div class="dayops-card"><h4>${__("Previous Close on this Counter")}</h4>${o}</div>`}
				</div>
				<div>
					${e.show_last_close===0?"":l}
					<div class="dayops-card">
						<h4>${__("Opening Float")}</h4>
						<div class="float-field"></div>
						<div class="float-note"></div>
						<div class="remarks-field"></div>
						<button class="btn btn-primary btn-block dayops-submit" style="margin-top: 8px;">${__("Open Day")}</button>
					</div>
				</div>
			</div>`),this.float=frappe.ui.form.make_control({parent:this.$body.find(".float-field"),df:{fieldtype:"Currency",fieldname:"opening_float",label:__("Opening Float"),reqd:1,description:__("Filled from the count, or type the total."),change:()=>this.show_float_note()},render_input:!0}),this.float.set_value(t?flt(t.counted_cash):0),this.remarks=frappe.ui.form.make_control({parent:this.$body.find(".remarks-field"),df:{fieldtype:"Small Text",fieldname:"remarks",label:__("Remarks")},render_input:!0}),this.count=new digitz_erp.CashCount(this.$body.find(".dayops-count-wrap"),e.denominations,p=>{p&&this.float.set_value(p)}),this.$body.find(".dayops-takeover").on("click",()=>this.take_over()),this.show_float_note(),this.set_primary(__("Open Day"),()=>this.open_day(),"check"),this.$body.find(".dayops-submit").on("click",()=>this.open_day())}take_over(){let e=this.state.last_close;(e.denominations||[]).length?this.count.set_counts(e.denominations):this.float.set_value(flt(e.counted_cash)),this.remarks.get_value()||this.remarks.set_value(__("Taken over from {0} ({1})",[e.cashier_name||e.cashier,e.name]))}show_float_note(){let e=this.state.last_close,t=this.$body.find(".float-note").empty();if(!e)return;let s=flt(this.float.get_value())-flt(e.counted_cash);Math.abs(s)<.005?t.html(`<div class="dayops-result ok">${__("Same as the cash left at the last close")}</div>`):t.html(`<div class="dayops-result over">${s<0?__("{0} less than the last close (cash taken out or banked)",[this.money(-s)]):__("{0} more than the last close (cash added)",[this.money(s)])}</div>`)}open_day(){let e=flt(this.float.get_value());frappe.confirm(__("Open the day on {0} with a float of {1}?",[frappe.utils.escape_html(this.state.counter),this.money(e)]),()=>frappe.call({method:"digitz_erp.api.counter_session_api.open_day",args:{opening_float:e,denominations:this.count.counted(),remarks:this.remarks.get_value()},freeze:!0,freeze_message:__("Opening the day..."),callback:t=>{!t.message||(frappe.show_alert({message:__("Day opened on {0} ({1})",[t.message.counter,t.message.session]),indicator:"green"}),this.changed(),this.load())}}))}};var H=()=>[{field:"cash_sales",label:__("Cash Sales"),sign:"+"},{field:"cash_receipts",label:__("Cash Receipts (Credit Collections)"),sign:"+"},{field:"cash_refunds",label:__("Cash Refunds"),sign:"\u2212"},{field:"cash_paid_out",label:__("Cash Paid Out"),sign:"\u2212"}];digitz_erp.DayClose=class extends digitz_erp.DayOpsBase{constructor(e,t){super(e,t,"day-close"),this.$approvals=$('<div class="dayops"></div>').appendTo(this.$parent)}async load(){this.clear_actions();let e=await frappe.call({method:"digitz_erp.api.counter_session_api.get_state"});this.state=e.message||{};let t=this.state.session;if(t&&t.status==="Open"){let s=await frappe.call({method:"digitz_erp.api.counter_session_api.get_close_preview"});this.preview=s.message,this.render_close()}else this.render_state();this.render_approvals()}header(e){let t=this.state;return`
			<div class="dayops-head">
				<div><div class="k">${__("Counter")}</div><div class="v">${this.esc(t.counter||t.session&&t.session.counter||"-")}</div></div>
				<div><div class="k">${__("Device")}</div><div class="v">${this.esc(t.device||"-")}</div></div>
				<div><div class="k">${__("Cashier")}</div><div class="v">${this.esc(t.user_full_name)}</div></div>
				${e||""}
			</div>`}render_state(){let e=this.state,t,s,a,o;e.session&&e.session.status==="Closing"?(t=__("Waiting for supervisor approval"),s=__("Your count for {0} differs from the expected cash. A supervisor has to approve it before the day is closed.",[this.esc(e.session.name)]),a=__("View Session"),o=()=>frappe.set_route("Form","Counter Session",e.session.name)):(t=__("No day is open"),s=__("Open the day with the cash in the till before billing. The day is closed from here at the end of your shift."),a=e.counter?__("Go to Day Open"):null,o=()=>this.go("day-open")),this.$body.html(`${this.header()}
			<div class="dayops-card dayops-state">
				<div class="dayops-big">${t}</div>
				<p>${s}</p>
				${a?`<button class="btn btn-primary btn-sm dayops-go">${a}</button>`:""}
			</div>`),this.$body.find(".dayops-go").on("click",o)}render_close(){let e=this.preview,t=e.documents||{},s=H().map(a=>{let o=t[a.field]||[],l=o.map(p=>`
				<tr class="dayops-docs" data-for="${a.field}" style="display: none;">
					<td><a href="/app/${frappe.router.slug(p.doctype)}/${encodeURIComponent(p.name)}">${this.esc(p.name)}</a>
						${p.posting_time?" \xB7 "+this.esc(String(p.posting_time).slice(0,5)):""}
						${p.party?" \xB7 "+this.esc(p.party):""}</td>
					<td class="dayops-num">${this.money(p.amount)}</td>
				</tr>`).join("");return`
				<tr class="dayops-toggle" data-toggle="${a.field}">
					<td><span class="dayops-caret">${o.length?"\u25B8":""}</span>${a.sign} ${a.label}
						<span class="text-muted small">(${o.length})</span></td>
					<td class="dayops-num">${this.money(e[a.field])}</td>
				</tr>${l}`}).join("");this.$body.html(`${this.header(`
				<div><div class="k">${__("Session")}</div><div class="v"><a href="/app/counter-session/${encodeURIComponent(e.name)}">${this.esc(e.name)}</a></div></div>
				<div><div class="k">${__("Opened")}</div><div class="v">${frappe.datetime.str_to_user(e.opened_on)}</div></div>`)}
			<div class="dayops-grid">
				<div>
					<div class="dayops-card">
						<h4>${__("Cash for the Day")}</h4>
						<table class="dayops-lines">
							<tr><td>${__("Opening Float")}</td><td class="dayops-num">${this.money(e.opening_float)}</td></tr>
							${s}
							<tr><td>\u2212 ${__("Expenditure")} <span class="text-muted small">(${__("entered below")})</span></td><td class="dayops-num dayops-exp">${this.money(0)}</td></tr>
							<tr class="total"><td>${__("Expected Cash in the Till")}</td><td class="dayops-num dayops-expected">${this.money(e.expected_cash)}</td></tr>
						</table>
						<p class="text-muted small" style="margin-top: 8px;">${__("Only submitted documents with a cash payment mode count. Click a line to see its documents.")}</p>
					</div>
				</div>
				<div>
					<div class="dayops-card"><h4>${__("Count the Closing Cash")}</h4><div class="dayops-count-wrap"></div></div>
					<div class="dayops-card">
						<h4>${__("Close")}</h4>
						<div class="expenditure-field"></div>
						<div class="counted-field"></div>
						<div class="close-result"></div>
						<div class="remarks-field"></div>
						<button class="btn btn-primary btn-block dayops-submit" style="margin-top: 8px;">${__("Close Day")}</button>
						<button class="btn btn-default btn-block dayops-handover" style="margin-top: 6px;">${__("Close & Hand Over")}</button>
						<p class="text-muted small" style="margin: 6px 0 0;">${__("Hand Over closes your day and logs you out, so the next cashier can sign in here and open with this count.")}</p>
					</div>
				</div>
			</div>`),this.$body.off("click","tr.dayops-toggle").on("click","tr.dayops-toggle",a=>{let o=$(a.currentTarget).attr("data-toggle"),l=this.$body.find(`tr.dayops-docs[data-for="${o}"]`);if(!l.length)return;let p=!l.first().is(":visible");l.toggle(p),$(a.currentTarget).find(".dayops-caret").text(p?"\u25BE":"\u25B8")}),this.expenditure=frappe.ui.form.make_control({parent:this.$body.find(".expenditure-field"),df:{fieldtype:"Currency",fieldname:"expenditure",label:__("Expenditure"),description:__("Cash paid out of the till today. Explain it in Remarks."),change:()=>this.update_expected()},render_input:!0}),this.counted=frappe.ui.form.make_control({parent:this.$body.find(".counted-field"),df:{fieldtype:"Currency",fieldname:"counted_cash",label:__("Counted Cash"),reqd:1,description:__("Filled from the count, or type the total."),change:()=>this.show_result()},render_input:!0}),this.remarks=frappe.ui.form.make_control({parent:this.$body.find(".remarks-field"),df:{fieldtype:"Small Text",fieldname:"remarks",label:__("Remarks"),description:__("Explain any shortage or excess for the supervisor.")},render_input:!0}),this.count=new digitz_erp.CashCount(this.$body.find(".dayops-count-wrap"),this.state.denominations,a=>{a&&this.counted.set_value(a)}),this.set_primary(__("Close Day"),()=>this.close_day(),"check"),this.$body.find(".dayops-submit").on("click",()=>this.close_day()),this.$body.find(".dayops-handover").on("click",()=>this.close_day(!0)),this.set_secondary(__("Refresh"),()=>this.load())}expected(){return flt(this.preview.expected_cash)-flt(this.expenditure&&this.expenditure.get_value())}update_expected(){this.$body.find(".dayops-exp").text(this.money(flt(this.expenditure.get_value()))),this.$body.find(".dayops-expected").text(this.money(this.expected())),this.show_result()}show_result(){let e=this.$body.find(".close-result").empty(),t=this.counted.get_value();if(t==null||t==="")return;let s=flt(t)-this.expected();Math.abs(s)<.005?e.html(`<div class="dayops-result ok">${__("The till matches the expected cash. The day will close.")}</div>`):e.html(`<div class="dayops-result ${s<0?"short":"over"}">
				${s<0?__("Short by {0}",[this.money(-s)]):__("Over by {0}",[this.money(s)])}
				<div style="font-weight: normal; font-size: 12px; margin-top: 4px;">${__("A supervisor will have to approve this close.")}</div>
			</div>`)}close_day(e){let t=this.counted.get_value();if(t==null||t===""){frappe.msgprint(__("Count the till, or enter the counted cash."));return}let s=flt(this.expenditure.get_value());if(s<0){frappe.msgprint(__("Expenditure cannot be negative."));return}let a=s?" "+__("Expenditure: {0}.",[this.money(s)]):"";frappe.confirm((e?__("Close your day with {0} counted in the till and log out for the next cashier?",[this.money(t)]):__("Close the day with {0} counted in the till?",[this.money(t)]))+a,()=>frappe.call({method:"digitz_erp.api.counter_session_api.close_day",args:{counted_cash:t,denominations:this.count.counted(),remarks:this.remarks.get_value(),expenditure:flt(this.expenditure.get_value())},freeze:!0,freeze_message:__("Closing the day..."),callback:o=>{!o.message||(this.changed(),this.show_closed(o.message,e))}}))}show_closed(e,t){this.clear_actions();let s=e.status==="Closed",a=t?`<button class="btn btn-primary btn-sm dayops-logout" style="margin-left: 6px;">${__("Log Out for Next Cashier")}</button>`:`<button class="btn btn-default btn-sm dayops-open" style="margin-left: 6px;">${__("Go to Day Open")}</button>`;this.$body.html(`${this.header()}
			<div class="dayops-card dayops-state">
				<div class="dayops-big">${s?__("Day closed"):__("Close sent for approval")}</div>
				<p>${s?__("The till matched the expected cash. {0} is closed.",[this.esc(e.session)]):__("The count differs by {0}. {1} will close once a supervisor approves it.",[this.money(e.difference),this.esc(e.session)])}
				${t?"<br>"+__("The counter is free: the next cashier can sign in on this PC and open with your count."):""}</p>
				<button class="btn ${t?"btn-default":"btn-primary"} btn-sm dayops-print">${__("Print Day Close Slip")}</button>
				${a}
			</div>`),this.$body.find(".dayops-print").on("click",()=>this.print(e.session)),this.$body.find(".dayops-open").on("click",()=>this.go("day-open")),this.$body.find(".dayops-logout").on("click",()=>frappe.app.logout()),this.render_approvals()}print(e){digitz_erp.DayOpsBase.print_slip(e)}async render_approvals(){if(this.$approvals.empty(),!this.state.is_supervisor)return;let[e,t]=await Promise.all([frappe.call({method:"digitz_erp.api.counter_session_api.get_open_days"}),frappe.call({method:"digitz_erp.api.counter_session_api.get_pending_approvals"})]);this.$approvals.empty(),this.render_open_days(e.message||[]),this.render_pending(t.message||[])}render_open_days(e){if(!e.length)return;$(`
			<div class="dayops-card">
				<h4>${__("Open Days")} (${e.length})</h4>
				<table class="table table-sm" style="margin: 0;">
					<thead><tr>
						<th>${__("Session")}</th><th>${__("Counter")}</th><th>${__("Cashier")}</th><th>${__("Opened")}</th>
						<th class="dayops-num">${__("Float")}</th><th class="dayops-num">${__("Expected Now")}</th><th></th>
					</tr></thead>
					<tbody>${e.map(s=>`
						<tr>
							<td><a href="/app/counter-session/${encodeURIComponent(s.name)}">${this.esc(s.name)}</a></td>
							<td>${this.esc(s.counter)}</td>
							<td>${this.esc(s.cashier_name)}</td>
							<td>${frappe.datetime.str_to_user(s.opened_on)}</td>
							<td class="dayops-num">${this.money(s.opening_float)}</td>
							<td class="dayops-num">${this.money(s.expected_cash)}</td>
							<td class="dayops-num"><button class="btn btn-xs btn-default" data-force-close="${this.esc(s.name)}">${__("Close for Cashier")}</button></td>
						</tr>`).join("")}
					</tbody>
				</table>
				<p class="text-muted small" style="margin: 8px 0 0;">${__("For a cashier who left without closing: count their till and close the day for them, which frees the counter.")}</p>
			</div>`).appendTo(this.$approvals).find("[data-force-close]").on("click",s=>{let a=$(s.currentTarget).attr("data-force-close");this.supervisor_close(e.find(o=>o.name===a))})}supervisor_close(e){let t=new frappe.ui.Dialog({title:__("Close {0}'s day on {1}",[this.esc(e.cashier_name),this.esc(e.counter)]),size:"large",fields:[{fieldtype:"HTML",fieldname:"summary",options:`<p>${__("Expected cash in the till")}: <b class="sv-expected">${this.money(e.expected_cash)}</b>
						<span class="text-muted">(${__("float")} ${this.money(e.opening_float)})</span></p>`},{fieldtype:"Currency",fieldname:"expenditure",label:__("Expenditure"),description:__("Cash paid out of the till that the cashier did not enter."),change:()=>s()},{fieldtype:"HTML",fieldname:"count_wrap"},{fieldtype:"Column Break"},{fieldtype:"Currency",fieldname:"counted_cash",label:__("Counted Cash"),reqd:1,description:__("Filled from the count, or type the total."),change:()=>s()},{fieldtype:"HTML",fieldname:"result"},{fieldtype:"Small Text",fieldname:"remarks",label:__("Reason"),reqd:1,description:__("Why you are closing this day for the cashier. Shown on the Day Close slip.")}],primary_action_label:__("Count & Close"),primary_action:o=>{frappe.call({method:"digitz_erp.api.counter_session_api.supervisor_close",args:{session:e.name,counted_cash:o.counted_cash,denominations:a.counted(),remarks:o.remarks,expenditure:flt(o.expenditure)},freeze:!0,freeze_message:__("Closing the day..."),callback:l=>{!l.message||(t.hide(),frappe.show_alert({message:__("{0} closed. {1} is free.",[e.name,e.counter]),indicator:"green"}),this.changed(),this.load())}})}}),s=()=>{let o=flt(e.expected_cash)-flt(t.get_value("expenditure"));t.fields_dict.summary.$wrapper.find(".sv-expected").text(this.money(o));let l=t.get_value("counted_cash"),p=t.fields_dict.result.$wrapper.empty();if(l==null||l==="")return;let n=flt(l)-o;p.html(Math.abs(n)<.005?`<div class="dayops-result ok">${__("Matches the expected cash.")}</div>`:`<div class="dayops-result ${n<0?"short":"over"}">
					${n<0?__("Short by {0}",[this.money(-n)]):__("Over by {0}",[this.money(n)])}
					<div style="font-weight: normal; font-size: 12px; margin-top: 4px;">${__("Closing approves this difference in your name.")}</div>
				</div>`)},a=new digitz_erp.CashCount(t.fields_dict.count_wrap.$wrapper,this.state.denominations,o=>{o&&t.set_value("counted_cash",o)});t.show()}render_pending(e){!e.length||($(`
			<div class="dayops-card">
				<h4>${__("Pending Approvals")} (${e.length})</h4>
				<table class="table table-sm" style="margin: 0;">
					<thead><tr>
						<th>${__("Session")}</th><th>${__("Counter")}</th><th>${__("Cashier")}</th><th>${__("Opened")}</th>
						<th class="dayops-num">${__("Expected")}</th><th class="dayops-num">${__("Counted")}</th>
						<th class="dayops-num">${__("Difference")}</th><th>${__("Remarks")}</th><th></th>
					</tr></thead>
					<tbody>${e.map(t=>`
						<tr>
							<td><a href="/app/counter-session/${encodeURIComponent(t.name)}">${this.esc(t.name)}</a></td>
							<td>${this.esc(t.counter)}</td>
							<td>${this.esc(t.cashier_name)}</td>
							<td>${frappe.datetime.str_to_user(t.opened_on)}</td>
							<td class="dayops-num">${this.money(t.expected_cash)}</td>
							<td class="dayops-num">${this.money(t.counted_cash)}</td>
							<td class="dayops-num" style="color: ${t.difference<0?"var(--red-600)":"var(--orange-600)"}; font-weight: 600;">${this.money(t.difference)}</td>
							<td>${this.esc(t.close_remarks)}</td>
							<td class="dayops-num"><button class="btn btn-xs btn-primary" data-approve="${this.esc(t.name)}">${__("Approve & Close")}</button></td>
						</tr>`).join("")}
					</tbody>
				</table>
			</div>`).appendTo(this.$approvals),this.$approvals.find("[data-approve]").on("click",t=>{let s=$(t.currentTarget).attr("data-approve"),a=e.find(o=>o.name===s);frappe.confirm(__("Approve a difference of {0} for {1} and close the day?",[this.money(a.difference),this.esc(a.cashier_name)]),()=>frappe.call({method:"digitz_erp.api.counter_session_api.approve_close",args:{session:s},freeze:!0,callback:()=>{frappe.show_alert({message:__("{0} closed",[s]),indicator:"green"}),this.changed(),this.load()}}))}))}};var T;digitz_erp.DayHistory=(T=class{constructor(e){this.$el=$('<div class="cc-history"></div>').appendTo(e),this.is_supervisor=!1,this.reload=frappe.utils.debounce(()=>this.load(),300),this.make()}money(e){return format_currency(e,frappe.boot.sysdefaults.currency)}esc(e){return frappe.utils.escape_html(e==null?"":String(e))}make(){this.$el.html(`
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
		`);let e=this.$el.find(".cc-hist-fields"),t=(a,o)=>{let l=$(`<div class="cc-hist-field ${o||""}"></div>`).appendTo(e);return frappe.ui.form.make_control({parent:l,df:S(O({},a),{change:()=>this.reload()}),render_input:!0})},s=frappe.datetime.get_today();this.fields={from_date:t({fieldtype:"Date",fieldname:"from_date",label:__("From")}),to_date:t({fieldtype:"Date",fieldname:"to_date",label:__("To")}),status:t({fieldtype:"Select",fieldname:"status",label:__("Status"),options:[{value:"",label:__("All")},{value:"Open",label:__("Open")},{value:"Closing",label:__("Awaiting Approval")},{value:"Closed",label:__("Closed")}]}),counter:t({fieldtype:"Link",fieldname:"counter",label:__("Counter"),options:"Counter"},"cc-hist-sup hide"),cashier:t({fieldtype:"Link",fieldname:"cashier",label:__("Cashier"),options:"User"},"cc-hist-sup hide")},this.fields.from_date.set_value(frappe.datetime.add_days(s,-29)),this.fields.to_date.set_value(s),this.mark_chip("30"),this.$el.on("click",".cc-hist-chip",a=>this.set_range($(a.currentTarget).attr("data-range"))),this.$el.on("click","[data-print]",a=>digitz_erp.DayOpsBase.print_slip($(a.currentTarget).attr("data-print"))),this.$el.on("click",".cc-hist-report",()=>{frappe.route_options=this.filters(),frappe.set_route("query-report","Counter Session Summary")})}set_range(e){let t=frappe.datetime.get_today(),s={today:t,week:frappe.datetime.week_start(),month:frappe.datetime.month_start(),30:frappe.datetime.add_days(t,-29)}[e];this.fields.from_date.set_value(s),this.fields.to_date.set_value(t),this.mark_chip(e)}mark_chip(e){this.$el.find(".cc-hist-chip").each((t,s)=>s.classList.toggle("active",s.dataset.range===e))}filters(){let e={};return Object.entries(this.fields).forEach(([t,s])=>{let a=s.get_value();a&&(this.is_supervisor||!["counter","cashier"].includes(t))&&(e[t]=a)}),e}async load(){let e=this.seq=(this.seq||0)+1;this.$el.addClass("is-loading");try{let t=await frappe.call({method:"digitz_erp.api.counter_session_api.get_session_history",args:this.filters()});if(e!==this.seq||!t.message)return;this.is_supervisor=t.message.is_supervisor,this.$el.find(".cc-hist-sup").toggleClass("hide",!this.is_supervisor),this.render_tiles(t.message.totals),this.render_table(t.message.rows)}finally{e===this.seq&&this.$el.removeClass("is-loading")}}render_tiles(e){let t=Math.abs(e.net_difference)<.005?"":e.net_difference<0?"is-short":"is-over",s=(a,o,l="")=>`
			<div class="cc-hist-tile ${l}">
				<div class="cc-hist-tile-label">${a}</div>
				<div class="cc-hist-tile-value">${o}</div>
			</div>`;this.$el.find(".cc-hist-tiles").html(s(__("Days"),e.days)+s(__("Cash Sales"),this.money(e.cash_sales))+s(__("Cash Receipts"),this.money(e.cash_receipts))+s(__("Expenditure"),this.money(e.cash_expenditure))+s(__("Net Difference"),this.money(e.net_difference),t)+s(__("Open / Awaiting"),e.pending,e.pending?"is-pending":""))}render_table(e){let t=this.$el.find(".cc-hist-table"),s=this.is_supervisor?`<button type="button" class="btn btn-xs btn-default cc-hist-report">${__("Open full report")}</button>`:"";if(!e.length){t.html(`
				<div class="cc-hist-empty">
					<p>${__("No days in this range.")}</p>
					${s}
				</div>`);return}let a=n=>n?moment(n).format("hh:mm A"):"",o=n=>n?frappe.datetime.str_to_user(String(n).split(" ")[0]):"",l=n=>n.status==="Open",p=e.map(n=>{let x=n.closed_on?o(n.closed_on)===o(n.opened_on)?a(n.closed_on):`${o(n.closed_on)} ${a(n.closed_on)}`:`<span class="text-muted">${__("Still open")}</span>`,g=flt(n.difference),C=l(n)||Math.abs(g)<.005?"":g<0?"is-short":"is-over",b=w=>l(n)?'<span class="text-muted">\u2014</span>':this.money(w),k=n.status==="Closing"?__("Awaiting Approval"):__(n.status);return`
				<tr>
					<td>${o(n.opened_on)}</td>
					<td><a href="/app/counter-session/${encodeURIComponent(n.name)}">${this.esc(n.name)}</a></td>
					<td>${this.esc(n.counter)}</td>
					${this.is_supervisor?`<td>${this.esc(n.cashier_name)}</td>`:""}
					<td class="cc-nowrap">${a(n.opened_on)} \u2192 ${x}</td>
					<td class="cc-num">${this.money(n.opening_float)}</td>
					<td class="cc-num">${b(n.expected_cash)}</td>
					<td class="cc-num">${b(n.counted_cash)}</td>
					<td class="cc-num ${C}">${b(g)}</td>
					<td><span class="indicator-pill ${digitz_erp.DayHistory.STATUS_COLOURS[n.status]||"gray"}">${k}</span></td>
					<td class="cc-num cc-nowrap">
						${l(n)?"":`<button type="button" class="btn btn-xs btn-default" data-print="${this.esc(n.name)}">${__("Print Slip")}</button>`}
					</td>
				</tr>`}).join("");t.html(`
			<div class="cc-hist-scroll">
				<table class="cc-hist-grid">
					<thead><tr>
						<th>${__("Date")}</th><th>${__("Session")}</th><th>${__("Counter")}</th>
						${this.is_supervisor?`<th>${__("Cashier")}</th>`:""}
						<th>${__("Opened \u2192 Closed")}</th>
						<th class="cc-num">${__("Float")}</th><th class="cc-num">${__("Expected")}</th>
						<th class="cc-num">${__("Counted")}</th><th class="cc-num">${__("Difference")}</th>
						<th>${__("Status")}</th><th></th>
					</tr></thead>
					<tbody>${p}</tbody>
				</table>
			</div>
			<div class="cc-hist-foot">
				<span class="text-muted small">${__("Expected and counted cash are worked out when a day is closed.")}</span>
				${s}
			</div>`)}},P(T,"STATUS_COLOURS",{Open:"green",Closing:"orange",Closed:"gray"}),T);})();
//# sourceMappingURL=counter_device.bundle.Z6AHI25G.js.map
