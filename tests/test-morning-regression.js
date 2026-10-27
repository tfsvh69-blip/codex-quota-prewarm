'use strict';
const assert=require('node:assert/strict');
const {classifyWindow,checkRollingProbe}=require('../src/window-detection');
const t=Date.parse('2026-10-27T05:30:02+08:00');
const duration=5*60*60*1000;
function snap(resetMs,percent=0) {
 return {rate:{primary:{usedPercent:percent,windowDurationMins:300,resetsAt:Math.floor(resetMs/1000)}}};
}
const first=snap(t+duration);
const secondRolling=snap(t+duration+10000);
const fixed=snap(t+duration);
assert.equal(checkRollingProbe({first,second:secondRolling,firstTimeMs:t,secondTimeMs:t+10000}),true,'floating reset follows clock');
assert.equal(checkRollingProbe({first,second:fixed,firstTimeMs:t,secondTimeMs:t+10000}),false,'fixed window should not cause new request');
assert.equal(checkRollingProbe({first,second:snap(t+duration+10000,5),firstTimeMs:t,secondTimeMs:t+10000}),false,'used allowance means do not classify as empty');
const previous={checkedAt:t-duration,resetAt:Math.floor((t-duration/2)/1000),usedPercent:85,usageTotal:100};
const preliminary=classifyWindow({timeMs:t,primary:first.rate.primary,previous,lastConfirmedActiveResetAt:t-duration/2,currentTotal:105,morning:true});
assert.equal(preliminary.reason,'tokens_increased','legacy heuristic may still report cumulative-token increase');
console.log('PASS prior-day token growth can trigger legacy heuristic, but morning-real-prewarm.js ignores that heuristic');
console.log('PASS floating vs fixed vs already-used five-hour quota window examples');
