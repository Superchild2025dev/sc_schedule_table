# V2 Attendance Operational Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 정규반·방학특강 출석을 기존 V2 개별 문서 구조로 안전하게 전환하고, V1 복구본과 내용 검증을 유지하면서 첫 화면의 불필요한 출석 전체 조회와 큰 JSON 전체 저장을 제거한다.

**Architecture:** `js/attendance-v2-model.js`는 V1 출석 키와 기존 V2 문서 사이의 순수 변환·대조만 담당한다. `js/attendance-v2-store.js`는 Firestore의 V2 런타임 설정과 출석 문서 조회·트랜잭션·배치를 담당하고, `js/attendance-operational-gateway.js`가 `v1 → shadow → verify → v2-read → v2` 상태에 따라 기존 V1 저장 함수와 V2 저장소를 조합한다. 메인과 선생님 화면은 이 관문만 호출하며 V2 경로를 직접 알지 않는다.

**Tech Stack:** Browser JavaScript UMD modules, Firebase Firestore compat SDK 10.12, Node.js built-in test runner, Firebase Security Rules, Firestore composite indexes.

## Global Constraints

- 기존 V1 키와 데이터는 첫 구현에서 삭제하지 않는다.
- 기본 전환 상태는 모든 지점에서 `v1`이며 설정 문서가 없거나 잘못되면 `v1`로 처리한다.
- 기존 V2 `attendanceRecords`와 `attendanceGuests` 문서 ID 및 필드 형식을 그대로 사용한다.
- 정규반과 방학특강의 `tabId`와 `courseType`을 섞지 않는다.
- 출석부 UI와 사용자 문구를 변경하지 않는다.
- 학부모 요청 구조는 변경하지 않는다.
- 진단에는 이름, 전화번호, 출석 원문을 저장하지 않는다.
- 운영 전환 제어는 개발자 계정에만 허용한다.
- 각 작업은 테스트 실패 확인 후 최소 구현, 회귀 테스트, 독립 커밋 순서로 진행한다.

---

### Task 1: Pure V2 Attendance Model and Parity

**Files:**
- Create: `js/attendance-v2-model.js`
- Modify: `index.html`
- Modify: `teacher.html`
- Modify: `desk.html`
- Modify: `settings.html`
- Test: `tests/attendance-v2-model.test.js`
- Test: `tests/schedule-schema-v2.test.js`

**Interfaces:**
- Consumes: `SCScheduleSchemaV2.stableHash(value)` and `SCScheduleSchemaV2.enrollmentIdFor(personId, tabId)`.
- Produces: `SCV2AttendanceModel.parseRecordKey(legacyKey)`, `parseGuestKey(legacyKey)`, `recordId(tabId, legacyKey)`, `guestId(tabId, legacyKey, guestId, index)`, `recordFromLegacy(input)`, `guestFromLegacy(input)`, `mapsFromRows(records, guests)`, `diffLegacyMaps(before, after)`, and `compareLegacyRows(input)`.

- [ ] **Step 1: Write the failing model tests**

Create tests that load `schedule-schema-v2.js` and the wished-for module in a VM. Assert exact ID parity with the existing converter:

```js
test('operational attendance IDs match the existing V2 conversion',()=>{
  const legacyKey='5시/월/2/3/2026-08-10';
  const modelRecord=model.recordFromLegacy({
    tabId:'regular',courseType:'regular',legacyKey,
    raw:{s:'present',at:'2026-08-10T09:00:00.000Z',by:'테스트'},
    personId:'stu_1',enrollmentId:'enr_1',
  });
  const report=schema.diagnoseLegacyRoot(fixtureWithAttendance(legacyKey));
  assert.equal(modelRecord.id,report.conversion.attendanceRecords[0].id);
  assert.equal(modelRecord.legacyKey,legacyKey);
});
```

Add tests for `#sub`, regular versus bangteuk, guest IDs with and without `gid`, invalid keys, round-trip reconstruction, changed-key diffing, siblings sharing a phone, and regular/bangteuk separation.

- [ ] **Step 2: Run the model tests and verify RED**

Run:

```powershell
node --test --test-isolation=none tests/attendance-v2-model.test.js tests/schedule-schema-v2.test.js
```

