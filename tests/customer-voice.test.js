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
const rules = read("firestore.rules");
const nginx = read(path.join("deploy", "nginx", "schedule.conf"));

assert.match(html, /^<!DOCTYPE html>/);
assert.match(html, /익명으로 편하게 남기기/);
assert.match(html, /회원 확인 후 답변받기/);
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
assert.match(app, /mode:reply\?'reply':'anonymous'/);

assert.match(functions, /async function submitCustomerVoice/);
assert.match(functions, /findParentStudentSet\(branch, studentName, phone\)/,
  "reply requests must verify a real member on the server");
assert.match(functions, /contact = \{studentName, phone\}/);
assert.match(functions, /if \(count >= 5\)/, "public submissions need an hourly server-side limit");
assert.match(functions, /lookupTokenHash: customerVoiceTokenHash\(lookupToken\)/);
assert.match(functions, /crypto\.timingSafeEqual/);
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
