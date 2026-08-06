# Firestore Permission Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make staff attendance permissions testable, generated from one source, accurately reported in the UI, and protected by a repeatable release gate.

**Architecture:** A JSON manifest becomes the single authority for branch staff and teacher-writable Firestore keys. A deterministic Node generator owns marked sections in both Firebase Rules and the browser guard, while emulator tests verify actual authorization behavior. Release and rollback scripts compose these checks without touching production data.

**Tech Stack:** Static JavaScript, Node.js built-in test runner, Firebase CLI, `@firebase/rules-unit-testing`, Firestore emulator, GitHub Actions.

## Global Constraints

- Preserve the current production permission behavior.
- Never read from or write to production data during automated tests.
- Do not deploy functions or delete Firestore documents.
- Do not modify `HANDOFF.md`, `backup/`, or `outputs/`.
- Production rule deployment must require an explicit `--production` flag.

---

### Task 1: Single Permission Source

**Files:**
- Create: `config/schedule-permissions.json`
- Create: `scripts/sync-permission-policy.js`
- Create: `tests/permission-policy-sync.test.js`
- Modify: `firestore.rules`
- Modify: `js/auth-guard.js`

**Interfaces:**
- Consumes: branch IDs, staff emails, exact writable keys, and writable key regular expressions from the JSON manifest.
- Produces: `renderRulesBlock(policy)`, `renderClientBlock(policy)`, and `syncFiles({check})` from `scripts/sync-permission-policy.js`.

- [ ] **Step 1: Write the failing synchronization test**

The test loads the manifest and generator, renders both blocks, and asserts that the marker-delimited blocks in `firestore.rules` and `js/auth-guard.js` are byte-for-byte equal to generated output. It also asserts that vacation student/instructor keys are absent from the teacher write patterns.

- [ ] **Step 2: Run the synchronization test and confirm failure**

Run: `node --test tests/permission-policy-sync.test.js`

Expected: FAIL because the manifest and generator do not exist.

- [ ] **Step 3: Add the manifest and deterministic generator**

The manifest must include:

```json
{
  "branches": {
    "gagyeong": {
      "desk": ["gagyeong.desk@scswim.local"],
      "teachers": [
        "gagyeong.son@scswim.local",
        "gagyeong.park@scswim.local",
        "gagyeong.lee1@scswim.local",
        "gagyeong.kimjy@scswim.local",
        "gagyeong.kimms@scswim.local",
        "gagyeong.yoo@scswim.local"
      ]
    },
    "yongam": {
      "desk": ["yongam.desk@scswim.local"],
      "teachers": [
        "yongam.lee1@scswim.local",
        "yongam.jung@scswim.local",
        "yongam.kimsh@scswim.local",
        "yongam.kimey@scswim.local",
        "yongam.kimjs@scswim.local",
        "yongam.lee2@scswim.local"
      ]
    }
  },
  "teacherWritableExactKeys": [
    "swim_mark",
    "swim_requests",
    "swim_attendance",
    "swim_att_guests",
    "swim_day_snapshot",
    "zz_swim_audit_index"
  ],
  "teacherWritablePatterns": [
    "^swim_bt_attendance_.*$",
    "^swim_bt_att_guests_.*$",
    "^swim_bt_day_snapshot_.*$",
    "^zz_swim_day_snapshot__.*$",
    "^zz_swim_audit_entry__.*$"
  ]
}
```

The generator replaces only content between `PERMISSION_POLICY_START` and `PERMISSION_POLICY_END` markers and supports `node scripts/sync-permission-policy.js --check` without writing files.

- [ ] **Step 4: Generate both artifacts and run security tests**

Run:

```powershell
node scripts/sync-permission-policy.js
node --test tests/permission-policy-sync.test.js tests/attendance-teacher-permission.test.js tests/firestore-rules-security.test.js
```

Expected: PASS.

---

### Task 2: Real Firestore Rules Emulator Tests

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `tests/firestore-rules-emulator.test.js`
- Modify: `firebase.json`

**Interfaces:**
- Consumes: `firestore.rules` and Firebase Auth token objects containing test email addresses.
- Produces: npm scripts `test:unit`, `test:rules`, and `verify:rules`.

- [ ] **Step 1: Add the failing authorization matrix**

Use `initializeTestEnvironment`, `assertSucceeds`, and `assertFails`. The test writes to `scheduleStores/{branch}/kv/{docId}` and to `chunks/{chunkId}` with these identities:

```js
const gagyeongTeacher = {email:'gagyeong.son@scswim.local'};
const gagyeongDesk = {email:'gagyeong.desk@scswim.local'};
const yongamDesk = {email:'yongam.desk@scswim.local'};
```

Required assertions:

```text
teacher + swim_attendance -> allow
teacher + swim_bt_attendance_2026_summer -> allow
teacher + swim_bt_att_guests_2026_summer -> allow
teacher + swim_bt_day_snapshot_2026_summer -> allow
teacher + swim_students -> deny
teacher + swim_inst -> deny
gagyeong teacher + yongam read/write -> deny
gagyeong desk + gagyeong schedule -> allow
gagyeong desk + yongam schedule -> deny
teacher + attendance chunk -> allow
teacher + student chunk -> deny
```

- [ ] **Step 2: Run the test and confirm dependency/setup failure**

Run: `node --test tests/firestore-rules-emulator.test.js`

Expected: FAIL because rules-unit-testing and the emulator environment are not installed/running.

- [ ] **Step 3: Install pinned development dependencies and configure the emulator**

Run:

```powershell
npm.cmd install --save-dev @firebase/rules-unit-testing firebase firebase-tools
```

