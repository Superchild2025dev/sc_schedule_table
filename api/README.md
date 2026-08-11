# Full V2 Controlled Activation Runbook

## Scope and authority

This runbook is for the controlled `v2-read` activation of the staff schedule,
attendance, desk, and operational-record paths. The two independent branch
identities are:

| Branch ID | Display label |
| --- | --- |
| `gagyeong` | 가경점 |
| `yongam` | 용암점 |

**This document does not authorize or perform a production change.** Production
deployment, production access, mode changes, `set-v2-read`, `set-v2`,
`rollback`, branch switching, and pushing are pending controlled operator
actions. Code deployment alone must never switch an operating mode. The final
move from `v2-read` to `v2` needs separate, later, explicit user approval after
the agreed stability period.

All status reads and mode controls below use the deployed developer-only
Settings page's `manageScheduleV2Shadow` callable. It sends the current
`mode`, `generationId`, `epoch`, and `revision` as its server-enforced
expectation fence. Do not write Firestore runtime or recovery documents
directly.

## Local Pre-deployment Gate

Run these commands in the release worktree before requesting controlled
operator action. They are local checks only; none deploys, accesses production,
or changes runtime mode.

```powershell
$files = @(
  'js/schedule-live-handlers.js',
  'js/data.js',
  'js/tabs.js',
  'js/popup-stu.js',
  'js/table.js',
  'js/version.js',
  'js/schedule-v2-operational-model.js',
  'js/schedule-v2-operational-store.js',
  'js/schedule-operational-gateway.js',
  'functions/schedule-v2-operational-model.js',
  'functions/schedule-v2-operational-policy.js',
  'functions/schedule-v2-operational-writer.js',
  'functions/shared/schedule-schema-v2.js',
  'functions/index.js'
)
foreach ($file in $files) {
  node --check $file
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
node scripts/sync-permission-policy.js --check
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node scripts/sync-v2-function-shared.js --check
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node -e "JSON.parse(require('fs').readFileSync('version.json','utf8'))"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$tests = Get-ChildItem tests -Filter *.test.js | ForEach-Object { $_.FullName }
node --test --test-isolation=none $tests
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
git diff --check
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
git status --short
```

The Task 6 Firestore emulator gate is mandatory before deployment and must be
attempted exactly as follows:

```powershell
npx.cmd firebase-tools emulators:exec --only firestore "node --test tests/firestore-rules-emulator.test.js tests/function-schedule-v2-shadow-emulator.test.js"
```

Do not replace an unavailable emulator with a skip. If this command cannot
start because its pinned tooling or dependencies are unavailable, record the
exact failure and treat it as a **hard pre-deployment blocker** until a
controlled environment runs it successfully.

## Required Deployment Order

Use this exact order. Every production item in this section is **pending
controlled operator action; not executed by this task**.

```text
1. static code deployment while both branches remain verify
2. Firestore indexes deployment and wait until enabled
3. Firestore rules deployment
4. Cloud Functions deployment
5. status/readiness check for gagyeong and yongam
6. local authenticated staff smoke test in verify
7. explicit developer set-v2-read for both branches
8. post-cutover status and recovery queue verification
```

Before every numbered action and before every Settings control click, refresh
and record a new status snapshot for both branches. Reject a stale page,
stale generation, stale epoch, stale revision, failed callable response, or an
unexpected pointer change; refresh again and start the affected action over.

### 1. Static code deployment while both branches remain `verify`

**Pending controlled operator action.** Before the release, use the deployed
developer Settings page for `gagyeong` and `yongam`, press `상태 새로고침`, and
record `mode=verify` for both branches. The operator deploys the already
approved static release by the established host procedure:

```bash
# Pending: use the approved release reference; this task does not push or switch branches.
cd /var/www/schedule
sudo git pull origin main
```

Reload the staff timetable and Settings pages. Confirm that the new static
assets load, both branches still show `verify`, and no mode button has been
used. A code deployment has no authority to change a runtime mode.

### 2. Firestore indexes deployment and READY verification

**Pending controlled operator action.** Deploy only the committed indexes:

