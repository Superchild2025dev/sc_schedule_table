"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {buildRegularAvailability} = require("../functions/regular-availability");

function student(row, extra) {
  return Object.assign({
    n: `학생${row}`,
    p: `0100000000${row}`,
    t: "2시",
    d: "월",
    l: 1,
    r: row,
  }, extra || {});
}

function mondayTwo(result) {
  return result.days.mon.find(slot => slot.time === 14);
}

function calculate(overrides) {
  return buildRegularAvailability(Object.assign({
    basisDate: "2026-08-31",
    students: [],
    inst: {"2시/월/1": {n: "담임"}},
    retire: {},
    enroll: {},
    disabled: {},
  }, overrides || {}));
}

assert.equal(mondayTwo(calculate({
  students: [student(1), student(2), student(3), student(4)],
})).available, true, "four of five occupied must remain available");
assert.equal(mondayTwo(calculate({
  students: [student(1), student(2), student(3), student(4)],
})).availabilityLevel, "last", "one remaining seat must be marked as last");
assert.deepEqual(mondayTwo(calculate({
  students: [student(1), student(2), student(3), student(4)],
})).teachers, ["담임"], "an available regular class must expose only its teacher name");

assert.equal(mondayTwo(calculate()).availabilityLevel, "twoPlus",
  "two or more remaining seats must use the public two-plus band");

assert.equal(mondayTwo(calculate({
  students: [student(1), student(2), student(3), student(4), student(5)],
})).available, false, "five of five occupied must be full");
assert.equal(mondayTwo(calculate({
  students: [student(1), student(2), student(3), student(4), student(5)],
})).availabilityLevel, "none", "a full class must use the none band");

assert.equal(mondayTwo(calculate({
  students: [student(1), student(2), student(3), student(4), student(5)],
  retire: {"2시/월/1/5": {n: "학생5", p: "01000000005", ds: "2026-08-30"}},
})).available, true, "student ending before the basis date must not occupy a seat");

assert.equal(mondayTwo(calculate({
  students: [student(1), student(2), student(3), student(4), student(5)],
  retire: {"2시/월/1/5": {n: "학생5", p: "01000000005", ds: "2026-08-31"}},
})).available, false, "student ending on the basis date still attends that day");

assert.equal(mondayTwo(calculate({
  students: [student(1), student(2), student(3), student(4)],
  enroll: {"2시/월/1/5": {n: "신규", p: "01011112222", ds: "2026-09-01"}},
})).available, true, "future enrollment must not occupy the basis date");

assert.equal(mondayTwo(calculate({
  students: [student(1), student(2), student(3), student(4)],
  enroll: {"2시/월/1/5": {n: "신규", p: "01011112222", ds: "2026-08-31"}},
})).available, false, "enrollment starting on the basis date must occupy a seat");

assert.equal(mondayTwo(calculate({
  students: [
    student(1),
    student(2),
    student(3),
    student(4),
    student(5, {type: "sample"}),
  ],
})).available, true, "sample students must not occupy regular capacity");

assert.equal(mondayTwo(calculate({
  inst: {"2시/월/1": {n: "방특담임", bt: true}},
  students: [student(1)],
})).available, false, "bangteuk classes must not be advertised as regular seats");

assert.equal(mondayTwo(calculate({
  inst: {"2시/월/1": {n: "유아반담임", youth: true}},
  students: [student(1)],
})).available, false, "youth classes must not be advertised as regular seats");
assert.deepEqual(mondayTwo(calculate({
  inst: {"2시/월/1": {n: "유아반담임", youth: true}},
})).teachers, [], "youth teacher names must not be public");

assert.equal(mondayTwo(calculate({
  inst: {
    "2시/월/1": {n: "유아반담임", youth: true},
    "2시/월/2": {n: "정규반담임"},
  },
  students: [student(1)],
})).available, true, "regular capacity must remain visible when a youth class shares the same time");

assert.equal(mondayTwo(calculate({
  inst: {"2시/월/1": {n: "엘리트담임", cls: "elite"}},
  students: [1, 2, 3, 4, 5, 6, 7].map(row => student(row)),
})).available, false, "elite classes must not be advertised as regular seats");

assert.equal(mondayTwo(calculate({
  inst: {"2시/월/1": {n: "마스터즈담임", cls: "master"}},
  students: [],
})).available, false, "master classes must not be advertised as regular seats");

assert.equal(mondayTwo(calculate({
  inst: {"2시/월/1": {n: "엘마담임", elma: true}},
  students: [],
})).available, false, "legacy elite-master classes must not be advertised as regular seats");

assert.deepEqual(mondayTwo(calculate({
  inst: {
    "2시/월/1": {n: "공통담임"},
    "2시/월/2": {n: "공통담임"},
    "2시/월/3": {n: "만석담임"},
  },
  students: [1, 2, 3, 4, 5].map(row => student(row, {l: 3})),
})).teachers, ["공통담임"], "teacher names must be unique and full classes must stay hidden");

assert.equal(mondayTwo(calculate({
  students: [student(1), student(2), student(3), student(4)],
  disabled: {"2시/월/1/5": true},
})).available, false, "disabled rows must not count as public capacity");

const vacancyApp = fs.readFileSync(path.join(__dirname, "../regular-vacancy-site/app.js"), "utf8");
const vacancyPage = fs.readFileSync(path.join(__dirname, "../regular-vacancy-site/index.html"), "utf8");
const vacancyConfig = fs.readFileSync(path.join(__dirname, "../regular-vacancy-site/config.js"), "utf8");
const rules = fs.readFileSync(path.join(__dirname, "../firestore.rules"), "utf8");
assert.match(vacancyApp, /publicRegularAvailability/,
  "the public page must subscribe only to the public availability collection");
assert.match(vacancyApp, /\.onSnapshot\(/,
  "the public page must update through a Firestore realtime listener");
assert.match(vacancyApp, /if \(level === "last"\) return "마감 임박"/);
assert.match(vacancyApp, /if \(level === "twoPlus"\) return "등록 가능"/);
assert.match(vacancyApp, /return "불가"/);
assert.match(vacancyApp, /teachers\.join\(" · "\)/);
assert.match(vacancyApp, /aria-expanded/);
assert.match(vacancyApp, /선생님 이름 보기/);
assert.doesNotMatch(vacancyPage, /상담 신청|선택한 시간으로 상담/);
assert.match(vacancyPage, /id="naver-talk-link"/);
assert.match(vacancyPage, /id="phone-link"/);
assert.match(vacancyConfig, /https:\/\/talk\.naver\.com\/profile\/wdvor89/);
assert.match(vacancyConfig, /https:\/\/talk\.naver\.com\/profile\/w8swi5f/);
assert.match(vacancyConfig, /0437152019/);
assert.match(vacancyConfig, /0432882016/);
assert.match(rules,
  /match \/publicRegularAvailability\/\{branch\}[\s\S]*allow get: if branch in \["gagyeong", "yongam"\];[\s\S]*allow list: if false;[\s\S]*allow create, update, delete: if false;/,
  "only the two public summaries should be readable and neither should be browser-writable");

console.log("regular availability tests passed");
