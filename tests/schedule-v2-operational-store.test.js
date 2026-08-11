const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');

require(path.join(__dirname,'..','js','schedule-v2-operational-model.js'));
const model=globalThis.SCV2OperationalModel;
const storeApi=require(path.join(__dirname,'..','js','schedule-v2-operational-store.js'));
const gatewayApi=require(path.join(__dirname,'..','js','schedule-operational-gateway.js'));

function plain(value){ return JSON.parse(JSON.stringify(value)); }
function deferred(){
  let resolve,reject;
  const promise=new Promise((yes,no)=>{ resolve=yes;reject=no; });
  return {promise,resolve,reject};
}

function snapshot(rows){
  const docs=(rows||[]).map(row=>({
    id:String(row.id),
    exists:true,
    data:()=>plain(row),
  }));
  return {
    docs,
    size:docs.length,
    forEach(callback){ docs.forEach(callback); },
  };
}

function createFirestore(input={}){
  const rows=plain(input.collections||{});
  const runtime=plain(input.runtime||{
    branchId:'yongam',mode:'v2-read',generationId:'gen_1',epoch:4,revision:31,
  });
  const shadowStates=(input.shadowStates||[{status:'idle',requestedRevision:0,appliedRevision:0,pendingKeys:[],inFlightKeys:[],mismatchCount:0}]).map(plain);
  const queriedCollections=new Set();
  const documentReads={people:[],enrollments:[],tabs:[]};
  const readConcurrency={people:0,enrollments:0};
  const maxReadConcurrency={people:0,enrollments:0};
  const queryGates=input.queryGates||{};
  let genericGenerationReads=0;
  let runtimeListener=null;
  let shadowReads=0;

  function matches(row,filters){
    return filters.every(({field,op,value})=>{
      const actual=row[field];
      if(op==='==') return actual===value;
      if(op==='in') return Array.isArray(value)&&value.includes(actual);
      if(op==='>=') return actual>=value;
      if(op==='<=') return actual<=value;
      throw new Error(`unsupported fake query operator ${op}`);
    });
  }
  function collectionRef(name){
    const filters=[];
    const api={
      where(field,op,value){
        filters.push({field,op,value:plain(value)});
        return api;
      },
      async get(){
        queriedCollections.add(name);
        const gateKey=`${name}:${filters.map(item=>`${item.field}:${item.op}:${JSON.stringify(item.value)}`).join('|')}`;
        if(queryGates[gateKey]) await queryGates[gateKey].promise;
        return snapshot((rows[name]||[]).filter(row=>matches(row,filters)));
      },
      doc(id){
        return {
          async get(){
            queriedCollections.add(name);
            if(documentReads[name]) documentReads[name].push(String(id));
            if(Object.prototype.hasOwnProperty.call(readConcurrency,name)){
              readConcurrency[name]+=1;
              maxReadConcurrency[name]=Math.max(maxReadConcurrency[name],readConcurrency[name]);
              await new Promise(resolve=>setImmediate(resolve));
              readConcurrency[name]-=1;
            }
            const row=(rows[name]||[]).find(item=>String(item.id)===String(id));
            return row
              ?{id:String(id),exists:true,data:()=>plain(row)}
              :{id:String(id),exists:false,data:()=>undefined};
          },
        };
      },
    };
    return api;
  }
  const generationRef={
    collection:name=>collectionRef(name),
    async get(){ genericGenerationReads+=1;return snapshot([]); },
  };
  const runtimeRef={
    async get(){ return {id:'operational',exists:true,data:()=>plain(runtime)}; },
    onSnapshot(next){
      runtimeListener=next;
      next({id:'operational',exists:true,data:()=>plain(runtime)});
      return ()=>{ runtimeListener=null; };
    },
  };
  const shadowRef={
    async get(){
      if(typeof input.onShadowRead==='function') input.onShadowRead(shadowReads+1,rows);
      const state=shadowStates[Math.min(shadowReads,shadowStates.length-1)];
      shadowReads+=1;
      return {id:'scheduleSync',exists:true,data:()=>plain(state)};
    },
  };
  const branchRef={
    collection(name){
      if(name==='runtime') return {doc:id=>id==='scheduleSync'?shadowRef:runtimeRef};
      if(name==='generations') return {doc:()=>generationRef};
      throw new Error(`unexpected branch collection ${name}`);
    },
  };
  const db={
    collection(name){
      assert.equal(name,'scheduleV2');
      return {doc:()=>branchRef};
    },
  };
  return {
    db,
    queriedCollections,
    documentReads,
    maxReadConcurrency,
    get shadowReads(){ return shadowReads; },
    get genericGenerationReads(){ return genericGenerationReads; },
    emitRuntime(next){
      Object.keys(runtime).forEach(key=>delete runtime[key]);
      Object.assign(runtime,plain(next));
      runtimeListener?.({id:'operational',exists:true,data:()=>plain(runtime)});
    },
  };
}

