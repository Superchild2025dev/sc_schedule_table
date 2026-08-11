"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const html = read(path.join("regular-vacancy-site", "index.html"));
const css = read(path.join("regular-vacancy-site", "styles.css"));
const app = read(path.join("regular-vacancy-site", "app.js"));
const nginx = read(path.join("deploy", "nginx", "schedule.conf"));
const parentHtml = read("parent.html");
const parentApp = read(path.join("js", "parent.js"));

const remoteScripts = [...html.matchAll(/<script\s+src="https:\/\/[^\"]+"[\s\S]*?<\/script>/g)];
assert.ok(remoteScripts.length >= 3, "the public page should expose every remote script to this test");
remoteScripts.forEach(match => {
  assert.match(match[0], /integrity="sha384-[A-Za-z0-9+/=]+"/, "remote scripts need SRI");
  assert.match(match[0], /crossorigin="anonymous"/, "remote scripts need anonymous CORS for SRI");
});

assert.match(html, /<meta name="referrer" content="strict-origin-when-cross-origin">/);
assert.match(nginx, /location \^~ \/regular-vacancy-site\//);
assert.match(nginx, /Content-Security-Policy/);
assert.match(nginx, /frame-ancestors 'none'/);
assert.match(nginx, /X-Frame-Options "DENY"/);
assert.match(nginx, /X-Content-Type-Options "nosniff"/);
assert.doesNotMatch(nginx, /unsafe-eval/);

assert.match(app, /detailNames\.textContent = teachers\.join/,
  "teacher names must be rendered as text, never HTML");
assert.doesNotMatch(app, /detailNames\.innerHTML/,
  "teacher names must not reach an HTML parser");

assert.match(html, /정규반 자리 안내/);
assert.match(html, /요일별 자리 현황/);
assert.match(html, /정규반 등록 가능 시간을 확인하세요\./);
const visibleText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
assert.match(visibleText, /본 페이지의 빈자리 현황은 참고용이며, 등록 및 반 이동 상황에 따라 변동될 수 있습니다\./);
assert.match(html, /정확한 등록 가능 여부는 해당 지점으로 문의해 주세요\./);
assert.match(html, /<strong>본 페이지의 빈자리 현황은 참고용이며,<\/strong>/);
assert.equal((html.match(/본 페이지의 빈자리 현황은 참고용이며/g) || []).length, 1);
assert.ok(html.indexOf('class="control-band"') < html.indexOf('class="availability-notice"'));
assert.ok(html.indexOf('class="availability-notice"') < html.indexOf('class="schedule-band"'));
assert.equal((html.match(/class="availability-notice"/g) || []).length, 1);
assert.doesNotMatch(html, /class="notice-band"/);
assert.doesNotMatch(css, /html\s*\{[^}]*min-width:\s*320px;/s);
assert.doesNotMatch(html, /2026년 9월 정규반 등록 가능 시간을 확인하세요/);
assert.doesNotMatch(html, /정규반 전환 안내|>등록 가능한 시간</);

assert.match(parentHtml, /js\/parent\.js/,
  "the parent page must keep loading its V1 parent application");
assert.doesNotMatch(parentHtml, /schedule-v2|schedule-operational-gateway|attendance-operational-gateway/i,
  "the parent page must not load staff-only V2 operational modules");
assert.doesNotMatch(parentApp, /schedule-v2|schedule-operational-gateway|attendance-operational-gateway/i,
  "the parent V1 application must not import staff-only V2 operational modules");

