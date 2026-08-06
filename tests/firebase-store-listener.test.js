const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeDoc(key, item){
  return {
    id: encodeURIComponent(key),
    data(){ return item; },
  };
}

function makeSnapshot(docs, changes){
  return {
    forEach(callback){ docs.forEach(callback); },
    docChanges(){ return changes || docs.map(doc=>({type:'added', doc})); },
  };
}

function createHarness(){
  let currentSnapshot = makeSnapshot([]);
  let listener = null;
  let listenerError = null;
  let listenerCount = 0;
  const query = {
    get(){ return Promise.resolve(currentSnapshot); },
    onSnapshot(next,error){
      listenerCount += 1;
      listener = next;
      listenerError = error;
      return ()=>{ listener = null; };
    },
  };
  const collection = {
    where(){ return query; },
    doc(){
      return {
        collection(){ return {doc(){ return {}; }}; },
      };
    },
  };
  const db = {
    collection(){
      return {
        doc(){ return {collection(){ return collection; }}; },
      };
    },
  };
  const fallback = {};
  function firestore(){ return db; }
  firestore.FieldPath = {documentId(){ return {}; }};
  firestore.FieldValue = {serverTimestamp(){ return {}; }};

  const context = {console, Map, Set, Promise, setTimeout, clearTimeout};
  context.window = context;
  context.globalThis = context;
  context.SC_DATA_BACKEND = 'firestore';
  context.SC_FIRESTORE_RTDDB_FALLBACK = false;
  context.firebase = {
    firestore,
    database(){ return {ref(){ return fallback; }}; },
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'firebase-store.js'), 'utf8');
  vm.runInContext(source, context, {filename:'firebase-store.js'});
  const root = context.SCFirebaseStore.createBranchRef({id:'yongam', fbPath:'schedule_yongam'});

  return {
    root,
    store:context.SCFirebaseStore,
    setSnapshot(snapshot){ currentSnapshot = snapshot; },
    emit(snapshot){
      assert.equal(typeof listener, 'function');
      listener(snapshot);
      return Promise.all([root.firestoreListenerQueue, root.firestoreBatchListenerQueue]);
    },
    emitError(error){
      assert.equal(typeof listenerError, 'function');
      listenerError(error);
    },
    listenerCount(){ return listenerCount; },
  };
}

test('initial listener skips unchanged chunked documents already loaded once', async () => {
  const harness = createHarness();
  const item = {
    key:'swim_students',
    chunked:true,
    chunkCount:2,
    updatedAt:{seconds:10, nanoseconds:20},
  };
  const doc = makeDoc('swim_students', item);
  const snapshot = makeSnapshot([doc]);
  const reads = [];
  const events = [];
  harness.root._readStoredValue = async (key)=>{
    reads.push(key);
    return {loaded:true};
  };
  harness.setSnapshot(snapshot);

  await harness.root._list();
  harness.root._listenFirestore('child_changed', snap=>events.push(snap.key));
  await harness.emit(snapshot);

  assert.deepEqual(reads, ['swim_students']);
  assert.deepEqual(events, []);
});

test('initial listener still reads a document changed after the first load', async () => {
  const harness = createHarness();
  const oldDoc = makeDoc('swim_students', {
    key:'swim_students',
    chunked:true,
    chunkCount:2,
    updatedAt:{seconds:10, nanoseconds:20},
  });
  const newDoc = makeDoc('swim_students', {
    key:'swim_students',
    chunked:true,
    chunkCount:2,
    updatedAt:{seconds:11, nanoseconds:0},
  });
  const reads = [];
  const events = [];
  harness.root._readStoredValue = async (key,item)=>{
    reads.push(item.updatedAt.seconds);
    return {key};
  };
  harness.setSnapshot(makeSnapshot([oldDoc]));

  await harness.root._list();
  harness.root._listenFirestore('child_changed', snap=>events.push(snap.key));
  await harness.emit(makeSnapshot([newDoc]));

  assert.deepEqual(reads, [10, 11]);
  assert.deepEqual(events, ['swim_students']);
});

test('initial listener reports a document deleted after the first load', async () => {
  const harness = createHarness();
  const doc = makeDoc('swim_students', {
    key:'swim_students',
    value:{loaded:true},
    updatedAt:{seconds:10, nanoseconds:20},
  });
  const removed = [];
  harness.root._readStoredValue = async ()=>({loaded:true});
  harness.setSnapshot(makeSnapshot([doc]));

  await harness.root._list();
  harness.root._listenFirestore('child_removed', snap=>removed.push(snap.key));
  await harness.emit(makeSnapshot([], []));

  assert.deepEqual(removed, ['swim_students']);
});

