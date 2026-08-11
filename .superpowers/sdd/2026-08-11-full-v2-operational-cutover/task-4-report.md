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

## Second Review Remediation - Server-Backed Request Recovery

### Status

FIXED

### RED Evidence

The second-review focused suite was run after removing the unsafe browser expectations and adding direct server-protocol regressions, before production changes:

```powershell
node --test --test-isolation=none tests/function-schedule-v2-operational-writer.test.js tests/function-schedule-v2-operational-api.test.js tests/schedule-operational-gateway.test.js tests/schedule-v2-main-integration.test.js tests/schedule-v2-staff-pages.test.js
```

Result: 78 tests total, 64 passed, 14 failed. The failures proved the missing versioned schema and callable, durable staging and manifest reconciliation, V1 rollback draining, precondition-preserving request patch, bounded lease retry, concurrent idempotency, corrupt-record rejection, no-op V2 manifest, real staff startup drain, and removal of browser-persisted recovery state.

A stricter malformed-transition regression was also run before its validation fix:

```powershell
node --test --test-isolation=none --test-name-pattern="exact non-PII" tests/function-schedule-v2-operational-writer.test.js
```

Result: 1 test, 0 passed, 1 failed. It proved accepted transitions without a processing timestamp and incomplete cancellation intents were still admitted.

### GREEN Evidence

Syntax checks covered the functions boundary and every affected operational/page runtime:

```powershell
$files=@('functions/index.js','functions/schedule-v2-operational-policy.js','functions/schedule-v2-operational-writer.js','js/firebase-store.js','js/schedule-operational-gateway.js','js/schedule-v2-operational-store.js','js/schedule-read-coordinator.js','js/schedule-key-selection.js','js/schedule-write-gateway.js','js/core.js','js/data.js','js/teacher.js','js/desk.js','js/settings.js')
foreach($file in $files){ node --check $file }
```

Result: all 14 syntax checks exited 0.

The expanded direct and Task 4 suite was run:

```powershell
node --test --test-isolation=none tests/function-schedule-v2-operational-writer.test.js tests/function-schedule-v2-operational-api.test.js tests/schedule-read-coordinator.test.js tests/schedule-write-gateway.test.js tests/schedule-write-boundary.test.js tests/schedule-operational-gateway.test.js tests/schedule-v2-operational-store.test.js tests/schedule-v2-main-integration.test.js tests/schedule-v2-staff-pages.test.js
```

Result: 117 tests total, 117 passed, 0 failed, 0 skipped.

The full unit regression was run:

```powershell
$tests=Get-ChildItem tests -Filter *.test.js | ForEach-Object {$_.FullName}
node --test --test-isolation=none $tests
```

Result: 518 tests total, 516 passed, 0 failed, 2 skipped. The skips remain the existing Firestore rules and Schedule V2 shadow emulator availability checks.

Hygiene:

```powershell
git diff --check
```

Result: exit 0. Git emitted only the repository's existing LF-to-CRLF checkout warnings.

### Implementation Notes

- The browser local/session storage recovery queue and its public retry/status methods were removed. The browser keeps the full request map only in memory long enough to derive request-ID-specific status intents; it persists no request, student, name, phone, or raw `swim_requests` value and receives only redacted state, attempt, operation ID, and code fields.
- `manageScheduleV2RequestRecovery` owns an exact version-1 schema. It rejects unknown fields, unsupported operation/status values, invalid IDs, unbounded integers, incomplete transition patches, and corrupt stored records. Stored records contain only branch/request IDs, allowlisted transition intent, preconditions, linked operation ID, lease/retry state, and timestamps.
- The browser stages the recovery with the same stable operation UUID before invoking V2. `requireOperationManifest` is adapter-only metadata; the original Task 2 callable request keys remain exact and unchanged. A no-op tracked mutation still commits a V2 manifest when the linked request phase needs a commit oracle.
- The server worker applies the V1 request patch only after the linked operational manifest is committed. Missing or incomplete manifests remain waiting and expire to an explicit cancelled state. A committed manifest remains drainable after a V2-to-V1 rollback.
- Request updates run transactionally against the current `swim_requests` value. Only named request IDs and allowlisted fields change; unrelated requests and newer fields survive. Status/version preconditions prevent overwriting newer parent or staff decisions, and already-applied target statuses complete idempotently.
- Server-side leases and a five-attempt bound coordinate tabs/devices. Patch and completion status commit atomically, so an interrupted final transaction retries after lease expiry without duplicate marking. Corrupt queue documents are replaced with a minimal redacted rejected status.
- The scheduled operational recovery now drains request recoveries too. Authenticated teacher and desk `loadAllData` startup tests execute their real selected-batch path and prove draining occurs without a public `ready()` call, regardless of runtime authority mode.

### Self-Review

- Privacy: no browser storage or diagnostic path contains the request map or PII. Server queue tests inspect stored records while the legacy transaction retains unrelated PII only in its authoritative source document.
- Authority: V2 commit status is the only signal that permits the second phase. An absent or `committing` manifest never writes V1; ambiguous client responses remain reconcilable by operation ID.
- Concurrency: request status/version checks protect newer edits, Firestore transactions provide cross-device serialization, leases bound retries, and completion is idempotent.
- Existing findings: full tab-list metadata with scoped roster payload, controlled runtime reload, last-good cache retention, stale response fencing, and settings sequence guards remain covered and green.
- Compatibility: page-facing root and transaction signatures, Task 2 callable shape, single shared write boundaries, parent V1 behavior, referral, voice, permissions, and Korean UX remain unchanged.
- Operations: no production mode change, deployment, push, production access, or production data operation was performed.

