const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const html=fs.readFileSync(path.join(__dirname,'..','settings.html'),'utf8');
const source=fs.readFileSync(path.join(__dirname,'..','js','settings.js'),'utf8');
const storeSource=fs.readFileSync(path.join(__dirname,'..','js','firebase-store.js'),'utf8');

test('settings keeps only the V2 dual-run monitor',()=>{
  assert.match(html,/data-panel="dataV2"/);
  assert.match(html,/id="v2-monitor-state"/);
  assert.match(html,/id="v2-monitor-alert-list"/);
  assert.match(html,/js\/schedule-v2-shadow\.js/);
  assert.doesNotMatch(html,/id="data-v2-diagnose"/);
  assert.doesNotMatch(html,/id="data-v2-build"/);
  assert.doesNotMatch(html,/id="data-v2-preview-load"/);
  assert.doesNotMatch(html,/V2 안전 복사본/);
});

test('the monitor subscribes to current status and compatibility alerts',()=>{
  const start=source.indexOf('function subscribeV2Monitor');
  const end=source.indexOf('function v2CopyStatus',start);
  const section=source.slice(start,end);
  assert.ok(start>=0,'V2 monitor subscription missing');
  assert.match(section,/ref\.onSnapshot/);
  assert.match(section,/collection\('alerts'\)\.onSnapshot/);
  assert.match(section,/SCV2Shadow\.refresh/);
});

test('all primary V1 mutation paths schedule the V2 shadow only after saving',()=>{
  ['set','remove','transaction-key','transaction-root','transaction-keys','remote-change'].forEach(reason=>{
    assert.match(storeSource,new RegExp(`_scheduleV2Shadow\\([^\\n]*['\"]${reason}['\"]`),`missing ${reason} hook`);
  });
  assert.match(storeSource,/V2는 검증용 보조 경로다\. 어떤 오류도 운영 V1 저장을 막지 않는다/);
});
