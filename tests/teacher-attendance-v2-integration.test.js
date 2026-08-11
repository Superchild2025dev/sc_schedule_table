const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const teacher=fs.readFileSync(path.join(root,'js','teacher.js'),'utf8');
const html=fs.readFileSync(path.join(root,'teacher.html'),'utf8');

function body(name,nextName){
  const start=teacher.indexOf(`function ${name}`);
  assert.notEqual(start,-1,`${name} is missing`);
  const end=nextName?teacher.indexOf(`function ${nextName}`,start+1):-1;
  if(end>=0) return teacher.slice(start,end);
  const open=teacher.indexOf('{',start);
  let depth=0;
  for(let index=open;index<teacher.length;index++){
    if(teacher[index]==='{') depth+=1;
    else if(teacher[index]==='}'&&--depth===0) return teacher.slice(start,index+1);
  }
  throw new Error(`${name} body is incomplete`);
}

test('teacher page loads the shared attendance runtime before teacher code',()=>{
  const gateway=html.indexOf("scJs('js/attendance-operational-gateway.js')");
  const runtime=html.indexOf("scJs('js/attendance-main-runtime.js')");
  const page=html.indexOf("scJs('js/teacher.js')");
  assert.ok(gateway>=0);
  assert.ok(runtime>gateway);
  assert.ok(page>runtime);
});

test('regular and vacation teacher pages use separate attendance storage keys',()=>{
  const storage=body('teacherAttendanceStorageKeys','getTeacherOperationalAttendanceRuntime');
  assert.match(storage,/swim_attendance/);
  assert.match(storage,/swim_att_guests/);
  assert.match(storage,/swim_bt_attendance_/);
  assert.match(storage,/swim_bt_att_guests_/);
  assert.match(storage,/courseType:'bangteuk'/);
});

test('teacher attendance runtime is created only after branch Firebase setup',()=>{
  const runtime=body('getTeacherOperationalAttendanceRuntime','isTeacherAttendanceV2Authority');
  assert.match(runtime,/getBranchInfo\(\)/);
  assert.match(runtime,/_fbReady/);
  assert.match(runtime,/firebase\.firestore\(\)/);
  assert.match(runtime,/SCV2AttendanceStore\.create/);
  assert.match(runtime,/SCOperationalAttendance\.create/);
  assert.match(runtime,/SCMainAttendanceRuntime\.create/);
});

test('whole-root teacher load defers V1 attendance parsing until the mode is known',()=>{
  const load=body('loadAllData','subscribeChanges');
  const hydrate=body('hydrateTeacherLegacyAttendance','loadAllData');
  assert.match(load,/_teacherAttendanceRootValues\[attendanceKeys\.attendance\]/);
  assert.match(load,/_teacherAttendanceRootValues\[attendanceKeys\.attGuests\]/);
  assert.doesNotMatch(load,/ATTENDANCE=parseStoredJSON/);
  assert.doesNotMatch(load,/ATT_GUESTS=parseStoredJSON/);
  assert.match(hydrate,/isTeacherAttendanceV2Authority\(\)/);
});

test('legacy attendance hydration cannot overwrite a just-saved teacher check with stale root data',()=>{
  const hydrate=body('hydrateTeacherLegacyAttendance','loadAllData');
  const rawAttendance=body('_updateLegacyTeacherAttendanceMapTx','updateAttendanceMapTx');
  const rawGuests=body('_updateLegacyTeacherAttGuestsMapTx','updateAttGuestsMapTx');
  assert.match(teacher,/const _teacherLegacyAttendanceHydratedKeys=new Set\(\)/);
  assert.match(hydrate,/_teacherLegacyAttendanceHydratedKeys\.has/);
  assert.match(hydrate,/_teacherLegacyAttendanceHydratedKeys\.add/);
  assert.match(rawAttendance,/_teacherLegacyAttendanceHydratedKeys\.add\(key\)/);
  assert.match(rawGuests,/_teacherLegacyAttendanceHydratedKeys\.add\(key\)/);
});

test('teacher week render waits for operational attendance before snapshots and HTML',()=>{
  const render=body('renderAttendanceTimetable','cycleAttendance');
  const operational=render.indexOf('ensureTeacherAttendanceWeekLoaded');
  const snapshots=render.indexOf('ensureTeacherDaySnapshotsLoaded');
  const htmlWrite=render.indexOf("document.getElementById('att-tt-view').innerHTML");
  assert.ok(operational>=0);
  assert.ok(snapshots>operational);
  assert.ok(htmlWrite>snapshots);
  assert.match(render,/renderSeq!==_attendanceRenderSeq/);
});

test('teacher attendance and guest transactions delegate through the runtime',()=>{
  const attendance=body('updateAttendanceMapTx','updateAttGuestsMapTx');
  const guests=body('updateAttGuestsMapTx','updateMarkTx');
  assert.match(attendance,/getTeacherOperationalAttendanceRuntime/);
  assert.match(attendance,/runtime\.updateAttendance/);
  assert.match(guests,/getTeacherOperationalAttendanceRuntime/);
  assert.match(guests,/runtime\.updateGuests/);
  assert.match(teacher,/function _updateLegacyTeacherAttendanceMapTx/);
  assert.match(teacher,/function _updateLegacyTeacherAttGuestsMapTx/);
});

test('missing attendance operational dependencies keep teacher writes read only',async()=>{
  let legacyWrites=0;
  const context={
    _canWriteTeacherKey:()=>true,
    teacherAttendanceStorageKeys:()=>({attendance:'swim_attendance',attGuests:'swim_att_guests'}),
    getTeacherOperationalAttendanceRuntime:()=>null,
    teacherAttendanceOperationContext:()=>({tabId:'regular',courseType:'regular'}),
    _updateLegacyTeacherAttendanceMapTx:async()=>{legacyWrites+=1;return {};},
    _updateLegacyTeacherAttGuestsMapTx:async()=>{legacyWrites+=1;return {};},
  };
  vm.createContext(context);
  vm.runInContext(`${body('updateAttendanceMapTx','_updateLegacyTeacherAttGuestsMapTx')}\n${body('updateAttGuestsMapTx','updateMarkTx')}`,context);

  await assert.rejects(()=>context.updateAttendanceMapTx(map=>map),
    error=>error?.code==='operational-authority-unavailable');
  await assert.rejects(()=>context.updateAttGuestsMapTx(map=>map),
    error=>error?.code==='operational-authority-unavailable');
  assert.equal(legacyWrites,0);
});

test('teacher write permission checks use the active regular or vacation key',()=>{
  const attendance=body('updateAttendanceMapTx','updateAttGuestsMapTx');
  const guests=body('updateAttGuestsMapTx','updateMarkTx');
  assert.match(attendance,/teacherAttendanceStorageKeys\(\)\.attendance/);
  assert.match(guests,/teacherAttendanceStorageKeys\(\)\.attGuests/);
});
