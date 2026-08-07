const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function loadSchema(){
  const context={window:{},console};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','js','schedule-time.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','js','schedule-schema-v2.js'),'utf8'),context);
  return context.window.SCScheduleSchemaV2;
}

test('regular and vacation schedules share a person but keep separate enrollments',()=>{
  const schema=loadSchema();
  const result=schema.convertLegacySchedule({
    branchId:'yongam',
    tabs:[
      {id:'regular',name:'정규',type:'regular'},
      {id:'summer',name:'여름방특',type:'bangteuk'},
    ],
    studentsByTab:{
      regular:[{sid:'stu_shared',n:'홍길동',p:'01012345678',t:'4시',d:'월',l:1,r:1}],
      summer:[{sid:'stu_shared',n:'홍길동',p:'01012345678',t:'10시',d:'월수금',l:2,r:1}],
    },
  });
  assert.equal(result.people.length,1);
  assert.equal(result.enrollments.length,2);
  assert.equal(result.placements.length,2);
  assert.deepEqual(new Set(result.enrollments.map(row=>row.courseType)),new Set(['regular','bangteuk']));
});

test('legacy vacation star becomes enrollment metadata instead of part of the person name',()=>{
  const schema=loadSchema();
  const result=schema.convertLegacySchedule({
    branchId:'yongam',
    tabs:[
      {id:'regular',type:'regular'},
      {id:'summer',type:'bangteuk'},
    ],
    studentsByTab:{
      regular:[{n:'홍길동',p:'01012345678',t:'4시',d:'월',l:1,r:1}],
      summer:[{n:'*홍길동',p:'01012345678',t:'10시',d:'월수금',l:1,r:1}],
    },
  });
  assert.equal(result.people.length,1);
  assert.equal(result.people[0].name,'홍길동');
  const vacation=result.enrollments.find(row=>row.courseType==='bangteuk');
  const regular=result.enrollments.find(row=>row.courseType==='regular');
  assert.equal(vacation.weekFive,true);
  assert.equal(regular.weekFive,false);
});

test('transport details remain attached to each placement',()=>{
  const schema=loadSchema();
  const result=schema.convertLegacySchedule({
    branchId:'gagyeong',
    tabs:[{id:'regular',type:'regular'}],
    studentsByTab:{regular:[
      {sid:'stu_one',n:'김가경',p:'01011112222',t:'4시',d:'월',l:1,r:1,v:true,loc:'학교 앞'},
      {sid:'stu_one',n:'김가경',p:'01011112222',t:'4시',d:'수',l:1,r:1,v:false,loc:'자가등원'},
    ]},
  });
  assert.equal(result.people.length,1);
  assert.equal(result.placements.length,2);
  const monday=result.placements.find(row=>row.day==='월');
  const wednesday=result.placements.find(row=>row.day==='수');
  assert.deepEqual(JSON.parse(JSON.stringify(monday.transport)),{usesVehicle:true,location:'학교 앞'});
  assert.deepEqual(JSON.parse(JSON.stringify(wednesday.transport)),{usesVehicle:false,location:'자가등원'});
});

test('siblings sharing a phone number remain separate people',()=>{
  const schema=loadSchema();
  const result=schema.convertLegacySchedule({
    branchId:'yongam',
    tabs:[{id:'regular',type:'regular'}],
    studentsByTab:{regular:[
      {n:'홍길동',p:'01012345678',t:'4시',d:'월',l:1,r:1},
      {n:'홍길순',p:'01012345678',t:'5시',d:'월',l:1,r:1},
    ]},
  });
  assert.equal(result.people.length,2);
  assert.notEqual(result.people[0].id,result.people[1].id);
});