function selectedFixture(){
  const collections={
    tabs:[
      {id:'regular',type:'regular',name:'정규반',order:0},
      {id:'camp',type:'bangteuk',name:'방학특강',order:1},
    ],
    placements:[],people:[],enrollments:[],teacherAssignments:[],
    reservations:[
      {id:'r_regular',tabId:'regular',type:'enroll',slotKey:'월-1',payload:{state:'regular-waiting'}},
      {id:'r_camp',tabId:'camp',type:'enroll',slotKey:'화-1',payload:{state:'camp-waiting'}},
    ],
    waitlistEntries:[{id:'w_regular',tabId:'regular',instKey:'월-1',order:0,payload:{state:'waiting'}}],
    classMarks:[
      {id:'m_regular',tabId:'regular',legacyKey:'regular-mark',layer:'primary',payload:{color:'blue'}},
      {id:'m_camp',tabId:'camp',legacyKey:'camp-mark',layer:'primary',payload:{color:'red'}},
    ],
    attendanceRecords:[
      {id:'a_regular',tabId:'regular',courseType:'regular',date:'2026-08-11',personId:'p_0',enrollmentId:'e_0',legacyKey:'att-1',payload:{state:'present'}},
      {id:'a_regular_b',tabId:'regular',courseType:'regular',date:'2026-08-12',personId:'p_1',enrollmentId:'e_1',legacyKey:'att-2',payload:{state:'late'}},
    ],
    attendanceGuests:[
      {id:'g_regular',tabId:'regular',courseType:'regular',date:'2026-08-11',legacyKey:'guest-1',order:0,payload:{name:'게스트'}},
      {id:'g_regular_b',tabId:'regular',courseType:'regular',date:'2026-08-12',legacyKey:'guest-2',order:0,payload:{name:'다음 날 게스트'}},
    ],
    attendanceSnapshots:[
      {id:'snap_regular',tabId:'regular',courseType:'regular',date:'2026-08-11',createdAt:'2026-08-11T01:00:00.000Z'},
      {id:'snap_regular_b',tabId:'regular',courseType:'regular',date:'2026-08-12',createdAt:'2026-08-12T01:00:00.000Z'},
    ],
    attendanceSnapshotStudents:[
      {id:'snap_student',snapshotId:'snap_regular',tabId:'regular',courseType:'regular',date:'2026-08-11',order:0,payload:{name:'기록 원생'}},
      {id:'snap_student_b',snapshotId:'snap_regular_b',tabId:'regular',courseType:'regular',date:'2026-08-12',order:0,payload:{name:'다음 날 원생'}},
    ],
    attendanceSnapshotTeachers:[
      {id:'snap_teacher',snapshotId:'snap_regular',tabId:'regular',courseType:'regular',date:'2026-08-11',slotKey:'월-1',payload:'김강사'},
      {id:'snap_teacher_b',snapshotId:'snap_regular_b',tabId:'regular',courseType:'regular',date:'2026-08-12',slotKey:'화-1',payload:'이강사'},
    ],
    disabledSlots:[
      {id:'d_regular',legacyKey:'regular-disabled',tabId:'regular',payload:{disabled:true}},
      {id:'d_camp',legacyKey:'camp-disabled',tabId:'camp',payload:{disabled:true}},
    ],
    retirementRecords:[{id:'h_regular',tabId:'regular',order:0,payload:{reason:'done'}}],
  };
  for(let index=0;index<35;index+=1){
    const personId=`p_${index}`;
    const enrollmentId=`e_${index}`;
    collections.people.push({id:personId,name:`선택-${index}`,phone:`010-${index}`});
    collections.enrollments.push({id:enrollmentId,personId,tabId:'regular',courseType:'regular'});
    collections.placements.push({
      id:`pl_${index}`,tabId:'regular',personId,enrollmentId,slotKey:`slot-${index}`,
      source:{id:`student-${index}`,name:`선택-${index}`},
    });
  }
  collections.people.push({id:'p_unrelated',name:'다른 탭',phone:'010-secret'});
  collections.enrollments.push({id:'e_unrelated',personId:'p_unrelated',tabId:'camp',courseType:'bangteuk'});
  collections.placements.push({
    id:'pl_unrelated',tabId:'camp',personId:'p_unrelated',enrollmentId:'e_unrelated',
    slotKey:'camp-slot',source:{id:'unrelated',name:'다른 탭'},
  });
  collections.teacherAssignments.push({id:'t_regular',tabId:'regular',slotKey:'월-1',teacherName:'김강사'});
  collections.teacherAssignments.push({id:'t_camp',tabId:'camp',slotKey:'화-1',teacherName:'이강사'});
  return collections;
}

