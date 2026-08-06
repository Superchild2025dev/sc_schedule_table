const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const permissionPolicy=JSON.parse(fs.readFileSync(
  path.join(__dirname,'..','config','schedule-permissions.json'),
  'utf8'
));
const developerEmails=permissionPolicy.accounts
  .filter(account=>account.role==='developer')
  .map(account=>account.email);

function loadShadow(email){
  const window={SC_DEVELOPER_EMAILS:developerEmails};
  if(email){
    window.firebase={auth:()=>({currentUser:{email}})};
  }
  const context={window,console,setTimeout,clearTimeout,Date,CustomEvent:function(){}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','js','schedule-v2-shadow.js'),'utf8'),context);
  return context.window.SCV2Shadow;
}

test('V2 shadow runs for the developer account and not the operating owner',()=>{
  assert.equal(loadShadow('developer@scswim.local').isDeveloperSession(),true);
  assert.equal(loadShadow('2025superchild@gmail.com').isDeveloperSession(),false);
  assert.equal(loadShadow('gagyeong.desk@scswim.local').isDeveloperSession(),false);
});

test('V1 schedule keys map to the V2 collections they own',()=>{
  const shadow=loadShadow();
  assert.deepEqual(Array.from(shadow.collectionsForKey('swim_students')),['people','enrollments','placements']);
  assert.deepEqual(Array.from(shadow.collectionsForKey('swim_bt_summer_stu')),['people','enrollments','placements']);
  assert.deepEqual(Array.from(shadow.collectionsForKey('swim_inst')),['teacherAssignments']);
  assert.deepEqual(Array.from(shadow.collectionsForKey('swim_retire')),['reservations']);
  assert.deepEqual(Array.from(shadow.collectionsForKey('swim_reserve')),['waitlistEntries']);
  assert.deepEqual(Array.from(shadow.collectionsForKey('swim_mark')),['classMarks']);
  assert.deepEqual(Array.from(shadow.collectionsForKey('swim_attendance')),['attendanceRecords']);
  assert.deepEqual(Array.from(shadow.collectionsForKey('swim_bt_attendance_summer')),['attendanceRecords']);
  assert.deepEqual(Array.from(shadow.collectionsForKey('swim_att_guests')),['attendanceGuests']);
  assert.deepEqual(Array.from(shadow.collectionsForKey('swim_bt_att_guests_summer')),['attendanceGuests']);
  assert.deepEqual(Array.from(shadow.collectionsForKey('swim_day_snapshot')),['attendanceSnapshots','attendanceSnapshotStudents','attendanceSnapshotTeachers']);
  assert.deepEqual(Array.from(shadow.collectionsForKey('swim_bt_day_snapshot_summer')),['attendanceSnapshots','attendanceSnapshotStudents','attendanceSnapshotTeachers']);
  assert.deepEqual(Array.from(shadow.collectionsForKey('zz_swim_day_snapshot__regular__2026-07-01')),['attendanceSnapshots','attendanceSnapshotStudents','attendanceSnapshotTeachers']);
  assert.deepEqual(Array.from(shadow.collectionsForKey('swim_disabled')),['disabledSlots']);
  assert.deepEqual(Array.from(shadow.collectionsForKey('swim_closed')),['calendarClosures']);
  assert.deepEqual(Array.from(shadow.collectionsForKey('swim_periods')),['schedulePeriods']);
  assert.deepEqual(Array.from(shadow.collectionsForKey('swim_parent_tab')),['scheduleSettings']);
  assert.deepEqual(Array.from(shadow.collectionsForKey('swim_main_tab')),['reservations','scheduleSettings']);
  assert.deepEqual(Array.from(shadow.collectionsForKey('swim_retire_history')),['retirementRecords']);
  assert.deepEqual(Array.from(shadow.collectionsForKey('swim_desk_notes')),['deskStudentRecords']);
  assert.deepEqual(Array.from(shadow.collectionsForKey('swim_teachers')),['teacherProfiles']);
  assert.deepEqual(Array.from(shadow.collectionsForKey('swim_tab_folders')),['tabFolders']);
  assert.deepEqual(Array.from(shadow.collectionsForKey('swim_archived_tabs')),['archivedTabs']);
  assert.deepEqual(Array.from(shadow.collectionsForKey('swim_age_year')),['systemMetadata']);
  assert.deepEqual(Array.from(shadow.collectionsForKey('swim_student_id_version')),['systemMetadata']);
  assert.deepEqual(Array.from(shadow.collectionsForKey('swim_ver')),['systemMetadata']);
});

test('unmapped functional keys become compatibility warnings',()=>{
  const shadow=loadShadow();
  assert.deepEqual(Array.from(shadow.unsupportedChangedKeys(['swim_mark','swim_attendance','swim_students','swim_requests'])),['swim_requests']);
});

test('audit and backup keys do not create compatibility warnings',()=>{
  const shadow=loadShadow();
  assert.deepEqual(Array.from(shadow.unsupportedChangedKeys(['swim_audit_log','zz_swim_audit_entry__123','swim_restore_point_1'])),[]);
});

test('a branch without a V2 baseline creates one automatically from V1',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','js','schedule-v2-shadow.js'),'utf8');
  assert.match(source,/latestUsableGeneration/);
  assert.match(source,/store\.writeGeneration\(state\.root\.db,state\.branchId,report/);
  assert.match(source,/rollbackPolicy:'v1-remains-source'/);
});

test('compatibility errors stay in settings and never create a timetable popup',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','js','schedule-v2-shadow.js'),'utf8');
  assert.doesNotMatch(source,/sc-v2-shadow-alert/);
  assert.doesNotMatch(source,/renderBanner/);
  assert.match(source,/collection\('alerts'\)/);
});

test('historical attendance snapshots are loaded once and then tracked incrementally',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','js','schedule-v2-shadow.js'),'utf8');
  assert.match(source,/shadowSnapshotsMigrated/);
  assert.match(source,/const SNAPSHOT_SCHEMA_VERSION=1/);
  assert.match(source,/shadowSnapshotSchemaVersion/);
  assert.match(source,/Number\(prior\.shadowSnapshotSchemaVersion\|\|0\)===SNAPSHOT_SCHEMA_VERSION/);
  assert.match(source,/loadAttendanceSnapshotRoot/);
  assert.match(source,/syncShadowSnapshotScopes/);
  assert.doesNotMatch(source,/includeDeferred:true[^\n]*_list\s*\(/);
});
