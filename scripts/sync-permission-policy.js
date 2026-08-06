"use strict";

const fs = require("node:fs");
const path = require("node:path");

const RULES_START = "    // PERMISSION_POLICY_START";
const RULES_END = "    // PERMISSION_POLICY_END";
const CLIENT_START = "  // PERMISSION_POLICY_START";
const CLIENT_END = "  // PERMISSION_POLICY_END";

function loadPolicy(root){
  const file = path.join(root, "config", "schedule-permissions.json");
  const policy = JSON.parse(fs.readFileSync(file, "utf8"));
  validatePolicy(policy);
  return policy;
}

function validatePolicy(policy){
  const branchIds = new Set((policy.branches || []).map(branch=>branch.id));
  if(!branchIds.size) throw new Error("permission policy requires branches");

  const emails = new Set();
  (policy.accounts || []).forEach(account=>{
    if(!account.email || emails.has(account.email)){
      throw new Error("permission policy contains a missing or duplicate email");
    }
    emails.add(account.email);
    (account.branchIds || []).forEach(branchId=>{
      if(!branchIds.has(branchId)) throw new Error(`unknown branch for ${account.email}: ${branchId}`);
    });
  });
  (policy.teacherWritablePatterns || []).forEach(pattern=>new RegExp(pattern));
}

function accountsFor(policy, role, branchId){
  return policy.accounts.filter(account=>{
    if(account.role !== role) return false;
    return !branchId || account.branchIds.includes(branchId);
  });
}

function renderRulesEmailCondition(functionName, emails){
  const emailLines = emails.map(email=>`          ${JSON.stringify(email)}`).join(",\n");
  return [
    `    function ${functionName}() {`,
    "      return signedIn()",
    "        && request.auth.token.email in [",
    emailLines,
    "        ];",
    "    }",
  ].join("\n");
}

function renderRulesBlock(policy){
  const blocks = [];
  blocks.push(renderRulesEmailCondition("isOwner", accountsFor(policy, "superAdmin").map(row=>row.email)));
  blocks.push(renderRulesEmailCondition("isDeveloper", accountsFor(policy, "developer").map(row=>row.email)));

  policy.branches.forEach(branch=>{
    blocks.push(renderRulesEmailCondition(
      `is${branch.ruleName}Desk`,
      accountsFor(policy, "desk", branch.id).map(row=>row.email)
    ));
    blocks.push(renderRulesEmailCondition(
      `is${branch.ruleName}Teacher`,
      accountsFor(policy, "teacher", branch.id).map(row=>row.email)
    ));
  });

  const readConditions = policy.branches.map(branch=>
    `        || (branch == ${JSON.stringify(branch.id)} && (is${branch.ruleName}Desk() || is${branch.ruleName}Teacher()))`
  );
  blocks.push([
    "    function canReadSchedule(branch) {",
    "      return isOwner()",
    "        || isDeveloper()",
    ...readConditions.map((line,index)=>index === readConditions.length - 1 ? `${line};` : line),
    "    }",
  ].join("\n"));

  const manageConditions = policy.branches.map(branch=>
    `        || (branch == ${JSON.stringify(branch.id)} && is${branch.ruleName}Desk())`
  );
  blocks.push([
    "    function canManageSchedule(branch) {",
    "      return isOwner()",
    "        || isDeveloper()",
    ...manageConditions.map((line,index)=>index === manageConditions.length - 1 ? `${line};` : line),
    "    }",
  ].join("\n"));

  const teacherConditions = policy.branches.map(branch=>
    `      return (branch == ${JSON.stringify(branch.id)} && is${branch.ruleName}Teacher())`
  );
  blocks.push([
    "    function isTeacherForBranch(branch) {",
    ...teacherConditions.map((line,index)=>index === 0
      ? line
      : `        || ${line.replace(/^\s*return\s+/, "")}${index === teacherConditions.length - 1 ? ";" : ""}`),
    "    }",
  ].join("\n"));

  const keyConditions = [
    ...policy.teacherWritableExactKeys.map(key=>`docId == ${JSON.stringify(key)}`),
    ...policy.teacherWritablePatterns.map(pattern=>`docId.matches(${JSON.stringify(pattern)})`),
  ];
  blocks.push([
    "    function isTeacherWritableScheduleKey(docId) {",
    ...keyConditions.map((condition,index)=>
      `${index === 0 ? "      return " : "        || "}${condition}${index === keyConditions.length - 1 ? ";" : ""}`
    ),
    "    }",
  ].join("\n"));

  blocks.push([
    "    function canTeacherWriteScheduleKey(branch, docId) {",
    "      return isTeacherForBranch(branch)",
    "        && isTeacherWritableScheduleKey(docId);",
    "    }",
  ].join("\n"));

  return blocks.join("\n\n");
}

