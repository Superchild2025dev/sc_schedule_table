# V2 Operational Concurrency Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 일반 데이터 수정이 다른 기기를 재시작하거나 독립 저장을 실패시키지 않으면서 V2의 권한, 세대, 멱등성, 동일 대상 충돌 보호를 유지한다.

**Architecture:** 운영 권한 신원은 `branchId/mode/generationId/epoch`로 한정하고 `revision`은 데이터 동시성에만 사용한다. 클라이언트는 owner별 조회와 변경 의도를 관리하고, 서버는 변경 대상 문서 digest를 기준으로 충돌을 판정하며 출석은 record 단위로 저장한다.

**Tech Stack:** Vanilla JavaScript, Firebase Firestore 10.x, Firebase Functions v2, Node.js test runner, in-memory Firestore fixtures.

## Global Constraints

- V1, shadow, verify, v2-read, v2 모드의 기존 전환 경로를 유지한다.
- 교사는 가경점과 용암점 출석, 결석, 보강 작업을 기존과 동일하게 사용할 수 있다.
- 운영 mode, generationId, epoch 변경은 계속 전체 화면 재시작 사유다.
- 동일 대상 충돌은 자동 덮어쓰지 않는다.
- 개인정보를 진단 로그와 오류 메시지에 남기지 않는다.
- 각 생산 코드 변경 전에 해당 동작을 재현하는 실패 테스트를 실행한다.
- 각 task가 통과하기 전 다음 task를 시작하지 않는다.

---

### Task 1: 운영 권한 신원과 데이터 revision 분리

**Files:**
- Modify: `js/schedule-operational-gateway.js:71-290`
- Modify: `js/attendance-operational-gateway.js:64-143`
- Modify: `js/firebase-store.js:1299-1314`
- Test: `tests/schedule-operational-gateway.test.js`
- Test: `tests/attendance-operational-gateway.test.js`
- Test: `tests/schedule-v2-main-integration.test.js`

**Interfaces:**
- Produces: `authorityFingerprint(config)` using branch, mode, generation, epoch only.
- Produces: `revisionOf(config)` for data freshness without reload.
- Produces: recoverable `ready()` that retries after a failed initial read and accepts a later listener value.
- Consumes: existing `v2Store.readConfig()` and `v2Store.subscribeConfig(next, error)`.

- [ ] **Step 1: Write failing tests for revision-only notifications and initial recovery**

```js
test('an external revision advance refreshes data authority without requesting a page reload',async()=>{
  const env=createEnvironment('v2-read');
  await env.root.ready();
  env.emitConfig({
    branchId:'yongam',mode:'v2-read',generationId:'gen_1',epoch:4,revision:32,valid:true,
  });
  assert.equal(env.calls.reloads,0);
  assert.equal(env.root.currentConfig().revision,32);
});

test('a transient initial authority failure recovers from the next successful read',async()=>{
  const env=createEnvironment('v2-read',{configErrors:[Object.assign(new Error('offline'),{code:'unavailable'})]});
  const first=await env.root.ready();
  assert.equal(first.valid,false);
  const recovered=await env.root.ready();
  assert.equal(recovered.valid,true);
  assert.equal(env.calls.configSubscriptions,1);
});

test('mode generation and epoch changes still request one reload',async()=>{
  for(const patch of [{mode:'v1',generationId:''},{generationId:'gen_2'},{epoch:5}]){
    const env=createEnvironment('v2-read');
    await env.root.ready();
    env.emitConfig({...env.root.currentConfig(),...patch});
    assert.equal(env.calls.reloads,1);
  }
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node tests/schedule-operational-gateway.test.js`

Expected: revision-only notification requests reload; transient initial failure remains invalid.

- [ ] **Step 3: Implement separate authority and revision handling**

```js
function authorityFingerprint(config){
  return [text(config?.branchId),text(config?.mode),text(config?.generationId),Number(config?.epoch)||0].join('|');
}
function revisionOf(config){
  return Math.max(0,Number(config?.revision)||0);
}
```

Change config subscription behavior so an authority fingerprint change calls `requestReload(next)`, while a revision-only change updates `config.revision`, invalidates selected data, and invokes a scoped refresh callback without stopping controllers.

Start the config listener before awaiting the first read. On initial `unavailable`, clear `readyPromise` after returning an invalid read-only result so the next call can retry. Do not expose V1 values as an authoritative V2 screen before a valid pointer has been observed.

Change the session reload fingerprint to authority identity only. Store the fingerprint only immediately before a real reload, and clear it after the next successful authority initialization.

