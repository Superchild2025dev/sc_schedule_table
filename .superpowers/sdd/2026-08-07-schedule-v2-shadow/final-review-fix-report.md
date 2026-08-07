# Schedule V2 Shadow Final-Review Fix Report

Date: 2026-08-07

## Scope And Safety

- Worktree: `C:\schedule_gagyeong\.worktrees\schedule-v2-shadow`
- Starting base: `a436290`
- V1 remains the only operational timetable authority.
- No schedule V2 read path was enabled for operational staff screens.
- The dedicated attendance gateway and attendance-specific Firestore paths remain separate.
- No production mode, production data, production rules, deployment, or release action was changed or run.
- Failed, partial, stale, pending, and rolled-back schedule generations are not activatable.

## Finding Mapping

### Critical 1 - Browser timetable writer and client write bypass

Implementation:

- Deleted `js/schedule-v2-shadow.js`.
- Removed the writer script from `index.html`, `desk.html`, `teacher.html`, and `settings.html`.
- Removed every timetable V2 mutation hook from `js/firebase-store.js`.
- Reduced `js/schedule-v2-store.js` to read-only generation selection and preview helpers.
- Removed the direct browser generation builder from `js/settings.js`; schedule controls use `manageScheduleV2Shadow` only.
- Changed generic `scheduleV2` writes in `firestore.rules` to server-only while retaining the existing attendance runtime and attendance record/guest rules.

Tests:

- `tests/schedule-v2-shadow.test.js`
- `tests/schedule-v2-diagnostic.test.js`
- `tests/schedule-v2-store.test.js`
- `tests/v2-developer-gate.test.js`
- `tests/firestore-rules-security.test.js`
- `tests/firestore-rules-emulator.test.js`
- `tests/attendance-v2-settings.test.js`

### Critical 2 - Ready/activation and rollback change loss

Implementation:

- `functions/index.js` now queues every tracked source event received in `ready` mode and atomically changes the schedule capability to `syncing`.
- A post-ready change sets `requiresPrepare`; it does not silently auto-activate another generation.
- `set-shadow` requires mode `ready`, a schedule-ready capability, no pending/in-flight/error state, and equal requested/applied capability and runtime revisions.
- Rollback sets mode `v1` and `requiresPrepare`, preserves all V2 documents, and prevents reactivation until a new `prepare` creates a new generation.
- `js/schedule-v2-settings-policy.js` mirrors the server-side fresh-ready gate.

Tests:

- `tests/function-schedule-v2-shadow-trigger.test.js`
- `tests/schedule-v2-settings.test.js`
- `tests/function-schedule-v2-shadow-emulator.test.js` for both branches

Coverage includes a ready-mode write followed by rejected activation, and rollback followed by a source write and rejected reactivation.

### Critical 3 - Handler retry and stranded work recovery

Implementation:

- Enabled retry on both Firestore handlers in `functions/index.js`.
- Added hashed CloudEvent-ID deduplication so a retried source event increments the queue revision once.
- Preserved deterministic document IDs, fenced transactions, and merged alert IDs.
- Extended `recoverExpired` in `functions/schedule-v2-shadow-policy.js` to wake pending work with no lease as well as expired in-flight work.
- Pending-only wakeups do not consume the worker retry budget.
- Added scheduler retry/resource settings and generation capability updates during recovery.

Tests:

- `tests/function-schedule-v2-shadow-trigger.test.js`
- `tests/function-schedule-v2-shadow-policy.test.js`
- `tests/function-schedule-v2-shadow-runner.test.js`
- `tests/function-schedule-v2-shadow-emulator.test.js`

Coverage includes a transient failure before the queue transaction, retried event deduplication, stranded pending recovery, stale worker fencing, deterministic data reconciliation, and one merged alert document across retries.

### Critical 4 - Dependency graph and identity context

Implementation:

- Expanded `collectionsForKey` in `functions/schedule-v2-shadow-policy.js` for student, instructor, main-tab, and period dependencies.
- Expanded `requiredLegacyKeys` in `functions/schedule-v2-shadow-runner.js` to load mark, disabled-slot, waitlist, reservation, period, retirement-history, and desk-history sources when their converters depend on them.
- Student changes load every relevant regular/vacation student tab for shared-person validation.
- Enrollment and placement reconciliation remains limited to the changed course tab.
- Missing legacy documents are omitted rather than inserted as invalid `null` source structures.
- All reads remain server-side and use the existing chunk-aware V1 reader.