## Final Review Remediation - Recovery Correctness and Operations

### Status

FIXED

### RED Evidence

The direct functions regressions were added before the final-round implementation and run with:

```powershell
node --test --test-isolation=none tests/function-schedule-v2-operational-writer.test.js tests/function-schedule-v2-operational-api.test.js
```

Initial result: 51 tests total, 38 passed, 13 failed. The expected failures covered exact same-status matching, manifest linkage and version conflicts, stale cancellation, trusted `processedBy` parity, canonical production IDs, contradictory transition/state schemas, terminal starvation, pagination, retention cleanup, recovery counts, and the independent scheduler export.

Additional narrow RED checks caught the final audit edges:

```powershell
node --test --test-isolation=none --test-name-pattern="request recovery accepts production IDs|noncanonical operation key" tests/function-schedule-v2-operational-writer.test.js
node --test --test-isolation=none --test-name-pattern="malformed stored request recovery" tests/function-schedule-v2-operational-writer.test.js
node --test --test-isolation=none --test-name-pattern="operational status exposes bounded request|authenticated recovery status" tests/function-schedule-v2-operational-writer.test.js
```

Results before their production fixes were respectively 0/2, 0/1, and 0/2 passing. They proved that scoped status requests were too broad, corrupt noncanonical queue keys survived scrubbing, rejected records could be reclaimed through an explicit drain, and redacted status omitted queue classes.

### GREEN Evidence

Final syntax checks:

```powershell
$files = @('functions/index.js','functions/schedule-v2-operational-policy.js','functions/schedule-v2-operational-writer.js','js/desk.js')
foreach ($file in $files) { node --check $file }
```

Result: all four files exited 0.

Final focused Task 4 and operational-contract suite:

```powershell
node --test --test-isolation=none tests/function-schedule-v2-operational-writer.test.js tests/function-schedule-v2-operational-api.test.js tests/schedule-read-coordinator.test.js tests/schedule-write-gateway.test.js tests/schedule-write-boundary.test.js tests/schedule-operational-gateway.test.js tests/schedule-v2-operational-store.test.js tests/schedule-v2-main-integration.test.js tests/schedule-v2-staff-pages.test.js
```

Result: 136 tests total, 136 passed, 0 failed, 0 skipped.

Final full unit regression:

```powershell
$tests = Get-ChildItem tests -Filter *.test.js | ForEach-Object { $_.FullName }
node --test --test-isolation=none $tests
```

Result: 537 tests total, 535 passed, 0 failed, 2 skipped. The skips remain the existing Firestore rules and Schedule V2 shadow emulator availability checks.

Hygiene:

```powershell
git diff --check
```

Result: exit 0. Git emitted only the repository's LF-to-CRLF checkout notices.

### Final Implementation Notes

- Same-status completion now requires an exact match for every persisted transition field, timestamp and request linkage, the expected request version, trusted processor identity, and cleared processing fields. Any newer version, stale cancellation, different supersession/cancellation link, contradictory persisted field, or operational-manifest mismatch returns an explicit conflict.
- Recovery records remain non-PII. The committed V2 manifest stores only the actor hash; the server resolves that hash against the trusted permission profile at apply time and writes the current V1-compatible teacher or desk display name only into the authoritative `swim_requests` request.
- Stage commands use exact target-status schemas and status-compatible preconditions. Stored queue records use exact state-discriminated schemas and required state timestamps. Request IDs accept only the production `r_<13 digits>_<6 base36>` form, and recovery operation IDs accept only generated lowercase UUID v4 values; phone-, name-, and path-like identifiers are rejected.
- Invalid canonical records are replaced with a minimal redacted terminal record. A corrupt noncanonical document key is deleted, terminal states cannot be reclaimed, and exhausted errors are absent from active candidate queries.
- Active recovery uses ordered, bounded pagination. Terminal records receive Firestore timestamp `expiresAt` values, are retained for seven days, and are deleted in bounded batches. Authenticated status exposes redacted counts for every active and terminal queue class without request IDs or intents.
- Request recovery has its own exported five-minute scheduler. Operational mirror failure cannot prevent that independent invocation from running, and the original mirror schedule no longer owns request recovery execution.
- Desk absence cancellation now supplies the established `absence-cancel` operation type through the existing shared write boundary, preserving the page-facing transaction signature and server authorization contract.

### Final Self-Review

- Idempotency and concurrency: the V2 manifest remains the commit oracle; the stable operation UUID links both phases; Firestore transactions, leases, exact preconditions, and terminal-state handling prevent duplicate or stale completion across tabs and devices.
- Privacy: queue schemas contain only canonical IDs, allowlisted transition intent, retry state, timestamps, and the linked operation ID. No name, phone, student, raw request body, `processedBy`, or `processingBy` is persisted in browser recovery storage, queue records, callable responses, or diagnostics.
- Operations: active candidates exclude exhausted and terminal errors, pagination is ordered and bounded, terminal retention is cleanup- and TTL-compatible, all queue states are countable, and request recovery scheduling is isolated from mirror failures.
- Compatibility: the Task 2 mutation callable body remains unchanged. Staff startup draining, V2 startup scoping, V1 rollback recovery, no-V1-fallback authority, lazy attendance/history, cache and stale-response protections, settings sequencing, and the single `_scheduleWrites` boundary remain covered by the focused and full suites.
- Scope: this round changes only the functions entry point, operational policy/writer modules, the desk boundary adapter, four direct/integration test files, and this report. Parent, referral, voice, permissions, Korean UX, production mode, deployment, push, and production access remain untouched.
