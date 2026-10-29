'use strict';
// Offline UI regression guard. Prevents misleading quota states and semantic drift.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ui=path.join(__dirname,'..','dashboard');
const html=fs.readFileSync(path.join(ui,'index.html'),'utf8');
const css=fs.readFileSync(path.join(ui,'style.css'),'utf8');
const js=fs.readFileSync(path.join(ui,'app.js'),'utf8');
assert.match(html,/五小时额度/);
assert.match(html,/每周额度/);
assert.match(html,/北京时间/);
assert.match(html,/id="operation"/);
assert.match(html,/id="add-btn"/);
assert.match(js,/is-unknown/); // Unknown cannot be represented as full progress
assert.match(js,/raw!==null&&raw!==undefined/);
assert.match(js,/五小时已满/);
assert.match(js,/周额度已满/);
assert.match(js,/与 '\+a\.duplicateOf/);
assert.match(js,/timeZone:'Asia\/Shanghai'/);
assert.match(js,/aria-valuenow/);
assert.match(js,/account-detail\[open\]/); // Keep expanded details on refresh
assert.match(js,/confirm\(/); // Confirmation before replacing credentials
assert.match(css,/@media\(max-width:1040px\)/);
assert.match(css,/@media\(max-width:680px\)/);
assert.match(css,/:focus-visible/);
assert.match(css,/prefers-reduced-motion:reduce/);
console.log('PASS UI semantic quota states, account controls, accessible layout and responsive breakpoints');
