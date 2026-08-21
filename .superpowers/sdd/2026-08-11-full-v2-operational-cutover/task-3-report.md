# Task 3 Implementation Report

## Status

DONE

## Changed Files

- `js/schedule-v2-operational-store.js`
- `js/schedule-operational-gateway.js`
- `index.html`
- `teacher.html`
- `desk.html`
- `settings.html`
- `tests/schedule-v2-operational-store.test.js`
- `tests/schedule-operational-gateway.test.js`
- `.superpowers/sdd/2026-08-11-full-v2-operational-cutover/task-3-report.md`

## Implementation Commit

- `970fd53` Add V2 operational browser gateway

The report is committed separately so it can record the exact implementation commit hash.

## RED Evidence

Initial command from the brief:

```powershell
node --test --test-isolation=none tests/schedule-v2-operational-store.test.js tests/schedule-operational-gateway.test.js
```

Result: 2 test files, 0 passed, 2 failed.

Expected failure reasons:

- `js/schedule-v2-operational-store.js` did not exist.
- `js/schedule-operational-gateway.js` did not exist.
- Both failures were `MODULE_NOT_FOUND`; no production implementation existed before the tests.

Review RED 1, expected callable revision notification:

```powershell
node --test --test-isolation=none tests/schedule-operational-gateway.test.js
```

Result: 10 tests total, 9 passed, 1 failed.

Expected failure reason: a matching Firestore runtime revision arriving immediately before the callable response was treated as a stale config change. The test required the notification to remain pending until the matching callable response was accepted.

Review RED 2, canonical verify parity:

```powershell
node --test --test-isolation=none tests/schedule-v2-operational-store.test.js
```

Result: 6 tests total, 5 passed, 1 failed.

Expected failure reason: parity compared serialized legacy JSON text rather than canonical values, so equivalent object-key ordering was reported as a mismatch.

Review RED 3, selected-batch initial compatibility:

```powershell
node --test --test-isolation=none tests/schedule-operational-gateway.test.js
```

Result: 10 tests total, 9 passed, 1 failed.

Expected failure reason: the V2 selected subscription emitted a base-only initial batch and a second active-tab batch. `FirestoreKVRoot` compatibility requires one initial batch containing both base and resolved active keys.

## GREEN Evidence

Exact focused commands:

```powershell
node --check js/schedule-v2-operational-store.js
node --check js/schedule-operational-gateway.js
node --test --test-isolation=none tests/schedule-v2-operational-store.test.js tests/schedule-operational-gateway.test.js tests/schedule-v2-store.test.js
git diff --check
git diff --cached --check
```

Results:

- Both syntax checks passed with exit code 0.
- Focused tests: 23 total, 23 passed, 0 failed, 0 skipped.
- Both worktree and staged diff checks passed with exit code 0.
- The focused suite covers runtime validation, selected-domain reads, 30-read chunks, model reconstruction, canonical parity, stale selection cancellation, all five modes, strict callable requests, stable retry IDs, revision acceptance, config fencing, root compatibility, diagnostics redaction, and page script order.

Full unit regression:

```powershell
npm.cmd run test:unit
```

The sandboxed package command could not spawn Node test workers. All 63 files failed before test code ran with `spawn EPERM`.

The complete suite was rerun in the SDD's supported single-process mode:

```powershell
$tests=Get-ChildItem tests -Filter *.test.js | ForEach-Object {$_.FullName}
node --test --test-isolation=none $tests
```

Result: 463 tests total, 461 passed, 0 failed, 2 skipped. The skips are the existing Firestore rules and Schedule V2 shadow emulator availability checks.

## Implementation Notes

- `SCV2OperationalStore.create(options)` reads only explicit requested domains and selected tabs. It never gets a generation root or enumerates every generation collection.
- Roster reads query selected tabs first, then fetch only referenced people and enrollments in batches of at most 30 document reads. Unselected placements cannot widen those references.
- Storage metadata is removed before `SCV2OperationalModel.legacyRootFromCollections` reconstructs the stable legacy root. Verify parity compares parsed legacy values canonically.
- `SCOperationalSchedule.create(options)` keeps the exact authority matrix: V1-only, existing shadow, awaited verify parity, V2 callable with tracked recovery, and V2 callable without recovery.
- Once V2 authority is confirmed, V2 read failures remain blocking V2 errors and never read V1 as a fallback.
- The gateway exposes root-compatible `child`, `once`, `transactionKeys`, `subscribeSelectedBatches`, `currentConfig`, and `diagnostics` methods with Firebase-style snapshots and `{committed, snapshot}` transaction results.
- V2 transactions load the affected view, run the existing mutator locally, calculate changed legacy keys, and send exactly the nine Task 2 request fields. One operation ID is retained across bounded transient retries.
- Cache and visible subscription batches change only after a matching branch, generation, epoch, selected-tab context, operation ID, and server revision are accepted.
- A config change invalidates pending loads and requests a controlled reload. A matching revision notification from the operation in flight waits for the callable response instead of updating cache independently.
- Diagnostics retain only branch, mode, generation, epoch, revision, operation metadata, counts, safe outcome, error code, and timestamp. They do not retain keys, names, phone numbers, payloads, or error messages.
- The operational model, store, and gateway load once after the existing schedule schema/store modules and before each staff runtime. No module initializes Firebase.

