# Task 5 Implementation Report

## Status

DONE

## Changed Files

- `js/attendance-v2-store.js`
- `js/attendance-operational-gateway.js`
- `js/attendance-main-runtime.js`
- `js/schedule-v2-operational-store.js`
- `js/teacher.js`
- `js/version.js` (commit hook)
- `functions/schedule-v2-operational-writer.js`
- `tests/attendance-operational-gateway.test.js`
- `tests/attendance-v2-operational-scenarios.test.js`
- `tests/attendance-v2-store.test.js`
- `tests/schedule-v2-operational-store.test.js`
- `tests/schedule-v2-marks-operational.test.js`
- `version.json` (commit hook)
- `.superpowers/sdd/2026-08-11-full-v2-operational-cutover/task-5-report.md`

## RED Evidence

The exact Task 5 RED command was run before production changes:

```powershell
node --test --test-isolation=none tests/attendance-operational-gateway.test.js tests/attendance-v2-operational-scenarios.test.js tests/schedule-v2-marks-operational.test.js
```

After correcting test-fixture module loading, the result was 26 tests total, 22 passed and 4 failed. The expected failures proved that pointer mismatches did not block saving and regular/bangteuk attendance still used direct browser V2 batches instead of the operational mutation entry point.

Store-level RED:

```powershell
node --test --test-isolation=none tests/attendance-v2-store.test.js
```

Result: 11 tests total, 9 passed and 2 failed. `runtime/attendance` was still authoritative and no strict `mutateMap` callable adapter existed.

Snapshot RED:

```powershell
node --test --test-isolation=none tests/schedule-v2-marks-operational.test.js
```

Result: 4 tests total, 2 passed and 2 failed. Snapshot headers had no incomplete/completed fence and explicit creation could replace an existing historical snapshot.

Reader RED:

```powershell
node --test --test-isolation=none tests/schedule-v2-operational-store.test.js
```

Result: 20 tests total, 19 passed and 1 failed. An interrupted `complete:false` snapshot remained visible before its retry completed.

## GREEN Evidence

The exact focused Task 5 command was rerun after implementation:

```powershell
node --check js/attendance-v2-store.js
node --check js/attendance-operational-gateway.js
node --check js/attendance-main-runtime.js
node --test --test-isolation=none tests/attendance-operational-gateway.test.js tests/attendance-v2-main-integration.test.js tests/teacher-attendance-v2-integration.test.js tests/attendance-v2-operational-scenarios.test.js tests/schedule-v2-marks-operational.test.js
```

Result: all syntax checks exited 0; 46 tests passed, 0 failed and 0 skipped.

Full unit regression:

```powershell
npm.cmd run test:unit
```

The managed sandbox initially blocked Node worker spawning with `EPERM`. The same command was rerun with the approved test-worker permission. Result: 548 tests total, 546 passed, 0 failed and 2 skipped. The skips are the existing Firestore rules and Schedule V2 shadow emulator availability checks.

Hygiene:

```powershell
git diff --check
```

Result: exit 0.

## Implementation Notes

- `runtime/operational` now supplies attendance mode, generation, epoch and revision. `runtime/attendance` is read only as compatibility metadata, and branch/mode/generation mismatch or absence blocks every confirmed V2 save with a redacted diagnostic.
- Browser attendance writes no longer use Firestore transactions or batches. The store reads the complete tab-owned attendance map, applies only visible changed keys, and submits the exact Task 2 callable request shape. Transient retries reuse the identical operation ID and payload.
- Individual attendance uses `attendance-update`; multi-record attendance uses `attendance-batch`; guests use `attendance-guest`. Server-owned fencing retains the existing maximum of 400 document changes per chunk and the existing operation manifest and V1 recovery flow.
- Regular and bangteuk storage keys remain distinct even when both placements refer to the same person. Full-map patching preserves dates outside the visible range and concurrent changes to other records.
- Mark updates remain legacy-shaped at the UI boundary but are converted server-side to document diffs. Tests cover absence, absence cancellation, regular makeup, sample and mandatory makeup while proving unrelated `classMarks` documents and tabs are retained.
- Explicit day snapshot creation uses `attendance-snapshot` with a deterministic branch/scope/date operation ID. Existing historical snapshots are immutable. New headers are stored with `complete:false`, students and teachers commit under the same fence, completion flips last, and the operational revision advances only afterward.
- Interrupted snapshots stay hidden. A retry with zero remaining document changes resumes from the stored manifest, completes the original header and finalizes the original operation.
- Existing teacher attendance and makeup permission gates remain unchanged. Parent, referral and voice paths were not modified.

## Self-Review

- Authority audit: attendance writes use only operational generation/epoch/revision; no confirmed V2 failure falls back to V1.
- Browser-write audit: direct `setRecord`, `deleteRecord`, guest replacement and record-batch methods fail closed with `direct-v2-write-disabled`; no browser Firestore attendance mutation remains.
- Concurrency audit: unseen dates are loaded before request construction, visible diffs patch that complete map, stale server revisions fail closed, and transient retries retain one request fingerprint.
- Snapshot audit: immutable existing documents reject replacement/deletion, incomplete headers are excluded from reads, completion is idempotent, and runtime revision updates after completion only.
- Cross-tab audit: mark conversion changes only affected deterministic IDs; regular and bangteuk enrollment IDs remain separate.
- Compatibility audit: existing attendance runtime return maps, Korean save failure copy and teacher permission checks remain intact.
- Scope audit: no deployment, push, production access, mode change or production data operation was performed.
- Commit audit: the repository release hook updated the standard `js/version.js` and `version.json` metadata while creating the requested commit.

## Residual Note

The full regression retains the two pre-existing emulator availability skips. No Task 5 focused test or syntax check is skipped.