test('two different students occupying one slot are reported as a blocking issue',()=>{
  const schema=loadSchema();
  const result=schema.convertLegacySchedule({
    branchId:'yongam',
    tabs:[{id:'regular',type:'regular'}],
    studentsByTab:{regular:[
      {sid:'stu_a',n:'원생A',p:'01011111111',t:'4시',d:'월',l:1,r:1},
      {sid:'stu_b',n:'원생B',p:'01022222222',t:'4시',d:'월',l:1,r:1},
    ]},
  });
  assert.equal(result.placements.length,1);
  assert.equal(result.issues.length,1);
  assert.equal(result.issues[0].type,'slot-conflict');
});

test('conversion does not mutate the legacy input',()=>{
  const schema=loadSchema();
  const input={
    branchId:'yongam',
    tabs:[{id:'regular',type:'regular'}],
    studentsByTab:{regular:[{n:'홍길동',p:'01012345678',t:'4시',d:'월',l:1,r:1,custom:{keep:true}}]},
  };
  const before=JSON.stringify(input);
  const result=schema.convertLegacySchedule(input);
  assert.equal(JSON.stringify(input),before);
  assert.deepEqual(JSON.parse(JSON.stringify(result.placements[0].extra)),{custom:{keep:true}});
});

test('legacy root diagnostics are read-only and report count mismatches',()=>{
  const schema=loadSchema();
  const root={
    swim_tab_list:JSON.stringify([{id:'regular',type:'regular'}]),
    swim_students:JSON.stringify([
      {sid:'stu_a',n:'원생A',p:'01011111111',t:'4시',d:'월',l:1,r:1},
      {sid:'stu_b',n:'원생B',p:'01022222222',t:'4시',d:'월',l:1,r:1},
    ]),
    swim_inst:JSON.stringify({'4시/월/1':'선생님'}),
  };
  const before=JSON.stringify(root);
  const report=schema.diagnoseLegacyRoot('gagyeong',root);
  assert.equal(JSON.stringify(root),before);
  assert.equal(report.checks.legacyPlacements,2);
  assert.equal(report.checks.convertedPlacements,1);
  assert.equal(report.checks.ready,false);
  assert.equal(report.blockingIssues[0].type,'slot-conflict');
});

test('serialized legacy diagnosis omits PII while direct conversion properties remain accessible',()=>{
  const schema=loadSchema();
  const name='PrivacyLeakName_Q2_20260807';
  const phone='01098765432';
  const report=schema.diagnoseLegacyRoot('gagyeong',{
    swim_tab_list:JSON.stringify([{id:'regular',type:'regular'}]),
    swim_students:JSON.stringify([{sid:'privacy_person',n:name,p:phone,t:'4시',d:'월',l:1,r:1}]),
  });
  const serialized=JSON.stringify(report);
  assert.equal(serialized.includes(name),false);
  assert.equal(serialized.includes(phone),false);
  assert.equal(report.bundle.studentsByTab.regular[0].n,name);
  assert.equal(report.conversion.people[0].name,name);
  assert.equal(report.identityConflicts.length,0);
  assert.ok(Array.isArray(report.blockingIssues));
});

test('paired move maps become one reservation document',()=>{
  const schema=loadSchema();
  const root={
    swim_tab_list:JSON.stringify([{id:'regular',type:'regular'}]),
    swim_main_tab:JSON.stringify({tabId:'regular'}),
    swim_students:'[]',
    swim_retire:JSON.stringify({
      '4시/월/1/1':{sid:'stu_1',name:'홍길동',ds:'2026-08-03',moveType:'reserve',moveId:'move-one',pairKey:'4시/수/1/1'},
    }),
    swim_enroll:JSON.stringify({
      '4시/수/1/1':{sid:'stu_1',name:'홍길동',ds:'2026-08-05',moveType:'reserve',moveId:'move-one',pairKey:'4시/월/1/1'},
    }),
  };
  const report=schema.diagnoseLegacyRoot('yongam',root);
  assert.equal(report.conversion.reservations.length,1);
  const move=report.conversion.reservations[0];
  assert.equal(move.type,'move');
  assert.equal(move.sourceSlotKey,'4시/월/1/1');
  assert.equal(move.targetSlotKey,'4시/수/1/1');
  assert.equal(move.sourceDate,'2026-08-03');
  assert.equal(move.targetDate,'2026-08-05');
});

