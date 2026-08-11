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