Expected: FAIL because `js/attendance-v2-model.js` and `SCV2AttendanceModel` do not exist.

- [ ] **Step 3: Implement the pure model**

Use the existing V2 identifiers exactly:

```js
function recordId(tabId,legacyKey){
  return 'att_'+schema().stableHash(`${text(tabId)}|${text(legacyKey)}`);
}
function guestId(tabId,legacyKey,gid,index){
  return 'guest_'+schema().stableHash(`${text(tabId)}|${text(legacyKey)}|${text(gid)||Number(index)||0}`);
}
```

`mapsFromRows` must rebuild the current UI contract without exposing V2 internals:

```js
return {
  attendance:{[row.legacyKey]:clone(row.payload)},
  guests:{[row.legacyKey]:orderedGuestPayloads},
};
```

Invalid keys return `{ok:false, issue:{type,key}}`; they are never silently omitted from parity results.

- [ ] **Step 4: Load the model before the V2 store on every staff page**

Insert:

```html
<script>scJs('js/attendance-v2-model.js')</script>
```

immediately after `schedule-schema-v2.js` and before `schedule-v2-store.js` in the four pages.

- [ ] **Step 5: Run focused and schema tests**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```powershell
git add js/attendance-v2-model.js index.html teacher.html desk.html settings.html tests/attendance-v2-model.test.js tests/schedule-schema-v2.test.js
git commit -m "Add V2 attendance model"
```

---

### Task 2: Firestore V2 Attendance Store and Runtime State

**Files:**
- Create: `js/attendance-v2-store.js`
- Modify: `index.html`
- Modify: `teacher.html`
- Modify: `desk.html`
- Modify: `settings.html`
- Test: `tests/attendance-v2-store.test.js`

**Interfaces:**
- Consumes: `SCV2AttendanceModel`, `SCScheduleV2Store.safeDocId`, and Firebase Firestore compat references.
- Produces: `SCV2AttendanceStore.create(options)` returning `readConfig()`, `subscribeConfig(next,error)`, `setConfig(config)`, `readRange(query)`, `setRecord(record)`, `deleteRecord(recordId)`, `replaceGuestGroup(input)`, `writeRecordBatch(changes)`, and `compareRange(input)`.

- [ ] **Step 1: Write failing store tests with a stateful fake Firestore**

Cover these behaviors:

```js
test('missing runtime config fails closed to v1',async()=>{
  const store=createStore(emptyDb());
  assert.deepEqual(await store.readConfig(),{
    mode:'v1',generationId:'',branchId:'yongam',valid:false,
  });
});

test('week query requests only selected tab and dates',async()=>{
  const result=await store.readRange({
    generationId:'gen_1',tabId:'regular',
    dates:['2026-08-03','2026-08-04'],
  });
  assert.deepEqual(fakeDb.queryFilters,[
    ['tabId','==','regular'],['date','in',['2026-08-03','2026-08-04']],
  ]);
});
```

Also test one-record transaction, delete, batch update, guest group replacement, stale generation rejection, more than ten dates rejection, digest mismatch, and no personal values in diagnostics.

- [ ] **Step 2: Run store tests and verify RED**

```powershell
node --test --test-isolation=none tests/attendance-v2-store.test.js
```

Expected: FAIL because the store module does not exist.

- [ ] **Step 3: Implement config and references**

Use these exact paths:

```text
scheduleV2/{branchId}/runtime/attendance
scheduleV2/{branchId}/generations/{generationId}/attendanceRecords/{recordId}
scheduleV2/{branchId}/generations/{generationId}/attendanceGuests/{guestId}
```

Valid modes are `v1`, `shadow`, `verify`, `v2-read`, and `v2`. Invalid mode, empty generation for non-V1 mode, or wrong branch produces the default V1 config.

- [ ] **Step 4: Implement range reads and writes**

`readRange` performs two `tabId + date in dates` queries in parallel and returns rows converted with `snapshotRows`. `setRecord` uses `runTransaction` for the one target document. `writeRecordBatch` rejects more than 450 changes and writes deterministic document IDs only.

- [ ] **Step 5: Load the store module on every staff page**

