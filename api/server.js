const crypto = require("crypto");
const express = require("express");
const admin = require("firebase-admin");

const PORT = Number(process.env.PORT || 3001);
const DATABASE_URL = process.env.FIREBASE_DATABASE_URL ||
  "https://scswimming-schedule-default-rtdb.asia-southeast1.firebasedatabase.app";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function initFirebaseAdmin() {
  if (admin.apps.length) return;
  let credential = admin.credential.applicationDefault();
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON));
  }
  admin.initializeApp({ credential, databaseURL: DATABASE_URL });
}

initFirebaseAdmin();
const db = admin.database();

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function apiError(code, message) {
  const statusByCode = {
    "invalid-argument": 400,
    unauthenticated: 401,
    "permission-denied": 403,
    "not-found": 404,
    "failed-precondition": 409,
    "resource-exhausted": 429,
  };
  return new ApiError(statusByCode[code] || 500, code, message);
}

function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
}

function parseJSON(value, fallback) {
  if (!value) return fallback;
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch (e) {
    return fallback;
  }
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function branchPath(branch) {
  if (branch === "gagyeong") return "schedule";
  if (branch === "yongam") return "schedule_yongam";
  throw apiError("invalid-argument", "지점을 확인할 수 없습니다");
}

function slotKeyOf(student) {
  return [student.t, student.d, student.l, student.r].join("/");
}

function instKeyOf(student) {
  return [student.t, student.d, student.l].join("/");
}

function instKind(inst) {
  if (!inst) return null;
  if (inst.cls === "elma" || inst.cls === "elite" || inst.cls === "master") return inst.cls;
  if (inst.elma) return "elma";
  return null;
}

function isNoMakeupInst(inst) {
  const kind = instKind(inst);
  return kind === "elite" || kind === "master";
}

function instClassTags(inst) {
  const tags = [];
  if (inst && inst.youth) tags.push("유아반");
  const kind = instKind(inst);
  if (kind === "elma") tags.push("엘/마반");
  else if (kind === "elite") tags.push("엘리트반");
  else if (kind === "master") tags.push("마스터반");
  return tags;
}

function instClassText(inst) {
  return instClassTags(inst).join(" · ");
}

function publicInst(inst) {
  if (!inst) return null;
  return {
    n: inst.n || "",
    youth: !!inst.youth,
    elma: !!inst.elma,
    cls: inst.cls || null,
  };
}

function todayStr() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const kst = new Date(utc + 9 * 60 * 60000);
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, "0");
  const d = String(kst.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isClosedDate(closedList, ds) {
  for (const entry of closedList || []) {
    const start = entry.start;
    const end = entry.end || entry.start;
    if (ds >= start && ds <= end) return entry.type || "휴관";
  }
  return null;
}

function sessionHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function normalizeDbKey(key) {
  return String(key || "").replace(/[.#$/\[\]]/g, "_");
}

function stableStringify(value) {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  return "{" + Object.keys(value).sort().map((key) =>
    JSON.stringify(key) + ":" + stableStringify(value[key])
  ).join(",") + "}";
}

function rawEqual(a, b) {
  return stableStringify(a === undefined ? null : a) === stableStringify(b === undefined ? null : b);
}

const ALL_BRANCHES = ["gagyeong", "yongam"];
const rateBuckets = new Map();
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 40;

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "");
  return (forwarded.split(",")[0] || req.socket.remoteAddress || "unknown").trim();
}

function assertLoginRate(req) {
  const key = "parent-login:" + clientIp(req);
  const now = Date.now();
  const bucket = rateBuckets.get(key) || { count: 0, resetAt: now + LOGIN_WINDOW_MS };
  if (bucket.resetAt < now) {
    bucket.count = 0;
    bucket.resetAt = now + LOGIN_WINDOW_MS;
  }
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  if (bucket.count > LOGIN_MAX_ATTEMPTS) {
    throw apiError("resource-exhausted", "로그인 시도가 많습니다. 잠시 후 다시 시도해주세요");
  }
}

const DEFAULT_PERIODS = [
  { month: 2, start: "2026-02-02", end: "2026-03-04" },
  { month: 3, start: "2026-03-05", end: "2026-04-01" },
  { month: 4, start: "2026-04-02", end: "2026-04-29" },
  { month: 5, start: "2026-05-06", end: "2026-06-02" },
  { month: 6, start: "2026-06-03", end: "2026-06-30" },
  { month: 7, start: "2026-07-06", end: "2026-08-01" },
  { month: 8, start: "2026-08-03", end: "2026-08-29" },
  { month: 9, start: "2026-08-31", end: "2026-10-02" },
  { month: 10, start: "2026-10-05", end: "2026-10-31" },
  { month: 11, start: "2026-11-02", end: "2026-11-28" },
  { month: 12, start: "2026-11-30", end: "2026-12-26" },
];

function superAdminEmail() {
  return String(process.env.SUPER_ADMIN_EMAIL || "").trim().toLowerCase();
}

function normalizeAdminProfile(uid, email, raw = {}) {
  const branches = Array.isArray(raw.branches)
    ? raw.branches.filter((branch) => ALL_BRANCHES.includes(branch))
    : [];
  return {
    uid,
    email: String(raw.email || email || "").toLowerCase(),
    name: raw.name || "",
    role: "admin",
    superAdmin: !!raw.superAdmin,
    allBranches: !!raw.allBranches,
    branches,
    active: raw.active !== false,
  };
}

function canUseBranch(profile, branch) {
  if (profile.superAdmin || profile.allBranches) return true;
  return (profile.branches || []).includes(branch);
}

function publicAdminProfile(profile) {
  return {
    uid: profile.uid,
    email: profile.email,
    name: profile.name,
    role: profile.role,
    superAdmin: !!profile.superAdmin,
    allBranches: !!profile.allBranches,
    branches: profile.branches || [],
  };
}

async function verifyFirebaseAuth(req, res, next) {
  try {
    const header = String(req.headers.authorization || "");
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) throw apiError("unauthenticated", "관리자 로그인이 필요합니다");
    req.auth = await admin.auth().verifyIdToken(match[1]);
    next();
  } catch (e) {
    next(e.code ? e : apiError("unauthenticated", "관리자 로그인이 필요합니다"));
  }
}

