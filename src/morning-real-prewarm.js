'use strict';
// Daily 05:30 real Codex request. Intentionally no resetAt/percent-based preflight skip.
// Limits: one successful request per account per calendar day, bounded retries for failures.
// Login tokens never copied or printed. ChatGPT auth only; OPENAI_API_KEY removed.
const fs=require('fs'),path=require('path'),os=require('os');
const {spawn}=require('child_process');
const runtime=require('./runtime');
const {bindIdentity,validateDistinct}=require('./account-manager');
const root=runtime.root, logDir=runtime.logs;
fs.mkdirSync(logDir,{recursive:true});
const work=runtime.work;
fs.mkdirSync(work,{recursive:true});
const exe=runtime.exe;
const argv=process.argv.slice(2);
const dry=argv.includes('--dry-run'), accountArg=argv.find(x=>x.startsWith('--account='))?.split('=')[1];
const accts=validateDistinct(runtime.accounts().filter(a=>!accountArg||a.name===accountArg));
const minutes=n=>n*60000, now=()=>Date.now();
const date=()=>new Date().toLocaleDateString('sv-SE',{timeZone:runtime.tz});
const stamp=()=>new Date().toLocaleString('sv-SE',{timeZone:'Asia/Shanghai',hour12:false});
const logPath=path.join(logDir,'晨间真实预激活.log');
function log(msg) {
 const line='['+stamp()+'] '+msg;
 console.log(line);
 if(!dry)fs.appendFileSync(logPath,line+'\n','utf8');
}
function readState(name) {
 try{return JSON.parse(fs.readFileSync(path.join(logDir,'morning-'+name+'.json'),'utf8'))}catch{return {}}
}
function saveState(name,state) {
 if(dry)return;
 const dst=path.join(logDir,'morning-'+name+'.json');
 fs.writeFileSync(dst+'.tmp',JSON.stringify(state,null,2),'utf8');
 fs.renameSync(dst+'.tmp',dst);
}
function envFor(home) {const e={...process.env,CODEX_HOME:home};delete e.OPENAI_API_KEY;return e}
function rate(home) {
 return new Promise(resolve=>{
  const p=spawn(exe,['app-server','--stdio'],{env:envFor(home),cwd:work,
   windowsHide:true,stdio:['pipe','pipe','ignore']});
  let buf='',done=false; const timer=setTimeout(()=>finish(null),22000);
  function finish(x){if(done)return;done=true;clearTimeout(timer);try{p.kill()}catch{};resolve(x)}
  function send(m){try{p.stdin.write(JSON.stringify(m)+'\n')}catch{}}
  p.stdout.on('data',b=>{
   buf+=b.toString();
   while(buf.includes('\n')){
    const i=buf.indexOf('\n');const line=buf.slice(0,i);buf=buf.slice(i+1);
    let x;try{x=JSON.parse(line)}catch{continue}
    if(x.id===1){if(x.error){finish(null);return}send({method:'initialized',params:{}});
     send({id:2,method:'account/rateLimits/read',params:{}})}
    if(x.id===2){const r=x.result||{};finish(x.error?null:
      (r.rateLimitsByLimitId?.codex||r.rateLimits||null))}
   }
  });
  p.on('error',()=>finish(null));p.on('close',()=>finish(null));
  send({id:1,method:'initialize',params:{clientInfo:{name:'daily-codex-prewarm',
   title:'Daily Codex Prewarm',version:'2.0.0'},capabilities:{}}});
 });
}
async function readFixedWindow(home) {
 const first=await rate(home),t1=now();
 if(!first?.primary)return {verified:false,reason:'quota_read_1_failed'};
 await new Promise(r=>setTimeout(r,6500));
 const second=await rate(home),t2=now();
 if(!second?.primary)return {verified:false,reason:'quota_read_2_failed'};
 const a=first.primary,b=second.primary;
 const ra=Number(a.resetsAt),rb=Number(b.resetsAt);
 if(!Number.isFinite(ra)||!Number.isFinite(rb))return {verified:false,reason:'reset_not_numeric'};
 const drift=Math.abs(rb-ra);
 const left=rb*1000-t2;
 // A model turn may occur in an already-active window, in which case the fixed end
 // is closer than five hours. An unstarted, rolling end moves by ~elapsed seconds.
 const verified=drift<=2 && left>=0 && left<=minutes(305);
 return {verified,reason:verified?'fixed_reset_confirmed':'floating_or_invalid_reset',
  resetAt:rb,firstResetAt:ra,elapsedSeconds:Math.round((t2-t1)/1000),
  usedPercent:Number(b.usedPercent)};
}
function model(home){
 return new Promise(resolve=>{
  const params=['exec','--json','-c','model_reasoning_effort=low',
   '--ephemeral','--skip-git-repo-check','--sandbox','read-only','-C',work,
   'Reply exactly OK. Do not use tools or inspect files.'];
  const p=spawn(exe,params,{cwd:work,windowsHide:true,env:envFor(home),
   stdio:['ignore','pipe','pipe']});
  let stdout='',err='',done=false;
  const timer=setTimeout(()=>{if(done)return;done=true;try{p.kill()}catch{}
   resolve({ok:false,reason:'timeout_120s'})},120000);
  function finish(obj){if(done)return;done=true;clearTimeout(timer);resolve(obj)}
  p.stdout.on('data',b=>{if(stdout.length<250000)stdout+=b.toString()});
  p.stderr.on('data',b=>{if(err.length<2000)err+=b.toString()});
  p.on('error',()=>finish({ok:false,reason:'spawn_failed'}));
  p.on('close',code=>{
   let completed=false,reply=false,failed=false,used=0;
   for(const line of stdout.split(/\r?\n/)){
    if(!line.trim())continue;
    let x;try{x=JSON.parse(line)}catch{continue}
    if(x.type==='item.completed'&&x.item?.type==='agent_message'&&
      String(x.item.text||'').trim()==='OK')reply=true;
    if(x.type==='turn.completed'){completed=true;used=Number(x.usage?.input_tokens||0)}
    if(x.type==='turn.failed')failed=true;
   }
   const ok=code===0&&completed&&reply&&used>0&&!failed;
   finish({ok,reason:ok?'completed':'incomplete_or_failed',exit:code,
      tokens:used,stderrSeen:err.length>0});
  });
 });
}
async function one(a){
 const day=date(),st=readState(a.name);
 if(a.identity.status!=='ok'){
   log(a.name+' PENDING_LOGIN: '+a.identity.status+'; no model request');return false;
 }
 const b=bindIdentity(st,a.identity,message=>log(a.name+' '+message));
 let s=b.state;
 if(b.changed || s.day!==day)s={day:day,status:'new',attempts:0,identityHash:a.identity.hash};
 saveState(a.name,s);
 const auth=path.join(a.home,'auth.json');
 if(!fs.existsSync(auth)){log(a.name+' PENDING_LOGIN: no_login_file');return false}
 if(s.status==='verified'){
   log(a.name+' SKIP confirmed for '+day+' fixed reset='+s.resetAt);
   return true;
 }
 if(s.status==='model_completed_unverified'){
   const probe=await readFixedWindow(a.home);
   if(probe.verified){
    s.status='verified';s.resetAt=probe.resetAt;saveState(a.name,s);
    log(a.name+' VERIFIED_AFTER_DELAY reset='+new Date(probe.resetAt*1000).toISOString());
    return true;
   }
   // Prevent sending a second request shortly after a valid model turn.
   if(now()-Number(s.modelCompletedAt||0)<minutes(20)){
    log(a.name+' PENDING_VERIFICATION '+probe.reason+'; no duplicate model request');
    return false;
   }
   if(s.attempts>=3){
    log(a.name+' FAIL no fixed quota reset after successful model turn; capped requests');
    return false;
   }
 }
 if(Number(s.lastAttemptAt||0) && now()-s.lastAttemptAt<minutes(12)){
   log(a.name+' RETRY_WAIT cooldown');return false;
 }
 if(s.attempts>=3){log(a.name+' FAIL attempts_capped_three');return false}
 if(dry){log(a.name+' DRY_RUN would_submit_real_Codex_turn; no quota consumed');return true}
 s.attempts++;s.lastAttemptAt=now();s.status='attempting';saveState(a.name,s);
 log(a.name+' START real request attempt='+s.attempts);
 const response=await model(a.home);
 if(!response.ok){
   s.status='request_failed';s.failure=response.reason;saveState(a.name,s);
   log(a.name+' REQUEST_FAILED reason='+response.reason+' exit='+response.exit);
   return false;
 }
 s.status='model_completed_unverified';s.modelCompletedAt=now();
 s.inputTokens=response.tokens;saveState(a.name,s);
 log(a.name+' REQUEST_OK turn.completed=true reply=OK tokens='+response.tokens);
 const probe=await readFixedWindow(a.home);
 if(probe.verified){
   s.status='verified';s.resetAt=probe.resetAt;saveState(a.name,s);
   log(a.name+' WINDOW_VERIFIED fixedReset='+new Date(probe.resetAt*1000).toISOString()+
    ' usedPercent='+probe.usedPercent+' elapsed='+probe.elapsedSeconds+'s');
   return true;
 }
 s.failure=probe.reason;saveState(a.name,s);
 log(a.name+' WINDOW_UNVERIFIED '+probe.reason+'; retry will recheck without duplicate model call');
 return false;
}
async function main(){
 if(!accts.length){log('ERROR unknown account argument');process.exitCode=4;return}
 if(!fs.existsSync(exe)){log('ERROR official codex.exe not found');process.exitCode=4;return}
 const lock=path.join(logDir,'morning-real.lock');
 let fd=null;
 try{
  try{fd=fs.openSync(lock,'wx');fs.writeFileSync(fd,JSON.stringify({pid:process.pid,time:now()}))}
  catch{
   try{const s=fs.statSync(lock);
    if(now()-s.mtimeMs>minutes(9)){fs.unlinkSync(lock);fd=fs.openSync(lock,'wx')}}
   catch{}
  }
  if(fd===null){log('SKIP another morning runner is active');return}
  log('RUN day='+date()+' mode='+(dry?'dry':'real')+' accounts='+accts.map(x=>x.name).join(','));
  let all=true;
  for(const a of accts){
   try{const ok=await one(a);if(!ok && a.identity.status==='ok')all=false}
   catch(e){all=false;log(a.name+' ERROR '+e.name)}
  }
  log('DONE allLoggedInVerified='+all+' pendingLogin='+accts.filter(a=>a.identity.status!=='ok').map(a=>a.name).join(','));
  if(!all&&!dry)process.exitCode=2;
 }finally{if(fd!==null){try{fs.closeSync(fd)}catch{};try{fs.unlinkSync(lock)}catch{}}}
}
main().catch(e=>{log('FATAL '+e.name);process.exitCode=2});
