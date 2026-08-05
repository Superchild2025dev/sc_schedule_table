"use strict";

const DAY_DEFS = Object.freeze([
  {id: "mon", day: "월", hours: [14, 15, 16, 17, 18, 19, 20]},
  {id: "tue", day: "화", hours: [14, 15, 16, 17, 18, 19, 20]},
  {id: "wed", day: "수", hours: [14, 15, 16, 17, 18, 19, 20]},
  {id: "thu", day: "목", hours: [14, 15, 16, 17, 18, 19, 20]},
  {id: "fri", day: "금", hours: [14, 15, 16, 17, 18, 19, 20]},
  {id: "sat", day: "토", hours: [9, 10, 11, 12, 13, 14]},
]);

const SAT_DISPLAY_TO_INTERNAL = Object.freeze({
  9: "1시",
  10: "2시",
  11: "3시",
  12: "4시",
  13: "5시",
  14: "6시",
});

function internalTime(day, hour) {
  if (day === "토") return SAT_DISPLAY_TO_INTERNAL[hour] || "";
  const displayHour = hour > 12 ? hour - 12 : hour;
  return `${displayHour}시`;
}

function instExists(inst) {
  if (!inst) return false;
  if (typeof inst === "string") return !!inst.trim();
  return !!String(inst.n || inst.name || "").trim();
}

function isBangteukInst(inst) {
  return !!(inst && typeof inst === "object" && (
    inst.bt ||
    inst.bangteuk ||
    inst.btGroup ||
    inst.btTabId ||
    inst.cls === "bt" ||
    inst.cls === "bangteuk"
  ));
}

function isYouthInst(inst) {
  return !!(inst && typeof inst === "object" && inst.youth);
}

function isElmaLikeInst(inst) {
  return !!(inst && typeof inst === "object" && (
    inst.elma ||
    inst.cls === "elma" ||
    inst.cls === "elite" ||
    inst.cls === "master"
  ));
}

function isTemporaryOnly(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.bogangOnly || entry.makeupOnly || entry.sampleOnly) return true;
  const kind = String(entry.type || entry.kind || entry.status || "").trim().toLowerCase();
  return ["bogang", "makeup", "보강", "sample", "샘플"].includes(kind);
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function personOf(entry) {
  const source = entry && typeof entry === "object" ? entry : {};
  return {
    name: String(source.n || source.name || "").trim(),
    phone: normalizePhone(source.p || source.phone || source.tel || ""),
  };
}

function entryMatchesStudent(entry, student) {
  if (!entry) return false;
  if (typeof entry === "string") return true;
  const entryPerson = personOf(entry);
  const studentPerson = personOf(student);
  if (entryPerson.name && studentPerson.name && entryPerson.name !== studentPerson.name) return false;
  if (entryPerson.phone && studentPerson.phone && entryPerson.phone !== studentPerson.phone) return false;
  if (!entryPerson.name && !entryPerson.phone) return true;
  return !!(entryPerson.name || entryPerson.phone);
}

function dateOf(entry) {
  if (typeof entry === "string") return entry.slice(0, 10);
  if (!entry || typeof entry !== "object") return "";
  return String(entry.ds || entry.date || entry.startDate || entry.endDate || "").slice(0, 10);
}

function startsBy(entry, basisDate) {
  if (!entry || isTemporaryOnly(entry)) return false;
  const date = dateOf(entry);
  // Missing dates are counted conservatively so the public page never
  // advertises a seat that may already be reserved.
  return !date || date <= basisDate;
}

function remainsThrough(entry, basisDate) {
  if (!entry) return true;
  const date = dateOf(entry);
  // "~until" students attend on the end date itself.
  return !date || date >= basisDate;
}

function slotKey(student) {
  return [student && student.t, student && student.d, student && student.l, student && student.r]
    .map(value => String(value || ""))
    .join("/");
}

function activeBaseStudent(student, retireEntry, enrollEntry, basisDate) {
  if (!student || !student.n || isTemporaryOnly(student)) return false;
  if (enrollEntry && entryMatchesStudent(enrollEntry, student)) {
    return startsBy(enrollEntry, basisDate);
  }
  if (retireEntry && entryMatchesStudent(retireEntry, student)) {
    return remainsThrough(retireEntry, basisDate);
  }
  return true;
}

function buildRegularAvailability(input) {
  const data = input || {};
  const basisDate = String(data.basisDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(basisDate)) {
    throw new Error("basisDate must use YYYY-MM-DD");
  }

  const students = Array.isArray(data.students) ? data.students : [];
  const instMap = data.inst && typeof data.inst === "object" ? data.inst : {};
  const retireMap = data.retire && typeof data.retire === "object" ? data.retire : {};
  const enrollMap = data.enroll && typeof data.enroll === "object" ? data.enroll : {};
  const disabledMap = data.disabled && typeof data.disabled === "object" ? data.disabled : {};
  const studentsBySlot = new Map();

  students.forEach(student => {
    if (!student || !student.n || isTemporaryOnly(student)) return;
    const key = slotKey(student);
    if (!studentsBySlot.has(key)) studentsBySlot.set(key, student);
  });

  const days = {};
  DAY_DEFS.forEach(def => {
    days[def.id] = def.hours.map(hour => {
      const time = internalTime(def.day, hour);
      let capacity = 0;
      let occupied = 0;
      const availableTeachers = new Set();

      for (let lane = 1; lane <= 5; lane++) {
        const instKey = `${time}/${def.day}/${lane}`;
        const inst = instMap[instKey];
        if (!instExists(inst) || isBangteukInst(inst) || isYouthInst(inst) || isElmaLikeInst(inst)) continue;

        const rows = 5;
        let laneCapacity = 0;
        let laneOccupied = 0;
        for (let row = 1; row <= rows; row++) {
          const key = `${instKey}/${row}`;
          if (disabledMap[key]) continue;
          capacity++;
          laneCapacity++;

          const baseStudent = studentsBySlot.get(key);
          const retireEntry = retireMap[key];
          const enrollEntry = enrollMap[key];
          const baseActive = activeBaseStudent(baseStudent, retireEntry, enrollEntry, basisDate);
          const enrollActive = startsBy(enrollEntry, basisDate);
          if (baseActive || enrollActive) {
            occupied++;
            laneOccupied++;
          }
        }
        if (laneCapacity > laneOccupied) {
          const teacherName = typeof inst === "string" ? inst.trim() : String(inst.n || inst.name || "").trim();
          if (teacherName) availableTeachers.add(teacherName);
        }
      }

      const remaining = Math.max(0, capacity - occupied);
      return {
        time: hour,
        available: remaining > 0,
        availabilityLevel: remaining === 0 ? "none" : (remaining === 1 ? "last" : "twoPlus"),
        teachers: Array.from(availableTeachers),
      };
    });
  });

  return {basisDate, days};
}

module.exports = {
  DAY_DEFS,
  buildRegularAvailability,
  entryMatchesStudent,
  internalTime,
  isTemporaryOnly,
  isYouthInst,
};
