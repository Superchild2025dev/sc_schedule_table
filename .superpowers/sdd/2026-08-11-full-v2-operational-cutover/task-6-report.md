# Task 6 Report: Security Rules and Developer Cutover Controls

## Status

DONE

Task 6 was resumed from uncommitted inherited WIP at base `6ad6c95`. Correct WIP was preserved. The takeover repaired the stale full-suite rule test, added missing atomic transition and redaction coverage, and made the expected runtime fence mandatory for `set-v2-read`, `set-v2`, and `rollback`.

## Changed Files

- `config/schedule-permissions.json`
- `scripts/sync-permission-policy.js`
- `firestore.rules` (generated from the manifest)
- `js/schedule-v2-settings-policy.js`
- `js/settings.js`
- `settings.html`
- `functions/index.js`
- `tests/permission-policy-sync.test.js`
- `tests/firestore-rules-security.test.js`
- `tests/firestore-rules-emulator.test.js`
- `tests/schedule-v2-settings.test.js`
- `tests/attendance-v2-settings.test.js`
- `tests/v2-developer-gate.test.js`
- `.superpowers/sdd/2026-08-11-full-v2-operational-cutover/task-6-report.md`
- `js/version.js` (standard commit hook)
- `version.json` (standard commit hook)

The two additional regression tests were required because the unified callable removes the old attendance settings write path and the previous developer-gate assertion described the superseded Firestore rules.

## RED Evidence

### Recovered Task 6 base RED

The inherited Task 6 tests were copied into a temporary archive of base `6ad6c95`, then the brief's exact static command was run against base production code:

```powershell
node --test --test-isolation=none tests/permission-policy-sync.test.js tests/firestore-rules-security.test.js tests/schedule-v2-settings.test.js
```

Result: 20 tests total, 7 passed and 13 failed. The failures proved that the base had no manifest V2 policy, retained direct browser attendance writes, had no `set-v2-read` or `set-v2` callable actions or settings buttons, allowed unsafe rollback during preparation, and lacked the transition readiness/recovery/stale-pointer gates. The temporary archive was removed after capturing the result.

### Takeover baseline RED

The inherited targeted WIP was already green at takeover: 20 tests passed. The complete unit suite was then run with Node worker permission after the managed sandbox produced only `spawn EPERM` errors.

Result: 573 tests total, 570 passed, 1 failed and 2 skipped. The real failure was `tests/v2-developer-gate.test.js`, which still expected the removed developer browser write rule for `runtime/attendance`. The test was repaired to assert manifest-owned staff reads and server-only V2 writes.

### New hardening RED

A focused test was added before the server repair:

```powershell
node --test --test-isolation=none tests/schedule-v2-settings.test.js
```

Result: 19 tests total, 18 passed and 1 failed. `critical cutover actions require a complete expected runtime fence` failed because a developer could call `set-v2-read` without expected mode, generation, epoch and revision. The minimal server repair now rejects all three critical actions with `invalid-argument` before entering the transaction when that fence is absent or incomplete.

## GREEN Evidence

Permission generation:

```powershell
node scripts/sync-permission-policy.js
node scripts/sync-permission-policy.js --check
```

Both commands exited 0 and reported `permission artifacts are in sync`.

Exact Task 6 static command:

```powershell
node --test --test-isolation=none tests/permission-policy-sync.test.js tests/firestore-rules-security.test.js tests/schedule-v2-settings.test.js
```

Result: 23 passed, 0 failed and 0 skipped.

Supplementary settings, rule-regression and emulator-loader command:

```powershell
node --test --test-isolation=none tests/attendance-v2-settings.test.js tests/v2-developer-gate.test.js tests/firestore-rules-emulator.test.js
```

Result: 12 passed, 0 failed and 1 skipped. The skip is the environment-gated Firestore emulator test.

All modified JavaScript production and test files passed `node --check`.

Full unit regression:

```powershell
npm.cmd run test:unit
```

Result: 576 tests total, 574 passed, 0 failed and 2 skipped. The skips are the pre-existing Firestore rules and Schedule V2 shadow emulator availability checks.

Hygiene:

```powershell
git diff --check
```

Result: exit 0. Git printed only the repository's existing LF-to-CRLF checkout notices.

## Emulator Evidence

The brief's exact emulator command was attempted:

```powershell
npx.cmd firebase-tools emulators:exec --only firestore "node --test tests/firestore-rules-emulator.test.js"
```

