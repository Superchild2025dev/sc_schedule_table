const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const tabs=fs.readFileSync(path.join(root,'js','tabs.js'),'utf8');
const table=fs.readFileSync(path.join(root,'js','table.js'),'utf8');
const core=fs.readFileSync(path.join(root,'js','core.js'),'utf8');

function fn(source,name,nextName){
  const start=source.indexOf(`function ${name}`);
  assert.notEqual(start,-1,`${name} is missing`);
  const end=source.indexOf(`function ${nextName}`,start+1);
  assert.notEqual(end,-1,`${name} boundary is missing`);
  return source.slice(start,end);
}
function body(source,name){
  const start=source.indexOf(`function ${name}`);
  assert.notEqual(start,-1,`${name} is missing`);
  const open=source.indexOf('{',start);
  let depth=0;
  for(let i=open;i<source.length;i++){
    if(source[i]==='{') depth++;
    else if(source[i]==='}'&&--depth===0) return source.slice(start,i+1);
  }
  throw new Error(`${name} body is incomplete`);
}

test('attendance basis loading deduplicates tabs and prepares keys before snapshots',()=>{
  const ensure=fn(tabs,'ensureAttendanceBasisTabsLoaded','isAttendanceDataReady');
  const auxiliaryIndex=ensure.indexOf("ensureScheduleAuxiliaryKeysLoaded('attendance-basis'");
  const snapshotIndex=ensure.indexOf('ensureAttendanceDaySnapshotsLoaded');

  assert.match(ensure,/new Map\(\)/);
  assert.match(ensure,/getAttendanceBasisTabForDate/);
  assert.match(ensure,/SCScheduleKeySelection\.tabKeys/);
  assert.ok(auxiliaryIndex>=0,'attendance basis keys must use the auxiliary subscription');
  assert.ok(snapshotIndex>auxiliaryIndex,'past day snapshots load only after basis tabs');
});

test('attendance date refresh renders only after basis readiness',()=>{
  const refresh=fn(table,'_queueAttendanceSnapshotRefresh','_updateAttBarInfo');
  const setDate=fn(table,'setAttendanceDate','attDayShift');

  assert.match(refresh,/ensureAttendanceBasisTabsLoaded\(dates/);
  assert.match(refresh,/seq!==_attSnapshotRefreshSeq/);
  assert.match(refresh,/_attendanceDataReady=true/);
  assert.ok(refresh.indexOf('buildTable()')>refresh.indexOf('ensureAttendanceBasisTabsLoaded'));
  assert.doesNotMatch(setDate,/buildTable\(\)/);
});

test('closing attendance releases its auxiliary schedule listeners',()=>{
  const toggle=fn(table,'toggleAttendanceMode','setAttendanceDate');

  assert.match(toggle,/releaseAttendanceBasisTabs\(\)/);
  assert.match(toggle,/_attendanceDataReady=false/);
});

test('every attendance write entry checks data readiness',()=>{
  const names=[
    'applyAttBatch','_saveAttAdd','_saveEditModal','_deleteEditModal',
    '_cycleAttendance','_cycleAttendanceSub','_setAttModal',
    '_deleteFromAttModal','markAllPresentForDate',
  ];
  names.forEach(name=>{
    assert.match(body(table,name),/requireAttendanceDataReady\(/,`${name} must require ready attendance data`);
  });
});

test('auxiliary schedule loads are render-blocked and validate student payloads',()=>{
  const ensure=fn(core,'ensureScheduleAuxiliaryKeysLoaded','releaseScheduleAuxiliaryKeys');
  const coordinator=fn(core,'_ensureScheduleReadCoordinator','ensureScheduleTabLoaded');

  assert.match(ensure,/_scheduleAuxiliaryLoadingOwners\.add/);
  assert.match(ensure,/_validStudentPayload/);
  assert.match(ensure,/setAuxiliaryKeys/);
  assert.match(coordinator,/_scheduleAuxiliaryLoadingOwners\.size/);
});