## Scope and Constraints

- `parent.html`, referral paths, customer voice paths, page runtime files, permission files, production mode, and deployment configuration were unchanged.
- The commit hook generated `js/version.js` and `version.json` changes during the first commit attempt. Those changes were removed before finalizing implementation commit `970fd53`; the commit contains only the eight Task 3 implementation files.
- No deployment, push, production-data access, or production-mode transition was performed.

## Concerns

- Non-blocking: emulator-backed rule and shadow tests remain environment-dependent and were the two existing skips. All browser store/gateway tests and the remaining unit regression passed locally.

---

## Independent Review Remediation

Date: 2026-08-11

All eight independent-review findings were reproduced with direct regression or integration tests and fixed without changing the operational mode, page permissions, parent page, referral paths, customer voice paths, or production state.

### Review RED Evidence

Command:

```powershell
node --test --test-isolation=none tests/schedule-v2-operational-store.test.js tests/schedule-operational-gateway.test.js
```

Result before remediation: 30 tests total, 15 passed, 15 failed, 0 skipped.

The expected failures directly demonstrated:

- functions-prefixed callable errors were not retried;
- shared mutation values were prepared from a partial display read;
- manufactured unloaded values replaced valid cached values;
- a pending callable could commit after a tab switch;
- bangteuk roster keys were parsed as malformed tab IDs;
- verify compared the whole V1 root and did not carry a shadow fence;
- stop-before-ready and root disposal did not cancel listeners completely;
- `index.html` did not load Firebase Functions compat;
- roster-only reads materialized every unread collection and legacy default;
- attendance-only reconstruction failed without unrelated identity reads;
- no authoritative mutation loader existed;
- verify did not wait for delayed shadow completion.

### Finding-by-Finding Resolution

1. Added `loadMutation` as a separate authoritative path. Shared maps (`swim_mark`, reservation maps, tab list, disabled slots, calendar, administration, and history keys) read their complete owning collections. Roster and attendance keys read only their exact key-owned tabs. The existing mutator now receives complete values for every affected key before `nextValues` is computed.
2. Replaced the all-empty collection map with sparse loaded collections and explicit `loadedKeys`. Display cache merging touches only that authoritative projection; unread keys survive, while a requested-but-absent key is correctly evicted.
3. Attendance-only reads fetch minimal selected tab metadata, records, guests, snapshot headers, and snapshot children. A model-only validation copy omits unavailable person, enrollment, and class-mark references, while returned rows remain unchanged. No people or enrollment query is issued.
4. Added exact, distinct roster, attendance, guest, bundled snapshot, and daily snapshot patterns. Key-owned tab IDs are resolved before the current/default tab, covering regular-to-bangteuk and bangteuk-to-regular changes and removals.
5. Added a monotonic selection generation and active selection signature to every captured operation context. Branch, generation ID, epoch, tab signature, session, selection generation, and expected revision are rechecked immediately before cache or config mutation. Stale load and callable completions return controlled stale errors and cannot publish or advance local revision.
6. Verify now projects only selected keys, captures the pre-write shadow revision, and requires a later settled shadow revision before parity. The store polls pending/in-flight shadow state with a bounded timeout, then distinguishes delayed completion from a settled true mismatch.
7. Added exactly one Firebase Functions compat script to `index.html`, after Firestore and before the operational gateway. Tests validate this order on all four staff pages and confirm no duplicate Firebase initialization.
8. Retry codes normalize `functions/` and `firebase/functions/` prefixes. Stop and dispose invalidate pending selections, prevent late delegate creation, stop active delegates, unsubscribe the config listener, and remain idempotent.

### Review GREEN Evidence

Syntax and focused regression:

```powershell
node --check js/schedule-v2-operational-store.js
node --check js/schedule-operational-gateway.js
node --test --test-isolation=none tests/schedule-v2-operational-store.test.js tests/schedule-operational-gateway.test.js tests/schedule-v2-store.test.js
```