- [ ] **Step 4: Run Task 1 tests and full gateway regressions**

Run: `node tests/schedule-operational-gateway.test.js`

Run: `node tests/attendance-operational-gateway.test.js`

Run: `node tests/schedule-v2-main-integration.test.js`

Expected: all pass; revision-only tests report zero reloads.

- [ ] **Step 5: Commit Task 1**

```bash
git add js/schedule-operational-gateway.js js/attendance-operational-gateway.js js/firebase-store.js tests/schedule-operational-gateway.test.js tests/attendance-operational-gateway.test.js tests/schedule-v2-main-integration.test.js
git commit -m "fix: separate V2 authority from data revision"
```

---

### Task 2: 조회 취소 범위를 owner별로 분리

**Files:**
- Modify: `js/schedule-v2-operational-store.js:205-465`
- Modify: `js/schedule-operational-gateway.js:292-387`
- Modify: `js/attendance-main-runtime.js:90-190`
- Test: `tests/schedule-v2-operational-store.test.js`
- Test: `tests/schedule-operational-gateway.test.js`
- Test: `tests/attendance-v2-main-integration.test.js`

**Interfaces:**
- Produces: `loadSelection({...selection, owner})` and `loadMutation({...selection, owner})`.
- Produces: `invalidate(owner)` for scoped cancellation and `invalidate()` for authority-wide cancellation.
- Consumes: stable owner strings `schedule-main`, `schedule-modal:*`, `schedule-export`, `schedule-mutation:*`, `attendance-main`, `attendance-teacher`.

- [ ] **Step 1: Write failing tests for independent owners**

```js
test('independent selection owners do not cancel each other',async()=>{
  const env=createStoreEnvironment();
  const first=env.store.loadSelection({...regularSelection,owner:'schedule-main'});
  const second=env.store.loadSelection({...regularSelection,owner:'schedule-modal:student'});
  env.resolveAllReads();
  const results=await Promise.allSettled([first,second]);
  assert.deepEqual(results.map(result=>result.status),['fulfilled','fulfilled']);
});

test('a newer request cancels only an older request from the same owner',async()=>{
  const env=createStoreEnvironment();
  const oldRequest=env.store.loadSelection({...regularSelection,owner:'schedule-main'});
  const newRequest=env.store.loadSelection({...summerSelection,owner:'schedule-main'});
  env.resolveAllReads();
  await assert.rejects(()=>oldRequest,error=>error.code==='stale-operational-selection');
  await newRequest;
});
```

- [ ] **Step 2: Run store tests and verify RED**

Run: `node tests/schedule-v2-operational-store.test.js`

Expected: the first independent owner is rejected by the current global `selectionVersion`.

- [ ] **Step 3: Replace global selection version with owner versions**

```js
const selectionVersions=new Map();
function beginSelection(owner){
  const key=text(owner)||'schedule-main';
  const version=(selectionVersions.get(key)||0)+1;
  selectionVersions.set(key,version);
  return {key,version};
}
function assertSelectionCurrent(token,started,latest){
  if(selectionVersions.get(token.key)!==token.version||!sameAuthority(started,latest)){
    fail('stale-operational-selection','이전 운영 데이터 조회 결과는 사용할 수 없습니다.');
  }
}
```

Mutation owner에는 operation ID를 포함하고, 화면 조회 owner와 공유하지 않는다. Authority 변경 시에만 모든 owner version을 증가시킨다.

- [ ] **Step 4: Run Task 2 tests**

Run: `node tests/schedule-v2-operational-store.test.js`

Run: `node tests/schedule-operational-gateway.test.js`

Run: `node tests/attendance-v2-main-integration.test.js`

Expected: independent owners both resolve; same owner의 오래된 응답만 stale 처리된다.

- [ ] **Step 5: Commit Task 2**

```bash
git add js/schedule-v2-operational-store.js js/schedule-operational-gateway.js js/attendance-main-runtime.js tests/schedule-v2-operational-store.test.js tests/schedule-operational-gateway.test.js tests/attendance-v2-main-integration.test.js
git commit -m "fix: scope V2 reads by owner"
```

---

### Task 3: 저장 성공과 화면 컨텍스트 분리

**Files:**
- Modify: `js/schedule-operational-gateway.js:445-607`
- Modify: `js/schedule-live-handlers.js:180-230`
- Test: `tests/schedule-operational-gateway.test.js`
- Test: `tests/schedule-live-handlers-wiring.test.js`

**Interfaces:**
- Produces: accepted server response remains committed even if selection owner changed.
- Produces: `invalidateSelection(selection)` callback after a committed response for a no-longer-visible tab.
- Consumes: authority identity captured at mutation start.