async function requireAdminSession(data, auth) {
  const branch = data.branch;
  branchPath(branch);
  if (!auth || !auth.uid) throw apiError("unauthenticated", "관리자 로그인이 필요합니다");

  const email = String(auth.email || "").toLowerCase();
  const bootstrapEmail = superAdminEmail();
  if (bootstrapEmail && email === bootstrapEmail) {
    return normalizeAdminProfile(auth.uid, email, {
      email,
      name: auth.name || "최고관리자",
      superAdmin: true,
      allBranches: true,
      active: true,
      branches: ALL_BRANCHES,
    });
  }

  const snap = await db.ref("_admin_users/" + auth.uid).once("value");
  const raw = snap.val();
  if (!raw || raw.active === false) throw apiError("permission-denied", "관리자 권한이 없습니다");
  const profile = normalizeAdminProfile(auth.uid, email, raw);
  if (!canUseBranch(profile, branch)) {
    throw apiError("permission-denied", "이 지점에 접근할 수 없습니다");
  }
  return profile;
}

function assertStaffCanWrite(session) {
  if (session.role === "admin") return;
  throw apiError("permission-denied", "이 데이터는 수정할 수 없습니다");
}

async function loadBranchData(branch) {
  const path = branchPath(branch);
  const snap = await db.ref(path).once("value");
  const data = snap.val() || {};
  const parsedPeriods = parseJSON(data.swim_periods, null);
  return {
    path,
    students: parseJSON(data.swim_students, []),
    inst: parseJSON(data.swim_inst, {}),
    mark: parseJSON(data.swim_mark, {}),
    closed: parseJSON(data.swim_closed, []),
    periods: parsedPeriods && Array.isArray(parsedPeriods) && parsedPeriods.length
      ? parsedPeriods
      : JSON.parse(JSON.stringify(DEFAULT_PERIODS)),
    hyuwon: parseJSON(data.swim_hyuwon, {}),
    requests: parseJSON(data.swim_requests, {}),
  };
}

