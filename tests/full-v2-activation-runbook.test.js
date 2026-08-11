"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const runbook = fs.readFileSync(path.join(root, "api", "README.md"), "utf8");
const firebaseTools = JSON.parse(fs.readFileSync(
  path.join(root, "tools", "firebase-test", "package.json"), "utf8"
));

test("the V2 activation runbook pins the reviewed release and Firebase CLI", () => {
  const cliVersion = firebaseTools.devDependencies["firebase-tools"];

  assert.match(runbook, new RegExp(`\\$FirebaseCliVersion\\s*=\\s*['\"]${cliVersion}['\"]`));
  assert.match(runbook, /firebase-tools@\$FirebaseCliVersion/);
  assert.match(runbook, /\$ApprovedReleaseSha\s+-notmatch\s+['\"]\^\[0-9a-f\]\{40\}\$['\"]/);
  assert.match(runbook, /git checkout --detach \$ApprovedReleaseSha/);
  assert.match(runbook, /git rev-parse HEAD/);
  assert.match(runbook, /git status --porcelain --untracked-files=all/);
  assert.match(runbook, /Assert-DeploymentIdentity \$ApprovedReleaseSha/);
  assert.match(runbook, /Invoke-ReviewedFirebaseCli emulators:exec/);
  assert.match(runbook, /Invoke-ReviewedFirebaseCli deploy --only firestore:indexes/);
  assert.match(runbook, /Invoke-ReviewedFirebaseCli deploy --only firestore:rules/);
  assert.match(runbook, /Invoke-ReviewedFirebaseCli deploy --only functions/);
  assert.doesNotMatch(runbook, /git pull origin main/);
  assert.doesNotMatch(runbook, /firebase-tools@latest/);
});