```powershell
npx.cmd firebase-tools@latest deploy --only firestore:indexes --project scswimming-schedule --non-interactive
```

Wait for every index required by the committed `firestore.indexes.json` to be
`READY`; `CREATING`, `NEEDS_REPAIR`, or an absent index fails this gate. The
operator records the live state with:

```powershell
gcloud firestore indexes composite list --project=scswimming-schedule --database="(default)" --format=json
```

Compare the returned collection group, query scope, and fields with
`firestore.indexes.json`. Do not proceed while a required index is not `READY`.

### 3. Firestore rules deployment

**Pending controlled operator action.** Re-run the established release guard
from a clean, committed release checkout, then deploy rules only:

```powershell
npm.cmd run release:rules -- --production
```

This command deploys `firestore.rules` only. It must not be used to deploy
functions, mutate data, or switch a branch mode. Re-open each staff page after
deployment and confirm normal authenticated reads still work for its assigned
branch.

### 4. Cloud Functions deployment

**Pending controlled operator action.** Deploy functions only after indexes
are `READY` and the rules gate passes:

```powershell
npx.cmd firebase-tools@latest deploy --only functions --project scswimming-schedule --non-interactive
```

Confirm the deployment reports healthy functions, including
`manageScheduleV2Shadow`, `recoverScheduleV2OperationalMirrors`, and
`recoverScheduleV2RequestPatches`. Do not call a mode mutation as a deployment
health check.

### 5. Fresh verify-mode readiness gate for both branches

**Pending controlled operator action.** With a developer account, open
`settings.html?branch=gagyeong`, select the V2 panel, and press `상태 새로고침`.
Repeat at `settings.html?branch=yongam`. For each snapshot, record the branch
ID, Korean label, timestamp, mode, generation ID, epoch, revision, and the
following all-zero/all-true gate:

| Required status | Required value |
| --- | --- |
| `mode` | `verify` |
| `generationStatus` | `ready` |
| `scheduleReady`, `attendanceReady`, `pointerConsistent`, `generationCurrent`, `recoverySafe` | all `true` |
| `pendingCount`, `inFlightCount`, `transitionBlockerCount`, `unresolvedMismatchCount` | all `0` |
| `recoveryPendingCount`, `recoveryErrorCount`, `mirrorRecoveryPendingCount`, `mirrorRecoveryErrorCount`, `requestRecoveryPendingCount`, `requestRecoveryErrorCount` | all `0` |
| `requestedRevision`, `appliedRevision` | equal |
| active schedule, operational, and attendance pointers | same branch ID, generation ID, epoch, and revision |

Any nonzero blocker, mismatch, unresolved recovery state, pointer difference,
or not-ready capability is a stop condition. Do not start a smoke test or
activate either branch until both fresh snapshots pass.

### 6. Authenticated staff smoke test in `verify`

**Pending controlled operator action.** Keep both branches in `verify` for
this step. Use a designated reversible test date, test slot, and desk note
marker. Capture the pre-test timetable, attendance state, and desk record so
that the normal UI can restore them exactly.

For **each** branch (`gagyeong`/가경점, then `yongam`/용암점):

1. Refresh status; re-check the full zero-blocker gate above and confirm
   `mode=verify`.
2. Sign in as the designated staff account and load the main timetable.
3. Switch regular and Bangteuk tabs; confirm both render the expected class
   context without a save or connection error.
4. Create one reversible attendance test record through the normal UI, verify
   it persists after reload, then remove it through the normal UI and verify
   the original attendance state returns.
5. Create one reversible desk record through the normal UI, verify it persists
   after reload, then remove it through the normal UI and verify the original
   desk state returns.
6. Open the read-only history/record view and confirm it loads without exposing
   recovery queue payloads. Refresh developer status and confirm the zero
   blocker/mismatch gate still passes.

Stop immediately on any failed save, stale pointer, mismatch, recovery count,
or inability to reverse the test record. Do not activate the other branch.

### 7. Explicit developer `set-v2-read` for both branches

**Pending controlled operator action.** This is the first and only mode change
in this runbook. It is not `set-v2`.

