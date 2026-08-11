# Task 2 Implementation Report

## Status

DONE

## Changed Files

- `functions/schedule-v2-operational-policy.js`
- `functions/schedule-v2-operational-writer.js`
- `functions/index.js`
- `tests/function-schedule-v2-operational-writer.test.js`
- `tests/function-schedule-v2-operational-api.test.js`
- `.superpowers/sdd/2026-08-11-full-v2-operational-cutover/task-2-report.md`

## Commit Hashes

- `2ef045e` Add V2 operational mutation service

The report is committed separately so it can record the exact implementation commit hash.

## RED Evidence

Initial command from the brief:

```powershell
node --test --test-isolation=none tests/function-schedule-v2-operational-writer.test.js tests/function-schedule-v2-operational-api.test.js
```

Result: 3 tests total, 0 passed, 3 failed.

Expected failure reasons:

- `functions/schedule-v2-operational-policy.js` did not exist.
- `mutateScheduleV2Operational` was not exported.
- `recoverScheduleV2OperationalMirrors` and its writer construction did not exist.

Self-review RED 1:

```powershell
node --test --test-isolation=none tests/function-schedule-v2-operational-writer.test.js
```

Result: 12 tests total, 10 passed, 2 failed.

Failure reasons:

- Recovery consumed an error attempt while a newer incomplete V2 operation held the runtime fence.
- Operational status truncated recovery counts at the scheduler processing limit.

Self-review RED 2:

Result: 12 tests total, 11 passed, 1 failed.

Failure reason: the committed operation manifest recorded counts but did not retain redacted changed/deleted V2 document references.

Self-review RED 3:

Result: 13 tests total, 12 passed, 1 failed.

Failure reason: real Task 1 documents include storage metadata. The planner compared that metadata with pure conversion rows and planned 13 writes instead of the one requested teacher-profile write.

Self-review RED 4:

Result: 14 tests total, 13 passed, 1 failed.

Failure reason: resuming a partially completed fenced operation returned the remaining chunk count instead of the original manifest's complete operation count.

## GREEN Evidence

Exact focused commands:

```powershell
node --check functions/schedule-v2-operational-policy.js
node --check functions/schedule-v2-operational-writer.js
node --check functions/index.js
node --test --test-isolation=none tests/function-schedule-v2-operational-writer.test.js tests/function-schedule-v2-operational-api.test.js
git diff --check
```

Results:

- All three syntax checks passed with exit code 0.
- Focused tests: 16 total, 16 passed, 0 failed, 0 skipped.
- `git diff --check` passed with exit code 0.

Full unit regression:

```powershell
npm.cmd run test:unit
```

Results:

- The sandboxed attempt could not spawn Node test workers and returned `spawn EPERM`.
- The approved unrestricted rerun completed: 435 tests total, 433 passed, 0 failed, 2 skipped.
- The two skipped tests are the pre-existing Firestore rules and Schedule V2 shadow emulator availability checks.

Additional regression coverage included the Task 1 operational model, permission policy sync, existing shadow policy/runner/triggers, and unchanged function exports.

## Implementation Notes

- The callable accepts exactly the nine brief fields. Unknown fields, operation types, legacy keys, operation/key mismatches, duplicate keys, malformed IDs, oversized values, and unknown or explicitly unverified identities fail before writes.
- Authorization reads `config/schedule-permissions.json` directly. Developer and owner roles retain both branches, desks retain their configured branches, and teachers retain the current cross-branch policy only for allowlisted attendance, absence-confirmation, and makeup operations on manifest-writable keys.
- `runtime/operational` fences every mutation by branch, mode, generation, epoch, revision, and active operation ID. Target documents also check their operational revision and pre-read digest before writes.
- V2 document changes are split into fenced groups of at most 400. The runtime revision and `committedAt` are written only after every group completes. Retrying the same operation ID resumes safely and preserves original counts.
- The operation manifest is the idempotency record. It stores no payload body: only role hash, operation metadata, changed/deleted document references, counts, revision, chunk progress, and recovery state.
- Storage metadata is removed before Task 1 model comparison, preventing unrelated documents from being rewritten. Metadata remains available for transaction preconditions.
- In `v2-read`, V2 commits before any V1 work. A V1 failure leaves the callable result committed, records a redacted `error`, increments a bounded attempt count, and keeps the manifest recoverable.
- V1 recovery uses the same 650,000-character inline threshold, 600,000-character chunks, string/JSON type marker, four-digit chunk IDs, and stale-chunk deletion behavior as `FirestoreKVRoot`.
- The scheduler reads a bounded pending/error set per branch, caps attempts at 10, and skips recovery without consuming an attempt while any newer incomplete V2 operation owns the branch fence.
- Diagnostics contain branch, operation metadata, key/change counts, safe error code/class, and timestamp only. Names, phones, error messages, details, and request payload bodies are not retained.
- Loading or deploying the code does not write `runtime/operational` or change a production mode.
- Existing parent, referral, customer voice, shadow, availability, and other callable exports remain present and unchanged.

