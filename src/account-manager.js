'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');
function loadAccounts(root, fileName='accounts.json'){
 const cfg=path.join(root,fileName);
 const defaults=[
  {name:'A',home:'.codex',enabled:true,locked:true},
  {name:'B',home:'.codex-prewarm-B',enabled:true},
  {name:'C',home:'.codex-prewarm-C',enabled:true}
 ];
 let slots=defaults;
 if(fs.existsSync(cfg)){
  const obj=JSON.parse(fs.readFileSync(cfg,'utf8'));
  if(!Array.isArray(obj.accounts))throw new Error('accounts configuration must be an array');
  slots=obj.accounts;
 }
 const names=new Set(), homes=new Set();
 return slots.filter(a=>a.enabled!==false).map(a=>{
  const name=String(a.name||'').trim().toUpperCase();
  if(!/^[A-Z][A-Z0-9_-]{0,15}$/.test(name)||names.has(name))throw new Error('invalid or duplicate account slot');
  names.add(name);
  // Home may be an absolute path in config, but normal slots use a user-local directory.
  const folder=String(a.home|| (name==='A'?'.codex':'.codex-prewarm-'+name));
  const home=path.isAbsolute(folder)?folder:path.join(os.homedir(),folder);
  const key=path.resolve(home).toLowerCase();
  if(homes.has(key))throw new Error('two slots share CODEX_HOME');
  homes.add(key);
  return {name,home,locked:name==='A'};
 });
}
function getIdentity(home){
 const authFile=path.join(home,'auth.json');
 if(!fs.existsSync(authFile))return {status:'not_logged_in'};
 let raw;
 try {
  raw=fs.readFileSync(authFile,'utf8');
  const doc=JSON.parse(raw);
  if(doc.auth_mode!=='chatgpt')return {status:'not_chatgpt'};
  const accountId=doc.tokens?.account_id;
  if(!accountId || typeof accountId!=='string')return {status:'identity_missing'};
  const hash=crypto.createHash('sha256').update('codex-account-v1:'+accountId).digest('hex');
  return {status:'ok',hash};
 } catch {return {status:'auth_unreadable'};}
}
function bindIdentity(state, identity, report){
 const saved=String(state?.identityHash||'');
 if(!identity||identity.status!=='ok')return {ok:false,reason:identity?.status||'unknown',state:null};
 if(saved && saved!==identity.hash){
  if(report)report('ACCOUNT_REPLACED: clearing previous account quota state');
  return {ok:true,changed:true,state:{identityHash:identity.hash}};
 }
 if(!saved&&report)report('IDENTITY_BOUND: account slot now tracks login changes');
 return {ok:true,changed:false,state:{...(state||{}),identityHash:identity.hash}};
}
function validateDistinct(accounts, report){
 const identities=new Set(), accepted=[];
 for(const account of accounts){
  const id=getIdentity(account.home);
  if(id.status==='ok'&&identities.has(id.hash)){
   if(report)report(account.name+' SKIP: duplicate login identity in another active slot');
   continue;
  }
  if(id.status==='ok')identities.add(id.hash);
  accepted.push({...account,identity:id});
 }
 return accepted;
}
module.exports={loadAccounts,getIdentity,bindIdentity,validateDistinct};