async function createSession(branch, students) {
  const token = crypto.randomBytes(32).toString("base64url");
  const first = students[0] || {};
  await db.ref("_parent_sessions/" + sessionHash(token)).set({
    branch,
    name: first.n || "",
    phone: normalizePhone(first.p),
    studentKeys: students.map(slotKeyOf),
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return token;
}

async function requireSession(data) {
  const branch = data.branch;
  const token = data.token;
  if (!token) throw apiError("unauthenticated", "로그인이 필요합니다");
  const snap = await db.ref("_parent_sessions/" + sessionHash(token)).once("value");
  const session = snap.val();
  if (!session || session.branch !== branch || session.expiresAt < Date.now()) {
    throw apiError("unauthenticated", "로그인이 만료되었습니다");
  }
  return session;
}

function sessionStudents(allStudents, session) {
  const keys = new Set(session.studentKeys || []);
  let students = allStudents.filter((s) => keys.has(slotKeyOf(s)));
  if (!students.length && session.name && session.phone) {
    students = allStudents.filter((s) => s.n === session.name && normalizePhone(s.p) === session.phone);
  }
  if (!students.length) throw apiError("not-found", "학생 정보를 찾을 수 없습니다");
  return students;
}

function sanitizeStudent(student) {
  return {
    n: student.n || "",
    a: student.a || null,
    t: student.t,
    d: student.d,
    l: student.l,
    r: student.r,
  };
}

function sanitizeMark(mark) {
  if (!mark) return null;
  if (mark.type === "absent") {
    return {
      type: "absent",
      sub: mark.sub ? { type: mark.sub.type || "bogang" } : null,
    };
  }
  if (mark.type === "bogang" || mark.type === "sample") {
    return { type: mark.type };
  }
  return { type: mark.type || "" };
}

function sanitizeRequest(req) {
  const parent = req.parent || {};
  const target = req.target || {};
  return {
    type: req.type,
    status: req.status || "pending",
    choiceGroupId: req.choiceGroupId || null,
    choiceCount: req.choiceCount || null,
    requestedAt: req.requestedAt || "",
    processedAt: req.processedAt || "",
    instKey: req.instKey || "",
    parent: {
      studentSlotKey: parent.studentSlotKey || "",
      name: parent.name || "",
      age: parent.age || null,
      absentDs: parent.absentDs || null,
      sourceInstKey: parent.sourceInstKey || "",
      sourceInstName: parent.sourceInstName || "",
      sourceClassLabel: parent.sourceClassLabel || "",
    },
    target: {
      t: target.t || "",
      d: target.d || "",
      l: target.l || "",
      r: target.r || "",
      ds: target.ds || "",
      instName: target.instName || "",
      classLabel: target.classLabel || "",
    },
  };
}

function buildParentPayload(branchData, students) {
  const studentKeys = new Set(students.map(slotKeyOf));
  const sanitizedStudents = students.map(sanitizeStudent);
  const inst = {};
  const mark = {};
  const hyuwon = {};
  const requests = {};

  for (const student of students) {
    const ik = instKeyOf(student);
    if (branchData.inst[ik]) inst[ik] = publicInst(branchData.inst[ik]);
    const sk = slotKeyOf(student);
    if (branchData.hyuwon[sk]) hyuwon[sk] = branchData.hyuwon[sk];
  }

  for (const [key, value] of Object.entries(branchData.mark || {})) {
    const parts = key.split("/");
    if (parts.length !== 5) continue;
    const sk = parts.slice(0, 4).join("/");
    if (studentKeys.has(sk)) mark[key] = sanitizeMark(value);
  }

  const phoneSet = new Set(students.map((s) => normalizePhone(s.p)));
  const nameSet = new Set(students.map((s) => s.n));
  for (const [id, req] of Object.entries(branchData.requests || {})) {
    const parent = req.parent || {};
    const ownsSlot = parent.studentSlotKey && studentKeys.has(parent.studentSlotKey);
    const ownsIdentity = nameSet.has(parent.name) && (!parent.phone || phoneSet.has(normalizePhone(parent.phone)));
    if (!ownsSlot && !ownsIdentity) continue;
    requests[id] = sanitizeRequest(req);
    const instKey = req.instKey || "";
    if (branchData.inst[instKey]) inst[instKey] = publicInst(branchData.inst[instKey]);
    const sourceInstKey = parent.sourceInstKey || "";
    if (branchData.inst[sourceInstKey]) inst[sourceInstKey] = publicInst(branchData.inst[sourceInstKey]);
  }

  return {
    students: sanitizedStudents,
    inst,
    mark,
    closed: branchData.closed,
    periods: branchData.periods,
    hyuwon,
    requests,
  };
}

function ensureOwnedSlot(students, slotKey) {
  const found = students.find((s) => slotKeyOf(s) === slotKey);
  if (!found) throw apiError("permission-denied", "본인 수업만 처리할 수 있습니다");
  return found;
}

function checkFutureOpen(branchData, slotKey, ds) {
  if (!ds || ds < todayStr()) throw apiError("failed-precondition", "지난 날짜는 처리할 수 없습니다");
  if (isClosedDate(branchData.closed, ds)) throw apiError("failed-precondition", "휴관일은 처리할 수 없습니다");
  const hy = branchData.hyuwon[slotKey];
  if (hy && Array.isArray(hy.dates) && hy.dates.includes(ds)) {
    throw apiError("failed-precondition", "휴원일은 처리할 수 없습니다");
  }
}

async function updateJsonChild(path, child, mutator) {
  let abortReason = "";
  const ref = db.ref(path + "/" + child);
  const res = await ref.transaction((raw) => {
    const current = parseJSON(raw, child === "swim_students" ? [] : {});
    const next = mutator(current, (reason) => {
      abortReason = reason || "";
    });
    if (next === undefined) return;
    return JSON.stringify(next);
  });
  if (!res.committed) throw apiError("failed-precondition", abortReason || "저장에 실패했습니다");
  return parseJSON(res.snapshot.val(), child === "swim_students" ? [] : {});
}

async function refreshedPayload(branch, session) {
  const branchData = await loadBranchData(branch);
  const students = sessionStudents(branchData.students, session);
  return buildParentPayload(branchData, students);
}

function makeReqId() {
  return "r_" + Date.now() + "_" + crypto.randomBytes(3).toString("hex");
}

function parentSlotMaxRows(inst) {
  if (inst && (inst.elma || inst.cls === "elma" || inst.cls === "elite" || inst.cls === "master")) return 8;
  return 5;
}

function availableSlotsFor(branchData, students, ds, sourceSlotKey, teacherMode) {
  if (!ds) return [];
  const sourceStudent = ensureOwnedSlot(students, sourceSlotKey);
  const sourceInst = branchData.inst[instKeyOf(sourceStudent)] || {};
  if (isNoMakeupInst(sourceInst)) return [];
  const dowNames = ["일", "월", "화", "수", "목", "금", "토"];
  const day = dowNames[new Date(ds).getDay()];
  const mySlots = new Set(students.map(slotKeyOf));
  const pendingOccupied = new Set();
  for (const req of Object.values(branchData.requests || {})) {
    if (req.type !== "bogang") continue;
    if (req.status && req.status !== "pending") continue;
    if (req.target && req.target.ds === ds) {
      const targetKey = [req.target.t, req.target.d, req.target.l, req.target.r].join("/");
      pendingOccupied.add(targetKey + "/" + ds);
    }
  }
  const sourceTeacher = sourceInst.n || "";
  const candidates = [];
  for (const [instKey, inst] of Object.entries(branchData.inst || {})) {
    const [t, d, l] = instKey.split("/");
    if (d !== day || !inst || !inst.n || isNoMakeupInst(inst)) continue;
    if (sourceTeacher) {
      if (teacherMode === "mine" && inst.n !== sourceTeacher) continue;
      if (teacherMode === "other" && inst.n === sourceTeacher) continue;
    }
    const lane = parseInt(l, 10);
    const maxRows = parentSlotMaxRows(inst);
    let freeRow = null;
    for (let r = 1; r <= maxRows; r++) {
      const checkKey = [t, d, lane, r].join("/");
      if (branchData.students.find((s) => s.t === t && s.d === d && parseInt(s.l, 10) === lane && parseInt(s.r, 10) === r)) continue;
      const mark = branchData.mark[checkKey + "/" + ds];
      if (mark && (mark.type === "bogang" || mark.type === "sample")) continue;
      if (mark && mark.type === "absent" && mark.sub) continue;
      if (pendingOccupied.has(checkKey + "/" + ds)) continue;
      freeRow = r;
      break;
    }
    const candidateKey = [t, d, lane, freeRow].join("/");
    if (freeRow && !mySlots.has(candidateKey)) {
      candidates.push({
        t,
        day: d,
        lane,
        row: freeRow,
        ds,
        instName: inst.n,
        classLabel: instClassText(inst),
        inst: publicInst(inst),
      });
    }
  }
  candidates.sort((a, b) => {
    const ta = parseInt(a.t, 10);
    const tb = parseInt(b.t, 10);
    if (ta !== tb) return ta - tb;
    return a.lane - b.lane;
  });
  return candidates;
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "25mb" }));

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "sc-schedule-api" });
});