test('absence and makeup marks become separate V2 documents',()=>{
  const schema=loadSchema();
  const root={
    swim_tab_list:JSON.stringify([{id:'regular',type:'regular'}]),
    swim_main_tab:JSON.stringify({tabId:'regular'}),
    swim_students:JSON.stringify([
      {sid:'stu_absent',n:'결석원생',p:'01011112222',t:'4시',d:'월',l:1,r:1},
    ]),
    swim_inst:JSON.stringify({'4시/월/1':'선생님'}),
    swim_mark:JSON.stringify({
      '4시/월/1/1/2026-08-03':{
        type:'absent',requiresDeskApproval:true,
        sub:{type:'bogang',n:'보강원생',p:'01033334444',mandatoryMakeup:true},
      },
    }),
  };
  const report=schema.diagnoseLegacyRoot('gagyeong',root);
  assert.equal(report.checks.ready,true);
  assert.equal(report.checks.legacyMarks,2);
  assert.equal(report.conversion.classMarks.length,2);
  const primary=report.conversion.classMarks.find(row=>row.layer==='primary');
  const secondary=report.conversion.classMarks.find(row=>row.layer==='secondary');
  assert.equal(primary.type,'absent');
  assert.equal(primary.personId,'stu_absent');
  assert.equal(primary.payload.sub,undefined);
  assert.equal(secondary.type,'bogang');
  assert.equal(secondary.name,'보강원생');
  assert.equal(secondary.payload.mandatoryMakeup,true);
  assert.equal(primary.legacyKey,secondary.legacyKey);
  assert.notEqual(primary.id,secondary.id);
});

test('a malformed legacy mark key blocks V2 parity instead of disappearing silently',()=>{
  const schema=loadSchema();
  const report=schema.diagnoseLegacyRoot('gagyeong',{
    swim_tab_list:JSON.stringify([{id:'regular',type:'regular'}]),
    swim_students:'[]',
    swim_mark:JSON.stringify({'broken-key':{type:'absent'}}),
  });
  assert.equal(report.checks.legacyMarks,1);
  assert.equal(report.checks.convertedMarks,0);
  assert.equal(report.checks.markCountMatches,false);
  assert.equal(report.checks.ready,false);
});

test('regular and vacation attendance become tab-scoped V2 records',()=>{
  const schema=loadSchema();
  const report=schema.diagnoseLegacyRoot('yongam',{
    swim_tab_list:JSON.stringify([
      {id:'regular',type:'regular'},
      {id:'summer',type:'bangteuk'},
    ]),
    swim_main_tab:JSON.stringify({tabId:'regular'}),
    swim_students:JSON.stringify([
      {sid:'stu_regular',n:'정규원생',p:'01011112222',t:'4시',d:'월',l:1,r:1},
    ]),
    swim_bt_summer_stu:JSON.stringify([
      {sid:'stu_vacation',n:'방특원생',p:'01033334444',t:'10시',d:'월',l:2,r:1},
    ]),
    swim_attendance:JSON.stringify({
      '4시/월/1/1/2026-08-03':{s:'present',at:'2026-08-03T07:00:00.000Z',by:'데스크'},
    }),
    swim_bt_attendance_summer:JSON.stringify({
      '10시/월/2/1/2026-08-03':{s:'absent',at:'2026-08-03T01:00:00.000Z'},
    }),
  });
  assert.equal(report.checks.ready,true);
  assert.equal(report.checks.legacyAttendanceRecords,2);
  assert.equal(report.conversion.attendanceRecords.length,2);
  const regular=report.conversion.attendanceRecords.find(row=>row.tabId==='regular');
  const vacation=report.conversion.attendanceRecords.find(row=>row.tabId==='summer');
  assert.equal(regular.personId,'stu_regular');
  assert.equal(regular.status,'present');
  assert.equal(regular.courseType,'regular');
  assert.equal(vacation.personId,'stu_vacation');
  assert.equal(vacation.status,'absent');
  assert.equal(vacation.courseType,'bangteuk');
});