test('runtime config rejects branch mismatches and incomplete V2 pointers',async()=>{
  const wrong=createFirestore({runtime:{
    branchId:'gagyeong',mode:'v2-read',generationId:'gen_1',epoch:4,revision:31,
  }});
  const missing=createFirestore({runtime:{
    branchId:'yongam',mode:'v2',generationId:'',epoch:4,revision:31,
  }});

  await assert.rejects(
    storeApi.create({db:wrong.db,branchId:'yongam',model}).readConfig(),
    error=>error.code==='invalid-operational-config',
  );
  await assert.rejects(
    storeApi.create({db:missing.db,branchId:'yongam',model}).readConfig(),
    error=>error.code==='invalid-operational-config',
  );
});

test('selected roster and workflow reads exclude unrelated domains and placement references',async()=>{
  const firestore=createFirestore({collections:selectedFixture()});
  const store=storeApi.create({db:firestore.db,branchId:'yongam',model});
  const result=await store.loadSelection({tabIds:['regular'],domains:['roster','workflow']});

  assert.deepEqual([...firestore.queriedCollections].sort(),[
    'classMarks','enrollments','people','placements','reservations',
    'tabs','teacherAssignments','waitlistEntries',
  ]);
  assert.equal(firestore.genericGenerationReads,0);
  assert.equal(result.collections.placements.length,35);
  assert.equal(JSON.parse(result.root.swim_students).length,35);
  assert.equal(firestore.documentReads.people.includes('p_unrelated'),false);
  assert.equal(firestore.documentReads.enrollments.includes('e_unrelated'),false);
  assert.ok(firestore.maxReadConcurrency.people<=30);
  assert.ok(firestore.maxReadConcurrency.enrollments<=30);
});

test('selected V2 rows rebuild the stable legacy root through the operational model',async()=>{
  const firestore=createFirestore({collections:selectedFixture()});
  const store=storeApi.create({db:firestore.db,branchId:'yongam',model});
  const loaded=await store.loadSelection({tabIds:['regular'],domains:['roster','workflow']});
  const direct=model.legacyRootFromCollections({
    branchId:'yongam',generationId:'gen_1',collections:loaded.collections,
  });

  Object.keys(loaded.root).forEach(key=>assert.equal(loaded.root[key],direct[key],key));
  assert.equal(Object.prototype.hasOwnProperty.call(loaded.root,'swim_attendance'),false);
  assert.equal(Object.prototype.hasOwnProperty.call(loaded.root,'swim_retire_history'),false);
  assert.equal(loaded.context.branchId,'yongam');
  assert.equal(loaded.context.generationId,'gen_1');
  assert.equal(loaded.context.epoch,4);
  assert.equal(loaded.context.revision,31);
});