app.post("/api/parent/login", asyncRoute(async (req, res) => {
  assertLoginRate(req);
  const data = req.body || {};
  const branch = data.branch;
  const name = String(data.name || "").trim();
  const phone = normalizePhone(data.phone);
  if (!name || !/^\d{9,11}$/.test(phone)) {
    throw apiError("invalid-argument", "이름과 전화번호를 확인해주세요");
  }
  const branchData = await loadBranchData(branch);
  const students = branchData.students.filter((s) => s.n === name && normalizePhone(s.p) === phone);
  if (!students.length) throw apiError("not-found", "일치하는 정보가 없습니다");
  const token = await createSession(branch, students);
  res.json({ token, ...buildParentPayload(branchData, students) });
}));

app.post("/api/parent/data", asyncRoute(async (req, res) => {
  const data = req.body || {};
  const session = await requireSession(data);
  res.json(await refreshedPayload(data.branch, session));
}));

app.post("/api/parent/absent", asyncRoute(async (req, res) => {
  const data = req.body || {};
  const session = await requireSession(data);
  const branchData = await loadBranchData(data.branch);
  const students = sessionStudents(branchData.students, session);
  const slotKey = String(data.slotKey || "");
  const ds = String(data.ds || "");
  const student = ensureOwnedSlot(students, slotKey);
  checkFutureOpen(branchData, slotKey, ds);
  const markKey = slotKey + "/" + ds;
  await updateJsonChild(branchData.path, "swim_mark", (marks) => {
    const cur = marks[markKey];
    if (cur && cur.type === "absent") return marks;
    if (cur && (cur.type === "bogang" || cur.type === "sample")) {
      marks[markKey] = { type: "absent", n: student.n, a: student.a || null, p: student.p || null, sub: cur };
      return marks;
    }
    if (cur && cur.type !== "absent") return marks;
    marks[markKey] = { type: "absent", n: student.n, a: student.a || null, p: student.p || null };
    return marks;
  });
  res.json(await refreshedPayload(data.branch, session));
}));

