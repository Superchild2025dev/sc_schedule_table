# Task 4 Implementation Report

## Status

DONE

## Changed Files

- `js/firebase-store.js`
- `js/schedule-read-coordinator.js`
- `js/schedule-key-selection.js`
- `js/schedule-write-gateway.js`
- `js/core.js`
- `js/data.js`
- `js/teacher.js`
- `js/desk.js`
- `js/settings.js`
- `tests/schedule-read-coordinator.test.js`
- `tests/schedule-write-gateway.test.js`
- `tests/schedule-v2-main-integration.test.js`
- `tests/schedule-v2-staff-pages.test.js`
- `.superpowers/sdd/2026-08-11-full-v2-operational-cutover/task-4-report.md`

## RED Evidence

The exact Task 4 RED command was run before production changes:

```powershell
node --test --test-isolation=none tests/schedule-read-coordinator.test.js tests/schedule-write-gateway.test.js tests/schedule-v2-main-integration.test.js tests/schedule-v2-staff-pages.test.js
```

Result after correcting one Node fixture import: 26 tests total, 21 passed, 5 failed.

The expected failures proved that:

- stale branch/tab/epoch batches replaced the visible cache;
- authenticated `createBranchRef` did not construct the Task 3 operational root;
- startup keys had no V2 domain/tab translation API;
- teacher and desk still used whole-root startup reads;
- write metadata and a stable operation UUID did not reach root methods.

A self-review RED test was added for parent-request processing:

```powershell
node --test --test-isolation=none --test-name-pattern="mixed parent-request" tests/schedule-v2-main-integration.test.js
```

Result: 1 test, 0 passed, 1 failed. The tracked `swim_mark` key incorrectly followed the V1-only `swim_requests` key into a legacy transaction during V2 authority.

## GREEN Evidence

Exact focused syntax commands:

```powershell
node --check js/firebase-store.js
node --check js/schedule-read-coordinator.js
node --check js/schedule-key-selection.js
node --check js/schedule-write-gateway.js
node --check js/core.js
node --check js/data.js
node --check js/teacher.js
node --check js/desk.js
node --check js/settings.js
```

Result: every command exited 0.

Exact focused Task 4 suite:

```powershell
node --test --test-isolation=none tests/schedule-read-coordinator.test.js tests/schedule-write-gateway.test.js tests/schedule-write-boundary.test.js tests/schedule-v2-main-integration.test.js tests/schedule-v2-staff-pages.test.js
```

Result: 28 tests total, 28 passed, 0 failed, 0 skipped.

Full unit regression:

```powershell
$tests=Get-ChildItem tests -Filter *.test.js | ForEach-Object {$_.FullName}
node --test --test-isolation=none $tests
```

Result: 498 tests total, 496 passed, 0 failed, 2 skipped. The two skips are the existing Firestore rules and Schedule V2 shadow emulator availability checks.

Hygiene:

```powershell
git diff --check
```

Result: exit 0.

## Implementation Notes

- `SCFirebaseStore.createBranchRef(branch)` creates the existing V1 root first. It returns that root before staff authentication is ready, and after authenticated branch selection it constructs `SCV2OperationalStore` and the Task 3 `SCOperationalSchedule` gateway.
- Task 3 remains authoritative for runtime confirmation, V1-before-confirmation behavior, confirmed-V2 failure handling, epoch/revision fencing, callable retries, accepted-revision cache updates, and legacy-shaped snapshots.
- Startup and tab keys now map to fixed V2 domains and exact owned tab IDs. Attendance and history keys are absent from startup; retirement history and desk records load through the auxiliary selection when the history view opens.
- Main, teacher, and desk startup use selected batches. V2 startup never calls the V1 whole-root read. Parent-originated request data remains on its explicitly out-of-scope V1 child path.
- Mixed request-processing transactions split by authority only after runtime readiness: tracked schedule keys commit through V2 first, while `swim_requests` remains V1. A V2 failure prevents the V1 request update and never falls back tracked keys to V1.
- Every shared write receives `operationId`, `operationType`, and `label`. Generated IDs are UUID v4 values; a supplied operation ID is retained so Task 3 retries reuse the same logical operation ID.
- Existing `set`, `remove`, one-key transaction, `transactionKeys`, and Firebase-style result shapes remain unchanged.
- Main single-key cache entries are retained while a write is pending and changed only after authoritative success. Coordinator context guards reject old branch/tab/epoch batches before cache or render changes.
- Teacher, desk, and settings update local page state only from completed selected reads or committed transaction snapshots. Settings branch-load sequence guards prevent an old branch response from rerendering the current branch.

## Self-Review

- Scope audit: only the thirteen Task 4 implementation/test files and this report changed.
- Authority audit: no page writes directly to `scheduleV2`; tracked writes remain behind `_scheduleWrites` or its page-specific shared gateway instance.
- Startup audit: no teacher or desk whole-root startup read remains; attendance/history collections are not selected by initial keys.
- Failure audit: confirmed V2 read/write errors are not converted into V1 tracked-key reads or writes. Visible cache data is retained while operations are pending.
- Stale-result audit: Task 3 branch/generation/epoch/selection guards remain intact, the coordinator has an additional context hook, and settings uses per-branch request sequencing.
- Compatibility audit: main, teacher, desk, settings, popup/tab/table write callers retain their existing public signatures. Parent, referral, voice, permissions, and Korean UX text were not changed.
- Operational audit: no mode change, deployment, push, production access, or production data operation was performed.

