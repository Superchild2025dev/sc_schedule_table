# Active Tab Lazy Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 메인 시간표가 공통 데이터와 현재 탭 데이터만 구독하고, 비활성 탭과 방특 출석 데이터는 해당 탭 또는 출석 날짜를 실제로 열 때만 안전하게 조회하도록 만든다.

**Architecture:** 순수 키 선택 모듈이 공통·탭 전용 키를 결정한다. Firestore 저장소는 지정된 문서만 구독하는 동적 컨트롤러를 제공하고, 메인 조회 조정자는 이를 기존 캐시와 렌더러에 연결한다. 탭 전환과 출석 날짜 전환은 필요한 데이터 준비 Promise가 끝난 뒤에만 화면과 저장 기능을 활성화한다.

**Tech Stack:** 브라우저 IIFE, Firebase Firestore compat SDK 10.12.2, Firebase Realtime Database compat SDK, Node.js 내장 test runner

## Global Constraints

- 메인 시간표와 메인 화면 출석부만 변경한다.
- V1 저장 키와 JSON 필드 형식은 변경하지 않는다.
- 쓰기 게이트웨이와 변경 분류 규칙을 변경하지 않는다.
- 선생님·데스크·설정 페이지의 조회 흐름은 변경하지 않는다.
- 비활성 탭의 localStorage 값만으로 탭 전환 완료를 판정하지 않는다.
- 원생 문서가 잘못되거나 일부 키 조회가 실패하면 기존 정상 캐시를 지우지 않는다.
- 출석 기준 탭과 출석 키가 준비되기 전에는 출석 저장을 차단한다.
- 과거 날짜 스냅샷의 날짜 단위 지연 조회를 유지한다.
- 새 외부 라이브러리를 추가하지 않는다.
- 모든 운영 코드 변경 전에 실패 테스트를 먼저 실행한다.

---

### Task 1: Pure schedule key selection policy

**Files:**
- Create: js/schedule-key-selection.js
- Create: tests/schedule-key-selection.test.js
- Modify: index.html

**Interfaces:**
- Produces: SCScheduleKeySelection.bootstrapKeys()
- Produces: SCScheduleKeySelection.commonKeys()
- Produces: SCScheduleKeySelection.tabKeys(tab)
- Produces: SCScheduleKeySelection.resolveMainTab(baseValues, fallbackTabId)
- Produces: SCScheduleKeySelection.initialBaseKeys()
- Produces: SCScheduleKeySelection.isTabOwnedKey(key)

- [ ] **Step 1: Write the failing key-policy tests**

Specify exact key behavior:

~~~js
const policy=require('../js/schedule-key-selection.js');

assert.deepEqual(policy.tabKeys({id:'regular',type:'regular'}),[
  'swim_students',
  'swim_inst',
]);

assert.deepEqual(policy.tabKeys({id:'summer',type:'bangteuk'}),[
  'swim_bt_summer_stu',
  'swim_bt_summer_inst',
  'swim_bt_attendance_summer',
  'swim_bt_att_guests_summer',
]);
~~~

Also require:

- initialBaseKeys is the unique union of bootstrapKeys and commonKeys;
- inactive regular and bangteuk student/teacher keys are never common keys;
- swim_attendance and swim_att_guests remain common keys;
- audit, restore, day-snapshot, Aligo, feedback, and snapshot keys are excluded;
- resolveMainTab parses JSON strings from swim_tab_list and swim_main_tab;
- an invalid or missing main setting falls back to the first live regular tab;
- snapshots are never a main tab result;
- index.html loads schedule-key-selection.js after firebase-store.js and before core.js.

- [ ] **Step 2: Run the policy tests and confirm the module is missing**

Run: node --test --test-isolation=none tests/schedule-key-selection.test.js

Expected: FAIL because js/schedule-key-selection.js does not exist.

- [ ] **Step 3: Implement the pure module**

Use a UMD wrapper and immutable returned arrays. Define the exact common list:

~~~js
const COMMON_KEYS=[
  'swim_retire','swim_enroll','swim_mark','swim_disabled',
  'swim_reserve','swim_hyuwon','swim_move','swim_requests',
  'swim_attendance','swim_att_guests',
  'swim_closed','swim_teachers','swim_periods',
  'swim_retire_history','swim_desk_notes',
  'swim_age_year','swim_student_id_version','swim_ver',
];
~~~

tabKeys uses tab.stuKey and tab.instKey when present, then current naming rules. Snapshot tabs return an empty array.

- [ ] **Step 4: Run syntax and focused tests**

Run: node --check js/schedule-key-selection.js