app.post("/api/parent/absent-cancel", asyncRoute(async (req, res) => {
  const data = req.body || {};
  const session = await requireSession(data);
  const branchData = await loadBranchData(data.branch);
  const students = sessionStudents(branchData.students, session);
  const slotKey = String(data.slotKey || "");
  const ds = String(data.ds || "");
  const student = ensureOwnedSlot(students, slotKey);
  checkFutureOpen(branchData, slotKey, ds);
  const mark = branchData.mark[slotKey + "/" + ds];
  if (!mark || mark.type !== "absent") throw apiError("failed-precondition", "결석 상태가 아닙니다");
  const [t, d, l, r] = slotKey.split("/");
  const inst = branchData.inst[[t, d, l].join("/")] || {};
  const entry = {
    type: "absent-cancel",
    status: "pending",
    parent: { studentSlotKey: slotKey, name: student.n, age: student.a || null, phone: student.p || null },
    target: { t, d, l: parseInt(l, 10), r: parseInt(r, 10), ds, instName: inst.n || "" },
    instKey: [t, d, l].join("/"),
    requestedAt: new Date().toISOString(),
  };
  await updateJsonChild(branchData.path, "swim_requests", (reqs, abort) => {
    const exists = Object.values(reqs || {}).some((req) =>
      req.type === "absent-cancel" &&
      (!req.status || req.status === "pending") &&
      req.parent && req.parent.studentSlotKey === slotKey &&
      req.target && req.target.ds === ds
    );
    if (exists) {
      abort("이미 취소 신청이 접수되었습니다");
      return;
    }
    reqs[makeReqId()] = entry;
    return reqs;
  });
  res.json(await refreshedPayload(data.branch, session));
}));