test('attendance-only students are split into individual guest documents',()=>{
  const schema=loadSchema();
  const report=schema.diagnoseLegacyRoot('gagyeong',{
    swim_tab_list:JSON.stringify([{id:'regular',type:'regular'}]),
    swim_students:'[]',
    swim_att_guests:JSON.stringify({
      '4시/월/1/2026-08-03':[
        {gid:'g_1',n:'추가원생',a:9,slotKey:'4시/월/1/6',type:'bogang',s:'present'},
        {gid:'g_2',n:'현장원생',a:8,s:'absent'},
      ],
    }),
  });
  assert.equal(report.checks.ready,true);
  assert.equal(report.checks.legacyAttendanceGuests,2);
  assert.equal(report.conversion.attendanceGuests.length,2);
  const placed=report.conversion.attendanceGuests.find(row=>row.guestId==='g_1');
  const unplaced=report.conversion.attendanceGuests.find(row=>row.guestId==='g_2');
  assert.equal(placed.slotKey,'4시/월/1/6');
  assert.equal(placed.seat,6);
  assert.equal(placed.entryType,'bogang');
  assert.equal(unplaced.slotKey,'4시/월/1');
  assert.equal(unplaced.seat,0);
});

test('malformed attendance keys and guest lists block V2 parity',()=>{
  const schema=loadSchema();
  const report=schema.diagnoseLegacyRoot('gagyeong',{
    swim_tab_list:JSON.stringify([{id:'regular',type:'regular'}]),
    swim_students:'[]',
    swim_attendance:JSON.stringify({'broken-key':{s:'present'}}),
    swim_att_guests:JSON.stringify({'4시/월/1/2026-08-03':{gid:'not-a-list'}}),
  });
  assert.equal(report.checks.legacyAttendanceRecords,1);
  assert.equal(report.checks.convertedAttendanceRecords,0);
  assert.equal(report.checks.legacyAttendanceGuests,1);
  assert.equal(report.checks.convertedAttendanceGuests,0);
  assert.equal(report.checks.ready,false);
});

test('past attendance rosters and teachers split into date-scoped documents',()=>{
  const schema=loadSchema();
  const report=schema.diagnoseLegacyRoot('yongam',{
    swim_tab_list:JSON.stringify([
      {id:'regular',type:'regular'},
      {id:'summer',type:'bangteuk'},
    ]),
    swim_main_tab:JSON.stringify({tabId:'regular'}),
    swim_students:'[]',
    swim_bt_summer_stu:'[]',
    swim_day_snapshot:JSON.stringify({
      '2026-07-01':{
        date:'2026-07-01',
        students:[{sid:'old_regular',n:'과거정규',p:'01011112222',t:'4시',d:'수',l:1,r:1}],
        inst:{'4시/수/1':'정규선생님'},
      },
    }),
    swim_bt_day_snapshot_summer:JSON.stringify({
      '2026-07-20':{
        date:'2026-07-20',
        students:[{sid:'old_vacation',n:'과거방특',p:'01033334444',t:'10시',d:'월',l:2,r:1}],
        inst:{'10시/월/2':'방특선생님'},
      },
    }),
  });
  assert.equal(report.checks.ready,true);
  assert.equal(report.checks.legacyAttendanceSnapshots,2);
  assert.equal(report.conversion.attendanceSnapshots.length,2);
  assert.equal(report.conversion.attendanceSnapshotStudents.length,2);
  assert.equal(report.conversion.attendanceSnapshotTeachers.length,2);
  const vacation=report.conversion.attendanceSnapshots.find(row=>row.tabId==='summer');
  const vacationStudent=report.conversion.attendanceSnapshotStudents.find(row=>row.snapshotId===vacation.id);
  assert.equal(vacation.courseType,'bangteuk');
  assert.equal(vacationStudent.personId,'old_vacation');
  assert.equal(vacationStudent.payload.n,'과거방특');
});

