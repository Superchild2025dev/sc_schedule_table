"use strict";

const crypto = require("node:crypto");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {setGlobalOptions} = require("firebase-functions/v2");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore, FieldValue, Timestamp} = require("firebase-admin/firestore");

initializeApp();
setGlobalOptions({region: "asia-northeast3", maxInstances: 20});

const db = getFirestore();
const CHUNK_THRESHOLD = 650000;
const CHUNK_SIZE = 600000;

const BRANCHES = {
  gagyeong: {id: "gagyeong", name: "가경점"},
  yongam: {id: "yongam", name: "용암점"},
};

const DEFAULT_PERIODS = [
  {month: 2, start: "2026-02-02", end: "2026-03-04"},
  {month: 3, start: "2026-03-05", end: "2026-04-01"},
  {month: 4, start: "2026-04-02", end: "2026-04-29"},
  {month: 5, start: "2026-05-06", end: "2026-06-02"},
  {month: 6, start: "2026-06-03", end: "2026-06-30"},
  {month: 7, start: "2026-07-06", end: "2026-08-01"},
  {month: 8, start: "2026-08-03", end: "2026-08-29"},
  {month: 9, start: "2026-08-31", end: "2026-10-02"},
  {month: 10, start: "2026-10-05", end: "2026-10-31"},
  {month: 11, start: "2026-11-02", end: "2026-11-28"},
  {month: 12, start: "2026-11-30", end: "2026-12-26"},
];

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function safeBranch(input) {
  const id = String(input || "").trim();
  if (!BRANCHES[id]) throw new HttpsError("invalid-argument", "지점 정보가 올바르지 않습니다");
  return BRANCHES[id];
}

function kvDoc(branch, key) {
  return db.collection("scheduleStores").doc(branch.id).collection("kv").doc(encodeURIComponent(key).replace(/\./g, "%2E"));
}

function chunkDoc(branch, key, index) {
  return kvDoc(branch, key).collection("chunks").doc(String(index).padStart(4, "0"));
}

function parseJSON(value, fallback) {
  if (!value) return clone(fallback);
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed === undefined || parsed === null ? clone(fallback) : parsed;
  } catch (error) {
    return clone(fallback);
  }
}

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function splitChunks(text) {
  const chunks = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE) chunks.push(text.slice(i, i + CHUNK_SIZE));
  return chunks.length ? chunks : [""];
}

function encodeStoredValue(value) {
  const isString = typeof value === "string";
  const text = isString ? value : JSON.stringify(value);
  return {
    isString,
    text: text === undefined ? "null" : text,
  };
}

async function readStoredValue(branch, key, tx) {
  const ref = kvDoc(branch, key);
  const snap = tx ? await tx.get(ref) : await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  if (!data.chunked) return data.value ?? null;
  const chunks = [];
  for (let i = 0; i < Number(data.chunkCount || 0); i++) {
    const chunkSnap = tx ? await tx.get(chunkDoc(branch, key, i)) : await chunkDoc(branch, key, i).get();
    chunks.push((chunkSnap.data() || {}).text || "");
  }
  const text = chunks.join("");
  if (data.valueType === "json") {
    try { return JSON.parse(text); } catch (error) { return null; }
  }
  return text;
}

function writeStoredValue(tx, branch, key, value) {
  const encoded = encodeStoredValue(value);
  if (encoded.text.length > CHUNK_THRESHOLD) {
    const chunks = splitChunks(encoded.text);
    tx.set(kvDoc(branch, key), {
      key,
      chunked: true,
      chunkCount: chunks.length,
      valueType: encoded.isString ? "string" : "json",
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: false});
    chunks.forEach((text, index) => {
      tx.set(chunkDoc(branch, key, index), {text}, {merge: false});
    });
    return;
  }
  tx.set(kvDoc(branch, key), {
    key,
    value,
    chunked: false,
    updatedAt: FieldValue.serverTimestamp(),
  }, {merge: false});
}

async function readJSON(branch, key, fallback) {
  return parseJSON(await readStoredValue(branch, key), fallback);
}

