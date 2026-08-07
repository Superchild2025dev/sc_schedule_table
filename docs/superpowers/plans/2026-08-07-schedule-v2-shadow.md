# Schedule V2 Server Shadow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep both branches on V1 while every successful timetable change is coalesced and mirrored by Cloud Functions into a verified V2 generation without adding browser reads.

**Architecture:** A Firestore source trigger converts changed V1 document IDs into a per-branch queue. A second trigger leases that queue, reconstructs only the required legacy context, runs the shared V2 converter, writes selected V2 collections, and records redacted parity diagnostics. The converter remains one logical source by mechanically copying the browser converter into the Firebase Functions source and enforcing byte parity in tests.

**Tech Stack:** Firebase Functions v2, Cloud Firestore/Admin SDK, browser Firebase v10 compatibility API, Node.js 20, Node built-in test runner.

## Global Constraints

- V1 remains the only operational read/write authority in this phase.
- Enable `shadow` for both `gagyeong` and `yongam`; do not enable V2 reads.
- Staff browsers must not load the full legacy root to maintain V2.
- V2 failures must never turn a successful V1 write into a staff-facing failure.
- Regular and vacation courses share `personId` only; placements and enrollments stay course-scoped.
- Same phone with a different name remains a different person.
- Attendance continues through the existing attendance gateway and is excluded from the timetable queue.
- Audit, restore, and delete-source records are excluded from timetable shadow sync.
- Diagnostics must not contain student names or phone numbers.
- A failed or partial generation can never become a V2 read source.

---

### Task 1: Share the V2 Conversion Contract with Cloud Functions

**Files:**
- Create: `scripts/sync-v2-function-shared.js`
- Create: `functions/shared/schedule-time.js`
- Create: `functions/shared/schedule-schema-v2.js`
- Modify: `package.json`
- Test: `tests/function-v2-shared-sync.test.js`

**Interfaces:**
- Consumes: `js/schedule-time.js`, `js/schedule-schema-v2.js`.
- Produces: `node scripts/sync-v2-function-shared.js --write|--check`; globals `SCScheduleTime` and `SCScheduleSchemaV2` inside the Functions runtime.

- [ ] **Step 1: Write the failing parity test**

```js
test('function V2 shared files match browser sources',()=>{
  for(const name of ['schedule-time.js','schedule-schema-v2.js']){
    assert.equal(read(`functions/shared/${name}`),read(`js/${name}`));
  }
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `node --test tests/function-v2-shared-sync.test.js`

Expected: FAIL because `functions/shared` does not exist.

- [ ] **Step 3: Implement deterministic copy/check commands**

```js
const mode=process.argv.includes('--write')?'write':'check';
for(const name of FILES){
  const source=fs.readFileSync(path.join(ROOT,'js',name),'utf8');
  const target=path.join(ROOT,'functions','shared',name);
  if(mode==='write') fs.writeFileSync(target,source,'utf8');
  else if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==source) process.exitCode=1;
}
```

Add scripts:

```json
"sync:v2-functions": "node scripts/sync-v2-function-shared.js --write",
"verify:v2-functions": "node scripts/sync-v2-function-shared.js --check"
```

Run the write command once to create the two generated files.

- [ ] **Step 4: Verify the shared converter loads in Node**

Add a test that clears the two globals, requires both generated files, and asserts:

```js
assert.equal(typeof globalThis.SCScheduleSchemaV2.diagnoseLegacyRoot,'function');
assert.equal(typeof globalThis.SCScheduleSchemaV2.convertLegacySchedule,'function');
```

Run: `node --test tests/function-v2-shared-sync.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json scripts/sync-v2-function-shared.js functions/shared tests/function-v2-shared-sync.test.js
git commit -m "Share V2 schedule converter with functions"
```

### Task 2: Define the Server Queue and Redacted Diagnostics Policy

**Files:**
- Create: `functions/schedule-v2-shadow-policy.js`
- Test: `tests/function-schedule-v2-shadow-policy.test.js`

**Interfaces:**
- Produces: `decodeLegacyKey(docId)`, `collectionsForKey(key)`, `isTrackedKey(key)`, `mergePending(current,key,now)`, `claimPending(current,leaseId,now)`, `finishPending(current,claim,result,now)`, `redactedError(error,input)`.
- Consumes: no Firebase objects; this module stays pure.

- [ ] **Step 1: Write failing key classification tests**

```js
assert.deepEqual(policy.collectionsForKey('swim_students'),['people','enrollments','placements']);
assert.deepEqual(policy.collectionsForKey('swim_inst'),['teacherAssignments']);
assert.deepEqual(policy.collectionsForKey('swim_retire'),['reservations']);
assert.deepEqual(policy.collectionsForKey('swim_mark'),['classMarks']);
assert.equal(policy.isTrackedKey('swim_attendance'),false);
assert.equal(policy.isTrackedKey('swim_audit_log'),false);
```

- [ ] **Step 2: Run the test and confirm the module is missing**

Run: `node --test tests/function-schedule-v2-shadow-policy.test.js`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement exact key-to-collection mapping**

Reuse the ownership rules already present in `js/schedule-v2-shadow.js`, but exclude attendance and attendance snapshots from timetable processing. Return frozen arrays or fresh copies so callers cannot mutate module state.

- [ ] **Step 4: Add queue state tests**

Cover:

```js
const queued=policy.mergePending({pendingKeys:['swim_inst'],requestedRevision:2},'swim_students',NOW);
assert.deepEqual(queued.pendingKeys.sort(),['swim_inst','swim_students']);
assert.equal(queued.requestedRevision,3);

