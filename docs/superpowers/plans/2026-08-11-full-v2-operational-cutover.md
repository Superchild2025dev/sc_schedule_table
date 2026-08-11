# Full V2 Operational Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 가경점과 용암점의 직원용 시간표·출석·결석·보강·예약·기록을 V2 개별 문서에서 읽고 저장하며, 안정화 기간에는 V1 복구본을 자동으로 유지한다.

**Architecture:** 기존 화면 함수가 사용하는 V1 형태는 `SCOperationalSchedule` 관문 안에서만 호환한다. 관문은 지점별 `runtime/operational` 포인터를 확인하고 `v2-read`/`v2`에서 선택한 탭과 업무 범위의 V2 문서만 조합한다. 모든 V2 변경은 서버 callable이 현재 `epoch`와 세대·수정 버전을 검증한 뒤 개별 문서를 저장하며, `v2-read`에서는 같은 작업 ID로 V1 복구본 갱신을 추적한다.

**Tech Stack:** Browser JavaScript UMD modules, Firebase Firestore compat SDK 10.12, Firebase Functions v2 Node.js, Firebase Admin SDK, Firestore Security Rules, Node.js built-in test runner, Firebase Emulator Suite.

## Global Constraints

- 전환 대상은 직원용 메인·선생님·데스크·설정 화면이며 학부모 페이지는 V1에 유지한다.
- 친구추천과 고객의 소리 데이터는 변경하지 않는다.
- 가경점과 용암점은 별도 V2 세대와 런타임 포인터를 사용한다.
- `v2-read`에서는 V2가 유일한 화면 원본이고 V1은 복구본이다.
- V2 조회 실패를 같은 화면에서 V1 값으로 임의 보충하지 않는다.
- V1 복구 대기·오류 또는 V1/V2 불일치가 있으면 `v1` 복귀와 `v2` 확정을 차단한다.
- 화면의 기존 UX, 권한과 한국어 문구는 데이터 전환 때문에 바꾸지 않는다.
- 기존 `personId`, `enrollmentId`, `placementId`와 V2 컬렉션 이름을 유지한다.
- 진단 로그에는 이름, 전화번호, 메모와 저장 원문을 기록하지 않는다.
- 코드 배포만으로 운영 모드를 자동 변경하지 않는다.
- 각 기능 구현은 실패하는 테스트 확인, 최소 구현, 전체 회귀 확인, 독립 커밋 순으로 진행한다.

---

### Task 1: V2 Operational Round-Trip Model

**Files:**
- Create: `js/schedule-v2-operational-model.js`
- Create: `functions/schedule-v2-operational-model.js`
- Create: `tests/schedule-v2-operational-model.test.js`
- Modify: `tests/function-v2-shared-sync.test.js`

**Interfaces:**
- Consumes: `SCScheduleSchemaV2.diagnoseLegacyRoot(branchId, root).conversion` and the existing V2 document fields.
- Produces: `SCV2OperationalModel.domainForLegacyKey(key)`, `trackedLegacyView(root)`, `legacyRootFromCollections(input)`, `collectionChanges(input)`, `validateRoundTrip(input)`, `canonicalDigest(value)`, and `changedLegacyKeys(before, after, allowedKeys)`.

- [ ] **Step 1: Write failing round-trip tests**

Create a fixture containing regular and bangteuk tabs, siblings sharing a phone number, one student enrolled in both course types, teacher assignments, reservations, marks, attendance, calendar settings, retirement history and desk records.

```js
test('all tracked staff data survives V1 to V2 to legacy-view round trip',()=>{
  const root=fullLegacyFixture();
  const conversion=schema.diagnoseLegacyRoot('yongam',root).conversion;
  const rebuilt=model.legacyRootFromCollections({
    branchId:'yongam',generationId:'gen_1',collections:conversion,
  });
  assert.deepEqual(
    model.trackedLegacyView(rebuilt),
    model.trackedLegacyView(root),
  );
});
```

Add separate tests for identical phone/different name, regular/bangteuk enrollment separation, week-five display metadata, deleted placement, renamed student, teacher sort, class mark identity, archived tab, retirement record and desk record stable IDs.

- [ ] **Step 2: Run tests and verify RED**

```powershell
node --test --test-isolation=none tests/schedule-v2-operational-model.test.js tests/schedule-schema-v2.test.js
```

