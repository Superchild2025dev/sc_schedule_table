# Schedule Write Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every staff-side schedule write through one Promise-based gateway without changing the V1 storage keys or JSON payloads.

**Architecture:** Add a small browser/Node-compatible gateway that owns set, remove, and transaction execution plus diagnostics and single-shot failure reporting. Existing page-specific business logic remains in place, but main, teacher, desk, and settings pages receive page-local gateway instances instead of calling Firebase write methods directly.

**Tech Stack:** Browser JavaScript IIFE modules, Firebase compat APIs, Node.js built-in test runner, existing Firestore key/value adapter.

## Global Constraints

- Keep all existing V1 storage keys and JSON formats unchanged.
- Do not switch operational reads to V2.
- Do not change lower schedule audit rules or UI design in this phase.
- Do not modify or delete production Firestore data.
- Preserve current auth checks, snapshot read-only behavior, and time-machine write blocking.
- Leave untracked `HANDOFF.md`, `backup/`, and `outputs/` untouched.

---

### Task 1: Promise-Based Write Gateway

**Files:**
- Create: `js/schedule-write-gateway.js`
- Create: `tests/schedule-write-gateway.test.js`

**Interfaces:**
- Consumes: a dynamic `getRoot()` callback returning the current branch Firebase-compatible root.
- Produces: `SCScheduleWriteGateway.create(options)` with `set(key,value,meta)`, `remove(key,meta)`, `transaction(keys,updateFn,meta)`, and `recent(limit)`.

- [ ] **Step 1: Write the failing gateway tests**

```js
test('set stays pending until the server write resolves', async () => {
  const deferred = makeDeferred();
  const gateway = createGateway({getRoot:()=>fakeRoot({set:()=>deferred.promise})});
  let settled = false;
  const write = gateway.set('swim_students', '[]').then(()=>{ settled=true; });
  await Promise.resolve();
  assert.equal(settled, false);
  deferred.resolve();
  await write;
  assert.equal(settled, true);
});

test('a failed write is reported once and rethrown', async () => {
  const reports=[];
  const failure=Object.assign(new Error('denied'),{code:'permission-denied'});
  const gateway=createGateway({
    getRoot:()=>fakeRoot({set:()=>Promise.reject(failure)}),
    reportFailure:(error,meta)=>reports.push({error,meta}),
  });
  await assert.rejects(gateway.set('swim_mark','{}'),failure);
  assert.equal(reports.length,1);
});

test('transaction uses only the requested keys', async () => {
  const calls=[];
  const root=fakeTransactionRoot(calls);
  const gateway=createGateway({getRoot:()=>root});
  await gateway.transaction(['swim_students','swim_enroll'],value=>value);
  assert.deepEqual(calls[0].keys,['swim_students','swim_enroll']);
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run: `node --test tests/schedule-write-gateway.test.js`

Expected: FAIL because `js/schedule-write-gateway.js` does not exist.

- [ ] **Step 3: Implement the minimal gateway**

```js
(function(global,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  global.SCScheduleWriteGateway=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function create(options){
    const recent=[];
    const getRoot=options.getRoot;
    async function run(kind,keys,executor,meta){
      const operation={id:makeId(),kind,keys:[...keys],startedAt:new Date().toISOString(),status:'pending'};
      recent.push(operation);
      try{
        const value=await executor(getRoot());
        operation.status='success';
        operation.finishedAt=new Date().toISOString();
        return value;
      }catch(error){
        operation.status='failed';
        operation.finishedAt=new Date().toISOString();
        operation.code=String(error&&error.code||'unknown');
        if(options.reportFailure) options.reportFailure(error,{...meta,operationId:operation.id,keys:[...keys]});
        throw error;
      }
    }
    return {set,remove,transaction,recent:limit=>recent.slice(-Math.max(1,limit||20))};
  }
  return {create};
});
```

The complete implementation must validate `getRoot()`, deduplicate transaction keys, use `transactionKeys()` when present, and fall back to `root.transaction()` only for adapters without keyed transactions.

- [ ] **Step 4: Run the gateway tests and verify GREEN**

Run: `node --test tests/schedule-write-gateway.test.js`

Expected: all gateway tests PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add js/schedule-write-gateway.js tests/schedule-write-gateway.test.js
git commit -m "Add unified schedule write gateway"
```

### Task 2: Main Schedule Integration

