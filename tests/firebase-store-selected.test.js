const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function wait(ms=8){
  return new Promise(resolve=>setTimeout(resolve,ms));
}

function createHarness(){
  const listeners=new Map();
  const listenerErrors=new Map();
  const subscribeCounts=new Map();
  let collectionListeners=0;

  function keyFromId(id){
    try{return decodeURIComponent(String(id).replace(/%2E/g,'.'));}catch(error){return String(id);}
  }
  function bucket(map,key){
    if(!map.has(key)) map.set(key,new Set());
    return map.get(key);
  }
  function docRef(id){
    const key=keyFromId(id);
    return {
      id,
      collection(){
        return {
          doc(){ return {}; },
          get(){ return Promise.resolve({docs:[]}); },
        };
      },
      onSnapshot(next,error){
        bucket(listeners,key).add(next);
        bucket(listenerErrors,key).add(error);
        subscribeCounts.set(key,(subscribeCounts.get(key)||0)+1);
        return ()=>{
          bucket(listeners,key).delete(next);
          bucket(listenerErrors,key).delete(error);
        };
      },
      get(){
        return Promise.resolve({exists:false,id,data(){return null;}});
      },
    };
  }
  const query={
    get(){ return Promise.resolve({forEach(){}}); },
    onSnapshot(){
      collectionListeners += 1;
      return ()=>{};
    },
  };
  const collection={
    where(){ return query; },
    doc:docRef,
  };
  const db={
    collection(){
      return {
        doc(){ return {collection(){ return collection; }}; },
      };
    },
  };
  function firestore(){ return db; }
  firestore.FieldPath={documentId(){ return {}; }};
  firestore.FieldValue={serverTimestamp(){ return {}; }};
  const fallback={};
  const context={console,Map,Set,Promise,setTimeout,clearTimeout,Date};
  context.window=context;
  context.globalThis=context;
  context.SC_DATA_BACKEND='firestore';
  context.SC_FIRESTORE_RTDDB_FALLBACK=false;
  context.firebase={
    firestore,
    database(){ return {ref(){ return fallback; }}; },
  };
  vm.createContext(context);
  const source=fs.readFileSync(path.join(__dirname,'..','js','firebase-store.js'),'utf8');
  vm.runInContext(source,context,{filename:'firebase-store.js'});
  const root=context.SCFirebaseStore.createBranchRef({id:'yongam',fbPath:'schedule_yongam'});
  const reads=[];
  root._readStoredValue=async (key,item)=>{
    reads.push(key);
    return item.value;
  };

  return {
    root,
    store:context.SCFirebaseStore,
    reads,
    collectionListenerCount(){ return collectionListeners; },
    listenerCount(key){ return listeners.get(key)?.size||0; },
    subscribeCount(key){ return subscribeCounts.get(key)||0; },
    listenerKeys(){
      return [...listeners.entries()].filter(([,set])=>set.size).map(([key])=>key).sort();
    },
    emit(key,value,options){
      const opts=options||{};
      const exists=opts.exists!==false;
      const item=exists
        ?{key,value,chunked:!!opts.chunked,updatedAt:opts.updatedAt||{seconds:Date.now(),nanoseconds:0}}
        :null;
      const snap={
        id:encodeURIComponent(key),
        exists,
        data(){ return item; },
      };
      [...(listeners.get(key)||[])].forEach(next=>next(snap));
      return wait();
    },
    error(key,error){
      [...(listenerErrors.get(key)||[])].forEach(callback=>{
        if(typeof callback==='function') callback(error);
      });
      return wait();
    },
  };
}

async function startInitial(harness,options){
  const batches=[];
  const errors=[];
  const controller=harness.root.subscribeSelectedBatches(Object.assign({
    baseKeys:['swim_tab_list','swim_main_tab'],
    resolveInitialActiveKeys(){ return ['swim_students','swim_inst']; },
    next:batch=>batches.push(batch),
    error:error=>errors.push(error),
  },options||{}));
  await harness.emit('swim_tab_list','[]');
  await harness.emit('swim_main_tab','{}');
  await wait();
  await harness.emit('swim_students','[]');
  await harness.emit('swim_inst','{}');
  await wait();
  return {controller,batches,errors};
}

