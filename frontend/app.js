// The API is a different origin now that this app deploys to Static Web Apps rather
// than being served by FastAPI. config.js is generated at deploy time; the fallback
// keeps `python -m http.server` style local development working against a local API.
const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.apiBase) || 'http://localhost:8000';
const apiUrl = path => `${API_BASE}${path}`;

const PERSONAS = {
  employee: { label: 'Employee', email: 'marietta.baudone@gmail.com', icon: '👤' },
  manager:  { label: 'Manager', email: 'alejandra.farryann@gmail.com', icon: '👥' },
  hr:       { label: 'HR Admin', email: 'hr.admin@bluepeak.example', icon: '🛡️' },
};

const state = {
  personaKey: localStorage.getItem('decacorePersona') || 'employee',
  me: null,
  view: 'chat',
  conversationId: null,
  currentMessages: [],
  assistantMessageId: null,
  chatBusy: false,
  data: {},
};

const app = document.getElementById('app');
const esc = (v='') => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmtDate = v => v ? new Date(v).toLocaleString([], {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}) : '—';
const persona = () => PERSONAS[state.personaKey];

function toast(message, type='') {
  let wrap = document.querySelector('.toast-wrap');
  if (!wrap) { wrap = document.createElement('div'); wrap.className='toast-wrap'; document.body.appendChild(wrap); }
  const el = document.createElement('div'); el.className=`toast ${type}`; el.textContent=message; wrap.appendChild(el);
  setTimeout(()=>el.remove(), 4000);
}

