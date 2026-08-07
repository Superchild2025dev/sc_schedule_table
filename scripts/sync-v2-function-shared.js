"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const FILES = ["schedule-time.js", "schedule-schema-v2.js"];
const mode = process.argv.includes("--write") ? "write" : "check";

for(const name of FILES){
  const source = fs.readFileSync(path.join(ROOT, "js", name), "utf8");
  const target = path.join(ROOT, "functions", "shared", name);
  if(mode === "write") fs.writeFileSync(target, source, "utf8");
  else if(!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== source) process.exitCode = 1;
}