Expected: FAIL because `schedule-v2-operational-model.js` and `SCV2OperationalModel` do not exist.

- [ ] **Step 3: Implement the pure model**

Use a fixed domain map rather than substring guesses:

```js
const DOMAIN_COLLECTIONS=Object.freeze({
  roster:['tabs','people','enrollments','placements','teacherAssignments'],
  workflow:['reservations','waitlistEntries','classMarks'],
  attendance:['attendanceRecords','attendanceGuests','attendanceSnapshots','attendanceSnapshotStudents','attendanceSnapshotTeachers'],
  calendar:['disabledSlots','calendarClosures','schedulePeriods','scheduleSettings'],
  administration:['teacherProfiles','tabFolders','archivedTabs','systemMetadata'],
  history:['retirementRecords','deskStudentRecords'],
});
```

`collectionChanges` compares deterministic IDs and emits only `{type:'set'|'delete', collection, id, value}` changes. Any duplicate ID, missing required ID, slot collision or profile conflict returns an issue and no writable result.

- [ ] **Step 4: Keep browser and function model files byte-identical**

Extend the existing shared-file test to compare the two copies and load the function copy in Node.

- [ ] **Step 5: Run focused tests and syntax checks**

```powershell
node --check js/schedule-v2-operational-model.js
node --check functions/schedule-v2-operational-model.js
node --test --test-isolation=none tests/schedule-v2-operational-model.test.js tests/schedule-schema-v2.test.js tests/function-v2-shared-sync.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```powershell
git add js/schedule-v2-operational-model.js functions/schedule-v2-operational-model.js tests/schedule-v2-operational-model.test.js tests/function-v2-shared-sync.test.js
git commit -m "Add V2 operational round trip model"
```

---

### Task 2: Server-Side V2 Mutation and V1 Recovery Queue

**Files:**
- Create: `functions/schedule-v2-operational-policy.js`
- Create: `functions/schedule-v2-operational-writer.js`
- Modify: `functions/index.js`
- Create: `tests/function-schedule-v2-operational-writer.test.js`
- Create: `tests/function-schedule-v2-operational-api.test.js`

**Interfaces:**
- Consumes: authenticated Firebase callable requests and Task 1 document changes.
- Produces: callable `mutateScheduleV2Operational`, scheduled `recoverScheduleV2OperationalMirrors`, and helpers `authorizeMutation`, `commitV2Mutation`, `applyV1Recovery`, `readOperationalStatus`.

- [ ] **Step 1: Write failing policy and writer tests**

Cover developer, desk, teacher and unauthenticated permissions. Assert that a teacher can write only attendance, absence confirmation and makeup operations allowed by the current permission manifest, while desk actions retain existing branch boundaries.

```js
test('a duplicate operation id returns the stored result without applying twice',async()=>{
  const first=await writer.mutate(request({operationId:'op_1',expectedEpoch:4}));
  const second=await writer.mutate(request({operationId:'op_1',expectedEpoch:4}));
  assert.equal(first.operationId,'op_1');
  assert.deepEqual(second,first);
  assert.equal(db.writeCountFor('op_1'),1);
});
```

Add tests for stale epoch, wrong generation, stale document version, more than 400 changes, partial mirror failure, retry recovery, redacted diagnostics and cross-branch denial.

- [ ] **Step 2: Run tests and verify RED**

```powershell
node --test --test-isolation=none tests/function-schedule-v2-operational-writer.test.js tests/function-schedule-v2-operational-api.test.js
```

Expected: FAIL because the policy, writer and callable do not exist.

- [ ] **Step 3: Define the mutation request contract**

The callable accepts only this shape:

```js
{
  branchId:'yongam',
  generationId:'gen_1',
  expectedEpoch:4,
  operationId:'uuid-from-client',
  operationType:'move-student',
  keys:['swim_students','swim_mark'],
  beforeRevision:31,
  nextValues:{swim_students:[/* current UI-compatible rows */],swim_mark:{}},
  removedKeys:[],
}
```

Reject unknown keys, unknown operation types, mismatched key policy, invalid sizes and unverified identities before writing.

- [ ] **Step 4: Commit V2 changes and operation manifest together**

Use these paths:

```text
scheduleV2/{branchId}/runtime/operational
scheduleV2/{branchId}/generations/{generationId}/{collection}/{documentId}
scheduleV2/{branchId}/operationalMutations/{operationId}
```

The V2 batch stores changed documents, deleted document references, resulting revision, redacted counts and a `pending` recovery state. The manifest is the idempotency record. Split operations over 400 writes into fenced chunks and write `committedAt` only after all chunks succeed.

- [ ] **Step 5: Implement the V1 recovery writer**

Rebuild only the changed legacy keys and write them with the same inline/chunked encoding used by `FirestoreKVRoot`. Record `applied` only after all V1 key documents and stale chunks are updated. On failure record `error`, increment a bounded retry count and retain the operation for the scheduler.

- [ ] **Step 6: Export callable and recovery scheduler**

```js
exports.mutateScheduleV2Operational=onCall({cors:true},handleOperationalMutation);
exports.recoverScheduleV2OperationalMirrors=onSchedule({schedule:'every 5 minutes'},recoverOperationalMirrors);
```

The scheduler processes a bounded number per branch and never guesses a newer source when the operation manifest is incomplete.

- [ ] **Step 7: Run focused tests**

```powershell
node --check functions/schedule-v2-operational-policy.js
node --check functions/schedule-v2-operational-writer.js
node --check functions/index.js
node --test --test-isolation=none tests/function-schedule-v2-operational-writer.test.js tests/function-schedule-v2-operational-api.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```powershell
git add functions/schedule-v2-operational-policy.js functions/schedule-v2-operational-writer.js functions/index.js tests/function-schedule-v2-operational-writer.test.js tests/function-schedule-v2-operational-api.test.js
git commit -m "Add V2 operational mutation service"
```

