# Schedule Change Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 퇴원·제외·횟수줄임·이동 및 이동 세부 종류 판정을 하나의 순수 모듈로 통일하고 기존 화면과 V1 데이터 형식을 유지한다.

**Architecture:** `js/schedule-change-policy.js`가 변경 종류를 판정하는 유일한 구현이 된다. `data.js`, `table.js`, `popup-stu.js`의 기존 전역 함수 이름은 호환 래퍼로 유지하되 공통 모듈 결과를 반환한다. 저장과 렌더링 순서는 바꾸지 않는다.

**Tech Stack:** 브라우저 전역 IIFE, CommonJS 테스트 export, Node.js 내장 test runner, 기존 Firebase V1 JSON 데이터

## Global Constraints

- 기존 V1 저장 키와 JSON 필드의 의미를 변경하지 않는다.
- 기존 화면 레이아웃과 버튼 흐름을 변경하지 않는다.
- 방학특강 기록 제외와 수동 삭제 보존 규칙을 유지한다.
- 새 외부 라이브러리를 추가하지 않는다.
- 모든 동작 변경은 실패하는 테스트를 먼저 확인한다.

---

### Task 1: Pure schedule change policy

**Files:**
- Create: `js/schedule-change-policy.js`
- Create: `tests/schedule-change-policy.test.js`

**Interfaces:**
- Produces: `SCScheduleChangePolicy.movementReason(fromSlot, toSlot)`
- Produces: `SCScheduleChangePolicy.isActualRetirement(entry, context)`
- Produces: `SCScheduleChangePolicy.reservationKind(entry, context)`
- Produces: `SCScheduleChangePolicy.reservationLabel(entry, context)`
- Produces: `SCScheduleChangePolicy.reservationStatus(entry, context)`
- Produces: `SCScheduleChangePolicy.visibleChangeReason(input)`
- Produces: `SCScheduleChangePolicy.shouldSuppressGenericDelete(note)`

- [ ] **Step 1: Write failing pure-policy tests**

Cover explicit retirement, history-backed retirement, move, reduced frequency, general exclusion, day/time/class movement, manual deletion, and generated deletion suppression.

- [ ] **Step 2: Run the focused test and confirm module-not-found failure**

Run: `node --test --test-isolation=none tests/schedule-change-policy.test.js`

Expected: FAIL because `js/schedule-change-policy.js` does not exist.

- [ ] **Step 3: Implement the UMD policy module**

The module must clone or read inputs only, normalize names and phone numbers for history matching, compare slot fields in day → time → class priority, and use conservative non-retirement defaults.

- [ ] **Step 4: Run focused tests and syntax check**

Run: `node --check js/schedule-change-policy.js`

Run: `node --test --test-isolation=none tests/schedule-change-policy.test.js`

Expected: all focused tests pass.

- [ ] **Step 5: Commit**

Commit message: `Add centralized schedule change policy`

### Task 2: Load policy and replace display classification

**Files:**
- Modify: `index.html`
- Modify: `js/table.js`
- Modify: `js/popup-stu.js`
- Modify: `tests/schedule-change-policy.test.js`

**Interfaces:**
- Consumes: `window.SCScheduleChangePolicy`
- Preserves: `_retireReservationIsActual`, `_retireReservationKindLabel`, `_summaryRetireStatus`, `_retireChoiceKind`, `_popupRetireIsActual`, `_popupRetireReasonText`

- [ ] **Step 1: Add failing integration assertions**

Assert that `index.html` loads the policy before `data.js`, and that the table/popup compatibility functions delegate to `SCScheduleChangePolicy` rather than independently inspecting `retireType` and `excludeReason`.

- [ ] **Step 2: Run tests and confirm the assertions fail**

Run: `node --test --test-isolation=none tests/schedule-change-policy.test.js`

- [ ] **Step 3: Add the script and replace duplicate implementations with wrappers**

Pass `RETIRE_HISTORY`, slot key, student fallback, and the existing move-entry predicate into the common policy context. Keep every existing function signature intact.

- [ ] **Step 4: Run popup, capacity, reservation, and identity regression tests**

Run: `node --test --test-isolation=none tests/schedule-change-policy.test.js tests/schedule-capacity.test.js tests/schedule-reservation-identity.test.js tests/replacement-retire-preserve.test.js tests/retire-immediate.test.js`

Expected: all tests pass.

- [ ] **Step 5: Commit**

Commit message: `Use shared change policy in schedule UI`

### Task 3: Replace lower-record classification and deletion suppression

**Files:**
- Modify: `js/data.js`
- Modify: `tests/schedule-change-policy.test.js`
- Modify: existing `tests/schedule-audit-*.test.js` assertions only where they explicitly require old duplicate implementations

**Interfaces:**
- Consumes: `movementReason`, `isActualRetirement`, `visibleChangeReason`, `shouldSuppressGenericDelete`
- Preserves: `_scheduleAuditMovementReason`, `_scheduleAuditIsActualRetire`, `_scheduleAuditVisibleReason`, `_deskNoteIsGenericDeleteFromSpecificOperation`

- [ ] **Step 1: Add failing static delegation assertions**

Assert that all four compatibility functions call the central policy and that the generic delete function no longer contains its own operation-label regular expression.

- [ ] **Step 2: Run focused audit tests and confirm the new assertions fail**

Run: `node --test --test-isolation=none tests/schedule-change-policy.test.js tests/schedule-audit-dedupe.test.js tests/schedule-audit-move.test.js tests/schedule-audit-reason.test.js`

- [ ] **Step 3: Replace duplicate data-layer decisions with policy calls**

Keep Firestore writes, desk-note merge keys, month filtering, teacher lookup, and DOM rendering unchanged.

- [ ] **Step 4: Run all retirement and lower-record tests**

Run: `node --test --test-isolation=none tests/schedule-change-policy.test.js tests/schedule-audit-bangteuk.test.js tests/schedule-audit-dedupe.test.js tests/schedule-audit-move.test.js tests/schedule-audit-reason.test.js tests/schedule-retire-duplicate.test.js tests/retire-immediate.test.js`

Expected: all tests pass.

- [ ] **Step 5: Commit**

Commit message: `Centralize lower record classification`

### Task 4: Regression guard and full verification

**Files:**
- Modify: `tests/schedule-change-policy.test.js`

**Interfaces:**
- Produces: a source-boundary test preventing duplicate change-kind implementations in operational UI files

- [ ] **Step 1: Add a duplicate-rule regression guard**

Scan `data.js`, `table.js`, and `popup-stu.js` compatibility function bodies and require delegation to `SCScheduleChangePolicy`.

- [ ] **Step 2: Run syntax checks**

Run `node --check` for `js/schedule-change-policy.js`, `js/data.js`, `js/table.js`, and `js/popup-stu.js`.

- [ ] **Step 3: Run the complete unit suite**

Run: `node --test --test-isolation=none tests/*.test.js`

Expected: all runnable tests pass; the configured Firestore emulator test may remain skipped when its optional environment is absent.

- [ ] **Step 4: Verify permission policy synchronization and working tree scope**

Run: `node scripts/sync-permission-policy.js --check`

Run: `git diff --check`

Expected: policy artifacts are in sync and no whitespace errors exist.

- [ ] **Step 5: Commit**

Commit message: `Guard centralized change classification`
