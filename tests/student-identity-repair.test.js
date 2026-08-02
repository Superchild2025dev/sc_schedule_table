const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function loadModules(){
  const context={console};
  context.window=context;
  context.globalThis=context;
  vm.createContext(context);
  ['schedule-time.js','schedule-schema-v2.js','student-identity-repair.js'].forEach(file=>{
    const source=fs.readFileSync(path.join(__dirname,'..','js',file),'utf8');
    vm.runInContext(source,context,{filename:file});
  });
  return context;
}

function fixture(){
  return {
    swim_tab_list:JSON.stringify([
      {id:'regular',name:'정규시간표',type:'regular'},
      {id:'summer',name:'2026 여름방특',type:'bangteuk'},
    ]),
    swim_students:JSON.stringify([
      {sid:'stu_shared',n:'김하나',p:'01011112222',t:'4시',d:'월',l:1,r:1,loc:'A승차 / B하차',memo:'정규 메모'},
      {sid:'stu_shared',n:'김하나',p:'01011112222',t:'4시',d:'수',l:1,r:1,loc:'C승차 / D하차'},
      {sid:'stu_shared',n:'김두나',p:'01011112222',t:'5시',d:'화',l:2,r:3,loc:'형제 차량',memo:'형제 메모'},
    ]),
    swim_bt_summer_stu:JSON.stringify([
      {sid:'stu_shared',n:'*김하나',p:'01011112222',t:'10시',d:'월수금',l:3,r:2,btWeek5:true,paid:true},
    ]),
    swim_requests:JSON.stringify({
      req1:{sid:'stu_shared',name:'김두나',phone:'01011112222',slotKey:'5시/화/2/3',status:'pending'},
    }),
  };
}

test('same phone with different names is reported as an ID conflict',()=>{
  const context=loadModules();
  const report=context.SCScheduleSchemaV2.diagnoseLegacyRoot('yongam',fixture());
  assert.equal(report.identityConflicts.length,1);
  const names=report.identityConflicts[0].profiles.map(profile=>profile.name).sort();
  assert.deepEqual(Array.from(names),['김두나','김하나']);
  assert.equal(report.identityConflicts[0].occurrenceCount,4);
});

test('split changes only IDs and preserves slots, transport, memo, and week-five metadata',()=>{
  const context=loadModules();
  const root=fixture();
  const conflict=context.SCScheduleSchemaV2.diagnoseLegacyRoot('yongam',root).identityConflicts[0];
  const result=context.SCStudentIdentityRepair.applyRepair(root,{
    branchId:'yongam',personId:conflict.personId,mode:'split',
    expectedProfileKeys:conflict.profiles.map(profile=>profile.key),
  });
  const regular=JSON.parse(result.root.swim_students);
  const vacation=JSON.parse(result.root.swim_bt_summer_stu);
  const one=regular.filter(student=>student.n==='김하나');
  const sibling=regular.find(student=>student.n==='김두나');
  assert.equal(new Set(one.map(student=>student.sid).concat(vacation.map(student=>student.sid))).size,1);
  assert.notEqual(sibling.sid,one[0].sid);
  assert.equal(sibling.loc,'형제 차량');
  assert.equal(sibling.memo,'형제 메모');
  assert.equal(vacation[0].btWeek5,true);
  assert.equal(vacation[0].paid,true);
  const requests=JSON.parse(result.root.swim_requests);
  assert.equal(requests.req1.sid,sibling.sid);
  assert.equal(context.SCScheduleSchemaV2.diagnoseLegacyRoot('yongam',result.root).identityConflicts.length,0);
});

test('merge uses the selected profile without moving any slot',()=>{
  const context=loadModules();
  const root=fixture();
  const conflict=context.SCScheduleSchemaV2.diagnoseLegacyRoot('gagyeong',root).identityConflicts[0];
  const target=conflict.profiles.find(profile=>profile.name==='김하나');
  const beforeSlots=JSON.parse(root.swim_students).map(student=>[student.t,student.d,student.l,student.r].join('/'));
  const result=context.SCStudentIdentityRepair.applyRepair(root,{
    branchId:'gagyeong',personId:conflict.personId,mode:'merge',chosenProfileKey:target.key,
    expectedProfileKeys:conflict.profiles.map(profile=>profile.key),
  });
  const after=JSON.parse(result.root.swim_students);
  assert.deepEqual(after.map(student=>[student.t,student.d,student.l,student.r].join('/')),beforeSlots);
  assert.ok(after.every(student=>student.sid==='stu_shared'&&student.n==='김하나'));
  assert.equal(context.SCScheduleSchemaV2.diagnoseLegacyRoot('gagyeong',result.root).identityConflicts.length,0);
});