---

### Task 3: Browser V2 Operational Store and Compatibility Gateway

**Files:**
- Create: `js/schedule-v2-operational-store.js`
- Create: `js/schedule-operational-gateway.js`
- Modify: `index.html`
- Modify: `teacher.html`
- Modify: `desk.html`
- Modify: `settings.html`
- Create: `tests/schedule-v2-operational-store.test.js`
- Create: `tests/schedule-operational-gateway.test.js`

**Interfaces:**
- Consumes: `SCScheduleV2Store`, `SCV2OperationalModel`, Firebase Auth/Functions/Firestore and the existing V1 `FirestoreKVRoot`.
- Produces: `SCV2OperationalStore.create(options)` and `SCOperationalSchedule.create(options)` with root-compatible `child`, `once`, `transactionKeys`, `subscribeSelectedBatches`, `currentConfig`, and `diagnostics` methods.

- [ ] **Step 1: Write failing store tests**

Assert runtime validation, selected-tab queries, domain-lazy reads, stable reconstruction, stale request cancellation and no generic full-generation query.

```js
test('v2-read selected tab does not read unrelated attendance or history collections',async()=>{
  const root=createOperationalRoot({mode:'v2-read'});
  await root.loadSelection({tabIds:['regular'],domains:['roster','workflow']});
  assert.deepEqual(db.queriedCollections.sort(),[
    'classMarks','enrollments','people','placements','reservations',
    'tabs','teacherAssignments','waitlistEntries',
  ]);
});
```

- [ ] **Step 2: Write failing gateway mode tests**

Test the complete mode matrix:

| mode | reads | primary writes | recovery writes |
|---|---|---|---|
| `v1` | V1 | V1 | none |
| `shadow` | V1 | V1 | existing V2 shadow |
| `verify` | V1 | V1 | awaited V2 parity |
| `v2-read` | V2 | V2 callable | tracked V1 mirror |
| `v2` | V2 | V2 callable | none |

Assert that a confirmed V2 session never falls back to V1 after a V2 read error.

- [ ] **Step 3: Run tests and verify RED**

```powershell
node --test --test-isolation=none tests/schedule-v2-operational-store.test.js tests/schedule-operational-gateway.test.js
```

Expected: FAIL because both modules do not exist.

- [ ] **Step 4: Implement selected-domain V2 reads**

`loadSelection({tabIds,domains,dateRange})` reads only the requested collections and uses `legacyRootFromCollections` to return the current UI contract. People and enrollments are fetched only for selected placement IDs, in chunks of at most 30 document reads.

- [ ] **Step 5: Implement the root-compatible gateway**