Result: both syntax checks exited 0. Focused tests: 40 total, 40 passed, 0 failed, 0 skipped.

The final focused suite includes multi-tab preservation for marks, reservations, tab lists, roster values, and disabled slots; sparse roster/cache preservation; attendance records, guests, bundled snapshots, and selected metadata; overlapping tab loads; stale callable completion after tab, branch, and config changes; delayed shadow completion and true mismatch; exact active-key removals in both tab directions; prefixed retry codes; stop-before-ready; config unsubscribe; script order; strict callable fields; and stable retry operation IDs.

The default package command was also attempted:

```powershell
npm.cmd run test:unit
```

The sandbox prevented Node from spawning test workers, so all 63 files stopped before test code with `spawn EPERM`. The complete suite was then run in the repository's supported single-process mode:

```powershell
node --test --test-isolation=none tests/*.test.js
```

Result: 480 tests total, 478 passed, 0 failed, 2 skipped. The two skips are the existing Firestore rules emulator and Schedule V2 shadow emulator availability checks.

Final hygiene commands:

```powershell
git diff --check
git diff --cached --check
```

No deployment, push, production-data access, or production mode change was performed.

---

## Second Independent Review Remediation

Date: 2026-08-11

The two remaining P1 findings were reproduced and fixed without changing the mode matrix, callable request contract, retry operation IDs, stale-response fences, SDK order, lifecycle behavior, diagnostics content, permissions, or production configuration.

### Second Review RED Evidence

Initial command:

```powershell
node --test --test-isolation=none tests/schedule-v2-operational-store.test.js tests/schedule-operational-gateway.test.js
```

Result before implementation: 40 tests total, 35 passed, 5 failed, 0 skipped.

The five expected failures proved that:

- a bundled attendance edit prepared from date A omitted date B from `swim_attendance`;
- an explicit daily snapshot key incorrectly obeyed a conflicting caller `dateRange` instead of its embedded date;
- a no-op verify transaction incorrectly required a shadow revision advance;
- one unrelated settled shadow revision caused an immediate selected-parity mismatch;
- a persistent mismatch was reported after one comparison instead of bounded polling.

An additional selected-scope regression was then run independently:

```powershell
node --test --test-isolation=none --test-name-pattern="selected parity is not rejected" tests/schedule-v2-operational-store.test.js
```

Result before implementation: 1 test total, 0 passed, 1 failed. A matching selected projection was incorrectly rejected by an unrelated global `mismatchCount`.

### Second Review Resolution

1. Authoritative attendance mutation selection now distinguishes bundled and daily keys. Bundled record, guest, and snapshot keys ignore display `dateRange` and reconstruct the complete backing date scope for their exact owned tabs. Only `zz_swim_day_snapshot__...__YYYY-MM-DD` keys are scoped, and their date is derived from the key rather than caller display state.
2. Verify mode captures the selected V1 values immediately before the existing mutator runs and compares them with the committed snapshot. No-op transactions verify current settled selected parity without requiring advancement. Changed transactions capture the pre-write shadow revision, then poll bounded settled states and compare authoritative selected values. An unrelated revision can trigger a comparison but cannot produce a verdict while expected selected values are absent; delayed matching parity succeeds, persistent advanced mismatch ends with `v2-operational-parity-mismatch`, and no advancement ends with `v2-operational-shadow-timeout`.
3. Global shadow mismatch counts no longer override an equivalent selected projection. Verify verdicts remain scoped to the requested keys and contain no payload data in diagnostics.

### Second Review GREEN Evidence

Syntax and focused suite:

```powershell
node --check js/schedule-v2-operational-store.js
node --check js/schedule-operational-gateway.js
node --test --test-isolation=none tests/schedule-v2-operational-store.test.js tests/schedule-operational-gateway.test.js tests/schedule-v2-store.test.js
```

Result: both syntax checks exited 0. Focused tests: 48 total, 48 passed, 0 failed, 0 skipped.

The new focused coverage includes a real store-plus-gateway two-date mutation proving that edits to date A preserve date B in callable `nextValues` for records, guests, and bundled snapshots; embedded daily-date selection; no-op verify; unrelated revision advancement; delayed expected selected parity; unrelated global mismatch state; bounded true mismatch; and bounded no-advance timeout.

Complete unit regression:

```powershell
node --test --test-isolation=none tests/*.test.js
```

Result: 488 tests total, 486 passed, 0 failed, 2 skipped. The skips remain the existing Firestore rules emulator and Schedule V2 shadow emulator availability checks.

No deployment, push, production-data access, or production mode change was performed.