Insert it after `attendance-v2-model.js` and before `schedule-v2-store.js`.

- [ ] **Step 6: Run focused tests and syntax checks**

```powershell
node --check js/attendance-v2-store.js
node --test --test-isolation=none tests/attendance-v2-model.test.js tests/attendance-v2-store.test.js tests/schedule-v2-store.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```powershell
git add js/attendance-v2-store.js index.html teacher.html desk.html settings.html tests/attendance-v2-store.test.js
git commit -m "Add V2 attendance store"
```

---

### Task 3: Operational Attendance Gateway

**Files:**
- Create: `js/attendance-operational-gateway.js`
- Modify: `index.html`
- Modify: `teacher.html`
- Modify: `desk.html`
- Modify: `settings.html`
- Test: `tests/attendance-operational-gateway.test.js`

**Interfaces:**
- Consumes: `legacy.loadRange`, `legacy.updateAttendance`, `legacy.updateGuests`, `SCV2AttendanceStore`, and `SCV2AttendanceModel`.
- Produces: `SCOperationalAttendance.create(options)` returning `ready()`, `mode()`, `loadRange(input)`, `updateAttendance(mutator,input)`, `updateGuests(mutator,input)`, `setManyAttendance(input)`, `releaseRange(owner)`, and `diagnostics(limit)`.

- [ ] **Step 1: Write the gateway mode matrix as failing tests**

```js
test('shadow keeps V1 authoritative when V2 mirroring fails',async()=>{
  const gateway=createGateway({mode:'shadow',v2WriteFailure:true});
  const result=await gateway.updateAttendance(map=>({...map,a:{s:'present'}}),context);
  assert.equal(result.attendance.a.s,'present');
  assert.equal(result.degraded,true);
  assert.equal(result.primary,'v1');
});

test('v2-read loads V2 and never mixes a failed range with V1',async()=>{
  const gateway=createGateway({mode:'v2-read',v2ReadFailure:true});
  await assert.rejects(gateway.loadRange(range),/V2 출석 데이터를 불러오지 못했습니다/);
  assert.equal(fakeLegacy.loadCount,0);
});
```

Test all five modes, V2-first/V1-backup ordering, stale range cancellation, no-op diffs, invalid parity blocking, and diagnostic redaction.

- [ ] **Step 2: Run gateway tests and verify RED**

```powershell
node --test --test-isolation=none tests/attendance-operational-gateway.test.js
```

Expected: FAIL because `SCOperationalAttendance` does not exist.

- [ ] **Step 3: Implement the mode policy**

Use this exact authority matrix:

| mode | read | primary write | secondary write | V2 failure effect |
|---|---|---|---|---|
| `v1` | V1 | V1 | none | none |
| `shadow` | V1 | V1 | V2 | diagnostic only |
| `verify` | V1 | V1 | awaited V2 + compare | blocks later cutover, not completed V1 write |
| `v2-read` | V2 | V2 | V1 backup | V2 error blocks the operation |
| `v2` | V2 | V2 | none | blocks the operation |

The gateway keeps at most 80 diagnostics containing only `at`, `branchId`, `tabId`, `dates`, `mode`, `kind`, `outcome`, `recordCount`, and `durationMs`.

- [ ] **Step 4: Implement map diffs and secondary writes**

After the authoritative mutator completes, calculate changed and deleted legacy keys with `SCV2AttendanceModel.diffLegacyMaps`. Convert only changed entries to V2 records. Do not reconvert or rewrite the full schedule generation.

- [ ] **Step 5: Load the gateway module before page runtime code**

Insert it after `attendance-v2-store.js` and before `core.js` or `teacher.js`.

- [ ] **Step 6: Run focused tests**

```powershell
node --check js/attendance-operational-gateway.js
node --test --test-isolation=none tests/attendance-v2-model.test.js tests/attendance-v2-store.test.js tests/attendance-operational-gateway.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```powershell
git add js/attendance-operational-gateway.js index.html teacher.html desk.html settings.html tests/attendance-operational-gateway.test.js
git commit -m "Add operational attendance gateway"
```

---

### Task 4: Main Timetable Attendance Integration and True Lazy Read