`transactionKeys(keys, mutator, meta)` loads only the affected legacy view, runs the existing mutator locally, computes changed values, then calls `mutateScheduleV2Operational`. Replace the local cache only with the server response revision. Preserve `{committed, snapshot}` return shapes expected by current code.

- [ ] **Step 6: Add epoch and stale-result guards**

Capture `{branchId,generationId,epoch}` for each operation. Ignore a response when the selected branch, tab or epoch has changed. A config change invalidates pending selection loads and requests a controlled reload.

- [ ] **Step 7: Load the modules before current page runtimes**

Add `schedule-v2-operational-model.js`, `schedule-v2-operational-store.js` and `schedule-operational-gateway.js` after the existing schedule schema/store modules and before `core.js`, `teacher.js`, `desk.js` or `settings.js`.

- [ ] **Step 8: Run focused tests and syntax checks**

```powershell
node --check js/schedule-v2-operational-store.js
node --check js/schedule-operational-gateway.js
node --test --test-isolation=none tests/schedule-v2-operational-store.test.js tests/schedule-operational-gateway.test.js tests/schedule-v2-store.test.js
```

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

```powershell
git add js/schedule-v2-operational-store.js js/schedule-operational-gateway.js index.html teacher.html desk.html settings.html tests/schedule-v2-operational-store.test.js tests/schedule-operational-gateway.test.js
git commit -m "Add V2 operational browser gateway"
```

---

### Task 4: Existing Read and Write Boundary Integration

**Files:**
- Modify: `js/firebase-store.js`
- Modify: `js/schedule-read-coordinator.js`
- Modify: `js/schedule-key-selection.js`
- Modify: `js/schedule-write-gateway.js`
- Modify: `js/core.js`
- Modify: `js/data.js`
- Modify: `js/teacher.js`
- Modify: `js/desk.js`
- Modify: `js/settings.js`
- Modify: `tests/schedule-read-coordinator.test.js`
- Modify: `tests/schedule-write-gateway.test.js`
- Create: `tests/schedule-v2-main-integration.test.js`
- Create: `tests/schedule-v2-staff-pages.test.js`

**Interfaces:**
- Consumes: Task 3 root-compatible gateway.
- Produces: unchanged page-facing `SCFirebaseStore.createBranchRef`, `_scheduleWrites`, `loadFromFirebase`, tab lazy loading and current transaction helpers backed by the selected authority.

- [ ] **Step 1: Write failing integration tests**

Prove that `createBranchRef` wraps V1 with the operational gateway only after auth and branch selection, and that V2 mode does not load all V1 keys at startup.

Add scenarios for main, teacher, desk and settings pages. Assert that each page still receives the legacy-shaped values it expects and that no page writes directly to `scheduleV2` collections.

- [ ] **Step 2: Run tests and verify RED**

```powershell
node --test --test-isolation=none tests/schedule-read-coordinator.test.js tests/schedule-write-gateway.test.js tests/schedule-v2-main-integration.test.js tests/schedule-v2-staff-pages.test.js
```

Expected: FAIL because current pages always use `FirestoreKVRoot` for non-attendance data.

- [ ] **Step 3: Wrap `createBranchRef` without changing callers**

Create the current V1 root first, then return:

```js
return window.SCOperationalSchedule
  ? SCOperationalSchedule.create({branch,legacyRoot,db:firebase.firestore(),functions:firebase.app().functions('asia-northeast3')})
  : legacyRoot;
```

The wrapper delays config reads until authentication is ready and defaults to V1 only before any valid V2 authority has been confirmed.

- [ ] **Step 4: Route existing selected reads through the wrapper**

Keep `subscribeSelectedRootBatches` and `schedule-read-coordinator` contracts. In V2 modes translate startup/common/tab/auxiliary key requests into V2 domains and selected tab IDs. Keep attendance and history lazy; do not restore a full-root startup read.

- [ ] **Step 5: Route current write helpers through the wrapper**

Keep `set`, `remove`, one-key transaction and `transactionKeys` signatures. Attach existing write metadata as `operationType`, `label` and a new operation UUID. Ensure `data.js`, `popup-stu.js`, `tabs.js`, `table.js`, `teacher.js` and `desk.js` continue calling the single `_scheduleWrites` boundary.

- [ ] **Step 6: Preserve page cache semantics**

