const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root=path.join(__dirname,'..');
const tabs=fs.readFileSync(path.join(root,'js','tabs.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'style.css'),'utf8');

function between(start,end){
  const s=tabs.indexOf(start);
  const e=tabs.indexOf(end,s);
  assert.notEqual(s,-1);
  assert.notEqual(e,-1);
  return tabs.slice(s,e);
}

test('snapshot and rollover use the in-page operation modal instead of browser prompts',()=>{
  const rollover=between('async function rolloverScheduleTab','let _autoRolloverRunning');
  const snapshot=between('async function createSnapshot','async function copyTab');
  assert.doesNotMatch(rollover,/\bprompt\s*\(|\bconfirm\s*\(/);
  assert.doesNotMatch(snapshot,/\bprompt\s*\(|\bconfirm\s*\(/);
  assert.match(rollover,/_openTabOperationModal\('rollover'/);
  assert.match(snapshot,/_openTabOperationModal\('snapshot'/);
});

test('the operation modal exposes one clear form and an inline error area',()=>{
  assert.match(html,/id="tab-operation-modal"/);
  assert.match(html,/id="tab-operation-name"/);
  assert.match(html,/id="tab-operation-month"/);
  assert.match(html,/id="tab-operation-error"/);
  assert.match(css,/\.tab-operation-box/);
  assert.match(css,/\.tab-operation-error/);
});

test('modal submission blocks duplicate saves while an operation is running',()=>{
  const submit=between('async function submitTabOperationModal','function _snapshotDataForTab');
  assert.match(submit,/if\(!state\|\|state\.busy\) return/);
  assert.match(submit,/state\.busy=true/);
  assert.match(submit,/submit\.disabled=true/);
});