app.post("/api/parent/bogang-slots", asyncRoute(async (req, res) => {
  const data = req.body || {};
  const session = await requireSession(data);
  const branchData = await loadBranchData(data.branch);
  const students = sessionStudents(branchData.students, session);
  const ds = String(data.ds || "");
  if (!ds || ds < todayStr()) return res.json({ slots: [] });
  if (isClosedDate(branchData.closed, ds)) return res.json({ slots: [] });
  res.json({
    slots: availableSlotsFor(
      branchData,
      students,
      ds,
      String(data.sourceSlotKey || ""),
      data.teacherMode === "other" ? "other" : "mine"
    ),
  });
}));

app.post("/api/parent/bogang", asyncRoute(async (req, res) => {
  const data = req.body || {};
  const session = await requireSession(data);
  const branchData = await loadBranchData(data.branch);
  const students = sessionStudents(branchData.students, session);
  const sourceSlotKey = String(data.sourceSlotKey || "");
  const sourceDs = String(data.sourceDs || "");
  const sourceStudent = ensureOwnedSlot(students, sourceSlotKey);
  checkFutureOpen(branchData, sourceSlotKey, sourceDs);
  const sourceInst = branchData.inst[instKeyOf(sourceStudent)] || {};
  if (isNoMakeupInst(sourceInst)) throw apiError("failed-precondition", "보강 신청이 불가한 반입니다");
  const targets = Array.isArray(data.targets) ? data.targets : [];
  if (!targets.length) throw apiError("invalid-argument", "선택한 수업이 없습니다");

  const choiceGroupId = "bg_" + Date.now() + "_" + crypto.randomBytes(3).toString("hex");
  const now = new Date().toISOString();
  const entries = {};
  const seen = new Set();
  const availableByKey = new Map();
  const availableCache = new Map();
  for (const target of targets) {
    const ds = String(target.ds || "");
    if (!availableCache.has(ds)) {
      const mine = availableSlotsFor(branchData, students, ds, sourceSlotKey, "mine");
      const other = availableSlotsFor(branchData, students, ds, sourceSlotKey, "other");
      [...mine, ...other].forEach((slot) => {
        availableByKey.set([slot.t, slot.day, slot.lane, slot.row, slot.ds].join("/"), slot);
      });
      availableCache.set(ds, true);
    }
    const key = [target.t, target.day || target.d, target.lane, target.row, ds].join("/");
    if (seen.has(key)) throw apiError("invalid-argument", "같은 보강 자리가 중복 선택되었습니다");
    seen.add(key);
    const slot = availableByKey.get(key);
    if (!slot) throw apiError("failed-precondition", "선택한 보강 자리를 사용할 수 없습니다");
    const reqId = makeReqId();
    entries[reqId] = {
      type: "bogang",
      status: "pending",
      parent: {
        studentSlotKey: sourceSlotKey,
        name: sourceStudent.n,
        age: sourceStudent.a || null,
        phone: sourceStudent.p || null,
        absentDs: sourceDs,
        sourceInstKey: instKeyOf(sourceStudent),
        sourceInstName: sourceInst.n || "",
        sourceClassLabel: instClassText(sourceInst),
      },
      choiceGroupId,
      choiceCount: targets.length,
      target: {
        t: slot.t,
        d: slot.day,
        l: slot.lane,
        r: slot.row,
        ds: slot.ds,
        instName: slot.instName,
        classLabel: slot.classLabel || "",
      },
      instKey: [slot.t, slot.day, slot.lane].join("/"),
      requestedAt: now,
    };
  }
  await updateJsonChild(branchData.path, "swim_requests", (reqs, abort) => {
    const pending = Object.values(reqs || {}).filter((req) => !req.status || req.status === "pending");
    const sourceExists = pending.some((req) =>
      req.type === "bogang" &&
      req.parent &&
      req.parent.studentSlotKey === sourceSlotKey &&
      req.parent.absentDs === sourceDs
    );
    if (sourceExists) {
      abort("이미 이 결석일에 대한 보강 신청이 접수되었습니다");
      return;
    }
    for (const entry of Object.values(entries)) {
      const t = entry.target || {};
      const targetKey = [t.t, t.d, t.l, t.r, t.ds].join("/");
      const occupied = pending.some((req) => {
        if (req.type !== "bogang") return false;
        const rt = req.target || {};
        return [rt.t, rt.d, rt.l, rt.r, rt.ds].join("/") === targetKey;
      });
      if (occupied) {
        abort("이미 다른 학부모가 같은 보강 자리를 신청했습니다");
        return;
      }
    }
    Object.assign(reqs, entries);
    return reqs;
  });
  res.json({ submittedCount: targets.length, ...(await refreshedPayload(data.branch, session)) });
}));

