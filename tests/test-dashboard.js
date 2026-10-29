'use strict';
// Offline HTTP smoke test: no Codex model requests and no account mutations.
const assert=require('node:assert/strict'),http=require('node:http');
const {server}=require('../dashboard/server');
async function request(port,url,method='GET',headers={}){
 return new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port,path:url,method,
   headers:{Host:'127.0.0.1:38671',...headers}},res=>{
   let body='';res.setEncoding('utf8');res.on('data',c=>body+=c);
   res.on('end',()=>resolve({status:res.statusCode,body}))
  });req.on('error',reject);req.end()
 })
}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=server.address().port;
 try{
  const index=await request(port,'/');
  assert.equal(index.status,200);
  assert.match(index.body,/Codex/);
  const js=await request(port,'/app.js');assert.equal(js.status,200);
  const css=await request(port,'/style.css');assert.equal(css.status,200);
  const session=await request(port,'/api/session');assert.equal(session.status,200);
  assert.ok(JSON.parse(session.body).csrf);
  const denied=await request(port,'/api/active','POST',{'Content-Type':'application/json'});
  assert.equal(denied.status,403);
  const wrongHost=await request(port,'/api/session','GET',{Host:'attacker.test'});
  assert.equal(wrongHost.status,403);
  console.log('PASS dashboard HTML/JS/CSS, session, CSRF and Host protection (offline)');
 }finally{await new Promise(resolve=>server.close(resolve))}
})().catch(e=>{console.error(e);process.exitCode=1});
