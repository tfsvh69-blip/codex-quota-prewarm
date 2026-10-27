'use strict';
// Static regression contracts: safe offline guards, NOT an end-to-end quota test.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
function load(f){return fs.readFileSync(path.join(root,f),'utf8')}
const morning=load('src/morning-real-prewarm.js');
const poll=load('src/smart-scheduler.js');
const detector=load('src/window-detection.js');
const installer=load('scripts/install.ps1');
const vbs=load('scripts/run-node-hidden.vbs');
const ignore=load('.gitignore');
const runtime=load('src/runtime.js');
const check=(name,fn)=>{fn();console.log('PASS '+name)};

check('Morning never uses smart quota heuristics as a first-request gate',()=>{
 assert.match(morning,/const response=await model\(a\.home\)/);
 assert.doesNotMatch(morning,/classifyWindow\s*\(/);
 assert.doesNotMatch(morning,/tokens_increased/);
 assert.match(morning,/s\.status==='verified'/);
 assert.match(morning,/st\.day===day/);
});
check('Independent accounts and daily verification state',()=>{
 assert.match(runtime,/\.codex-prewarm-B/);
 assert.match(runtime,/\.codex/);
 assert.match(morning,/morning-'\+name\+'\.json'/);
 assert.match(morning,/for\(const a of accts\)/);
 assert.match(morning,/s\.status='verified'/);
 assert.match(morning,/s\.attempts>=3/);
});
check('Real turn checks use events, tokens and correct exit code',()=>{
 assert.match(morning,/x\.type==='turn\.completed'/);
 assert.match(morning,/agent_message/);
 assert.match(morning,/used=Number\(/);
 assert.match(morning,/code===0&&completed&&reply&&used>0&&!failed/);
 assert.match(morning,/WINDOW_VERIFIED/);
});
check('No inherited stdin or visible Codex child terminal',()=>{
 assert.match(morning,/windowsHide:true/);
 assert.match(morning,/stdio:\['ignore','pipe','pipe'\]/);
 assert.match(poll,/windowsHide:true/);
 assert.match(poll,/stdio:\['ignore','pipe','pipe'\]/);
});
check('Daytime rolling-reset detection and 5h duplicate cooldown remain',()=>{
 assert.match(poll,/checkRollingProbe\(/);
 assert.match(poll,/!classified\.inactive/);
 assert.match(poll,/t-s\.lastSuccessAt<hours\(4\.9\)/);
 assert.match(detector,/drift>=Math\.max/);
});
check('Windows installer uses XML repetition and login delay',()=>{
 assert.match(installer,/Export-ScheduledTask/);
 assert.match(installer,/Register-ScheduledTask/);
 assert.match(installer,/CreateElement\('Repetition'/);
 assert.match(installer,/PT15M/);
 assert.match(installer,/PT5H30M/);
 assert.match(installer,/PT10M/);
 assert.match(installer,/PT1M30S/);
 assert.doesNotMatch(installer,/\$morning\.Repetition\.Interval\s*=/);
});
check('Hidden VBS launcher strips CRLF from node-path.txt',()=>{
 assert.match(vbs,/sh\.Run\(cmd, 0, True\)/);
 assert.match(vbs,/vbCr/);
 assert.match(vbs,/vbLf/);
});
check('Local credentials and logs are gitignored',()=>{
 for(const x of ['auth.json','logs/','config.local.json','node-path.txt']){
  assert.ok(ignore.includes(x),'missing ignore entry '+x);
 }
});
console.log('Offline static regression contracts passed; actual Codex requests still require a live test.');
