# Full V2 Operational Cutover Final Review Fix Report

Date: 2026-08-12 (Asia/Seoul)
Branch: `codex/full-v2-operational-cutover`
Reviewed base: `51393b2`
Scope: coordinated TDD fix wave for all five findings in `final-review-findings.md`

## Result

All five final-review findings are implemented and verified. The patch remains entirely local: no deployment, push, production access, production-mode change, or production data operation was performed.

The browser and function copies of the shared schema and operational model remain synchronized. Parent/non-operational V1 data, including `swim_requests`, remains outside the tracked timetable fence. Existing cross-branch teacher/staff V2 read access remains intact, while browser V2 writes remain server-only.

## Finding 1: Unknown authority fails closed

- Schedule and attendance gateways now begin in explicit `unknown` authority instead of treating missing or malformed runtime state as V1.
- Runtime state is accepted only when branch, mode, epoch, revision, validity, and required generation fields are complete and canonical.
- Failed startup authority still permits legacy reads but rejects every schedule or attendance write with `operational-authority-unavailable`.
- Loss of a previously valid subscription revokes authority, clears pending state, stops active controllers, and requests one controlled reload.
- Authenticated staff bootstrap failures now return a read-only compatibility facade instead of a writable legacy root.
- The read-only facade also fails closed when JavaScript `Proxy` is unavailable.
- Main and teacher attendance helpers no longer bypass a missing operational runtime with a direct V1 write.

## Finding 2: Activation freeze, V1 fencing, drain, and parity

- Added a server-owned `activationFreeze` runtime document with a unique token and exact source mode/generation/epoch/revision fence.
- Generated Firestore rules deny tracked V1 parent and chunk writes when authority is unknown, authority is V2, or an activation freeze is active.
- The permission manifest is now the source of truth for exact and pattern-based tracked legacy keys.
- `set-v2-read` acquires the freeze, performs a full pre-cutover V1-to-V2 drain, computes canonical V1/V2 SHA-256 digests, records bounded proof evidence, and changes both runtime pointers atomically.
- `set-v2` requires fresh canonical parity and an unchanged runtime revision before promotion.
- Rollback requires fresh canonical parity; rollback from shadow/verify also performs a frozen full drain.
- Proof evidence is bound to purpose, branch, generation, source mode, epoch, revision, proof ID, and exact freeze token.
- Invalid V2 collection graphs now fail closed before digest comparison, including the empty-V1 edge case.
- Chunked V1 values are reconstructed using the persisted `valueType` metadata, with backward compatibility for the older string marker.
- Failure paths release a normally held freeze and safely requeue in-flight keys; if cleanup itself fails, the remaining active freeze blocks writes.

## Finding 3: Attendance ownership and round trips

- Regular attendance ownership is canonicalized by `courseType` to the shared `regular` owner, independent of current display tab ID.
- Bangteuk attendance remains owned by its exact tab ID.
- Record, guest, snapshot, snapshot-student, and snapshot-teacher IDs now use canonical attendance ownership.
- Reads query all regular owners by `courseType` while retaining exact Bangteuk tab scoping.
- Reverse conversion rebuilds canonical shared V1 attendance, guest, bundled snapshot, and per-day snapshot keys.
- Archived/named regular tabs and historical snapshots validate and round-trip without being relabeled or deleted.
- Server shadow policy now tracks all attendance key families and collections.
- Incremental reconciliation deletes only the changed canonical owner/date scope.
- A bundled snapshot claim expands to all tracked bundled/per-day snapshot keys before reconciliation, excluding the full-generation sentinel and audit data.

## Finding 4: Durable terminal recovery

- Added exact versioned terminal recovery commands for `mirror` and `request` kinds with `retry` and `resolve` actions.
- Authorization is developer-only and manifest-backed.
- Mirror retry/resolve re-reads runtime, manifest, current generation revision, and V1 values before either marking an already-correct mirror applied or requeueing/retrying it.
- Request retry/resolve re-reads the terminal record, committed manifest, and current `swim_requests` value before completion, requeue, or explicit rejected-record dismissal.
- Resolutions are persisted under server-only `recoveryResolutions` documents with bounded, non-payload metadata.
- The callable `resolveScheduleV2TerminalRecovery` exposes the resolver without exposing recovery documents to browsers.
- A successful terminal resolution removes the blocker used by cutover/rollback gates.