For `gagyeong`/가경점 and then `yongam`/용암점:

1. In the deployed developer Settings page, select the branch and press
   `상태 새로고침` immediately before acting. Record the new full gate snapshot.
2. Confirm every row in the zero-blocker gate still passes and `mode=verify`.
   The schedule, operational, and attendance pointer values must agree.
3. Press `V2 읽기 전환`, confirm the dialog identifies the correct branch and
   target mode, and approve it once. This invokes `set-v2-read` with the fresh
   expected mode/generation/epoch/revision fence.
4. Refresh status immediately. Require `mode=v2-read`; record the returned
   generation ID, epoch, and revision. Do not press `V2 단독 전환`, do not call
   `set-v2`, and do not use direct database writes.

The server must reject the action when the fresh readiness counters are not
zero or the expectation fence is stale. Treat an unexpected acceptance or
failure as an incident and use the stop/recovery path below.

### 8. Post-cutover verification and V1 mirror-removal check

**Pending controlled operator action.** For both branches, refresh developer
status after the activation and after each test mutation. Require:

- `mode=v2-read` for both branches;
- identical active generation pointer values across schedule, operational, and
  attendance within each branch (the two branches may use different generation
  IDs);
- `transitionBlockerCount=0`, `unresolvedMismatchCount=0`,
  `recoveryPendingCount=0`, and `recoveryErrorCount=0`;
- equal `requestedRevision` and `appliedRevision`.

Repeat the reversible attendance and desk tests on each branch while in
`v2-read`. After each create and after each normal-UI removal, wait for the
V1 recovery queue to settle, refresh status, then reload the V1 mirror view or
the normal V1-backed record surface. Confirm that both the added value and its
removal are mirrored to V1 and that the original pre-test state is restored.
Record only timestamps, branch, operation type, status counters, pointer
values, and pass/fail result; do not record student data, account secrets, or
queue payloads.

## Stop, Recover, Verify Parity, and Roll Back

**Pending controlled operator action.** This path applies to a failed smoke
test, a nonzero blocker/mismatch, a queue error, a pointer divergence, or an
unexpected mode/action response.

1. Stop staff editing for the affected branch immediately; do not create more
   test data and do not retry a mode control from a stale page.
2. Refresh and preserve a new developer status snapshot. Identify the affected
   branch by ID and Korean label; keep the other branch unchanged unless its
   own fresh status fails.
3. Allow the deployed scheduled recovery functions
   `recoverScheduleV2OperationalMirrors` and
   `recoverScheduleV2RequestPatches` to drain their server-only queues. Do not
   edit, delete, or replay recovery documents from a browser or console.
4. After recovery runs, refresh status until every recovery, pending, in-flight,
   blocker, and mismatch count is zero and requested/applied revisions agree.
   Reload the affected regular and Bangteuk views and verify V1/V2 parity,
   including the exact removal of the reversible attendance and desk records.
5. Only after parity is documented and the fresh rollback gate is zero-blocker,
   use the developer Settings page for the affected branch: press
   `상태 새로고침`, confirm `recoverySafe=true`, then press `V1으로 복귀` once.
   This invokes the server-controlled `rollback` action with the fresh
   expectation fence.
6. Refresh status immediately; require `mode=v1`, matching active pointers,
   zero recovery counts, zero mismatch count, and the restored V1 data. Keep
   staff editing stopped until the incident owner approves resumption.

Never use `set-v2` as a recovery action. A rollback is not allowed until V1
recovery and parity are complete; the server independently enforces that rule.

## Evidence Record

Keep two separate records:

- **Local evidence:** command, timestamp, exit result, test totals, generator
  result, version JSON parse result, diff result, and emulator result.
- **Production evidence:** only a controlled operator may later add deployment
  timestamps, index `READY` evidence, fresh branch status snapshots, smoke
  observations, mirror-removal evidence, recovery/rollback observations, and
  explicit activation approval.

At the time this document was added, no production evidence exists. No
deployment, production access, status read, smoke test, branch switch, push,
mode change, `set-v2-read`, `set-v2`, or rollback has been performed by this
task.
