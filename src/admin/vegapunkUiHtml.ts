/** ベガパンク顧客マスター管理 UI（Bearer はブラウザで入力・sessionStorage） */
export function getVegapunkAdminHtml(): string {
  return `<!DOCTYPE html>
<html lang="ja"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Veliora 顧客マスター</title>
<style>
*{box-sizing:border-box}body{font-family:system-ui,sans-serif;margin:0;background:#f4f4f5;color:#18181b}
header{background:#1e3a5f;color:#fff;padding:12px 16px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
header input{flex:1;min-width:200px;padding:8px;border-radius:6px;border:none}
nav{display:flex;gap:6px;flex-wrap:wrap;padding:8px 16px;background:#fff;border-bottom:1px solid #ddd}
nav button{padding:8px 12px;border:1px solid #ccc;background:#fff;border-radius:6px;cursor:pointer}
nav button.active{background:#1e3a5f;color:#fff;border-color:#1e3a5f}
main{padding:16px;max-width:1100px;margin:0 auto}
.panel{display:none}.panel.active{display:block}
table{width:100%;border-collapse:collapse;background:#fff;font-size:14px}
th,td{border:1px solid #e4e4e7;padding:8px;text-align:left;vertical-align:top}
th{background:#f4f4f5}tr:hover{background:#fafafa}
.card{background:#fff;border:1px solid #e4e4e7;border-radius:8px;padding:12px;margin-bottom:12px}
.err{color:#b91c1c}.muted{color:#71717a;font-size:13px}
pre{white-space:pre-wrap;font-size:12px;background:#f4f4f5;padding:8px;border-radius:6px;max-height:240px;overflow:auto}
label{display:block;margin:8px 0 4px;font-size:13px}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
</style></head><body>
<header>
<strong>Veliora 顧客マスター</strong>
<input id="apiKey" type="password" placeholder="ADMIN_API_KEY" autocomplete="off">
<button type="button" id="saveKey">キー保存</button>
<span class="muted" id="keyStatus"></span>
</header>
<nav id="tabs"></nav>
<main>
<div id="p-list" class="panel active"></div>
<div id="p-detail" class="panel"></div>
<div id="p-merge" class="panel"></div>
<div id="p-audit" class="panel"></div>
</main>
<script>
const TABS=[{id:'list',label:'顧客一覧'},{id:'detail',label:'顧客詳細'},{id:'merge',label:'Merge候補'},{id:'audit',label:'RITS監査'}];
let selectedCustomerId=null;
const tabsEl=document.getElementById('tabs');
TABS.forEach(t=>{const b=document.createElement('button');b.textContent=t.label;b.dataset.tab=t.id;
b.onclick=()=>showTab(t.id);tabsEl.appendChild(b);});
function showTab(id){document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.tab===id));
document.getElementById('p-'+id).classList.add('active');
if(id==='list')loadList();if(id==='merge')loadMerge();if(id==='audit')loadAudit();
if(id==='detail'&&selectedCustomerId)loadDetail(selectedCustomerId);}
function key(){return sessionStorage.getItem('vegapunk_admin_key')||'';}
document.getElementById('saveKey').onclick=()=>{const v=document.getElementById('apiKey').value.trim();
if(v){sessionStorage.setItem('vegapunk_admin_key',v);document.getElementById('keyStatus').textContent='保存済み';loadList();}};
document.getElementById('apiKey').value=key();
async function api(path,opt={}){const h={'Authorization':'Bearer '+key(),'Content-Type':'application/json'};
const r=await fetch('/admin'+path,{...opt,headers:{...h,...opt.headers}});
const t=await r.text();let j;try{j=JSON.parse(t);}catch{j={raw:t};}
if(!r.ok)throw new Error(j.error||j.message||r.status+' '+t.slice(0,200));
return j;}
function esc(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;');}
async function loadList(){const el=document.getElementById('p-list');
if(!key()){el.innerHTML='<p class="err">ADMIN_API_KEY を入力して保存してください</p>';return;}
try{const q=document.getElementById('q')?.value||'';
const data=await api('/customers?q='+encodeURIComponent(q)+'&limit=80');
let h='<div class="row"><input id="q" placeholder="検索" style="flex:1;padding:8px"><button id="qBtn">検索</button></div>';
h+='<table><tr><th>表示名</th><th>呼び名</th><th>ID</th><th>identity</th><th></th></tr>';
for(const c of data.items||[]){h+='<tr><td>'+esc(c.display_name)+'</td><td>'+esc(c.preferred_name||c.nickname)+'</td><td><code>'+esc(c.id.slice(0,8))+'…</code></td><td>'+c.identity_count+'</td><td><button data-id="'+c.id+'">詳細</button></td></tr>';}
h+='</table>';el.innerHTML=h;
document.getElementById('qBtn').onclick=loadList;
el.querySelectorAll('button[data-id]').forEach(b=>b.onclick=()=>{selectedCustomerId=b.dataset.id;showTab('detail');});}
catch(e){el.innerHTML='<p class="err">'+esc(e.message)+'</p>';}}
async function loadDetail(id){const el=document.getElementById('p-detail');
el.innerHTML='<p>読込中…</p>';
try{const d=await api('/customers/'+id);
let h='<div class="card"><strong>'+esc(d.customer.display_name)+'</strong> '+esc(d.customer.preferred_name)+'<br><code>'+esc(d.customer.id)+'</code></div>';
h+='<h3>Identities</h3><table><tr><th>channel</th><th>external_user_id</th><th>表示名</th></tr>';
for(const i of d.identities||[])h+='<tr><td>'+esc(i.channel_key)+'</td><td><code>'+esc(i.external_user_id)+'</code></td><td>'+esc(i.external_display_name)+'</td></tr>';
h+='</table><h3>Memory notes</h3><table><tr><th>note</th><th>confirmed</th><th>操作</th></tr>';
for(const n of d.notes||[]){h+='<tr><td>'+esc(n.note)+'</td><td>'+n.confirmed+'</td><td><button data-nid="'+n.id+'" data-act="toggleNote">confirmed切替</button> <button data-nid="'+n.id+'" data-act="delNote">削除</button></td></tr>';}
h+='</table><h3>Profiles</h3><table><tr><th>key</th><th>value</th><th>confirmed</th><th></th></tr>';
for(const p of d.profiles||[])h+='<tr><td>'+esc(p.profile_key)+'</td><td>'+esc(p.profile_value)+'</td><td>'+p.confirmed+'</td><td><button data-pid="'+p.id+'">confirmed切替</button></td></tr>';
h+='</table><h3>会話</h3><pre>'+esc(JSON.stringify(d.conversations,null,2))+'</pre>';
h+='<h3>Agent contexts</h3><pre>'+esc(JSON.stringify(d.agentContexts,null,2))+'</pre>';
el.innerHTML=h;
el.querySelectorAll('button[data-act=delNote]').forEach(b=>b.onclick=async()=>{if(!confirm('削除しますか？'))return;await api('/customer-memory-notes/'+b.dataset.nid,{method:'DELETE'});loadDetail(id);});
el.querySelectorAll('button[data-act=toggleNote]').forEach(b=>b.onclick=async()=>{const row=(d.notes||[]).find(x=>x.id===b.dataset.nid);await api('/customer-memory-notes/'+b.dataset.nid,{method:'PATCH',body:JSON.stringify({confirmed:!row.confirmed})});loadDetail(id);});
el.querySelectorAll('button[data-pid]').forEach(b=>b.onclick=async()=>{const row=(d.profiles||[]).find(x=>x.id===b.dataset.pid);await api('/customer-profiles/'+b.dataset.pid,{method:'PATCH',body:JSON.stringify({confirmed:!row.confirmed})});loadDetail(id);});
}catch(e){el.innerHTML='<p class="err">'+esc(e.message)+'</p>';}}
async function loadMerge(){const el=document.getElementById('p-merge');
try{const data=await api('/customer-merge-candidates?status=pending');
let h='<p class="muted">自動mergeはしません。survivorを選んで承認してください。</p><table><tr><th>reason</th><th>A</th><th>B</th><th></th></tr>';
for(const c of data.items||[]){h+='<tr><td>'+esc(c.reason)+'</td><td><code>'+esc(c.customer_id_a.slice(0,8))+'</code></td><td><code>'+esc(c.customer_id_b.slice(0,8))+'</code></td><td><button data-aid="'+c.customer_id_a+'" data-bid="'+c.customer_id_b+'" data-cid="'+c.id+'">Aをsurvivor</button> <button data-aid="'+c.customer_id_b+'" data-bid="'+c.customer_id_a+'" data-cid="'+c.id+'">Bをsurvivor</button> <button data-cid="'+c.id+'" data-reject>却下</button></td></tr>';}
h+='</table>';el.innerHTML=h;
el.querySelectorAll('button[data-aid]').forEach(b=>{if(b.dataset.reject)return;
b.onclick=async()=>{await api('/customer-merge-candidates/'+b.dataset.cid+'/approve',{method:'POST',body:JSON.stringify({survivor_customer_id:b.dataset.aid})});loadMerge();};});
el.querySelectorAll('button[data-reject]').forEach(b=>b.onclick=async()=>{await api('/customer-merge-candidates/'+b.dataset.cid+'/reject',{method:'POST'});loadMerge();});
}catch(e){el.innerHTML='<p class="err">'+esc(e.message)+'</p>';}}
async function loadAudit(){const el=document.getElementById('p-audit');
try{const d=await api('/customers/audit-summary');
el.innerHTML='<pre>'+esc(JSON.stringify(d,null,2))+'</pre><p class="muted">RITS日次レポートでも同内容を VERIORA_CUSTOMER_AUDIT_IN_DAILY_REPORT=true で出力</p>';
}catch(e){el.innerHTML='<p class="err">'+esc(e.message)+'</p>';}}
showTab('list');
</script></body></html>`;
}