Update `_dbCache`, tab data and badge maps only after the authoritative gateway returns. Do not clear the visible timetable while a V2 request is pending. Prevent a response from the previous branch/tab from rerendering the current screen.

- [ ] **Step 7: Run focused page integration and syntax checks**

```powershell
node --check js/firebase-store.js
node --check js/schedule-read-coordinator.js
node --check js/schedule-write-gateway.js
node --check js/core.js
node --check js/data.js
node --check js/teacher.js
node --check js/desk.js
node --check js/settings.js
node --test --test-isolation=none tests/schedule-read-coordinator.test.js tests/schedule-write-gateway.test.js tests/schedule-write-boundary.test.js tests/schedule-v2-main-integration.test.js tests/schedule-v2-staff-pages.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

```powershell
git add js/firebase-store.js js/schedule-read-coordinator.js js/schedule-key-selection.js js/schedule-write-gateway.js js/core.js js/data.js js/teacher.js js/desk.js js/settings.js tests/schedule-read-coordinator.test.js tests/schedule-write-gateway.test.js tests/schedule-v2-main-integration.test.js tests/schedule-v2-staff-pages.test.js
git commit -m "Route staff operations through V2 gateway"
```

---

### Task 5: Unify Attendance and Marks Under the Operational Pointer

**Files:**
- Modify: `js/attendance-v2-store.js`
- Modify: `js/attendance-operational-gateway.js`
- Modify: `js/attendance-main-runtime.js`
- Modify: `js/teacher.js`
- Modify: `functions/schedule-v2-operational-writer.js`
- Modify: `tests/attendance-operational-gateway.test.js`
- Modify: `tests/attendance-v2-operational-scenarios.test.js`
- Create: `tests/schedule-v2-marks-operational.test.js`

**Interfaces:**
- Consumes: `runtime/operational`, the unified callable and current attendance model.
- Produces: attendance, guests, absence and makeup writes that share the same generation, epoch, idempotency and V1 recovery queue as the rest of the staff data.

- [ ] **Step 1: Write failing unified-pointer tests**

Assert that mismatched `runtime/attendance` and `runtime/operational` blocks saving. Test regular/bangteuk individual and batch attendance, absence, absence cancel, makeup, sample and mandatory makeup without cross-tab contamination.

- [ ] **Step 2: Run tests and verify RED**

```powershell
node --test --test-isolation=none tests/attendance-operational-gateway.test.js tests/attendance-v2-operational-scenarios.test.js tests/schedule-v2-marks-operational.test.js
```

Expected: FAIL because attendance writes bypass the unified operation manifest and class marks still use V1 transactions.

- [ ] **Step 3: Read the unified config in attendance gateways**

Keep `runtime/attendance` for compatibility but require equal branch, mode and generation. Use the operational `epoch` for every attendance and guest mutation.

- [ ] **Step 4: Route attendance and class marks to the callable**

Convert existing record/guest changes to the same mutation request shape. For one-person attendance send one document change; for batch attendance send at most 400 changes per fenced operation. Class mark operations update only affected `classMarks` documents.

- [ ] **Step 5: Preserve existing attendance snapshots**

Historical snapshots remain immutable except through the existing explicit snapshot creation path. Snapshot creation writes the snapshot header, students and teachers as one fenced operation and records completion last.

- [ ] **Step 6: Run focused tests**

```powershell
node --check js/attendance-v2-store.js
node --check js/attendance-operational-gateway.js
node --check js/attendance-main-runtime.js
node --test --test-isolation=none tests/attendance-operational-gateway.test.js tests/attendance-v2-main-integration.test.js tests/teacher-attendance-v2-integration.test.js tests/attendance-v2-operational-scenarios.test.js tests/schedule-v2-marks-operational.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```powershell
git add js/attendance-v2-store.js js/attendance-operational-gateway.js js/attendance-main-runtime.js js/teacher.js functions/schedule-v2-operational-writer.js tests/attendance-operational-gateway.test.js tests/attendance-v2-operational-scenarios.test.js tests/schedule-v2-marks-operational.test.js
git commit -m "Unify V2 attendance and marks operations"
```

---

### Task 6: Security Rules and Developer Cutover Controls

