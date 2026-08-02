const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function loadStore(){
  const context={window:{},console,Date};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','js','schedule-v2-store.js'),'utf8'),context);
  return context.window.SCScheduleV2Store;
}

test('generation documents are separated by maintenance responsibility',()=>{
  const store=loadStore();
  const docs=store.generationDocuments({conversion:{
    tabs:[{id:'regular'}],
    people:[{id:'stu_1',name:'홍길동'}],
    enrollments:[{id:'enr_1',personId:'stu_1'}],
    placements:[{id:'plc_1',personId:'stu_1',transport:{location:'학교'}}],
    teacherAssignments:[{id:'asg_1',teacherName:'선생님'}],
  }});
  assert.deepEqual(JSON.parse(JSON.stringify(docs.map(item=>item.collection))),[
    'tabs','people','enrollments','placements','teacherAssignments'
  ]);
  const person=docs.find(item=>item.collection==='people').value;
  assert.equal(person.transport,undefined);
});

test('unsafe document ids are encoded deterministically',()=>{
  const store=loadStore();
  assert.equal(store.safeDocId('월/4시/1'),encodeURIComponent('월/4시/1'));
  assert.equal(store.safeDocId('월/4시/1'),store.safeDocId('월/4시/1'));
});

test('verification counts include reservations, marks, and attendance documents',()=>{
  const store=loadStore();
  const counts=store.expectedCounts({conversion:{
    reservations:[{id:'res_1'},{id:'res_2'}],
    waitlistEntries:[{id:'wait_1'}],
    classMarks:[{id:'mark_1'},{id:'mark_2'}],
    attendanceRecords:[{id:'att_1'}],
    attendanceGuests:[{id:'guest_1'},{id:'guest_2'}],
    attendanceSnapshots:[{id:'ats_1'}],
    attendanceSnapshotStudents:[{id:'atstu_1'}],
    attendanceSnapshotTeachers:[{id:'atinst_1'}],
    disabledSlots:[{id:'disabled_1'}],
    calendarClosures:[{id:'closed_1'}],
    schedulePeriods:[{id:'period_1'}],
    scheduleSettings:[{id:'branch_schedule_settings'}],
    retirementRecords:[{id:'retrec_1'},{id:'retrec_2'}],
    deskStudentRecords:[{id:'deskrec_1'}],
  }});
  assert.equal(counts.reservations,2);
  assert.equal(counts.waitlistEntries,1);
  assert.equal(counts.classMarks,2);
  assert.equal(counts.attendanceRecords,1);
  assert.equal(counts.attendanceGuests,2);
  assert.equal(counts.attendanceSnapshots,1);
  assert.equal(counts.attendanceSnapshotStudents,1);
  assert.equal(counts.attendanceSnapshotTeachers,1);
  assert.equal(counts.disabledSlots,1);
  assert.equal(counts.calendarClosures,1);
  assert.equal(counts.schedulePeriods,1);
  assert.equal(counts.scheduleSettings,1);
  assert.equal(counts.retirementRecords,2);
  assert.equal(counts.deskStudentRecords,1);
  assert.equal(counts.teacherProfiles,0);
  assert.equal(counts.tabFolders,0);
  assert.equal(counts.archivedTabs,0);
  assert.equal(counts.systemMetadata,0);
  assert.deepEqual(Object.keys(counts).sort(),Array.from(store.COLLECTIONS).sort());
});

test('preview selects only the newest verified generation',()=>{
  const store=loadStore();
  const selected=store.latestReadyFromRows([
    {id:'gen_3',status:'failed',createdAt:'2026-08-01T03:00:00.000Z'},
    {id:'gen_1',status:'ready',createdAt:'2026-08-01T01:00:00.000Z'},
    {id:'gen_2',status:'ready',createdAt:'2026-08-01T02:00:00.000Z'},
  ]);
  assert.equal(selected.id,'gen_2');
});

test('shadow operation keeps using the newest ready or shadow generation',()=>{
  const store=loadStore();
  const selected=store.latestUsableFromRows([
    {id:'gen_1',status:'ready',createdAt:'2026-08-01T01:00:00.000Z'},
    {id:'gen_2',status:'shadow',createdAt:'2026-08-01T02:00:00.000Z'},
    {id:'gen_3',status:'failed',createdAt:'2026-08-01T03:00:00.000Z'},
  ]);
  assert.equal(selected.id,'gen_2');
});

test('shadow comparison ignores object key order but detects field changes',()=>{
  const store=loadStore();
  assert.equal(store.sameDocument({name:'홍길동',transport:{use:true,loc:'학교'}},{transport:{loc:'학교',use:true},name:'홍길동'}),true);
  assert.equal(store.sameDocument({name:'홍길동'},{name:'김길동'}),false);
});