Run: node --test --test-isolation=none tests/schedule-key-selection.test.js

Expected: all policy tests pass.

- [ ] **Step 5: Commit**

Commit message: Add schedule key selection policy

---

### Task 2: Firestore selected-key batch subscription

**Files:**
- Modify: js/firebase-store.js
- Modify: tests/firebase-store-listener.test.js

**Interfaces:**
- Produces: FirestoreKVRoot.prototype.subscribeSelectedBatches(options)
- Produces controller: setActiveKeys(keys), setAuxiliaryKeys(owner, keys), releaseAuxiliaryKeys(owner), waitForActive(keys), stop(), diagnostics(limit)
- Produces: SCFirebaseStore.subscribeSelectedRootBatches(root, options)
- Consumes: options.baseKeys, options.resolveInitialActiveKeys(baseValues), options.next, options.error
- Preserves: subscribeBatches, once, on, and all existing write APIs

- [ ] **Step 1: Extend the Firestore harness with per-document listener support**

The fake collection document exposes onSnapshot, get, collection, and an unsubscribe counter by decoded storage key. Add a helper that emits a document snapshot with exists and data methods.

- [ ] **Step 2: Write failing selected-subscription tests**

Required cases:

- only baseKeys create initial document listeners;
- no collection-wide liveCol listener is created;
- after all base values arrive, resolveInitialActiveKeys receives one baseValues map;
- only the returned active keys are then subscribed;
- initial next is emitted once after every base and active key has a first server result;
- a missing document is included in removedKeys without deleting unrelated cache;
- setActiveKeys subscribes new keys, waits for their first result, emits one batch, then unsubscribes old active-only keys;
- base-key listeners survive active-key replacement;
- setAuxiliaryKeys keeps attendance basis keys subscribed without replacing visible active keys;
- replacing or releasing one auxiliary owner removes only keys no longer used by base, active, or another owner;
- repeated setActiveKeys with the same set creates no duplicate listeners;
- a slower previous active-key request cannot become current after a newer request;
- one Firestore commit touching two selected docs produces one queued batch;
- unselected chunked documents never call the stored-value reader;
- stop removes every listener and prevents late values;
- a selected-key read error reaches options.error and preserves the last successful value.

- [ ] **Step 3: Run the listener tests and confirm the API is missing**

Run: node --test --test-isolation=none tests/firebase-store-listener.test.js

Expected: FAIL because subscribeSelectedBatches is undefined.

- [ ] **Step 4: Implement selected document listener state**

Keep selected state separate from the existing broad batch subscription:

~~~js
{
  stopped:false,
  generation:0,
  baseKeys:new Set(),
  activeKeys:new Set(),
  auxiliaryKeys:new Map(),
  listeners:new Map(),
  firstValues:new Map(),
  pendingChanges:new Map(),
  pendingTimer:null,
  revision:0,
}
~~~

Each listener stores unsubscribe, ready Promise, latest version, and active generations. The stored-value reader runs only after its selected root document changes.

- [ ] **Step 5: Implement two-phase initial readiness**

1. Subscribe baseKeys.
2. Wait for every base key to return exists or missing.
3. Call resolveInitialActiveKeys with a plain value map.
4. Subscribe the returned active keys.
5. Wait for every active key.
6. Emit one initial batch containing latest base and active values and confirmed removals.

Changes received while initial readiness is pending update the held latest value instead of rendering partially.

- [ ] **Step 6: Implement dynamic active-key replacement**

setActiveKeys normalizes keys, increments a generation, retains current listeners while new keys load, emits new first values in one batch, changes the active set only for the latest generation, releases old active-only listeners, and returns a Promise describing the result.

setAuxiliaryKeys uses a stable owner string and the same first-value readiness rules without changing activeKeys. releaseAuxiliaryKeys removes that owner's references and stops only listeners no longer needed by base, active, or another auxiliary owner.

- [ ] **Step 7: Implement raw RTDB compatibility adapter**

SCFirebaseStore.subscribeSelectedRootBatches delegates when the root exposes subscribeSelectedBatches. For a raw RTDB root, use root.child(key).on('value') for selected keys instead of reading the whole root. Preserve the same two-phase and dynamic controller contract.

- [ ] **Step 8: Run focused storage verification**

Run: node --check js/firebase-store.js

Run: node --test --test-isolation=none tests/firebase-store-listener.test.js

Expected: all existing and new listener tests pass.

- [ ] **Step 9: Commit**

Commit message: Add selected schedule key subscriptions

---

### Task 3: Route main initial load through selected keys