test('new per-day snapshots override the same date in the legacy bundled map',()=>{
  const schema=loadSchema();
  const report=schema.diagnoseLegacyRoot('gagyeong',{
    swim_tab_list:JSON.stringify([{id:'regular',type:'regular'}]),
    swim_students:'[]',
    swim_day_snapshot:JSON.stringify({
      '2026-07-01':{date:'2026-07-01',students:[{n:'이전명단',t:'4시',d:'수',l:1,r:1}],inst:{}},
    }),
    'zz_swim_day_snapshot__regular__2026-07-01':JSON.stringify({
      date:'2026-07-01',students:[
        {n:'최종명단1',t:'4시',d:'수',l:1,r:1},
        {n:'최종명단2',t:'4시',d:'수',l:1,r:2},
      ],inst:{'4시/수/1':'선생님'},
    }),
  });
  assert.equal(report.checks.ready,true);
  assert.equal(report.conversion.attendanceSnapshots.length,1);
  assert.equal(report.conversion.attendanceSnapshotStudents.length,2);
  assert.deepEqual(new Set(report.conversion.attendanceSnapshotStudents.map(row=>row.name)),new Set(['최종명단1','최종명단2']));
});

test('an invalid past attendance snapshot blocks V2 parity',()=>{
  const schema=loadSchema();
  const report=schema.diagnoseLegacyRoot('gagyeong',{
    swim_tab_list:JSON.stringify([{id:'regular',type:'regular'}]),
    swim_students:'[]',
    swim_day_snapshot:JSON.stringify({
      '2026-07-01':{date:'2026-07-01',students:'not-an-array',inst:{}},
    }),
  });
  assert.equal(report.checks.legacyAttendanceSnapshots,1);
  assert.equal(report.checks.convertedAttendanceSnapshots,1);
  assert.equal(report.checks.legacyAttendanceSnapshotStudents,1);
  assert.equal(report.checks.convertedAttendanceSnapshotStudents,0);
  assert.equal(report.checks.ready,false);
});

test('calendar rules and timetable pointers become independent V2 documents',()=>{
  const schema=loadSchema();
  const report=schema.diagnoseLegacyRoot('yongam',{
    swim_tab_list:JSON.stringify([
      {id:'regular',type:'regular'},
      {id:'summer',type:'bangteuk'},
    ]),
    swim_main_tab:JSON.stringify({tabId:'regular',month:'2026-08'}),
    swim_parent_tab:JSON.stringify({tabId:'regular'}),
    swim_students:JSON.stringify([
      {sid:'stu_regular',n:'정규원생',t:'4시',d:'월',l:1,r:1},
    ]),
    swim_bt_summer_stu:JSON.stringify([
      {sid:'stu_vacation',n:'방특원생',t:'10시',d:'월',l:2,r:1},
    ]),
    swim_disabled:JSON.stringify({'4시/월/1/1':true}),
    swim_closed:JSON.stringify([
      {start:'2026-08-15',end:null,type:'의무보강',memo:'광복절'},
      {start:'2026-09-24',end:'2026-09-30',type:'휴관',memo:'추석'},
    ]),
    swim_periods:JSON.stringify([
      {month:8,start:'2026-08-03',end:'2026-08-29'},
      {month:9,start:'2026-08-31',end:'2026-10-02'},
    ]),
  });
  assert.equal(report.checks.ready,true);
  assert.equal(report.conversion.disabledSlots.length,1);
  assert.equal(report.conversion.disabledSlots[0].tabId,'regular');
  assert.equal(report.conversion.calendarClosures.length,2);
  assert.equal(report.conversion.calendarClosures[0].endDate,'2026-08-15');
  assert.equal(report.conversion.schedulePeriods.length,2);
  assert.equal(report.conversion.scheduleSettings.length,1);
  assert.equal(report.conversion.scheduleSettings[0].mainTabId,'regular');
  assert.equal(report.conversion.scheduleSettings[0].parentTabId,'regular');
});