test('roster-only reads return no manufactured values for unread domains',async()=>{
  const firestore=createFirestore({collections:selectedFixture()});
  const store=storeApi.create({db:firestore.db,branchId:'yongam',model});
  const loaded=await store.loadSelection({tabIds:['regular'],domains:['roster']});

  assert.deepEqual(Object.keys(loaded.collections).sort(),[
    'enrollments','people','placements','tabs','teacherAssignments',
  ]);
  assert.deepEqual(Object.keys(loaded.root).sort(),['swim_inst','swim_students','swim_tab_list']);
  for(const key of ['swim_mark','swim_enroll','swim_attendance','swim_disabled','swim_teachers','swim_retire_history']){
    assert.equal(Object.prototype.hasOwnProperty.call(loaded.root,key),false,key);
  }
});

test('attendance-only reads use selected tab metadata without widening person or enrollment reads',async()=>{
  const firestore=createFirestore({collections:selectedFixture()});
  const store=storeApi.create({db:firestore.db,branchId:'yongam',model});
  const loaded=await store.loadSelection({
    tabIds:['regular'],domains:['attendance'],dateRange:{dates:['2026-08-11']},
  });

  assert.deepEqual([...firestore.queriedCollections].sort(),[
    'attendanceGuests','attendanceRecords','attendanceSnapshotStudents',
    'attendanceSnapshotTeachers','attendanceSnapshots','tabs',
  ]);
  assert.deepEqual(firestore.documentReads.people,[]);
  assert.deepEqual(firestore.documentReads.enrollments,[]);
  assert.deepEqual(Object.keys(loaded.root).sort(),[
    'swim_att_guests','swim_attendance','swim_day_snapshot',
  ]);
  assert.equal(JSON.parse(loaded.root.swim_attendance)['att-1'].state,'present');
  assert.equal(JSON.parse(loaded.root.swim_att_guests)['guest-1'][0].name,'게스트');
  assert.equal(JSON.parse(loaded.root.swim_day_snapshot)['2026-08-11'].students[0].name,'기록 원생');
});

test('bundled attendance mutation ignores a display date range and preserves every backing date in the callable payload',async()=>{
  const firestore=createFirestore({collections:selectedFixture()});
  const store=storeApi.create({db:firestore.db,branchId:'yongam',model});
  const requests=[];
  const legacyRoot={
    async once(){ return {val:()=>({})}; },
    async transactionKeys(){ throw new Error('V1 write is not expected'); },
  };
  const gateway=gatewayApi.create({
    branchId:'yongam',legacyRoot,v2Store:store,model,makeOperationId:()=> 'attendance_op_1',
    async mutate(request){
      requests.push(plain(request));
      return {operationId:request.operationId,committed:true,revision:request.beforeRevision+1,recoveryState:'applied'};
    },
  });

  await gateway.transactionKeys(
    ['swim_attendance','swim_att_guests','swim_day_snapshot'],
    draft=>{
      const records=JSON.parse(draft.swim_attendance);
      records['att-1'].state='edited';
      draft.swim_attendance=JSON.stringify(records);
      const guests=JSON.parse(draft.swim_att_guests);
      guests['guest-1'][0].name='수정 게스트';
      draft.swim_att_guests=JSON.stringify(guests);
      const snapshots=JSON.parse(draft.swim_day_snapshot);
      snapshots['2026-08-11'].students[0].name='수정 원생';
      draft.swim_day_snapshot=JSON.stringify(snapshots);
      return draft;
    },
    {operationType:'edit-attendance',tabIds:['regular'],dateRange:{dates:['2026-08-11']}},
  );

  assert.equal(requests.length,1);
  const next=requests[0].nextValues;
  assert.equal(JSON.parse(next.swim_attendance)['att-2'].state,'late');
  assert.equal(JSON.parse(next.swim_att_guests)['guest-2'][0].name,'다음 날 게스트');
  assert.equal(JSON.parse(next.swim_day_snapshot)['2026-08-12'].students[0].name,'다음 날 원생');
  gateway.dispose();
});