## Self-Review

- Reviewed the diff against every Task 2 requirement and the owned-file list.
- Verified the example `move-student` key combination and teacher-only operation boundaries.
- Verified duplicate operation IDs, stale epoch/generation/revision, stale document versions, 801 document changes, partial V1 failure, stale V1 chunks, retry recovery, redaction, cross-branch denial, complete status counts, incomplete-operation blocking, and resumed operation counts.
- Confirmed no config, rules, browser runtime, parent/referral/voice path, production data, deployment setting, or runtime mode was changed.
- The pre-commit hook generated `js/version.js` and `version.json`; both were restored and excluded from implementation commit `2ef045e`.

## Concerns

- Non-blocking: Task 2 tests use a stateful Firestore test double. The existing emulator availability tests were skipped in this environment, so emulator-backed validation remains part of the later integration/deployment gates.
- Non-blocking: a single mutation is capped at 2,000 V2 document changes in addition to the 400-change fenced chunk size, keeping the redacted manifest below Firestore document limits. Larger UI operations must be split into separate operation IDs.
- No deployment, push, production-data access, or production-mode transition was performed.

## Independent Review Fixes (2026-08-11)

### Fix Commit

- `819d68c` Fix operational recovery safety gaps

The report update is committed separately so this section can include the exact fix commit.

### Review RED Evidence

The six independent-review findings were first encoded as direct regression tests. No production implementation was changed before this run.

```powershell
node --test --test-isolation=none tests/function-schedule-v2-operational-writer.test.js tests/function-schedule-v2-operational-api.test.js
```

Result: 21 tests total, 13 passed, 8 failed.

Observed failures:

- Yongam teachers without `editMakeup` could perform makeup operations in both branches.
- A present email with a missing `email_verified` claim was accepted.
- Retrying after the final V2 chunk replaced the original manifest statistics with zero-change retry statistics.
- Oversized encoded document IDs, V2 documents, and operation manifests were not rejected before writes.
- A newer V1 mirror could be overwritten and the older operation marked `applied` by out-of-order recovery.
- Concurrent recovery had no persisted branch fence and did not revalidate the runtime before V1 writes.
- Expired `processing` operations were absent from scheduler candidates and status accounting.
- Operational status did not expose the `processing` recovery count.

### Review GREEN Evidence

Exact focused checks:

```powershell
node --check functions/schedule-v2-operational-policy.js
node --check functions/schedule-v2-operational-writer.js
node --check functions/index.js
node --test --test-isolation=none tests/function-schedule-v2-operational-writer.test.js tests/function-schedule-v2-operational-api.test.js
```

Result: all syntax checks passed; focused tests 22 total, 22 passed, 0 failed, 0 skipped.

Full unit regression:

```powershell
npm.cmd run test:unit
```

Result: the sandboxed attempt returned `spawn EPERM` before tests could start. The approved unrestricted rerun completed with 441 tests total, 439 passed, 0 failed, and 2 pre-existing emulator availability skips.

Diff and staged-scope checks:

```powershell
git diff --check
git diff --cached --check
node scripts/check-release-diff.js --cached
```

