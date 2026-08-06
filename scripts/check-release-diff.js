"use strict";

const {execFileSync} = require("node:child_process");

const BROAD_DELETE_LINE_LIMIT = 250;
const BROAD_DELETE_FILE_LIMIT = 3;
const PROTECTED_SAFETY_FILES = new Set([
  ".githooks/pre-commit",
  ".github/workflows/verify.yml",
  "config/schedule-permissions.json",
  "firestore.rules",
  "scripts/check-release-diff.js",
  "scripts/release-firestore-rules.js",
  "scripts/sync-permission-policy.js",
]);

function normalizePath(filePath){
  return String(filePath || "").trim().replace(/\\/g, "/");
}

function parseNumstat(text){
  return String(text || "").split(/\r?\n/).filter(Boolean).map(line=>{
    const parts = line.split("\t");
    const added = parts[0] === "-" ? 0 : Number(parts[0] || 0);
    const deleted = parts[1] === "-" ? 0 : Number(parts[1] || 0);
    return {
      path:normalizePath(parts.slice(2).join("\t")),
      added:Number.isFinite(added) ? added : 0,
      deleted:Number.isFinite(deleted) ? deleted : 0,
    };
  });
}

function parseNameStatus(text){
  return String(text || "").split(/\r?\n/).filter(Boolean).map(line=>{
    const parts = line.split("\t");
    const status = String(parts[0] || "").charAt(0);
    const filePath = status === "R" || status === "C" ? parts[2] : parts[1];
    return {path:normalizePath(filePath), status};
  });
}

function mergeDiffEntries(numstat, nameStatus){
  const statuses = new Map(nameStatus.map(entry=>[entry.path, entry.status]));
  return numstat.map(entry=>({...entry, status:statuses.get(entry.path) || "M"}));
}

function isRuntimeOrTestPath(filePath){
  const p = normalizePath(filePath);
  return /^(js|tests|functions|regular-vacancy-site|voice)\//.test(p)
    || /^(firestore\.rules|[^/]+\.(html|css))$/.test(p);
}

function evaluateDiff(entries, env){
  env = env || {};
  const reasons = [];
  const deletedTests = entries.filter(entry=>
    entry.status === "D" && /^tests\/.*\.test\.js$/.test(normalizePath(entry.path))
  );
  if(deletedTests.length){
    reasons.push(`테스트 파일 삭제 감지: ${deletedTests.map(entry=>entry.path).join(", ")}`);
  }

  const deletedSafetyFiles = entries.filter(entry=>
    entry.status === "D" && PROTECTED_SAFETY_FILES.has(normalizePath(entry.path))
  );
  if(deletedSafetyFiles.length){
    reasons.push(`안전장치 파일 삭제 감지: ${deletedSafetyFiles.map(entry=>entry.path).join(", ")}`);
  }

  const broadFiles = entries.filter(entry=>isRuntimeOrTestPath(entry.path) && entry.deleted > 0);
  const deletedLines = broadFiles.reduce((sum, entry)=>sum + entry.deleted, 0);
  if(broadFiles.length >= BROAD_DELETE_FILE_LIMIT && deletedLines >= BROAD_DELETE_LINE_LIMIT){
    reasons.push(`실행/테스트 파일 ${broadFiles.length}개에서 ${deletedLines}줄 삭제 감지`);
  }

  if(!reasons.length) return {allowed:true, reasons:[], overridden:false};

  const override = env.SC_ALLOW_BROAD_ROLLBACK === "1";
  const reason = String(env.SC_ROLLBACK_REASON || "").trim();
  if(override && reason){
    return {allowed:true, reasons, overridden:true, overrideReason:reason};
  }
  if(override && !reason){
    reasons.push("되돌리기 예외를 사용하려면 SC_ROLLBACK_REASON 사유가 필요합니다.");
  }
  return {allowed:false, reasons, overridden:false};
}

function diffArgs(argv, mode){
  const cached = argv.includes("--cached");
  const rangeIndex = argv.indexOf("--range");
  if(cached && rangeIndex !== -1) throw new Error("--cached와 --range는 함께 사용할 수 없습니다.");
  const args = ["diff"];
  if(cached) args.push("--cached");
  if(rangeIndex !== -1){
    const range = argv[rangeIndex + 1];
    if(!range) throw new Error("--range 뒤에 Git 범위가 필요합니다.");
    args.push(range);
  }
  if(!cached && rangeIndex === -1) args.push("--cached");
  args.push(mode);
  return args;
}

function readGitDiff(argv){
  const numstat = execFileSync("git", diffArgs(argv, "--numstat"), {encoding:"utf8"});
  const statuses = execFileSync("git", diffArgs(argv, "--name-status"), {encoding:"utf8"});
  return mergeDiffEntries(parseNumstat(numstat), parseNameStatus(statuses));
}

function main(argv, env){
  const entries = readGitDiff(argv);
  const result = evaluateDiff(entries, env);
  if(result.overridden){
    console.warn(`광범위 되돌리기 예외 승인: ${result.overrideReason}`);
  }
  if(!result.allowed){
    console.error("광범위 되돌리기 안전검사가 변경을 중단했습니다.");
    result.reasons.forEach(reason=>console.error(`- ${reason}`));
    console.error("의도한 작업이면 SC_ALLOW_BROAD_ROLLBACK=1과 SC_ROLLBACK_REASON을 함께 지정하세요.");
    return 1;
  }
  console.log("release diff guard passed");
  return 0;
}

if(require.main === module){
  try{
    process.exitCode = main(process.argv.slice(2), process.env);
  }catch(error){
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

module.exports = {
  parseNumstat,
  parseNameStatus,
  mergeDiffEntries,
  evaluateDiff,
  diffArgs,
  readGitDiff,
  main,
  PROTECTED_SAFETY_FILES,
};