test('an explicit daily snapshot mutation scopes itself to the date embedded in its key',async()=>{
  const firestore=createFirestore({collections:selectedFixture()});
  const store=storeApi.create({db:firestore.db,branchId:'yongam',model});
  const key='zz_swim_day_snapshot__regular__2026-08-11';
  const loaded=await store.loadMutation({
    tabIds:['regular'],keys:[key],dateRange:{dates:['2026-08-12']},
  });

  assert.equal(JSON.parse(loaded.root[key]).students[0].name,'기록 원생');
  assert.deepEqual(loaded.collections.attendanceSnapshots.map(row=>row.date),['2026-08-11']);
  assert.deepEqual(loaded.collections.attendanceSnapshotStudents.map(row=>row.date),['2026-08-11']);
});

test('mutation loads complete shared values while keeping tab-owned roster values scoped',async()=>{
  const firestore=createFirestore({collections:selectedFixture()});
  const store=storeApi.create({db:firestore.db,branchId:'yongam',model});
  const loaded=await store.loadMutation({
    tabIds:['regular'],
    keys:['swim_mark','swim_enroll','swim_tab_list','swim_students','swim_disabled'],
  });

  assert.deepEqual(Object.keys(loaded.root).sort(),[
    'swim_disabled','swim_enroll','swim_mark','swim_students','swim_tab_list',
  ]);
  assert.deepEqual(Object.keys(JSON.parse(loaded.root.swim_mark)).sort(),['camp-mark','regular-mark']);
  assert.deepEqual(Object.keys(JSON.parse(loaded.root.swim_enroll)).sort(),['월-1','화-1']);
  assert.equal(JSON.parse(loaded.root.swim_tab_list).length,2);
  assert.equal(JSON.parse(loaded.root.swim_students).length,35);
  assert.equal(Object.prototype.hasOwnProperty.call(loaded.root,'swim_bt_camp_stu'),false);
  assert.deepEqual(Object.keys(JSON.parse(loaded.root.swim_disabled)).sort(),['camp-disabled','regular-disabled']);
  assert.equal(firestore.documentReads.people.includes('p_unrelated'),false);
  assert.equal(firestore.documentReads.enrollments.includes('e_unrelated'),false);
});

test('verify parity compares legacy JSON values canonically',async()=>{
  const collections=selectedFixture();
  collections.classMarks.push({
    id:'m_regular_2',tabId:'regular',legacyKey:'월-2',layer:'primary',payload:{color:'red',label:'두 번째'},
  });
  const firestore=createFirestore({
    runtime:{branchId:'yongam',mode:'verify',generationId:'gen_1',epoch:4,revision:31},
    collections,
  });
  const store=storeApi.create({db:firestore.db,branchId:'yongam',model});

  const result=await store.verifyParity({
    selection:{tabIds:['regular'],domains:['workflow']},
    values:{swim_mark:JSON.stringify({
      '월-2':{label:'두 번째',color:'red'},
      'regular-mark':{color:'blue'},
      'camp-mark':{color:'red'},
    })},
    keys:['swim_mark'],
  });

  assert.equal(result.matches,true);
  assert.equal(result.keyCount,1);
});

test('selected parity is not rejected by an unrelated global shadow mismatch count',async()=>{
  const firestore=createFirestore({
    runtime:{branchId:'yongam',mode:'verify',generationId:'gen_1',epoch:4,revision:31},
    shadowStates:[{status:'idle',requestedRevision:8,appliedRevision:8,pendingKeys:[],inFlightKeys:[],mismatchCount:3}],
    collections:selectedFixture(),
  });
  const store=storeApi.create({db:firestore.db,branchId:'yongam',model});

  const result=await store.verifyParity({
    selection:{tabIds:['regular'],domains:['workflow'],keys:['swim_mark']},
    values:{swim_mark:JSON.stringify({'regular-mark':{color:'blue'},'camp-mark':{color:'red'}})},
    keys:['swim_mark'],
  });

  assert.equal(result.matches,true);
});