Tests:

- `tests/function-schedule-v2-shadow-policy.test.js`
- `tests/function-schedule-v2-shadow-runner.test.js`

Coverage includes cross-key deletion, period-boundary reassignment and deletion, cross-tab identity, course-scoped placement preservation, and same-phone/different-name separation.

### Critical 5 - Domain-specific readiness and partial schedule writes

Implementation:

- Added `capabilities.schedule` with status, requested revision, applied revision, and verification time in `functions/index.js`.
- Schedule prepare creates only a schedule capability; it does not create or imply attendance readiness.
- Generation and runtime schedule state change atomically to `syncing`, `error`, or `ready` around incremental work.
- Callable status derives readiness from domain capability plus runtime revisions and pending/error state.
- `js/schedule-v2-store.js` selects schedule and attendance generations independently.
- Attendance selection accepts an explicit attendance capability, plus only the narrowly verified legacy full-generation format for compatibility.
- `js/settings.js` uses the attendance selector for attendance controls and the schedule selector for read-only schedule preview.

Tests:

- `tests/schedule-v2-store.test.js`
- `tests/schedule-v2-settings.test.js`
- `tests/function-schedule-v2-shadow-trigger.test.js`
- `tests/attendance-v2-settings.test.js`
- Existing attendance unit and operational scenario suites

### Important 1 - Reference integrity

Implementation:

- Added post-write reference verification in `functions/schedule-v2-shadow-runner.js`.
- Verifies enrollment-to-person, enrollment-to-tab, placement-to-person, placement-to-enrollment, placement/enrollment tab agreement, and teacher-assignment tab/name integrity before the final fence check.

Tests:

- `tests/function-schedule-v2-shadow-runner.test.js`

Tampering cases independently break person, enrollment, placement-tab, and assignment-tab references and all fail with `verification-mismatch`.

### Important 2 - Privacy-safe diagnostics and mismatch classes

Implementation:

- `functions/schedule-v2-shadow-policy.js` converts source keys to fixed safe key families before persistence or logging.
- Dynamic tab-derived key text is never retained in diagnostics.
- Added safe `conversion-mismatch`, `verification-mismatch`, and `stale-run` codes and message classes.
- Runner boundaries continue to discard dependency error messages/details and expose only approved codes.

Tests:

- `tests/function-schedule-v2-shadow-policy.test.js`
- `tests/function-schedule-v2-shadow-runner.test.js`
- `tests/function-schedule-v2-shadow-trigger.test.js`
- `tests/function-schedule-v2-shadow-emulator.test.js`

### Important 3 - Lease renewal and function limits

Implementation:

- Added lease renewal with ownership, status, in-flight-work, and expiry checks in `functions/schedule-v2-shadow-policy.js`.
- The processor supplies a throttled transactional heartbeat to `functions/schedule-v2-shadow-runner.js` before expensive reads, chunks, writes, and verification.
- Renewal fails closed at or after the exact expiry boundary.
- Added explicit timeout and memory limits to the callable, source handler, processor, and recovery scheduler.

Tests:

- `tests/function-schedule-v2-shadow-policy.test.js`
- `tests/function-schedule-v2-shadow-runner.test.js`
- `tests/function-schedule-v2-shadow-trigger.test.js`

The production-scale deterministic case converts 701 schedule rows across multiple 350-operation chunks while logical time advances past the original lease and proves ownership remains valid.

## TDD Red Evidence

Focused failures were recorded before implementation:

1. Browser authority/rules slice:
   - Command: `node --test tests/schedule-v2-diagnostic.test.js tests/schedule-v2-shadow.test.js tests/schedule-v2-store.test.js tests/attendance-v2-settings.test.js tests/v2-developer-gate.test.js tests/firestore-rules-security.test.js`
   - Result: 26 tests, 11 pass, 15 fail.
   - Failures identified the loaded browser writer, V1 mutation hooks, missing domain selectors, direct settings writer, and permissive generic V2 rule.
