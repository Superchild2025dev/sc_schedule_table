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
  const query = {
    get(){ return Promise.resolve(currentSnapshot); },
    onSnapshot(next){
      listener = next;
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

  const context = {console, Map, Set, Promise};
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
    setSnapshot(snapshot){ currentSnapshot = snapshot; },
    emit(snapshot){
      assert.equal(typeof listener, 'function');
      listener(snapshot);
      return root.firestoreListenerQueue;
    },
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