test('verify parity waits for delayed shadow completion before comparing selected keys',async()=>{
  const collections=selectedFixture();
  const firestore=createFirestore({
    runtime:{branchId:'yongam',mode:'verify',generationId:'gen_1',epoch:4,revision:31},
    shadowStates:[
      {status:'pending',requestedRevision:8,appliedRevision:7,pendingKeys:['swim_mark'],inFlightKeys:[],mismatchCount:0},
      {status:'idle',requestedRevision:8,appliedRevision:8,pendingKeys:[],inFlightKeys:[],mismatchCount:0},
    ],
    collections,
  });
  const store=storeApi.create({
    db:firestore.db,branchId:'yongam',model,verifyPollMs:1,verifyTimeoutMs:10,sleep:async()=>{},
  });
  const values={swim_mark:JSON.stringify({'regular-mark':{color:'blue'},'camp-mark':{color:'red'}})};

  const result=await store.verifyParity({
    selection:{tabIds:['regular'],domains:['workflow'],keys:['swim_mark']},values,keys:['swim_mark'],
  });

  assert.equal(result.matches,true);
  assert.ok(firestore.shadowReads>=2);
});

test('an unrelated settled shadow revision cannot cause a premature mismatch before selected parity arrives',async()=>{
  const collections=selectedFixture();
  const firestore=createFirestore({
    runtime:{branchId:'yongam',mode:'verify',generationId:'gen_1',epoch:4,revision:31},
    shadowStates:[
      {status:'idle',requestedRevision:9,appliedRevision:9,pendingKeys:[],inFlightKeys:[],mismatchCount:0},
      {status:'pending',requestedRevision:10,appliedRevision:9,pendingKeys:['swim_mark'],inFlightKeys:[],mismatchCount:0},
      {status:'idle',requestedRevision:10,appliedRevision:10,pendingKeys:[],inFlightKeys:[],mismatchCount:0},
    ],
    collections,
    onShadowRead(read,rows){
      if(read===3) rows.classMarks.find(row=>row.id==='m_regular').payload.color='green';
    },
  });
  const store=storeApi.create({
    db:firestore.db,branchId:'yongam',model,verifyPollMs:1,verifyTimeoutMs:20,sleep:()=>new Promise(resolve=>setImmediate(resolve)),
  });

  const result=await store.verifyParity({
    selection:{tabIds:['regular'],domains:['workflow'],keys:['swim_mark']},
    values:{swim_mark:JSON.stringify({'regular-mark':{color:'green'},'camp-mark':{color:'red'}})},
    keys:['swim_mark'],afterShadowRevision:8,requireShadowAdvance:true,
  });

  assert.equal(result.matches,true);
  assert.ok(firestore.shadowReads>=3);
});

test('verify parity succeeds when the expected selected values appear after delayed shadow work',async()=>{
  const firestore=createFirestore({
    runtime:{branchId:'yongam',mode:'verify',generationId:'gen_1',epoch:4,revision:31},
    shadowStates:[
      {status:'pending',requestedRevision:9,appliedRevision:8,pendingKeys:['swim_mark'],inFlightKeys:[],mismatchCount:0},
      {status:'idle',requestedRevision:9,appliedRevision:9,pendingKeys:[],inFlightKeys:[],mismatchCount:0},
    ],
    collections:selectedFixture(),
    onShadowRead(read,rows){
      if(read===2) rows.classMarks.find(row=>row.id==='m_regular').payload.color='green';
    },
  });
  const store=storeApi.create({
    db:firestore.db,branchId:'yongam',model,verifyPollMs:1,verifyTimeoutMs:20,sleep:()=>new Promise(resolve=>setImmediate(resolve)),
  });

  const result=await store.verifyParity({
    selection:{tabIds:['regular'],domains:['workflow'],keys:['swim_mark']},
    values:{swim_mark:JSON.stringify({'regular-mark':{color:'green'},'camp-mark':{color:'red'}})},
    keys:['swim_mark'],afterShadowRevision:8,requireShadowAdvance:true,
  });

  assert.equal(result.matches,true);
  assert.ok(firestore.shadowReads>=2);
});

