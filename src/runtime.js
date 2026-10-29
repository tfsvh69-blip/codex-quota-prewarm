'use strict';
const fs=require('fs'),path=require('path'),os=require('os');
const {loadAccounts}=require('./account-manager');
const root=path.resolve(__dirname,'..');
const local=path.join(root,'config.local.json');
let config={};try{config=JSON.parse(fs.readFileSync(local,'utf8'))}catch{}
const logs=path.resolve(root,config.logsDir||'logs');
const work=path.resolve(process.env.LOCALAPPDATA||os.tmpdir(),config.workDir||'CodexPrewarmWork');
fs.mkdirSync(logs,{recursive:true});fs.mkdirSync(work,{recursive:true});
function possibleCodex(){
  const candidates=[];
  if(process.env.CODEX_BIN)candidates.push(process.env.CODEX_BIN);
  if(config.codexExe)candidates.push(config.codexExe);
  const base=process.env.APPDATA && path.join(process.env.APPDATA,'npm','node_modules','@openai','codex','node_modules','@openai','codex-win32-x64','vendor','x86_64-pc-windows-msvc','bin','codex.exe');
  if(base)candidates.push(base);
  const programFiles=process.env.ProgramFiles||'C:\\Program Files';
  if(process.env.CODEX_NPM_PREFIX)candidates.push(path.join(process.env.CODEX_NPM_PREFIX,'node_modules','@openai','codex','node_modules','@openai','codex-win32-x64','vendor','x86_64-pc-windows-msvc','bin','codex.exe'));
  return candidates;
}
const exe=possibleCodex().find(p=>{try{return fs.statSync(p).isFile()}catch{return false}})||'codex.exe';
function accounts(){return loadAccounts(root,'config.local.json');}
const tz=config.timeZone||Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Shanghai';
module.exports={root,logs,work,exe,accounts,tz};