function clientProfile(account){
  const profile = {
    name: account.name,
    role: account.role,
    branchIds: account.branchIds,
    teacherName: account.teacherName || "",
  };
  if(account.permissions && account.permissions.length) profile.permissions = account.permissions;
  return profile;
}

function renderClientBlock(policy){
  const admins = accountsFor(policy, "superAdmin").map(row=>row.email);
  const developers = accountsFor(policy, "developer").map(row=>row.email);
  const staff = {};
  policy.accounts
    .filter(account=>account.role !== "superAdmin")
    .forEach(account=>{ staff[account.email] = clientProfile(account); });

  const lines = [
    `  const SUPER_ADMIN_EMAILS = ${JSON.stringify(admins)};`,
    `  window.SC_DEVELOPER_EMAILS = Object.freeze(${JSON.stringify(developers)});`,
    `  const STAFF_EMAIL_PROFILES = ${JSON.stringify(staff, null, 2).replace(/^/gm, "  ").trimStart()};`,
    `  const TEACHER_WRITABLE_EXACT_KEYS = new Set(${JSON.stringify(policy.teacherWritableExactKeys)});`,
    "  const TEACHER_WRITABLE_PATTERNS = [",
    ...policy.teacherWritablePatterns.map((pattern,index)=>
      `    new RegExp(${JSON.stringify(pattern)})${index === policy.teacherWritablePatterns.length - 1 ? "" : ","}`
    ),
    "  ];",
  ];
  return lines.join("\n");
}

function escapeRegExp(text){
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceManagedBlock(source, startMarker, endMarker, body){
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const pattern = new RegExp(`${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}`);
  if(!pattern.test(source)) throw new Error(`managed permission markers are missing: ${startMarker}`);
  const normalizedBody = body.replace(/\n/g, eol);
  return source.replace(pattern, `${startMarker}${eol}${normalizedBody}${eol}${endMarker}`);
}

function syncFiles(options){
  options = options || {};
  const root = options.root || path.join(__dirname, "..");
  const policy = loadPolicy(root);
  const targets = [
    {
      file:path.join(root, "firestore.rules"),
      start:RULES_START,
      end:RULES_END,
      body:renderRulesBlock(policy),
    },
    {
      file:path.join(root, "js", "auth-guard.js"),
      start:CLIENT_START,
      end:CLIENT_END,
      body:renderClientBlock(policy),
    },
  ];
  const changed = [];
  targets.forEach(target=>{
    const before = fs.readFileSync(target.file, "utf8");
    const after = replaceManagedBlock(before, target.start, target.end, target.body);
    if(before === after) return;
    changed.push(path.relative(root, target.file).replace(/\\/g, "/"));
    if(!options.check) fs.writeFileSync(target.file, after, "utf8");
  });
  return {changed};
}

if(require.main === module){
  const check = process.argv.includes("--check");
  try{
    const result = syncFiles({check});
    if(check && result.changed.length){
      console.error(`permission artifacts are out of sync: ${result.changed.join(", ")}`);
      process.exitCode = 1;
    }else if(result.changed.length){
      console.log(`updated permission artifacts: ${result.changed.join(", ")}`);
    }else{
      console.log("permission artifacts are in sync");
    }
  }catch(error){
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

module.exports = {
  loadPolicy,
  renderRulesBlock,
  renderClientBlock,
  replaceManagedBlock,
  syncFiles,
};