**Files:**
- Modify: js/core.js
- Modify: tests/schedule-read-integration.test.js

**Interfaces:**
- Produces: _scheduleSelectedReadController
- Produces: ensureScheduleTabLoaded(tabId, options)
- Produces: isScheduleTabDataReady(tabId)
- Produces: isScheduleDataTransitioning()
- Consumes: SCScheduleKeySelection and SCFirebaseStore.subscribeSelectedRootBatches
- Preserves: loadFromFirebase(callback)

- [ ] **Step 1: Add failing main-boundary tests**

Require:

- the main coordinator starts through subscribeSelectedRootBatches;
- broad subscribeRootBatches remains available but is not used in the normal main path;
- initialBaseKeys is passed as baseKeys;
- resolveInitialActiveKeys resolves from remote baseValues, not local active tab alone;
- the first load callback waits for selected initial readiness;
- pruning receives only selected authoritative keys and never deletes an unselected tab cache key;
- ensureScheduleTabLoaded delegates to setActiveKeys and validates requested student keys;
- transition state blocks canPersistScheduleData;
- failed tab loads keep active tab and current STUDENTS unchanged.

- [ ] **Step 2: Run the integration tests and confirm assertions fail**

Run: node --test --test-isolation=none tests/schedule-read-integration.test.js

- [ ] **Step 3: Implement selected initial resolver**

Use SCScheduleKeySelection.resolveMainTab and tabKeys. The selected subscription emits the existing coordinator batch format so cache validation and atomic application remain centralized.

Do not prune localStorage for unselected tab-owned keys. Only confirmed missing selected keys may be removed.

- [ ] **Step 4: Implement tab readiness registry**

~~~js
const _scheduleTabReadiness=new Map();
let _scheduleTabTransitionSeq=0;
let _scheduleTabTransitioning=false;
~~~

ensureScheduleTabLoaded returns immediately only when the same tab remains actively subscribed and its server generation is current. A cached but inactive tab performs a fresh selected-key handshake.

- [ ] **Step 5: Add transition write guard**

canPersistScheduleData rejects writes while transition state is true and shows one throttled message: 시간표 데이터를 불러오는 중입니다.

The guard clears only after selected values pass validation and apply to cache.

- [ ] **Step 6: Run focused core verification**

Run: node --check js/core.js

Run: node --test --test-isolation=none tests/schedule-key-selection.test.js tests/firebase-store-listener.test.js tests/schedule-read-coordinator.test.js tests/schedule-read-integration.test.js tests/firebase-write-error.test.js

Expected: all focused tests pass.

- [ ] **Step 7: Commit**

Commit message: Load only the active main schedule

---

### Task 4: Make live tab switching asynchronous

**Files:**
- Modify: js/tabs.js
- Modify: tests/schedule-read-integration.test.js
- Create: tests/tab-lazy-loading.test.js

**Interfaces:**
- Produces: requestTabSwitch(tabId)
- Consumes: ensureScheduleTabLoaded(tabId)
- Preserves: switchTabView() for rendering a prepared tab

- [ ] **Step 1: Write failing tab-switch tests**

Required cases:

- clicking a live tab calls requestTabSwitch without changing active tab first;
- requestTabSwitch shows loading while preserving the old table state;
- a successful load changes active tab and renders once;
- a failed load restores the old active tab and table;
- clicking A then B while A is slow shows only B;
- switching back to a visited tab performs a fresh server handshake;
- snapshot tabs continue using loadDeferredJSON;
- student and teacher popups close before loading.

- [ ] **Step 2: Run tab tests and confirm eager switching fails**

Run: node --test --test-isolation=none tests/tab-lazy-loading.test.js tests/schedule-read-integration.test.js

- [ ] **Step 3: Implement requestTabSwitch**

Keep the current table in the DOM and place a non-destructive loading overlay over it. Do not clear STUDENTS, INST_MAP, or the previous table while loading.

On success verify sequence, set active tab, load tab data and badge maps, build once, render tab bar, and remove overlay. On failure remove the overlay and show retry without changing active tab.

- [ ] **Step 4: Route all live-tab activation paths**

Update tab clicks, setMainTab, new-tab activation, copy or rollover activation, and fallback activation so live tabs use requestTabSwitch. Keep snapshot activation on switchTabView.

- [ ] **Step 5: Run tab and operation regressions**

Run: node --check js/tabs.js

Run: node --test --test-isolation=none tests/tab-lazy-loading.test.js tests/tab-operation-modal.test.js tests/schedule-read-integration.test.js tests/schedule-reservation-identity.test.js

Expected: all tests pass.

- [ ] **Step 6: Commit**