It could not start because `firebase-tools` and the rules test dependencies are not installed or cached in this worktree; `npx` exited with `ENOTCACHED`. No global Firebase executable is available. The emulator test remains syntactically valid and environment-gated, and its expanded cases cover staff operational reads plus teacher, desk and developer direct-write denial.

## Implementation Notes

- `config/schedule-permissions.json` is the single authority for V2 runtime and generation read allowlists and the trusted-server-only browser write policy. The generator validates it, renders the Firestore block, removes the superseded unmanaged V2 block, and leaves generated artifacts idempotent.
- Authenticated teachers retain the existing cross-branch read policy; desks remain branch-scoped. Runtime recovery fences, operational mutation manifests and `requestRecoveries` are denied to every browser. Every V2 browser write, including developer writes, is denied.
- `manageScheduleV2Shadow` now supports developer-only `set-v2-read` and `set-v2`. `set-v2-read`, `set-v2` and `rollback` require the caller's complete expected mode/generation/epoch/revision and run all authority checks and pointer updates in one Firestore transaction.
- The transaction requires current schedule and attendance readiness, matching branch/generation/mode pointers, equal pointer epoch/revision, equal requested/applied schedule revisions, zero mismatch/pending/in-flight work, and no committing mutation, mirror recovery, request recovery, active operation or live recovery lease. Rollback from `v2` additionally requires the current revision to equal the last recovery-safe revision.
- Each successful critical transition increments `epoch` exactly once and updates `runtime/schedule`, `runtime/operational` and `runtime/attendance` together. The V2 revision is preserved.
- Status responses expose only aggregate schedule, mirror and request-recovery counts and readiness booleans. Tests prove operation IDs, queue payloads, names and phone values are not returned.
- Settings show mode, generation, epoch, V2 revision, V1 recovery pending/error counts and mismatch count per selected branch. Mutation controls are hidden from non-developers, browser policy rejects non-developers, and the callable independently enforces the dedicated developer email.
- Every settings mutation uses an explicit Korean confirmation containing the branch, target mode, target epoch and the statement that code deployment alone does not switch the operational mode. The old attendance config browser write was removed and attendance controls route through the same callable.

## Self-Review

- Manifest ownership: generator/check is clean; no independent V2 permission block remains outside the managed policy block.
- Read/write matrix: staff operational reads follow existing branch policy; unauthenticated reads and every direct V2 write fail closed; recovery internals remain server-only.
- Transition safety: all critical actions require a stale-client fence, all reads precede writes, and one transaction updates both operational pointers plus the schedule runtime. Successful `set-v2-read`, `set-v2` and `rollback` each have direct epoch and atomic-write coverage.
- Gate coverage: schedule and attendance readiness, stale generation/branch pointers, malformed or stale epoch/revision, requested/applied revision drift, mismatch, pending/in-flight sync, active leases and all unresolved recovery states are covered.
- Diagnostics: only bounded aggregate counts and safe booleans leave the callable; queue documents and personal fields are not exposed.
- Deployment behavior: loading function exports does not write or switch an operational mode, and no deployment, production access, production data operation or mode change was performed.
- Scope: `git diff --name-only 6ad6c95` contains no parent, notification, referral or customer-voice runtime file. The inactive parent V1 path and referral/voice behavior remain unchanged.
- Integration: no push or production release was performed. The worktree and branch are preserved for the next task.
- Commit audit: the repository release hook updated and staged only the standard `js/version.js` and `version.json` build identifiers.

## Residual Note

The only unexecuted verification is the live Firestore emulator suite because its pinned tool dependencies are unavailable locally. Static rule generation, rule source assertions, emulator test loading, all syntax checks and the complete unit suite are green.

## Review Fix Round (2026-08-11)

### Outcome

DONE_WITH_CONCERNS

All six binding review findings were implemented. The only concern is unchanged from the original Task 6 round: the live Firestore emulator suite could not start because `firebase-tools` is not installed or cached in this worktree.

### Fixes

