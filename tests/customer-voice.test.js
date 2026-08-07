"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const html = read(path.join("voice", "index.html"));
const app = read(path.join("voice", "voice.js"));
const functions = read(path.join("functions", "index.js"));
const submitCustomerVoiceSource = functions.slice(
  functions.indexOf("async function submitCustomerVoice"),
  functions.indexOf("function kvDoc")
);
const customerVoiceCallableSource = functions.slice(
  functions.indexOf("exports.customerVoice = onCall"),
  functions.indexOf("exports.purgeCustomerVoiceContacts")
);
const customerVoiceContract = submitCustomerVoiceSource + customerVoiceCallableSource;
const rules = read("firestore.rules");
const nginx = read(path.join("deploy", "nginx", "schedule.conf"));

assert.match(html, /^<!DOCTYPE html>/);
assert.match(html, /익명 의견 접수/);
assert.match(html, /답변이 필요한 의견 접수/);
assert.match(html, /개인정보 수집·이용 안내/);
assert.match(html, /처리 완료 후 90일 이내 파기/);

const remoteScripts = [...html.matchAll(/<script\s+src="https:\/\/[^\"]+"[\s\S]*?<\/script>/g)];
assert.equal(remoteScripts.length, 2, "only the two pinned Firebase scripts should be remote");
remoteScripts.forEach(match => {
  assert.match(match[0], /integrity="sha384-[A-Za-z0-9+/=]+"/);
  assert.match(match[0], /crossorigin="anonymous"/);
});

assert.match(app, /httpsCallable\('customerVoice'\)/);
assert.doesNotMatch(app, /\.firestore\s*\(/, "the public page must not access Firestore directly");
assert.doesNotMatch(app, /\.database\s*\(/, "the public page must not access Realtime Database directly");
assert.doesNotMatch(app, /localStorage|sessionStorage/, "public tickets must not leave lookup credentials in the browser");
assert.doesNotMatch(html, /처리 상태 확인|최근 접수 상태/,
  "the public page should finish after submission instead of exposing ticket lookup");
assert.match(app, /mode:reply\?'reply':'anonymous'/);

assert.match(functions, /async function submitCustomerVoice/);
assert.match(functions, /findParentStudentSet\(branch, studentName, phone\)/,
  "reply requests must verify a real member on the server");
assert.match(functions, /contact = \{studentName, phone\}/);
assert.match(functions, /if \(count >= 5\)/, "public submissions need an hourly server-side limit");
assert.match(submitCustomerVoiceSource, /async function submitCustomerVoice/);
assert.match(customerVoiceCallableSource, /exports\.customerVoice = onCall/);
assert.doesNotMatch(customerVoiceContract, /lookupToken|action === "status"/,
  "public ticket lookup credentials and status actions must not be issued");
assert.match(functions, /exports\.purgeCustomerVoiceContacts = onSchedule/,
  "reply contact details need an automatic retention cleanup");

assert.match(rules, /match \/customerVoice\/\{branch\}\/tickets\/\{ticketId\}/);
assert.match(rules, /allow read, update: if canManageSchedule\(branch\)/);
assert.match(rules, /allow create, delete: if false/);
assert.match(rules, /match \/customerVoiceRateLimits\/\{document=\*\*\}[\s\S]*?allow read, write: if false/);

assert.match(nginx, /location \^~ \/voice\//);
assert.match(nginx, /Content-Security-Policy/);
assert.match(nginx, /frame-ancestors 'none'/);
assert.match(nginx, /Cache-Control "no-cache, no-store, must-revalidate"/);