async function api(path, options={}) {
  const headers = new Headers(options.headers || {});
  headers.set('X-Dev-User-Email', persona().email);
  const res = await fetch(apiUrl(path), {...options, headers});
  if (!res.ok) {
    const err = await res.json().catch(()=>({}));
    throw new Error(err.detail || `Request failed (${res.status})`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function navForRole(role) {
  if (role === 'HRAdmin') return [
    ['dashboard','▦','Dashboard'],['documents','▤','Documents'],['requests','✓','Requests'],['chat','✦','Chat'],['history','◷','History']
  ];
  if (role === 'Manager') return [
    ['chat','✦','Chat'],['history','◷','History'],['resources','▤','Resources'],['requests','✓','Team Requests']
  ];
  return [['chat','✦','Chat'],['history','◷','History'],['resources','▤','Resources'],['requests','✓','My Requests']];
}

function titleForView() {
  const item = navForRole(state.me?.role).find(x=>x[0]===state.view);
  return item ? item[2] : 'DecaCore';
}

function renderLogin() {
  app.innerHTML = `
    <div class="login">
      <div class="login-card">
        <div class="login-logo"><div class="brand-mark"></div> DecaCore</div>
        <h1>Employee FAQ Assistant</h1>
        <p>Local integration demo. Choose a seeded test user and the UI will connect directly to the FastAPI backend running on this same server.</p>
        <div class="persona-grid">
          ${Object.entries(PERSONAS).map(([key,p])=>`<button class="persona ${state.personaKey===key?'active':''}" data-persona="${key}"><strong>${p.icon} ${p.label}</strong><span>${esc(p.email)}</span></button>`).join('')}
        </div>
        <button class="primary" style="width:100%;padding:12px" id="signinBtn">Continue to local demo</button>
        <div class="login-note">For local development this uses <span class="mono">X-Dev-User-Email</span>. When Entra ID is enabled, this selector is replaced with Microsoft sign-in and bearer tokens.</div>
      </div>
    </div>`;
  document.querySelectorAll('[data-persona]').forEach(btn=>btn.onclick=()=>{state.personaKey=btn.dataset.persona;localStorage.setItem('decacorePersona',state.personaKey);renderLogin();});
  document.getElementById('signinBtn').onclick = signIn;
}

async function signIn() {
  try {
    state.me = await api('/api/me');
    state.view = state.me.role === 'HRAdmin' ? 'dashboard' : 'chat';
    renderShell();
    await loadView();
  } catch (e) { toast(e.message,'error'); }
}

function renderShell() {
  app.innerHTML = `
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand"><div class="brand-mark"></div><span>DecaCore</span></div>
      <div class="sidebar-user"><div class="name">${esc(state.me.display_name)}</div><div class="meta">${esc(state.me.role)} · ${esc(state.me.department || 'No department')}</div></div>
      <nav class="nav" id="nav">${navForRole(state.me.role).map(([v,i,l])=>`<button data-view="${v}" class="${state.view===v?'active':''}"><span class="ico">${i}</span><span class="label">${l}</span></button>`).join('')}</nav>
      <div class="sidebar-spacer"></div>
      <div class="sidebar-footer"><button class="small-btn" id="switchUser"><span class="label">Switch demo user</span><span class="ico">↔</span></button></div>
    </aside>
    <main class="main">
      <div class="topbar"><h1 id="viewTitle">${esc(titleForView())}</h1><div class="spacer"></div><div class="status-pill"><span class="status-dot"></span> Local backend connected</div></div>
      <div id="view" class="content"><div class="empty">Loading…</div></div>
    </main>
  </div>`;
  document.getElementById('nav').onclick = async e => {
    const btn=e.target.closest('[data-view]'); if(!btn)return;
    state.view=btn.dataset.view; renderShell(); await loadView();
  };
  document.getElementById('switchUser').onclick=()=>{state.me=null;state.conversationId=null;state.currentMessages=[];renderLogin();};
}

async function loadView() {
  try {
    if (state.view==='chat') return await renderChat();
    if (state.view==='history') return await renderHistory();
    if (state.view==='resources') return await renderResources();
    if (state.view==='requests') return await renderRequests();
    if (state.view==='documents') return await renderDocuments();
    if (state.view==='dashboard') return await renderDashboard();
  } catch(e) { document.getElementById('view').innerHTML=`<div class="empty">${esc(e.message)}</div>`; toast(e.message,'error'); }
}

async function renderChat() {
  const [faq] = await Promise.all([api('/api/faq/top').catch(()=>({items:[]}))]);
  const suggestions = faq.items?.length ? faq.items.map(x=>x.question) : ['How many vacation days do employees receive?','Can I work remotely?','How do travel reimbursements work?'];
  const view=document.getElementById('view');
  view.innerHTML=`
    <div class="chat-layout">
      <section class="chat-panel">
        <div class="chat-head"><div><b>Policy Assistant</b><div class="small muted">Answers only from approved policy content</div></div><div class="spacer"></div><button class="secondary" id="newChat">New chat</button></div>
        <div class="messages" id="messages"></div>
        <form class="composer" id="chatForm"><textarea class="textarea" id="chatInput" placeholder="Ask an HR policy question…" rows="1"></textarea><button class="primary" id="sendBtn">Send</button></form>
      </section>
      <aside class="side-card"><h3>Suggested questions</h3>${suggestions.map(q=>`<button class="suggestion" data-question="${esc(q)}">${esc(q)}</button>`).join('')}<div class="small muted" style="margin-top:15px">Chat history is retained for 7 days in the backend.</div></aside>
    </div>`;
  renderMessages();
  document.getElementById('newChat').onclick=()=>{state.conversationId=null;state.currentMessages=[];state.assistantMessageId=null;renderMessages();};
  document.querySelectorAll('[data-question]').forEach(b=>b.onclick=()=>{document.getElementById('chatInput').value=b.dataset.question;sendChat();});
  document.getElementById('chatForm').onsubmit=e=>{e.preventDefault();sendChat();};
  document.getElementById('chatInput').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat();}};
}

function renderMessages() {
  const box=document.getElementById('messages'); if(!box)return;
  if (!state.currentMessages.length) {
    box.innerHTML=`<div class="hero" style="margin:auto;max-width:560px"><h2>Hi ${esc((state.me?.display_name||'there').split(' ')[0])}</h2><p>Ask me about approved company policies. I’ll show the sources used for the answer and offer HR escalation when the policy documents are not enough.</p></div>`; return;
  }
  box.innerHTML=state.currentMessages.map((m,idx)=>{
    if(m.role==='user') return `<div class="msg user"><div class="bubble">${esc(m.content)}</div></div>`;
    const citations=(m.citations||[]).map(c=>`<button class="citation" data-doc="${esc(c.document_id||'')}">${esc(c.title||'Policy')}${c.section?` · ${esc(c.section)}`:''}${c.page?` · p.${esc(c.page)}`:''}</button>`).join('');
    const escalation=m.escalationOffered&&!m.escalated?`<div style="margin-top:10px"><button class="secondary" data-escalate="${idx}">Connect to HR</button></div>`:'';
    return `<div class="msg assistant ${m.error?'error':''}"><div class="avatar">D</div><div class="bubble"><div>${m.loading&&!m.content?'<span class="typing"><i></i><i></i><i></i></span>':esc(m.content)}</div>${citations?`<div class="citation-row">${citations}</div>`:''}${escalation}</div></div>`;
  }).join('');
  box.scrollTop=box.scrollHeight;
  box.querySelectorAll('[data-doc]').forEach(b=>b.onclick=()=>openDocument(b.dataset.doc));
  box.querySelectorAll('[data-escalate]').forEach(b=>b.onclick=()=>escalateMessage(Number(b.dataset.escalate)));
}

async function sendChat() {
  if(state.chatBusy)return;
  const input=document.getElementById('chatInput'); const message=input?.value.trim(); if(!message)return;
  input.value=''; state.chatBusy=true;
  state.currentMessages.push({role:'user',content:message});
  const assistant={role:'assistant',content:'',citations:[],loading:true}; state.currentMessages.push(assistant); renderMessages();
  try {
    const headers=new Headers({'Content-Type':'application/json','X-Dev-User-Email':persona().email});
    const body={message}; if(state.conversationId)body.conversation_id=state.conversationId;
    const res=await fetch(apiUrl('/api/chat'),{method:'POST',headers,body:JSON.stringify(body)});
    if(!res.ok){const err=await res.json().catch(()=>({}));throw new Error(err.detail||`Chat failed (${res.status})`)}
    const reader=res.body.getReader(), decoder=new TextDecoder(); let buffer='';
    while(true){
      const {value,done}=await reader.read(); if(done)break;
      buffer+=decoder.decode(value,{stream:true}); const blocks=buffer.split('\n\n'); buffer=blocks.pop()||'';
      for(const block of blocks){
        const type=block.match(/^event: (.+)$/m)?.[1]; const raw=block.match(/^data: (.+)$/m)?.[1]; if(!raw)continue;
        const data=JSON.parse(raw);
        if(type==='meta'){state.conversationId=data.conversation_id;state.assistantMessageId=data.message_id}
        if(type==='delta'){assistant.content+=data.text;assistant.loading=false;renderMessages()}
        if(type==='done'){assistant.citations=data.citations||[];assistant.escalationOffered=!!data.escalation_offered;assistant.loading=false;assistant.messageId=data.message_id;renderMessages()}
      }
    }
  } catch(e) { assistant.loading=false;assistant.error=true;assistant.content=e.message;renderMessages(); }
  finally {state.chatBusy=false;}
}

async function escalateMessage(idx) {
  const m=state.currentMessages[idx]; if(!state.conversationId)return;
  const note=prompt('Optional note for HR:','') ?? null; if(note===null)return;
  try {
    await api('/api/chat/escalate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversation_id:state.conversationId,assistant_message_id:m.messageId||state.assistantMessageId,note})});
    m.escalated=true; renderMessages(); toast('Question sent to HR.','success');
  } catch(e){toast(e.message,'error')}
}

async function renderHistory() {
  const data=await api('/api/conversations');
  const view=document.getElementById('view');
  view.innerHTML=`<div class="section-title"><h2>Conversation history</h2><div class="spacer"></div><span class="small muted">${data.total} conversations</span></div>${data.items.length?data.items.map(c=>`<div class="history-item"><div class="history-title"><b>${esc(c.title)}</b><span>${fmtDate(c.last_message_at)} · expires ${fmtDate(c.expires_at)}</span></div><button class="secondary" data-open-conv="${esc(c.id)}">Open</button><button class="danger" data-del-conv="${esc(c.id)}">Delete</button></div>`).join(''):'<div class="empty">No conversations yet.</div>'}`;
  view.querySelectorAll('[data-open-conv]').forEach(b=>b.onclick=()=>openConversation(b.dataset.openConv));
  view.querySelectorAll('[data-del-conv]').forEach(b=>b.onclick=()=>deleteConversation(b.dataset.delConv));
}
async function openConversation(id){const c=await api(`/api/conversations/${id}`);state.conversationId=id;state.currentMessages=c.messages.map(m=>({role:m.role==='assistant'?'assistant':'user',content:m.content,citations:m.citations||[],messageId:m.id,escalated:m.escalated}));state.view='chat';renderShell();await renderChat();}
async function deleteConversation(id){if(!confirm('Delete this conversation?'))return;await api(`/api/conversations/${id}`,{method:'DELETE'});toast('Conversation deleted.','success');await renderHistory();}

async function renderResources(){
  const data=await api('/api/documents'); const docs=data.items.filter(d=>d.status==='approved');
  document.getElementById('view').innerHTML=`<div class="section-title"><h2>Approved resources</h2><div class="spacer"></div><span class="small muted">Visible for ${esc(state.me.role)}</span></div><div class="grid grid-2">${docs.length?docs.map(d=>`<div class="card doc-card"><div class="doc-icon">PDF</div><div class="doc-body"><h4>${esc(d.title)}</h4><div class="doc-meta">${esc(d.category||'Uncategorized')} · ${esc(d.version||'Current version')}<br>Roles: ${esc((d.allowed_roles||[]).join(', '))}</div><div class="actions" style="margin-top:10px"><button class="secondary" data-open-doc="${esc(d.id)}">Open policy</button></div></div></div>`).join(''):'<div class="empty">No approved resources are visible to this user.</div>'}</div>`;
  document.querySelectorAll('[data-open-doc]').forEach(b=>b.onclick=()=>openDocument(b.dataset.openDoc));
}

async function openDocument(id){
  if(!id)return;
  try{
    const headers={'X-Dev-User-Email':persona().email}; const r=await fetch(apiUrl(`/api/documents/${id}/content`),{headers});
    if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.detail||'Unable to open document')}
    const blob=await r.blob(); const url=URL.createObjectURL(blob); window.open(url,'_blank','noopener'); setTimeout(()=>URL.revokeObjectURL(url),60000);
  }catch(e){toast(e.message,'error')}
}

