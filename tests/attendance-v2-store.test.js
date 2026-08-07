const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function plain(value){ return JSON.parse(JSON.stringify(value)); }

function createFakeFirestore(seed={}){
  const docs=new Map(Object.entries(seed).map(([key,value])=>[key,plain(value)]));
  const queryLog=[];
  const transactions=[];
  const commits=[];
  const listeners=new Map();

  function hasUndefined(value){
    if(value===undefined) return true;
    if(Array.isArray(value)) return value.some(hasUndefined);
    return !!(value&&typeof value==='object'&&Object.values(value).some(hasUndefined));
  }

  function snapshot(path,id){
    const exists=docs.has(path);
    return {id,exists,data(){ return exists?plain(docs.get(path)):undefined; }};
  }
  function notify(path){
    const callbacks=listeners.get(path)||[];
    const id=path.split('/').pop();
    callbacks.forEach(({next})=>next(snapshot(path,id)));
  }
  function docRef(path){
    const id=path.split('/').pop();
    return {
      id,path,
      collection(name){ return collectionRef(`${path}/${name}`); },
      async get(){ return snapshot(path,id); },
      async set(value,options){
        if(hasUndefined(value)) throw new Error('Unsupported field value: undefined');
        const next=options?.merge&&docs.has(path)?{...docs.get(path),...plain(value)}:plain(value);
        docs.set(path,next);notify(path);
      },
      async delete(){ docs.delete(path);notify(path); },
      onSnapshot(next,error){
        const list=listeners.get(path)||[];
        const entry={next,error};list.push(entry);listeners.set(path,list);
        next(snapshot(path,id));
        return ()=>listeners.set(path,(listeners.get(path)||[]).filter(item=>item!==entry));
      },
    };
  }
  function queryRef(collectionPath,filters=[]){
    return {
      where(field,op,value){ return queryRef(collectionPath,[...filters,[field,op,plain(value)]]); },
      async get(){
        queryLog.push({collectionPath,filters:plain(filters)});
        const prefix=`${collectionPath}/`;
        const rows=[];
        docs.forEach((value,key)=>{
          if(!key.startsWith(prefix)||key.slice(prefix.length).includes('/')) return;
          const matches=filters.every(([field,op,wanted])=>{
            if(op==='==') return value[field]===wanted;
            if(op==='in') return Array.isArray(wanted)&&wanted.includes(value[field]);
            throw new Error(`unsupported query ${op}`);
          });
          if(matches) rows.push(snapshot(key,key.slice(prefix.length)));
        });
        return {size:rows.length,forEach(fn){rows.forEach(fn);},docs:rows};
      },
    };
  }
  function collectionRef(collectionPath){
    const query=queryRef(collectionPath);
    return {
      path:collectionPath,
      doc(id){ return docRef(`${collectionPath}/${id}`); },
      where:query.where,
      get:query.get,
    };
  }
  function apply(operation){
    if(operation.type==='delete') docs.delete(operation.ref.path);
    else{
      const previous=docs.get(operation.ref.path)||{};
      docs.set(operation.ref.path,operation.options?.merge?{...previous,...plain(operation.value)}:plain(operation.value));
    }
    notify(operation.ref.path);
  }
  const db={
    queryLog,transactions,commits,docs,
    collection(name){ return collectionRef(name); },
    async runTransaction(worker){
      const ops=[];
      const tx={
        async get(ref){ return ref.get(); },
        set(ref,value,options){ ops.push({type:'set',ref,value,options}); },
        delete(ref){ ops.push({type:'delete',ref}); },
      };
      const result=await worker(tx);
      ops.forEach(apply);transactions.push(ops);
      return result;
    },
    batch(){
      const ops=[];
      return {
        set(ref,value,options){ ops.push({type:'set',ref,value,options}); },
        delete(ref){ ops.push({type:'delete',ref}); },
        async commit(){ ops.forEach(apply);commits.push(ops); },
      };
    },
  };
  return db;
}

