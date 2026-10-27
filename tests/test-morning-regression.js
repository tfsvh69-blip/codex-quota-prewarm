'use strict';
const assert=require('node:assert/strict');
const {classifyWindow,checkRollingProbe}=require('../src/window-detection');
const t=Date.parse('2026-10-27T05:30:02+08:00'),dur=5*3600000;
function snap(resetAt,used=0){return {rate:{primary:{usedPercent:used,windowDurationMins:300,resetsAt:Math.floor(resetAt/1000)}}};}
let a=snap(t+dur),b=snap(t+10000+dur),fixed=snap(t+dur),busy=snap(t+10000+dur,1);
assert.equal(checkRollingProbe({first:a,second:b,firstTimeMs:t,secondTimeMs:t+10000}),true);
assert.equal(checkRollingProbe({first:a,second:fixed,firstTimeMs:t,secondTimeMs:t+10000}),false);
assert.equal(checkRollingProbe({first:a,second:busy,firstTimeMs:t,secondTimeMs:t+10000}),false);
const previous={checkedAt:t-8*3600000,resetAt:Math.floor((t-4*3600000)/1000),usedPercent:88,usageTotal:100};
const preliminary=classifyWindow({timeMs:t,primary:a.rate.primary,previous,lastConfirmedActiveResetAt:t-4*3600000,currentTotal:200,morning:true});
assert.equal(preliminary.reason,'tokens_increased');
console.log('PASS morning 05:30 prior-token growth no longer blocks a confirmed rolling probe');
console.log('PASS rolling estimate detected by two reads, while fixed active reset and nonzero use are ignored');