Add Firestore emulator configuration on `127.0.0.1:8080` with `singleProjectMode: true`. Add npm scripts that run the emulator with the fake project ID `sc-schedule-rules-test`.

- [ ] **Step 4: Run the real rules tests**

Run: `npm.cmd run test:rules`

Expected: all authorization cases PASS and no production project is contacted.

---

### Task 3: Accurate Firebase Write Errors

**Files:**
- Create: `tests/firebase-write-error.test.js`
- Modify: `js/core.js`
- Modify: `js/data.js`

**Interfaces:**
- Produces: `_firebaseErrorCode(error)`, `_isFirebaseConnectivityError(error)`, and `_reportFirebaseWriteFailure(error, key)`.
- Consumed by: `dbSet`, delete-safety persistence, and incremental audit persistence.

- [ ] **Step 1: Restore and expand the failing error-classification tests**

Test these cases:

```text
permission-denied -> permission toast, zero offline warnings
failed-precondition -> refresh toast, zero offline warnings
resource-exhausted -> size/admin toast, zero offline warnings
unavailable -> one offline warning, zero toasts
navigator.onLine=false -> one offline warning
```

Also assert that `js/data.js` routes record-persistence failures through `_reportFirebaseWriteFailure`.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `node --test tests/firebase-write-error.test.js`

Expected: FAIL because the centralized classifier is currently missing.

- [ ] **Step 3: Implement the classifier and replace false offline warnings**

Restore the classifier in `js/core.js`, call it from `dbSet`, and replace direct `_showOfflineWarning()` calls in the two record persistence catches in `js/data.js`.

- [ ] **Step 4: Run focused and attendance tests**

Run:

```powershell
node --test tests/firebase-write-error.test.js tests/attendance-teacher-permission.test.js
```

Expected: PASS.

---

### Task 4: Repeatable Release Gate

**Files:**
- Create: `scripts/release-firestore-rules.js`
- Create: `tests/firestore-release.test.js`
- Create: `docs/operations/firestore-release-checklist.md`
- Modify: `package.json`

**Interfaces:**
- Produces: `parseReleaseArgs(argv)` and `release({production, dryRun})`.
- Consumes: npm verification scripts and Firebase CLI.

- [ ] **Step 1: Write failing release-gate tests**

Verify that missing `--production` refuses deployment, `--dry-run` runs verification without Firebase deployment, and the success output contains the regular and vacation attendance smoke-test checklist.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `node --test tests/firestore-release.test.js`

Expected: FAIL because the release module does not exist.

- [ ] **Step 3: Implement the explicit release command and checklist**

Expose:

```text
npm run verify
npm run release:rules -- --dry-run
npm run release:rules -- --production
```

`--production` runs verification first, then exactly:

```text
firebase deploy --only firestore:rules --project scswimming-schedule --non-interactive
```

After success it prints the manual Lightsail pull/reload step and the teacher smoke-test checklist. It never deploys the web site itself.

- [ ] **Step 4: Run the dry release path**

Run: `npm.cmd run release:rules -- --dry-run`

Expected: verification succeeds, no production deployment occurs, and the smoke-test checklist is printed.

---

### Task 5: Broad Rollback Guard and CI

**Files:**
- Create: `scripts/check-release-diff.js`
- Create: `tests/release-diff-guard.test.js`
- Create: `.github/workflows/verify.yml`
- Modify: `.githooks/pre-commit`
- Modify: `package.json`

**Interfaces:**
- Produces: `parseNumstat(text)`, `evaluateDiff(entries, env)`, and a CLI supporting `--cached` or `--range <base>..<head>`.
- Consumed by: the pre-commit hook, npm `verify`, and GitHub Actions.

- [ ] **Step 1: Write failing rollback-policy tests**

Required assertions:

```text
normal focused change -> allow
deleted test file -> deny
250+ deleted lines across 3+ runtime/test files -> deny
explicit SC_ALLOW_BROAD_ROLLBACK=1 plus non-empty SC_ROLLBACK_REASON -> allow
override without reason -> deny
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `node --test tests/release-diff-guard.test.js`

Expected: FAIL because the guard does not exist.

- [ ] **Step 3: Implement and wire the guard**

The pre-commit hook runs `node scripts/check-release-diff.js --cached` before generating the version files. The verification workflow uses Node 22 and Java 21, installs from `package-lock.json`, and runs `npm run verify`.

- [ ] **Step 4: Run guard simulations and the complete suite**

Run:

```powershell
node --test tests/release-diff-guard.test.js
node scripts/check-release-diff.js --cached
npm.cmd run verify
```

Expected: all tests PASS; the current focused diff is allowed.

---

### Task 6: Final Verification

**Files:**
- Verify only; no new production behavior.

**Interfaces:**
- Consumes every artifact from Tasks 1-5.
- Produces a clean verification report and reviewable diff.

- [ ] **Step 1: Check generated artifacts and syntax**

Run:

```powershell
node scripts/sync-permission-policy.js --check
node --check js/auth-guard.js
node --check js/core.js
node --check js/data.js
node --check scripts/release-firestore-rules.js
node --check scripts/check-release-diff.js
```

- [ ] **Step 2: Run all local and emulator tests**

Run: `npm.cmd run verify`

Expected: all unit and Firestore emulator tests PASS.

- [ ] **Step 3: Inspect repository scope**

Run:

```powershell
git diff --check
git status --short
git diff --stat
```

Confirm that `HANDOFF.md`, `backup/`, and `outputs/` remain untouched.

- [ ] **Step 4: Commit implementation**

Stage only the files named in this plan and commit with:

```text
Harden Firestore permission release workflow
```
