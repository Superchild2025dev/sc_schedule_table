"use strict";

const path = require("node:path");
const {spawnSync} = require("node:child_process");

const SMOKE_TEST = [
  "",
  "배포 후 강사 출석 스모크 테스트",
  "1. 강사 계정으로 담당 지점 시간표에 로그인합니다.",
  "2. 정규 출석 한 명을 체크하고 저장 오류나 빨간 연결 배너가 없는지 확인합니다.",
  "3. 방특 출석 한 명을 체크하고 일괄 선택도 한 번 저장합니다.",
  "4. 다른 브라우저 또는 기기에서 두 출석 결과가 동기화됐는지 확인합니다.",
  "5. 강사 계정으로 원생 자리 편집이 차단되는지 확인합니다.",
  "",
  "웹 반영 순서",
  "1. 로컬 변경을 커밋하고 GitHub main에 푸시합니다.",
  "2. Lightsail의 /var/www/schedule에서 git pull origin main을 실행합니다.",
  "3. nginx 설정을 바꾸지 않았다면 reload는 필수가 아닙니다.",
  "",
].join("\n");

function parseReleaseArgs(argv){
  const production = argv.includes("--production");
  const dryRun = argv.includes("--dry-run");
  if(production === dryRun){
    throw new Error("--production 또는 --dry-run 중 하나만 지정해주세요.");
  }
  return {production, dryRun};
}

function firebaseExecutable(root, platform){
  const name = platform === "win32" ? "firebase.cmd" : "firebase";
  return path.join(root, "tools", "firebase-test", "node_modules", ".bin", name);
}

function quoteWindowsArg(value){
  const text = String(value);
  if(!/[\s"&|<>^]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function windowsShimStep(comSpec, executable, args){
  const commandLine = [executable, ...args].map(quoteWindowsArg).join(" ");
  return {command:comSpec, args:["/d", "/s", "/c", commandLine]};
}

function buildReleaseSteps(options){
  const windows = options.platform === "win32";
  const npm = windows ? "npm.cmd" : "npm";
  const comSpec = options.comSpec || process.env.ComSpec || "cmd.exe";
  const verifyStep = windows
    ? windowsShimStep(comSpec, npm, ["run", "verify"])
    : {command:npm, args:["run", "verify"]};
  const steps = [
    {command:"node", args:["scripts/check-release-diff.js", "--range", "HEAD^..HEAD"]},
    verifyStep,
  ];
  if(options.production){
    const firebase = firebaseExecutable(options.root, options.platform);
    const args = [
        "deploy",
        "--only", "firestore:rules",
        "--project", "scswimming-schedule",
        "--non-interactive",
    ];
    steps.push(windows
      ? windowsShimStep(comSpec, firebase, args)
      : {command:firebase, args});
  }
  return steps;
}

function runStep(step, root){
  const result = spawnSync(step.command, step.args, {
    cwd:root,
    stdio:"inherit",
    shell:false,
  });
  if(result.error) throw result.error;
  if(result.status !== 0){
    throw new Error(`${step.command} failed with exit code ${result.status}`);
  }
}

function trackedWorktreeIsClean(root){
  const result = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], {
    cwd:root,
    encoding:"utf8",
    shell:false,
  });
  if(result.error) throw result.error;
  if(result.status !== 0) throw new Error("Git 작업 상태를 확인하지 못했습니다.");
  return !String(result.stdout || "").trim();
}

async function release(options){
  options = options || {};
  const root = options.root || path.join(__dirname, "..");
  const platform = options.platform || process.platform;
  const production = !!options.production;
  const dryRun = !!options.dryRun;
  if(production === dryRun){
    throw new Error("--production 또는 --dry-run 중 하나만 지정해주세요.");
  }
  const runner = options.runner || (step=>runStep(step, root));
  const write = options.write || (text=>process.stdout.write(text));
  const isClean = options.isClean || (()=>trackedWorktreeIsClean(root));

  if(production && !(await isClean())){
    throw new Error("커밋되지 않은 변경이 있습니다. 커밋 후 운영 규칙을 배포해주세요.");
  }

  for(const step of buildReleaseSteps({root, platform, production, comSpec:options.comSpec})){
    await runner(step);
  }

  write(production
    ? "\nFirestore 규칙 배포가 완료되었습니다.\n"
    : "\n검증만 완료했으며 운영 규칙은 배포하지 않았습니다.\n");
  write(SMOKE_TEST);
}

if(require.main === module){
  let args;
  try{
    args = parseReleaseArgs(process.argv.slice(2));
  }catch(error){
    console.error(error.message || error);
    process.exitCode = 1;
  }
  if(args){
    release(args).catch(error=>{
      console.error(error.message || error);
      process.exitCode = 1;
    });
  }
}

module.exports = {
  SMOKE_TEST,
  parseReleaseArgs,
  firebaseExecutable,
  quoteWindowsArg,
  windowsShimStep,
  buildReleaseSteps,
  trackedWorktreeIsClean,
  release,
};