test('legacy chunked documents without a version are read again for safety', async () => {
  const harness = createHarness();
  const doc = makeDoc('swim_students', {
    key:'swim_students',
    chunked:true,
    chunkCount:2,
  });
  let reads = 0;
  harness.root._readStoredValue = async ()=>{
    reads += 1;
    return {loaded:true};
  };
  const snapshot = makeSnapshot([doc]);
  harness.setSnapshot(snapshot);

  await harness.root._list();
  harness.root._listenFirestore('child_changed', ()=>{});
  await harness.emit(snapshot);

  assert.equal(reads, 2);
});

test('metadata-only snapshots with the same stored version are ignored', async () => {
  const harness = createHarness();
  const item = {
    key:'swim_students',
    value:'[]',
    updatedAt:{seconds:20, nanoseconds:30},
  };
  const doc = makeDoc('swim_students', item);
  const snapshot = makeSnapshot([doc]);
  let reads = 0;
  const events = [];
  harness.root._readStoredValue = async ()=>{
    reads += 1;
    return '[]';
  };
  harness.setSnapshot(snapshot);

  await harness.root._list();
  harness.root._listenFirestore('child_changed', snap=>events.push(snap.key));
  await harness.emit(snapshot);
  await harness.emit(makeSnapshot([doc], [{type:'modified', doc}]));

  assert.equal(reads, 1);
  assert.deepEqual(events, []);
});

test('invalid chunked JSON is rejected instead of becoming a null payload', async () => {
  const harness = createHarness();
  harness.root._chunkDoc = ()=>({
    get(){
      return Promise.resolve({
        exists:true,
        data(){ return {text:'{"students":'}; },
      });
    },
  });

  await assert.rejects(
    harness.root._readStoredValue('swim_students', {
      key:'swim_students',
      chunked:true,
      chunkCount:1,
      valueType:'json',
    }),
    error=>error && error.code === 'invalid-chunked-value'
  );
});

test('batch subscription emits the initial live documents once', async () => {
  const harness=createHarness();
  const students=makeDoc('swim_students', {
    key:'swim_students',
    value:'[{"n":"홍길동"}]',
    updatedAt:{seconds:1,nanoseconds:0},
  });
  const teachers=makeDoc('swim_inst', {
    key:'swim_inst',
    value:'{"1":"김선생"}',
    updatedAt:{seconds:1,nanoseconds:1},
  });
  const batches=[];
  harness.root._readStoredValue=async (key,item)=>item.value;

  harness.root.subscribeBatches({next:batch=>batches.push(batch)});
  await harness.emit(makeSnapshot([students,teachers]));

  assert.equal(batches.length,1);
  assert.equal(batches[0].initial,true);
  assert.deepEqual(Object.keys(batches[0].values).sort(),['swim_inst','swim_students']);
  assert.equal(batches[0].removedKeys.length,0);
  assert.deepEqual(Array.from(batches[0].changedKeys).sort(),['swim_inst','swim_students']);
});

test('one Firestore snapshot emits modified documents as one later batch', async () => {
  const harness=createHarness();
  const oldStudents=makeDoc('swim_students', {
    key:'swim_students',value:'[]',updatedAt:{seconds:1,nanoseconds:0},
  });
  const oldMarks=makeDoc('swim_mark', {
    key:'swim_mark',value:'{}',updatedAt:{seconds:1,nanoseconds:0},
  });
  const batches=[];
  harness.root._readStoredValue=async (key,item)=>item.value;
  harness.root.subscribeBatches({next:batch=>batches.push(batch)});
  await harness.emit(makeSnapshot([oldStudents,oldMarks]));

  const newStudents=makeDoc('swim_students', {
    key:'swim_students',value:'[{"n":"변경"}]',updatedAt:{seconds:2,nanoseconds:0},
  });
  const newMarks=makeDoc('swim_mark', {
    key:'swim_mark',value:'{"a":1}',updatedAt:{seconds:2,nanoseconds:1},
  });
  await harness.emit(makeSnapshot(
    [newStudents,newMarks],
    [{type:'modified',doc:newStudents},{type:'modified',doc:newMarks}]
  ));

  assert.equal(batches.length,2);
  assert.equal(batches[1].initial,false);
  assert.deepEqual(Object.keys(batches[1].values).sort(),['swim_mark','swim_students']);
  assert.equal(batches[1].values.swim_mark,'{"a":1}');
});