- [ ] **Step 1: Write failing test for tab switch after server commit**

```js
test('a committed save remains successful after the user changes tabs',async()=>{
  const mutation=deferred();
  const env=createEnvironment('v2-read',{mutationPromise:mutation.promise});
  await env.root.ready();
  const save=env.root.transactionKeys(['swim_students'],draft=>{
    draft.swim_students='[{"id":"student-1","name":"saved"}]';
    return draft;
  },{operationId:'save_then_switch',operationType:'update-student',tabIds:['regular']});
  env.changeSelection(['summer']);
  mutation.resolve({operationId:'save_then_switch',committed:true,revision:32,recoveryState:'applied'});
  const result=await save;
  assert.equal(result.committed,true);
  assert.equal(env.root.currentConfig().revision,32);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node tests/schedule-operational-gateway.test.js`

Expected: current code throws `stale-operational-response` after server success.

- [ ] **Step 3: Accept committed responses by authority and operation identity**

After callable success, validate `operationId`, resulting revision, branch, generation, and epoch. Do not call the selection-sensitive `assertCurrent` after the server has confirmed commit. Update revision, invalidate the mutation selection cache, and return committed result. Only inject values into the currently visible cache when the owner token is still current.

- [ ] **Step 4: Run Task 3 tests**

Run: `node tests/schedule-operational-gateway.test.js`

Run: `node tests/schedule-live-handlers-wiring.test.js`

Expected: save is successful, old tab cache is invalidated, current tab remains unchanged.

- [ ] **Step 5: Commit Task 3**

```bash
git add js/schedule-operational-gateway.js js/schedule-live-handlers.js tests/schedule-operational-gateway.test.js tests/schedule-live-handlers-wiring.test.js
git commit -m "fix: preserve committed saves across tab changes"
```

---

### Task 4: 시간표 동시 저장을 변경 의도 기준으로 재적용

**Files:**
- Modify: `js/schedule-operational-gateway.js:427-607`
- Modify: `functions/schedule-v2-operational-writer.js:157-535`
- Test: `tests/full-v2-concurrency.test.js`
- Test: `tests/function-schedule-v2-operational-writer.test.js`
- Test: `tests/schedule-operational-gateway.test.js`

**Interfaces:**
- Produces: `isRevisionConflict(error, started, latest)` that distinguishes stale revision from authority changes.
- Produces: maximum three conflict attempts with one captured mutation intent.
- Consumes: existing document `beforeExists` and `beforeDigest` checks.

- [ ] **Step 1: Add failing three-writer and authority-change tests**

```js
test('three concurrent independent edits all survive conflict rebasing',async()=>{
  const system=createOperationalSystem({branches:['yongam'],mode:'v2-read',deriveBarrierCount:3});
  const gateways=[system.gateway('yongam'),system.gateway('yongam'),system.gateway('yongam')];
  await Promise.all(gateways.map(gateway=>gateway.ready()));
  const results=await Promise.allSettled([
    updateStudent(gateways[0],'swim_students','Y_r1','First','three_1'),
    updateStudent(gateways[1],'swim_students','Y_r2','Second','three_2'),
    updateTeacher(gateways[2],'swim_inst','4PM/Mon/1','Teacher','three_3'),
  ]);
  assert.deepEqual(results.map(result=>result.status),['fulfilled','fulfilled','fulfilled']);
});
```

Retain the existing same-student test expecting one fulfilled and one `aborted` result.

- [ ] **Step 2: Run concurrency tests and verify RED**

Run: `node tests/full-v2-concurrency.test.js`

Expected: one of the three independent edits fails with `operational-reload-required` or a revision precondition error.

- [ ] **Step 3: Implement bounded intent rebase loop**

Capture `originalBefore` and `originalAfter` once. For each attempt, read the latest mutation selection, calculate `rebaseRoot(originalBefore, originalAfter, latestRoot)`, and submit against the latest revision. Retry only when:

```js
sameAuthority(started,latest)
  && latest.revision>started.revision
  && ['aborted','failed-precondition'].includes(callableCode(error))
```

Use a maximum of three attempts. Keep the same operation ID. A same-document digest change remains `aborted`; mode, generation, or epoch change remains `operational-reload-required`.

Server-side `assertRuntime` continues to reject authority changes. Revision mismatch remains a definitive no-write response so a client can safely rebase with the same operation ID.

- [ ] **Step 4: Run Task 4 tests**

Run: `node tests/full-v2-concurrency.test.js`

