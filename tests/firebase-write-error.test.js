"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function sourceBetween(source, startName, endName){
  const start = source.indexOf(`function ${startName}`);
  const end = source.indexOf(`function ${endName}`, start);
  assert.notEqual(start, -1, `${startName} is missing`);
  assert.notEqual(end, -1, `${endName} is missing`);
  return source.slice(start, end);
}

const root = path.join(__dirname, "..");
const coreSource = fs.readFileSync(path.join(root, "js", "core.js"), "utf8");
const dataSource = fs.readFileSync(path.join(root, "js", "data.js"), "utf8");

function makeContext(online=true){
  const messages = [];
  const context = {
    navigator:{onLine:online},
    _firebaseWriteWarnedAt:0,
    offlineWarnings:0,
    messages,
    _showOfflineWarning:null,
    toast(message){ messages.push(message); },
    console:{warn(){}},
  };
  context._showOfflineWarning = () => { context.offlineWarnings++; };
  vm.createContext(context);
  vm.runInContext(
    sourceBetween(coreSource, "_firebaseErrorCode", "_showOfflineWarning"),
    context
  );
  return context;
}

test("permission errors show a permission message without an offline banner", () => {
  const context = makeContext();

  context._reportFirebaseWriteFailure({code:"permission-denied"}, "attendance");

  assert.equal(context.offlineWarnings, 0);
  assert.equal(context.messages.length, 1);
  assert.match(context.messages[0], /저장 권한/);
});

test("failed preconditions request a refresh without an offline banner", () => {
  const context = makeContext();

  context._reportFirebaseWriteFailure({code:"failed-precondition"}, "audit-index");

  assert.equal(context.offlineWarnings, 0);
  assert.equal(context.messages.length, 1);
  assert.match(context.messages[0], /저장 조건 오류/);
});

test("resource exhaustion reports a data-size problem", () => {
  const context = makeContext();

  context._reportFirebaseWriteFailure({code:"resource-exhausted"}, "audit-entry");

  assert.equal(context.offlineWarnings, 0);
  assert.equal(context.messages.length, 1);
  assert.match(context.messages[0], /용량 제한/);
});

test("unavailable errors still display the connection warning", () => {
  const context = makeContext();

  context._reportFirebaseWriteFailure({code:"unavailable"}, "schedule");

  assert.equal(context.offlineWarnings, 1);
  assert.equal(context.messages.length, 0);
});

test("an offline browser displays the connection warning regardless of error code", () => {
  const context = makeContext(false);

  context._reportFirebaseWriteFailure({code:"permission-denied"}, "attendance");

  assert.equal(context.offlineWarnings, 1);
  assert.equal(context.messages.length, 0);
});

test("record persistence routes failures through the shared classifier", () => {
  assert.match(dataSource,
    /원생 삭제 안전기록 저장 실패:[\s\S]*?_reportFirebaseWriteFailure\(err,'원생 삭제 안전기록'\)/);
  assert.match(dataSource,
    /개별 기록 저장 실패:[\s\S]*?_reportFirebaseWriteFailure\(err,'개별 기록'\)/);
});