test('selected subscription opens only base then resolved active document listeners',async()=>{
  const harness=createHarness();
  const batches=[];
  let resolvedBase=null;
  const controller=harness.root.subscribeSelectedBatches({
    baseKeys:['swim_tab_list','swim_main_tab'],
    resolveInitialActiveKeys(values){
      resolvedBase=values;
      return ['swim_students','swim_inst'];
    },
    next:batch=>batches.push(batch),
  });

  assert.deepEqual(harness.listenerKeys(),['swim_main_tab','swim_tab_list']);
  assert.equal(harness.collectionListenerCount(),0);
  await harness.emit('swim_tab_list','[{"id":"regular"}]');
  await harness.emit('swim_main_tab','{"tabId":"regular"}');
  await wait();

  assert.equal(resolvedBase.swim_tab_list,'[{"id":"regular"}]');
  assert.deepEqual(harness.listenerKeys(),[
    'swim_inst','swim_main_tab','swim_students','swim_tab_list',
  ]);
  assert.equal(batches.length,0);

  await harness.emit('swim_students','[{"n":"홍길동"}]');
  await harness.emit('swim_inst','{"1":"선생님"}');
  await wait();

  assert.equal(batches.length,1);
  assert.equal(batches[0].initial,true);
  assert.deepEqual(Object.keys(batches[0].values).sort(),[
    'swim_inst','swim_main_tab','swim_students','swim_tab_list',
  ]);
  controller.stop();
});

test('missing selected documents are confirmed removals in the initial batch',async()=>{
  const harness=createHarness();
  const batches=[];
  harness.root.subscribeSelectedBatches({
    baseKeys:['swim_tab_list'],
    resolveInitialActiveKeys(){ return ['swim_students']; },
    next:batch=>batches.push(batch),
  });
  await harness.emit('swim_tab_list','[]');
  await harness.emit('swim_students',null,{exists:false});
  await wait();

  assert.equal(batches.length,1);
  assert.deepEqual(Array.from(batches[0].removedKeys),['swim_students']);
  assert.equal(Object.prototype.hasOwnProperty.call(batches[0].values,'swim_students'),false);
});

test('active-key replacement waits atomically and retains base listeners',async()=>{
  const harness=createHarness();
  const {controller,batches}=await startInitial(harness);
  const pending=controller.setActiveKeys(['swim_stu_july','swim_inst_july']);

  assert.equal(harness.listenerCount('swim_students'),1);
  assert.equal(harness.listenerCount('swim_inst'),1);
  await harness.emit('swim_stu_july','[{"n":"7월"}]');
  assert.equal(batches.length,1);
  await harness.emit('swim_inst_july','{"1":"7월쌤"}');
  const result=await pending;
  await wait();

  assert.equal(result.stale,false);
  assert.equal(batches.length,2);
  assert.deepEqual(Array.from(batches[1].changedKeys).sort(),['swim_inst_july','swim_stu_july']);
  assert.equal(harness.listenerCount('swim_students'),0);
  assert.equal(harness.listenerCount('swim_inst'),0);
  assert.equal(harness.listenerCount('swim_tab_list'),1);
  assert.equal(harness.listenerCount('swim_main_tab'),1);

  const before=harness.subscribeCount('swim_stu_july');
  await controller.setActiveKeys(['swim_inst_july','swim_stu_july']);
  assert.equal(harness.subscribeCount('swim_stu_july'),before);
});

test('a newer active request wins over a slower previous request',async()=>{
  const harness=createHarness();
  const {controller}=await startInitial(harness);
  const first=controller.setActiveKeys(['swim_stu_july','swim_inst_july']);
  const second=controller.setActiveKeys(['swim_stu_august','swim_inst_august']);

  await harness.emit('swim_stu_july','[]');
  await harness.emit('swim_inst_july','{}');
  await harness.emit('swim_stu_august','[]');
  await harness.emit('swim_inst_august','{}');
  const [firstResult,secondResult]=await Promise.all([first,second]);
  await wait();

  assert.equal(firstResult.stale,true);
  assert.equal(secondResult.stale,false);
  assert.equal(harness.listenerCount('swim_stu_july'),0);
  assert.equal(harness.listenerCount('swim_inst_july'),0);
  assert.equal(harness.listenerCount('swim_stu_august'),1);
  assert.equal(harness.listenerCount('swim_inst_august'),1);
});