Result: all passed with exit code 0. The release guard's sandboxed attempt also hit `spawnSync git EPERM`; its approved unrestricted rerun passed.

### Fix Details

1. Persisted branch recovery fence and stale-revision defense

- Added `scheduleV2/{branchId}/runtime/operationalRecovery` as the branch-scoped Firestore lease and applied-revision fence.
- Recovery claim atomically checks runtime, operation manifest, and branch fence. A newer runtime or applied mirror marks an older operation `superseded`, never `applied`.
- Every V1 key write is now a transaction that immediately revalidates runtime generation/revision, branch lease ownership/expiry, and operation lease ownership before applying the existing inline/chunked encoding and stale-chunk deletes.
- Finalization revalidates runtime revision and fence ownership again before recording `applied`.
- An active recovery fence blocks a new V2 mutation before its first document write, preventing partial multi-key V1 recovery from being interleaved with a newer V2 commit.
- Added out-of-order, concurrent stale recovery, and active-fence/V2 regression tests. The fence is stored in Firestore and does not depend on process memory.

2. Expiring and reclaimable recovery leases

- Scheduler candidates now include expired `processing` operations while excluding active leases.
- Reclaiming an expired processing lease consumes one bounded attempt. A crashed operation at the tenth attempt is moved to terminal `error` and its lease is cleared.
- Operational status now reports `recoveryProcessingCount` in addition to complete pending/error counts.
- Added crashed-worker, active-lease, expired-lease, retry-cap, and processing-status tests.

3. Exact teacher makeup capability

- All existing makeup operation aliases require the account's exact `editMakeup` capability.
- Attendance and absence confirmation retain the existing teacher cross-branch policy and writable-key limits.
- Added tests for every makeup alias for a Gagyeong teacher with the capability and a Yongam teacher without it in both branches.

4. Verified identity requirement

- Authorization now requires `email_verified === true`; missing and false claims fail closed.
- Added explicit missing/false/true claim tests.

5. Immutable manifest summary on finalization retry

- Resumed committing operations retain the original counts, changed/deleted references, chunk count, completed chunk offset, request fingerprint, and other manifest summary fields.
- A retry after every V2 chunk is already written skips chunk reservation and finalizes against the original chunk count.
- Added an injected failure after the last chunk but before finalization, followed by a zero-change retry that proves the original result and references survive.

6. Firestore size prevalidation

- Before the first V2 write, encoded document IDs are limited to 1,500 UTF-8 bytes.
- Stored V2 documents and the completed operation manifest are conservatively estimated and limited to 900,000 serialized bytes, leaving margin below Firestore's document limit.
- Existing committing manifests are rechecked including final result fields before a retry writes or finalizes them.
- Added oversized encoded-ID, document-value, and 2,000-reference manifest tests; each asserts rejection before any transaction or V2 document write.

### Review Self-Assessment

- Confirmed the public nine-field request contract and callable/module exports are unchanged.
- Confirmed V2 remains the primary committed result and V1 remains a recoverable mirror; V1 failure does not roll back or erase the V2 commit.
- Confirmed generation, epoch, runtime revision, target document revision/digest, 400-change chunk fencing, and operation-ID idempotency remain enforced.
- Confirmed recovery processes at most the configured per-branch limit and never reconstructs from a `committing` manifest.
- Confirmed manifests, branch fences, diagnostics, and tests do not persist names, phone numbers, request bodies, or recovered payload values.
- Confirmed `functions/index.js`, parent/referral/customer-voice paths, deployment settings, production mode, and unrelated files were not changed by review fixes.

### Review Concerns

- Non-blocking: when more eligible items exist than the per-branch limit, older committed operations may be marked `superseded` over several scheduler ticks before the current runtime revision is mirrored. The persisted revision fence keeps this delayed convergence monotonic and prevents stale writes.
- Non-blocking: Firestore emulator availability remains one of the two environment-dependent skipped tests; the stateful Firestore test double directly covers transaction ownership, expiry, ordering, chunk deletion, and injected crash/failure paths.
- No deployment, push, production-data access, or production-mode transition was performed during the fixes.
