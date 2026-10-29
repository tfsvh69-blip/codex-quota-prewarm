'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const load=f=>fs.readFileSync(path.join(root,f),'utf8');
const morning=load('src/morning-real-prewarm.js');
const poll=load('src/smart-scheduler.js');
const mgr=load('src/account-manager.js');
const runtime=load('src/runtime.js');
const detector=load('src/window-detection.js');
const installer=load('scripts/install.ps1');
const vbs=load('scripts/run-node-hidden.vbs');
const ignore=load('.gitignore');
const check=(name,fn)=>{fn();console.log('PASS '+name)};
check('Morning remains a real-request workflow without old quota heuristic gate',()=>{
 assert.match(morning,/const response=await model\(a\.home\)/);
 assert.doesNotMatch(morning,/classifyWindow\s*\(/);
 assert.doesNotMatch(morning,/tokens_increased/);
 assert.match(morning,/status==='verified'/);
});
check('Account identity is bound before daily success state can be reused',()=>{
 assert.match(morning,/bindIdentity\(st,a\.identity/);
 assert.match(morning,/b\.changed \|\| s\.day!==day/);
 assert.match(poll,/bindIdentity\(loadState\(a\.name\),a\.identity/);
 assert.match(mgr,/identityHash/);
 assert.match(mgr,/ACCOUNT_REPLACED/);
 assert.match(mgr,/duplicate login identity/);
 assert.match(runtime,/loadAccounts/);
});
check('Every slot gets its own home, state, and bounded retry attempts',()=>{
 assert.match(mgr,/\.codex-prewarm-B/);
 assert.match(mgr,/getIdentity/);
 assert.match(morning,/morning-'\+name\+'\.json'/);
 assert.match(morning,/for\(const a of accts\)/);
 assert.match(morning,/s\.attempts>=3/);
});
check('Codex real turns require events, response and positive token consumption',()=>{
 assert.match(morning,/x\.type==='turn\.completed'/);
 assert.match(morning,/agent_message/);
 assert.match(morning,/code===0&&completed&&reply&&used>0&&!failed/);
 assert.match(morning,/WINDOW_VERIFIED/);
});
check('Subprocesses do not inherit a visible terminal or open stdin',()=>{
 assert.match(morning,/windowsHide:true/);
 assert.match(morning,/stdio:\['ignore','pipe','pipe'\]/);
 assert.match(poll,/windowsHide:true/);
 assert.match(poll,/stdio:\['ignore','pipe','pipe'\]/);
});
check('Daytime window heuristic, cooldown and time shift monitoring remain',()=>{
 assert.match(poll,/checkRollingProbe\(/);
 assert.match(poll,/!classified\.inactive/);
 assert.match(poll,/t-s\.lastSuccessAt<hours\(4\.9\)/);
 assert.match(poll,/RESET_TIME_CHANGED/);
 assert.match(detector,/drift>=Math\.max/);
});
check('Windows Task Scheduler is configured by XML, not unsupported setters',()=>{
 assert.match(installer,/Export-ScheduledTask/);
 assert.match(installer,/CreateElement\('Repetition'/);
 assert.match(installer,/PT15M/);
 assert.match(installer,/PT10M/);
 assert.doesNotMatch(installer,/\$morning\.Repetition\.Interval\s*=/);
});
check('Hidden launcher safely reads Node path and local files stay ignored',()=>{
 assert.match(vbs,/sh\.Run\(cmd, 0, True\)/);
 assert.match(vbs,/vbCr/);assert.match(vbs,/vbLf/);
 for(const value of ['auth.json','logs/','config.local.json','node-path.txt'])assert.ok(ignore.includes(value));
});
check('Login script never shadows PowerShell read-only automatic variables',()=>{
 const login=load('scripts/login.ps1');
 assert.doesNotMatch(login,/\$home\b/i);
 assert.doesNotMatch(login,/\$host\s*=/i);
 assert.doesNotMatch(login,/\$pid\s*=/i);
 assert.match(login,/\$slotHome/);
 assert.match(login,/\$ValidateOnly/);
});
console.log('Static regression contracts passed (not a substitute for online tests).');