**Files:**
- Modify: `config/schedule-permissions.json`
- Modify: `scripts/sync-permission-policy.js`
- Modify: `firestore.rules`
- Modify: `js/schedule-v2-settings-policy.js`
- Modify: `js/settings.js`
- Modify: `settings.html`
- Modify: `functions/index.js`
- Modify: `tests/permission-policy-sync.test.js`
- Modify: `tests/firestore-rules-security.test.js`
- Modify: `tests/firestore-rules-emulator.test.js`
- Modify: `tests/schedule-v2-settings.test.js`

**Interfaces:**
- Consumes: unified runtime status and recovery queue counts.
- Produces: developer-only `set-v2-read`, `set-v2` and safe `rollback` actions plus staff read permissions and callable-only operational writes.

- [ ] **Step 1: Write failing permission and transition tests**

Prove:

```text
unauthenticated V2 read/write = deny
teacher allowed V2 operational read = allow
teacher direct V2 write = deny
desk allowed V2 operational read = allow
developer runtime mutation through callable = allow
pending/error mirror count > 0 rollback or set-v2 = deny
unresolved mismatch > 0 set-v2-read = deny
stale generation set-v2-read = deny
```

- [ ] **Step 2: Run static tests and verify RED**

```powershell
node --test --test-isolation=none tests/permission-policy-sync.test.js tests/firestore-rules-security.test.js tests/schedule-v2-settings.test.js
```

Expected: FAIL because schedule V2 has no `v2-read`/`v2` actions and attendance still permits direct browser writes.

- [ ] **Step 3: Extend the single permission manifest**

Add explicit V2 operational read and callable-write policy. Regenerate client and Firestore artifacts with `scripts/sync-permission-policy.js`; do not edit generated blocks separately.

- [ ] **Step 4: Add server transition gates**

Extend `manageScheduleV2Shadow` actions to `set-v2-read` and `set-v2`. The server transaction checks ready schedule and attendance capabilities, zero pending/in-flight/recovery errors, equal requested/applied revisions and zero mismatches before incrementing `epoch` and updating both runtime pointers.

- [ ] **Step 5: Update developer settings controls**

Show per branch: mode, generation, epoch, V2 revision, V1 recovery pending/error counts and mismatch count. Buttons remain hidden from non-developers. Confirmation text states that code deployment alone does not switch production.

- [ ] **Step 6: Run rule generation and emulator tests**

