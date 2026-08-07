const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function loadRuntime(){
  const context={window:{},console};
  vm.createContext(context);
  for(const file of ['schedule-time.js','schedule-schema-v2.js','attendance-v2-model.js']){
    vm.runInContext(fs.readFileSync(path.join(__dirname,'..','js',file),'utf8'),context,{filename:file});
  }
  return {
    schema:context.window.SCScheduleSchemaV2,
    model:context.window.SCV2AttendanceModel,
  };
}

function plain(value){ return JSON.parse(JSON.stringify(value)); }

function attendanceRoot(overrides={}){
  return {
    swim_tab_list:JSON.stringify([
      {id:'regular',type:'regular'},
      {id:'summer',type:'bangteuk'},
    ]),
    swim_main_tab:JSON.stringify({tabId:'regular'}),
    swim_students:JSON.stringify([
      {sid:'stu_regular',n:'정규원생',p:'01011112222',t:'5시',d:'월',l:2,r:3},
    ]),
    swim_bt_summer_stu:JSON.stringify([
      {sid:'stu_vacation',n:'방특원생',p:'01033334444',t:'10시',d:'월',l:1,r:2},
    ]),
    ...overrides,
  };
}

test('operational attendance IDs match the existing V2 conversion',()=>{
  const {schema,model}=loadRuntime();
  const legacyKey='5시/월/2/3/2026-08-10';
  const raw={s:'present',at:'2026-08-10T09:00:00.000Z',by:'테스트'};
  const report=schema.diagnoseLegacyRoot('yongam',attendanceRoot({
    swim_attendance:JSON.stringify({[legacyKey]:raw}),
  }));
  const converted=report.conversion.attendanceRecords[0];
  const row=model.recordFromLegacy({
    tabId:'regular',courseType:'regular',legacyKey,raw,
    personId:'stu_regular',enrollmentId:converted.enrollmentId,
  });

  assert.equal(row.id,converted.id);
  assert.equal(row.legacyKey,legacyKey);
  assert.equal(row.slotKey,'5시/월/2/3');
  assert.equal(row.recordType,'scheduled-student');
  assert.deepEqual(plain(row.payload),raw);
});

test('sub attendance is parsed as a marked student without losing its legacy key',()=>{
  const {model}=loadRuntime();
  const parsed=model.parseRecordKey('5시/월/2/3/2026-08-10#sub');
  const row=model.recordFromLegacy({
    tabId:'regular',courseType:'regular',
    legacyKey:'5시/월/2/3/2026-08-10#sub',
    raw:{s:'absent'},personId:'stu_sub',classMarkId:'mark_1',
  });

  assert.deepEqual(plain(parsed),{
    ok:true,
    value:{time:'5시',day:'월',lane:2,seat:3,date:'2026-08-10',isSub:true,slotKey:'5시/월/2/3'},
  });
  assert.equal(row.recordType,'marked-student');
  assert.equal(row.legacyKey,'5시/월/2/3/2026-08-10#sub');
  assert.equal(row.classMarkId,'mark_1');
});

test('regular and vacation attendance with the same slot key never share an ID',()=>{
  const {model}=loadRuntime();
  const legacyKey='10시/월/1/2/2026-08-10';
  const regular=model.recordFromLegacy({tabId:'regular',courseType:'regular',legacyKey,raw:{s:'present'}});
  const vacation=model.recordFromLegacy({tabId:'summer',courseType:'bangteuk',legacyKey,raw:{s:'present'}});

  assert.notEqual(regular.id,vacation.id);
  assert.equal(regular.tabId,'regular');
  assert.equal(vacation.tabId,'summer');
  assert.equal(vacation.courseType,'bangteuk');
});

test('guest IDs match the existing converter with and without a legacy gid',()=>{
  const {schema,model}=loadRuntime();
  const legacyKey='5시/월/2/2026-08-10';
  const guests=[
    {gid:'guest_known',n:'추가원생',p:'01012341234',slotKey:'5시/월/2/4',type:'bogang',s:'present'},
    {n:'현장원생',p:'01099998888',s:'absent'},
  ];
  const report=schema.diagnoseLegacyRoot('yongam',attendanceRoot({
    swim_att_guests:JSON.stringify({[legacyKey]:guests}),
  }));
  const expected=report.conversion.attendanceGuests.sort((a,b)=>a.order-b.order);
  const actual=guests.map((raw,index)=>model.guestFromLegacy({
    tabId:'regular',courseType:'regular',legacyKey,raw,index,
  }));

  assert.deepEqual(plain(actual.map(row=>row.id)),plain(expected.map(row=>row.id)));
  assert.equal(actual[0].guestId,'guest_known');
  assert.equal(actual[0].seat,4);
  assert.equal(actual[1].guestId,'');
  assert.equal(actual[1].seat,0);
});

