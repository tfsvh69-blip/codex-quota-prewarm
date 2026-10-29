'use strict';
const $=id=>document.getElementById(id);
let csrf='',snapshot=null,loginPoll=null,loginSlot=null,toastTimer=null;
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const num=n=>Number.isFinite(Number(n))?Number(n):null;
const clamp=n=>Math.min(100,Math.max(0,n));
const dateTime=epoch=>!epoch?'—':new Date(epoch*1000).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
const msTime=ms=>!ms?'—':new Date(ms).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
const isReady=a=>a.enabled && a.auth==='ok' && !a.duplicateOf && !a.error;
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
 if(a.week?.used>=100)return {text:'周额度已满',cls:'warning'};
 if(a.fiveHour?.used>=100||a.allowed===false)return {text:'五小时已满',cls:'warning'};
 if(!a.fiveHour)return {text:'额度未知',cls:'neutral'};
 return {text:'可以使用',cls:'good'};
}
function quotaBlock(quota,title,disabled){
 const raw=quota?.used,valid=!disabled&&raw!==null&&raw!==undefined&&Number.isFinite(Number(raw));
 const used=valid?clamp(Number(raw)):null;
 const band=used>=99?'high':used>=80?'mid':'';
 const percent=valid?used+'%':'未读取';
 const line=valid?'<div class="meter" role="progressbar" aria-label="'+escapeHtml(title+'已用')+'" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+used+'"><div class="meter-fill '+band+'" style="width:'+used+'%"></div></div>':
  '<div class="meter is-unknown" aria-label="'+escapeHtml(title)+'没有可用数据"></div>';
 const reset=valid&&quota.reset?dateTime(quota.reset):'—';
 return '<div class="quota-cell"><div class="quota-top"><span class="quota-short-label">'+escapeHtml(title)+'</span><strong class="'+(valid?'':'unknown')+'">'+percent+'</strong></div>'+
  line+'<div class="quota-reset">重置 <strong>'+escapeHtml(reset)+'</strong></div></div>';
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
function accountRow(a,active){
 const badge=statusOf(a),selected=active===a.name,disabled=!a.enabled;
 const email=a.email||(disabled?'账号槽位未启用':a.auth==='ok'?'邮箱暂不可用':'未登录 ChatGPT');
 const main=a.protected?'主账号':'副账号';
 const identity='<div class="account-identity"><div class="identity-line"><span class="slot-icon" aria-hidden="true">'+escapeHtml(a.name)+'</span>'+
  '<div class="identity-name">'+escapeHtml(main+' '+a.name)+'</div><span class="identity-status pill '+badge.cls+'"><i></i>'+escapeHtml(badge.text)+'</span></div>'+
  '<div class="account-email" title="'+escapeHtml(email)+'">'+escapeHtml(email)+'</div></div>';
 const controls='<div class="row-tools">'+
  actionButton('select',a.name,selected?'✓ 当前操作':'设为当前',selected?'button-current primary-action':'button-secondary primary-action','',disabled)+
  actionButton('login',a.name,a.auth==='ok'?'更换登录':'账号登录','button-secondary','',disabled)+
  actionButton('terminal',a.name,'打开终端','button-ghost','',disabled||a.auth!=='ok'||Boolean(a.duplicateOf))+
  (a.protected?'':actionButton('enable',a.name,disabled?'启用':'停用',disabled?'button-secondary':'button-text-danger',' data-enable="'+String(disabled)+'"'))+
  '</div>';
 return '<article role="listitem" class="account-row'+(selected?' is-selected':'')+(disabled?' is-disabled':'')+'" data-row="'+escapeHtml(a.name)+'">'+
 identity+quotaBlock(a.fiveHour,'五小时',disabled)+quotaBlock(a.week,'每周',disabled)+controls+details(a)+'</article>';
}
function summaryCard(label,value,foot,selected=false){
 return '<div class="summary-item'+(selected?' selected':'')+'"><div class="summary-label">'+escapeHtml(label)+'</div><div class="summary-value">'+escapeHtml(value)+'</div><div class="summary-foot">'+escapeHtml(foot)+'</div></div>';
}
function render(data){
 const opened=new Set(Array.from(document.querySelectorAll('.account-detail[open]')).map(x=>x.dataset.slot));
 snapshot=data;
 const slots=data.accounts||[],active=data.active||'A',enabled=slots.filter(a=>a.enabled);
 const distinct=enabled.filter(a=>a.auth==='ok'&&!a.duplicateOf);
 const available=enabled.filter(a=>isReady(a)&&a.fiveHour&&a.fiveHour.used<100&&a.allowed!==false&&(!a.week||a.week.used<100));
 const filled=enabled.filter(a=>a.auth==='ok'&&(a.fiveHour?.used>=100||a.week?.used>=100)).length;
 $('selected').textContent=active;
 const current=slots.find(a=>a.name===active);
 $('current-hint').textContent=current?.email||'仅影响从此处打开的独立终端';
 $('checked').textContent='最近同步：'+msTime(data.checkedAt);
 $('conn').className='conn ok';$('conn').innerHTML='<i class="indicator" aria-hidden="true"></i>本地服务正常';
 $('server-mode').textContent=data.live?'正在读取现役定时任务数据':'仓库本地模式';
 $('overview').innerHTML=[
  summaryCard('启用槽位',String(enabled.length),'已登录 '+distinct.length+' 个不同身份'),
  summaryCard('当前可用',String(available.length),'按当前五小时与每周额度估算'),
  summaryCard('额度用满',String(filled),'任一周期使用达到 100%'),
  summaryCard('当前操作',active,'切换后不更改其它程序账号',true)
 ].join('');
 $('cards').innerHTML=slots.map(x=>accountRow(x,active)).join('');
 for(const slot of opened){const el=Array.from(document.querySelectorAll('.account-detail')).find(x=>x.dataset.slot===slot);if(el)el.open=true}
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
 const btn=ev.target.closest('button[data-act]');
 if(!btn||btn.disabled)return;
 btn.disabled=true;
 act(btn.dataset.act,btn.dataset.slot,btn).finally(()=>{if(btn.isConnected)btn.disabled=false});
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
})();
