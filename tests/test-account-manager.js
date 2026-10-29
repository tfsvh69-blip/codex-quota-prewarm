'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {loadAccounts,getIdentity,bindIdentity,validateDistinct}=require('../src/account-manager');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'prewarm-slots-'));
try{
 const a=path.join(tmp,'A'),b=path.join(tmp,'B'),c=path.join(tmp,'C');
 for(const x of [a,b,c])fs.mkdirSync(x);
 function writeAuth(home,id){fs.writeFileSync(path.join(home,'auth.json'),
  JSON.stringify({auth_mode:'chatgpt',tokens:{account_id:id}}))}
 writeAuth(a,'main');writeAuth(b,'secondary');writeAuth(c,'third');
 fs.writeFileSync(path.join(tmp,'accounts.json'),JSON.stringify({accounts:[
  {name:'A',home:a,enabled:true},{name:'B',home:b,enabled:true},
  {name:'C',home:c,enabled:true},{name:'D',home:path.join(tmp,'D'),enabled:false}
 ]}));
 let list=validateDistinct(loadAccounts(tmp));
 assert.deepEqual(list.map(x=>x.name),['A','B','C']);
 assert.equal(list.every(x=>x.identity.status==='ok'),true);
 const old={day:'2026-10-29',status:'verified',attempts:1};
 const bound=bindIdentity(old,getIdentity(b));
 assert.equal(bound.changed,false);
 assert.equal(bound.state.status,'verified');
 const swapped=bindIdentity(bound.state,getIdentity(c));
 assert.equal(swapped.changed,true);
 assert.equal(swapped.state.status,undefined);
 writeAuth(b,'main');
 list=validateDistinct(loadAccounts(tmp));
 assert.deepEqual(list.map(x=>x.name),['A','C']);
 fs.unlinkSync(path.join(c,'auth.json'));
 list=validateDistinct(loadAccounts(tmp));
 assert.equal(list.find(x=>x.name==='C').identity.status,'not_logged_in');
 console.log('PASS three slots, account change resets quota state, duplicate login rejected');
}finally{fs.rmSync(tmp,{recursive:true,force:true})}