test('removed documents are delivered only as removed keys', async () => {
  const harness=createHarness();
  const doc=makeDoc('swim_mark', {
    key:'swim_mark',value:'{}',updatedAt:{seconds:1,nanoseconds:0},
  });
  const batches=[];
  harness.root._readStoredValue=async (key,item)=>item.value;
  harness.root.subscribeBatches({next:batch=>batches.push(batch)});
  await harness.emit(makeSnapshot([doc]));
  await harness.emit(makeSnapshot([], [{type:'removed',doc}]));

  assert.deepEqual(Object.keys(batches[1].values),[]);
  assert.deepEqual(Array.from(batches[1].removedKeys),['swim_mark']);
  assert.deepEqual(Array.from(batches[1].changedKeys),['swim_mark']);
});

test('unchanged stored versions are omitted from later batches', async () => {
  const harness=createHarness();
  const doc=makeDoc('swim_students', {
    key:'swim_students',value:'[]',updatedAt:{seconds:3,nanoseconds:4},
  });
  const batches=[];
  let reads=0;
  harness.root._readStoredValue=async (key,item)=>{
    reads += 1;
    return item.value;
  };
  harness.root.subscribeBatches({next:batch=>batches.push(batch)});
  await harness.emit(makeSnapshot([doc]));
  await harness.emit(makeSnapshot([doc], [{type:'modified',doc}]));

  assert.equal(reads,1);
  assert.equal(batches.length,1);
});

test('batch subscriptions share one listener and stop after the last unsubscribe', async () => {
  const harness=createHarness();
  const batchesA=[];
  const batchesB=[];
  const unsubscribeA=harness.root.subscribeBatches({next:batch=>batchesA.push(batch)});
  const unsubscribeB=harness.root.subscribeBatches({next:batch=>batchesB.push(batch)});

  assert.equal(harness.listenerCount(),1);
  await harness.emit(makeSnapshot([]));
  assert.equal(batchesA.length,1);
  assert.equal(batchesB.length,1);

  unsubscribeA();
  assert.equal(harness.listenerCount(),1);
  unsubscribeB();
  assert.throws(()=>harness.emit(makeSnapshot([])));
});

test('root batch adapter delegates to a Firestore batch root', () => {
  const harness=createHarness();
  const calls=[];
  const handlers={next() {}};
  harness.root.subscribeBatches=value=>{
    calls.push(value);
    return 'unsubscribe';
  };

  const result=harness.store.subscribeRootBatches(harness.root,handlers);

  assert.equal(result,'unsubscribe');
  assert.deepEqual(calls,[handlers]);
});

test('root batch adapter queues RTDB changes until its initial value is ready', async () => {
  const harness=createHarness();
  const listeners={};
  let resolveInitial;
  const root={
    on(event,handler){ listeners[event]=handler; },
    off(event,handler){ if(listeners[event]===handler) delete listeners[event]; },
    once(){
      return new Promise(resolve=>{ resolveInitial=resolve; });
    },
  };
  const batches=[];
  const unsubscribe=harness.store.subscribeRootBatches(root,{next:batch=>batches.push(batch)});

  listeners.child_changed({key:'swim_mark',val:()=>'{"a":2}'});
  resolveInitial({val:()=>({swim_students:'[]',swim_mark:'{"a":1}'})});
  await new Promise(resolve=>setTimeout(resolve,0));

  assert.equal(batches[0].initial,true);
  assert.equal(batches[0].values.swim_mark,'{"a":1}');
  assert.equal(batches[1].initial,false);
  assert.equal(batches[1].values.swim_mark,'{"a":2}');
  unsubscribe();
  assert.equal(listeners.child_changed,undefined);
  assert.equal(listeners.child_removed,undefined);
});

test('an initial document read error is reported before the partial initial batch', async () => {
  const harness=createHarness();
  const students=makeDoc('swim_students', {
    key:'swim_students',value:'[]',updatedAt:{seconds:8,nanoseconds:0},
  });
  const teachers=makeDoc('swim_inst', {
    key:'swim_inst',value:'{"1":"정상"}',updatedAt:{seconds:8,nanoseconds:1},
  });
  const order=[];
  let partialBatch=null;
  harness.root._readStoredValue=async (key,item)=>{
    if(key==='swim_students') throw new Error('missing student chunk');
    return item.value;
  };
  harness.root.subscribeBatches({
    next:batch=>{
      order.push('batch');
      partialBatch=batch;
    },
    error:()=>order.push('error'),
  });

  await harness.emit(makeSnapshot([students,teachers]));

  assert.deepEqual(order,['error','batch']);
  assert.deepEqual(Object.keys(partialBatch.values),['swim_inst']);
});