```powershell
node scripts/sync-permission-policy.js
node scripts/sync-permission-policy.js --check
npx.cmd firebase-tools emulators:exec --only firestore "node --test tests/firestore-rules-emulator.test.js"
node --test --test-isolation=none tests/permission-policy-sync.test.js tests/firestore-rules-security.test.js tests/schedule-v2-settings.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit Task 6**

```powershell
git add config/schedule-permissions.json scripts/sync-permission-policy.js firestore.rules js/schedule-v2-settings-policy.js js/settings.js settings.html functions/index.js tests/permission-policy-sync.test.js tests/firestore-rules-security.test.js tests/firestore-rules-emulator.test.js tests/schedule-v2-settings.test.js
git commit -m "Secure full V2 operational cutover"
```

---

### Task 7: Full Operational Scenario and Rollback Verification

**Files:**
- Create: `tests/full-v2-operational-scenarios.test.js`
- Create: `tests/full-v2-concurrency.test.js`
- Create: `tests/full-v2-rollback.test.js`
- Modify: `tests/public-page-security.test.js`
- Modify: `docs/superpowers/specs/2026-08-11-full-v2-operational-cutover-design.md`

**Interfaces:**
- Consumes: Tasks 1-6.
- Produces: repeatable evidence that both branches can run V2 primary, preserve V1 recovery and roll back without data loss.

- [ ] **Step 1: Write end-to-end stateful scenarios**

Include both branches and regular/bangteuk data. Cover every major workflow from the design: registration, replacement, move, teacher change, reservations, retirement, leave, waitlist, all class mark types, attendance, manual records, tabs, calendar, export views and snapshots.

- [ ] **Step 2: Add concurrency scenarios**

Simulate two devices editing different students and the same slot. Verify different-document changes survive and stale same-slot requests receive a conflict without overwriting the newer revision.

- [ ] **Step 3: Add recovery and rollback scenarios**

Run `verify -> v2-read`, apply several V2 mutations, fail one V1 mirror, prove rollback is blocked, recover the mirror, prove parity, switch to V1, rebuild a fresh page session and compare the complete staff legacy view.

- [ ] **Step 4: Prove excluded public pages remain unchanged**

Assert `parent.html` and `js/parent.js` do not load the operational V2 modules, and friend referral, vacancy and customer voice public security tests continue to pass.

- [ ] **Step 5: Run focused scenarios**

```powershell
node --test --test-isolation=none tests/full-v2-operational-scenarios.test.js tests/full-v2-concurrency.test.js tests/full-v2-rollback.test.js tests/public-page-security.test.js
```

Expected: PASS.

- [ ] **Step 6: Run all syntax and regression tests**

```powershell
node --check js/schedule-v2-operational-model.js
node --check js/schedule-v2-operational-store.js
node --check js/schedule-operational-gateway.js
node --check functions/schedule-v2-operational-model.js
node --check functions/schedule-v2-operational-policy.js
node --check functions/schedule-v2-operational-writer.js
node --check functions/index.js
node scripts/sync-permission-policy.js --check
$tests=Get-ChildItem tests -Filter *.test.js | ForEach-Object {$_.FullName}
node --test --test-isolation=none $tests
git diff --check
```

Expected: zero failures. Emulator-only tests may skip only when the emulator dependency is unavailable; before deployment the explicit emulator command from Task 6 must pass.

- [ ] **Step 7: Record exact local rollback evidence**

Append the tested branch, mode sequence, operation counts, parity result and rollback outcome to the design document without student data or account secrets.

- [ ] **Step 8: Commit Task 7**

```powershell
git add tests/full-v2-operational-scenarios.test.js tests/full-v2-concurrency.test.js tests/full-v2-rollback.test.js tests/public-page-security.test.js docs/superpowers/specs/2026-08-11-full-v2-operational-cutover-design.md
git commit -m "Verify full V2 operational cutover"
```

---

### Task 8: Deployment and Controlled Production Activation

**Files:**
- Modify: `api/README.md`
- Modify: `version.json`
- Modify: `js/version.js`

**Interfaces:**
- Consumes: all verified code, deployed functions, rules and indexes.
- Produces: a controlled two-branch `v2-read` activation with observable V1 recovery and an unambiguous rollback command path.

- [ ] **Step 1: Document the deployment order**

Record this exact order in `api/README.md`:

```text
1. static code deployment while both branches remain verify
2. Firestore indexes deployment and wait until enabled
3. Firestore rules deployment
4. Cloud Functions deployment
5. status/readiness check for gagyeong and yongam
6. local authenticated staff smoke test in verify
7. explicit developer set-v2-read for both branches
8. post-cutover status and recovery queue verification
```

- [ ] **Step 2: Run pre-deployment verification again**

Run the complete command set from Task 7 Step 6 and the Firestore emulator command from Task 6. Expected: PASS.

- [ ] **Step 3: Deploy without changing production mode**

Deploy indexes, rules, functions and static files. Confirm both runtime pointers still report `verify` and the existing staff pages work before authority changes.

- [ ] **Step 4: Activate both branches with the developer control**

For each branch, reload status immediately before the action. The server must reject activation unless all readiness counters are zero. Apply `set-v2-read` to 가경점 and 용암점; do not apply `set-v2` in this task.

- [ ] **Step 5: Perform authenticated production smoke tests**

For each branch verify: main timetable load, regular/bangteuk tab switch, one reversible attendance test record, one reversible desk record test, read-only history view and developer recovery status. Remove test records through normal UI and verify their removals mirror to V1.

- [ ] **Step 6: Verify post-cutover status**

Require both branches to report `v2-read`, identical generation pointers, zero pending/error recovery work and zero mismatches. If any requirement fails, stop staff editing, recover the queue, verify parity and use the developer rollback action.

- [ ] **Step 7: Commit deployment documentation and version**

```powershell
git add api/README.md version.json js/version.js
git commit -m "Document full V2 production activation"
```

## Final Completion Gate

The project is not considered fully V2 merely because code is merged. Completion requires both branches in `v2-read`, V2 reads and writes confirmed in authenticated staff pages, V1 recovery pending/error counts at zero, parity at zero mismatches and a tested V1 rollback. Moving from `v2-read` to `v2` requires a later explicit user approval after the agreed stability period.
