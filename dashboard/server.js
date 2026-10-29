'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const runtime=require('../src/runtime');
const {getIdentity}=require('../src/account-manager');
const root=runtime.root,localFile=path.join(root,'.dashboard.local.json');
let local={};try{local=JSON.parse(fs.readFileSync(localFile,'utf8'))}catch{}
const schedulerRoot=local.schedulerRoot&&fs.existsSync(local.schedulerRoot)?local.schedulerRoot:root;
const slotFile=path.join(schedulerRoot,'accounts.json'),stateFile=path.join(root,'dashboard-state.json');
const port=Number(process.env.CODEX_DASHBOARD_PORT||local.port||38671),csrf=crypto.randomBytes(24).toString('hex');
let state={active:'A'};try{state={...state,...JSON.parse(fs.readFileSync(stateFile,'utf8'))}}catch{}
const sessions=new Map(),cache={at:0,data:null,promise:null};
function entries(){
 if(fs.existsSync(slotFile))return JSON.parse(fs.readFileSync(slotFile,'utf8'));
 const other=path.join(root,'config.local.json');
 if(fs.existsSync(other)){const o=JSON.parse(fs.readFileSync(other,'utf8'));if(Array.isArray(o.accounts))return o}
 return {version:1,accounts:['A','B','C'].map(name=>({name,home:name==='A'?'.codex':'.codex-prewarm-'+name,enabled:true}))};
}
function writeEntries(o){
 if(!Array.isArray(o.accounts))throw Error('配置格式错误');
 if(fs.existsSync(slotFile))fs.copyFileSync(slotFile,slotFile+'.dashboard-bak');
 const tmp=slotFile+'.new';fs.writeFileSync(tmp,JSON.stringify(o,null,2));fs.renameSync(tmp,slotFile);cache.at=0;
}
function slots(){return entries().accounts.map(x=>{
 const name=String(x.name||'').toUpperCase(),folder=String(x.home||(name==='A'?'.codex':'.codex-prewarm-'+name));
 return {name,enabled:x.enabled!==false,home:path.isAbsolute(folder)?folder:path.join(os.homedir(),folder),protected:name==='A'};
})}
function getSlot(name){const a=slots().find(x=>x.name===name&&x.enabled);if(!a)throw Error('账号槽位不存在或已停用');return a}
function cleanEnv(home){const env={...process.env,CODEX_HOME:home};delete env.OPENAI_API_KEY;delete env.CODEX_ACCESS_TOKEN;return env}
class Rpc {
 constructor(home,onNotify=()=>{}){
  this.seq=0;this.wait=new Map();this.buffer='';this.closed=false;this.onNotify=onNotify;
  this.p=spawn(runtime.exe,['app-server','--stdio'],{env:cleanEnv(home),cwd:runtime.work,windowsHide:true,stdio:['pipe','pipe','pipe']});
  this.p.stdout.on('data',chunk=>this.feed(chunk.toString()));
  this.p.stderr.on('data',()=>{});
  this.p.on('error',()=>this.fail(new Error('Codex 启动失败')));
  this.p.on('close',()=>this.fail(new Error('Codex 已退出')));
 }
 feed(data){
  this.buffer+=data;if(this.buffer.length>1000000){this.close();return}
  while(this.buffer.includes('\n')){
   const n=this.buffer.indexOf('\n'),s=this.buffer.slice(0,n);this.buffer=this.buffer.slice(n+1);
   let msg;try{msg=JSON.parse(s)}catch{continue}
   if(msg.id!==undefined&&this.wait.has(msg.id)){
    const p=this.wait.get(msg.id);this.wait.delete(msg.id);clearTimeout(p.timer);
    msg.error?p.reject(new Error('Codex 接口错误')):p.resolve(msg.result||{});
   }else if(msg.method)this.onNotify(msg);
  }
 }
 call(method,params={},ms=20000){
  return new Promise((resolve,reject)=>{
   if(this.closed){reject(Error('连接已关闭'));return}
   const id=++this.seq,timer=setTimeout(()=>{this.wait.delete(id);reject(Error('Codex 请求超时'))},ms);
   this.wait.set(id,{resolve,reject,timer});
   try{this.p.stdin.write(JSON.stringify({id,method,params})+'\n')}catch(e){clearTimeout(timer);this.wait.delete(id);reject(e)}
  })
 }
 async init(){await this.call('initialize',{clientInfo:{name:'codex-prewarm-dashboard',title:'Codex Quota Dashboard',version:'0.1.0'},capabilities:{}});this.p.stdin.write('{"method":"initialized","params":{}}\n')}
 fail(e){this.closed=true;for(const x of this.wait.values()){clearTimeout(x.timer);x.reject(e)}this.wait.clear()}
 close(){this.closed=true;try{this.p.kill()}catch{}}
}
function quota(o){
 if(!o)return null;
 const raw=o.usedPercent,used=raw===null||raw===undefined||raw===''?null:Number(raw);
 return {used:used!==null&&Number.isFinite(used)?Math.max(0,Math.min(100,used)):null,reset:Number(o.resetsAt)||null,duration:Number(o.windowDurationMins)||null};
}
function pickQuotaWindows(limits){
 const windows=[limits?.primary,limits?.secondary].filter(Boolean),mins=w=>Number(w?.windowDurationMins)||0;
 // On some plans, primary itself is weekly and there is no 5-hour window.
 const short=windows.find(w=>mins(w)>0&&mins(w)<10080)||(limits?.primary&&!mins(limits.primary)?limits.primary:null);
 const weekly=windows.find(w=>mins(w)===10080)||(limits?.secondary&&!mins(limits.secondary)?limits.secondary:null);
 return {short:quota(short),weekly:quota(weekly)};
}
function evidence(slot,id){
 const read=f=>{try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return {}}};
 const morning=read(path.join(schedulerRoot,'logs','morning-'+slot.name+'.json'));
 const smart=read(path.join(schedulerRoot,'logs','smart-'+slot.name+'.json'));
 const ok=id.status==='ok';
 let recent=[];try{recent=fs.readFileSync(path.join(schedulerRoot,'logs','智能调度.log'),'utf8').split(/\r?\n/).filter(s=>s.includes('] '+slot.name+' ')&&/REQUEST_OK|RESET_TIME_CHANGED|ERROR:|SKIP:/.test(s)).slice(-3).map(s=>s.slice(0,210))}catch{}
 return {morning:ok&&morning.identityHash===id.hash?{day:morning.day,status:morning.status}:null,
  lastRequest:ok&&smart.identityHash===id.hash?smart.lastSuccessAt||null:null,recent};
}
async function inspect(slot){
 const id=getIdentity(slot.home),base={name:slot.name,enabled:slot.enabled,protected:slot.protected,auth:id.status,...evidence(slot,id)};
 if(!slot.enabled||id.status!=='ok')return base;
 const dup=slots().find(x=>x.enabled&&x.name<slot.name&&getIdentity(x.home).hash===id.hash);
 if(dup)base.duplicateOf=dup.name;
 const rpc=new Rpc(slot.home);
 try{
  await rpc.init();
  const account=(await rpc.call('account/read',{refreshToken:false})).account;
  let rate={},error=null;
  if(account?.type==='chatgpt'){try{rate=await rpc.call('account/rateLimits/read',{})}catch{error='额度查询暂不可用'}}
  const x=rate.rateLimitsByLimitId?.codex||rate.rateLimits||{};
  const windows=pickQuotaWindows(x);
  return {...base,email:account?.email||null,plan:account?.planType||null,
   fiveHour:windows.short,week:windows.weekly,allowed:rate.ordinaryUsageAllowed??null,error};
 }catch(e){return {...base,error:e.message}}finally{rpc.close()}
}
async function getStatus(force){
 if(cache.promise)return cache.promise;
 if(!force&&cache.data&&Date.now()-cache.at<25000)return cache.data;
 cache.promise=(async()=>{
  const arr=slots(),rows=[];
  for(let i=0;i<arr.length;i+=3)rows.push(...await Promise.all(arr.slice(i,i+3).map(inspect)));
  cache.data={accounts:rows,active:state.active,checkedAt:Date.now(),live:schedulerRoot!==root};
  cache.at=Date.now();return cache.data;
 })().finally(()=>{cache.promise=null});
 return cache.promise
}
function invalidate(){cache.at=0}
async function beginLogin(slot,replace){
 // Codex requires CODEX_HOME to exist before starting app-server login.
 fs.mkdirSync(slot.home,{recursive:true});
 const prev=sessions.get(slot.name);
 if(prev&&['starting','waiting'].includes(prev.status))throw Error('该槽位已有登录流程');
 const session={status:'starting',error:null,slot:slot.name};sessions.set(slot.name,session);
 const rpc=new Rpc(slot.home,m=>{
  if(m.method==='account/login/completed'){
   session.status=m.params?.success?'completed':'failed';session.error=m.params?.success?null:'授权未完成';
   if(m.params?.success){const hash=getIdentity(slot.home).hash;
    const duplicate=slots().find(x=>x.enabled&&x.name!==slot.name&&getIdentity(x.home).hash===hash);
    if(duplicate){session.status='duplicate';session.error='与 '+duplicate.name+' 登录同一账号，需更换'}
   }
   invalidate();setTimeout(()=>rpc.close(),500);
  }
 });
 session.rpc=rpc;
 try{
  await rpc.init();
  if(replace)await rpc.call('account/logout',{});
  const result=await rpc.call('account/login/start',{type:'chatgpt',useHostedLoginSuccessPage:true,appBrand:'codex'});
  if(typeof result.authUrl!=='string'||!result.authUrl.startsWith('https://'))throw Error('没有收到授权链接');
  session.status='waiting';session.loginId=result.loginId;
  setTimeout(()=>{if(session.status==='waiting'){session.status='timeout';rpc.close()}},5*60*1000);
  return {status:'waiting',slot:slot.name,authUrl:result.authUrl};
 }catch(e){session.status='failed';session.error=e.message;rpc.close();throw e}
}
function send(res,code,obj){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj))}
function body(req){return new Promise((resolve,reject)=>{let b='';req.on('data',s=>{b+=s;if(b.length>4096){reject(Error('请求太大'));req.destroy()}});req.on('end',()=>{try{resolve(b?JSON.parse(b):{})}catch{reject(Error('JSON 格式错误'))}});req.on('error',reject)})}
function valid(req){
 const h=req.headers.host,origin=req.headers.origin;
 return (h==='127.0.0.1:'+port||h==='localhost:'+port)
 &&(!origin||origin==='http://127.0.0.1:'+port||origin==='http://localhost:'+port)
 &&(req.socket.remoteAddress==='127.0.0.1'||req.socket.remoteAddress==='::ffff:127.0.0.1');
}
const server=http.createServer(async(req,res)=>{
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
 res.setHeader('X-Frame-Options','DENY');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
 if(!valid(req)){send(res,403,{error:'只允许本机访问'});return}
 const url=new URL(req.url,'http://localhost'),p=url.pathname;
 if(req.method==='GET'&&({'/':'index.html','/app.js':'app.js','/style.css':'style.css'})[p]){
  const file=path.join(__dirname,{'/':'index.html','/app.js':'app.js','/style.css':'style.css'}[p]);
  const mime=p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'text/html';
  res.writeHead(200,{'Content-Type':mime+'; charset=utf-8','Cache-Control':'no-store'});res.end(fs.readFileSync(file));return
 }
 if(req.method==='GET'&&p==='/api/session'){send(res,200,{csrf,active:state.active});return}
 if(req.method==='GET'&&p==='/api/status'){try{send(res,200,await getStatus(url.searchParams.has('refresh')))}catch(e){send(res,500,{error:e.message})}return}
 if(req.method==='GET'&&p==='/api/login/status'){
  const s=sessions.get(url.searchParams.get('slot'));send(res,200,s?{slot:s.slot,status:s.status,error:s.error}:{status:'idle'});return
 }
 if(req.method!=='POST'){send(res,404,{error:'无此接口'});return}
 if(req.headers['x-codex-csrf']!==csrf){send(res,403,{error:'请刷新页面'});return}
 try{
  const data=await body(req);
  if(p==='/api/active'){
   state.active=getSlot(String(data.slot)).name;fs.writeFileSync(stateFile,JSON.stringify(state,null,2));send(res,200,{ok:true,active:state.active});return
  }
  if(p==='/api/slot'){
   const name=String(data.slot||'').trim().toUpperCase();
   if(!/^[B-Z][A-Z0-9_-]{0,15}$/.test(name))throw Error('账号槽位名称无效');
   const x=entries(),item=x.accounts.find(s=>String(s.name).toUpperCase()===name);
   if(item)item.enabled=true;else{if(x.accounts.length>=20)throw Error('最多20个槽位');x.accounts.push({name,enabled:true,home:'.codex-prewarm-'+name})}
   writeEntries(x);send(res,200,{ok:true});return
  }
  if(p==='/api/enable'){
   const name=String(data.slot||'').toUpperCase();if(name==='A')throw Error('不能停用主账号 A');
   const x=entries(),item=x.accounts.find(s=>s.name===name);if(!item)throw Error('槽位不存在');
   item.enabled=!!data.enabled;writeEntries(x);
   if(!item.enabled&&state.active===name){state.active='A';fs.writeFileSync(stateFile,JSON.stringify(state))}
   send(res,200,{ok:true});return
  }
  if(p==='/api/login/start'){
   const slot=getSlot(String(data.slot||'')),replace=!!data.replace;
   if(slot.name==='A'&&replace&&!data.confirmPrimary)throw Error('必须确认更换主账号 A');
   send(res,200,await beginLogin(slot,replace));return
  }
  if(p==='/api/login/cancel'){
   const s=sessions.get(String(data.slot||''));if(s?.status==='waiting'){try{await s.rpc.call('account/login/cancel',{loginId:s.loginId},7000)}catch{}s.status='cancelled';s.rpc.close()}
   send(res,200,{ok:true});return
  }
  if(p==='/api/terminal'){
   const slot=getSlot(String(data.slot||state.active));
   const child=spawn(process.env.ComSpec||'cmd.exe',['/k','"'+runtime.exe+'"'],{cwd:runtime.work,env:cleanEnv(slot.home),detached:true,windowsHide:false,stdio:'ignore'});
   await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});
   child.unref();send(res,200,{ok:true});return
  }
  send(res,404,{error:'无此接口'})
 }catch(e){send(res,400,{error:e.message})}
});
server.on('error',e=>{console.error('DASHBOARD_ERROR '+e.message);process.exitCode=1});
if(require.main===module)server.listen(port,'127.0.0.1',()=>console.log('DASHBOARD_READY http://127.0.0.1:'+port));
module.exports={server,entries,slots,pickQuotaWindows};