## Residual Note

The full regression's two existing emulator availability checks remain skipped in this local environment. No Task 4 test or syntax check is skipped.

## Review Remediation - 2026-08-11

### Status

FIXED

### Review RED Evidence

The direct review regression command was run before the production fixes:

```powershell
node --test --test-isolation=none tests/schedule-v2-operational-store.test.js tests/schedule-operational-gateway.test.js tests/schedule-v2-main-integration.test.js tests/schedule-v2-staff-pages.test.js
```

Result: 59 tests total, 50 passed, 9 failed.

The nine expected failures proved all five review findings:

- selected startup returned only the requested tab in `swim_tab_list`;
- V1 delegates and config listeners survived a V1-to-V2 change, and `createBranchRef` supplied no controlled reload callback;
- external generation, epoch, and revision changes had no complete one-shot page reload path;
- a successful V2 mark followed by a failed V1 `swim_requests` phase had no durable retry or bounded recovery status;
- refresh failure deleted the last good memory and local cache;
- stale A-to-B-to-A settings feedback success and failure both replaced the latest A state.

### Review GREEN Evidence

Syntax checks were run for every relevant runtime:

```powershell
node --check js/firebase-store.js
node --check js/schedule-operational-gateway.js
node --check js/schedule-v2-operational-store.js
node --check js/schedule-read-coordinator.js
node --check js/schedule-key-selection.js
node --check js/schedule-write-gateway.js
node --check js/core.js
node --check js/data.js
node --check js/teacher.js
node --check js/desk.js
node --check js/settings.js
```

Result: all eleven commands exited 0.

The combined Task 4 and direct operational contract suite was run:

```powershell
node --test --test-isolation=none tests/schedule-read-coordinator.test.js tests/schedule-write-gateway.test.js tests/schedule-write-boundary.test.js tests/schedule-v2-main-integration.test.js tests/schedule-v2-staff-pages.test.js tests/schedule-operational-gateway.test.js tests/schedule-v2-operational-store.test.js
```

Result: 79 tests total, 79 passed, 0 failed, 0 skipped.

The full unit regression was run:

```powershell
$tests=Get-ChildItem tests -Filter *.test.js | ForEach-Object {$_.FullName}
node --test --test-isolation=none $tests
```

Result: 508 tests total, 506 passed, 0 failed, 2 skipped. The skips remain the existing Firestore rules and Schedule V2 shadow emulator availability checks.

Hygiene:

```powershell
git diff --check
```

Result: exit 0. Git reported only the repository's existing LF-to-CRLF checkout warnings.

### Review Implementation Notes

- An explicit `swim_tab_list` read now loads every tab document plus the stored main-tab pointer. Placements, teacher assignments, people, and enrollments remain scoped to selected tabs, and the real store test proves the unrelated roster references are never read.
- Runtime authority, generation, epoch, or external revision changes make the old gateway root terminal. Config listeners, selected controllers, and V1 delegates stop immediately; guarded callbacks reject late batches; `createBranchRef` performs one reload per runtime fingerprint.
- Mixed staff request processing persists the computed legacy phase before V2 mutation, retains the existing operation UUID, marks only the legacy phase pending after authoritative V2 success, and resumes that phase on root readiness without replaying V2. Attempts are capped at three. Exposed status contains operation metadata, counts, state, and safe error codes only.
- A failed authoritative refresh now leaves `_dbCache`, local storage, and the visible timetable unchanged. A successful read that explicitly returns absence still removes the cached key and queues the normal refresh.
- Settings rechecks the per-branch sequence after the feedback await and before the feedback fallback catch mutation, preventing stale A-to-B-to-A responses from assigning state or rendering.

### Review Self-Review

- Scope: the review findings were inside the consumed Task 3 store and gateway contracts, so the remediation includes only those two runtime modules, their two direct tests, the affected Task 4 files, and this report. The original pre-review scope audit above is superseded by this review-specific scope.
- Authority: valid V2 sessions still never fall back to V1 for tracked reads or writes. The durable retry writes only the explicitly untracked legacy request payload.
- Startup: V2 mode still performs no whole V1 schedule read. Attendance and history remain lazy, while full tab metadata does not widen roster payload reads.
- Mutation boundary: pages still write through the existing shared gateways; no page writes directly to `scheduleV2`. Existing `set`, `remove`, one-key transaction, `transactionKeys`, and snapshot result shapes remain unchanged.
- Stale and pending state: runtime changes stop old producers before reload, late batches are blocked, failed refreshes retain last-good state, and settings sequence checks guard both success and failure paths.
- Compatibility: main, teacher, desk, settings, popup, tab, and table callers were not broadly rewritten. Parent, referral, voice, permissions, and Korean user-facing text remain unchanged.
- Operations: no mode change, deployment, push, production access, or production data operation was performed.