**Files:**
- Modify: `js/schedule-key-selection.js`
- Modify: `js/core.js`
- Modify: `js/tabs.js`
- Modify: `js/data.js`
- Modify: `js/table.js`
- Test: `tests/schedule-key-selection.test.js`
- Test: `tests/attendance-lazy-tab.test.js`
- Test: `tests/attendance-v2-main-integration.test.js`

**Interfaces:**
- Consumes: `SCOperationalAttendance.create`, the Task 3 gateway methods, current `_attendanceStorageKeys(tabId)`, `updateAttendanceMapTx`, and `updateAttGuestsMapTx`.
- Produces: `ensureOperationalAttendanceRangeLoaded(dates)`, `releaseOperationalAttendanceRange()`, and existing update functions backed by the gateway.

- [ ] **Step 1: Write failing lazy-read and integration tests**

Assert that regular attendance is no longer in startup common keys:

```js
test('regular attendance is not loaded before the attendance view opens',()=>{
  assert.equal(policy.commonKeys().includes('swim_attendance'),false);
  assert.equal(policy.commonKeys().includes('swim_att_guests'),false);
});
```

Add tests proving the attendance view loads V1 keys only in V1/shadow/verify, loads V2 range only in v2-read/v2, blocks writes before readiness, preserves the current table during load, and renders only the last rapid date selection.

- [ ] **Step 2: Run main integration tests and verify RED**

```powershell
node --test --test-isolation=none tests/schedule-key-selection.test.js tests/attendance-lazy-tab.test.js tests/attendance-v2-main-integration.test.js
```

Expected: FAIL because regular attendance remains a common key and the operational gateway is not wired.

- [ ] **Step 3: Remove regular attendance from startup common keys**

Delete only `swim_attendance` and `swim_att_guests` from `COMMON_KEYS`. Keep them available through the existing attendance auxiliary key path for V1 modes.

- [ ] **Step 4: Initialize the gateway after Firebase and auth readiness**

Create one main-page gateway per selected branch. Do not initialize or query V2 while no branch is selected. Dispose config and range listeners when the branch changes.

- [ ] **Step 5: Route attendance range reads**

In `ensureAttendanceBasisTabsLoaded`, resolve the gateway config before choosing auxiliary keys. For V2 modes, omit V1 attendance keys and merge `mapsFromRows` into only the requested dates of `ATTENDANCE` and `ATT_GUESTS`. For V1 modes, preserve the current selected-key auxiliary load.

- [ ] **Step 6: Route all main attendance mutations**

Keep the current function names for compatibility. `updateAttendanceMapTx` and `updateAttGuestsMapTx` delegate to the gateway and replace global maps only with the authoritative result. Individual, sub-student, modal, batch, all-present, add, and delete handlers remain guarded by `requireAttendanceDataReady`.

- [ ] **Step 7: Run focused main tests**