**Files:**
- Modify: `index.html:21-30`
- Modify: `js/core.js:150-174, 268-273, 443-480`
- Modify: `js/data.js:1690-1790, 3890-4050`
- Modify: `js/tabs.js:450-620, 1350-1640`
- Test: `tests/schedule-write-gateway.test.js`

**Interfaces:**
- Consumes: `SCScheduleWriteGateway.create()` from Task 1.
- Produces: main-page `_scheduleWrites`, Promise-returning `dbSetAsync()` and `dbRemoveAsync()`, and gateway-backed `updateScheduleTx()`.

- [ ] **Step 1: Add failing integration assertions**

```js
test('main runtime loads the gateway before core', () => {
  const html=read('index.html');
  assert.ok(html.indexOf("scJs('js/schedule-write-gateway.js')") < html.indexOf("scJs('js/core.js')"));
});

test('main transaction delegates to the write gateway', () => {
  const source=read('js/data.js');
  assert.match(source, /_scheduleWrites\.transaction\(txSafeKeys/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/schedule-write-gateway.test.js`

Expected: FAIL because the main runtime has not loaded or used the gateway.

- [ ] **Step 3: Load and configure the gateway**

Insert `js/schedule-write-gateway.js` after `js/firebase-store.js`. In `core.js`, create one gateway whose `getRoot` returns `_fb` and whose failure reporter calls `_reportFirebaseWriteFailure(error,label)`.

Implement:

```js
function dbSetAsync(key,val,meta){
  if(!canPersistScheduleData(key,meta?.label||'저장')) return Promise.reject(new Error('write blocked'));
  return _scheduleWrites.set(safeKey(key),jsonValue(val),meta);
}

function dbRemoveAsync(key,meta){
  if(!canPersistScheduleData(key,meta?.label||'삭제')) return Promise.reject(new Error('write blocked'));
  return _scheduleWrites.remove(safeKey(key),meta);
}
```

Keep local cache updates in one helper. On failure, invalidate the optimistic cache and fetch that key from the server before allowing another edit.

- [ ] **Step 4: Route transactions and direct main-page writes**

Replace Firebase transaction selection inside `updateScheduleTx()` with:

```js
return _scheduleWrites.transaction(txSafeKeys, root=>{
  // existing mutator and audit capture remain unchanged
  return root;
}, meta);
```

Route snapshot, tab, audit-entry, restore-entry, delete-safety, and legacy map saves through the same gateway. Audit-entry calls pass `{internal:true}` so they do not generate another schedule audit entry.

- [ ] **Step 5: Run focused and existing data tests**

Run: `node --test tests/schedule-write-gateway.test.js tests/firebase-write-error.test.js tests/schedule-audit-dedupe.test.js tests/schedule-audit-move.test.js tests/realtime-rollover.test.js`

Expected: all tests PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add index.html js/core.js js/data.js js/tabs.js tests/schedule-write-gateway.test.js
git commit -m "Route main schedule writes through gateway"
```

### Task 3: Teacher, Desk, and Settings Integration

**Files:**
- Modify: `teacher.html:21-31`
- Modify: `desk.html:21-31`
- Modify: `settings.html:21-32`
- Modify: `js/teacher.js:358-475, 530-575`
- Modify: `js/desk.js:180-270`
- Modify: `js/settings.js:2080-2120, 3270-3330`
- Test: `tests/schedule-write-gateway.test.js`
- Test: `tests/attendance-teacher-permission.test.js`

**Interfaces:**
- Consumes: the shared gateway module and each page's existing Firebase root/auth guard.
- Produces: `_teacherWrites`, `_deskWrites`, and `_settingsWrites` gateway instances.

- [ ] **Step 1: Add failing page integration tests**

```js
for(const page of ['teacher.html','desk.html','settings.html']){
  test(`${page} loads the write gateway`,()=>{
    assert.match(read(page),/js\/schedule-write-gateway\.js/);
  });
}