async function renderRequests(){
  const data=await api('/api/requests'); const role=state.me.role; const canCreate=role==='Employee'||role==='Manager'||role==='Executive';
  const view=document.getElementById('view');
  view.innerHTML=`
    ${canCreate?`<div class="card"><h3>Submit a request</h3><form id="requestForm"><div class="form-grid"><div class="form-field"><label>Request type</label><select class="select" name="type"><option>Leave Application</option><option>Reimbursement</option><option>Insurance</option><option>HR Question</option></select></div><div class="form-field"><label>Category</label><input class="input" name="category" placeholder="Optional category"></div><div class="form-field"><label>Amount (optional)</label><input class="input" type="number" step="0.01" name="amount" placeholder="0.00"></div><div class="form-field"><label>Attachment (optional)</label><input class="input" type="file" name="attachment"></div></div><div class="form-field" style="margin-top:12px"><label>Message</label><textarea class="textarea" name="message" required placeholder="Describe your request…"></textarea></div><div class="form-actions"><button class="primary">Submit request</button></div></form></div>`:''}
    <div class="section-title"><h2>${role==='HRAdmin'?'All employee requests':role==='Manager'?'Team requests':'My requests'}</h2><div class="spacer"></div><span class="small muted">${data.total} visible</span></div>
    ${requestTable(data.items, role==='Manager'||role==='HRAdmin')}`;
  if(canCreate)document.getElementById('requestForm').onsubmit=submitRequest;
  bindRequestActions();
}
function requestTable(items,decide){if(!items.length)return'<div class="empty">No requests found.</div>';return `<div class="table-wrap"><table><thead><tr><th>Type</th><th>Status</th><th>Employee</th><th>Message</th><th>Submitted</th><th>Action</th></tr></thead><tbody>${items.map(r=>`<tr><td><b>${esc(r.type)}</b><div class="small muted">${esc(r.category||'')}</div></td><td><span class="badge ${esc(r.status.toLowerCase())}">${esc(r.status)}</span></td><td><b>${esc(r.employee_name||`Employee #${r.employee_id}`)}</b><div class="small muted">${esc(r.employee_department||"")}</div></td><td>${esc(r.message)}</td><td>${fmtDate(r.created_at)}</td><td><div class="actions">${r.attachment_blob_path?`<button class="secondary" data-attach="${esc(r.id)}">Attachment</button>`:''}${decide&&r.status==='Pending'?`<button class="success" data-approve="${esc(r.id)}">Approve</button><button class="danger" data-deny="${esc(r.id)}">Deny</button>`:''}</div></td></tr>`).join('')}</tbody></table></div>`}
async function submitRequest(e){e.preventDefault();const fd=new FormData(e.target);if(!fd.get('amount'))fd.delete('amount');if(!fd.get('category'))fd.delete('category');if(!(fd.get('attachment') instanceof File)||!fd.get('attachment').name)fd.delete('attachment');try{await api('/api/requests',{method:'POST',body:fd});toast('Request submitted.','success');await renderRequests()}catch(err){toast(err.message,'error')}}
function bindRequestActions(){document.querySelectorAll('[data-approve]').forEach(b=>b.onclick=()=>decideRequest(b.dataset.approve,'approve'));document.querySelectorAll('[data-deny]').forEach(b=>b.onclick=()=>decideRequest(b.dataset.deny,'deny'));document.querySelectorAll('[data-attach]').forEach(b=>b.onclick=()=>openAttachment(b.dataset.attach));}
async function decideRequest(id,action){let comment='';if(action==='deny'){comment=prompt('Denial comment (required):','')||'';if(!comment.trim())return}else comment=prompt('Optional approval comment:','')||'';try{await api(`/api/requests/${id}/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({comment})});toast(`Request ${action==='approve'?'approved':'denied'}.`,'success');await renderRequests()}catch(e){toast(e.message,'error')}}
async function openAttachment(id){try{const r=await fetch(apiUrl(`/api/requests/${id}/attachment`),{headers:{'X-Dev-User-Email':persona().email}});if(!r.ok)throw new Error('Unable to open attachment');const blob=await r.blob(),url=URL.createObjectURL(blob);window.open(url,'_blank','noopener');setTimeout(()=>URL.revokeObjectURL(url),60000)}catch(e){toast(e.message,'error')}}

async function renderDocuments(){
  const data=await api('/api/documents'); const view=document.getElementById('view');
  view.innerHTML=`<div class="card"><h3>Upload policy document</h3><form id="docForm"><div class="form-grid"><div class="form-field"><label>PDF file</label><input class="input" type="file" name="file" accept="application/pdf" required></div><div class="form-field"><label>Title (optional)</label><input class="input" name="title"></div></div><div class="form-field" style="margin-top:12px"><label>Allowed roles</label><div class="actions"><label><input type="checkbox" name="role" value="Employee" checked> Employee</label><label><input type="checkbox" name="role" value="Manager" checked> Manager</label><label><input type="checkbox" name="role" value="Executive" checked> Executive</label></div></div><div class="form-actions"><button class="primary">Upload and categorize</button></div></form></div>
  <div class="section-title"><h2>Policy documents</h2><div class="spacer"></div><span class="small muted">${data.total} total</span></div>
  ${data.items.length?`<div class="table-wrap"><table><thead><tr><th>Document</th><th>Category</th><th>Status</th><th>Audience</th><th>AI confidence</th><th>Actions</th></tr></thead><tbody>${data.items.map(d=>`<tr><td><b>${esc(d.title)}</b><div class="small muted">${esc(d.filename)}</div></td><td>${d.status==='pending_approval'?`<select class="select" style="padding:7px" data-category="${esc(d.id)}">${['Benefits','Leave','Payroll','Travel','Insurance','Reimbursements'].map(c=>`<option ${d.category===c?'selected':''}>${c}</option>`).join('')}</select>`:esc(d.category||'—')}</td><td><span class="badge ${esc(d.status)}">${esc(d.status.replaceAll('_',' '))}</span></td><td>${esc((d.allowed_roles||[]).join(', '))}</td><td>${d.ai_confidence!=null?Math.round(d.ai_confidence*100)+'%':'—'}</td><td><div class="actions"><button class="secondary" data-open-doc="${esc(d.id)}">Open</button>${d.status==='pending_approval'?`<button class="success" data-doc-approve="${esc(d.id)}">Approve</button><button class="danger" data-doc-reject="${esc(d.id)}">Reject</button>`:''}</div></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No documents.</div>'}`;
  document.getElementById('docForm').onsubmit=uploadDocument;
  view.querySelectorAll('[data-open-doc]').forEach(b=>b.onclick=()=>openDocument(b.dataset.openDoc));
  view.querySelectorAll('[data-category]').forEach(s=>s.onchange=()=>changeCategory(s.dataset.category,s.value));
  view.querySelectorAll('[data-doc-approve]').forEach(b=>b.onclick=()=>approveDocument(b.dataset.docApprove));
  view.querySelectorAll('[data-doc-reject]').forEach(b=>b.onclick=()=>rejectDocument(b.dataset.docReject));
}
async function uploadDocument(e){e.preventDefault();const form=e.target,fd=new FormData();const file=form.file.files[0];if(!file)return;fd.append('file',file);if(form.title.value.trim())fd.append('title',form.title.value.trim());const roles=[...form.querySelectorAll('input[name=role]:checked')].map(x=>x.value);fd.append('permissions',roles.join(','));try{await api('/api/documents',{method:'POST',body:fd});toast('Document uploaded for HR approval.','success');await renderDocuments()}catch(err){toast(err.message,'error')}}
async function changeCategory(id,category){try{await api(`/api/documents/${id}/category`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({category})});toast('Category updated.','success')}catch(e){toast(e.message,'error')}}
async function approveDocument(id){try{await api(`/api/documents/${id}/approve`,{method:'POST'});toast('Document approved and indexed.','success');await renderDocuments()}catch(e){toast(e.message,'error')}}
async function rejectDocument(id){const comment=prompt('Reason for rejection:','');if(!comment?.trim())return;try{await api(`/api/documents/${id}/reject`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({comment})});toast('Document rejected.','success');await renderDocuments()}catch(e){toast(e.message,'error')}}

async function renderDashboard(){
  const [m,c]=await Promise.all([api('/api/dashboard/metrics'),api('/api/dashboard/charts')]);
  const cards=[['Chat questions',m.chat_messages,'Employee questions logged'],['Escalations',m.escalated_messages,'Sent to HR'],['Pending requests',m.pending_requests,'Awaiting decision'],['Approved policies',m.approved_documents,'Available to search']];
  document.getElementById('view').innerHTML=`<div class="hero"><h2>HR Administration</h2><p>Live local metrics from the FastAPI backend and seeded DecaCore data.</p></div><div class="grid grid-4" style="margin-top:16px">${cards.map(x=>`<div class="card kpi"><div class="label">${x[0]}</div><div class="value">${x[1]}</div><div class="hint">${x[2]}</div></div>`).join('')}</div><div class="grid grid-2" style="margin-top:16px"><div class="card"><h3>Requests by status</h3>${bars(c.requests_by_status)}</div><div class="card"><h3>Documents by category</h3>${bars(c.documents_by_category)}</div></div><div class="card" style="margin-top:16px"><h3>Top questions</h3>${bars(c.top_questions)}</div>`;
}
function bars(items){if(!items?.length)return'<div class="empty">No data yet.</div>';const max=Math.max(...items.map(x=>x.value),1);return items.map(x=>`<div class="bar-row"><div class="bar-label" title="${esc(x.label)}">${esc(x.label)}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(4,(x.value/max)*100)}%"></div></div><div class="bar-value">${x.value}</div></div>`).join('')}

renderLogin();