```powershell
node --check js/core.js
node --check js/tabs.js
node --check js/data.js
node --check js/table.js
node --test --test-isolation=none tests/schedule-key-selection.test.js tests/firebase-store-selected.test.js tests/attendance-lazy-tab.test.js tests/attendance-v2-main-integration.test.js tests/attendance-teacher-permission.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

```powershell
git add js/schedule-key-selection.js js/core.js js/tabs.js js/data.js js/table.js tests/schedule-key-selection.test.js tests/attendance-lazy-tab.test.js tests/attendance-v2-main-integration.test.js
git commit -m "Route main attendance through V2 gateway"
```

---

### Task 5: Teacher Attendance Integration

**Files:**
- Modify: `js/teacher.js`
- Test: `tests/teacher-attendance-v2-integration.test.js`
- Test: `tests/attendance-teacher-permission.test.js`

**Interfaces:**
- Consumes: the same `SCOperationalAttendance` API used by the main page.
- Produces: teacher attendance rendering and mutations with identical mode behavior.

- [ ] **Step 1: Write failing teacher integration tests**

Cover initialization after branch/auth selection, week range loading, individual regular and bangteuk checks, batch check, guest add/delete, snapshot preservation, permission denial, and no full V1 attendance parse in `v2-read`/`v2`.

- [ ] **Step 2: Run teacher tests and verify RED**

```powershell
node --test --test-isolation=none tests/teacher-attendance-v2-integration.test.js tests/attendance-teacher-permission.test.js
```

Expected: FAIL because `teacher.js` directly reads and writes V1 attendance maps.

- [ ] **Step 3: Initialize the gateway in `teacher.js`**

Reuse the selected branch and authenticated profile. The teacher page must not read V2 before authentication succeeds. Failed config reads default to V1 only when no V2 mode was previously confirmed in the session; a confirmed v2-read range failure blocks writes instead of mixing sources.

- [ ] **Step 4: Route week reads and mutations**

Before `renderAttendanceTimetable`, load the visible week through the gateway. Replace `updateAttendanceMapTx` and `updateAttGuestsMapTx` internals with gateway calls while retaining their existing signatures and audit records.

- [ ] **Step 5: Avoid whole-root attendance use in V2 modes**

Keep the existing V1 root load for non-attendance teacher features during this task, but in v2-read/v2 ignore `data.swim_attendance` and `data.swim_att_guests` and populate only the requested V2 week. A later teacher-page read refactor can remove the remaining root download without changing the new gateway.

- [ ] **Step 6: Run focused tests and syntax check**

```powershell
node --check js/teacher.js
node --test --test-isolation=none tests/teacher-attendance-v2-integration.test.js tests/attendance-teacher-permission.test.js tests/attendance-operational-gateway.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```powershell
git add js/teacher.js tests/teacher-attendance-v2-integration.test.js tests/attendance-teacher-permission.test.js
git commit -m "Route teacher attendance through V2 gateway"
```

---

### Task 6: Firestore Rules, Indexes, and Developer Cutover Control

**Files:**
- Modify: `firestore.rules`
- Create: `firestore.indexes.json`
- Modify: `firebase.json`
- Modify: `js/settings.js`
- Modify: `settings.html`
- Modify: `tests/firestore-rules-emulator.test.js`
- Modify: `tests/firestore-rules-security.test.js`
- Create: `tests/attendance-v2-settings.test.js`

**Interfaces:**
- Consumes: generated `canReadSchedule(branch)`, `canManageSchedule(branch)`, `isTeacherForBranch(branch)`, and `isDeveloper()` rule helpers.
- Produces: branch-scoped V2 attendance permissions, required queries, and developer-only mode controls.

- [ ] **Step 1: Write failing rule and settings tests**

Rules tests must prove:

```text
teacher: own branch attendanceRecords/attendanceGuests read+write = allow
teacher: other branch = deny
teacher: runtime attendance config read = allow, write = deny
desk: own branch attendance data read+write = allow
developer: config write = allow
unauthenticated: all V2 runtime attendance paths = deny
```

Settings tests must prove only a developer sees controls and invalid parity prevents `v2-read` or `v2` selection.

- [ ] **Step 2: Run the rule/settings tests and verify RED**

```powershell
node --test --test-isolation=none tests/firestore-rules-security.test.js tests/attendance-v2-settings.test.js
```

Expected: FAIL because V2 attendance is developer-only and no index/control exists.

- [ ] **Step 3: Add specific nested V2 attendance rules**

Keep the existing developer-wide V2 rule and add narrower branch-specific matches:

```rules
match /scheduleV2/{branch}/runtime/attendance {
  allow read: if canReadSchedule(branch);
  allow write: if isDeveloper();
}
match /scheduleV2/{branch}/generations/{generationId}/{collection}/{recordId} {
  allow read, write: if collection in ['attendanceRecords','attendanceGuests']
    && (canManageSchedule(branch) || isTeacherForBranch(branch));
}
```

No other V2 collection becomes writable to teachers.

- [ ] **Step 4: Add exact composite indexes**

Create indexes for both `attendanceRecords` and `attendanceGuests` collection groups with ascending `tabId` and ascending `date`. Point `firebase.json` at both rules and indexes.

- [ ] **Step 5: Add developer-only settings controls**

The control displays branch, current mode, generation ID, last parity outcome, last sync time, and mismatch count. Mode advancement requires a verified generation and zero attendance mismatches. Moving back to `v1` is always available to the developer. No automatic mode advancement occurs.

