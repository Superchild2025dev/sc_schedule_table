# Main Schedule Read Coordinator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 메인 시간표의 초기 Firebase 조회와 실시간 변경 반영을 하나의 배치 조정자로 통합하여 중복 초기 조회, 오래된 결과 덮어쓰기, 변경 키 유실, 반복 렌더링을 막는다.

**Architecture:** `js/schedule-read-coordinator.js`는 저장소와 화면을 모르는 순수 상태 조정자다. `js/firebase-store.js`는 Firestore·RTDB 변경을 초기/후속 배치로 제공하고, `js/core.js`는 배치를 기존 `_dbCache`, localStorage, `reloadGlobalData()`, `loadTabData()`, `reloadBadgeMaps()`, `buildTable()`에 연결한다. V1 키와 기존 전역 데이터 형식은 유지한다.

**Tech Stack:** 브라우저 IIFE, CommonJS 테스트 export, Firebase Firestore compat SDK 10.12.2, Firebase Realtime Database compat SDK, Node.js 내장 test runner

## Global Constraints

- 메인 시간표만 변경하고 `teacher.js`, `desk.js`, `settings.js`의 조회 흐름은 변경하지 않는다.
- 기존 V1 저장 키와 JSON 필드 형식을 변경하지 않는다.
- `SCScheduleWriteGateway`와 모든 쓰기 경로를 변경하지 않는다.
- 지연 키, 과거 출석 스냅샷, 기록 본문을 초기 배치에 포함하지 않는다.
- 잘못된 원생 값은 현재 정상 캐시를 지우거나 빈 배열로 바꾸지 않는다.
- 팝업 편집 중에도 원격 변경 키를 버리지 않는다.
- 새 외부 라이브러리를 추가하지 않는다.
- 모든 운영 코드 변경 전에 해당 동작을 검증하는 실패 테스트를 먼저 실행한다.

---

### Task 1: Pure read coordinator

**Files:**
- Create: `js/schedule-read-coordinator.js`
- Create: `tests/schedule-read-coordinator.test.js`

**Interfaces:**
- Produces: `SCScheduleReadCoordinator.create(options)`
- Produces: coordinator methods `start(subscribe)`, `accept(batch)`, `flush()`, `stop()`, `ready()`, `diagnostics(limit)`
- Consumes callbacks: `getRaw(key)`, `setRaw(key, raw)`, `removeRaw(key)`, `validate(key, raw)`, `isRenderBlocked()`, `onRender(keys, meta)`, `onInvalid(keys, meta)`, `onError(error, meta)`

- [ ] **Step 1: Write failing coordinator tests**

Create tests that specify:

```js
const coordinator=create({
  getRaw:key=>cache[key],
  setRaw:(key,value)=>{cache[key]=value;},
  removeRaw:key=>{delete cache[key];},
  validate:(key,value)=>key==='swim_students'?Array.isArray(JSON.parse(value)):true,
  isRenderBlocked:()=>blocked,
  onRender:(keys,meta)=>renders.push({keys:[...keys],meta}),
});
```

Required cases:

- one initial batch resolves `ready()` once and never renders as a remote update;
- multiple values and removals are committed before one `onRender` call;
- duplicate raw values create no render;
- a lower `revision` than `lastAppliedRevision` is ignored;
- invalid `swim_students` preserves the previous cache value while valid sibling keys apply;
- blocked rendering accumulates changed keys and `flush()` renders them once;
- calling `start()` twice creates one subscription;
- `stop()` unsubscribes and prevents later batches from applying.

- [ ] **Step 2: Run the coordinator test and confirm module-not-found failure**

Run: `node --test --test-isolation=none tests/schedule-read-coordinator.test.js`

Expected: FAIL because `js/schedule-read-coordinator.js` does not exist.

- [ ] **Step 3: Implement the coordinator module**

Use a UMD wrapper and keep all mutable state inside `create(options)`:

```js
{
  started:false,
  stopped:false,
  unsubscribe:null,
  lastAppliedRevision:0,
  pendingRenderKeys:new Set(),
  readyResolved:false,
  diagnostics:[],
}
```

`accept(batch)` must:

1. reject stopped or stale revisions;
2. normalize values to raw JSON strings without mutating input;
3. validate every value before writing any cache entry;
4. omit invalid keys and report them through `onInvalid`;
5. apply all valid values and removals synchronously;
6. resolve `ready()` after the first initial batch;
7. suppress initial rendering;
8. either accumulate or render changed keys exactly once.

`start(subscribe)` receives a function accepting `{next,error}` and returning an unsubscribe function. An error before initial readiness rejects `ready()`; a later error calls `onError` without clearing cache.

- [ ] **Step 4: Run syntax and focused tests**

Run: `node --check js/schedule-read-coordinator.js`

Run: `node --test --test-isolation=none tests/schedule-read-coordinator.test.js`

Expected: all coordinator tests pass.

- [ ] **Step 5: Commit**

Commit message: `Add main schedule read coordinator`

---

### Task 2: Firebase batch subscription