## Finding 5: Ambiguous lost callable responses

- Operational mutations retain one operation ID across bounded retries.
- After the final ambiguous callable error, the client clears pending mutation state and strictly re-reads operational authority.
- A changed revision, mode, generation, epoch, or branch requests one controlled reload and invalidates stale local state.
- A failed authority re-read revokes write authority rather than assuming V1.
- Regression coverage simulates a committed server mutation whose every callable response is lost.

## Self-review additions

Whole-patch review found and fixed three additional fail-closed edges:

1. Chunked strings were initially checked only with an obsolete metadata field; parity now honors persisted `valueType: "string"`.
2. Partial snapshot reconciliation initially admitted `swim_tab_list` from the baseline helper; it now expands only real attendance snapshot keys.
3. Invalid V2 reconstruction could collapse to an empty view and match an empty V1 root; it now raises `failed-precondition` before hashing.

The browser no-`Proxy` bootstrap path was also hardened so it cannot return a raw writable legacy object.

## Verification evidence

- Focused changed-area suite: 292 tests, 292 passed, 0 failed, 0 skipped.
- Full unit suite: 638 tests, 636 passed, 0 failed, 2 skipped.
- Firestore rules emulator: 12 tests, 12 passed, 0 failed, 0 skipped.
- Schedule V2 shadow Firestore emulator: 3 tests, 3 passed, 0 failed, 0 skipped.
- Changed runtime syntax: 17 files checked, all passed.
- Shared-copy check: 3 file pairs matched byte-for-byte.
- `verify:v2-functions`: passed.
- `verify:policy`: passed; generated manifest/rules artifacts are synchronized.
- Version agreement between `version.json` and `js/version.js`: passed before commit; the commit hook regenerates and stages both together.
- `git diff --check`: passed; only expected CRLF conversion notices were printed.

The package's default parallel Node launcher could not spawn test workers inside the Windows sandbox (`spawn EPERM`) before any test body ran. The same complete `tests/*.test.js` set was therefore run with `--test-isolation=none`, producing the full 638-test result above.

## Skipped gates

No required gate was skipped.

The full in-process suite reports two conditional skips because `FIRESTORE_EMULATOR_HOST` is intentionally absent in that command. Both skipped probes were then executed explicitly against a local Firestore emulator and passed: rules 12/12 and function shadow integration 3/3.

## Preserved boundaries

- `swim_requests` and other untracked V1 parking data remain writable under their existing role policy during V2 schedule modes.
- Parent referral and customer-voice runtimes remain outside the operational schedule bootstrap.
- Teachers retain manifest-owned cross-branch V2 read access; desk access remains branch-scoped.
- Browser writes to V2 runtime, generation, mutation, recovery, proof, freeze, and resolution paths remain denied.
- No production mode was changed and no production endpoint or data was accessed.

## Residual concerns

- An abrupt process termination after freeze acquisition can intentionally leave `activationFreeze.active=true`. This is fail-closed and blocks tracked V1 writes until a privileged operational recovery clears or supersedes the stale freeze.
- Exact canonical parity may expose legacy data that relies on implicit/default normalization, such as an omitted period definition. Activation will block until that source data is normalized; it will not silently accept a lossy conversion.
- Production deployment and production-state validation were explicitly prohibited and remain future controlled release steps.

## Changed implementation areas

- Permission manifest, generated Firestore rules, and policy generator.
- Schedule/attendance browser gateways, Firebase compatibility root, main attendance, and teacher attendance paths.
- Shared schema, operational model/store/policy/writer, shadow policy/runner/trigger, and cutover parity helper.
- Focused unit, integration, static policy, rules emulator, and function emulator coverage for every finding.