- Preparation now keeps the active schedule, operational and attendance pointers unchanged while it builds a separately identified candidate generation. `prepare`, `set-shadow`, `set-verify`, `set-v2-read`, `set-v2` and `rollback` all require exact mode/generation/epoch/revision request data. Every pointer transition uses the same transaction, pointer consistency checks, readiness checks and schedule/recovery blocker gates.
- Preparation verifies all attendance generation collections and publishes `capabilities.attendance` with the same generation before shadow activation is allowed. The end-to-end `prepare -> shadow -> verify -> v2-read` regression proves dual readiness and atomic pointer writes.
- Operational mark planning compares semantic before/after projections. Absence operations may only add or remove the absence wrapper while preserving makeup data; makeup operations may only change makeup data while preserving the absence wrapper.
- Request recovery cleanup deletes only `completed` records. Expired `error`, `conflict`, `cancelled` and `rejected` records remain durable and continue contributing transition-blocking counts.
- `manageScheduleV2Shadow` accepts exact plain-object schemas with strict primitive types, rejects inherited/extra fields and prototype branch names, uses `Object.hasOwn` for branches, and authorizes active verified manifest accounts. Only manifest developers mutate; manifest developers and super administrators may read status for assigned branches.
- Settings status and action responses share one sequence gate, with an active action taking priority over an older status poll. Every confirmation follows a fresh status read and policy reevaluation. Preparation uses its own blocker count so a stale candidate can be repaired, while transitions remain blocked by the complete operational count. Server status returns redacted counts for committing mutations, active operations, live recovery/schedule leases, schedule state, revision drift, mirror recovery and every request recovery blocker.

### RED Evidence

```powershell
node --test --test-isolation=none tests/schedule-v2-settings.test.js
```

Result before production fixes: 27 tests total, 18 passed and 9 failed. Failures covered stale settings responses, crafted callable payloads, active pointer disturbance during preparation, missing attendance readiness, unfenced shadow/verify transitions, missing recovery gates and incomplete blocker counts.

```powershell
node --test --test-isolation=none --test-name-pattern="absence and makeup|cleanup deletes only" tests/function-schedule-v2-operational-writer.test.js
```

Result before production fixes: 2 tests total, 0 passed and 2 failed. The planner accepted cross-semantic mark changes and cleanup deleted all five expired records instead of only the resolved record.

### GREEN Evidence

```powershell
node scripts/sync-permission-policy.js --check
```

Result: exit 0, `permission artifacts are in sync`.

```powershell
node --test --test-isolation=none tests/permission-policy-sync.test.js tests/firestore-rules-security.test.js tests/schedule-v2-settings.test.js tests/function-schedule-v2-operational-writer.test.js tests/attendance-v2-settings.test.js tests/v2-developer-gate.test.js tests/firestore-rules-emulator.test.js
```

Result: 98 tests total, 97 passed, 0 failed and 1 environment-gated skip.

```powershell
node --test --test-isolation=none tests/function-schedule-v2-shadow-trigger.test.js
```

Result: 20 passed, 0 failed and 0 skipped. Candidate preparation, invalidation and active shadow/verify trigger behavior are covered.

```powershell
node --test --test-isolation=none tests/*.test.js
```

Result: 586 tests total, 584 passed, 0 failed and 2 environment-gated skips. This includes parent/referral/voice isolation, cross-branch staff reads, callable-only V2 writes and deployment-does-not-switch coverage. The default `npm.cmd run test:unit` was also attempted first; all 69 file workers failed before test execution with the managed Windows `spawn EPERM` limitation, so the established single-process command above was used.

```powershell
$files = @('functions/index.js','functions/schedule-v2-operational-policy.js','functions/schedule-v2-operational-writer.js','js/schedule-v2-settings-policy.js','js/settings.js','tests/function-schedule-v2-operational-writer.test.js','tests/function-schedule-v2-shadow-emulator.test.js','tests/function-schedule-v2-shadow-trigger.test.js','tests/schedule-v2-settings.test.js'); foreach ($file in $files) { node --check $file; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
git diff --check
```

Result: all 9 syntax checks exited 0; `git diff --check` exited 0 with only existing LF-to-CRLF checkout notices.

### Emulator Attempt

```powershell
npx.cmd firebase-tools emulators:exec --only firestore "node --test tests/firestore-rules-emulator.test.js tests/function-schedule-v2-shadow-emulator.test.js"
```

Result: not executed because `npx` exited 1 with `ENOTCACHED`; `firebase-tools` is unavailable in the local cache. Both emulator files load successfully in the unit suite and skip only when the emulator environment variable is absent.

### Constraint Audit

- Parent portal V1 files were not changed; the full suite's parent/referral/voice isolation checks pass.
- Manifest-generated Firestore rules still provide cross-branch teacher reads and branch-scoped desk reads while denying every browser V2 write.
- Operational V2 writes remain callable-only, including attendance and mark mutations.
- Loading function exports remains side-effect free and does not switch production mode.
- No deployment, push, production access, production data operation or production mode switch was performed.