function loadStore(db,branchId='yongam'){
  const context={window:{},console,Date,setTimeout,clearTimeout};
  vm.createContext(context);
  for(const file of ['schedule-time.js','schedule-schema-v2.js','attendance-v2-model.js','schedule-v2-store.js','attendance-v2-store.js']){
    vm.runInContext(fs.readFileSync(path.join(__dirname,'..','js',file),'utf8'),context,{filename:file});
  }
  return {
    model:context.window.SCV2AttendanceModel,
    store:context.window.SCV2AttendanceStore.create({db,branchId}),
  };
}

function configPath(branch='yongam'){
  return `scheduleV2/${branch}/runtime/attendance`;
}
function rowPath(collection,id,generation='gen_1',branch='yongam'){
  return `scheduleV2/${branch}/generations/${generation}/${collection}/${id}`;
}

test('missing runtime config fails closed to v1',async()=>{
  const db=createFakeFirestore();
  const {store}=loadStore(db);

  assert.deepEqual(plain(await store.readConfig()),{
    mode:'v1',generationId:'',branchId:'yongam',valid:false,
  });
});

test('invalid config and a stale generation cannot activate V2 reads',async()=>{
  const db=createFakeFirestore({
    [configPath()]:{mode:'v2-read',generationId:'gen_1',branchId:'yongam'},
  });
  const {store}=loadStore(db);
  assert.equal((await store.readConfig()).valid,true);

  await assert.rejects(()=>store.readRange({
    generationId:'gen_old',tabId:'regular',dates:['2026-08-03'],
  }),/현재 V2 세대와 일치하지 않습니다/);

  db.docs.set(configPath(),{mode:'v2-read',generationId:'',branchId:'yongam'});
  assert.deepEqual(plain(await store.readConfig()),{
    mode:'v1',generationId:'',branchId:'yongam',valid:false,
  });
});

test('runtime config writes contain no Firestore-unsupported undefined values',async()=>{
  const db=createFakeFirestore();
  const {store}=loadStore(db);
  const saved=await store.setConfig({mode:'v1'});

  assert.equal(saved.valid,true);
  const stored=db.docs.get(configPath());
  assert.equal(Object.prototype.hasOwnProperty.call(stored,'valid'),false);
  assert.equal(stored.mode,'v1');
  assert.equal(stored.branchId,'yongam');
});

test('week query requests only the selected tab and dates',async()=>{
  const db=createFakeFirestore({
    [configPath()]:{mode:'v2-read',generationId:'gen_1',branchId:'yongam'},
    [rowPath('attendanceRecords','att_1')]:{id:'att_1',tabId:'regular',date:'2026-08-03',legacyKey:'4시/월/1/1/2026-08-03',payload:{s:'present'}},
    [rowPath('attendanceRecords','att_other')]:{id:'att_other',tabId:'summer',date:'2026-08-03',legacyKey:'10시/월/1/1/2026-08-03',payload:{s:'present'}},
    [rowPath('attendanceGuests','guest_1')]:{id:'guest_1',tabId:'regular',date:'2026-08-04',legacyKey:'4시/화/1/2026-08-04',order:0,payload:{n:'추가'}},
  });
  const {store}=loadStore(db);
  await store.readConfig();
  const result=await store.readRange({
    generationId:'gen_1',tabId:'regular',dates:['2026-08-03','2026-08-04'],
  });

  assert.deepEqual(plain(result.records.map(row=>row.id)),['att_1']);
  assert.deepEqual(plain(result.guests.map(row=>row.id)),['guest_1']);
  assert.equal(db.queryLog.length,2);
  db.queryLog.forEach(entry=>assert.deepEqual(entry.filters,[
    ['tabId','==','regular'],['date','in',['2026-08-03','2026-08-04']],
  ]));
});

