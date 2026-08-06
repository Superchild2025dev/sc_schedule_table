# Firestore Permission Safety Design

## Goal

Prevent another attendance outage caused by Firestore rules, client-side permission checks, and production deployment getting out of sync.

The existing production behavior remains unchanged:

- Teachers can read their branch schedule.
- Teachers can write attendance, attendance guests, attendance day snapshots, marks, and teacher requests.
- Teachers cannot edit core schedule documents such as students or instructor assignments.
- Desk accounts can manage their own branch.
- Cross-branch access remains blocked.

## Chosen Approach

Use one versioned permission manifest as the source of truth. A generator updates the corresponding marked sections in `firestore.rules` and `js/auth-guard.js`. A verification command fails when either generated section no longer matches the manifest.

This is safer than maintaining two handwritten lists and less invasive than replacing the current authentication/profile system.

## 1. Real Rules Tests

Add Firebase Rules Unit Testing with the Firestore emulator. The tests use authenticated test users and make real Firestore reads and writes against the emulator.

Required cases:

- A Gagyeong teacher can write regular attendance.
- A Gagyeong teacher can write vacation attendance, attendance guests, and day snapshots.
- A teacher cannot write core schedule data such as `swim_students` and `swim_inst`.
- A Gagyeong teacher cannot read or write Yongam schedule data.
- Each branch desk account can manage its own branch.
- A desk account cannot manage the other branch.
- Chunked documents follow the same parent-key permission.

## 2. Release Procedure

Provide repository scripts with two levels:

- `verify`: generate/check permission artifacts, run all local tests, and run the Firestore emulator tests.
- `release`: require an explicit production flag, run `verify`, deploy Firestore rules, then print the exact web deployment and teacher attendance smoke-test checklist.

The release command will not silently upload the web site or alter Lightsail. Production changes remain explicit and observable.

The smoke test covers one regular attendance change and one vacation attendance change using a teacher account, followed by confirmation on a second session/device.

## 3. Single Permission Source

Create `config/schedule-permissions.json` containing:

- branch IDs;
- desk and teacher email lists;
- teacher-writable exact document keys;
- teacher-writable document key patterns.

Create a deterministic generator that owns marker-delimited blocks in:

- `firestore.rules`;
- `js/auth-guard.js`.

Generated output is committed so the static site and Firebase deployment continue to work without a runtime build step. The verification script compares generated output in memory and fails on drift.

## 4. Error Classification

Restore centralized Firebase write-error classification:

- Connectivity errors show the red offline banner.
- `permission-denied` shows a login/permission message only.
- `failed-precondition` shows a refresh/retry message only.
- `resource-exhausted` shows a data-size/admin message only.
- Other write failures show a generic save error.

Audit and delete-safety record failures use the same classifier. Permission problems must never be presented as an internet outage.

## 5. Rollback and Regression Guard

Add a release guard that checks the staged or target diff before production release. It fails when a change removes test files or deletes a large amount of code across unrelated runtime areas unless an explicit override and reason are supplied.

Add a GitHub Actions verification workflow so pull requests and pushes run:

- permission artifact drift checks;
- the complete Node test suite;
- Firestore emulator authorization tests.

This does not prevent intentional rollback. It makes broad rollback visible and requires an explicit decision instead of silently deleting unrelated protections.

## Failure Safety

- Emulator tests use a fake project ID and never access production data.
- The generator only changes marked permission sections.
- Release scripts stop on the first failed check.
- No script deploys functions, deletes data, or changes Firestore data.
- Existing untracked backup/output files are not modified.

## Acceptance Criteria

1. All current Node tests pass.
2. The rules emulator authorization matrix passes.
3. Generated permission blocks are in sync with the manifest.
4. Permission errors no longer display the offline banner.
5. A simulated broad rollback is rejected by the release guard.
6. The documented production smoke test is concise enough for desk staff or the operator to follow.