const claim=policy.claimPending(queued,'lease-a',NOW);
assert.deepEqual(claim.keys.sort(),['swim_inst','swim_students']);
assert.deepEqual(claim.next.pendingKeys,[]);
assert.equal(claim.next.status,'processing');
```

Also assert a second claim while `leaseUntil` is active returns `null`, and that `finishPending` leaves status `pending` when a newer key arrived during processing.

- [ ] **Step 5: Implement queue transitions and privacy-safe errors**

`redactedError` may contain only `branchId`, `keys`, `collections`, `code`, `messageClass`, and timestamps. Tests must assert sample names and phone numbers supplied in an error are absent from serialized output.

- [ ] **Step 6: Run the focused tests and commit**

Run: `node --test tests/function-schedule-v2-shadow-policy.test.js`

```bash
git add functions/schedule-v2-shadow-policy.js tests/function-schedule-v2-shadow-policy.test.js
git commit -m "Define V2 schedule shadow queue policy"
```

### Task 3: Build the Firestore V1 Reader and V2 Collection Writer

**Files:**
- Create: `functions/schedule-v2-shadow-runner.js`
- Test: `tests/function-schedule-v2-shadow-runner.test.js`

**Interfaces:**
- Consumes: `{db, branchId, generationId, keys, readLegacyKey, now}` and `SCScheduleSchemaV2`.
- Produces: `requiredLegacyKeys(keys,tabMetadata)`, `runShadowSync(input) -> {collections,writes,deletes,counts,digests}`.

- [ ] **Step 1: Write failing required-context tests**

Examples:

```js
assert.deepEqual(requiredLegacyKeys(['swim_inst'],meta).sort(),[
  'swim_inst','swim_main_tab','swim_tab_list'
]);
assert.ok(requiredLegacyKeys(['swim_stu_july'],meta).includes('swim_stu_july'));
assert.ok(requiredLegacyKeys(['swim_retire'],meta).includes('swim_students'));
```

The reservation group (`swim_retire`, `swim_enroll`, `swim_hyuwon`, `swim_move`) must be loaded together because one operation can move between those states.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `node --test tests/function-schedule-v2-shadow-runner.test.js`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement chunk-safe legacy reads through dependency injection**

The runner calls the injected `readLegacyKey(key)` and never imports `functions/index.js`. The index handler supplies the existing `readStoredKey(branch,key)` implementation, which already reconstructs chunked values.

- [ ] **Step 4: Implement selected conversion and writes**

Build a legacy root from required keys, call:

```js
const report=schema.diagnoseLegacyRoot(branchId,legacyRoot);
if(!report.checks.ready) throw coded('conversion-mismatch');
```

Convert only collections returned by the policy. For each selected collection:

1. Build desired documents for the affected tab or global scope.
2. Read existing documents for that scope.
3. Batch upserts/deletes in groups of at most 350.
4. Re-read that scope and compare count, ID set, and canonical digest.
5. Return a mismatch instead of marking the request applied when any comparison fails.

For `people`, upsert current people but do not delete an unreferenced person during an incremental run. Full baseline compaction may delete orphan people later.

- [ ] **Step 5: Add identity and atomic-scope scenarios**

Tests must cover:

- regular and vacation placements share a person and retain separate enrollments;
- same phone/different name stays separate;
- a student move deletes the old placement and creates the new placement in one claimed request;
- instructor and student changes in one request update both collection scopes;
- a failed second batch leaves the queue unapplied;
- diagnostics never include source student fields.

- [ ] **Step 6: Run tests and commit**

Run: `node --test tests/function-schedule-v2-shadow-runner.test.js tests/schedule-schema-v2.test.js`

```bash
git add functions/schedule-v2-shadow-runner.js tests/function-schedule-v2-shadow-runner.test.js
git commit -m "Add server V2 schedule shadow runner"
```

### Task 4: Wire Source and Queue Firestore Triggers

**Files:**
- Modify: `functions/index.js`
- Test: `tests/function-schedule-v2-shadow-trigger.test.js`

**Interfaces:**
- Produces Cloud Functions: `queueScheduleV2Shadow`, `processScheduleV2Shadow`.
- Consumes policy functions from Task 2, runner from Task 3, and existing `readStoredKey`.

- [ ] **Step 1: Write failing trigger contract tests**

Assert the source contains both exact trigger paths:

```js
document: "scheduleStores/{branchId}/kv/{docId}"
document: "scheduleV2/{branchId}/runtime/scheduleSync"
```

Assert the source trigger checks `runtime/schedule` mode and queues only `shadow` or `verify`. Assert branch IDs are restricted to `gagyeong` and `yongam`.

- [ ] **Step 2: Run and confirm failure**

Run: `node --test tests/function-schedule-v2-shadow-trigger.test.js`

- [ ] **Step 3: Implement the source trigger**

Pseudo-code:

```js
exports.queueScheduleV2Shadow=onDocumentWritten(SOURCE,async event=>{
  const branchId=knownBranch(event.params.branchId);
  const key=policy.decodeLegacyKey(event.params.docId);
  if(!branchId||!policy.isTrackedKey(key)) return;
  const config=await scheduleRuntime(branchId).get();
  if(!['shadow','verify'].includes(config.get('mode'))) return;
  await db.runTransaction(async tx=>{
    const snap=await tx.get(syncRuntime(branchId));
    tx.set(syncRuntime(branchId),policy.mergePending(snap.data(),key,new Date()),{merge:true});
  });
});
```

- [ ] **Step 4: Implement the queue processor with leases**

The processor transaction claims pending keys. It calls `runShadowSync`, then transactionally records `appliedRevision`, digests, counts, and `lastSyncedAt`. On error, requeue claimed keys, increment a bounded retry counter, and write/merge one alert ID derived from error class plus collection names.

Do not log raw V1 values. Use `logger.error('schedule-v2-shadow-failed',redactedDiagnostic)`.

- [ ] **Step 5: Test concurrent request behavior**

Use fake Firestore transaction objects to prove:

- two source events merge keys;
- an active lease prevents duplicate processing;
- a key arriving while processing remains pending;
- processing an unchanged runtime write exits without re-running;
- failure requeues the original keys.

- [ ] **Step 6: Run syntax/tests and commit**

Run:

```bash
node --check functions/index.js
node --test tests/function-schedule-v2-shadow-trigger.test.js
```

```bash
git add functions/index.js tests/function-schedule-v2-shadow-trigger.test.js
git commit -m "Process V2 schedule shadow writes on server"
```

### Task 5: Add Developer Controls, Initial Baseline, and Rollback

**Files:**
- Create: `js/schedule-v2-settings-policy.js`
- Modify: `functions/index.js`
- Modify: `settings.html`
- Modify: `js/settings.js`
- Modify: `settings.css`
- Test: `tests/schedule-v2-settings.test.js`

**Interfaces:**
- Produces callable `manageScheduleV2Shadow({action,branchId})` with actions `prepare`, `set-shadow`, `set-verify`, `rollback`, `status`.
- Produces browser policy `SCScheduleV2SettingsPolicy.canView/evaluate`.

- [ ] **Step 1: Write failing authorization and UI tests**

Assert only `developer@scswim.local` may call mutations. `status` may be read by the developer and owner, but the page controls stay hidden unless `SCAuth.profile().role==='developer'`.

- [ ] **Step 2: Implement the callable**

`prepare` performs these steps:

1. Set schedule runtime to `preparing` without changing V1.
2. Record the starting source revision.
3. Read all non-operational V1 timetable keys using chunk-safe reads.
4. Create a new V2 generation and verify every collection.
5. Apply source changes queued after the starting revision.
6. Mark the generation `ready` only when the queue is empty and full parity passes.

`set-shadow` requires a ready generation and sets `{mode:'shadow',generationId,branchId}`. `rollback` sets mode `v1` and preserves the V2 generation.

- [ ] **Step 3: Add compact developer-only controls**

Display per active branch:

- current mode;
- current generation;
- pending key count;
- last successful sync;
- unresolved mismatch count;
- `기준점 새로 만들기`, `그림자 복사 시작`, `검증 모드`, `V1으로 복귀` buttons.

Do not show red V2 banners on timetable pages. Errors remain inside Settings.

- [ ] **Step 4: Test refusal paths**

The policy must reject `set-shadow` when no ready generation exists and reject `set-verify` when pending keys or mismatches are nonzero. Rollback is always allowed for the developer.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
node --test tests/schedule-v2-settings.test.js tests/v2-developer-gate.test.js
node --check functions/index.js
```