test('siblings sharing a phone remain different guest people',()=>{
  const {model}=loadRuntime();
  const base={tabId:'regular',courseType:'regular',legacyKey:'4시/화/1/2026-08-11'};
  const first=model.guestFromLegacy({...base,index:0,raw:{n:'홍길동',p:'01012345678'}});
  const second=model.guestFromLegacy({...base,index:1,raw:{n:'홍길순',p:'01012345678'}});

  assert.notEqual(first.personId,second.personId);
});

test('invalid attendance and guest keys become explicit blocking issues',()=>{
  const {model}=loadRuntime();

  assert.deepEqual(plain(model.parseRecordKey('broken-key')),{
    ok:false,issue:{type:'invalid-attendance-key',key:'broken-key'},
  });
  assert.deepEqual(plain(model.parseGuestKey('also-broken')),{
    ok:false,issue:{type:'invalid-attendance-guest-key',key:'also-broken'},
  });
  assert.equal(model.recordFromLegacy({tabId:'regular',legacyKey:'broken-key',raw:{s:'present'}}).ok,false);
  assert.equal(model.guestFromLegacy({tabId:'regular',legacyKey:'also-broken',raw:{},index:0}).ok,false);
});

test('V2 rows rebuild the exact legacy maps and guest order',()=>{
  const {model}=loadRuntime();
  const record=model.recordFromLegacy({
    tabId:'regular',courseType:'regular',legacyKey:'4시/수/1/1/2026-08-12',
    raw:{s:'present',by:'데스크'},personId:'stu_1',
  });
  const guestKey='4시/수/1/2026-08-12';
  const later=model.guestFromLegacy({
    tabId:'regular',courseType:'regular',legacyKey:guestKey,index:1,
    raw:{gid:'g_2',n:'둘째',s:'absent'},
  });
  const earlier=model.guestFromLegacy({
    tabId:'regular',courseType:'regular',legacyKey:guestKey,index:0,
    raw:{gid:'g_1',n:'첫째',s:'present'},
  });

  assert.deepEqual(plain(model.mapsFromRows([record],[later,earlier])),{
    attendance:{'4시/수/1/1/2026-08-12':{s:'present',by:'데스크'}},
    guests:{'4시/수/1/2026-08-12':[
      {gid:'g_1',n:'첫째',s:'present'},
      {gid:'g_2',n:'둘째',s:'absent'},
    ]},
    issues:[],
  });
});

test('map diff reports only changed and deleted legacy keys',()=>{
  const {model}=loadRuntime();
  const before={
    same:{s:'present'},
    changed:{s:'absent'},
    deleted:{s:'present'},
  };
  const after={
    same:{s:'present'},
    changed:{s:'present'},
    added:{s:'absent'},
  };

  assert.deepEqual(plain(model.diffLegacyMaps(before,after)),{
    upserts:[
      {legacyKey:'added',raw:{s:'absent'}},
      {legacyKey:'changed',raw:{s:'present'}},
    ],
    deletes:['deleted'],
    unchanged:['same'],
  });
});

test('parity comparison blocks malformed or mismatched rows instead of dropping them',()=>{
  const {model}=loadRuntime();
  const legacyKey='4시/목/1/1/2026-08-13';
  const good=model.recordFromLegacy({tabId:'regular',courseType:'regular',legacyKey,raw:{s:'present'}});
  const matching=model.compareLegacyRows({
    attendance:{[legacyKey]:{s:'present'}},guests:{},records:[good],guestRows:[],
  });
  const mismatched=model.compareLegacyRows({
    attendance:{[legacyKey]:{s:'absent'},'broken-key':{s:'present'}},
    guests:{},records:[good],guestRows:[],
  });

  assert.equal(matching.ready,true);
  assert.equal(matching.mismatchCount,0);
  assert.equal(mismatched.ready,false);
  assert.equal(mismatched.mismatchCount,2);
  assert.deepEqual(plain(mismatched.issues.map(issue=>issue.type).sort()),[
    'attendance-payload-mismatch','invalid-attendance-key',
  ]);
});
