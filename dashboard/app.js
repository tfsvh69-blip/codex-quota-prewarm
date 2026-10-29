'use strict';
const $=id=>document.getElementById(id);
let csrf='',snapshot=null,pollLogin=null,loginSlot=null,toastTimer=null;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function note(message,isError=false){
 const x=$('toast');x.textContent=message;x.className='toast show'+(isError?' error':'');
 clearTimeout(toastTimer);toastTimer=setTimeout(()=>x.className='toast',4400)
}
const when=epoch=>!epoch?'—':new Date(epoch*1000).toLocaleString('zh-CN',{hour12:false});
const localTime=ms=>!ms?'—':new Date(ms).toLocaleString('zh-CN',{hour12:false});
async function api(path,method='GET',data=null){
 const response=await fetch(path,{method,headers:{'Content-Type':'application/json','x-codex-csrf':csrf},body:data?JSON.stringify(data):undefined,cache:'no-store'});
 const obj=await response.json();if(!response.ok)throw Error(obj.error||'请求失败');return obj
}
function bubbleAuth(a){
 if(!a.enabled)return ['已停用',''];
 if(a.auth!=='ok')return ['未登录','warn'];
 if(a.duplicateOf)return ['与 '+a.duplicateOf+' 重复','error'];
 if(a.error)return ['额度读取异常','warn'];
 if(a.fiveHour?.used>=100 || a.allowed===false)return ['当前受限','warn'];
 return ['已登录','ok']
}
function usageLine(q,label){
 const val=q?.used,valid=val!==null && val!==undefined;
 const percent=valid?Math.max(0,Math.min(100,val)):0;
 return '<div class="bar-row"><div class="bar-label"><span>'+label+'</span><b>'+(valid?val+'%':'未读取')+'</b></div>'+
  '<div class="track"><div class="fill '+(percent>=99?'full':percent>=80?'heavy':'')+'" style="width:'+percent+'%"></div></div>'+
  '<div class="reset">重置：'+esc(q?.reset?when(q.reset):'—')+'</div></div>'
}
function slotCard(a){
 const selected=snapshot.active===a.name;
 const [auth,color]=bubbleAuth(a);
 const email=a.email|| (a.enabled?'尚未读到邮箱':'已停用');
 const last=a.lastRequest?'最后模型成功：'+localTime(a.lastRequest):'最近模型请求：暂无已匹配记录';
 const morning=a.morning?'晨间：'+a.morning.day+' '+a.morning.status:'晨间：暂无匹配身份记录';
 const buttons='<button data-act="select" data-slot="'+a.name+'" '+(!a.enabled?'disabled':'')+' class="'+(selected?'primary':'')+'">'+(selected?'当前操作':'设为当前')+'</button>'+
  '<button data-act="login" data-slot="'+a.name+'" '+(!a.enabled?'disabled':'')+'>'+(a.auth==='ok'?'更换登录':'账号登录')+'</button>'+
  '<button data-act="terminal" data-slot="'+a.name+'" '+(!a.enabled||a.auth!=='ok'||a.duplicateOf?'disabled':'')+'>打开终端</button>'+
  (a.protected?'':'<button data-act="enable" data-slot="'+a.name+'" data-enable="'+(!a.enabled)+'" class="danger">'+(a.enabled?'停用':'启用')+'</button>');
 const logs=(a.recent||[]).map(s=>'<div>'+esc(s)+'</div>').join('');
 return '<article class="card '+(selected?'active':'')+'"><div class="card-top"><div class="name"><span class="avatar">'+esc(a.name)+'</span>'+esc(a.protected?'主账号 '+a.name:'账号 '+a.name)+'</div>'+
  '<span class="pill '+color+'">'+esc(auth)+'</span></div><div class="email" title="'+esc(email)+'">'+esc(email)+'</div>'+
  usageLine(a.fiveHour,'五小时额度 · 已使用')+usageLine(a.week,'每周额度 · 已使用')+
  '<div class="evidence">'+esc(morning)+'<div>'+esc(last)+'</div>'+(a.error?'<div>接口提示：'+esc(a.error)+'</div>':'')+'</div>'+
  '<div class="card-actions">'+buttons+'</div><details class="card-log"><summary>最近巡检记录</summary>'+(logs||'<div>暂无日志</div>')+'</details></article>'
}
function render(s){
 snapshot=s;
 const list=s.accounts,online=list.filter(x=>x.enabled),logged=online.filter(x=>x.auth==='ok'&&!x.duplicateOf);
 $('selected').textContent=s.active||'A';$('checked').textContent='更新于 '+localTime(s.checkedAt);
 $('server-mode').textContent=s.live?'已连接现役调度目录':'仓库本地模式';
 $('conn').textContent='本地服务正常';$('conn').className='status ok';
 const busy=online.filter(x=>x.fiveHour?.used>=100).length;
 const items=[['启用账号',online.length,'槽位'],['身份有效',logged.length,'个独立账号'],['当前受限',busy,'五小时额度已达100%'],['当前操作槽位',s.active||'A','可从卡片切换']];
 $('overview').innerHTML=items.map(x=>'<div class="metric"><div class="k">'+esc(x[0])+'</div><div class="v">'+esc(x[1])+'</div><div class="minor">'+esc(x[2])+'</div></div>').join('');
 $('cards').innerHTML=list.map(slotCard).join('');
}
async function refresh(force=true){
 $('refresh').disabled=true;$('refresh').textContent='正在查询…';
 try{render(await api('/api/status'+(force?'?refresh=1':'')))}catch(e){
  $('conn').textContent='连接或查询失败';$('conn').className='status fail';note(e.message,true)
 }finally{$('refresh').disabled=false;$('refresh').textContent='刷新全部状态'}
}
async function act(type,slot,el){
 try{
  if(type==='select'){await api('/api/active','POST',{slot});note('当前操作账号已切换到 '+slot);await refresh()}
  if(type==='enable'){
   const enabled=el.dataset.enable==='true';
   if(!window.confirm((enabled?'启用':'停用')+'账号 '+slot+'？不会删除登录凭据。'))return;
   await api('/api/enable','POST',{slot,enabled});note('槽位 '+slot+' 已'+(enabled?'启用':'停用'));await refresh()
  }
  if(type==='terminal'){
   await api('/api/terminal','POST',{slot});note('已请求打开 '+slot+' 独立 Codex 终端')
  }
  if(type==='login'){
   if(pollLogin){clearInterval(pollLogin);pollLogin=null}
   const account=snapshot.accounts.find(x=>x.name===slot);
   const replace=account.auth==='ok';
   if(replace&&!window.confirm('将退出 '+slot+' 现有登录并重新授权。'+(slot==='A'?'这是主账号 A，请确认你确实要替换！':'不会影响其它账号。')+' 是否继续？'))return;
   const result=await api('/api/login/start','POST',{slot,replace,confirmPrimary:slot==='A'});
   $('operation').hidden=false;$('op-title').textContent=slot+' · 浏览器登录';
   $('op-detail').textContent='已创建该槽位专属授权。点击下面的链接，完成 ChatGPT 授权后页面会自动更新状态。';
   $('auth-link').href=result.authUrl;$('auth-link').hidden=false;
   loginSlot=slot;
   $('operation').scrollIntoView({behavior:'smooth',block:'nearest'});
   pollLogin=setInterval(async()=>{
    try{
     const state=await api('/api/login/status?slot='+encodeURIComponent(slot));
     if(!['waiting','starting'].includes(state.status)){
      clearInterval(pollLogin);pollLogin=null;
      $('op-detail').textContent=state.status==='completed'?'登录成功，已读取新身份。':(state.error||'登录未完成');
      $('auth-link').hidden=true;await refresh();
      note(state.status==='completed'?'账号 '+slot+' 登录成功':'账号 '+slot+'：'+(state.error||'未完成'),state.status!=='completed')
     }
    }catch{}
   },1800)
  }
 }catch(e){note(e.message,true)}
}
document.addEventListener('click',e=>{
 const btn=e.target.closest('button[data-act]');if(!btn)return;
 btn.disabled=true;
 act(btn.dataset.act,btn.dataset.slot,btn).finally(()=>{btn.disabled=false})
});
$('refresh').addEventListener('click',()=>refresh());
$('add-btn').addEventListener('click',async()=>{
 const input=$('new-slot'),slot=input.value.trim().toUpperCase();
 if(!/^[B-Z][A-Z0-9_-]{0,15}$/.test(slot)){note('请输入有效槽位，如 D、E、F',true);return}
 try{await api('/api/slot','POST',{slot});input.value='';note('已新增/启用 '+slot+'，请点击该卡片「账号登录」');await refresh()}catch(e){note(e.message,true)}
});
$('cancel-login').addEventListener('click',async()=>{
 if(!loginSlot)return;
 try{await api('/api/login/cancel','POST',{slot:loginSlot});$('operation').hidden=true;
  if(pollLogin)clearInterval(pollLogin);pollLogin=null;note('已取消登录')}catch(e){note(e.message,true)}
});
(async()=>{
 try{csrf=(await api('/api/session')).csrf;await refresh()}catch(e){note(e.message,true)}
 setInterval(()=>{if(!document.hidden&&!pollLogin)refresh(false)},45000)
})();
