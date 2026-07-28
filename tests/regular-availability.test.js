"use strict";

const assert = require("node:assert/strict");
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
  students: [student(1), student(2), student(3), student(4), student(5)],
})).available, false, "five of five occupied must be full");

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
  inst: {"2시/월/1": {n: "엘리트담임", cls: "elite"}},
  students: [1, 2, 3, 4, 5, 6, 7].map(row => student(row)),
})).available, true, "elite and master classes use their eight real rows");

assert.equal(mondayTwo(calculate({
  students: [student(1), student(2), student(3), student(4)],
  disabled: {"2시/월/1/5": true},
})).available, false, "disabled rows must not count as public capacity");

console.log("regular availability tests passed");