- [ ] **Step 6: Synchronize permission artifacts and run tests**

```powershell
node scripts/sync-permission-policy.js
node scripts/sync-permission-policy.js --check
node --test --test-isolation=none tests/permission-policy-sync.test.js tests/firestore-rules-security.test.js tests/attendance-v2-settings.test.js
```

When the Firestore emulator dependency is available, also run:

```powershell
npx.cmd firebase-tools emulators:exec --only firestore "node --test tests/firestore-rules-emulator.test.js"
```

Expected: all available tests PASS.

- [ ] **Step 7: Commit Task 6**

```powershell
git add firestore.rules firestore.indexes.json firebase.json js/settings.js settings.html tests/firestore-rules-emulator.test.js tests/firestore-rules-security.test.js tests/attendance-v2-settings.test.js
git commit -m "Secure V2 attendance operations"
```

---

### Task 7: Migration Verification, Rollback, and Full Regression

**Files:**
- Create: `tests/attendance-v2-operational-scenarios.test.js`
- Modify: `docs/superpowers/specs/2026-08-07-v2-operational-migration-design.md`
- Modify: `docs/superpowers/plans/2026-08-07-v2-attendance-operational-migration.md`

**Interfaces:**
- Consumes: completed Tasks 1-6.
- Produces: repeatable migration verification and rollback evidence.

- [ ] **Step 1: Write end-to-end operational scenario tests**

Build stateful scenarios for:

1. V1 baseline to V2 attendance copy with exact digest parity.
2. Regular individual check in shadow mode.
3. Bangteuk individual and batch check without regular contamination.
4. Two devices checking different students on the same date.
5. Guest add, check, and delete.
6. Week crossing two operating months.
7. Historical snapshot read.
8. V2 read failure blocking writes without clearing the visible table.
9. Rollback from v2-read to v1 with V1 backup intact.
10. Other branch access rejection.

- [ ] **Step 2: Run operational scenarios and fix only demonstrated failures**

```powershell
node --test --test-isolation=none tests/attendance-v2-operational-scenarios.test.js
```

Expected: PASS after Tasks 1-6. Any failure must receive its own regression test before a code fix.

- [ ] **Step 3: Run syntax, permission, focused, and complete verification**

```powershell
node --check js/attendance-v2-model.js
node --check js/attendance-v2-store.js
node --check js/attendance-operational-gateway.js
node --check js/core.js
node --check js/tabs.js
node --check js/data.js
node --check js/table.js
node --check js/teacher.js
node scripts/sync-permission-policy.js --check
$tests = Get-ChildItem tests -Filter *.test.js | ForEach-Object { $_.FullName }
node --test --test-isolation=none $tests
git diff --check
```

Expected: zero failures; only the explicitly configured Firestore emulator availability test may skip.

- [ ] **Step 4: Perform a local read-only browser check**

Open the main and teacher pages in preview/read-only mode. Verify no console errors, the current table remains visible while attendance loads, and no operating write occurs. Do not activate v2-read against production during local verification.

- [ ] **Step 5: Record rollback evidence**

Update the design document with the exact tested sequence: developer sets mode to `v1`, reloads, V1 attendance range loads, and the pre-transition V1 map remains intact. Do not include account secrets or student data.

- [ ] **Step 6: Commit Task 7**

```powershell
git add tests/attendance-v2-operational-scenarios.test.js docs/superpowers/specs/2026-08-07-v2-operational-migration-design.md docs/superpowers/plans/2026-08-07-v2-attendance-operational-migration.md
git commit -m "Verify V2 attendance migration safety"
```

## Deployment Gate

Implementation completion does not activate V2 in production. Production deployment requires this order:

1. Push code and deploy static files while both branches remain `v1`.
2. Deploy Firestore indexes and wait until index state is enabled.
3. Deploy Firestore rules.
4. Developer account creates or refreshes the verified V2 generation.
5. Set only 용암점 attendance to `shadow` and observe parity.
6. Advance 용암점 to `verify`, then `v2-read` only after zero mismatches.
7. Repeat for 가경점.
8. Move to `v2` only after rollback verification and explicit user approval.