```bash
git add functions/index.js js/schedule-v2-settings-policy.js js/settings.js settings.html settings.css tests/schedule-v2-settings.test.js
git commit -m "Add safe V2 schedule shadow controls"
```

### Task 6: Verify Both Branches and Prepare a Controlled Deployment

**Files:**
- Modify: `firestore.indexes.json` only if emulator or query tests prove an index is required.
- Modify: `docs/superpowers/specs/2026-08-07-schedule-v2-shadow-design.md` only for discovered, approved behavior corrections.
- Test: `tests/function-schedule-v2-shadow-emulator.test.js`

**Interfaces:**
- Consumes all earlier tasks.
- Produces verified Cloud Functions and a two-branch `shadow` activation procedure with an immediate V1 rollback.

- [ ] **Step 1: Add Firestore emulator integration tests**

Seed minimal `scheduleStores/gagyeong` and `scheduleStores/yongam` roots, including one chunked student key. Enable shadow mode, write student/instructor/reservation changes, run the handlers, and assert the correct generation documents and queue status.

- [ ] **Step 2: Cover failure recovery**

Inject one invalid source document and assert:

- V1 remains unchanged;
- generation does not become ready;
- queue status is error/pending;
- one redacted alert exists;
- rollback prevents later source writes from queuing.