test('missing calendar documents preserve the legacy effective defaults',()=>{
  const schema=loadSchema();
  const report=schema.diagnoseLegacyRoot('gagyeong',{
    swim_tab_list:JSON.stringify([{id:'regular',type:'regular'}]),
    swim_students:'[]',
  });
  assert.equal(report.checks.ready,true);
  assert.equal(report.conversion.calendarClosures.length,10);
  assert.equal(report.conversion.schedulePeriods.length,11);
  assert.ok(report.conversion.calendarClosures.some(row=>row.type==='의무보강'&&row.startDate==='2026-08-15'));
  assert.ok(report.conversion.schedulePeriods.some(row=>row.month===8&&row.startDate==='2026-08-03'));
});

test('a disabled slot shared by two tabs keeps an explicit legacy-global scope',()=>{
  const schema=loadSchema();
  const report=schema.diagnoseLegacyRoot('gagyeong',{
    swim_tab_list:JSON.stringify([
      {id:'regular',type:'regular'},
      {id:'summer',type:'bangteuk'},
    ]),
    swim_students:JSON.stringify([{sid:'regular_1',n:'정규',t:'10시',d:'월',l:1,r:1}]),
    swim_bt_summer_stu:JSON.stringify([{sid:'vacation_1',n:'방특',t:'10시',d:'월',l:1,r:1}]),
    swim_disabled:JSON.stringify({'10시/월/1/1':true}),
  });
  assert.equal(report.checks.ready,true);
  const disabled=report.conversion.disabledSlots[0];
  assert.equal(disabled.tabId,'');
  assert.equal(disabled.scope,'legacy-global');
  assert.deepEqual(new Set(disabled.candidateTabIds),new Set(['regular','summer']));
});

test('invalid persisted calendar rows block V2 parity',()=>{
  const schema=loadSchema();
  const report=schema.diagnoseLegacyRoot('gagyeong',{
    swim_tab_list:JSON.stringify([{id:'regular',type:'regular'}]),
    swim_students:'[]',
    swim_disabled:JSON.stringify({'not-a-slot':true}),
    swim_closed:JSON.stringify([{start:'invalid-date',type:'휴관'}]),
    swim_periods:JSON.stringify([{month:8,start:'invalid',end:'2026-08-31'}]),
  });
  assert.equal(report.checks.legacyDisabledSlots,1);
  assert.equal(report.checks.convertedDisabledSlots,0);
  assert.equal(report.checks.legacyCalendarClosures,1);
  assert.equal(report.checks.convertedCalendarClosures,0);
  assert.equal(report.checks.legacySchedulePeriods,1);
  assert.equal(report.checks.convertedSchedulePeriods,0);
  assert.equal(report.checks.ready,false);
});

test('an event with multiple possible vacation tabs blocks migration',()=>{
  const schema=loadSchema();
  const root={
    swim_tab_list:JSON.stringify([
      {id:'regular',type:'regular'},
      {id:'summer',type:'bangteuk'},
      {id:'winter',type:'bangteuk'},
    ]),
    swim_students:'[]',
    swim_bt_summer_stu:'[]',
    swim_bt_winter_stu:'[]',
    swim_retire:JSON.stringify({'10시/월수금/1/1':{name:'홍길동',bangteuk:true,ds:'2026-08-03'}}),
  };
  const report=schema.diagnoseLegacyRoot('gagyeong',root);
  assert.equal(report.checks.ready,false);
  assert.equal(report.blockingIssues[0].type,'ambiguous-tab-scope');
});