test('verify parity reports bounded mismatch after advanced shadow work never reaches expected values',async()=>{
  const firestore=createFirestore({
    runtime:{branchId:'yongam',mode:'verify',generationId:'gen_1',epoch:4,revision:31},
    shadowStates:[{status:'idle',requestedRevision:9,appliedRevision:9,pendingKeys:[],inFlightKeys:[],mismatchCount:0}],
    collections:selectedFixture(),
  });
  const store=storeApi.create({
    db:firestore.db,branchId:'yongam',model,verifyPollMs:1,verifyTimeoutMs:5,sleep:()=>new Promise(resolve=>setImmediate(resolve)),
  });

  await assert.rejects(store.verifyParity({
    selection:{tabIds:['regular'],domains:['workflow'],keys:['swim_mark']},
    values:{swim_mark:JSON.stringify({'regular-mark':{color:'never'},'camp-mark':{color:'red'}})},
    keys:['swim_mark'],afterShadowRevision:8,requireShadowAdvance:true,
  }),error=>error.code==='v2-operational-parity-mismatch');
  assert.ok(firestore.shadowReads>=2);
});

test('verify parity reports a bounded shadow timeout when the local write never advances shadow state',async()=>{
  const firestore=createFirestore({
    runtime:{branchId:'yongam',mode:'verify',generationId:'gen_1',epoch:4,revision:31},
    shadowStates:[{status:'idle',requestedRevision:8,appliedRevision:8,pendingKeys:[],inFlightKeys:[],mismatchCount:0}],
    collections:selectedFixture(),
  });
  const store=storeApi.create({
    db:firestore.db,branchId:'yongam',model,verifyPollMs:1,verifyTimeoutMs:5,sleep:()=>new Promise(resolve=>setImmediate(resolve)),
  });

  await assert.rejects(store.verifyParity({
    selection:{tabIds:['regular'],domains:['workflow'],keys:['swim_mark']},
    values:{swim_mark:JSON.stringify({'regular-mark':{color:'green'},'camp-mark':{color:'red'}})},
    keys:['swim_mark'],afterShadowRevision:8,requireShadowAdvance:true,
  }),error=>error.code==='v2-operational-shadow-timeout');
});

test('verify parity reports a true selected projection mismatch after shadow settles',async()=>{
  const firestore=createFirestore({
    runtime:{branchId:'yongam',mode:'verify',generationId:'gen_1',epoch:4,revision:31},
    shadowStates:[{status:'idle',requestedRevision:8,appliedRevision:8,pendingKeys:[],inFlightKeys:[],mismatchCount:0}],
    collections:selectedFixture(),
  });
  const store=storeApi.create({db:firestore.db,branchId:'yongam',model,sleep:async()=>{}});

  await assert.rejects(store.verifyParity({
    selection:{tabIds:['regular'],domains:['workflow'],keys:['swim_mark']},
    values:{swim_mark:JSON.stringify({'regular-mark':{color:'wrong'},'camp-mark':{color:'red'}})},
    keys:['swim_mark'],
  }),error=>error.code==='v2-operational-parity-mismatch');
});

test('a newer selected tab invalidates an older pending selection response',async()=>{
  const regularGate=deferred();
  const gateKey='placements:tabId:==:"regular"';
  const firestore=createFirestore({collections:selectedFixture(),queryGates:{[gateKey]:regularGate}});
  const store=storeApi.create({db:firestore.db,branchId:'yongam',model});
  const oldLoad=store.loadSelection({tabIds:['regular'],domains:['roster']});
  const oldRejected=assert.rejects(oldLoad,error=>error.code==='stale-operational-selection');
  const current=await store.loadSelection({tabIds:['camp'],domains:['roster']});
  regularGate.resolve();

  assert.equal(JSON.parse(current.root.swim_bt_camp_stu).length,1);
  await oldRejected;
});

test('runtime subscriptions report only validated config changes',async()=>{
  const firestore=createFirestore({collections:selectedFixture()});
  const store=storeApi.create({db:firestore.db,branchId:'yongam',model});
  const rows=[];
  const stop=store.subscribeConfig(config=>rows.push(config));
  firestore.emitRuntime({
    branchId:'yongam',mode:'v2-read',generationId:'gen_1',epoch:5,revision:32,
  });
  stop();

  assert.equal(rows.length,2);
  assert.equal(rows[1].epoch,5);
  assert.equal(rows[1].revision,32);
});