async function readBaseData(branch) {
  const [students, inst, mark, closed, periods, hyuwon, requests] = await Promise.all([
    readJSON(branch, "swim_students", []),
    readJSON(branch, "swim_inst", {}),
    readJSON(branch, "swim_mark", {}),
    readJSON(branch, "swim_closed", []),
    readJSON(branch, "swim_periods", null),
    readJSON(branch, "swim_hyuwon", {}),
    readJSON(branch, "swim_requests", {}),
  ]);
  return {
    students: Array.isArray(students) ? students : [],
    inst: inst || {},
    mark: mark || {},
    closed: Array.isArray(closed) ? closed : [],
    periods: Array.isArray(periods) && periods.length ? periods : clone(DEFAULT_PERIODS),
    hyuwon: hyuwon || {},
    requests: requests || {},
  };
}

function slotKeyOf(student) {
  return [student.t, student.d, student.l, student.r].join("/");
}

function instKeyOf(student) {
  return [student.t, student.d, student.l].join("/");
}

function getInstKind(inst) {
  if (!inst) return null;
  if (["elma", "elite", "master"].includes(inst.cls)) return inst.cls;
  if (inst.elma) return "elma";
  return null;
}

function isNoMakeupInst(inst) {
  const kind = getInstKind(inst);
  return kind === "elite" || kind === "master";
}

function instClassText(inst) {
  const labels = [];
  if (inst && inst.youth) labels.push("유아반");
  const kind = getInstKind(inst);
  if (kind === "elma") labels.push("엘/마반");
  if (kind === "elite") labels.push("엘리트반");
  if (kind === "master") labels.push("마스터반");
  return labels.join(" · ");
}

function todayString() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

function makeSessionId() {
  return crypto.randomBytes(24).toString("base64url");
}

function sessionRef(token) {
  return db.collection("parentSessions").doc(token);
}

async function createSession(branch, students) {
  const token = makeSessionId();
  const first = students[0];
  const expiresAt = Timestamp.fromMillis(Date.now() + 1000 * 60 * 60 * 12);
  await sessionRef(token).set({
    branch: branch.id,
    name: first.n || "",
    phone: normalizePhone(first.p),
    slotKeys: students.map(slotKeyOf),
    expiresAt,
    createdAt: FieldValue.serverTimestamp(),
  });
  return token;
}

async function loadSession(branch, token) {
  if (!token) throw new HttpsError("unauthenticated", "로그인이 필요합니다");
  const snap = await sessionRef(token).get();
  if (!snap.exists) throw new HttpsError("unauthenticated", "로그인이 만료되었습니다");
  const session = snap.data() || {};
  if (session.branch !== branch.id) throw new HttpsError("permission-denied", "지점 정보가 맞지 않습니다");
  if (session.expiresAt && session.expiresAt.toMillis() < Date.now()) {
    await sessionRef(token).delete();
    throw new HttpsError("unauthenticated", "로그인이 만료되었습니다");
  }
  return session;
}

function filterBundle(base, slotKeys) {
  const slotSet = new Set(slotKeys);
  const students = base.students.filter(s => slotSet.has(slotKeyOf(s)));
  const inst = {};
  students.forEach(s => {
    const key = instKeyOf(s);
    if (base.inst[key]) inst[key] = base.inst[key];
  });
  const mark = {};
  Object.entries(base.mark || {}).forEach(([key, value]) => {
    const slotKey = key.split("/").slice(0, 4).join("/");
    if (slotSet.has(slotKey)) mark[key] = value;
  });
  const hyuwon = {};
  Object.entries(base.hyuwon || {}).forEach(([key, value]) => {
    if (slotSet.has(key)) hyuwon[key] = value;
  });
  const requests = {};
  Object.entries(base.requests || {}).forEach(([id, req]) => {
    const p = req && req.parent || {};
    if (slotSet.has(p.studentSlotKey)) {
      requests[id] = req;
      if (req.instKey && base.inst[req.instKey]) inst[req.instKey] = base.inst[req.instKey];
    }
  });
  return {
    students,
    inst,
    mark,
    closed: base.closed,
    periods: base.periods,
    hyuwon,
    requests,
  };
}

async function bundleForSession(branch, session) {
  const base = await readBaseData(branch);
  return filterBundle(base, session.slotKeys || []);
}