Commit message: Lazily switch main schedule tabs

---

### Task 5: Load attendance basis tabs before rendering or saving

**Files:**
- Modify: js/tabs.js
- Modify: js/table.js
- Modify: js/core.js
- Create: tests/attendance-lazy-tab.test.js
- Modify: tests/attendance-teacher-permission.test.js

**Interfaces:**
- Produces: ensureAttendanceBasisTabsLoaded(dates, options)
- Produces: isAttendanceDataReady()
- Produces: requireAttendanceDataReady(label)
- Consumes: getAttendanceBasisTabForDate, ensureScheduleTabLoaded, ensureAttendanceDaySnapshotsLoaded
- Preserves: getAttendanceBasisDataForDate and date snapshot key format

- [ ] **Step 1: Write failing attendance readiness tests**

Required cases:

- a week inside one regular month prepares one basis tab;
- a week crossing two operating months prepares both basis tabs;
- duplicate dates and basis tabs create one load per tab;
- a past date snapshot uses its existing deferred key;
- if a past snapshot is absent, its basis tab is ready before basis data is read;
- opening bangteuk loads only its students, teachers, attendance, and attGuests;
- unopened bangteuk attendance keys are never requested;
- rapid date changes render only the final week;
- individual and batch attendance, guest add or edit or delete, and today-all-present are blocked before readiness;
- all operations are enabled after readiness;
- readiness failure preserves attendance maps and blocks writes.

- [ ] **Step 2: Run attendance tests and confirm missing APIs**

Run: node --test --test-isolation=none tests/attendance-lazy-tab.test.js tests/attendance-teacher-permission.test.js

- [ ] **Step 3: Implement basis-tab preparation**

ensureAttendanceBasisTabsLoaded de-duplicates dates, resolves every basis tab, groups dates by tab, prepares required live or archived tab keys without changing the visible active tab, then loads date snapshots.

Background basis loads call setAuxiliaryKeys with owner attendance-basis. These listeners remain active while attendance mode is open, are replaced when the displayed week changes, and are released when attendance mode closes. They never replace the visible active subscription.

- [ ] **Step 4: Integrate attendance mode and date changes**

toggleAttendanceMode and attendance snapshot refresh show loading, await basis tabs and snapshots, then build the table. Existing data remains visible until the new week is ready.

- [ ] **Step 5: Guard every attendance write entry**

Call requireAttendanceDataReady from:

- applyAttBatch
- attendance cell cycle
- sub attendance cycle
- attendance modal save
- add attendance guest
- edit attendance student
- delete attendance student
- mark all present

This functional guard remains separate from role permissions.

- [ ] **Step 6: Run attendance regressions**

Run: node --check js/tabs.js

Run: node --check js/table.js

Run: node --test --test-isolation=none tests/attendance-lazy-tab.test.js tests/attendance-teacher-permission.test.js tests/tab-lazy-loading.test.js tests/schedule-read-integration.test.js

Expected: all tests pass.

- [ ] **Step 7: Commit**

Commit message: Guard lazy attendance data loading

---

### Task 6: Diagnostics and full regression boundary

**Files:**
- Modify: js/core.js
- Modify: tests/schedule-read-integration.test.js
- Modify: tests/attendance-lazy-tab.test.js

**Interfaces:**
- Extends: SCDataDiagnostics.recent()
- Produces diagnostic kinds: selected-initial, tab-load-start, tab-load-ready, tab-load-stale, tab-load-failed, attendance-basis-ready

- [ ] **Step 1: Add final source and diagnostics guards**

Require:

- normal main path contains no collection-wide subscription;
- inactive tab-owned keys are excluded from initialBaseKeys;
- every live tab click goes through requestTabSwitch;
- every attendance write entry calls requireAttendanceDataReady;
- diagnostics store requested keys, duration, and outcome without student bodies.

- [ ] **Step 2: Run all syntax checks**

Run node --check for js/schedule-key-selection.js, js/schedule-read-coordinator.js, js/firebase-store.js, js/core.js, js/tabs.js, and js/table.js.

- [ ] **Step 3: Run the complete suite**

Run: node --test --test-isolation=none tests/*.test.js

Expected: all runnable tests pass; optional Firestore emulator test may remain skipped.

- [ ] **Step 4: Verify permission and working-tree safety**

Run: node scripts/sync-permission-policy.js --check

Run: git diff --check

Run: git status --short

Expected: permission artifacts are synchronized and HANDOFF.md, backup, and outputs remain untouched.

- [ ] **Step 5: Commit**

Commit message: Guard selected schedule data reads