test('retirement history and desk records stay separate and preserve every row',()=>{
  const schema=loadSchema();
  const retirement={
    retiredAt:'2026-08-10',recordedAt:'2026-08-01T01:02:03.000Z',
    sid:'stu_1',n:'홍길동',p:'010-1234-5678',t:'4시',d:'월',l:2,r:3,
    inst:'김선생',loc:'학교 앞',memo:'상담 완료',
  };
  const desk={
    id:'desk_same',sourceKey:'regular|2026-08|retire-1',tabId:'regular',
    teacher:'김선생',student:'홍길동',change:'퇴원',date:'8/10',dateKey:'2026-08-10',
    time:'4시',day:'월',detail:'퇴원 예약',source:'visible-reservation',deleted:false,
    original:{teacher:'김선생',student:'홍길동',change:'퇴원',date:'8/10',time:'4시'},
  };
  const report=schema.diagnoseLegacyRoot('gagyeong',{
    swim_tab_list:JSON.stringify([{id:'regular',type:'regular'}]),
    swim_students:JSON.stringify([{sid:'stu_1',n:'홍길동',p:'01012345678',t:'4시',d:'월',l:2,r:3}]),
    swim_retire_history:JSON.stringify([retirement,retirement]),
    swim_desk_notes:JSON.stringify([desk,desk]),
  });
  assert.equal(report.checks.ready,true);
  assert.equal(report.conversion.retirementRecords.length,2);
  assert.equal(report.conversion.deskStudentRecords.length,2);
  assert.equal(new Set(report.conversion.retirementRecords.map(row=>row.id)).size,2);
  assert.equal(new Set(report.conversion.deskStudentRecords.map(row=>row.id)).size,2);
  assert.equal(report.conversion.retirementRecords[0].retirementDate,'2026-08-10');
  assert.equal(report.conversion.retirementRecords[0].recordedAt,'2026-08-01T01:02:03.000Z');
  assert.equal(report.conversion.retirementRecords[0].phone,'01012345678');
  assert.equal(report.conversion.deskStudentRecords[0].changeType,'퇴원');
  assert.equal(report.conversion.deskStudentRecords[0].original.change,'퇴원');
});

test('invalid history rows fail the one-to-one V2 safety check',()=>{
  const schema=loadSchema();
  const report=schema.diagnoseLegacyRoot('yongam',{
    swim_tab_list:JSON.stringify([{id:'regular',type:'regular'}]),
    swim_students:'[]',
    swim_retire_history:JSON.stringify([null]),
    swim_desk_notes:JSON.stringify(['broken']),
  });
  assert.equal(report.checks.legacyRetirementRecords,1);
  assert.equal(report.checks.convertedRetirementRecords,0);
  assert.equal(report.checks.legacyDeskStudentRecords,1);
  assert.equal(report.checks.convertedDeskStudentRecords,0);
  assert.equal(report.checks.ready,false);
});

test('malformed V1 arrays and maps block V2 instead of becoming empty data',()=>{
  const schema=loadSchema();
  const report=schema.diagnoseLegacyRoot('yongam',{
    swim_tab_list:JSON.stringify([{id:'regular',type:'regular'}]),
    swim_students:JSON.stringify({unexpected:true}),
    swim_inst:JSON.stringify(['not-a-teacher-map']),
    swim_reserve:JSON.stringify({'4시/월/1':{n:'대기원생'}}),
  });
  assert.equal(report.checks.ready,false);
  const types=new Set(report.blockingIssues.map(issue=>issue.type));
  assert.equal(types.has('invalid-student-list'),true);
  assert.equal(types.has('invalid-teacher-map'),true);
  assert.equal(types.has('invalid-waitlist-list'),true);
});

test('two no-phone rows with the same fallback identity require an explicit identity decision',()=>{
  const schema=loadSchema();
  const report=schema.diagnoseLegacyRoot('gagyeong',{
    swim_tab_list:JSON.stringify([{id:'regular',type:'regular'}]),
    swim_students:JSON.stringify([
      {n:'동명이인',a:9,g:'남',t:'4시',d:'월',l:1,r:1},
      {n:'동명이인',a:9,g:'남',t:'5시',d:'수',l:1,r:1},
    ]),
  });
  assert.equal(report.checks.ready,false);
  assert.ok(report.blockingIssues.some(issue=>issue.type==='ambiguous-fallback-identity'));
});

