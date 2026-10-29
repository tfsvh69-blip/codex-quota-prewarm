'use strict';
const $=id=>document.getElementById(id);
let csrf='',snapshot=null,loginPoll=null,loginSlot=null,toastTimer=null;
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const clamp=n=>Math.min(100,Math.max(0,n));
const remainingOf=quota=>{
 const used=quota?.used;
 if(used===null||used===undefined||used==='')return null;
 const n=Number(used);
 return Number.isFinite(n)?Math.round((100-clamp(n))*10)/10:null;
};
const percentText=n=>Number.isInteger(n)?String(n):n.toFixed(1);
const windowTitle=(quota,fallback)=>{
 const mins=quota?.duration;
 if(!Number.isFinite(mins)||mins<=0)return fallback;
 if(mins===10080)return '每周';
 if(mins===300)return '五小时';
 return mins%60===0?mins/60+'小时':mins+'分钟';
};
const dateTime=epoch=>!epoch?'—':new Date(epoch*1000).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
const msTime=ms=>!ms?'—':new Date(ms).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
// Always derive countdowns from absolute server reset timestamps, never subtract 1s from an old value.
function countdownText(reset,now=Date.now()){
 const seconds=Math.ceil((Number(reset)*1000-now)/1000);
 if(!Number.isFinite(seconds)||seconds<=0)return '等待额度同步';
 const days=Math.floor(seconds/86400),h=Math.floor(seconds%86400/3600),m=Math.floor(seconds%3600/60),s=seconds%60;
 const clock=[h,m,s].map(x=>String(x).padStart(2,'0')).join(':');
 return (days?days+'天 ':'')+clock;
}
function updateCountdowns(now=Date.now()){
 document.querySelectorAll('.countdown-value[data-reset]').forEach(el=>{
  const text=countdownText(el.dataset.reset,now);
  if(el.textContent!==text)el.textContent=text;
  el.closest('.countdown-panel')?.classList.toggle('is-due',text==='等待额度同步');
 });
}
const isReady=a=>a.enabled && a.auth==='ok' && !a.duplicateOf && !a.error;
// The first moment both exhausted quota windows may become available.
// An account with an unknown restriction is not advertised as usable.
function availabilityOf(a,now){
 if(!a.enabled)return {rank:4,at:Infinity,text:'已停用'};
 if(!isReady(a))return {rank:3,at:Infinity,text:'状态待确认'};
 const limits=[a.fiveHour,a.week].filter(Boolean);
 if(!limits.length||limits.some(q=>remainingOf(q)===null))return {rank:3,at:Infinity,text:'额度待确认'};
 const depleted=limits.filter(q=>remainingOf(q)===0);
 if(!depleted.length)return a.allowed===false?{rank:3,at:Infinity,text:'服务端限制待确认'}:{rank:0,at:now,text:'现在可用'};
 const resets=depleted.map(q=>Number(q.reset));
 if(resets.some(t=>!Number.isFinite(t)||t<=0))return {rank:3,at:Infinity,text:'恢复时间未知'};
 const at=Math.max(...resets);
 return at<=now?{rank:1,at:now,text:'重置时间已到，待刷新'}:{rank:1,at,text:'预计可用'};
}
function sortAccounts(accounts,now){
 return [...accounts].sort((a,b)=>{
  const x=availabilityOf(a,now),y=availabilityOf(b,now);
  return x.rank-y.rank||x.at-y.at||a.name.localeCompare(b.name,'en');
 });
}
function notify(message,error=false){
 const el=$('toast');el.textContent=message;el.className='toast show'+(error?' error':'');
 clearTimeout(toastTimer);toastTimer=setTimeout(()=>{el.className='toast'},4500);
}
async function request(url,method='GET',value=null){
 const res=await fetch(url,{method,headers:{'Content-Type':'application/json','x-codex-csrf':csrf},body:value?JSON.stringify(value):undefined,cache:'no-store'});
 const data=await res.json();if(!res.ok)throw Error(data.error||'请求未完成');return data;
}
function statusOf(a){
 if(!a.enabled)return {text:'已停用',cls:'neutral'};
 if(a.auth!=='ok')return {text:'未登录',cls:'warning'};
 if(a.duplicateOf)return {text:'与 '+a.duplicateOf+' 重复',cls:'danger'};
 if(a.error)return {text:'查询异常',cls:'warning'};
 if(remainingOf(a.week)===0)return {text:'每周额度用尽',cls:'warning'};
 if(remainingOf(a.fiveHour)===0)return {text:windowTitle(a.fiveHour,'五小时')+'额度用尽',cls:'warning'};
 if(a.allowed===false)return {text:'服务端限制',cls:'warning'};
 if(remainingOf(a.fiveHour)===null&&remainingOf(a.week)===null)return {text:'额度未读取',cls:'neutral'};
 if(remainingOf(a.fiveHour)===null)return {text:'每周额度可用',cls:'good'};
 if(remainingOf(a.week)===null)return {text:'短周期可用',cls:'good'};
 return {text:'可以使用',cls:'good'};
}
function quotaBlock(quota,title,disabled,queryError=false){
 const value=disabled?null:remainingOf(quota),valid=value!==null;
 const label=windowTitle(quota,title),percent=valid?percentText(value)+'%':queryError?'查询失败':!disabled&&!quota?'未提供':'未读取';
 const reset=!disabled&&quota&&Number.isFinite(Number(quota.reset))&&Number(quota.reset)>0?Number(quota.reset):null;
 const resetText=reset?dateTime(reset):null;
 const depleted=valid&&value===0;
 const countdown=reset?'<time class="countdown-value" data-reset="'+reset+'" datetime="'+new Date(reset*1000).toISOString()+'" aria-label="'+escapeHtml(label)+'距离重置还有多久">'+escapeHtml(countdownText(reset))+'</time>':
  '<span class="countdown-unavailable">'+(disabled?'已停用':queryError?'查询失败':!quota?'本次未提供':valid?'暂无重置时间':'额度未读取')+'</span>';
 return '<div class="quota-cell"><div class="quota-top"><span class="quota-short-label">'+escapeHtml(label)+'额度</span>'+
  '<span class="quota-remaining'+(depleted?' is-empty':'')+'">'+(valid?'剩余 '+percent:percent)+'</span></div>'+
  '<div class="countdown-panel'+(depleted?' is-exhausted':'')+(reset?'':' is-unknown')+'">'+
  '<div class="countdown-caption">'+(depleted?'预计恢复倒计时':'距离下次重置')+'</div>'+
  countdown+'</div>'+
  '<div class="quota-reset-foot">'+(resetText?'预计重置 · 北京时间 '+escapeHtml(resetText):'请以官方额度查询结果为准')+'</div></div>';
}
function details(a){
 const morning=a.morning?(a.morning.status==='verified'?'已验证':a.morning.status==='model_completed_unverified'?'请求已完成，窗口待确认':a.morning.status||'未确认'):'暂无匹配当前身份的记录';
 const morningText=a.morning?(a.morning.day+' · '+morning):morning;
 const last=a.lastRequest?msTime(a.lastRequest):'暂无匹配当前身份的记录';
 const logs=(a.recent||[]).map(x=>'<p class="logline">'+escapeHtml(x)+'</p>').join('')||'<p>暂无日志</p>';
 return '<details class="account-detail" data-slot="'+escapeHtml(a.name)+'"><summary>运行记录与详情</summary><div class="detail-body">'+
  '<div><p><strong>晨间预激活</strong> '+escapeHtml(morningText)+'</p><p><strong>最近模型成功</strong> '+escapeHtml(last)+'</p>'+
  (a.error?'<p><strong>接口异常</strong> '+escapeHtml(a.error)+'</p>':'')+'</div>'+
  '<div><strong>最近智能巡检</strong>'+logs+'</div></div></details>';
}
function actionButton(act,slot,label,cls,extra='',disabled=false){
 return '<button type="button" class="button '+cls+'" data-act="'+act+'" data-slot="'+escapeHtml(slot)+'"'+extra+(disabled?' disabled':'')+'>'+escapeHtml(label)+'</button>';
}
function accountRow(a,active,now){
 const badge=statusOf(a),selected=active===a.name,disabled=!a.enabled;
 const email=a.email||(disabled?'账号槽位未启用':a.auth==='ok'?'邮箱暂不可用':'未登录 ChatGPT');
 const main=a.protected?'主账号':'副账号';
 const identity='<div class="account-identity"><div class="identity-line"><span class="slot-icon" aria-hidden="true">'+escapeHtml(a.name)+'</span>'+
  '<div class="identity-name">'+escapeHtml(main+' '+a.name)+'</div><span class="identity-status pill '+badge.cls+'"><i></i>'+escapeHtml(badge.text)+'</span></div>'+
  '<div class="account-email" title="'+escapeHtml(email)+'">'+escapeHtml(email)+'</div></div>';
 // High-frequency action stays visible. Account maintenance is one click away.
 const primary=disabled?actionButton('enable',a.name,'启用账号','button-secondary primary-action',' data-enable="true"'):
  selected?'<span class="current-account-mark">✓ 当前账号</span>':
  actionButton('select',a.name,'设为当前','button-secondary primary-action');
 const secondary=disabled?'':'<details class="account-actions" data-slot="'+escapeHtml(a.name)+'"><summary>更多操作</summary>'+
  '<div class="account-actions-menu">'+
  actionButton('login',a.name,a.auth==='ok'?'更换登录':'账号登录','button-secondary')+
  actionButton('terminal',a.name,'打开终端','button-secondary','',a.auth!=='ok'||Boolean(a.duplicateOf))+
  (a.protected?'':actionButton('enable',a.name,'停用账号','button-text-danger',' data-enable="false"'))+
  '</div></details>';
 const controls='<div class="row-tools">'+primary+secondary+'</div>';
 return '<article role="listitem" class="account-row'+(selected?' is-selected':'')+(disabled?' is-disabled':'')+'" data-row="'+escapeHtml(a.name)+'">'+
 identity+quotaBlock(a.fiveHour,'五小时',disabled,Boolean(a.error))+quotaBlock(a.week,'每周',disabled,Boolean(a.error))+controls+details(a)+'</article>';
}
function summaryCard(label,value,foot,selected=false){
 return '<div class="summary-item'+(selected?' selected':'')+'"><div class="summary-label">'+escapeHtml(label)+'</div><div class="summary-value">'+escapeHtml(value)+'</div><div class="summary-foot">'+escapeHtml(foot)+'</div></div>';
}
function render(data){
 const opened=new Set(Array.from(document.querySelectorAll('.account-detail[open]')).map(x=>x.dataset.slot));
 const openMenus=new Set(Array.from(document.querySelectorAll('.account-actions[open]')).map(x=>x.dataset.slot));
 snapshot=data;
 const slots=data.accounts||[],active=data.active||'A',enabled=slots.filter(a=>a.enabled);
 const now=Math.floor(Date.now()/1000),ordered=sortAccounts(slots,now);
 const distinct=enabled.filter(a=>a.auth==='ok'&&!a.duplicateOf);
 const available=enabled.filter(a=>isReady(a)&&a.allowed!==false&&[remainingOf(a.fiveHour),remainingOf(a.week)].some(v=>v!==null)&&[remainingOf(a.fiveHour),remainingOf(a.week)].every(v=>v===null||v>0));
 const filled=enabled.filter(a=>a.auth==='ok'&&(remainingOf(a.fiveHour)===0||remainingOf(a.week)===0)).length;
 $('selected').textContent=active;
 const current=slots.find(a=>a.name===active);
 $('current-hint').textContent=current?.email||'仅影响从此处打开的独立终端';
 $('checked').textContent='最近同步：'+msTime(data.checkedAt);
 $('conn').className='conn ok';$('conn').innerHTML='<i class="indicator" aria-hidden="true"></i>本地服务正常';
 $('server-mode').textContent=data.live?'正在读取现役定时任务数据':'仓库本地模式';
 $('overview').innerHTML=[
  summaryCard('启用槽位',String(enabled.length),'已登录 '+distinct.length+' 个不同身份'),
  summaryCard('已知额度可用',String(available.length),'按官方返回的额度判断'),
  summaryCard('额度耗尽',String(filled),'任一已知周期剩余为 0%'),
  summaryCard('当前操作',active,'切换后不更改其它程序账号',true)
 ].join('');
 $('cards').innerHTML=ordered.map(x=>accountRow(x,active,now)).join('');
 for(const slot of opened){const el=Array.from(document.querySelectorAll('.account-detail')).find(x=>x.dataset.slot===slot);if(el)el.open=true}
 for(const slot of openMenus){const el=Array.from(document.querySelectorAll('.account-actions')).find(x=>x.dataset.slot===slot);if(el)el.open=true}
 updateCountdowns();
}
async function refresh(force=true){
 const btn=$('refresh');btn.disabled=true;btn.textContent='正在同步…';
 try{render(await request('/api/status'+(force?'?refresh=1':'')))}
 catch(e){
  $('conn').className='conn fail';$('conn').innerHTML='<i class="indicator" aria-hidden="true"></i>查询异常';
  notify('无法更新额度：'+e.message,true);
 }finally{btn.disabled=false;btn.innerHTML='<span aria-hidden="true">⟳</span> 刷新额度'}
}
async function act(type,slot,button){
 try{
  if(type==='select'){
   await request('/api/active','POST',{slot});notify('当前操作账号已切换至 '+slot);await refresh();return;
  }
  if(type==='enable'){
   const enabled=button.dataset.enable==='true';
   if(!confirm((enabled?'启用':'停用')+'账号 '+slot+'？不会删除登录凭据。'))return;
   await request('/api/enable','POST',{slot,enabled});notify(slot+' 已'+(enabled?'启用':'停用'));await refresh();return;
  }
  if(type==='terminal'){
   await request('/api/terminal','POST',{slot});notify('已请求打开 '+slot+' 的独立 Codex 终端');return;
  }
  if(type==='login'){
   if(loginPoll)throw Error('请先完成或取消正在进行的登录');
   const account=snapshot.accounts.find(x=>x.name===slot),replace=account.auth==='ok';
   if(replace&&!confirm('将退出 '+slot+' 当前登录并重新授权。'+(slot==='A'?'这是主账号，请确认你要替换它。':'其他账号不会受到影响。')+' 是否继续？'))return;
   const result=await request('/api/login/start','POST',{slot,replace,confirmPrimary:slot==='A'});
   loginSlot=slot;
   $('operation').hidden=false;$('op-title').textContent=slot+' · ChatGPT 授权';
   $('op-detail').textContent='已生成此槽位的独立登录链接。完成浏览器授权后，此处会更新登录状态。';
   $('auth-link').href=result.authUrl;$('auth-link').hidden=false;
   $('operation').scrollIntoView({behavior:'smooth',block:'center'});
   loginPoll=setInterval(async()=>{
    try{
     const s=await request('/api/login/status?slot='+encodeURIComponent(slot));
     if(!['waiting','starting'].includes(s.status)){
      clearInterval(loginPoll);loginPoll=null;
      const ok=s.status==='completed';
      $('op-detail').textContent=ok?'登录成功，已更新账号身份。':(s.error||'登录未完成：'+s.status);
      $('auth-link').hidden=true;$('auth-link').removeAttribute('href');
      await refresh();notify(ok?'账号 '+slot+' 登录成功':$('op-detail').textContent,!ok);
     }
    }catch{}
   },1900)
  }
 }catch(e){notify(e.message,true)}
}
document.addEventListener('click',ev=>{
 if(!ev.target.closest('.account-actions'))document.querySelectorAll('.account-actions[open]').forEach(el=>{el.open=false});
 const btn=ev.target.closest('button[data-act]');
 if(!btn||btn.disabled)return;
 btn.disabled=true;
 act(btn.dataset.act,btn.dataset.slot,btn).finally(()=>{if(btn.isConnected)btn.disabled=false});
});
document.addEventListener('keydown',ev=>{
 if(ev.key==='Escape')document.querySelectorAll('.account-actions[open]').forEach(el=>{el.open=false});
});
$('refresh').addEventListener('click',()=>refresh());
$('add-btn').addEventListener('click',async()=>{
 const input=$('new-slot'),slot=input.value.trim().toUpperCase();
 if(!/^[B-Z][A-Z0-9_-]{0,15}$/.test(slot)){notify('请输入有效槽位名称，例如 D、E、F',true);return}
 const btn=$('add-btn');btn.disabled=true;
 try{await request('/api/slot','POST',{slot});input.value='';notify(slot+' 已启用。点击账号登录即可授权。');await refresh()}
 catch(e){notify(e.message,true)}finally{btn.disabled=false}
});
$('new-slot').addEventListener('keydown',e=>{if(e.key==='Enter'){$('add-btn').click()}});
$('cancel-login').addEventListener('click',async()=>{
 if(!loginSlot)return;
 try{
  await request('/api/login/cancel','POST',{slot:loginSlot});
  if(loginPoll){clearInterval(loginPoll);loginPoll=null}
  $('auth-link').removeAttribute('href');$('operation').hidden=true;loginSlot=null;notify('登录流程已取消');
 }catch(e){notify(e.message,true)}
});
(async()=>{
 try{csrf=(await request('/api/session')).csrf;await refresh()}
 catch(e){notify('页面初始化失败：'+e.message,true)}
 setInterval(()=>{if(!document.hidden&&!loginPoll)refresh(false)},45000);
 setInterval(()=>{if(!document.hidden)updateCountdowns()},1000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){updateCountdowns();if(!loginPoll)refresh(false)}});
})();