- [ ] **Step 3: Run all verification**

```bash
npm run verify:v2-functions
npm run test:unit
npm run test:rules
node --check functions/index.js
```

Expected: all tests pass; the emulator availability test may skip only when Java/emulator startup is unavailable, never because an assertion failed.

- [ ] **Step 4: Deploy functions without changing V1 mode**

```bash
npx.cmd firebase-tools@latest deploy --only functions --project scswimming-schedule
```

Confirm both new functions are healthy before activating either branch.

- [ ] **Step 5: Create and verify fresh baselines**

Using the developer control, run `prepare` for `gagyeong`, verify status, then repeat for `yongam`. Do not activate a branch whose pending count or mismatch count is nonzero.

- [ ] **Step 6: Activate both branches in shadow mode**

Set both branches to `shadow`. Perform one regular and one vacation change per branch: registration, move, exclusion/retirement, instructor change, waitlist edit, and class mark edit. Confirm V1 is the primary source and V2 parity stays at zero mismatches.

- [ ] **Step 7: Commit deployment documentation updates**

```bash
git add docs/superpowers/specs/2026-08-07-schedule-v2-shadow-design.md firestore.indexes.json
git commit -m "Verify V2 schedule shadow deployment"
```

Only include files that actually changed.

## Execution Checkpoints

- Checkpoint A after Task 2: queue policy is pure and privacy-safe.
- Checkpoint B after Task 4: server triggers work locally but production remains V1.
- Checkpoint C after Task 5: developer can prepare, activate, and roll back without editing Firestore manually.
- Checkpoint D after Task 6: both branches are shadowing while every staff screen still reads/writes V1.