function findSessionStudent(base, session, slotKey) {
  if (!session.slotKeys || !session.slotKeys.includes(slotKey)) {
    throw new HttpsError("permission-denied", "해당 학생 권한이 없습니다");
  }
  const student = base.students.find(s => slotKeyOf(s) === slotKey);
  if (!student) throw new HttpsError("not-found", "학생 정보를 찾을 수 없습니다");
  return student;
}

function makeReqId() {
  return "r_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

function parentBogangGroupKey(id, req) {
  if (req && req.choiceGroupId) return "group:" + req.choiceGroupId;
  const p = req && req.parent || {};
  const studentKey = p.studentSlotKey || [p.name || "", p.phone || ""].join("/");
  const sourceDs = p.absentDs || req && req.sourceDs || "";
  const requestedAt = req && req.requestedAt || "";
  if (studentKey && requestedAt) return `legacy:${studentKey}|${sourceDs}|${requestedAt}`;
  return "single:" + id;
}

function isClosedDate(closed, ds) {
  for (const entry of closed || []) {
    const start = entry.start;
    const end = entry.end || entry.start;
    if (ds >= start && ds <= end) return entry.type || "휴관";
  }
  return null;
}

function periodIndexForDate(periods, ds) {
  const idx = periods.findIndex(p => ds >= p.start && (!p.end || ds <= p.end));
  if (idx >= 0) return idx;
  const today = todayString();
  for (let i = periods.length - 1; i >= 0; i--) {
    if (today >= periods[i].start) return i;
  }
  return 0;
}

function bogangDateOptions(base, baseDs) {
  const periods = base.periods || DEFAULT_PERIODS;
  const baseIdx = periodIndexForDate(periods, baseDs);
  const visible = [periods[baseIdx], periods[baseIdx + 1]].filter(Boolean);
  const start = visible.length && visible[0].start > todayString() ? visible[0].start : todayString();
  const end = visible.length ? (visible[visible.length - 1].end || visible[visible.length - 1].start) : start;
  const dates = [];
  const current = new Date(start + "T12:00:00+09:00");
  const last = new Date(end + "T12:00:00+09:00");
  const dows = ["일", "월", "화", "수", "목", "금", "토"];
  while (current <= last) {
    const ds = current.toISOString().slice(0, 10);
    const dow = dows[current.getDay()];
    if (dow !== "일" && !isClosedDate(base.closed, ds)) {
      dates.push({ds, dow, m: current.getMonth() + 1, d: current.getDate()});
    }
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function slotMaxRows(inst) {
  return inst && (inst.elma || inst.cls === "elma" || inst.cls === "elite" || inst.cls === "master") ? 8 : 5;
}

function availableSlotsFor(base, session, sourceSlotKey, ds, teacherMode) {
  const source = findSessionStudent(base, session, sourceSlotKey);
  const sourceInst = base.inst[instKeyOf(source)];
  if (isNoMakeupInst(sourceInst)) throw new HttpsError("failed-precondition", "엘리트반/마스터반은 보강 신청이 불가합니다");

  const sourceTeacher = sourceInst && sourceInst.n || "";
  const date = new Date(ds + "T12:00:00+09:00");
  const day = ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
  const mySlots = new Set(session.slotKeys || []);
  const pendingOccupied = new Set();
  Object.values(base.requests || {}).forEach(req => {
    if (!req || req.type !== "bogang") return;
    if (req.status && req.status !== "pending") return;
    if (req.target && req.target.ds === ds) {
      pendingOccupied.add([req.target.t, req.target.d, req.target.l, req.target.r, ds].join("/"));
    }
  });

  const candidates = [];
  Object.entries(base.inst || {}).forEach(([instKey, inst]) => {
    const [t, d, l] = instKey.split("/");
    if (d !== day || !inst || !inst.n || isNoMakeupInst(inst)) return;
    if (sourceTeacher) {
      if (teacherMode !== "other" && inst.n !== sourceTeacher) return;
      if (teacherMode === "other" && inst.n === sourceTeacher) return;
    }
    const lane = Number(l);
    const maxRows = slotMaxRows(inst);
    for (let r = 1; r <= maxRows; r++) {
      const checkKey = [t, d, lane, r].join("/");
      if (mySlots.has(checkKey)) continue;
      if (base.students.find(s => s.t === t && s.d === d && Number(s.l) === lane && Number(s.r) === r)) continue;
      const mark = base.mark[[checkKey, ds].join("/")];
      if (mark && (mark.type === "bogang" || mark.type === "sample")) continue;
      if (mark && mark.type === "absent" && mark.sub) continue;
      if (pendingOccupied.has([checkKey, ds].join("/"))) continue;
      candidates.push({
        t, day: d, lane, row: r, ds,
        instName: inst.n,
        inst,
        classLabel: instClassText(inst),
      });
      break;
    }
  });
  candidates.sort((a, b) => Number(a.t) - Number(b.t) || Number(a.lane) - Number(b.lane));
  return candidates;
}

async function login(branch, data) {
  const name = String(data.name || "").trim();
  const phone = normalizePhone(data.phone);
  if (!name || !phone) throw new HttpsError("invalid-argument", "이름과 전화번호를 입력해주세요");
  const base = await readBaseData(branch);
  const students = base.students.filter(s => s.n === name && normalizePhone(s.p) === phone);
  if (!students.length) throw new HttpsError("not-found", "일치하는 정보가 없습니다");
  const token = await createSession(branch, students);
  const session = {slotKeys: students.map(slotKeyOf)};
  return {sessionToken: token, bundle: filterBundle(base, session.slotKeys), dates: bogangDateOptions(base, todayString())};
}

async function refresh(branch, data) {
  const session = await loadSession(branch, data.sessionToken);
  return {bundle: await bundleForSession(branch, session)};
}

async function submitAbsent(branch, data) {
  const session = await loadSession(branch, data.sessionToken);
  const slotKey = String(data.slotKey || "");
  const ds = String(data.ds || "");
  await db.runTransaction(async tx => {
    const base = {
      students: parseJSON(await readStoredValue(branch, "swim_students", tx), []),
      mark: parseJSON(await readStoredValue(branch, "swim_mark", tx), {}),
    };
    findSessionStudent(base, session, slotKey);
    const markKey = `${slotKey}/${ds}`;
    const current = base.mark[markKey];
    base.mark[markKey] = current && (current.type === "bogang" || current.type === "sample")
      ? {type: "absent", sub: current}
      : {type: "absent"};
    writeStoredValue(tx, branch, "swim_mark", JSON.stringify(base.mark));
  });
  return {bundle: await bundleForSession(branch, session)};
}

async function submitAbsentCancel(branch, data) {
  const session = await loadSession(branch, data.sessionToken);
  const slotKey = String(data.slotKey || "");
  const ds = String(data.ds || "");
  await db.runTransaction(async tx => {
    const students = parseJSON(await readStoredValue(branch, "swim_students", tx), []);
    const inst = parseJSON(await readStoredValue(branch, "swim_inst", tx), {});
    const requests = parseJSON(await readStoredValue(branch, "swim_requests", tx), {});
    const stu = findSessionStudent({students}, session, slotKey);
    const exists = Object.values(requests).some(req =>
      req && req.type === "absent-cancel" &&
      (!req.status || req.status === "pending") &&
      req.parent && req.parent.studentSlotKey === slotKey &&
      req.target && req.target.ds === ds
    );
    if (exists) throw new HttpsError("already-exists", "이미 취소 신청이 접수되었습니다");
    const teacher = inst[instKeyOf(stu)];
    requests[makeReqId()] = {
      type: "absent-cancel",
      status: "pending",
      parent: {studentSlotKey: slotKey, name: stu.n, age: stu.a || null, phone: stu.p || null},
      target: {
        t: stu.t, d: stu.d, l: stu.l, r: stu.r, ds,
        instName: teacher && teacher.n || "",
        classLabel: instClassText(teacher),
      },
      instKey: instKeyOf(stu),
      requestedAt: new Date().toISOString(),
    };
    writeStoredValue(tx, branch, "swim_requests", JSON.stringify(requests));
  });
  return {bundle: await bundleForSession(branch, session)};
}

async function getBogangSlots(branch, data) {
  const session = await loadSession(branch, data.sessionToken);
  const base = await readBaseData(branch);
  return {
    slots: availableSlotsFor(base, session, String(data.sourceSlotKey || ""), String(data.ds || ""), data.teacherMode === "other" ? "other" : "mine"),
    dates: bogangDateOptions(base, String(data.sourceDs || data.ds || todayString())),
    bundle: filterBundle(base, session.slotKeys || []),
  };
}

async function submitBogang(branch, data) {
  const session = await loadSession(branch, data.sessionToken);
  const sourceSlotKey = String(data.sourceSlotKey || "");
  const sourceDs = data.sourceDs || null;
  const selected = Array.isArray(data.slots) ? data.slots : [];
  if (!selected.length) throw new HttpsError("invalid-argument", "수업을 선택해주세요");
  await db.runTransaction(async tx => {
    const base = {
      students: parseJSON(await readStoredValue(branch, "swim_students", tx), []),
      inst: parseJSON(await readStoredValue(branch, "swim_inst", tx), {}),
      mark: parseJSON(await readStoredValue(branch, "swim_mark", tx), {}),
      closed: parseJSON(await readStoredValue(branch, "swim_closed", tx), []),
      periods: parseJSON(await readStoredValue(branch, "swim_periods", tx), DEFAULT_PERIODS),
      requests: parseJSON(await readStoredValue(branch, "swim_requests", tx), {}),
    };
    const source = findSessionStudent(base, session, sourceSlotKey);
    const sourceInst = base.inst[instKeyOf(source)];
    if (isNoMakeupInst(sourceInst)) throw new HttpsError("failed-precondition", "엘리트반/마스터반은 보강 신청이 불가합니다");
    const alreadyPending = Object.values(base.requests || {}).some(req =>
      req && req.type === "bogang" &&
      (!req.status || req.status === "pending") &&
      req.parent && req.parent.studentSlotKey === sourceSlotKey &&
      req.parent.absentDs === sourceDs
    );
    if (alreadyPending) throw new HttpsError("already-exists", "이미 이 결석일에 대한 보강 신청이 접수되었습니다");
    const choiceGroupId = "bg_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    const now = new Date().toISOString();
    const seen = new Set();
    selected.forEach(slot => {
      const ds = String(slot.ds || "");
      const available = availableSlotsFor(base, session, sourceSlotKey, ds, slot.teacherMode === "other" ? "other" : "mine");
      const wantedKey = [slot.t, slot.day || slot.d, Number(slot.lane || slot.l), Number(slot.row || slot.r), ds].join("/");
      const found = available.find(candidate => [candidate.t, candidate.day, candidate.lane, candidate.row, candidate.ds].join("/") === wantedKey);
      if (!found) throw new HttpsError("failed-precondition", "선택한 보강 자리가 더 이상 가능하지 않습니다");
      if (seen.has(wantedKey)) throw new HttpsError("already-exists", "같은 보강 자리가 중복 선택되었습니다");
      seen.add(wantedKey);
      base.requests[makeReqId()] = {
        type: "bogang",
        status: "pending",
        parent: {
          studentSlotKey: sourceSlotKey,
          name: source.n,
          age: source.a || null,
          phone: source.p || null,
          absentDs: sourceDs,
          sourceInstKey: instKeyOf(source),
          sourceInstName: sourceInst && sourceInst.n || "",
          sourceClassLabel: instClassText(sourceInst),
        },
        choiceGroupId,
        choiceCount: selected.length,
        target: {
          t: found.t, d: found.day, l: found.lane, r: found.row,
          ds: found.ds, instName: found.instName, classLabel: found.classLabel || "",
        },
        instKey: [found.t, found.day, found.lane].join("/"),
        requestedAt: now,
      };
    });
    writeStoredValue(tx, branch, "swim_requests", JSON.stringify(base.requests));
  });
  return {bundle: await bundleForSession(branch, session)};
}

exports.parentPortal = onCall(async request => {
  const data = request.data || {};
  const branch = safeBranch(data.branch);
  const action = String(data.action || "");
  if (action === "login") return login(branch, data);
  if (action === "refresh") return refresh(branch, data);
  if (action === "submitAbsent") return submitAbsent(branch, data);
  if (action === "submitAbsentCancel") return submitAbsentCancel(branch, data);
  if (action === "getBogangSlots") return getBogangSlots(branch, data);
  if (action === "submitBogang") return submitBogang(branch, data);
  throw new HttpsError("invalid-argument", "지원하지 않는 요청입니다");
});
