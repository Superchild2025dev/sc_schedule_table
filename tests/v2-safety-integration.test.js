const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const dataSource=fs.readFileSync(path.join(__dirname,'..','js','data.js'),'utf8');
const tabSource=fs.readFileSync(path.join(__dirname,'..','js','tabs.js'),'utf8');

test('audit baselines are captured from the transaction server value',()=>{
  const start=dataSource.indexOf('function updateScheduleTx(');
  const end=dataSource.indexOf('function updateStudentsTx(',start);
  const section=dataSource.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.match(section,/createAuditPointFromRoot\(txKeys,root/);
  assert.doesNotMatch(section,/const auditPoint=.*createAuditPoint\(txKeys/);
});

test('past timetable deletion archives an old regular basis and preserves attendance data',()=>{
  const start=tabSource.indexOf('async function deleteTab(');
  const end=tabSource.indexOf('function _handleTabMenuAction(',start);
  const section=tabSource.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.match(section,/const isRegular=!tab\.type\|\|tab\.type==='regular'/);
  assert.match(section,/STORAGE_KEYS\.ARCHIVED_TABS/);
  assert.match(section,/state\.archived=_normalizeArchivedTabs/);
  assert.match(section,/if\(state\.main\?\.tabId===id\) state\.main=/);
  assert.match(section,/if\(state\.parent\?\.tabId===id\) state\.parent=/);
  assert.match(section,/const dataKeys=isSnapshot\?\[SNAP_KEY_PREFIX\+id\]:\[\]/);
  assert.match(section,/_scheduleWrites\.transaction\(txKeys/);
  assert.match(section,/dataKeys\.forEach\(key=>\{delete root\[key\];\}\)/);
  assert.doesNotMatch(section,/swim_bt_attendance_/);
  assert.doesNotMatch(section,/ATTENDANCE_DAY_SNAPSHOT_PREFIX/);
  assert.doesNotMatch(section,/dbRemove\(/);
});

test('past timetable deletion stays in the action menu without a separate X control',()=>{
  const start=tabSource.indexOf('function renderTabBar(');
  const end=tabSource.indexOf("document.getElementById('tab-bar').addEventListener",start);
  const section=tabSource.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.doesNotMatch(section,/tab-delete-trigger/);
  assert.doesNotMatch(section,/data-tab-del=/);
});

test('removing the legacy regular tab does not recreate it when another regular tab exists',()=>{
  const start=tabSource.indexOf('function _normalizeTabList(');
  const end=tabSource.indexOf('function _normalizeArchivedTabs(',start);
  const section=tabSource.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.match(section,/const hasRegular=/);
  assert.doesNotMatch(section,/some\(t=>t&&t\.id==='regular'\)/);
});

test('historical attendance can resolve an archived regular timetable',()=>{
  const start=tabSource.indexOf('function getAttendanceBasisTabForDate(');
  const end=tabSource.indexOf('function _attendanceReservationDate(',start);
  const section=tabSource.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.match(section,/_archivedTabList/);
  assert.match(section,/if\(archived\) return archived/);
});
