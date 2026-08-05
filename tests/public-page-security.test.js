"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const html = read(path.join("regular-vacancy-site", "index.html"));
const app = read(path.join("regular-vacancy-site", "app.js"));
const nginx = read(path.join("deploy", "nginx", "schedule.conf"));

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