test('range reads reject more than ten unique dates',async()=>{
  const db=createFakeFirestore({
    [configPath()]:{mode:'v2-read',generationId:'gen_1',branchId:'yongam'},
  });
  const {store}=loadStore(db);
  await store.readConfig();
  const dates=Array.from({length:11},(_,index)=>`2026-08-${String(index+1).padStart(2,'0')}`);

  await assert.rejects(()=>store.readRange({generationId:'gen_1',tabId:'regular',dates}),/최대 10일/);
  assert.equal(db.queryLog.length,0);
});

test('one attendance change writes one deterministic document in a transaction',async()=>{
  const db=createFakeFirestore({
    [configPath()]:{mode:'v2-read',generationId:'gen_1',branchId:'yongam'},
  });
  const {model,store}=loadStore(db);
  await store.readConfig();
  const row=model.recordFromLegacy({
    tabId:'regular',courseType:'regular',legacyKey:'4시/월/1/1/2026-08-03',raw:{s:'present'},
  });
  await store.setRecord(row);

  assert.equal(db.transactions.length,1);
  assert.equal(db.transactions[0].length,1);
  assert.deepEqual(plain(db.docs.get(rowPath('attendanceRecords',row.id))),{
    ...plain(row),branchId:'yongam',generationId:'gen_1',
  });

  await store.deleteRecord(row.id);
  assert.equal(db.docs.has(rowPath('attendanceRecords',row.id)),false);
});

test('guest replacement deletes stale rows and writes only the new group',async()=>{
  const db=createFakeFirestore({
    [configPath()]:{mode:'v2-read',generationId:'gen_1',branchId:'yongam'},
    [rowPath('attendanceGuests','guest_stale')]:{id:'guest_stale',tabId:'regular',date:'2026-08-03',legacyKey:'4시/월/1/2026-08-03',payload:{gid:'stale'}},
  });
  const {model,store}=loadStore(db);
  await store.readConfig();
  const row=model.guestFromLegacy({
    tabId:'regular',courseType:'regular',legacyKey:'4시/월/1/2026-08-03',index:0,
    raw:{gid:'new_guest',n:'새원생'},
  });
  await store.replaceGuestGroup({rows:[row],existingRows:[{id:'guest_stale'}]});

  assert.equal(db.docs.has(rowPath('attendanceGuests','guest_stale')),false);
  assert.equal(db.docs.has(rowPath('attendanceGuests',row.id)),true);
  assert.equal(db.commits.length,1);
});

test('record batches reject oversized changes before writing',async()=>{
  const db=createFakeFirestore({
    [configPath()]:{mode:'v2-read',generationId:'gen_1',branchId:'yongam'},
  });
  const {store}=loadStore(db);
  await store.readConfig();
  const changes=Array.from({length:451},(_,index)=>({
    type:'delete',collection:'attendanceRecords',id:`att_${index}`,
  }));

  await assert.rejects(()=>store.writeRecordBatch(changes),/450개/);
  assert.equal(db.commits.length,0);
});

test('range comparison reports digest mismatches without retaining personal values',async()=>{
  const db=createFakeFirestore({
    [configPath()]:{mode:'verify',generationId:'gen_1',branchId:'yongam'},
  });
  const {model,store}=loadStore(db);
  await store.readConfig();
  const legacyKey='4시/월/1/1/2026-08-03';
  const row=model.recordFromLegacy({
    tabId:'regular',courseType:'regular',legacyKey,
    raw:{s:'present',n:'비밀원생',p:'01012345678'},
  });
  const result=store.compareRange({
    attendance:{[legacyKey]:{s:'absent',n:'비밀원생',p:'01012345678'}},
    guests:{},records:[row],guests:[],
  });

  assert.equal(result.ready,false);
  assert.equal(result.mismatchCount,1);
  assert.doesNotMatch(JSON.stringify(result.diagnostic),/비밀원생|01012345678/);
  assert.deepEqual(plain(result.diagnostic),{
    branchId:'yongam',mode:'verify',ready:false,mismatchCount:1,
    counts:{legacyAttendance:1,v2Attendance:1,legacyGuestGroups:0,v2GuestGroups:0},
    issueTypes:{'attendance-payload-mismatch':1},
  });
});
