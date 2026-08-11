const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const gatewayPath = path.join(__dirname, '..', 'js', 'schedule-write-gateway.js');

function read(relativePath){
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

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
        set(value,meta){ return methods.set(key, value, meta); },
        remove(meta){ return methods.remove ? methods.remove(key,meta) : Promise.resolve(); },
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
  assert.match(reports[0].meta.operationId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
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

test('every write carries operation metadata and one stable UUID to the storage boundary', async () => {
  const {create} = require(gatewayPath);
  const calls=[];
  const root={
    child(key){
      return {
        set(value,meta){ calls.push({kind:'set',key,value,meta}); return Promise.resolve('saved'); },
        remove(meta){ calls.push({kind:'remove',key,meta}); return Promise.resolve('removed'); },
      };
    },
    transactionKeys(keys,updateFn,meta){
      calls.push({kind:'transaction',keys:[...keys],meta});
      const next=updateFn({swim_mark:'{}'});
      return Promise.resolve({committed:true,snapshot:{val:()=>next}});
    },
  };
  const gateway=create({getRoot:()=>root});

  await gateway.set('swim_students','[]',{operationType:'move-student',label:'자리 이동'});
  await gateway.remove('swim_retire',{operationType:'clear-retirement',label:'퇴원 취소'});
  const retryMeta={operationId:'95ecfe8a-7f08-42ef-9e99-f902d0ff6f5a',operationType:'edit-mark',label:'결석 저장'};
  await gateway.transaction(['swim_mark'],value=>value,retryMeta);

  assert.match(calls[0].meta.operationId,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(calls[0].meta.operationType,'move-student');
  assert.equal(calls[0].meta.label,'자리 이동');
  assert.match(calls[1].meta.operationId,/^[0-9a-f-]{36}$/i);
  assert.equal(calls[2].meta.operationId,retryMeta.operationId);
  assert.equal(gateway.recent(1)[0].id,retryMeta.operationId);
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

test('main runtime loads the gateway before core', () => {
  const html = read('index.html');
  const gatewayIndex = html.indexOf("scJs('js/schedule-write-gateway.js')");
  const coreIndex = html.indexOf("scJs('js/core.js')");

  assert.notEqual(gatewayIndex, -1);
  assert.ok(gatewayIndex < coreIndex);
});

test('main multi-key schedule transactions delegate to the gateway', () => {
  const source = read('js/data.js');

  assert.match(source, /_scheduleWrites\.transaction\(txSafeKeys,/);
  assert.doesNotMatch(
    source.slice(source.indexOf('function updateScheduleTx('), source.indexOf('function updateStudentsTx(')),
    /_fb\.transactionKeys|_fb\.transaction\(/
  );
});

test('tab and snapshot writes use the shared write gateway', () => {
  const source = read('js/tabs.js');

  assert.match(source, /_scheduleWrites\.transaction\(keys,/);
  assert.match(source, /_scheduleWrites\.transaction\(txKeys,/);
  assert.doesNotMatch(source, /_fb\.transactionKeys\s*\(/);
  assert.doesNotMatch(source, /_fb\.transaction\s*\(/);
  assert.match(source, /await dbSet\(SNAP_KEY_PREFIX\+newId/);
});

test('staff pages load the shared gateway before their runtime', () => {
  for(const [htmlFile, runtime] of [
    ['teacher.html', "scJs('js/teacher.js')"],
    ['desk.html', "scJs('js/desk.js')"],
    ['settings.html', "scJs('js/settings.js')"],
  ]){
    const html = read(htmlFile);
    const gatewayIndex = html.indexOf("scJs('js/schedule-write-gateway.js')");
    assert.notEqual(gatewayIndex, -1, `${htmlFile} must load the gateway`);
    assert.ok(gatewayIndex < html.indexOf(runtime), `${htmlFile} must load the gateway first`);
  }
});

test('staff transactions delegate to page gateways', () => {
  const teacher = read('js/teacher.js');
  const desk = read('js/desk.js');
  const settings = read('js/settings.js');

  assert.match(teacher, /_teacherWrites\.transaction\(/);
  assert.doesNotMatch(teacher, /_fb\.transactionKeys\s*\(|_fb\.transaction\s*\(|_fb\.child\([^\r\n]*\)\.(?:set|remove|transaction)\s*\(/);
  assert.match(desk, /_deskWrites\.transaction\(/);
  assert.doesNotMatch(desk, /_fb\.transactionKeys\s*\(|_fb\.transaction\s*\(/);
  assert.match(settings, /_settingsWrites\([^)]*\)\.transaction\(/);
  assert.doesNotMatch(settings, /branchRoot\([^\r\n]*\)\.transactionKeys\s*\(|branchRoot\([^\r\n]*\)\.child\([^\r\n]*\)\.transaction\s*\(/);
});