**Files:**
- Modify: `js/firebase-store.js`
- Modify: `tests/firebase-store-listener.test.js`

**Interfaces:**
- Produces: `FirestoreKVRoot.prototype.subscribeBatches(handlers)`
- Produces batch: `{initial, revision, values, removedKeys, changedKeys}`
- Preserves: `once('value')`, `on('child_changed')`, `on('child_removed')`

- [ ] **Step 1: Extend the Firestore harness with failing batch tests**

Update the harness so `onSnapshot(next,error)` stores both callbacks. Add assertions for:

```js
const batches=[];
const unsubscribe=root.subscribeBatches({next:batch=>batches.push(batch)});
await harness.emit(makeSnapshot([studentDoc,instDoc]));
assert.equal(batches.length,1);
assert.equal(batches[0].initial,true);
assert.deepEqual(Object.keys(batches[0].values).sort(),['swim_inst','swim_students']);
```

Also test:

- a modified student and mark document arrive in one non-initial batch;
- a removed document appears only in `removedKeys`;
- unchanged stored versions do not appear in later batches;
- calling the returned unsubscribe stops delivery;
- two subscriptions on one root are rejected or share one underlying listener rather than creating duplicate snapshots.

- [ ] **Step 2: Run the listener test and confirm `subscribeBatches` is missing**

Run: `node --test --test-isolation=none tests/firebase-store-listener.test.js`

Expected: FAIL because `root.subscribeBatches` is not defined.

- [ ] **Step 3: Implement Firestore batch delivery**

Add separate batch-listener state to `FirestoreKVRoot`:

```js
this.firestoreBatchUnsubscribe=null;
this.firestoreBatchSubscribers=new Set();
this.firestoreBatchInitialized=false;
this.firestoreBatchRevision=0;
this.firestoreBatchQueue=Promise.resolve();
```

The first `onSnapshot` must read every non-deferred live document, wait for every `_readStoredValue`, and emit one `initial:true` batch. Later snapshots read only version-changed documents. Set `firestoreVersions` only after each value is read successfully. If one value fails, call `handlers.error` and omit only that key from the batch.

When the final batch subscriber unsubscribes, stop the underlying listener and reset initial state without deleting the current `firestoreVersions` map.

- [ ] **Step 4: Implement RTDB/raw-ref batch adapter**

Export `SCFirebaseStore.subscribeRootBatches(root,handlers)`:

- if `root.subscribeBatches` exists, delegate to it;
- otherwise attach `child_changed` and `child_removed` first and queue their events;
- perform one `root.once('value')` for the initial non-deferred data;
- emit the initial batch, then drain queued child events in one follow-up batch;
- batch later child events in the same microtask;
- return one unsubscribe function that removes both RTDB listeners.

- [ ] **Step 5: Run listener regression tests**

Run: `node --check js/firebase-store.js`

Run: `node --test --test-isolation=none tests/firebase-store-listener.test.js`

Expected: existing six listener tests and all new batch tests pass.

- [ ] **Step 6: Commit**

Commit message: `Add batched Firebase subscriptions`

---

### Task 3: Route main initial load through the coordinator

**Files:**
- Modify: `index.html`
- Modify: `js/core.js`
- Create: `tests/schedule-read-integration.test.js`

**Interfaces:**
- Consumes: `window.SCScheduleReadCoordinator.create(options)`
- Consumes: `SCFirebaseStore.subscribeRootBatches(root,handlers)`
- Produces: `_scheduleReadCoordinator`, `_applyScheduleReadBatchValue`, `_removeScheduleReadBatchValue`, `_renderRemoteScheduleBatch`
- Preserves: `loadFromFirebase(callback)` signature

- [ ] **Step 1: Add failing script-order and source-boundary tests**

Require:

- `index.html` loads `js/schedule-read-coordinator.js` after `firebase-store.js` and before `core.js`;
- `loadFromFirebase` calls `_scheduleReadCoordinator.start` and waits for `.ready()`;
- `loadFromFirebase` no longer calls `_fb.once('value')` on the Firestore/coordinator path;
- `_attachFirebaseDataListeners` no longer contains direct `_fb.on('child_changed')` or `_fb.on('child_removed')` calls;
- `_dbCache` remote writes in the initial/live path occur only through `_applyScheduleReadBatchValue` and `_removeScheduleReadBatchValue`.

- [ ] **Step 2: Run integration tests and confirm delegation assertions fail**

Run: `node --test --test-isolation=none tests/schedule-read-integration.test.js`

- [ ] **Step 3: Load and configure the coordinator**

Add the script to `index.html`. In `core.js`, lazily create one coordinator per page load with:

```js
getRaw:key=>Object.prototype.hasOwnProperty.call(_dbCache,key)?_dbCache[key]:null,
setRaw:_applyScheduleReadBatchValue,
removeRaw:_removeScheduleReadBatchValue,
validate:(key,raw)=>_validStudentPayload(key,raw),
isRenderBlocked:()=>typeof _popupOpen==='function'&&_popupOpen(),
onRender:(keys,meta)=>_renderRemoteScheduleBatch(keys,meta),
onInvalid:(keys,meta)=>_recordDataSyncDiagnostic('ignored-invalid-students',keys,...),
onError:error=>_handleScheduleReadError(error),
```

