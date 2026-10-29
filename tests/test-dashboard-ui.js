'use strict';
// Offline UI regression guard. The official API reports usedPercent, UI reports 100-usedPercent.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const ui=path.join(__dirname,'..','dashboard');
const html=fs.readFileSync(path.join(ui,'index.html'),'utf8');
const css=fs.readFileSync(path.join(ui,'style.css'),'utf8');
const js=fs.readFileSync(path.join(ui,'app.js'),'utf8');
const server=fs.readFileSync(path.join(ui,'server.js'),'utf8');
assert.match(html,/短周期 · 重置倒计时/);
assert.match(html,/每周 · 重置倒计时/);
assert.match(html,/重置倒计时/);
assert.match(html,/北京时间/);
assert.match(html,/id="operation"/);
assert.match(html,/id="add-btn"/);
assert.match(js,/is-unknown/);
assert.match(js,/used===null\|\|used===undefined/);
assert.match(js,/每周额度用尽/);
assert.match(js,/额度用尽/);
assert.match(js,/与 '\+a\.duplicateOf/);
assert.match(js,/timeZone:'Asia\/Shanghai'/);
assert.match(js,/class="countdown-value"/);
assert.doesNotMatch(js, /<progress class=/); // Countdown replaces progress bars.
assert.match(css,/\.countdown-panel/);
assert.match(js,/setInterval\(\(\)=>\{if\(!document.hidden\)updateCountdowns\(\)\},1000\)/);
assert.match(js,/class="account-actions"/);
assert.match(js,/data-act/);
assert.match(server,/style-src 'self'/);
assert.match(server,/accounts:\['A','B','C'\]/); // Default slots are exactly A/B/C; D is opt-in through Add Account.
assert.match(js,/account-detail\[open\]/);
assert.match(js,/confirm\(/);
assert.match(server,/raw===null\|\|raw===undefined/); // Never coerce null to zero usage
assert.match(css,/@media\(max-width:1040px\)/);
assert.match(css,/@media\(max-width:680px\)/);
assert.match(css,/:focus-visible/);
assert.match(css,/prefers-reduced-motion:reduce/);
const pure=js.slice(js.indexOf('const clamp='),js.indexOf('const dateTime='));
const countdownFn=js.slice(js.indexOf('function countdownText('),js.indexOf('const isReady='));
const quotaFn=js.slice(js.indexOf('function quotaBlock('),js.indexOf('\nfunction details('));
const {remainingOf,quotaBlock,windowTitle,countdownText}=vm.runInNewContext(
 "const escapeHtml=x=>String(x);const dateTime=x=>'2026/10/29 21:58';\n"+pure+'\n'+countdownFn+'\n'+quotaFn+'\n({remainingOf,quotaBlock,windowTitle,countdownText})');
assert.equal(remainingOf({used:8}),92);
assert.equal(remainingOf({used:64}),36);
assert.equal(remainingOf({used:77}),23);
assert.equal(remainingOf({used:100}),0);
assert.equal(remainingOf({used:16}),84);
assert.equal(remainingOf({used:0}),100);
assert.equal(remainingOf({used:null}),null);
assert.equal(remainingOf({}),null);
assert.equal(remainingOf(null),null);
assert.equal(windowTitle({duration:15},'五小时'),'15分钟');
const b=quotaBlock({used:8,reset:1793282332,duration:300},'五小时',false);
assert.match(b,/data-reset="1793282332"/);
assert.match(b,/class="countdown-value"/);
assert.match(b,/剩余 92%/);
assert.match(b,/距离下次重置/);
assert.match(b,/预计重置/);
assert.doesNotMatch(b,/style=/);
const empty=quotaBlock({used:null},'五小时',false);
assert.match(empty,/额度未读取/);
assert.doesNotMatch(empty,/data-reset/);
assert.match(quotaBlock(null,'五小时',false,true),/查询失败/);
assert.match(quotaBlock(null,'五小时',false),/本次未提供/);
assert.match(quotaBlock(null,'五小时',true),/已停用/);
const exhausted=quotaBlock({used:100,reset:1793282332},'每周',false);
assert.match(exhausted,/countdown-panel is-exhausted/);
assert.match(exhausted,/预计恢复倒计时/);
assert.match(css,/\.countdown-panel\.is-exhausted/);
assert.equal(countdownText(1000+3661,1000*1000),'01:01:01');
assert.equal(countdownText(1000+86400+3662,1000*1000),'1天 01:01:02');
assert.equal(countdownText(1000,1000*1000),'等待额度同步');
assert.equal(countdownText(null,Date.now()),'等待额度同步');
assert.match(html,/按预计恢复时间/);
const ranking=js.slice(js.indexOf('const isReady='),js.indexOf('function notify('));
const {availabilityOf,sortAccounts}=vm.runInNewContext(
 "const dateTime=x=>String(x);\n"+pure+'\n'+ranking+'\n({availabilityOf,sortAccounts})');
const sample=(name,shortUsed,shortReset,weekUsed=20,weekReset=3000)=>({
 name,enabled:true,auth:'ok',fiveHour:{used:shortUsed,reset:shortReset},week:{used:weekUsed,reset:weekReset}
});
const now=1000;
const a=sample('A',20,1200),bAccount={...sample('B',100,2400),allowed:false},c={...sample('C',100,1500),allowed:false};
// Official ordinaryUsageAllowed=false often comes from the depleted short window.
// Its reset time must still participate in ordering.
const disabled={...sample('D',100,1200),enabled:false};
const original=[bAccount,disabled,a,c];
assert.equal(sortAccounts(original,now).map(x=>x.name).join(','),'A,C,B,D');
assert.equal(original[0].name,'B'); // No mutation of backend account slots
assert.equal(availabilityOf(c,now).at,1500);
const dualExhausted=sample('E',100,1200,100,2500);
assert.equal(availabilityOf(dualExhausted,now).at,2500); // The later gate wins
const missingReset=sample('F',100,null);
assert.equal(availabilityOf(missingReset,now).rank,3); // Never promise a made-up time
assert.equal(availabilityOf({...a,allowed:false},now).rank,3);
assert.equal(availabilityOf(sample('G',100,500),now).text,'重置时间已到，待刷新');
for(const used of [0,16,44,64,70,100]){
 const expected=100-used;
 const markup=quotaBlock({used,reset:1793282332},'五小时',false);
 assert.match(markup,new RegExp('剩余 '+expected+'%'));
 assert.doesNotMatch(markup,/style=/);
}
const renderSource=js.slice(js.indexOf('function accountRow('),js.indexOf('function summaryCard('));
assert.match(renderSource,/当前账号/);
assert.match(renderSource,/更多操作/);
assert.match(renderSource,/启用账号/);
assert.match(js,/openMenus/);
const {pickQuotaWindows}=require('../dashboard/server');
const standard=pickQuotaWindows({primary:{usedPercent:20,windowDurationMins:300},secondary:{usedPercent:66,windowDurationMins:10080}});
assert.equal(standard.short.used,20);
assert.equal(standard.weekly.used,66);
const weeklyOnly=pickQuotaWindows({primary:{usedPercent:30,windowDurationMins:10080},secondary:null});
assert.equal(weeklyOnly.short,null); // A Pro / weekly-only bucket must not be mislabeled five-hour
assert.equal(weeklyOnly.weekly.used,30);
assert.equal(pickQuotaWindows({primary:{usedPercent:null,windowDurationMins:300}}).short.used,null);
console.log('PASS UI reset countdowns, unknown-state distinction, simplified controls, account ordering and responsive breakpoints');
