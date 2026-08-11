const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');

require(path.join(__dirname,'..','js','schedule-v2-operational-model.js'));
const model=globalThis.SCV2OperationalModel;
const storeApi=require(path.join(__dirname,'..','js','schedule-v2-operational-store.js'));

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
  const queriedCollections=new Set();
  const documentReads={people:[],enrollments:[],tabs:[]};
  const readConcurrency={people:0,enrollments:0};
  const maxReadConcurrency={people:0,enrollments:0};
  const queryGates=input.queryGates||{};
  let genericGenerationReads=0;
  let runtimeListener=null;

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
  const branchRef={
    collection(name){
      if(name==='runtime') return {doc:()=>runtimeRef};
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
    reservations:[{id:'r_regular',tabId:'regular',type:'enroll',slotKey:'월-1',payload:{state:'waiting'}}],
    waitlistEntries:[{id:'w_regular',tabId:'regular',instKey:'월-1',order:0,payload:{state:'waiting'}}],
    classMarks:[{id:'m_regular',tabId:'regular',legacyKey:'월-1',layer:'primary',payload:{color:'blue'}}],
    attendanceRecords:[{id:'a_regular',tabId:'regular',legacyKey:'att-1',payload:{state:'present'}}],
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

  assert.deepEqual(plain(model.trackedLegacyView(loaded.root)),plain(model.trackedLegacyView(direct)));
  assert.equal(loaded.context.branchId,'yongam');
  assert.equal(loaded.context.generationId,'gen_1');
  assert.equal(loaded.context.epoch,4);
  assert.equal(loaded.context.revision,31);
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
      '월-1':{color:'blue'},
    })},
    keys:['swim_mark'],
  });

  assert.equal(result.matches,true);
  assert.equal(result.keyCount,1);
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
