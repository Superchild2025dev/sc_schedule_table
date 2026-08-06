const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const gatewayPath = path.join(__dirname, '..', 'js', 'schedule-write-gateway.js');

function deferred(){
  let resolve;
  let reject;
  const promise = new Promise((res, rej)=>{
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
}

function rootWithChild(methods){
  return {
    child(key){
      return {
        set(value){ return methods.set(key, value); },
        remove(){ return methods.remove ? methods.remove(key) : Promise.resolve(); },
      };
    },
  };
}

test('set stays pending until the server write resolves', async () => {
  const {create} = require(gatewayPath);
  const pending = deferred();
  const calls = [];
  const root = rootWithChild({
    set(key, value){
      calls.push({key, value});
      return pending.promise;
    },
  });
  const gateway = create({getRoot:()=>root});
  let settled = false;

  const write = gateway.set('swim_students', '[]').then(()=>{ settled = true; });
  await Promise.resolve();

  assert.equal(settled, false);
  assert.deepEqual(calls, [{key:'swim_students', value:'[]'}]);

  pending.resolve('saved');
  await write;
  assert.equal(settled, true);
  assert.equal(gateway.recent(1)[0].status, 'success');
});

test('a failed write is reported once and rethrown', async () => {
  const {create} = require(gatewayPath);
  const reports = [];
  const failure = Object.assign(new Error('denied'), {code:'permission-denied'});
  const root = rootWithChild({set:()=>Promise.reject(failure)});
  const gateway = create({
    getRoot:()=>root,
    reportFailure(error, meta){ reports.push({error, meta}); },
  });

  await assert.rejects(
    gateway.set('swim_mark', '{}', {label:'결석 저장'}),
    error=>error===failure
  );

  assert.equal(reports.length, 1);
  assert.equal(reports[0].error, failure);
  assert.equal(reports[0].meta.label, '결석 저장');
  assert.equal(reports[0].meta.keys[0], 'swim_mark');
  assert.match(reports[0].meta.operationId, /^write_/);
  assert.equal(gateway.recent(1)[0].status, 'failed');
});

test('transaction deduplicates keys and uses the keyed transaction API', async () => {
  const {create} = require(gatewayPath);
  const calls = [];
  const root = {
    transactionKeys(keys, updateFn){
      calls.push(keys.slice());
      const current = {swim_students:'[]', swim_enroll:'{}'};
      const next = updateFn(current);
      return Promise.resolve({committed:true, snapshot:{val:()=>next}});
    },
  };
  const gateway = create({getRoot:()=>root});

  const result = await gateway.transaction(
    ['swim_students', 'swim_enroll', 'swim_students'],
    rootValue=>({...rootValue, swim_enroll:'{"slot":true}'})
  );

  assert.deepEqual(calls, [['swim_students', 'swim_enroll']]);
  assert.equal(result.committed, true);
  assert.equal(result.snapshot.val().swim_enroll, '{"slot":true}');
});

test('blocked writes never call the storage root', async () => {
  const {create} = require(gatewayPath);
  let rootCalls = 0;
  const gateway = create({
    getRoot(){ rootCalls++; return rootWithChild({set:()=>Promise.resolve()}); },
    canWrite(){ return false; },
  });

  await assert.rejects(
    gateway.set('swim_students', '[]'),
    error=>error && error.code==='write-blocked'
  );
  assert.equal(rootCalls, 0);
});

