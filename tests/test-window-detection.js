'use strict';
const assert=require('node:assert/strict');
const {classifyWindow}=require('../src/window-detection');
const h=60*60*1000,m=60*1000;
const t=Date.parse('2026-10-26T19:20:05+08:00');
function base(x={}){
 return {timeMs:t,primary:{usedPercent:0,windowDurationMins:300,resetsAt:Math.floor((t+5*h)/1000)},
  previous:{checkedAt:t-10*m,usedPercent:100,resetAt:Math.floor((t-9*m)/1000),usageTotal:100},
  currentTotal:100,lastConfirmedActiveResetAt:t-9*m,lastOwnSuccessAt:0,...x};
}
const cases=[
 ['B at 19:20 after 19:10 expired',base(),true],
 ['A still at 18:50 while 19:32 due',base({primary:{usedPercent:100,windowDurationMins:300,resetsAt:Math.floor((t+12*m)/1000)}}),false],
 ['zero but fixed active reset in 4h50',base({primary:{usedPercent:0,windowDurationMins:300,resetsAt:Math.floor((t+4*h+50*m)/1000)}}),false],
 ['new real turn changed token counter',base({currentTotal:105}),false],
 ['no history but morning kickoff',base({previous:{},lastConfirmedActiveResetAt:0,morning:true}),true],
 ['no history and daytime',base({previous:{},lastConfirmedActiveResetAt:0,morning:false}),false],
 ['rolling after two polls',base({previous:{checkedAt:t-10*m,usedPercent:0,resetAt:Math.floor((t-10*m+5*h)/1000),usageTotal:100},
 lastConfirmedActiveResetAt:0}),true],
 ['recent successful warmup',base({lastOwnSuccessAt:t-20*m}),false],
 ['zero consumption but previous anchor',base({previous:{checkedAt:t-10*m,usedPercent:0,resetAt:Math.floor((t-10*m+5*h)/1000),usageTotal:100}}),true]
];
for(const [name,opts,expected] of cases){
 const actual=classifyWindow(opts);
 assert.equal(actual.inactive,expected,name+' reason='+actual.reason);
 console.log('PASS '+name+' => '+actual.reason);
}
