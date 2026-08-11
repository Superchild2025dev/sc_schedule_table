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

function extractGitStatusFailureBranch(block) {
  const lines = block.split(/\r?\n/);
  const start = lines.indexOf(
    'if ! WORKTREE_STATUS="$(git status --porcelain=v1 --untracked-files=all)"; then'
  );
  const end = lines.indexOf("fi", start);

  assert.notEqual(start, -1, "guarded git-status assignment is missing");
  assert.notEqual(end, -1, "guarded git-status failure branch is incomplete");
  return lines.slice(start, end + 1).join("\n");
}

function assertGitStatusFailureTerminates(block) {
  const branch = extractGitStatusFailureBranch(block);
  assert.equal(branch, [
    'if ! WORKTREE_STATUS="$(git status --porcelain=v1 --untracked-files=all)"; then',
    "  printf '%s\\n' 'Cannot determine whether static deployment worktree is clean.' >&2",
    "  exit 1",
    "fi"
  ].join("\n"), "a git-status command failure must terminate with exit code 1");
}

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

test("the static-host release identity gate fails fast", () => {
  const staticBlock = runbook.match(/```bash\n([\s\S]*?)\n```/);

  assert.ok(staticBlock, "static-host deployment block is missing");
  const block = staticBlock[1];
  assert.match(block, /^set -euo pipefail$/m);
  assert.match(block, /\[\[ ! "\$APPROVED_RELEASE_SHA" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  assert.match(block, /if ! git checkout --detach "\$APPROVED_RELEASE_SHA"; then/);
  assert.match(block, /if \[ "\$ACTUAL_HEAD" != "\$APPROVED_RELEASE_SHA" \]; then/);
  assert.match(block, /if ! WORKTREE_STATUS="\$\(git status --porcelain=v1 --untracked-files=all\)"; then/);
  assert.match(block, /Cannot determine whether static deployment worktree is clean\./);
  assert.match(block, /if \[\[ -n "\$WORKTREE_STATUS" \]\]; then/);
  assertGitStatusFailureTerminates(block);
  assert.doesNotMatch(block, /test "\$\(git rev-parse HEAD\)"/);
  assert.doesNotMatch(block, /test -z "\$\(git status/);
  assert.doesNotMatch(block, /\[\[ -n "\$\(git status/);
});

test("the git-status failure regression rejects removal of its branch-specific exit", () => {
  const staticBlock = runbook.match(/```bash\n([\s\S]*?)\n```/);

  assert.ok(staticBlock, "static-host deployment block is missing");
  const block = staticBlock[1];
  const mutatedBlock = block.replace(
    /(if ! WORKTREE_STATUS="\$\(git status --porcelain=v1 --untracked-files=all\)"; then\r?\n  printf '%s\\n' 'Cannot determine whether static deployment worktree is clean\.' >&2\r?\n)  exit 1(\r?\nfi)/,
    "$1$2"
  );

  assert.notEqual(mutatedBlock, block, "the branch-specific exit mutation was not applied");
  assert.throws(
    () => assertGitStatusFailureTerminates(mutatedBlock),
    /git-status command failure must terminate with exit code 1/
  );
});