test('teacher runtime has no direct firebase child writes',()=>{
  assert.doesNotMatch(read('js/teacher.js'),/_fb\.child\([^\n]+\)\.(set|remove|transaction)\(/);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test tests/schedule-write-gateway.test.js tests/attendance-teacher-permission.test.js`

Expected: FAIL because the staff pages still write directly.

- [ ] **Step 3: Integrate teacher and desk writes**

Load the gateway after `firebase-store.js`. Preserve `_canWriteTeacherKey()` and desk auth checks before calling the gateway. Replace whole-map set helpers and keyed transactions with gateway methods while keeping their existing return values and post-commit in-memory updates.

- [ ] **Step 4: Integrate settings writes**

Create the settings gateway with `getRoot:()=>branchRoot(activeBranch)`. Route settings and feedback transactions through it. Do not route Aligo HTTP requests through this Firebase gateway.

- [ ] **Step 5: Run staff-page tests**

Run: `node --test tests/schedule-write-gateway.test.js tests/attendance-teacher-permission.test.js tests/staff-makeup-permission.test.js tests/firebase-write-error.test.js`

Expected: all tests PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add teacher.html desk.html settings.html js/teacher.js js/desk.js js/settings.js tests/schedule-write-gateway.test.js tests/attendance-teacher-permission.test.js
git commit -m "Unify staff page schedule writes"
```

### Task 4: Direct-Write Regression Guard

**Files:**
- Create: `tests/schedule-write-boundary.test.js`
- Modify: `package.json:5-12` only if a dedicated verification command is needed

**Interfaces:**
- Consumes: repository JavaScript source files.
- Produces: a test that fails when page code bypasses the write gateway.

- [ ] **Step 1: Write the failing boundary test**

```js
const allowed=new Set([
  'firebase-store.js','schedule-v2-store.js','schedule-v2-shadow.js','schedule-write-gateway.js'
]);
for(const file of runtimeFiles){
  if(allowed.has(path.basename(file))) continue;
  const source=fs.readFileSync(file,'utf8');
  assert.doesNotMatch(source,/_fb\.child\([^\n]+\)\.(set|remove|transaction)\(/,file);
}
```

Also reject direct Firestore `.set()`, `.update()`, `.delete()`, `batch.commit()`, and `runTransaction()` calls outside the approved storage modules.

- [ ] **Step 2: Run the boundary test and verify RED**

Run: `node --test tests/schedule-write-boundary.test.js`

Expected: FAIL listing every remaining direct-write location.

- [ ] **Step 3: Remove or route each reported bypass**

Do not expand the allowlist for page/business files. Only Firebase adapter implementations and the gateway may perform low-level writes.

- [ ] **Step 4: Run the boundary test and verify GREEN**

Run: `node --test tests/schedule-write-boundary.test.js`

Expected: PASS with zero bypasses.

- [ ] **Step 5: Commit Task 4**

```bash
git add tests/schedule-write-boundary.test.js package.json js
git commit -m "Guard schedule write boundaries"
```

### Task 5: Full Verification and Operational Scenarios

**Files:**
- Modify only files required by failures found during verification.

**Interfaces:**
- Consumes: completed Tasks 1-4.
- Produces: verified release candidate with unchanged V1 data shape.

- [ ] **Step 1: Run syntax checks**

Run:

```bash
node --check js/schedule-write-gateway.js
node --check js/core.js
node --check js/data.js
node --check js/tabs.js
node --check js/teacher.js
node --check js/desk.js
node --check js/settings.js
```

Expected: every command exits 0.

- [ ] **Step 2: Run the complete unit suite**

Run: `npm.cmd run test:unit`

Expected: all non-emulator unit tests PASS.

- [ ] **Step 3: Run policy and Firestore rules verification**

Run: `npm.cmd run verify:policy`

Run: `npm.cmd run test:rules`

Expected: permission artifacts are synchronized and all Firestore emulator tests PASS.

- [ ] **Step 4: Check changed storage literals**

Run: `git diff --unified=0 | rg "^[+-].*(swim_|scheduleStores|scheduleV2)"`

Expected: no V1 storage key has been renamed and no V2 operational-read switch was introduced.

- [ ] **Step 5: Perform local browser smoke tests**

Verify, without using production data:

1. Main page loads both branches.
2. A test student edit completes only after the fake/local adapter resolves.
3. Move, retire reservation, absence mark, and makeup mark render correctly.
4. Regular and vacation attendance checkboxes persist after reload.
5. Snapshot view remains read-only.
6. Teacher and desk pages retain their existing permissions.

- [ ] **Step 6: Review final diff and commit fixes**

Run: `git diff --check`

Run: `git status --short`

Commit only tracked implementation and test files. Do not add `HANDOFF.md`, `backup/`, or `outputs/`.