test('shadow sync can compare against the previous in-memory report without a collection read',async()=>{
  const store=loadStore();
  let collectionReads=0;
  const commits=[];
  const generationRef={
    collection(){return {
      get(){collectionReads+=1;return Promise.resolve({forEach(){}});},
      doc(id){return {id};},
    };},
    set(){return Promise.resolve();},
  };
  const db={
    collection(){return {doc(){return {collection(){return {doc(){return generationRef;}};}};}};},
    batch(){
      const ops=[];
      return {set(ref,value){ops.push(['set',ref.id,value]);},delete(ref){ops.push(['delete',ref.id]);},commit(){commits.push(ops);return Promise.resolve();}};
    },
  };
  const previous={checks:{ready:true},conversion:{people:[{id:'stu_1',name:'가'}]}};
  const next={checks:{ready:true},conversion:{people:[{id:'stu_1',name:'나'}]}};
  const result=await store.syncShadowGeneration(db,'yongam','gen_1',next,{collections:['people'],previousReport:previous});
  assert.equal(collectionReads,0);
  assert.equal(result.writes,1);
  assert.equal(commits.length,1);
});

test('one changed attendance date updates only that snapshot scope',async()=>{
  const store=loadStore();
  const existing={
    attendanceSnapshots:{ats_1:{id:'ats_1',snapshotId:'ats_1',studentCount:2}},
    attendanceSnapshotStudents:{
      stale:{id:'stale',snapshotId:'ats_1',name:'삭제대상'},
      other:{id:'other',snapshotId:'ats_other',name:'다른날짜'},
    },
    attendanceSnapshotTeachers:{},
  };
  const operations=[];
  const generationRef={
    collection(name){
      return {
        doc(id){return {
          id,
          get(){
            const value=existing[name]?.[id];
            return Promise.resolve({id,exists:!!value,data(){return value;}});
          },
        };},
        where(field,op,value){return {get(){
          const rows=Object.entries(existing[name]||{}).filter(([,row])=>row[field]===value);
          return Promise.resolve({forEach(fn){rows.forEach(([id,row])=>fn({id,data(){return row;}}));}});
        }};},
      };
    },
    set(){return Promise.resolve();},
  };
  const db={
    collection(){return {doc(){return {collection(){return {doc(){return generationRef;}};}};}};},
    batch(){return {
      set(ref,value){operations.push(['set',ref.id,value]);},
      delete(ref){operations.push(['delete',ref.id]);},
      commit(){return Promise.resolve();},
    };},
  };
  const report={checks:{ready:true},conversion:{
    attendanceSnapshots:[{id:'ats_1',tabId:'regular',date:'2026-08-01',studentCount:1}],
    attendanceSnapshotStudents:[{id:'student_new',snapshotId:'ats_1',tabId:'regular',date:'2026-08-01',name:'현재명단'}],
    attendanceSnapshotTeachers:[],
  }};
  const result=await store.syncShadowSnapshotScopes(db,'yongam','gen_1',report,[
    {snapshotId:'ats_1',tabId:'regular',date:'2026-08-01'},
  ]);
  assert.equal(result.scopes,1);
  assert.ok(operations.some(row=>row[0]==='delete'&&row[1]==='stale'));
  assert.ok(operations.some(row=>row[0]==='set'&&row[1]==='student_new'));
  assert.equal(operations.some(row=>row[1]==='other'),false);
});

test('preview reader source contains no write operation',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','js','schedule-v2-store.js'),'utf8');
  const start=source.indexOf('async function readGenerationTab(');
  const end=source.indexOf('function canonicalValue',start);
  const section=source.slice(start,end);
  assert.ok(start>=0,'preview reader missing');
  assert.doesNotMatch(section,/\.set\s*\(/);
  assert.doesNotMatch(section,/\.update\s*\(/);
  assert.doesNotMatch(section,/\.delete\s*\(/);
  assert.doesNotMatch(section,/\.commit\s*\(/);
});

test('a blocking diagnostic is rejected before Firestore access',async()=>{
  const store=loadStore();
  let accessed=false;
  const db={collection(){accessed=true;throw new Error('must not access');}};
  await assert.rejects(()=>store.writeGeneration(db,'yongam',{checks:{ready:false}}),/진단을 통과/);
  assert.equal(accessed,false);
});

test('generation verification detects changed content even when document counts match',async()=>{
  const store=loadStore();
  const generationId='gen_content';
  const branchId='yongam';
  const report={conversion:{people:[{id:'stu_1',name:'홍길동'}]}};
  const docs=store.generationDocuments(report);
  const expected=store.expectedCounts(report);
  const rows={people:{stu_1:{id:'stu_1',name:'다른이름',generationId,branchId}}};
  const generationRef={collection(name){return {get(){
    const entries=Object.entries(rows[name]||{});
    return Promise.resolve({size:entries.length,forEach(fn){
      entries.forEach(([id,value])=>fn({id,data(){return value;}}));
    }});
  }};}};
  const db={
    collection(){return {
      doc(){return {
        collection(){return {doc(){return generationRef;}};},
      };},
    };},
  };
  const verification=await store.verifyGeneration(db,branchId,generationId,expected,docs);
  assert.equal(verification.countMatches,true);
  assert.equal(verification.contentMatches,false);
  assert.equal(verification.matches,false);
  assert.deepEqual(Array.from(verification.mismatchedCollections),['people']);
});