app.post("/api/staff/data", verifyFirebaseAuth, asyncRoute(async (req, res) => {
  const data = req.body || {};
  const session = await requireAdminSession(data, req.auth);
  const snap = await db.ref(branchPath(data.branch)).once("value");
  res.json({ data: snap.val() || {}, user: publicAdminProfile(session) });
}));

app.post("/api/staff/value", verifyFirebaseAuth, asyncRoute(async (req, res) => {
  const data = req.body || {};
  await requireAdminSession(data, req.auth);
  const key = normalizeDbKey(data.key);
  const snap = await db.ref(branchPath(data.branch) + "/" + key).once("value");
  res.json({ value: snap.val() === undefined ? null : snap.val() });
}));

app.post("/api/staff/set-value", verifyFirebaseAuth, asyncRoute(async (req, res) => {
  const data = req.body || {};
  const session = await requireAdminSession(data, req.auth);
  const key = normalizeDbKey(data.key);
  assertStaffCanWrite(session, key);
  await db.ref(branchPath(data.branch) + "/" + key).set(data.value === undefined ? null : data.value);
  res.json({ ok: true });
}));

app.post("/api/staff/remove-value", verifyFirebaseAuth, asyncRoute(async (req, res) => {
  const data = req.body || {};
  const session = await requireAdminSession(data, req.auth);
  const key = normalizeDbKey(data.key);
  assertStaffCanWrite(session, key);
  await db.ref(branchPath(data.branch) + "/" + key).remove();
  res.json({ ok: true });
}));

app.post("/api/staff/compare-and-set-value", verifyFirebaseAuth, asyncRoute(async (req, res) => {
  const data = req.body || {};
  const session = await requireAdminSession(data, req.auth);
  const key = normalizeDbKey(data.key);
  assertStaffCanWrite(session, key);
  const ref = db.ref(branchPath(data.branch) + "/" + key);
  const tx = await ref.transaction((current) => {
    if (!rawEqual(current, data.expected)) return;
    return data.value === undefined ? null : data.value;
  });
  res.json({
    committed: !!tx.committed,
    value: tx.snapshot.val() === undefined ? null : tx.snapshot.val(),
  });
}));

app.post("/api/staff/compare-and-set-root", verifyFirebaseAuth, asyncRoute(async (req, res) => {
  const data = req.body || {};
  await requireAdminSession(data, req.auth);
  const ref = db.ref(branchPath(data.branch));
  const tx = await ref.transaction((current) => {
    if (!rawEqual(current || {}, data.expected || {})) return;
    return data.value === undefined ? null : data.value;
  });
  res.json({ committed: !!tx.committed, value: tx.snapshot.val() || {} });
}));

app.post("/api/staff/clear-branch", verifyFirebaseAuth, asyncRoute(async (req, res) => {
  const data = req.body || {};
  const session = await requireAdminSession(data, req.auth);
  if (!session.superAdmin) throw apiError("permission-denied", "최고관리자만 초기화할 수 있습니다");
  await db.ref(branchPath(data.branch)).remove();
  res.json({ ok: true });
}));

app.use((req, res) => {
  res.status(404).json({ error: { code: "not-found", message: "API 경로를 찾을 수 없습니다" } });
});

app.use((err, req, res, next) => {
  const status = err.status || 500;
  const code = err.code || "internal";
  const message = err.message || "서버 오류가 발생했습니다";
  if (status >= 500) console.error(err);
  res.status(status).json({ error: { code, message } });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`sc-schedule-api listening on 127.0.0.1:${PORT}`);
});