test('attendance auxiliary keys do not replace visible active keys',async()=>{
  const harness=createHarness();
  const {controller}=await startInitial(harness);
  const pending=controller.setAuxiliaryKeys('attendance-basis',[
    'swim_stu_may','swim_inst_may',
  ]);
  await harness.emit('swim_stu_may','[]');
  await harness.emit('swim_inst_may','{}');
  await pending;

  assert.equal(harness.listenerCount('swim_students'),1);
  assert.equal(harness.listenerCount('swim_inst'),1);
  assert.equal(harness.listenerCount('swim_stu_may'),1);
  assert.equal(harness.listenerCount('swim_inst_may'),1);

  controller.releaseAuxiliaryKeys('attendance-basis');
  assert.equal(harness.listenerCount('swim_stu_may'),0);
  assert.equal(harness.listenerCount('swim_inst_may'),0);
  assert.equal(harness.listenerCount('swim_students'),1);
});

test('selected changes from one turn are delivered in one later batch',async()=>{
  const harness=createHarness();
  const {batches}=await startInitial(harness);
  harness.emit('swim_students','[{"n":"변경"}]');
  harness.emit('swim_inst','{"1":"변경쌤"}');
  await wait(15);

  assert.equal(batches.length,2);
  assert.deepEqual(Array.from(batches[1].changedKeys).sort(),['swim_inst','swim_students']);
});

test('unselected chunked documents are never assembled',async()=>{
  const harness=createHarness();
  await startInitial(harness);
  assert.equal(harness.listenerCount('swim_stu_hidden'),0);
  assert.equal(harness.reads.includes('swim_stu_hidden'),false);
});

test('selected read errors are reported without a replacement batch',async()=>{
  const harness=createHarness();
  const {controller,batches,errors}=await startInitial(harness);
  const pending=controller.setActiveKeys(['swim_stu_broken']);
  const rejection=assert.rejects(pending,/read failed/);
  await harness.error('swim_stu_broken',new Error('read failed'));
  await rejection;
  assert.equal(errors.length,1);
  assert.equal(batches.length,1);
});

test('stop removes all selected listeners and ignores late values',async()=>{
  const harness=createHarness();
  const {controller,batches}=await startInitial(harness);
  controller.stop();
  assert.deepEqual(harness.listenerKeys(),[]);
  await harness.emit('swim_students','[{"n":"늦음"}]');
  assert.equal(batches.length,1);
});

test('selected root adapter delegates to a selected Firestore root',()=>{
  const harness=createHarness();
  const calls=[];
  const options={baseKeys:['swim_tab_list'],next(){}};
  harness.root.subscribeSelectedBatches=value=>{
    calls.push(value);
    return 'controller';
  };

  const result=harness.store.subscribeSelectedRootBatches(harness.root,options);

  assert.equal(result,'controller');
  assert.deepEqual(calls,[options]);
});

test('selected root adapter listens to individual RTDB keys only',async()=>{
  const harness=createHarness();
  const listeners=new Map();
  const root={
    child(key){
      return {
        on(event,next){ listeners.set(key,next); },
        off(event,next){ if(listeners.get(key)===next) listeners.delete(key); },
      };
    },
  };
  const batches=[];
  const controller=harness.store.subscribeSelectedRootBatches(root,{
    baseKeys:['swim_tab_list'],
    resolveInitialActiveKeys(){ return ['swim_students']; },
    next:batch=>batches.push(batch),
  });

  listeners.get('swim_tab_list')({exists:()=>true,val:()=>'[]'});
  await wait();
  assert.deepEqual([...listeners.keys()].sort(),['swim_students','swim_tab_list']);
  listeners.get('swim_students')({exists:()=>true,val:()=>'[]'});
  await controller.ready;
  assert.equal(batches.length,1);
  assert.equal(batches[0].initial,true);
  controller.stop();
  assert.deepEqual([...listeners.keys()],[]);
});
