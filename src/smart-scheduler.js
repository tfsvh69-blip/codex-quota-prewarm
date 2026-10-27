'use strict';
// Codex smart prewarm scheduler: read-only checks; actual usage only when eligible.
// No auth IDs, tokens, email, prompts, or secrets are written to logs.
const fs = require('fs');
const path = require('path');
const os = require('os');
const {spawn} = require('child_process');
const {classifyWindow,checkRollingProbe} = require('./window-detection');
const runtime = require('./runtime');
const root = runtime.root;
const logs = runtime.logs;
fs.mkdirSync(logs, {recursive:true});
const work = runtime.work;
fs.mkdirSync(work, {recursive:true});
const exe = runtime.exe;
const args = process.argv.slice(2);
const mode = args.includes('--morning') ? 'morning' : 'poll';
const dry = args.includes('--dry-run');
const accounts = runtime.accounts().filter(a=>!args.some(x=>x.startsWith('--account=')) || args.includes('--account='+a.name));
const minutes = n => n*60*1000;
const hours = n => n*60*minutes(1);
const now = () => Date.now();
function stamp(t=now()) { return new Date(t).toLocaleString('sv-SE',{timeZone:runtime.tz,hour12:false}); }
function log(msg) {
  const line = '['+stamp()+'] '+msg;
  console.log(line);
  if (!dry) fs.appendFileSync(path.join(logs,'智能调度.log'), line+'\n', 'utf8');
}
function loadState(name) {
  try { return JSON.parse(fs.readFileSync(path.join(logs,'smart-'+name+'.json'),'utf8')); }
  catch { return {}; }
}
function saveState(name,s) {
  if (dry) return;
  const f=path.join(logs,'smart-'+name+'.json');
  fs.writeFileSync(f+'.tmp',JSON.stringify(s,null,2),'utf8');
  fs.renameSync(f+'.tmp',f);
}
function recentlyActiveSession(home) {
  const folder=path.join(home,'sessions');
  if (!fs.existsSync(folder)) return 0;
  const stack=[folder]; let latest=0, inspected=0;
  while(stack.length && inspected<5000) {
    const dir=stack.pop(); let entries=[];
    try { entries=fs.readdirSync(dir,{withFileTypes:true}); } catch { continue; }
    for(const e of entries) {
      if (inspected++>5000) break;
      const p=path.join(dir,e.name);
      if(e.isDirectory()) { stack.push(p); continue; }
      if(!e.isFile() || !e.name.endsWith('.jsonl')) continue;
      try { latest=Math.max(latest, fs.statSync(p).mtimeMs); } catch {}
    }
  }
  return latest;
}
function quotaRead(home) {
  return new Promise(resolve=>{
    const env={...process.env,CODEX_HOME:home}; delete env.OPENAI_API_KEY;
    const p=spawn(exe,['app-server','--stdio'],{
      env,windowsHide:true,stdio:['pipe','pipe','ignore'],cwd:work
    });
    let buf='',gotRate=false,gotUsage=false,rate=null,usageTotal=null,finished=false;
    const timeout=setTimeout(()=>finish({error:'quota_timeout'}),26000);
    function finish(extra={}) {
      if (finished) return;
      finished=true; clearTimeout(timeout);
      try {p.kill();} catch {}
      resolve({...extra, rate,usageTotal});
    }
    function send(x) { try {p.stdin.write(JSON.stringify(x)+'\n');}catch{} }
    p.stdout.on('data', chunk=>{
      buf+=chunk.toString();
      while(buf.includes('\n')) {
        const i=buf.indexOf('\n'); const line=buf.slice(0,i); buf=buf.slice(i+1);
        let msg; try{msg=JSON.parse(line);}catch{continue;}
        if(msg.id===1) {
          if(msg.error) return finish({error:'initialize_failed'});
          send({method:'initialized',params:{}});
          send({id:2,method:'account/rateLimits/read',params:{}});
          send({id:3,method:'account/usage/read',params:{}});
        } else if(msg.id===2) {
          gotRate=true;
          if (!msg.error) {
            const r=msg.result||{};
            const b=(r.rateLimitsByLimitId||{}).codex||r.rateLimits||{};
            rate={primary:b.primary||null,secondary:b.secondary||null,
              ordinaryUsageAllowed:r.ordinaryUsageAllowed !== false};
          }
        } else if(msg.id===3) {
          gotUsage=true;
          const t=msg.result?.summary?.lifetimeTokens;
          if(Number.isFinite(t)) usageTotal=t;
        }
        if(gotRate&&gotUsage) finish(rate?{}:{error:'rate_missing'});
      }
    });
    p.on('error',()=>finish({error:'server_start_failed'}));
    p.on('exit',()=>finish({error:'server_exited_early'}));
    send({id:1,method:'initialize',params:{
      clientInfo:{name:'codex-smart-prewarm',title:'Codex Smart Prewarm',version:'1.0.0'},
      capabilities:{}
    }});
  });
}
function modelRequest(home) {
  return new Promise(resolve=>{
    const env={...process.env,CODEX_HOME:home}; delete env.OPENAI_API_KEY;
    const params=['exec','--json','-c','model_reasoning_effort=low','--ephemeral',
      '--skip-git-repo-check','--sandbox','read-only','-C',work,
      'Reply exactly OK. Do not use tools or inspect files.'];
    const p=spawn(exe,params,{env,windowsHide:true,cwd:work,stdio:['ignore','pipe','pipe']});
    let stdout='',errSize=0,finished=false,closed=false;
    const timer=setTimeout(()=>{try{p.kill();}catch{};finish({ok:false,error:'model_timeout'});},120000);
    function finish(x){
      if(finished) return; finished=true;clearTimeout(timer);resolve(x);
    }
    p.stdout.on('data',b=>{ if(stdout.length<300000) stdout+=b.toString();});
    p.stderr.on('data',b=>{errSize+=b.length;});
    p.on('error',()=>finish({ok:false,error:'model_start_failed'}));
    p.on('close',code=>{
      if(finished)return;
      let ok=false,completed=false,used=0,failed=false;
      for(const line of stdout.split(/\r?\n/)){
        if(!line.trim())continue;
        let o;try{o=JSON.parse(line)}catch{continue}
        if(o.type==='item.completed'&&o.item?.type==='agent_message'&&
          String(o.item.text||'').trim()==='OK') ok=true;
        if(o.type==='turn.completed'){
          completed=true;
          used=Number(o.usage?.input_tokens||0);
        }
        if(o.type==='turn.failed')failed=true;
      }
      finish({ok:completed&&ok&&used>0&&!failed, completed,used,code,
        error:failed?'turn_failed':(!completed?'no_turn_completed':(!ok?'unexpected_reply':null))});
    });
  });
}
async function one(a) {
  const s=loadState(a.name);
  // Use the separately verified morning request as a cooldown anchor,
  // so the daytime smart poll cannot spend a duplicate turn.
  try {
    const m=JSON.parse(fs.readFileSync(path.join(logs,'morning-'+a.name+'.json'),'utf8'));
    const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
    if(m.day===today && (m.status==='verified'||m.status==='model_completed_unverified') &&
       Number.isFinite(m.modelCompletedAt)) {
      s.lastSuccessAt=Math.max(Number(s.lastSuccessAt||0),m.modelCompletedAt);
    }
  } catch {}
  const auth=path.join(a.home,'auth.json');
  if(!fs.existsSync(auth)){log(a.name+' SKIP: no separate account login');return;}
  const q=await quotaRead(a.home);
  if(q.error || !q.rate?.primary || !Number.isFinite(q.rate.primary.resetsAt)) {
    log(a.name+' ERROR: quota query unavailable ('+(q.error||'primary_missing')+'); no model request');
    return;
  }
  const t=now(), r=q.rate.primary, until=r.resetsAt*1000;
  const latestSession=recentlyActiveSession(a.home);
  const recentSessions=latestSession>0&&(t-latestSession<hours(5))&&(latestSession<t+minutes(2));
  const prev=s.lastSnapshot||{};
  if (Number(r.usedPercent)>0 && until>t-30*1000) {
    s.lastConfirmedActiveResetAt=until;
  }
  let classified=classifyWindow({
    timeMs:t,primary:r,previous:prev,
    lastConfirmedActiveResetAt:Number(s.lastConfirmedActiveResetAt||0),
    currentTotal:q.usageTotal,lastOwnSuccessAt:Number(s.lastSuccessAt||0),
    morning:mode==='morning'
  });
  // A floating reset estimate is not proof of a started window.
  // Probe twice before an actual model request, even if lifetime tokens increased.
  const duration=Number(r.windowDurationMins)*minutes(1);
  const nearlyFull=Number(r.usedPercent)===0 &&
    Math.abs((until-t)-duration)<minutes(1);
  const priorExpired=Number(s.lastConfirmedActiveResetAt||0)>0 &&
    Number(s.lastConfirmedActiveResetAt)<=t-30000;
  const recentlyWarmed=Number(s.lastSuccessAt||0)>0 &&
    t-Number(s.lastSuccessAt)<duration-minutes(6);
  if(nearlyFull && !recentlyWarmed && (mode==='morning'||priorExpired)) {
    await new Promise(resolve=>setTimeout(resolve,6000));
    const second=await quotaRead(a.home);
    const secondTime=now();
    if(second.error || !second.rate?.primary) {
      classified={inactive:false,reason:'second_quota_probe_failed'};
    } else if(checkRollingProbe({
      first:q,second,firstTimeMs:t,secondTimeMs:secondTime
    })) {
      classified={inactive:true,reason:'confirmed_rolling_after_two_reads'};
    } else {
      classified={inactive:false,reason:'fixed_reset_after_two_reads'};
    }
    log(a.name+' SECOND_PROBE: '+classified.reason+
      ' firstReset='+stamp(until)+
      ' secondReset='+(second.rate?.primary?.resetsAt?
        stamp(second.rate.primary.resetsAt*1000):'unavailable'));
  }
  const sameWindow=prev.resetAt===r.resetsAt;
  const lastOwn=Number(s.lastSuccessAt||0);
  const quotaGrowth=sameWindow && Number(r.usedPercent)>Number(prev.usedPercent||0)
    && (!lastOwn || t-lastOwn>minutes(25));
  const tokenGrowth=sameWindow && q.usageTotal!==null &&
    Number.isFinite(prev.usageTotal) && q.usageTotal>prev.usageTotal &&
    (!lastOwn || t-lastOwn>minutes(25));
  const externallyStartedWindow=Boolean(prev.resetAt && r.resetsAt>prev.resetAt &&
    (!lastOwn || t-lastOwn>minutes(25)) && Number(r.usedPercent)>0);
  if(recentSessions) s.lastActivityAt=Math.max(Number(s.lastActivityAt||0),latestSession);
  if(quotaGrowth||tokenGrowth||externallyStartedWindow) s.lastActivityAt=t;
  // If first observed, a clearly active quota window can act as a weak activity signal.
  if(!prev.resetAt && Number(r.usedPercent)>=4 && (t-until+hours(5))<hours(5)) {
    s.lastActivityAt=t;
  }
  const recent=Number(s.lastActivityAt||0)>0 && t-s.lastActivityAt<hours(5);
  s.lastSnapshot={checkedAt:t,resetAt:r.resetsAt,usedPercent:Number(r.usedPercent),
    usageTotal:q.usageTotal};
  saveState(a.name,s);
  const status=a.name+' window='+stamp(until)+' used='+r.usedPercent+'%'+
    ' recentActivity='+recent;
  if(dry) log(a.name+' METRICS: tokenCounterAvailable='+(q.usageTotal!==null)+
    ' recentSession='+recentSessions+' changedWindow='+externallyStartedWindow);
  if(q.rate.ordinaryUsageAllowed===false || Number(q.rate.secondary?.usedPercent)>=100){
    log(status+' SKIP: allowance unavailable or weekly limit exhausted');return;
  }
  if(until>t-minutes(1) && !classified.inactive){
    log(status+' SKIP: active window or insufficient inactive evidence ('+classified.reason+')');return;
  }
  if(classified.inactive) {
    log(a.name+' DETECTED_INACTIVE_WINDOW: '+classified.reason+
      ', reportedReset='+stamp(until)+' is floating and not yet an active five-hour window');
  }
  if(s.lastSuccessAt && t-s.lastSuccessAt<hours(4.9)){
    log(status+' SKIP: recent successful warmup; avoid duplicate');return;
  }
  if(s.lastAttemptAt && t-s.lastAttemptAt<minutes(30)){
    log(status+' SKIP: retry cooldown');return;
  }
  if(mode==='poll'&&!recent){
    log(status+' SKIP: no activity observed in past 5h');return;
  }
  const cause=mode==='morning'?'morning':'recent_activity';
  if(dry) log(a.name+' WINDOW_DIAG: '+classified.reason+' inactive='+classified.inactive);
  if(dry){log(status+' DRY_RUN: eligible to request ('+cause+'), no quota used');return;}
  s.lastAttemptAt=t;saveState(a.name,s);
  log(a.name+' START: prewarm ('+cause+')');
  const result=await modelRequest(a.home);
  if(!result.ok){
    log(a.name+' FAILED: '+(result.error||'incomplete')+'; no successful warmup marker');
    return;
  }
  s.lastSuccessAt=now();s.lastSuccessResetAt=r.resetsAt;saveState(a.name,s);
  log(a.name+' REQUEST_OK: turn.completed, answer OK, input_tokens='+result.used);
  const post=await quotaRead(a.home);
  if(post.rate?.primary){
    const newReset=post.rate.primary.resetsAt;
    log(a.name+' AFTER: resetAt='+stamp(newReset*1000)+
      ' changed='+(newReset>r.resetsAt));
    s.lastSnapshot={checkedAt:now(),resetAt:newReset,
      usedPercent:Number(post.rate.primary.usedPercent),usageTotal:post.usageTotal};
    saveState(a.name,s);
  }else{
    log(a.name+' AFTER: quota endpoint not available; request succeeded');
  }
}
async function main() {
  const hour=new Date().getHours();
  if(mode==='poll'&&(hour<8||hour>=23)) {
    log('SKIP: outside 08:00-23:00 work window');return;
  }
  if(!fs.existsSync(exe)) {log('ERROR: Codex CLI executable missing');process.exitCode=1;return;}
  const lock=path.join(logs,'smart-scheduler.lock'); let handle;
  try {
    try{handle=fs.openSync(lock,'wx');fs.writeFileSync(handle,JSON.stringify({pid:process.pid,at:now()}));}
    catch {
      try{const st=fs.statSync(lock);if(now()-st.mtimeMs>minutes(8)){
        fs.unlinkSync(lock);handle=fs.openSync(lock,'wx');fs.writeFileSync(handle,JSON.stringify({pid:process.pid,at:now()}));
      }}catch{}
    }
    if(handle===undefined){log('SKIP: another smart scheduler run is active');return;}
    log('START: '+mode+(dry?' (dry run)':''));
    for(const account of accounts){
      try{await one(account);}catch(e){log(account.name+' ERROR: '+e.constructor.name);}
    }
    log('DONE: '+mode);
  }finally{
    if(handle!==undefined){try{fs.closeSync(handle);}catch{};try{fs.unlinkSync(lock);}catch{}}
  }
}
main().catch(e=>{log('FATAL: '+e.constructor.name);process.exitCode=1;});