2. Policy dependency/recovery/privacy/lease slice:
   - Command: `node --test tests/function-schedule-v2-shadow-policy.test.js`
   - Result: 10 tests, 5 pass, 5 fail.
3. Runner dependency/identity/reference slice:
   - Command: `node --test tests/function-schedule-v2-shadow-runner.test.js`
   - Result: 29 tests, 9 pass, 20 fail.
4. Lifecycle/retry/readiness/browser slice:
   - Command: `node --test tests/function-schedule-v2-shadow-trigger.test.js tests/schedule-v2-settings.test.js tests/schedule-v2-store.test.js`
   - Result: 36 tests, 22 pass, 14 fail.
5. Exact lease-expiry boundary:
   - Command: `node --test tests/function-schedule-v2-shadow-policy.test.js`
   - Result: 10 tests, 9 pass, 1 fail.

The failures were assertion failures for the missing required behavior, not environment skips.

## Green Evidence

- Browser authority/rules focused slice: 26/26 passed after writer/rule removal.
- Policy and runner focused slice: 40/40 passed after dependency, reference, privacy, recovery, and lease changes.
- Trigger lifecycle focused slice: 19/19 passed after revision fencing, retry, recovery, capability, and heartbeat changes.
- The complete unit suite and both emulator suites passed as recorded below.

## Final Verification

1. `npm.cmd run verify:v2-functions`
   - Exit code 0.
   - Browser/function shared V2 files are synchronized.
2. `npm.cmd run test:unit`
   - 396 tests, 394 pass, 0 fail, 2 skip.
   - Duration: 1559.7976 ms.
   - The two skips are emulator-host guards only; both guarded suites were run separately below with no skips or assertion failures.
3. `npm.cmd run test:rules`
   - 10 tests, 10 pass, 0 fail, 0 skip.
   - Duration: 5703.1288 ms.
   - Firestore emulator script exited with code 0.
4. Focused real Firestore integration, from `tools/firebase-test`:
   - Command: `.\node_modules\.bin\firebase.cmd emulators:exec --config ..\..\firebase.json --only firestore --project scswimming-schedule "node --test ..\..\tests\function-schedule-v2-shadow-emulator.test.js"`
   - 3 tests, 3 pass, 0 fail, 0 skip.
   - Duration: 22011.2311 ms.
   - Emulator script exited with code 0.
5. `node --check functions/index.js`
   - Exit code 0; no syntax error.
6. `git diff --check`
   - Exit code 0; no whitespace errors.
   - Git emitted only the repository's existing LF-to-CRLF advisory warnings.

## Self-Review

- Authority: no staff page loads a timetable V2 writer, no V1 browser mutation calls one, and generic V2 client writes are denied.
- Fencing: every mutating server run owns the `scheduleSync` lease; generation readiness changes in the same transactions as queue/claim/finish/failure/recovery state.
- Lost-write prevention: source events delivered before, during, or after preparation either enter catch-up or invalidate the ready revision.
- Rollback: mode changes immediately to V1, leases are revoked, in-flight keys are preserved as pending metadata, and generation documents are not deleted.
- Failure usability: preparing, syncing, error, preserved, revision-mismatched, and pending generations cannot pass activation.
- Idempotency: deterministic IDs, digest verification, event-ID dedupe, fenced chunks, and deterministic alert IDs prevent duplicated operational documents or alert documents.
- Attendance: attendance runtime, gateway, rules, and unit scenarios remain separate and green; schedule prepare never grants attendance readiness.
- Privacy: persisted/logged diagnostics contain only branch, fixed key families, collection names, safe codes/classes, and timestamps.
- Scale: chunked V1 reads, 350-operation write chunks, a 701-row deterministic test, lease heartbeat, and explicit function resources are covered.
- Repository scope: no index, dependency, production configuration, deployment script, or unrelated application behavior was changed.

## Residual Concern

No blocking concern remains. A legacy generation that has neither an explicit attendance capability nor the complete previously verified attendance format is deliberately not selectable by attendance controls; an already configured attendance runtime is not changed by this fix wave.

## Production Actions

None. No deploy, rule release, production callable invocation, mode transition, or production data mutation was performed.