test('historical retirement uses its operating month instead of the current main tab',()=>{
  const schema=loadSchema();
  const report=schema.diagnoseLegacyRoot('yongam',{
    swim_tab_list:JSON.stringify([
      {id:'may',type:'regular',periodMonth:'2026-05'},
      {id:'july',type:'regular',periodMonth:'2026-07'},
    ]),
    swim_main_tab:JSON.stringify({tabId:'july'}),
    swim_stu_may:'[]',
    swim_stu_july:'[]',
    swim_periods:JSON.stringify([
      {month:5,start:'2026-05-06',end:'2026-06-02'},
      {month:7,start:'2026-07-06',end:'2026-08-01'},
    ]),
    swim_retire_history:JSON.stringify([{n:'과거원생',p:'01011112222',retiredAt:'2026-05-20'}]),
  });
  assert.equal(report.checks.ready,true);
  assert.equal(report.conversion.retirementRecords[0].tabId,'may');
});

test('mark schedule type selects vacation or regular scope explicitly',()=>{
  const schema=loadSchema();
  const report=schema.diagnoseLegacyRoot('gagyeong',{
    swim_tab_list:JSON.stringify([
      {id:'regular',type:'regular'},
      {id:'summer',type:'bangteuk',seasonStart:'2026-07-20',seasonEnd:'2026-08-07'},
    ]),
    swim_main_tab:JSON.stringify({tabId:'regular'}),
    swim_students:JSON.stringify([{sid:'regular_1',n:'정규',t:'10시',d:'월',l:1,r:1}]),
    swim_bt_summer_stu:JSON.stringify([{sid:'bt_1',n:'방특',t:'10시',d:'월',l:1,r:1}]),
    swim_mark:JSON.stringify({
      '10시/월/1/1/2026-07-20':{type:'bogang',studentScheduleType:'bangteuk',sid:'bt_1',n:'방특'},
    }),
  });
  assert.equal(report.checks.ready,true);
  assert.equal(report.conversion.classMarks[0].tabId,'summer');
  assert.equal(report.conversion.classMarks[0].courseType,'bangteuk');
});

test('teachers folders and migration metadata receive dedicated V2 documents',()=>{
  const schema=loadSchema();
  const report=schema.diagnoseLegacyRoot('gagyeong',{
    swim_tab_list:JSON.stringify([{id:'regular',type:'regular'}]),
    swim_students:'[]',
    swim_teachers:JSON.stringify([{n:'손용곤',color:'#123456'},'유정희']),
    swim_tab_folders:JSON.stringify(['과거 시간표']),
    swim_archived_tabs:JSON.stringify([{id:'regular',name:'5월출석부',type:'regular',periodMonth:'2026-05',stuKey:'swim_students',instKey:'swim_inst'}]),
    swim_age_year:JSON.stringify(2026),
    swim_student_id_version:JSON.stringify('v3'),
    swim_ver:JSON.stringify(2222),
  });
  assert.equal(report.checks.ready,true);
  assert.equal(report.conversion.teacherProfiles.length,2);
  assert.equal(report.conversion.tabFolders.length,1);
  assert.equal(report.conversion.archivedTabs.length,1);
  assert.equal(report.conversion.archivedTabs[0].periodMonth,'2026-05');
  assert.equal(report.conversion.systemMetadata.length,3);
});

test('editing history memo keeps the same V2 record id',()=>{
  const schema=loadSchema();
  const root=memo=>({
    swim_tab_list:JSON.stringify([{id:'regular',type:'regular'}]),
    swim_students:'[]',
    swim_retire_history:JSON.stringify([{
      n:'홍길동',p:'01012345678',t:'4시',d:'월',l:1,r:1,
      retiredAt:'2026-08-10',recordedAt:'2026-08-01T01:00:00.000Z',memo,
    }]),
  });
  const before=schema.diagnoseLegacyRoot('gagyeong',root('이전 메모'));
  const after=schema.diagnoseLegacyRoot('gagyeong',root('수정 메모'));
  assert.equal(before.conversion.retirementRecords[0].id,after.conversion.retirementRecords[0].id);
});