Run: `node tests/function-schedule-v2-operational-writer.test.js`

Run: `node tests/schedule-operational-gateway.test.js`

Expected: three independent edits pass; same-target collision and authority-change tests still reject safely.

- [ ] **Step 5: Commit Task 4**

```bash
git add js/schedule-operational-gateway.js functions/schedule-v2-operational-writer.js tests/full-v2-concurrency.test.js tests/function-schedule-v2-operational-writer.test.js tests/schedule-operational-gateway.test.js
git commit -m "fix: rebase concurrent V2 schedule intents"
```

---

### Task 5: 출석을 record 단위 변경으로 저장

**Files:**
- Modify: `js/attendance-v2-model.js`
- Modify: `js/attendance-v2-store.js:253-343`
- Modify: `js/attendance-operational-gateway.js:256-335`
- Modify: `functions/schedule-v2-operational-policy.js`
- Modify: `functions/schedule-v2-operational-writer.js`
- Test: `tests/attendance-v2-model.test.js`
- Test: `tests/attendance-v2-store.test.js`
- Test: `tests/attendance-operational-gateway.test.js`
- Test: `tests/attendance-v2-operational-scenarios.test.js`
- Test: `tests/full-v2-operational-scenarios.test.js`

**Interfaces:**
- Produces: `recordChangesFromLegacyDiff({kind, tabId, courseType, before, after, recordMeta})`.
- Produces request field `recordChanges`, each item containing collection, id, type, value, beforeExists, beforeDigest.
- Consumes existing strict callable and operation ID.

- [ ] **Step 1: Add failing independent attendance concurrency test**

```js
test('two simultaneous attendance edits to different records both commit',async()=>{
  const system=createOperationalSystem({branches:['yongam'],mode:'v2-read'});
  const first=system.liveHandlers('yongam');
  const second=system.liveHandlers('yongam');
  const results=await Promise.allSettled([
    checkAttendance(first,'4PM/Mon/1/1/2026-08-11','present','attendance_a'),
    checkAttendance(second,'5PM/Tue/1/1/2026-08-11','present','attendance_b'),
  ]);
  assert.deepEqual(results.map(result=>result.status),['fulfilled','fulfilled']);
});
```

Add a second test where both requests modify the same record and assert one `aborted` result.

- [ ] **Step 2: Run attendance scenario test and verify RED**

Run: `node tests/attendance-v2-operational-scenarios.test.js`

Expected: one independent attendance write fails with `aborted`.

- [ ] **Step 3: Implement record diff requests**

```js
const recordChanges=model().recordChangesFromLegacyDiff({
  kind,tabId,courseType,before:input.before,after:input.after,recordMeta:input.recordMeta,
});
```

Do not call `readWholeMap()` before saving. Send only `recordChanges` and the latest authority pointer. Validate every record ID and collection on the server, then reuse `commitV2Mutation()` with direct document changes. Derive V1 recovery values after commit from the resulting V2 attendance collection.

On definitive revision conflict with unchanged target digests, reread only the affected dates and retry up to three times. On same-record digest conflict, refresh the owner and return `aborted` without overwriting.

- [ ] **Step 4: Run Task 5 tests**

Run: `node tests/attendance-v2-model.test.js`

Run: `node tests/attendance-v2-store.test.js`

Run: `node tests/attendance-operational-gateway.test.js`

Run: `node tests/attendance-v2-operational-scenarios.test.js`

Run: `node tests/full-v2-operational-scenarios.test.js`

Expected: independent attendance saves pass, same record conflicts, V1 mirror recovery preserves dates outside the visible range.

- [ ] **Step 5: Commit Task 5**

```bash
git add js/attendance-v2-model.js js/attendance-v2-store.js js/attendance-operational-gateway.js functions/schedule-v2-operational-policy.js functions/schedule-v2-operational-writer.js tests/attendance-v2-model.test.js tests/attendance-v2-store.test.js tests/attendance-operational-gateway.test.js tests/attendance-v2-operational-scenarios.test.js tests/full-v2-operational-scenarios.test.js
git commit -m "fix: store V2 attendance by record intent"
```

---

### Task 6: 일반 저장을 관련 도메인만 검증하도록 축소

**Files:**
- Modify: `functions/schedule-v2-operational-writer.js:550-605`
- Modify: `js/schedule-v2-operational-model.js`
- Test: `tests/function-schedule-v2-operational-writer.test.js`
- Test: `tests/full-v2-operational-scenarios.test.js`
- Test: `tests/full-v2-rollback.test.js`

