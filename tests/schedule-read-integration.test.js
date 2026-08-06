const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const repoRoot=path.join(__dirname,'..');

function read(file){
  return fs.readFileSync(path.join(repoRoot,file),'utf8');
}

function functionSource(source,name,nextName){
  const start=source.indexOf(`function ${name}`);
  assert.notEqual(start,-1,`${name} is missing`);
  const end=source.indexOf(`function ${nextName}`,start+1);
  assert.notEqual(end,-1,`${name} boundary is missing`);
  return source.slice(start,end);
}

test('main page loads the read coordinator after Firebase store and before core', () => {
  const html=read('index.html');
  const store=html.indexOf("scJs('js/firebase-store.js')");
  const coordinator=html.indexOf("scJs('js/schedule-read-coordinator.js')");
  const core=html.indexOf("scJs('js/core.js')");

  assert.notEqual(coordinator,-1,'read coordinator script is missing');
  assert.ok(store<coordinator,'Firebase store must load before the coordinator');
  assert.ok(coordinator<core,'read coordinator must load before core');
});

test('main Firebase listeners delegate to one root batch subscription', () => {
  const source=read(path.join('js','core.js'));
  const attach=functionSource(source,'_attachFirebaseDataListeners','loadFromFirebase');

  assert.match(attach,/SCFirebaseStore\.subscribeRootBatches/);
  assert.match(attach,/_scheduleReadCoordinator\.start/);
  assert.doesNotMatch(attach,/_fb\.on\(['"]child_changed/);
  assert.doesNotMatch(attach,/_fb\.on\(['"]child_removed/);
});

test('main initial load waits for coordinator readiness before the legacy fallback', () => {
  const source=read(path.join('js','core.js'));
  const load=functionSource(source,'loadFromFirebase','getToday');

  assert.match(load,/_canUseScheduleReadCoordinator\(\)/);
  assert.match(load,/_scheduleReadCoordinator\.ready\(\)/);
  assert.match(load,/return;[\s\S]*_fb\.once\(['"]value['"]\)/);
});

test('remote cache writes use named batch value helpers', () => {
  const source=read(path.join('js','core.js'));
  const apply=functionSource(source,'_applyScheduleReadBatchValue','_removeScheduleReadBatchValue');
  const remove=functionSource(source,'_removeScheduleReadBatchValue','_consumeScheduleReadLocalEchoes');
  const attach=functionSource(source,'_attachFirebaseDataListeners','loadFromFirebase');

  assert.match(apply,/_cacheScheduleRaw/);
  assert.match(remove,/delete _dbCache\[key\]/);
  assert.doesNotMatch(attach,/_dbCache\[[^\]]+\]\s*=/);
  assert.doesNotMatch(attach,/localStorage\.setItem/);
});

test('one remote batch owns one global reload and one table build', () => {
  const source=read(path.join('js','core.js'));
  const render=functionSource(source,'_renderRemoteScheduleBatch','_flushRemoteScheduleRefresh');

  assert.equal((render.match(/reloadGlobalData\(\)/g)||[]).length,1);
  assert.equal((render.match(/reloadBadgeMaps\(\)/g)||[]).length,1);
  assert.equal((render.match(/buildTable\(\)/g)||[]).length,1);
  assert.match(render,/activeTabDataChanged/);
});