The cache setters must always update `_dbCache`; localStorage is updated only for non-ephemeral keys. The remote server value is authoritative after successful authentication and must replace a stale longer localStorage value.

- [ ] **Step 4: Replace initial `once` flow**

For a store exposing `SCFirebaseStore.subscribeRootBatches`, `loadFromFirebase` must:

1. call coordinator `start` once;
2. await `ready()`;
3. set `_firebaseUsingLocalFallback=false` and `_firebaseLoaded=true`;
4. call the existing startup callback once.

If the batch subscription API is unavailable, preserve the current raw RTDB `once('value')` compatibility branch. If readiness fails, keep the current cache read-only, show one error, and still call the startup callback once.

- [ ] **Step 5: Replace remote render batching**

`_renderRemoteScheduleBatch(keys,meta)` must preserve current behavior:

- snapshot tabs reload only their matching snapshot key;
- otherwise call `reloadGlobalData()` once;
- call `loadTabData()` only if the active tab or its student/teacher key changed;
- call `reloadBadgeMaps()` and `buildTable()` once;
- record before/after counts in `SCDataDiagnostics`.

Remove the 60ms timer for Firestore batches. Keep `_queueRemoteScheduleRefresh` as a compatibility wrapper for write-failure refresh and raw RTDB paths, but route its final key set through `_renderRemoteScheduleBatch`.

- [ ] **Step 6: Run focused main integration tests**

Run: `node --check js/core.js`

Run: `node --test --test-isolation=none tests/schedule-read-coordinator.test.js tests/firebase-store-listener.test.js tests/schedule-read-integration.test.js tests/firebase-write-error.test.js`

Expected: all focused tests pass.

- [ ] **Step 7: Commit**

Commit message: `Centralize main schedule reads`

---

### Task 4: Preserve pending changes while a popup is open

**Files:**
- Modify: `js/core.js`
- Modify: `js/popup-stu.js`
- Modify: `js/teachers.js`
- Modify: `tests/schedule-read-integration.test.js`

**Interfaces:**
- Produces: `flushPendingScheduleReads()`
- Consumes: `_scheduleReadCoordinator.flush()`
- Preserves: `_pendingSync` compatibility flag

- [ ] **Step 1: Add failing pending-key tests**

Source assertions must require both popup close paths to call `flushPendingScheduleReads()` instead of directly calling all four reload/render functions. Add a coordinator unit case where two blocked batches change different keys and one flush renders the union once.

- [ ] **Step 2: Run focused tests and confirm old close handlers fail**

Run: `node --test --test-isolation=none tests/schedule-read-coordinator.test.js tests/schedule-read-integration.test.js`

- [ ] **Step 3: Implement one flush path**

`flushPendingScheduleReads()` must:

- clear `_pendingSync` only after the coordinator flush runs;
- call coordinator `flush()` when available;
- retain the old full reload sequence only as a compatibility fallback;
- do nothing when no keys are pending.

Update the student and teacher popup close handlers to call this function once.

- [ ] **Step 4: Run popup and movement regressions**

Run: `node --test --test-isolation=none tests/schedule-read-coordinator.test.js tests/schedule-read-integration.test.js tests/schedule-audit-move.test.js tests/replacement-retire-preserve.test.js tests/schedule-reservation-identity.test.js`

Expected: all tests pass.

- [ ] **Step 5: Commit**

Commit message: `Preserve pending realtime schedule changes`

---

### Task 5: Regression boundary and full verification

**Files:**
- Modify: `tests/schedule-read-integration.test.js`

**Interfaces:**
- Produces source guard preventing direct main Firebase listeners from returning

- [ ] **Step 1: Add the final read-boundary guard**

Scan the main read section in `core.js` and require:

- one `SCScheduleReadCoordinator.create` call;
- one `SCFirebaseStore.subscribeRootBatches` adapter;
- no direct `_fb.on('child_changed')` or `_fb.on('child_removed')` in the main path;
- no Firestore initial `_fb.once('value')` before coordinator readiness;
- no clearing of pending keys before a popup flush.

- [ ] **Step 2: Run syntax checks**

Run `node --check` for:

- `js/schedule-read-coordinator.js`
- `js/firebase-store.js`
- `js/core.js`
- `js/popup-stu.js`
- `js/teachers.js`

- [ ] **Step 3: Run the complete suite**

Run: `node --test --test-isolation=none tests/*.test.js`

Expected: all runnable tests pass; the optional Firestore emulator test may remain skipped when the emulator environment is absent.

- [ ] **Step 4: Verify permission and diff safety**

Run: `node scripts/sync-permission-policy.js --check`

Run: `git diff --check`

Run: `git status --short`

Expected: permission artifacts are synchronized, no whitespace errors exist, and only planned files plus the user's existing untracked files are present.

- [ ] **Step 5: Commit**

Commit message: `Guard centralized main schedule reads`