**Interfaces:**
- Produces: `collectionsForMutationKeys(keys)`.
- Produces: `validateMutationProjection({keys, beforeCollections, afterCollections})`.
- Preserves: `diagnoseLegacyRoot()` full-generation validation for migration, verification, backup, and rollback only.

- [ ] **Step 1: Add failing test proving unrelated corruption does not block a valid attendance edit**

```js
test('unrelated historical corruption does not block a current attendance mutation',async()=>{
  const db=writerFixture({invalidUnrelatedSnapshot:true});
  const result=await createWriter(db).mutate(attendanceRequest({
    operationId:'attendance_with_unrelated_history_error',
  }));
  assert.equal(result.committed,true);
});

test('a broken direct enrollment reference still blocks a placement mutation',async()=>{
  const db=writerFixture({brokenTargetEnrollment:true});
  await assert.rejects(()=>createWriter(db).mutate(studentMoveRequest()),error=>error.code==='failed-precondition');
});
```

- [ ] **Step 2: Run writer tests and verify RED**

Run: `node tests/function-schedule-v2-operational-writer.test.js`

Expected: unrelated invalid snapshot causes the current full-generation diagnostic to reject the attendance mutation.

- [ ] **Step 3: Implement mutation projection validation**

Map keys to required collections using existing `DOMAIN_COLLECTIONS` and `SHARED_KEY_COLLECTIONS`. Read only those collections plus directly referenced rows. Reconstruct and diagnose the mutation projection, verify its references, and calculate collection changes only for the affected collections.

Keep `readGenerationCollections()` and full `diagnoseLegacyRoot()` unchanged for transition and rollback functions.

- [ ] **Step 4: Run Task 6 tests**

Run: `node tests/function-schedule-v2-operational-writer.test.js`

Run: `node tests/full-v2-operational-scenarios.test.js`

Run: `node tests/full-v2-rollback.test.js`

Expected: unrelated corruption does not block; direct broken references still block; rollback parity remains exact.

- [ ] **Step 5: Commit Task 6**

```bash
git add functions/schedule-v2-operational-writer.js js/schedule-v2-operational-model.js tests/function-schedule-v2-operational-writer.test.js tests/full-v2-operational-scenarios.test.js tests/full-v2-rollback.test.js
git commit -m "perf: validate only affected V2 domains"
```

---

### Task 7: 전체 운영 회귀와 배포 전 검증

**Files:**
- Create: `docs/operations/schedule-v2-runbook.md`
- Create: `docs/operations/schedule-v2-deployment-checklist.md`
- Test: `tests/full-v2-operational-scenarios.test.js`
- Test: `tests/full-v2-concurrency.test.js`
- Test: `tests/firestore-rules-security.test.js`
- Test: `tests/function-schedule-v2-operational-api.test.js`

**Interfaces:**
- Produces: documented rollout order `v1 -> shadow -> verify -> v2-read -> v2`.
- Produces: rollback trigger based on authority identity, recovery queue, and mismatch counts.

- [ ] **Step 1: Add final operational scenario assertions**

Cover both branches and both course types for student registration, movement, retirement, absence, makeup, mandatory makeup, attendance, guest attendance, snapshot, tab change, and rollback. Assert no remote revision causes page reload and no PII appears in diagnostics.

- [ ] **Step 2: Run the complete V2 test set**

Run: `npm.cmd run test:unit`

Expected: zero failures.

- [ ] **Step 3: Run syntax, rules, and function verification**

Run: `node --check js/schedule-operational-gateway.js`

Run: `node --check js/attendance-operational-gateway.js`

Run: `node --check functions/schedule-v2-operational-writer.js`

Run: `node tests/firestore-rules-security.test.js`

Run: `node tests/function-schedule-v2-operational-api.test.js`

Expected: zero syntax or policy failures.

- [ ] **Step 4: Update the runbook with observable rollout gates**

Document these exact gates before each mode transition:

- recovery pending, processing, error count are all zero;
- mismatch count is zero for both branches;
- concurrent schedule and attendance scenarios pass;
- no revision-only reload appears in browser diagnostics;
- rollback command and last verified generation are recorded.

- [ ] **Step 5: Confirm worktree cleanliness and commit verification docs**

```bash
git add docs/operations/schedule-v2-runbook.md docs/operations/schedule-v2-deployment-checklist.md tests/full-v2-operational-scenarios.test.js tests/full-v2-concurrency.test.js
git commit -m "test: verify V2 operational concurrency rollout"
git status --short
```

Expected: clean worktree after commit. Do not push, deploy rules, deploy functions, change runtime mode, or update Lightsail until the user explicitly requests deployment.