test('an empty Firestore initial batch migrates and uses the RTDB fallback', async () => {
  const harness=createHarness();
  const fallbackData={swim_students:'[{"n":"백업"}]',swim_inst:'{"1":"선생님"}'};
  const copied=[];
  const batches=[];
  harness.root.fallbackEnabled=true;
  harness.root.fallback={
    once(){ return Promise.resolve({val:()=>fallbackData}); },
  };
  harness.root._copyRTDBIntoFirestore=async data=>{ copied.push(data); };
  harness.root.subscribeBatches({next:batch=>batches.push(batch)});

  await harness.emit(makeSnapshot([]));

  assert.equal(batches.length,1);
  assert.equal(batches[0].values.swim_students,fallbackData.swim_students);
  assert.equal(batches[0].values.swim_inst,fallbackData.swim_inst);
  assert.deepEqual(Object.keys(copied[0]).sort(),['swim_inst','swim_students']);
});

test('batch subscriptions mirror one RTDB multi-key change atomically during transition rollout', async () => {
  const harness=createHarness();
  const listeners={};
  const mirrored=[];
  harness.root.fallbackEnabled=true;
  harness.root.mirrorRTDB=true;
  harness.root.fallback={
    on(event,handler){ listeners[event]=handler; },
    off(event,handler){ if(listeners[event]===handler) delete listeners[event]; },
  };
  harness.root._applyFallbackBatchToFirestore=async changes=>{ mirrored.push(changes); };

  const unsubscribe=harness.root.subscribeBatches({next() {}});
  assert.equal(typeof listeners.child_changed,'function');
  assert.equal(typeof listeners.child_removed,'function');

  listeners.child_changed({key:'swim_mark',val:()=>'{"a":1}'});
  listeners.child_changed({key:'swim_students',val:()=>'[]'});
  listeners.child_removed({key:'swim_enroll',val:()=>null});
  await new Promise(resolve=>setTimeout(resolve,5));

  assert.equal(mirrored.length,1);
  assert.deepEqual(Object.keys(mirrored[0]).sort(),['swim_enroll','swim_mark','swim_students']);
  assert.equal(mirrored[0].swim_enroll,null);

  unsubscribe();
  assert.equal(listeners.child_changed,undefined);
  assert.equal(listeners.child_removed,undefined);
});

test('disabled Firestore delivers one queued RTDB batch directly to subscribers', async () => {
  const harness=createHarness();
  const listeners={};
  const batches=[];
  harness.root.fallbackEnabled=true;
  harness.root.mirrorRTDB=true;
  harness.root.disabled=true;
  harness.root.fallback={
    on(event,handler){ listeners[event]=handler; },
    off(event,handler){ if(listeners[event]===handler) delete listeners[event]; },
  };

  harness.root.subscribeBatches({next:batch=>batches.push(batch)});
  listeners.child_changed({key:'swim_students',val:()=>'[{"n":"복구"}]'});
  listeners.child_removed({key:'swim_mark',val:()=>null});
  await new Promise(resolve=>setTimeout(resolve,5));

  assert.equal(batches.length,1);
  assert.equal(batches[0].initial,false);
  assert.equal(batches[0].values.swim_students,'[{"n":"복구"}]');
  assert.deepEqual(Array.from(batches[0].removedKeys),['swim_mark']);
});

test('a failed RTDB mirror still delivers the queued batch directly', async () => {
  const harness=createHarness();
  const listeners={};
  const batches=[];
  const errors=[];
  harness.root.fallbackEnabled=true;
  harness.root.mirrorRTDB=true;
  harness.root.fallback={
    on(event,handler){ listeners[event]=handler; },
    off(event,handler){ if(listeners[event]===handler) delete listeners[event]; },
  };
  harness.root._applyFallbackBatchToFirestore=async ()=>{ throw new Error('mirror failed'); };

  harness.root.subscribeBatches({
    next:batch=>batches.push(batch),
    error:error=>errors.push(error),
  });
  listeners.child_changed({key:'swim_inst',val:()=>'{"1":"선생님"}'});
  await new Promise(resolve=>setTimeout(resolve,5));

  assert.equal(errors.length,1);
  assert.equal(batches.length,1);
  assert.equal(batches[0].values.swim_inst,'{"1":"선생님"}');
});
