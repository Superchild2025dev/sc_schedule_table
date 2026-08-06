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

test('main Firebase listeners delegate to one selected-key batch subscription', () => {
  const source=read(path.join('js','core.js'));
  const attach=functionSource(source,'_attachFirebaseDataListeners','loadFromFirebase');

  assert.match(attach,/SCFirebaseStore\.subscribeSelectedRootBatches/);
  assert.match(attach,/SCScheduleKeySelection\.initialBaseKeys/);
  assert.match(attach,/resolveInitialActiveKeys/);
  assert.match(attach,/SCScheduleKeySelection\.resolveMainTab/);
  assert.match(attach,/SCScheduleKeySelection\.tabKeys/);
  assert.match(attach,/_scheduleReadCoordinator\.start/);
  assert.doesNotMatch(attach,/SCFirebaseStore\.subscribeRootBatches/);
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

test('both popup close paths flush pending schedule reads through one helper', () => {
  const studentSource=read(path.join('js','popup-stu.js'));
  const teacherSource=read(path.join('js','teachers.js'));
  const studentClose=studentSource.match(/function closeStuPopup\(\)\{[\s\S]*?\n\}/)?.[0]||'';
  const teacherClose=teacherSource.match(/function closeInstPopup\(\)\{[\s\S]*?\n\}/)?.[0]||'';

  assert.match(studentClose,/flushPendingScheduleReads\(\)/);
  assert.match(teacherClose,/flushPendingScheduleReads\(\)/);
  assert.doesNotMatch(studentClose,/reloadGlobalData|loadTabData|reloadBadgeMaps|buildTable/);
  assert.doesNotMatch(teacherClose,/reloadGlobalData|loadTabData|reloadBadgeMaps|buildTable/);
});

test('pending read flush uses the coordinator before its compatibility fallback', () => {
  const source=read(path.join('js','core.js'));
  const flush=functionSource(source,'flushPendingScheduleReads','_queueRemoteScheduleRefresh');
  const coordinatorIndex=flush.indexOf('_scheduleReadCoordinator.flush()');
  const fallbackIndex=flush.indexOf('reloadGlobalData()');

  assert.ok(coordinatorIndex>=0,'coordinator flush is missing');
  assert.ok(fallbackIndex>coordinatorIndex,'compatibility fallback must run after coordinator flush');
  assert.match(flush,/if\(!flushed&&hadLegacyPending\)/);
});

test('compatibility refresh keeps pending keys while a popup is open', () => {
  const source=read(path.join('js','core.js'));
  const flush=functionSource(source,'_flushRemoteScheduleRefresh','flushPendingScheduleReads');
  const popupIndex=flush.indexOf('_popupOpen()');
  const clearIndex=flush.indexOf('_remoteSyncKeys.clear()');

  assert.ok(popupIndex>=0,'popup guard is missing');
  assert.ok(clearIndex>popupIndex,'pending keys must be cleared only after the popup guard');
});

test('main schedule reads remain behind one coordinator boundary', () => {
  const source=read(path.join('js','core.js'));
  const attach=functionSource(source,'_attachFirebaseDataListeners','loadFromFirebase');
  const load=functionSource(source,'loadFromFirebase','getToday');

  assert.equal((source.match(/SCScheduleReadCoordinator\.create\(/g)||[]).length,1);
  assert.equal((attach.match(/SCFirebaseStore\.subscribeSelectedRootBatches\(/g)||[]).length,1);
  assert.doesNotMatch(attach,/_fb\.on\(/);
  assert.match(load,/if\(_canUseScheduleReadCoordinator\(\)\)\{[\s\S]*?return;[\s\S]*?_fb\.once\(['"]value['"]\)/);
});

test('invalid initial student data keeps the page read only and preserves local backup', () => {
  const source=read(path.join('js','core.js'));
  const ensure=functionSource(source,'_ensureScheduleReadCoordinator','_renderRemoteScheduleBatch');
  const load=functionSource(source,'loadFromFirebase','getToday');

  assert.match(ensure,/_scheduleReadInitialInvalid=true/);
  assert.match(load,/if\(_scheduleReadInitialInvalid\)\{[\s\S]*?_firebaseUsingLocalFallback=true/);
  assert.match(load,/_scheduleReadUsesSelectedKeys[\s\S]*?_pruneMissingRemoteLocalKeys/);
});

test('a fatal realtime read error makes later writes read only', () => {
  const source=read(path.join('js','core.js'));
  const handler=functionSource(source,'_handleScheduleReadError','_canUseScheduleReadCoordinator');

  assert.match(handler,/_firebaseUsingLocalFallback=true/);
});

test('the legacy initial read still attaches a gated compatibility listener', () => {
  const source=read(path.join('js','core.js'));
  const legacy=functionSource(source,'_attachLegacyFirebaseDataListeners','_attachFirebaseDataListeners');
  const attach=functionSource(source,'_attachFirebaseDataListeners','loadFromFirebase');
  const load=functionSource(source,'loadFromFirebase','getToday');

  assert.match(legacy,/_fb\.on\(['"]child_changed/);
  assert.match(legacy,/_fb\.on\(['"]child_removed/);
  assert.match(attach,/_attachLegacyFirebaseDataListeners\(\)/);
  assert.match(load,/\.finally\(_attachFirebaseDataListeners\)/);
});

test('live tab readiness delegates to selected active keys without changing the visible tab',()=>{
  const source=read(path.join('js','core.js'));
  const ensure=functionSource(source,'ensureScheduleTabLoaded','isScheduleTabDataReady');

  assert.match(ensure,/SCScheduleKeySelection\.tabKeys/);
  assert.match(ensure,/_scheduleSelectedController\.setActiveKeys/);
  assert.match(ensure,/_validStudentPayload/);
  assert.match(ensure,/_scheduleTabTransitioning=true/);
  assert.doesNotMatch(ensure,/_activeTab\s*=/);
});

test('schedule writes are blocked while selected tab data is loading',()=>{
  const source=read(path.join('js','core.js'));
  const guard=functionSource(source,'canPersistScheduleData','dbGet');

  assert.match(guard,/isScheduleDataTransitioning\(\)/);
  assert.match(guard,/시간표 데이터를 불러오는 중입니다/);
});
