"use strict";

const crypto = require("node:crypto");
const {onCall, onRequest, HttpsError} = require("firebase-functions/v2/https");
const {onDocumentWritten} = require("firebase-functions/v2/firestore");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {setGlobalOptions} = require("firebase-functions/v2");
const logger = require("firebase-functions/logger");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore, FieldValue, Timestamp} = require("firebase-admin/firestore");
const {buildRegularAvailability} = require("./regular-availability");
const {publicAvailabilityKeys} = require("./public-availability-source");
const scheduleV2ShadowPolicy = require("./schedule-v2-shadow-policy.js");
const {runShadowSync} = require("./schedule-v2-shadow-runner.js");
const {readCanonicalParity} = require("./schedule-v2-cutover-parity.js");
const {createOperationalWriter} = require("./schedule-v2-operational-writer.js");
const schedulePermissionManifest = require("../config/schedule-permissions.json");

initializeApp({projectId: "scswimming-schedule"});
setGlobalOptions({region: "asia-northeast3", maxInstances: 20});

const db = getFirestore();
const CHUNK_THRESHOLD = 650000;
const CHUNK_SIZE = 600000;
const AUDIT_INDEX_KEY = "zz_swim_audit_index";
const AUDIT_ENTRY_PREFIX = "zz_swim_audit_entry__";
const AUDIT_LOG_MAX = 200;
const PUBLIC_AVAILABILITY_COLLECTION = "publicRegularAvailability";
const PUBLIC_AVAILABILITY_SCHEMA_VERSION = 4;
const PUBLIC_AVAILABILITY_BASIS_MONTH = "2026-09";
const SCHEDULE_V2_SHADOW_MAX_RETRY_COUNT = 10;
const SCHEDULE_V2_PREPARATION_LEASE_MS = 15 * 60 * 1000;
const SCHEDULE_V2_LEASE_HEARTBEAT_MS = 20 * 1000;
const SCHEDULE_V2_RECENT_EVENT_LIMIT = 256;
const SCHEDULE_V2_ACTIONS = new Set([
  "prepare", "set-shadow", "set-verify", "set-v2-read", "set-v2", "rollback", "pause", "status",
]);
const SCHEDULE_V2_MIRROR_BLOCKING_STATES = ["pending", "processing", "error"];
const SCHEDULE_V2_REQUEST_BLOCKING_STATES = [
  "staged", "waiting-primary", "processing", "error", "conflict", "cancelled", "rejected",
];
const SCHEDULE_V2_ATTENDANCE_COLLECTIONS = [
  "attendanceRecords", "attendanceGuests", "attendanceSnapshots",
  "attendanceSnapshotStudents", "attendanceSnapshotTeachers",
];
const SCHEDULE_V2_ACCOUNT_BY_EMAIL = new Map(
  (schedulePermissionManifest.accounts || []).map(account => [
    String(account.email || "").trim().toLowerCase(), account,
  ]),
);
const CUSTOMER_VOICE_COLLECTION = "customerVoice";
const CUSTOMER_VOICE_RATE_COLLECTION = "customerVoiceRateLimits";
const CUSTOMER_VOICE_CATEGORY = new Set([
  "praise",
  "suggestion",
  "inconvenience",
  "staff",
  "safety",
]);
const CUSTOMER_VOICE_CLASS_TYPE = new Set([
  "regular",
  "special",
  "vehicle",
  "facility",
  "other",
]);
const PUBLIC_AVAILABILITY_SOURCE_KEYS = new Set([
  "swim_students",
  "swim_inst",
  "swim_retire",
  "swim_enroll",
  "swim_disabled",
  "swim_periods",
  "swim_tab_list",
  "swim_main_tab",
]);

function isPublicAvailabilitySourceKey(key) {
  const value = String(key || "");
  return PUBLIC_AVAILABILITY_SOURCE_KEYS.has(value) ||
    (/^swim_stu_/.test(value) && !/^swim_bt_/.test(value)) ||
    (/^swim_inst_/.test(value) && !/^swim_bt_/.test(value));
}

const BRANCHES = {
  gagyeong: {id: "gagyeong", name: "가경점", aligoBranch: "가경동", phone: "043-715-2019"},
  yongam: {id: "yongam", name: "용암점", aligoBranch: "용암점", phone: "043-288-2016"},
};
const scheduleV2OperationalWriter = createOperationalWriter({
  db,
  serverTimestamp: () => FieldValue.serverTimestamp(),
});
const ALIGO_PROXY_BASE = "https://adminsuperchild.cloud/aligo";
const ALIGO_SEND_PATH = "/alimtalk/send/";

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

function dateParts(ds) {
  const date = new Date(ds);
  const parts = String(ds || "").split("-");
  const month = Number(parts[1] || 0);
  const day = Number(parts[2] || 0);
  const weekdays = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
  return {
    dateText: month && day ? `${month}월${day}일` : String(ds || ""),
    dayText: Number.isNaN(date.getTime()) ? "" : weekdays[date.getDay()],
  };
}

const SAT_INTERNAL_TO_DISPLAY = {
  "1시": "9시",
  "2시": "10시",
  "3시": "11시",
  "4시": "12시",
  "5시": "1시",
  "6시": "2시",
};
const SAT_DISPLAY_TO_INTERNAL = {
  "9시": "1시",
  "09시": "1시",
  "10시": "2시",
  "11시": "3시",
  "12시": "4시",
  "13시": "5시",
  "14시": "6시",
  "오후1시": "5시",
  "오후2시": "6시",
  "오후 1시": "5시",
  "오후 2시": "6시",
};
function normalizeDayText(day) {
  return String(day || "").replace(/요일/g, "").trim();
}
function isSaturday(day) {
  return normalizeDayText(day) === "토";
}
function normalizeTimeText(time) {
  let text = String(time || "").trim();
  text = text.replace(/#BT(?:_PREVIEW)?/ig, "").replace(/\(?\s*방특(?:반|테스트)?\s*\)?/g, "").replace(/\bBT\b/ig, "");
  text = text.replace(/\s+/g, "").trim();
  const match = text.match(/^0(\d)시$/);
  return match ? `${match[1]}시` : text;
}
function displayTimeForDay(day, time) {
  const t = normalizeTimeText(time);
  return isSaturday(day) ? (SAT_INTERNAL_TO_DISPLAY[t] || t || "") : (t || "");
}
function internalTimeForDay(day, time) {
  const t = normalizeTimeText(time);
  return isSaturday(day) ? (SAT_DISPLAY_TO_INTERNAL[t] || t || "") : (t || "");
}
function sortTimeValue(day, time) {
  const internal = internalTimeForDay(day, time);
  const n = parseInt(String(internal).replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : 999;
}
function isBangteukInst(inst) {
  return !!(inst && typeof inst === "object" && (inst.bt || inst.bangteuk || inst.btGroup || inst.btTabId || inst.cls === "bt" || inst.cls === "bangteuk"));
}
function normalizeSlotKey(key) {
  const parts = String(key || "").split("/");
  if (parts.length >= 2 && isSaturday(parts[1])) parts[0] = internalTimeForDay(parts[1], parts[0]);
  return parts.join("/");
}
function normalizeStudents(list) {
  return (Array.isArray(list) ? list : []).map(stu => {
    if (stu && isSaturday(stu.d)) stu.t = internalTimeForDay(stu.d, stu.t);
    return stu;
  });
}
function normalizeSlotMap(map) {
  if (!map || typeof map !== "object" || Array.isArray(map)) return {};
  const out = {};
  const entries = Object.entries(map);
  entries.forEach(([key, value]) => {
    const nextKey = normalizeSlotKey(key);
    if (nextKey !== key && out[nextKey] === undefined) out[nextKey] = value;
  });
  entries.forEach(([key, value]) => {
    const nextKey = normalizeSlotKey(key);
    if (nextKey === key || out[nextKey] === undefined) out[nextKey] = value;
  });
  return out;
}
function normalizeRequest(req) {
  if (!req || typeof req !== "object") return req;
  if (req.instKey) req.instKey = normalizeSlotKey(req.instKey);
  if (req.parent && typeof req.parent === "object") {
    ["studentSlotKey", "originalSlotKey", "previousSlotKey", "sourceSlotKey", "sourceInstKey"].forEach(key => {
      if (req.parent[key]) req.parent[key] = normalizeSlotKey(req.parent[key]);
    });
  }
  if (req.target && typeof req.target === "object") {
    const day = req.target.d || req.target.day;
    if (isSaturday(day)) req.target.t = internalTimeForDay(day, req.target.t);
    if (req.target.slotKey) req.target.slotKey = normalizeSlotKey(req.target.slotKey);
  }
  return req;
}
function normalizeRequests(map) {
  if (!map || typeof map !== "object" || Array.isArray(map)) return {};
  const out = {};
  Object.entries(map).forEach(([key, value]) => {
    out[key] = normalizeRequest(value);
  });
  return out;
}
function normalizeStoredScheduleValue(key, value) {
  const k = String(key || "");
  if (k === "swim_students" || /^swim_stu_/.test(k) || /^swim_bt_.*_stu$/.test(k)) return normalizeStudents(value);
  if (k === "swim_inst" || /^swim_inst_/.test(k) || /^swim_bt_.*_inst$/.test(k)) return normalizeSlotMap(value);
  if (k === "swim_mark" || k === "swim_hyuwon") return normalizeSlotMap(value);
  if (k === "swim_requests") return normalizeRequests(value);
  return value;
}

function safeBranch(input) {
  const id = String(input || "").trim();
  if (!BRANCHES[id]) throw new HttpsError("invalid-argument", "지점 정보가 올바르지 않습니다");
  return BRANCHES[id];
}

function cleanVoiceText(value, maxLength) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
}

function customerVoiceTicketCollection(branch) {
  return db.collection(CUSTOMER_VOICE_COLLECTION).doc(branch.id).collection("tickets");
}

function customerVoiceRequestIp(request) {
  const raw = request && request.rawRequest;
  const forwarded = String(raw && raw.headers && raw.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || String(raw && raw.ip || "unknown");
}

function customerVoiceRateRef(request) {
  const hour = new Date().toISOString().slice(0, 13);
  const fingerprint = crypto.createHash("sha256")
    .update(`sc-customer-voice|${customerVoiceRequestIp(request)}|${hour}`)
    .digest("hex");
  return db.collection(CUSTOMER_VOICE_RATE_COLLECTION).doc(fingerprint);
}

function customerVoiceTicketNumber(branch) {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const branchCode = branch.id === "yongam" ? "YA" : "GG";
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${branchCode}-${date}-${random}`;
}

async function submitCustomerVoice(branch, data, request) {
  if (cleanVoiceText(data.website, 200)) {
    throw new HttpsError("invalid-argument", "요청을 처리할 수 없습니다");
  }
  const startedAt = Number(data.startedAt || 0);
  if (startedAt && Date.now() - startedAt < 1500) {
    throw new HttpsError("resource-exhausted", "잠시 후 다시 제출해주세요");
  }

  const mode = String(data.mode || "") === "reply" ? "reply" : "anonymous";
  const category = CUSTOMER_VOICE_CATEGORY.has(String(data.category || ""))
    ? String(data.category)
    : "suggestion";
  const classType = CUSTOMER_VOICE_CLASS_TYPE.has(String(data.classType || ""))
    ? String(data.classType)
    : "other";
  const message = cleanVoiceText(data.message, 2000);
  const teacherName = cleanVoiceText(data.teacherName, 40);
  const visitDate = /^\d{4}-\d{2}-\d{2}$/.test(String(data.visitDate || ""))
    ? String(data.visitDate)
    : "";
  const timeRange = cleanVoiceText(data.timeRange, 30);
  const sourceContext = cleanVoiceText(data.context, 80);
  if (message.length < 10) {
    throw new HttpsError("invalid-argument", "의견 내용을 10자 이상 입력해주세요");
  }

  let contact = null;
  let memberVerified = false;
  if (mode === "reply") {
    if (data.privacyConsent !== true) {
      throw new HttpsError("failed-precondition", "개인정보 수집·이용 동의가 필요합니다");
    }
    const studentName = cleanVoiceText(data.studentName, 40);
    const phone = normalizePhone(data.phone);
    if (!studentName || phone.length < 10) {
      throw new HttpsError("invalid-argument", "원생 이름과 휴대전화 번호를 확인해주세요");
    }
    const found = await findParentStudentSet(branch, studentName, phone);
    if (!found) {
      throw new HttpsError("not-found", "등록된 회원 정보를 확인할 수 없습니다");
    }
    contact = {studentName, phone};
    memberVerified = true;
  }

  const ticketRef = customerVoiceTicketCollection(branch).doc();
  const ticketNumber = customerVoiceTicketNumber(branch);
  const nowIso = new Date().toISOString();
  const rateRef = customerVoiceRateRef(request);
  await db.runTransaction(async tx => {
    const rateSnap = await tx.get(rateRef);
    const count = Number(rateSnap.exists && rateSnap.data().count || 0);
    if (count >= 5) {
      throw new HttpsError("resource-exhausted", "접수가 너무 많습니다. 잠시 후 다시 시도해주세요");
    }
    tx.set(rateRef, {
      count: count + 1,
      updatedAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + 1000 * 60 * 60 * 2),
    }, {merge: true});
    tx.create(ticketRef, {
      ticketNumber,
      branchId: branch.id,
      branchName: branch.name,
      mode,
      category,
      classType,
      visitDate,
      timeRange,
      teacherName,
      message,
      sourceContext,
      status: "received",
      priority: category === "safety" ? "urgent" : "normal",
      memberVerified,
      contact,
      internalNote: "",
      publicReply: "",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      statusHistory: [{status: "received", at: nowIso, by: "customer"}],
    });
  });

  return {
    ok: true,
    ticketNumber,
  };
}

function kvDoc(branch, key) {
  return db.collection("scheduleStores").doc(branch.id).collection("kv").doc(encodeURIComponent(key).replace(/\./g, "%2E"));
}

function chunkDoc(branch, key, index) {
  return kvDoc(branch, key).collection("chunks").doc(String(index).padStart(4, "0"));
}

function scheduleV2RuntimeRef(branchId, documentId) {
  return db.collection("scheduleV2").doc(branchId).collection("runtime").doc(documentId);
}

function scheduleV2ShadowCollections(keys) {
  return [...new Set((Array.isArray(keys) ? keys : [])
    .flatMap(key => scheduleV2ShadowPolicy.collectionsForKey(key)))];
}

function scheduleV2ShadowAlertRef(branchId, diagnostic) {
  const scope = [diagnostic.messageClass, ...diagnostic.collections.slice().sort()].join("|");
  const digest = crypto.createHash("sha256").update(scope).digest("hex").slice(0, 24);
  return db.collection("scheduleV2").doc(branchId).collection("alerts")
    .doc(`shadow_${diagnostic.messageClass}_${digest}`);
}

function scheduleV2ShadowRetryCount(value) {
  const count = Math.max(0, Number(value || 0) || 0);
  return Math.min(SCHEDULE_V2_SHADOW_MAX_RETRY_COUNT, count + 1);
}

function scheduleV2GenerationRef(branchId, generationId) {
  return db.collection("scheduleV2").doc(branchId).collection("generations").doc(generationId);
}

function scheduleV2OperationalMutationCollection(branchId) {
  return db.collection("scheduleV2").doc(branchId).collection("operationalMutations");
}

function scheduleV2RequestRecoveryCollection(branchId) {
  return db.collection("scheduleV2").doc(branchId).collection("requestRecoveries");
}

function scheduleV2AuthEmail(request) {
  if (!request?.auth?.uid) throw new HttpsError("unauthenticated", "직원 로그인이 필요합니다");
  const email = String(request.auth.token?.email || "").trim().toLowerCase();
  if (!email || request.auth.token?.email_verified !== true) {
    throw new HttpsError("permission-denied", "인증된 직원 계정이 필요합니다");
  }
  return email;
}

function authorizeScheduleV2Action(request, action, branchId) {
  const email = scheduleV2AuthEmail(request);
  const account = SCHEDULE_V2_ACCOUNT_BY_EMAIL.get(email);
  const role = String(account?.role || "");
  const branches = Array.isArray(account?.branchIds) ? account.branchIds.map(String) : [];
  const active = account && account.active !== false;
  const branchAllowed = branches.includes(branchId);
  if (active && branchAllowed && action === "status" && ["developer", "superAdmin"].includes(role)) return email;
  if (active && branchAllowed && action === "pause" && ["developer", "superAdmin"].includes(role)) return email;
  if (active && branchAllowed && action !== "status" && role === "developer") return email;
  throw new HttpsError("permission-denied", "Schedule V2 작업 권한이 없습니다");
}

function scheduleV2Keys(value, field) {
  return [...new Set((Array.isArray(value?.[field]) ? value[field] : [])
    .filter(scheduleV2ShadowPolicy.isTrackedKey))];
}

function scheduleV2Count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function scheduleV2NonnegativeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function scheduleV2ReadyCapability(capability) {
  const revision = Number(capability?.appliedRevision);
  return capability?.status === "ready" && Number.isSafeInteger(revision) && revision >= 0 &&
    Boolean(String(capability?.verifiedAt || "").trim());
}

function scheduleV2PointerMatches(pointer, branchId, mode, generationId) {
  return String(pointer?.branchId || "") === branchId &&
    String(pointer?.mode || "") === mode &&
    String(pointer?.generationId || "") === generationId;
}

function scheduleV2LegacyAttendanceCapability(generation) {
  if (generation?.capabilities || generation?.status !== "ready" || !generation?.verifiedAt) return null;
  const verification = generation.verification;
  const expected = verification?.expected;
  const collections = [
    "attendanceRecords", "attendanceGuests", "attendanceSnapshots",
    "attendanceSnapshotStudents", "attendanceSnapshotTeachers",
  ];
  if (verification?.matches !== true || verification?.countMatches !== true ||
      verification?.contentMatches !== true || !expected ||
      !collections.every(name => Object.prototype.hasOwnProperty.call(expected, name))) return null;
  return {status: "ready", appliedRevision: 0, verifiedAt: String(generation.verifiedAt)};
}

function scheduleV2Capabilities(generation) {
  const capabilities = generation?.capabilities && typeof generation.capabilities === "object" ?
    {...generation.capabilities} : {};
  const legacyAttendance = scheduleV2LegacyAttendanceCapability(generation);
  if (legacyAttendance && !capabilities.attendance) capabilities.attendance = legacyAttendance;
  return capabilities;
}

function scheduleV2GenerationWithSchedule(generation, status, sync, now, extra = {}) {
  const nowIso = (now instanceof Date ? now : new Date(now)).toISOString();
  const capabilities = scheduleV2Capabilities(generation);
  const previous = capabilities.schedule && typeof capabilities.schedule === "object" ?
    capabilities.schedule : {};
  const schedule = {
    ...previous,
    status,
    requestedRevision: scheduleV2Count(sync?.requestedRevision),
    appliedRevision: scheduleV2Count(sync?.appliedRevision),
    ...extra,
  };
  if (status === "ready") schedule.verifiedAt = nowIso;
  if (status === "error") schedule.failedAt = nowIso;
  const genericStatus = status === "error" ? "failed" : status;
  return {...generation, status: genericStatus, capabilities: {...capabilities, schedule}};
}

function scheduleV2VerifiedAttendanceCapability(result, sync, now) {
  const collections = new Set(Array.isArray(result?.collections) ? result.collections : []);
  const counts = result?.counts && typeof result.counts === "object" ? result.counts : {};
  const digests = result?.digests && typeof result.digests === "object" ? result.digests : {};
  const verified = SCHEDULE_V2_ATTENDANCE_COLLECTIONS.every(name =>
    collections.has(name) && Object.prototype.hasOwnProperty.call(counts, name) &&
    Object.prototype.hasOwnProperty.call(digests, name)
  );
  if (!verified) {
    throw new HttpsError("failed-precondition", "출석 Schedule V2 검증 결과가 완전하지 않습니다");
  }
  return {
    status: "ready",
    appliedRevision: scheduleV2Count(sync?.appliedRevision),
    verifiedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
  };
}

function scheduleV2GenerationStatus(config, sync, generation) {
  const pending = scheduleV2Keys(sync, "pendingKeys");
  const inFlight = scheduleV2Keys(sync, "inFlightKeys");
  const requestedRevision = scheduleV2Count(sync?.requestedRevision);
  const appliedRevision = scheduleV2Count(sync?.appliedRevision);
  const capability = generation?.capabilities?.schedule || {};
  if (capability.status === "error" || generation?.status === "failed" ||
      sync?.status === "error" || scheduleV2Count(sync?.mismatchCount)) return "error";
  if (String(config?.preparationStatus || "") === "preparing") return "preparing";
  if (pending.length || inFlight.length || requestedRevision !== appliedRevision ||
      ["pending", "processing"].includes(String(sync?.status || ""))) return "syncing";
  if (capability.status === "ready" &&
      scheduleV2Count(capability.appliedRevision) === appliedRevision &&
      scheduleV2Count(capability.requestedRevision) === requestedRevision) return "ready";
  return String(capability.status || generation?.status || "");
}

function scheduleV2StatusFrom(branchId, config, sync, generation, runtime = {}) {
  const pending = scheduleV2Keys(sync, "pendingKeys");
  const inFlight = scheduleV2Keys(sync, "inFlightKeys");
  const preparedGeneration = runtime.preparedGeneration || {};
  const preparedGenerationId = String(
    config?.preparedGenerationId || config?.preparationGenerationId || "",
  );
  const statusGeneration = preparedGenerationId ? preparedGeneration : generation;
  const capability = generation?.capabilities?.schedule || {};
  const attendanceCapability = generation?.capabilities?.attendance || {};
  const preparedScheduleCapability = preparedGeneration?.capabilities?.schedule || {};
  const preparedAttendanceCapability = preparedGeneration?.capabilities?.attendance || {};
  const operational = runtime.operational || {};
  const attendance = runtime.attendance || {};
  const operationalStatus = runtime.operationalStatus || {};
  const scheduleGenerationId = String(config?.generationId || "");
  const operationalGenerationId = String(operational?.generationId || "");
  const mode = runtime.operationalExists ? String(operational?.mode || "v1") : String(config?.mode || "v1");
  const generationId = runtime.operationalExists ? operationalGenerationId : scheduleGenerationId;
  const epoch = scheduleV2Count(operational?.epoch);
  const revision = scheduleV2Count(operational?.revision);
  const requestedRevision = scheduleV2Count(sync?.requestedRevision);
  const appliedRevision = scheduleV2Count(sync?.appliedRevision);
  const mirrorRecoveryPendingCount = scheduleV2Count(operationalStatus.recoveryPendingCount) +
    scheduleV2Count(operationalStatus.recoveryProcessingCount);
  const requestRecoveryPendingCount = scheduleV2Count(operationalStatus.requestRecoveryPendingCount);
  const mirrorRecoveryErrorCount = scheduleV2Count(operationalStatus.recoveryErrorCount);
  const requestRecoveryErrorCount = scheduleV2Count(operationalStatus.requestRecoveryErrorCount) +
    scheduleV2Count(operationalStatus.requestRecoveryConflictCount) +
    scheduleV2Count(operationalStatus.requestRecoveryCancelledCount) +
    scheduleV2Count(operationalStatus.requestRecoveryRejectedCount);
  const scheduleReady = scheduleV2ReadyCapability(capability);
  const attendanceReady = scheduleV2ReadyCapability(attendanceCapability);
  const generationCurrent = Boolean(scheduleGenerationId) &&
    String(generation?.branchId || "") === branchId &&
    String(generation?.generationId || generation?.id || "") === scheduleGenerationId;
  const pointerConsistent = Boolean(runtime.operationalExists && runtime.attendanceExists) &&
    scheduleV2PointerMatches(operational, branchId, mode, generationId) &&
    scheduleV2PointerMatches(attendance, branchId, mode, generationId) &&
    scheduleGenerationId === generationId;
  const recoverySafe = pointerConsistent && generationCurrent && scheduleReady && attendanceReady &&
    (mode !== "v2" || scheduleV2Count(operational?.recoverySafeRevision) === revision);
  const committingMutationCount = scheduleV2Count(operationalStatus.committingMutationCount);
  const activeOperationCount = scheduleV2Count(operationalStatus.activeOperationCount);
  const activeRecoveryLeaseCount = scheduleV2LeaseIsActive(
    runtime.recoveryFence?.recoveryLeaseUntil, new Date(),
  ) ? 1 : 0;
  const scheduleLeaseCount = scheduleV2LeaseIsActive(sync?.leaseUntil, new Date()) ? 1 : 0;
  const scheduleStateBlockerCount = ["pending", "processing", "error"].includes(
    String(sync?.status || ""),
  ) ? 1 : 0;
  const revisionDriftCount = requestedRevision !== appliedRevision ? 1 : 0;
  const transitionBlockerCount = pending.length + inFlight.length + scheduleV2Count(sync?.mismatchCount) +
    revisionDriftCount + scheduleLeaseCount + scheduleStateBlockerCount + committingMutationCount +
    activeOperationCount + activeRecoveryLeaseCount + mirrorRecoveryPendingCount +
    mirrorRecoveryErrorCount + requestRecoveryPendingCount + requestRecoveryErrorCount;
  const preparationBlockerCount = inFlight.length + scheduleLeaseCount + committingMutationCount +
    activeOperationCount + activeRecoveryLeaseCount + mirrorRecoveryPendingCount +
    mirrorRecoveryErrorCount + requestRecoveryPendingCount + requestRecoveryErrorCount;
  return {
    branchId,
    mode,
    scheduleMode: String(config?.mode || "v1"),
    generationId,
    scheduleGenerationId,
    epoch,
    revision,
    generationStatus: scheduleV2GenerationStatus(config, sync, statusGeneration),
    preparationStatus: String(config?.preparationStatus || ""),
    preparedGenerationId: String(config?.preparedGenerationId || ""),
    preparedScheduleReady: scheduleV2ReadyCapability(preparedScheduleCapability),
    preparedAttendanceReady: scheduleV2ReadyCapability(preparedAttendanceCapability),
    pendingCount: pending.length,
    inFlightCount: inFlight.length,
    requestedRevision: scheduleV2Count(sync?.requestedRevision),
    appliedRevision: scheduleV2Count(sync?.appliedRevision),
    lastSuccessfulSync: String(sync?.lastSyncedAt || capability.verifiedAt || generation?.verifiedAt || ""),
    unresolvedMismatchCount: scheduleV2Count(sync?.mismatchCount),
    mirrorRecoveryPendingCount,
    mirrorRecoveryErrorCount,
    requestRecoveryPendingCount,
    requestRecoveryErrorCount,
    recoveryPendingCount: mirrorRecoveryPendingCount + requestRecoveryPendingCount,
    recoveryErrorCount: mirrorRecoveryErrorCount + requestRecoveryErrorCount,
    committingMutationCount,
    activeOperationCount,
    activeRecoveryLeaseCount,
    scheduleLeaseCount,
    scheduleStateBlockerCount,
    revisionDriftCount,
    transitionBlockerCount,
    preparationBlockerCount,
    scheduleReady,
    attendanceReady,
    generationCurrent,
    pointerConsistent,
    recoverySafe,
  };
}

async function readScheduleV2Status(branchId) {
  const configRef = scheduleV2RuntimeRef(branchId, "schedule");
  const syncRef = scheduleV2RuntimeRef(branchId, "scheduleSync");
  const operationalRef = scheduleV2RuntimeRef(branchId, "operational");
  const attendanceRef = scheduleV2RuntimeRef(branchId, "attendance");
  const recoveryFenceRef = scheduleV2RuntimeRef(branchId, "operationalRecovery");
  const [configSnapshot, syncSnapshot, operationalSnapshot, attendanceSnapshot,
    recoveryFenceSnapshot, operationalStatus] =
    await Promise.all([
      configRef.get(), syncRef.get(), operationalRef.get(), attendanceRef.get(), recoveryFenceRef.get(),
      scheduleV2OperationalWriter.readOperationalStatus(branchId),
    ]);
  const config = configSnapshot.data() || {};
  const generationId = String(config.generationId || "");
  const preparedGenerationId = String(
    config.preparedGenerationId || config.preparationGenerationId || "",
  );
  const [generationSnapshot, preparedGenerationSnapshot] = await Promise.all([
    generationId ? scheduleV2GenerationRef(branchId, generationId).get() : Promise.resolve(null),
    preparedGenerationId && preparedGenerationId !== generationId ?
      scheduleV2GenerationRef(branchId, preparedGenerationId).get() : Promise.resolve(null),
  ]);
  return scheduleV2StatusFrom(
    branchId,
    config,
    syncSnapshot.data() || {},
    generationSnapshot?.data() || {},
    {
      operational: operationalSnapshot.data() || {},
      attendance: attendanceSnapshot.data() || {},
      operationalExists: operationalSnapshot.exists,
      attendanceExists: attendanceSnapshot.exists,
      operationalStatus,
      recoveryFence: recoveryFenceSnapshot.data() || {},
      preparedGeneration: preparedGenerationSnapshot?.data() ||
        (preparedGenerationId === generationId ? generationSnapshot?.data() || {} : {}),
    },
  );
}

function preparationGenerationId() {
  return `gen_${Date.now()}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function scheduleV2SourceEventHash(event) {
  const eventId = String(event?.id || "").trim();
  return eventId ? crypto.createHash("sha256").update(eventId).digest("hex") : "";
}

function scheduleV2RememberEvent(sync, eventHash) {
  const recent = Array.isArray(sync?.recentSourceEvents) ?
    sync.recentSourceEvents.filter(value => /^[a-f0-9]{64}$/.test(String(value))) : [];
  if (!eventHash) return {duplicate: false, recent};
  if (recent.includes(eventHash)) return {duplicate: true, recent};
  return {duplicate: false, recent: [...recent, eventHash].slice(-SCHEDULE_V2_RECENT_EVENT_LIMIT)};
}

async function acquireScheduleV2Preparation(branchId, expectedRuntime) {
  const configRef = scheduleV2RuntimeRef(branchId, "schedule");
  const syncRef = scheduleV2RuntimeRef(branchId, "scheduleSync");
  const operationalRef = scheduleV2RuntimeRef(branchId, "operational");
  const attendanceRef = scheduleV2RuntimeRef(branchId, "attendance");
  const recoveryFenceRef = scheduleV2RuntimeRef(branchId, "operationalRecovery");
  const generationId = preparationGenerationId();
  const generationRef = scheduleV2GenerationRef(branchId, generationId);
  const leaseId = `prepare_${crypto.randomUUID()}`;
  const now = new Date();
  const nowIso = now.toISOString();
  const leaseUntil = new Date(now.getTime() + SCHEDULE_V2_PREPARATION_LEASE_MS).toISOString();
  return db.runTransaction(async tx => {
    const recoveryQueries = scheduleV2RecoveryQueries(branchId);
    const [configSnapshot, syncSnapshot, operationalSnapshot, attendanceSnapshot,
      recoveryFenceSnapshot, ...queueSnapshots] = await Promise.all([
      tx.get(configRef), tx.get(syncRef), tx.get(operationalRef), tx.get(attendanceRef),
      tx.get(recoveryFenceRef), ...recoveryQueries.map(query => tx.get(query)),
    ]);
    const config = configSnapshot.data() || {};
    const sync = syncSnapshot.data() || {};
    const operational = operationalSnapshot.data() || {};
    const attendance = attendanceSnapshot.data() || {};
    const recoveryFence = recoveryFenceSnapshot.data() || {};
    const currentMode = operationalSnapshot.exists ? String(operational.mode || "") : String(config.mode || "v1");
    const currentGenerationId = operationalSnapshot.exists ?
      String(operational.generationId || "") : String(config.generationId || "");
    const epoch = operationalSnapshot.exists ? scheduleV2NonnegativeInteger(operational.epoch) : 0;
    const revision = operationalSnapshot.exists ? scheduleV2NonnegativeInteger(operational.revision) : 0;
    const attendanceEpoch = attendanceSnapshot.exists ? scheduleV2NonnegativeInteger(attendance.epoch) : 0;
    const attendanceRevision = attendanceSnapshot.exists ? scheduleV2NonnegativeInteger(attendance.revision) : 0;
    if (epoch === null || revision === null || attendanceEpoch === null || attendanceRevision === null) {
      throw new HttpsError("failed-precondition", "Schedule V2 런타임 리비전이 올바르지 않습니다");
    }
    if (!expectedRuntime || expectedRuntime.mode !== currentMode ||
        expectedRuntime.generationId !== currentGenerationId || expectedRuntime.epoch !== epoch ||
        expectedRuntime.revision !== revision) {
      throw new HttpsError("aborted", "Schedule V2 준비 대상이 변경되었습니다");
    }
    const implicitV1Pointers = !operationalSnapshot.exists && !attendanceSnapshot.exists &&
      currentMode === "v1" && epoch === 0 && revision === 0;
    const pointerConsistent = implicitV1Pointers || (
      operationalSnapshot.exists && attendanceSnapshot.exists &&
      String(config.branchId || branchId) === branchId && String(config.mode || "v1") === currentMode &&
      String(config.generationId || "") === currentGenerationId &&
      scheduleV2PointerMatches(operational, branchId, currentMode, currentGenerationId) &&
      scheduleV2PointerMatches(attendance, branchId, currentMode, currentGenerationId) &&
      attendanceEpoch === epoch && attendanceRevision === revision
    );
    if (!pointerConsistent) {
      throw new HttpsError("failed-precondition", "Schedule V2 활성 포인터가 일치하지 않습니다");
    }
    const activeLeaseUntil = Date.parse(sync.leaseUntil || "");
    if (String(config.preparationStatus || "") === "preparing" ||
        (String(sync.leaseId || "") && Number.isFinite(activeLeaseUntil) && activeLeaseUntil > now.getTime())) {
      throw new HttpsError("already-exists", "Schedule V2 준비 작업이 이미 진행 중입니다");
    }
    const scheduleBlocked = scheduleV2Keys(sync, "inFlightKeys").length > 0;
    const recoveryBlocked = queueSnapshots.some(snapshot => scheduleV2SnapshotCount(snapshot) > 0) ||
      Boolean(String(operational.activeOperationId || "")) ||
      scheduleV2LeaseIsActive(recoveryFence.recoveryLeaseUntil, now);
    if (scheduleBlocked || recoveryBlocked ||
        (currentMode === "v2" && scheduleV2Count(operational.recoverySafeRevision) !== revision)) {
      throw new HttpsError("failed-precondition", "대기 중인 동기화 또는 복구 작업을 먼저 해결해야 합니다");
    }
    const startingRevision = scheduleV2Count(sync.requestedRevision);
    const nextSync = {
      ...sync,
      pendingKeys: [],
      requestedRevision: startingRevision,
      appliedRevision: startingRevision,
      startingRevision,
      status: "processing",
      leaseId,
      leaseUntil,
      processingStartedAt: nowIso,
      preparationGenerationId: generationId,
      generationId,
      mismatchCount: 0,
      retryCount: 0,
    };
    delete nextSync.inFlightKeys;
    tx.set(syncRef, nextSync, {merge: false});
    tx.set(configRef, {
      ...config,
      branchId,
      mode: currentMode,
      generationId: currentGenerationId,
      requiresPrepare: true,
      preparationStatus: "preparing",
      preparationGenerationId: generationId,
      preparationStartedAt: nowIso,
      updatedAt: nowIso,
    }, {merge: false});
    const preparingGeneration = scheduleV2GenerationWithSchedule({
      branchId,
      generationId,
      createdAt: nowIso,
      startingRevision,
    }, "preparing", nextSync, now, {startedAt: nowIso});
    tx.set(generationRef, preparingGeneration, {merge: false});
    return {branchId, generationId, leaseId, startingRevision, syncRef, configRef, generationRef};
  });
}

async function listScheduleV2BaselineKeys(branch) {
  const snapshot = await db.collection("scheduleStores").doc(branch.id).collection("kv").get();
  const keys = new Set(["swim_tab_list"]);
  snapshot.forEach(doc => {
    const key = scheduleV2ShadowPolicy.decodeLegacyKey(doc.id);
    if (scheduleV2ShadowPolicy.isTrackedKey(key)) keys.add(key);
  });
  return [...keys];
}

async function claimScheduleV2PreparationCatchup(preparation) {
  const now = new Date();
  return db.runTransaction(async tx => {
    const configSnapshot = await tx.get(preparation.configRef);
    const syncSnapshot = await tx.get(preparation.syncRef);
    const config = configSnapshot.data() || {};
    const sync = syncSnapshot.data() || {};
    if (config.preparationStatus !== "preparing" ||
        config.preparationGenerationId !== preparation.generationId ||
        sync.leaseId !== preparation.leaseId) {
      throw new HttpsError("aborted", "Schedule V2 준비 펜스가 변경되었습니다");
    }
    const keys = scheduleV2Keys(sync, "pendingKeys");
    if (!keys.length) return null;
    const requestedRevision = scheduleV2Count(sync.requestedRevision);
    const next = {
      ...sync,
      pendingKeys: [],
      inFlightKeys: keys,
      status: "processing",
      leaseUntil: new Date(now.getTime() + SCHEDULE_V2_PREPARATION_LEASE_MS).toISOString(),
    };
    tx.set(preparation.syncRef, next, {merge: false});
    return {keys, requestedRevision};
  });
}

async function finishScheduleV2PreparationCatchup(preparation, claim, result) {
  const nowIso = new Date().toISOString();
  return db.runTransaction(async tx => {
    const configSnapshot = await tx.get(preparation.configRef);
    const syncSnapshot = await tx.get(preparation.syncRef);
    const config = configSnapshot.data() || {};
    const sync = syncSnapshot.data() || {};
    if (config.preparationStatus !== "preparing" ||
        config.preparationGenerationId !== preparation.generationId ||
        sync.leaseId !== preparation.leaseId) {
      throw new HttpsError("aborted", "Schedule V2 준비 펜스가 변경되었습니다");
    }
    const next = {
      ...sync,
      status: "processing",
      appliedRevision: Math.max(scheduleV2Count(sync.appliedRevision), claim.requestedRevision),
      lastSyncedAt: nowIso,
      mismatchCount: 0,
      collections: result.collections,
      counts: result.counts,
      digests: result.digests,
      writes: result.writes,
      deletes: result.deletes,
    };
    delete next.inFlightKeys;
    tx.set(preparation.syncRef, next, {merge: false});
  });
}

async function tryCompleteScheduleV2Preparation(preparation, result) {
  const nowIso = new Date().toISOString();
  return db.runTransaction(async tx => {
    const configSnapshot = await tx.get(preparation.configRef);
    const syncSnapshot = await tx.get(preparation.syncRef);
    const generationSnapshot = await tx.get(preparation.generationRef);
    const config = configSnapshot.data() || {};
    const sync = syncSnapshot.data() || {};
    const generation = generationSnapshot.data() || {};
    if (config.preparationStatus !== "preparing" ||
        config.preparationGenerationId !== preparation.generationId ||
        sync.leaseId !== preparation.leaseId) {
      throw new HttpsError("aborted", "Schedule V2 준비 펜스가 변경되었습니다");
    }
    if (scheduleV2Keys(sync, "pendingKeys").length || scheduleV2Keys(sync, "inFlightKeys").length) return false;
    const completedSync = {
      ...sync,
      pendingKeys: [],
      appliedRevision: scheduleV2Count(sync.requestedRevision),
      status: "idle",
      lastSyncedAt: nowIso,
      mismatchCount: 0,
      collections: result.collections,
      counts: result.counts,
      digests: result.digests,
      writes: result.writes,
      deletes: result.deletes,
    };
    delete completedSync.inFlightKeys;
    delete completedSync.leaseId;
    delete completedSync.leaseUntil;
    delete completedSync.processingStartedAt;
    delete completedSync.preparationGenerationId;
    tx.set(preparation.syncRef, completedSync, {merge: false});
    const attendanceCapability = scheduleV2VerifiedAttendanceCapability(result, completedSync, nowIso);
    tx.set(preparation.configRef, {
      ...config,
      branchId: preparation.branchId,
      requiresPrepare: false,
      preparationStatus: "ready",
      preparationGenerationId: preparation.generationId,
      preparedGenerationId: preparation.generationId,
      readyRevision: completedSync.appliedRevision,
      readyAt: nowIso,
      updatedAt: nowIso,
    }, {merge: false});
    const completedGeneration = scheduleV2GenerationWithSchedule({
      ...generation,
      branchId: preparation.branchId,
      generationId: preparation.generationId,
      createdAt: config.preparationStartedAt || nowIso,
      verifiedAt: nowIso,
      startingRevision: preparation.startingRevision,
      appliedRevision: completedSync.appliedRevision,
      collections: result.collections,
      counts: result.counts,
      digests: result.digests,
    }, "ready", completedSync, new Date(nowIso));
    completedGeneration.capabilities = {
      ...completedGeneration.capabilities,
      attendance: attendanceCapability,
    };
    tx.set(preparation.generationRef, completedGeneration, {merge: false});
    return true;
  });
}

async function failScheduleV2Preparation(preparation, error, keys) {
  const nowIso = new Date().toISOString();
  const diagnostic = scheduleV2ShadowPolicy.redactedError(error, {
    branchId: preparation.branchId,
    keys,
    collections: scheduleV2ShadowCollections(keys),
    now: new Date(nowIso),
  });
  const alertRef = scheduleV2ShadowAlertRef(preparation.branchId, diagnostic);
  const recorded = await db.runTransaction(async tx => {
    const configSnapshot = await tx.get(preparation.configRef);
    const syncSnapshot = await tx.get(preparation.syncRef);
    const generationSnapshot = await tx.get(preparation.generationRef);
    const config = configSnapshot.data() || {};
    const sync = syncSnapshot.data() || {};
    const generation = generationSnapshot.data() || {};
    if (config.preparationStatus !== "preparing" ||
        config.preparationGenerationId !== preparation.generationId ||
        sync.leaseId !== preparation.leaseId) return false;
    const alertSnapshot = await tx.get(alertRef);
    const pendingKeys = [...new Set([
      ...scheduleV2Keys(sync, "pendingKeys"),
      ...scheduleV2Keys(sync, "inFlightKeys"),
    ])];
    const failedSync = {
      ...sync,
      pendingKeys,
      status: pendingKeys.length ? "pending" : "error",
      mismatchCount: Math.max(1, scheduleV2Count(sync.mismatchCount)),
      lastFailedAt: nowIso,
    };
    delete failedSync.inFlightKeys;
    delete failedSync.leaseId;
    delete failedSync.leaseUntil;
    delete failedSync.processingStartedAt;
    delete failedSync.preparationGenerationId;
    tx.set(preparation.syncRef, failedSync, {merge: false});
    tx.set(preparation.configRef, {
      ...config,
      branchId: preparation.branchId,
      requiresPrepare: true,
      preparationStatus: "failed",
      preparationGenerationId: preparation.generationId,
      updatedAt: nowIso,
    }, {merge: false});
    const failedGeneration = scheduleV2GenerationWithSchedule({
      ...generation,
      branchId: preparation.branchId,
      generationId: preparation.generationId,
      failedAt: nowIso,
    }, "error", failedSync, new Date(nowIso), {errorClass: diagnostic.messageClass});
    tx.set(preparation.generationRef, failedGeneration, {merge: false});
    const priorCount = Math.max(0, Number(alertSnapshot.data()?.count || 0) || 0);
    tx.set(alertRef, {
      ...diagnostic,
      id: alertRef.id,
      type: "schedule-v2-shadow",
      message: `Schedule V2 shadow ${diagnostic.messageClass} failure`,
      status: "open",
      lastDetectedAt: diagnostic.detectedAt,
      count: Math.min(Number.MAX_SAFE_INTEGER, priorCount + 1),
    }, {merge: false});
    return true;
  });
  if (recorded) logger.error("schedule-v2-shadow-failed", diagnostic);
  return recorded;
}

async function prepareScheduleV2(branch, expectedRuntime) {
  const preparation = await acquireScheduleV2Preparation(branch.id, expectedRuntime);
  const fence = {ref: preparation.syncRef, leaseId: preparation.leaseId};
  let baselineKeys = ["swim_tab_list"];
  try {
    baselineKeys = await listScheduleV2BaselineKeys(branch);
    await runShadowSync({
      db,
      branchId: branch.id,
      generationId: preparation.generationId,
      keys: baselineKeys,
      readLegacyKey: key => readStoredValue(branch, key),
      fence,
      fullGeneration: true,
    });
    for (let pass = 0; pass < 100; pass++) {
      let claim;
      while ((claim = await claimScheduleV2PreparationCatchup(preparation))) {
        const catchup = await runShadowSync({
          db,
          branchId: branch.id,
          generationId: preparation.generationId,
          keys: claim.keys,
          readLegacyKey: key => readStoredValue(branch, key),
          fence,
        });
        await finishScheduleV2PreparationCatchup(preparation, claim, catchup);
      }
      const parity = await runShadowSync({
        db,
        branchId: branch.id,
        generationId: preparation.generationId,
        keys: baselineKeys,
        readLegacyKey: key => readStoredValue(branch, key),
        fence,
        fullGeneration: true,
      });
      if (await tryCompleteScheduleV2Preparation(preparation, parity)) {
        return readScheduleV2Status(branch.id);
      }
    }
    throw new HttpsError("resource-exhausted", "Schedule V2 변경이 계속 발생해 준비를 마치지 못했습니다");
  } catch (error) {
    const failure = error instanceof HttpsError ? error :
      new HttpsError("failed-precondition", "Schedule V2 기준점 준비에 실패했습니다");
    try {
      await failScheduleV2Preparation(preparation, error, baselineKeys);
    } catch {
      // The transaction wrote neither failure state nor alert; preserve the original preparation error.
    }
    throw failure;
  }
}

function scheduleV2LeaseHeartbeat(syncRef, leaseId) {
  let nextRenewalAt = 0;
  let renewal = null;
  return async () => {
    const nowMs = Date.now();
    if (nowMs < nextRenewalAt) return;
    if (renewal) return renewal;
    renewal = db.runTransaction(async tx => {
      const snapshot = await tx.get(syncRef);
      const now = new Date();
      const renewed = scheduleV2ShadowPolicy.renewLease(snapshot.data(), leaseId, now);
      if (!renewed) throw Object.assign(new Error("stale-run"), {code: "stale-run"});
      tx.set(syncRef, renewed, {merge: false});
    });
    try {
      await renewal;
      nextRenewalAt = Date.now() + SCHEDULE_V2_LEASE_HEARTBEAT_MS;
    } finally {
      renewal = null;
    }
  };
}

function scheduleV2TransitionExpectation(data) {
  const fields = ["expectedMode", "expectedGenerationId", "expectedEpoch", "expectedRevision"];
  if(!fields.some(field => data?.[field] !== undefined)) return null;
  if(fields.some(field => data?.[field] === undefined)) {
    throw new HttpsError("invalid-argument", "Schedule V2 전환 기준 상태가 완전하지 않습니다");
  }
  const expectedEpoch = data.expectedEpoch;
  const expectedRevision = data.expectedRevision;
  if(typeof data.expectedMode !== "string" || !data.expectedMode.trim() ||
      typeof data.expectedGenerationId !== "string" ||
      !Number.isSafeInteger(expectedEpoch) || expectedEpoch < 0 ||
      !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new HttpsError("invalid-argument", "Schedule V2 전환 기준 상태가 올바르지 않습니다");
  }
  return {
    mode: String(data.expectedMode).trim(),
    generationId: String(data.expectedGenerationId).trim(),
    epoch: expectedEpoch,
    revision: expectedRevision,
  };
}

function validateScheduleV2ActionData(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    throw new HttpsError("invalid-argument", "Schedule V2 요청 형식이 올바르지 않습니다");
  }
  if (typeof value.action !== "string" || value.action !== value.action.trim() ||
      typeof value.branchId !== "string" || value.branchId !== value.branchId.trim() ||
      !SCHEDULE_V2_ACTIONS.has(value.action) || !Object.hasOwn(BRANCHES, value.branchId)) {
    throw new HttpsError("invalid-argument", "Schedule V2 작업 또는 지점이 올바르지 않습니다");
  }
  const expectedKeys = value.action === "status" ? ["action", "branchId"] : [
    "action", "branchId", "expectedMode", "expectedGenerationId", "expectedEpoch", "expectedRevision",
  ];
  const actualKeys = Object.keys(value);
  if (actualKeys.length !== expectedKeys.length ||
      expectedKeys.some(key => !Object.hasOwn(value, key)) ||
      actualKeys.some(key => !expectedKeys.includes(key))) {
    throw new HttpsError("invalid-argument", "Schedule V2 요청 필드가 올바르지 않습니다");
  }
  if (value.action !== "status") scheduleV2TransitionExpectation(value);
  return value;
}

function scheduleV2RecoveryQueries(branchId) {
  const mutations = scheduleV2OperationalMutationCollection(branchId);
  const requests = scheduleV2RequestRecoveryCollection(branchId);
  return [
    mutations.where("status", "==", "committing"),
    ...SCHEDULE_V2_MIRROR_BLOCKING_STATES.map(state =>
      mutations.where("status", "==", "committed").where("recoveryState", "==", state)),
    ...SCHEDULE_V2_REQUEST_BLOCKING_STATES.map(state => requests.where("state", "==", state)),
  ];
}

function scheduleV2SnapshotCount(snapshot) {
  return Math.max(0, Number(snapshot?.size || snapshot?.docs?.length || 0) || 0);
}

function scheduleV2LeaseIsActive(value, now) {
  const until = Date.parse(String(value || ""));
  return Number.isFinite(until) && until > now.getTime();
}

function scheduleV2CanonicalProofIsValid(evidence, proof, branchId, generationId, expectation) {
  const digestPattern = /^[a-f0-9]{64}$/;
  return evidence && proof && evidence.matches === true &&
    String(evidence.proofId || "") === String(proof.proofId || "") &&
    String(evidence.purpose || "") === String(proof.purpose || "") &&
    String(evidence.branchId || "") === branchId &&
    String(evidence.generationId || "") === generationId &&
    String(evidence.sourceMode || "") === expectation.mode &&
    String(evidence.freezeToken || "") === String(proof.freezeToken || "") &&
    scheduleV2NonnegativeInteger(evidence.epoch) === expectation.epoch &&
    scheduleV2NonnegativeInteger(evidence.revision) === expectation.revision &&
    digestPattern.test(String(evidence.v1Digest || "")) &&
    String(evidence.v1Digest || "") === String(evidence.v2Digest || "");
}

async function acquireScheduleV2CanonicalFreeze(branchId, expectation, purpose, updatedBy, drain) {
  const configRef = scheduleV2RuntimeRef(branchId, "schedule");
  const syncRef = scheduleV2RuntimeRef(branchId, "scheduleSync");
  const operationalRef = scheduleV2RuntimeRef(branchId, "operational");
  const attendanceRef = scheduleV2RuntimeRef(branchId, "attendance");
  const freezeRef = scheduleV2RuntimeRef(branchId, "activationFreeze");
  const token = crypto.randomUUID();
  const now = new Date();
  const nowIso = now.toISOString();
  const leaseUntil = new Date(now.getTime() + SCHEDULE_V2_PREPARATION_LEASE_MS).toISOString();
  return db.runTransaction(async tx => {
    const [configSnapshot, syncSnapshot, operationalSnapshot, attendanceSnapshot, freezeSnapshot] =
      await Promise.all([
        tx.get(configRef), tx.get(syncRef), tx.get(operationalRef),
        tx.get(attendanceRef), tx.get(freezeRef),
      ]);
    const config = configSnapshot.data() || {};
    const sync = syncSnapshot.data() || {};
    const operational = operationalSnapshot.data() || {};
    const attendance = attendanceSnapshot.data() || {};
    const mode = String(operational.mode || config.mode || "");
    const generationId = String(operational.generationId || config.generationId || "");
    const epoch = scheduleV2NonnegativeInteger(operational.epoch);
    const revision = scheduleV2NonnegativeInteger(operational.revision);
    const attendanceEpoch = scheduleV2NonnegativeInteger(attendance.epoch);
    const attendanceRevision = scheduleV2NonnegativeInteger(attendance.revision);
    const requestedRevision = scheduleV2NonnegativeInteger(sync.requestedRevision);
    const appliedRevision = scheduleV2NonnegativeInteger(sync.appliedRevision);
    const allowedModes = purpose === "activation" ? ["verify"] : ["shadow", "verify", "v2-read", "v2"];
    if (epoch === null || revision === null || attendanceEpoch === null || attendanceRevision === null ||
        requestedRevision === null || appliedRevision === null) {
      throw new HttpsError("failed-precondition", "Schedule V2 authority counters are malformed");
    }
    if (!allowedModes.includes(mode) || String(config.mode || "") !== mode) {
      throw new HttpsError("failed-precondition", "Schedule V2 mode cannot enter this canonical transition");
    }
    if (!expectation || expectation.mode !== mode || expectation.generationId !== generationId ||
        expectation.epoch !== epoch || expectation.revision !== revision) {
      throw new HttpsError("aborted", "Schedule V2 authority changed before the canonical freeze");
    }
    if (!operationalSnapshot.exists || !attendanceSnapshot.exists ||
        !scheduleV2PointerMatches(operational, branchId, mode, generationId) ||
        !scheduleV2PointerMatches(attendance, branchId, mode, generationId) ||
        attendanceEpoch !== epoch || attendanceRevision !== revision) {
      throw new HttpsError("failed-precondition", "Schedule V2 authority pointers are inconsistent");
    }
    if (freezeSnapshot.data()?.active === true) {
      throw new HttpsError("aborted", "A Schedule V2 canonical freeze is already active");
    }
    const scheduleBlocked = scheduleV2Keys(sync, "pendingKeys").length ||
      scheduleV2Keys(sync, "inFlightKeys").length || scheduleV2Count(sync.mismatchCount) ||
      ["pending", "processing", "error"].includes(String(sync.status || "")) ||
      requestedRevision !== appliedRevision ||
      scheduleV2LeaseIsActive(sync.leaseUntil, now);
    if (scheduleBlocked) {
      throw new HttpsError("failed-precondition", "Schedule V2 source work must be idle before freezing");
    }
    const freeze = {
      active: true,
      state: drain ? "draining" : "parity",
      token,
      purpose,
      branchId,
      sourceMode: mode,
      generationId,
      epoch,
      revision,
      startedAt: nowIso,
      leaseUntil,
      updatedAt: nowIso,
      updatedBy,
    };
    tx.set(freezeRef, freeze, {merge: false});
    if (drain) {
      tx.set(syncRef, {
        ...sync,
        pendingKeys: [],
        inFlightKeys: [],
        status: "processing",
        leaseId: token,
        leaseUntil,
        processingStartedAt: nowIso,
      }, {merge: false});
    }
    return {
      branchId,
      generationId,
      token,
      purpose,
      drain,
      configRef,
      syncRef,
      freezeRef,
      generationRef: scheduleV2GenerationRef(branchId, generationId),
    };
  });
}

async function finishScheduleV2CanonicalDrain(freeze, result) {
  const nowIso = new Date().toISOString();
  await db.runTransaction(async tx => {
    const [configSnapshot, syncSnapshot, freezeSnapshot, generationSnapshot] = await Promise.all([
      tx.get(freeze.configRef), tx.get(freeze.syncRef), tx.get(freeze.freezeRef),
      tx.get(freeze.generationRef),
    ]);
    const config = configSnapshot.data() || {};
    const sync = syncSnapshot.data() || {};
    const currentFreeze = freezeSnapshot.data() || {};
    if (currentFreeze.active !== true || currentFreeze.token !== freeze.token ||
        sync.leaseId !== freeze.token || String(config.generationId || "") !== freeze.generationId) {
      throw new HttpsError("aborted", "Schedule V2 canonical drain lost its fence");
    }
    const requestedRevision = scheduleV2Count(sync.requestedRevision);
    const completed = {
      ...sync,
      pendingKeys: [],
      inFlightKeys: [],
      requestedRevision,
      appliedRevision: requestedRevision,
      status: "idle",
      mismatchCount: 0,
      lastSyncedAt: nowIso,
      collections: result.collections,
      counts: result.counts,
      digests: result.digests,
      writes: result.writes,
      deletes: result.deletes,
    };
    delete completed.leaseId;
    delete completed.leaseUntil;
    delete completed.processingStartedAt;
    delete completed.leaseHeartbeatAt;
    tx.set(freeze.syncRef, completed, {merge: false});
    if (generationSnapshot.exists) {
      tx.set(freeze.generationRef, scheduleV2GenerationWithSchedule(
        generationSnapshot.data() || {}, "ready", completed, new Date(nowIso),
      ), {merge: false});
    }
    tx.set(freeze.freezeRef, {
      ...currentFreeze, state: "parity", drainedAt: nowIso, updatedAt: nowIso,
    }, {merge: false});
  });
}

async function releaseScheduleV2CanonicalFreeze(freeze, state = "failed") {
  if (!freeze) return;
  await db.runTransaction(async tx => {
    const [freezeSnapshot, syncSnapshot] = await Promise.all([
      tx.get(freeze.freezeRef), freeze.drain ? tx.get(freeze.syncRef) : Promise.resolve(null),
    ]);
    const current = freezeSnapshot.data() || {};
    if (current.active !== true || current.token !== freeze.token) return;
    const nowIso = new Date().toISOString();
    tx.set(freeze.freezeRef, {
      ...current, active: false, state, releasedAt: nowIso, updatedAt: nowIso,
    }, {merge: false});
    const sync = syncSnapshot?.data() || {};
    if (freeze.drain && sync.leaseId === freeze.token) {
      const released = {
        ...sync,
        pendingKeys: [...new Set([
          ...scheduleV2Keys(sync, "pendingKeys"), ...scheduleV2Keys(sync, "inFlightKeys"),
        ])],
      };
      released.status = released.pendingKeys.length ? "pending" : "idle";
      delete released.inFlightKeys;
      delete released.leaseId;
      delete released.leaseUntil;
      delete released.processingStartedAt;
      delete released.leaseHeartbeatAt;
      tx.set(freeze.syncRef, released, {merge: false});
    }
  });
}

async function recordScheduleV2CanonicalProof(branchId, expectation, purpose, result, freeze) {
  const configRef = scheduleV2RuntimeRef(branchId, "schedule");
  const operationalRef = scheduleV2RuntimeRef(branchId, "operational");
  const attendanceRef = scheduleV2RuntimeRef(branchId, "attendance");
  const evidenceRef = scheduleV2RuntimeRef(branchId, "canonicalParity");
  const proofId = crypto.randomUUID();
  const digestPattern = /^[a-f0-9]{64}$/;
  await db.runTransaction(async tx => {
    const reads = [tx.get(configRef), tx.get(operationalRef), tx.get(attendanceRef)];
    if (freeze) reads.push(tx.get(freeze.freezeRef));
    const [configSnapshot, operationalSnapshot, attendanceSnapshot, freezeSnapshot] = await Promise.all(reads);
    const config = configSnapshot.data() || {};
    const operational = operationalSnapshot.data() || {};
    const attendance = attendanceSnapshot.data() || {};
    if (String(config.mode || "") !== expectation.mode ||
        String(config.generationId || "") !== expectation.generationId ||
        !scheduleV2PointerMatches(operational, branchId, expectation.mode, expectation.generationId) ||
        !scheduleV2PointerMatches(attendance, branchId, expectation.mode, expectation.generationId) ||
        scheduleV2NonnegativeInteger(operational.epoch) !== expectation.epoch ||
        scheduleV2NonnegativeInteger(operational.revision) !== expectation.revision ||
        scheduleV2NonnegativeInteger(attendance.epoch) !== expectation.epoch ||
        scheduleV2NonnegativeInteger(attendance.revision) !== expectation.revision) {
      throw new HttpsError("aborted", "Schedule V2 authority changed during canonical verification");
    }
    if (freeze && (freezeSnapshot.data()?.active !== true || freezeSnapshot.data()?.token !== freeze.token)) {
      throw new HttpsError("aborted", "Schedule V2 canonical freeze changed during verification");
    }
    const v1Digest = String(result?.v1Digest || "");
    const v2Digest = String(result?.v2Digest || "");
    const matches = result?.matches === true && digestPattern.test(v1Digest) && v1Digest === v2Digest;
    tx.set(evidenceRef, {
      proofId,
      purpose,
      branchId,
      sourceMode: expectation.mode,
      generationId: expectation.generationId,
      epoch: expectation.epoch,
      revision: expectation.revision,
      matches,
      v1Digest,
      v2Digest,
      v1KeyCount: scheduleV2Count(result?.v1KeyCount),
      v2KeyCount: scheduleV2Count(result?.v2KeyCount),
      freezeToken: freeze?.token || "",
      verifiedAt: new Date().toISOString(),
    }, {merge: false});
  });
  if (result?.matches !== true || !digestPattern.test(String(result?.v1Digest || "")) ||
      String(result?.v1Digest || "") !== String(result?.v2Digest || "")) {
    throw new HttpsError("failed-precondition", "Canonical V1 and V2 schedule state does not match");
  }
  return {proofId, purpose, freezeToken: freeze?.token || ""};
}

async function transitionScheduleV2Authority(branchId, targetMode, expectation, updatedBy, proof = null) {
  const configRef = scheduleV2RuntimeRef(branchId, "schedule");
  const syncRef = scheduleV2RuntimeRef(branchId, "scheduleSync");
  const operationalRef = scheduleV2RuntimeRef(branchId, "operational");
  const attendanceRef = scheduleV2RuntimeRef(branchId, "attendance");
  const recoveryFenceRef = scheduleV2RuntimeRef(branchId, "operationalRecovery");
  const evidenceRef = scheduleV2RuntimeRef(branchId, "canonicalParity");
  const freezeRef = scheduleV2RuntimeRef(branchId, "activationFreeze");
  await db.runTransaction(async tx => {
    const configSnapshot = await tx.get(configRef);
    const syncSnapshot = await tx.get(syncRef);
    const config = configSnapshot.data() || {};
    const sync = syncSnapshot.data() || {};
    const activeGenerationId = String(config.generationId || "");
    const targetGenerationId = targetMode === "shadow" ?
      String(config.preparedGenerationId || "") : activeGenerationId;
    const generationRef = targetGenerationId ? scheduleV2GenerationRef(branchId, targetGenerationId) : null;
    const recoveryQueries = scheduleV2RecoveryQueries(branchId);
    const [generationSnapshot, operationalSnapshot, attendanceSnapshot, recoveryFenceSnapshot,
      evidenceSnapshot, freezeSnapshot, ...queueSnapshots] =
      await Promise.all([
        generationRef ? tx.get(generationRef) : Promise.resolve(null),
        tx.get(operationalRef), tx.get(attendanceRef), tx.get(recoveryFenceRef),
        proof ? tx.get(evidenceRef) : Promise.resolve(null),
        proof?.freezeToken ? tx.get(freezeRef) : Promise.resolve(null),
        ...recoveryQueries.map(query => tx.get(query)),
      ]);
    const generation = generationSnapshot?.data() || {};
    const operational = operationalSnapshot.data() || {};
    const attendance = attendanceSnapshot.data() || {};
    const recoveryFence = recoveryFenceSnapshot.data() || {};
    const currentMode = operationalSnapshot.exists ? String(operational.mode || "") : String(config.mode || "v1");
    const currentGenerationId = operationalSnapshot.exists ?
      String(operational.generationId || "") : activeGenerationId;
    const epoch = operationalSnapshot.exists ? scheduleV2NonnegativeInteger(operational.epoch) : 0;
    const revision = operationalSnapshot.exists ? scheduleV2NonnegativeInteger(operational.revision) : 0;
    const attendanceEpoch = attendanceSnapshot.exists ? scheduleV2NonnegativeInteger(attendance.epoch) : 0;
    const attendanceRevision = attendanceSnapshot.exists ? scheduleV2NonnegativeInteger(attendance.revision) : 0;
    const requestedRevision = scheduleV2NonnegativeInteger(sync.requestedRevision);
    const appliedRevision = scheduleV2NonnegativeInteger(sync.appliedRevision);
    const scheduleCapability = generation.capabilities?.schedule || {};
    const attendanceCapability = generation.capabilities?.attendance || {};
    const now = new Date();

    if(epoch === null || epoch >= Number.MAX_SAFE_INTEGER || revision === null ||
        attendanceEpoch === null || attendanceRevision === null ||
        requestedRevision === null || appliedRevision === null) {
      throw new HttpsError("failed-precondition", "Schedule V2 런타임 리비전이 올바르지 않습니다");
    }

    if(!expectation || expectation.mode !== currentMode || expectation.generationId !== currentGenerationId ||
        expectation.epoch !== epoch || expectation.revision !== revision) {
      throw new HttpsError("aborted", "Schedule V2 상태가 변경되었습니다. 다시 확인해 주세요");
    }
    const allowedSourceModes = targetMode === "shadow" ? ["v1", "v2-read", "v2"] :
      targetMode === "verify" ? ["shadow"] :
      targetMode === "v2-read" ? ["verify"] :
      targetMode === "v2" ? ["v2-read"] : ["shadow", "verify", "v2-read", "v2"];
    if(!allowedSourceModes.includes(currentMode) || String(config.mode || "") !== currentMode) {
      throw new HttpsError("failed-precondition", "현재 Schedule V2 모드에서는 이 전환을 실행할 수 없습니다");
    }
    const implicitV1Pointers = !operationalSnapshot.exists && !attendanceSnapshot.exists &&
      currentMode === "v1" && epoch === 0 && revision === 0;
    const pointerConsistent = implicitV1Pointers || (
      operationalSnapshot.exists && attendanceSnapshot.exists &&
      String(config.branchId || branchId) === branchId && activeGenerationId === currentGenerationId &&
      scheduleV2PointerMatches(operational, branchId, currentMode, currentGenerationId) &&
      scheduleV2PointerMatches(attendance, branchId, currentMode, currentGenerationId) &&
      attendanceEpoch === epoch && attendanceRevision === revision
    );
    if(!pointerConsistent) {
      throw new HttpsError("failed-precondition", "Schedule V2 지점 또는 세대 포인터가 일치하지 않습니다");
    }
    if (proof && !scheduleV2CanonicalProofIsValid(
      evidenceSnapshot?.data() || {}, proof, branchId, currentGenerationId, expectation,
    )) {
      throw new HttpsError("failed-precondition", "Canonical V1 and V2 proof is stale or invalid");
    }
    if (proof?.freezeToken) {
      const freeze = freezeSnapshot?.data() || {};
      if (freeze.active !== true || freeze.token !== proof.freezeToken ||
          freeze.purpose !== proof.purpose || freeze.generationId !== currentGenerationId ||
          scheduleV2NonnegativeInteger(freeze.epoch) !== epoch ||
          scheduleV2NonnegativeInteger(freeze.revision) !== revision) {
        throw new HttpsError("failed-precondition", "Schedule V2 canonical freeze proof is stale");
      }
    }
    if(targetMode === "shadow" && (
      config.preparationStatus !== "ready" || config.requiresPrepare === true ||
      !targetGenerationId || targetGenerationId === currentGenerationId
    )) {
      throw new HttpsError("failed-precondition", "새 Schedule V2 기준점을 준비해야 합니다");
    }
    if(String(generation.branchId || "") !== branchId ||
        String(generation.generationId || generation.id || "") !== targetGenerationId ||
        (String(sync.generationId || targetGenerationId) !== targetGenerationId)) {
      throw new HttpsError("failed-precondition", "Schedule V2 준비 세대가 일치하지 않습니다");
    }
    const scheduleReady = scheduleV2ReadyCapability(scheduleCapability) &&
      scheduleV2NonnegativeInteger(scheduleCapability.requestedRevision) === requestedRevision &&
      scheduleV2NonnegativeInteger(scheduleCapability.appliedRevision) === appliedRevision;
    if(!scheduleReady || !scheduleV2ReadyCapability(attendanceCapability) ||
        requestedRevision !== appliedRevision) {
      throw new HttpsError("failed-precondition", "시간표와 출석 Schedule V2 준비 상태를 다시 확인해야 합니다");
    }
    const scheduleBlocked = scheduleV2Keys(sync, "pendingKeys").length ||
      scheduleV2Keys(sync, "inFlightKeys").length ||
      scheduleV2Count(sync.mismatchCount) ||
      ["pending", "processing", "error"].includes(String(sync.status || "")) ||
      scheduleV2LeaseIsActive(sync.leaseUntil, now);
    const recoveryBlocked = queueSnapshots.some(snapshot => scheduleV2SnapshotCount(snapshot) > 0) ||
      Boolean(String(operational.activeOperationId || "")) ||
      scheduleV2LeaseIsActive(recoveryFence.recoveryLeaseUntil, now);
    if(scheduleBlocked || recoveryBlocked) {
      throw new HttpsError("failed-precondition", "대기 중인 동기화 또는 복구 작업을 먼저 해결해야 합니다");
    }
    if(currentMode === "v2" && targetMode !== "v2" &&
        scheduleV2Count(operational.recoverySafeRevision) !== revision) {
      throw new HttpsError("failed-precondition", "현재 V1 복구본이 검증된 V2 리비전과 일치하지 않습니다");
    }

    const nowIso = now.toISOString();
    const nextEpoch = epoch + 1;
    const nextConfig = {
      ...config, branchId, mode: targetMode, generationId: targetGenerationId,
      requiresPrepare: targetMode === "v1", updatedAt: nowIso, updatedBy,
    };
    if (targetMode === "shadow") nextConfig.preparationStatus = "activated";
    if(targetMode === "v1") nextConfig.rolledBackAt = nowIso;
    const nextOperational = {
      ...operational, branchId, mode: targetMode, generationId: targetGenerationId,
      epoch: nextEpoch, revision,
      recoverySafeRevision: revision, updatedAt: nowIso, updatedBy,
    };
    const nextAttendance = {
      ...attendance, branchId, mode: targetMode, generationId: targetGenerationId,
      epoch: nextEpoch, revision,
      updatedAt: nowIso, updatedBy,
    };
    tx.set(configRef, nextConfig, {merge: false});
    tx.set(operationalRef, nextOperational, {merge: false});
    tx.set(attendanceRef, nextAttendance, {merge: false});
    if (proof?.freezeToken) {
      const freeze = freezeSnapshot.data() || {};
      tx.set(freezeRef, {
        ...freeze,
        active: false,
        state: "completed",
        targetMode,
        completedAt: nowIso,
        updatedAt: nowIso,
      }, {merge: false});
    }
  });
  return readScheduleV2Status(branchId);
}

async function rollbackScheduleV2(branchId, expectation, updatedBy) {
  const drain = ["shadow", "verify"].includes(expectation.mode);
  return frozenScheduleV2CanonicalTransition(branchId, "v1", expectation, updatedBy, "rollback", drain);
}

async function pauseScheduleV2Shadow(branchId, expectation, updatedBy) {
  const configRef = scheduleV2RuntimeRef(branchId, "schedule");
  const syncRef = scheduleV2RuntimeRef(branchId, "scheduleSync");
  const operationalRef = scheduleV2RuntimeRef(branchId, "operational");
  const attendanceRef = scheduleV2RuntimeRef(branchId, "attendance");
  await db.runTransaction(async tx => {
    const [configSnapshot, syncSnapshot, operationalSnapshot, attendanceSnapshot] = await Promise.all([
      tx.get(configRef), tx.get(syncRef), tx.get(operationalRef), tx.get(attendanceRef),
    ]);
    const config = configSnapshot.data() || {};
    const sync = syncSnapshot.data() || {};
    const operational = operationalSnapshot.data() || {};
    const attendance = attendanceSnapshot.data() || {};
    const mode = String(operational.mode || config.mode || "v1");
    const generationId = String(operational.generationId || config.generationId || "");
    const epoch = scheduleV2NonnegativeInteger(operational.epoch);
    const revision = scheduleV2NonnegativeInteger(operational.revision);
    const attendanceEpoch = scheduleV2NonnegativeInteger(attendance.epoch);
    const attendanceRevision = scheduleV2NonnegativeInteger(attendance.revision);
    if (!expectation || expectation.mode !== mode || expectation.generationId !== generationId ||
        expectation.epoch !== epoch || expectation.revision !== revision) {
      throw new HttpsError("aborted", "Schedule V2 상태가 변경되었습니다. 다시 확인해 주세요");
    }
    if (!["shadow", "verify"].includes(mode) || String(config.mode || "") !== mode) {
      throw new HttpsError("failed-precondition", "V1이 운영 기준인 동시운영 상태에서만 일시중단할 수 있습니다");
    }
    const pointerConsistent = operationalSnapshot.exists && attendanceSnapshot.exists &&
      String(config.branchId || branchId) === branchId && String(config.generationId || "") === generationId &&
      scheduleV2PointerMatches(operational, branchId, mode, generationId) &&
      scheduleV2PointerMatches(attendance, branchId, mode, generationId) &&
      attendanceEpoch === epoch && attendanceRevision === revision;
    if (!pointerConsistent || epoch === null || revision === null || epoch >= Number.MAX_SAFE_INTEGER) {
      throw new HttpsError("failed-precondition", "Schedule V2 운영 포인터가 일치하지 않습니다");
    }
    const nowIso = new Date().toISOString();
    const nextEpoch = epoch + 1;
    const nextSync = {
      ...sync,
      pendingKeys: [],
      inFlightKeys: [],
      status: "paused",
      pausedAt: nowIso,
      pausedBy: updatedBy,
    };
    delete nextSync.leaseId;
    delete nextSync.leaseUntil;
    delete nextSync.processingStartedAt;
    delete nextSync.leaseHeartbeatAt;
    tx.set(configRef, {
      ...config,
      branchId,
      mode: "v1",
      generationId,
      requiresPrepare: true,
      preparationStatus: "paused",
      pausedAt: nowIso,
      updatedAt: nowIso,
      updatedBy,
    }, {merge: false});
    tx.set(syncRef, nextSync, {merge: false});
    tx.set(operationalRef, {
      ...operational,
      branchId,
      mode: "v1",
      generationId,
      epoch: nextEpoch,
      revision,
      recoverySafeRevision: revision,
      pausedAt: nowIso,
      updatedAt: nowIso,
      updatedBy,
    }, {merge: false});
    tx.set(attendanceRef, {
      ...attendance,
      branchId,
      mode: "v1",
      generationId,
      epoch: nextEpoch,
      revision,
      pausedAt: nowIso,
      updatedAt: nowIso,
      updatedBy,
    }, {merge: false});
  });
  return readScheduleV2Status(branchId);
}

async function frozenScheduleV2CanonicalTransition(
  branchId, targetMode, expectation, updatedBy, purpose, drain,
) {
  const freeze = await acquireScheduleV2CanonicalFreeze(
    branchId, expectation, purpose, updatedBy, drain,
  );
  try {
    if (drain) {
      const branch = BRANCHES[branchId];
      const keys = await listScheduleV2BaselineKeys(branch);
      const result = await runShadowSync({
        db,
        branchId,
        generationId: freeze.generationId,
        keys,
        readLegacyKey: key => readStoredValue(branch, key),
        fence: {ref: freeze.syncRef, leaseId: freeze.token},
        fullGeneration: true,
      });
      await finishScheduleV2CanonicalDrain(freeze, result);
    }
    const parity = await readCanonicalParity({db, branchId, generationId: freeze.generationId});
    const proof = await recordScheduleV2CanonicalProof(branchId, expectation, purpose, parity, freeze);
    return await transitionScheduleV2Authority(branchId, targetMode, expectation, updatedBy, proof);
  } catch (error) {
    try {
      await releaseScheduleV2CanonicalFreeze(freeze);
    } catch {
      // Preserve the canonical transition failure; an active freeze remains fail-closed.
    }
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("failed-precondition", "Schedule V2 canonical transition failed");
  }
}

async function verifiedScheduleV2CanonicalTransition(
  branchId, targetMode, expectation, updatedBy, purpose,
) {
  try {
    const parity = await readCanonicalParity({db, branchId, generationId: expectation.generationId});
    const proof = await recordScheduleV2CanonicalProof(branchId, expectation, purpose, parity, null);
    return transitionScheduleV2Authority(branchId, targetMode, expectation, updatedBy, proof);
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("failed-precondition", "Schedule V2 canonical transition failed");
  }
}

async function recoverScheduleV2ShadowBranch(branchId, now) {
  const configRef = scheduleV2RuntimeRef(branchId, "schedule");
  const syncRef = scheduleV2RuntimeRef(branchId, "scheduleSync");
  return db.runTransaction(async tx => {
    const configSnapshot = await tx.get(configRef);
    if (!["shadow", "verify"].includes(configSnapshot.get("mode"))) return false;
    const snapshot = await tx.get(syncRef);
    if (Number(snapshot.data()?.retryCount || 0) >= SCHEDULE_V2_SHADOW_MAX_RETRY_COUNT) return false;
    const generationId = String(configSnapshot.get("generationId") || "");
    const generationRef = generationId ? scheduleV2GenerationRef(branchId, generationId) : null;
    const generationSnapshot = generationRef ? await tx.get(generationRef) : null;
    const recovered = scheduleV2ShadowPolicy.recoverExpired(snapshot.data(), now);
    if (!recovered) return false;
    if (scheduleV2Keys(snapshot.data(), "inFlightKeys").length) {
      recovered.retryCount = scheduleV2ShadowRetryCount(snapshot.data()?.retryCount);
    }
    tx.set(syncRef, recovered, {merge: false});
    if (generationRef && generationSnapshot?.exists) {
      tx.set(generationRef, scheduleV2GenerationWithSchedule(
        generationSnapshot.data() || {}, "syncing", recovered, now,
      ), {merge: false});
    }
    return true;
  });
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

function auditId() {
  return "log_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
}

function auditStudentText(stu) {
  if (!stu) return "-";
  return `${stu.n || "이름없음"}${stu.a ? `(${stu.a})` : ""}`;
}

function auditClassDetail(branch, stu, inst, ds) {
  const vars = classVars(branch, stu, inst, ds);
  const teacher = vars["담당선생님"] ? `${vars["담당선생님"]} 선생님` : "";
  return [vars["수업일"], vars["요일"], vars["수업시간"], teacher, "수업"].filter(Boolean).join(" ");
}

async function appendAuditLogTx(tx, branch, entry) {
  const stored = await readStoredValueWithMeta(branch, AUDIT_INDEX_KEY, tx);
  const raw = stored.value;
  const parsed = parseJSON(raw, []);
  let list = Array.isArray(parsed) ? parsed : [];
  const now = new Date().toISOString();
  const item = Object.assign({
    id: auditId(),
    at: now,
    type: "edit",
    label: "학부모 요청",
    target: "",
    detail: "",
    keys: [],
    tabId: "",
    tabName: "",
    user: "학부모 페이지",
  }, entry || {}, {
    at: entry && entry.at || now,
  });
  const entryKey = AUDIT_ENTRY_PREFIX + item.id;
  item.entryKey = entryKey;
  list = list.filter(row => row && row.id !== item.id);
  list.push(item);
  list.sort((a, b) => String(a && a.at || "").localeCompare(String(b && b.at || "")));
  const removed = list.length > AUDIT_LOG_MAX ? list.slice(0, list.length - AUDIT_LOG_MAX) : [];
  list = list.slice(Math.max(0, list.length - AUDIT_LOG_MAX));
  writeStoredValue(tx, branch, AUDIT_INDEX_KEY, JSON.stringify(list), stored.item);
  writeStoredValue(tx, branch, entryKey, JSON.stringify(item), null);
  removed.forEach(row => {
    if (row && String(row.entryKey || "").startsWith(AUDIT_ENTRY_PREFIX)) {
      tx.delete(kvDoc(branch, row.entryKey));
    }
  });
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

async function readStoredValueWithMeta(branch, key, tx) {
  const ref = kvDoc(branch, key);
  const snap = tx ? await tx.get(ref) : await ref.get();
  if (!snap.exists) return {item: null, value: null};
  const data = snap.data() || {};
  if (!data.chunked) return {item: data, value: data.value ?? null};
  const chunks = [];
  for (let i = 0; i < Number(data.chunkCount || 0); i++) {
    const chunkSnap = tx ? await tx.get(chunkDoc(branch, key, i)) : await chunkDoc(branch, key, i).get();
    chunks.push((chunkSnap.data() || {}).text || "");
  }
  const text = chunks.join("");
  let value = text;
  if (data.valueType === "json") {
    try { value = JSON.parse(text); } catch (error) { value = null; }
  }
  return {item: data, value};
}

async function readStoredValue(branch, key, tx) {
  const stored = await readStoredValueWithMeta(branch, key, tx);
  return stored.value;
}

function knownChunkCount(item) {
  if (!item || !item.chunked) return 0;
  return Math.max(0, Number(item.chunkCount || 0) || 0);
}

function deleteChunkRange(tx, branch, key, from, to) {
  const start = Math.max(0, Number(from || 0) || 0);
  const end = Math.max(start, Number(to || 0) || 0);
  for (let i = start; i < end; i++) tx.delete(chunkDoc(branch, key, i));
}

function deleteKnownChunks(tx, branch, key, item) {
  deleteChunkRange(tx, branch, key, 0, knownChunkCount(item));
}

function writeStoredValue(tx, branch, key, value, previousItem) {
  const normalized = normalizeStoredScheduleValue(key, parseJSON(value, value));
  if (normalized !== value) value = typeof value === "string" ? JSON.stringify(normalized) : normalized;
  const encoded = encodeStoredValue(value);
  const previousCount = knownChunkCount(previousItem);
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
    if (previousCount > chunks.length) deleteChunkRange(tx, branch, key, chunks.length, previousCount);
    return;
  }
  tx.set(kvDoc(branch, key), {
    key,
    value,
    chunked: false,
    updatedAt: FieldValue.serverTimestamp(),
  }, {merge: false});
  deleteKnownChunks(tx, branch, key, previousItem);
}

async function readJSON(branch, key, fallback) {
  return normalizeStoredScheduleValue(key, parseJSON(await readStoredValue(branch, key), fallback));
}

function publicAvailabilityRef(branch) {
  return db.collection(PUBLIC_AVAILABILITY_COLLECTION).doc(branch.id);
}

function publicAvailabilityBasisDate(periods) {
  const list = Array.isArray(periods) && periods.length ? periods : DEFAULT_PERIODS;
  const exact = list.find(period => {
    if (!period || !period.start) return false;
    const startYear = String(period.start).slice(0, 4);
    const month = String(Number(period.month || 0)).padStart(2, "0");
    return `${startYear}-${month}` === PUBLIC_AVAILABILITY_BASIS_MONTH;
  });
  return exact && exact.start || "2026-08-31";
}

function publicAvailabilityPayload(branch, summary) {
  const data = summary && typeof summary === "object" ? summary : {};
  return {
    branchId: branch.id,
    branchName: branch.name,
    basisMonth: PUBLIC_AVAILABILITY_BASIS_MONTH,
    basisDate: data.basisDate || "2026-08-31",
    updatedAt: data.updatedAtIso || "",
    days: data.days || {},
  };
}

async function computePublicAvailability(branch) {
  const [mainSetting, tabs, periods] = await Promise.all([
    readJSON(branch, "swim_main_tab", null),
    readJSON(branch, "swim_tab_list", []),
    readJSON(branch, "swim_periods", null),
  ]);
  const keys = publicAvailabilityKeys(mainSetting, tabs);
  const [students, inst, retire, enroll, disabled] = await Promise.all([
    readJSON(branch, keys.stuKey, []),
    readJSON(branch, keys.instKey, {}),
    readJSON(branch, "swim_retire", {}),
    readJSON(branch, "swim_enroll", {}),
    readJSON(branch, "swim_disabled", {}),
  ]);
  const basisDate = publicAvailabilityBasisDate(periods);
  const calculated = buildRegularAvailability({
    basisDate,
    students,
    inst,
    retire,
    enroll,
    disabled,
  });
  const updatedAtIso = new Date().toISOString();
  const summary = {
    schemaVersion: PUBLIC_AVAILABILITY_SCHEMA_VERSION,
    branchId: branch.id,
    basisMonth: PUBLIC_AVAILABILITY_BASIS_MONTH,
    basisDate,
    days: calculated.days,
    updatedAtIso,
    updatedAt: FieldValue.serverTimestamp(),
  };
  await publicAvailabilityRef(branch).set(summary, {merge: false});
  return publicAvailabilityPayload(branch, summary);
}

async function readPublicAvailability(branch) {
  const snap = await publicAvailabilityRef(branch).get();
  if (!snap.exists) return computePublicAvailability(branch);
  const data = snap.data() || {};
  if (data.schemaVersion !== PUBLIC_AVAILABILITY_SCHEMA_VERSION ||
      data.basisMonth !== PUBLIC_AVAILABILITY_BASIS_MONTH) {
    return computePublicAvailability(branch);
  }
  return publicAvailabilityPayload(branch, data);
}

function decodedScheduleKey(docId) {
  try {
    return decodeURIComponent(String(docId || ""));
  } catch (error) {
    return String(docId || "");
  }
}

async function readAligoSettings(branch) {
  const raw = parseJSON(await readStoredValue(branch, "swim_aligo_settings"), {});
  const settings = raw && typeof raw === "object" ? raw : {};
  settings.branchId = branch.id;
  settings.branchName = branch.name;
  settings.aligoBranch = branch.aligoBranch || branch.name;
  return settings;
}

function renderTemplateText(text, vars) {
  return String(text || "").replace(/#\{([^}]+)\}/g, (all, name) => {
    const key = String(name || "").trim();
    return vars[key] === undefined || vars[key] === null ? "" : String(vars[key]);
  });
}

function joinProxyUrl(base, path) {
  const b = String(base || ALIGO_PROXY_BASE).trim().replace(/\/+$/, "");
  const p = String(path || ALIGO_SEND_PATH).trim().replace(/^\/+/, "");
  if (!/^https?:\/\//i.test(b)) return ALIGO_PROXY_BASE.replace(/\/+$/, "") + "/" + p;
  return b + "/" + p;
}

function templateById(settings, id) {
  const tpl = settings && settings.templates && settings.templates[id];
  if (!tpl || tpl.enabled === false || !tpl.code) return null;
  return tpl;
}

function alimtalkSkip(reason, templateId, detail) {
  console.warn("alimtalk skipped", Object.assign({reason, templateId}, detail || {}));
  return {skipped: true, reason};
}

function recipientPhone(settings, kind, name) {
  const recipients = settings && settings.recipients || {};
  if (kind === "parent") return normalizePhone(name);
  if (kind === "desk") {
    const desk = recipients.fixed && recipients.fixed.desk;
    return desk && desk.enabled !== false ? normalizePhone(desk.phone) : "";
  }
  if (kind === "teacher") {
    const saved = recipients.teachers && recipients.teachers[name];
    return saved && saved.enabled !== false ? normalizePhone(saved.phone) : "";
  }
  if (kind && /^bus\d+$/.test(kind)) {
    const bus = recipients.fixed && recipients.fixed[kind];
    return bus && bus.enabled !== false ? normalizePhone(bus.phone) : "";
  }
  return "";
}

function vehicleKeyOfStudent(stu) {
  const source = [stu && stu.bus, stu && stu.vehicleName, stu && stu.car, stu && stu.route, stu && stu.loc].filter(Boolean).join(" ");
  const m = String(source || "").match(/([1-3])\s*호차/);
  return m ? `bus${m[1]}` : "";
}

async function sendAlimtalk(settings, templateId, receiverPhone, receiverName, vars) {
  const aligo = settings && settings.aligo || {};
  if (!aligo.enabled) return alimtalkSkip("disabled", templateId);
  const tpl = templateById(settings, templateId);
  const phone = normalizePhone(receiverPhone);
  if (!tpl) return alimtalkSkip("missing-template-or-code", templateId);
  if (!phone) return alimtalkSkip("missing-receiver", templateId, {receiverName});
  if (!settings.aligoBranch) return alimtalkSkip("missing-branch", templateId);
  if (!aligo.senderKey) return alimtalkSkip("missing-senderkey", templateId);
  if (!aligo.sender) return alimtalkSkip("missing-sender", templateId);
  const subject = renderTemplateText(tpl.emtitle || tpl.main || tpl.title || "슈퍼차일드 알림", vars);
  const message = renderTemplateText(tpl.body || "", vars);
  const body = new URLSearchParams();
  body.set("branch", settings.aligoBranch);
  body.set("senderkey", aligo.senderKey);
  body.set("sender", normalizePhone(aligo.sender));
  body.set("tpl_code", tpl.code);
  body.set("receiver_1", phone);
  if (receiverName) body.set("recvname_1", receiverName);
  body.set("subject_1", subject);
  body.set("emtitle_1", subject);
  body.set("message_1", message);
  body.set("failover", "N");
  body.set("testMode", aligo.testMode ? "Y" : "N");
  const linkM = renderTemplateText(tpl.linkM || tpl.link || "", vars);
  const linkP = renderTemplateText(tpl.linkP || tpl.linkM || tpl.link || "", vars);
  const buttonName = renderTemplateText(tpl.buttonName || "", vars);
  if (buttonName && linkM && linkP) {
    body.set("button_1", JSON.stringify({
      button: [{
        name: buttonName,
        linkType: "WL",
        linkTypeName: "웹링크",
        linkM,
        linkP,
      }],
    }));
  }
  try {
    const response = await fetch(joinProxyUrl(aligo.proxyUrl, aligo.sendPath), {
      method: "POST",
      headers: {"Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"},
      body,
    });
    const text = await response.text();
    let result = text;
    try { result = JSON.parse(text); } catch (error) {}
    if (!response.ok) console.error("alimtalk failed", templateId, result);
    return result;
  } catch (error) {
    console.error("alimtalk error", templateId, error.message);
    return {error: error.message};
  }
}

function classVars(branch, stu, inst, ds, extra) {
  const parts = dateParts(ds);
  const dayText = parts.dayText || (stu && stu.d ? `${stu.d}요일` : "");
  return Object.assign({
    "지점명": branch.name,
    "학생명": stu && stu.n || "",
    "수업일": parts.dateText,
    "요일": dayText,
    "수업시간": displayTimeForDay(stu && stu.d, stu && stu.t),
    "담당선생님": inst && inst.n || "",
    "보류사유": "일정 조정 필요",
    "차량명": "",
    "차량시간": displayTimeForDay(stu && stu.d, stu && stu.t),
  }, extra || {});
}

async function notifyMany(settings, jobs) {
  await Promise.all((jobs || []).map(job =>
    sendAlimtalk(settings, job.templateId, job.phone, job.name, job.vars).catch(error => {
      console.error("notify job failed", job.templateId, error.message);
    })
  ));
}

async function notifyJobsWithResult(settings, jobs) {
  return Promise.all((jobs || []).map(async job => {
    try {
      const result = await sendAlimtalk(settings, job.templateId, job.phone, job.name, job.vars);
      const skipped = !!(result && result.skipped);
      const error = result && result.error;
      return {
        templateId: job.templateId,
        ok: !skipped && !error,
        skipped,
        reason: result && result.reason || "",
        result,
      };
    } catch (error) {
      console.error("notify job failed", job.templateId, error.message);
      return {templateId: job.templateId, ok: false, error: error.message};
    }
  }));
}

function requireStaffAuth(request) {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "직원 로그인이 필요합니다");
  }
  return request.auth;
}

function targetSlotKeyOfRequest(req) {
  const parent = req && req.parent || {};
  if (parent.studentSlotKey) return normalizeSlotKey(parent.studentSlotKey);
  const target = req && req.target || {};
  if (target.t && target.d && target.l && target.r) {
    return normalizeSlotKey([target.t, target.d, target.l, target.r].join("/"));
  }
  return "";
}

function studentFromRequest(req) {
  const parent = req && req.parent || {};
  const target = req && req.target || {};
  return {
    n: parent.name || "",
    a: parent.age || "",
    p: parent.phone || "",
    t: target.t || "",
    d: target.d || "",
    l: target.l || "",
    r: target.r || "",
  };
}

function instFromRequest(req) {
  const target = req && req.target || {};
  const parent = req && req.parent || {};
  return {
    n: target.instName || parent.sourceInstName || "",
  };
}

async function findStudentForRequest(branch, req) {
  const slotKey = targetSlotKeyOfRequest(req);
  const parent = req && req.parent || {};
  const name = String(parent.name || "").trim();
  const phone = normalizePhone(parent.phone);
  const tabs = await readScheduleTabs(branch);
  for (const tab of tabs) {
    const students = await readJSON(branch, tab.stuKey, []);
    const list = Array.isArray(students) ? students : [];
    const exact = list.find(stu =>
      slotKeyOf(stu) === slotKey &&
      (!name || stu.n === name) &&
      (!phone || normalizePhone(stu.p) === phone)
    );
    if (exact) return exact;
    const samePerson = list.find(stu =>
      (!name || stu.n === name) &&
      (!phone || normalizePhone(stu.p) === phone)
    );
    if (samePerson) return samePerson;
  }
  return null;
}

function requestVars(branch, req, targetOverride) {
  const target = targetOverride || req && req.target || {};
  const stu = Object.assign(studentFromRequest(req), {
    t: target.t || "",
    d: target.d || "",
    l: target.l || "",
    r: target.r || "",
  });
  const inst = instFromRequest(req);
  const ds = target.ds || req && req.parent && req.parent.absentDs || "";
  return classVars(branch, stu, inst, ds);
}

async function notifyStaffRequestProcessed(branch, data, request) {
  requireStaffAuth(request);
  const req = data.request && typeof data.request === "object" ? data.request : null;
  const status = String(data.status || "");
  if (!req || !req.type) throw new HttpsError("invalid-argument", "요청 정보가 없습니다");
  if (!["accepted", "rejected"].includes(status)) throw new HttpsError("invalid-argument", "처리 상태가 올바르지 않습니다");

  const settings = await readAligoSettings(branch);
  const parent = req.parent || {};
  const vars = requestVars(branch, req, req.target || {});
  const jobs = [];

  if (req.type === "bogang") {
    if (status === "accepted") {
      jobs.push({templateId: "parent_makeup_accepted", phone: parent.phone, name: parent.name, vars});
    } else if (status === "rejected") {
      jobs.push({templateId: "parent_makeup_rejected", phone: parent.phone, name: parent.name, vars});
    }
  } else if (req.type === "bogang-cancel") {
    if (status === "accepted") {
      jobs.push({templateId: "parent_makeup_cancelled", phone: parent.phone, name: parent.name, vars});
    }
  } else if (req.type === "absent-cancel") {
    if (status === "accepted") {
      const teacherName = (req.target && req.target.instName) || (req.parent && req.parent.sourceInstName) || "";
      jobs.push(
        {templateId: "parent_absent_cancel", phone: parent.phone, name: parent.name, vars},
        {templateId: "staff_absent_cancel", phone: recipientPhone(settings, "teacher", teacherName), name: teacherName, vars},
        {templateId: "staff_absent_cancel", phone: recipientPhone(settings, "desk"), name: "데스크", vars}
      );
      const stu = await findStudentForRequest(branch, req);
      const vehicleKey = vehicleKeyOfStudent(stu);
      if (vehicleKey) {
        jobs.push({
          templateId: "vehicle_absent_cancel",
          phone: recipientPhone(settings, vehicleKey),
          name: `${vehicleKey.replace("bus", "")}호차`,
          vars: Object.assign({}, vars, {"차량명": `${vehicleKey.replace("bus", "")}호차`}),
        });
      }
    }
  } else {
    throw new HttpsError("invalid-argument", "지원하지 않는 요청 종류입니다");
  }

  const results = await notifyJobsWithResult(settings, jobs);
  return {ok: true, results};
}

async function readBaseData(branch, dataKeys) {
  const keys = normalizeDataKeys(dataKeys);
  const [students, inst, mark, closed, periods, hyuwon, requests] = await Promise.all([
    readJSON(branch, keys.stuKey, []),
    readJSON(branch, keys.instKey, {}),
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
    dataKeys: keys,
  };
}

function tabDataKeys(tab) {
  const id = String(tab && tab.id || "regular");
  if (tab && tab.type === "snapshot") return null;
  if (tab && tab.type === "bangteuk") {
    return {tabId: id, tabName: tab.name || "", stuKey: `swim_bt_${id}_stu`, instKey: `swim_bt_${id}_inst`};
  }
  return {
    tabId: id,
    tabName: tab && tab.name || "",
    stuKey: id === "regular" ? "swim_students" : `swim_stu_${id}`,
    instKey: id === "regular" ? "swim_inst" : `swim_inst_${id}`,
  };
}

function tabRank(tab, index) {
  const id = String(tab && tab.id || "");
  const match = id.match(/_(\d{10,})$/);
  return (match ? Number(match[1]) : 0) * 1000 + index;
}

function normalizeDataKeys(keys) {
  return {
    tabId: keys && keys.tabId || "regular",
    tabName: keys && keys.tabName || "",
    stuKey: keys && keys.stuKey || "swim_students",
    instKey: keys && keys.instKey || "swim_inst",
  };
}

function sessionDataKeys(session) {
  return normalizeDataKeys(session);
}

async function readScheduleTabs(branch) {
  const tabs = await readJSON(branch, "swim_tab_list", []);
  const parentTabSetting = await readJSON(branch, "swim_parent_tab", null);
  const parentTab = parentTabSetting && parentTabSetting.tabId ? normalizeDataKeys(parentTabSetting) : null;
  const list = Array.isArray(tabs) && tabs.length ? tabs : [{id: "regular", name: "정규시간표", type: "regular"}];
  const candidates = [];
  list.forEach((tab, index) => {
    const keys = tabDataKeys(tab);
    if (!keys) return;
    candidates.push({...keys, rank: tabRank(tab, index)});
  });
  if (!candidates.some(item => item.tabId === "regular")) {
    candidates.push({...tabDataKeys({id: "regular", name: "정규시간표", type: "regular"}), rank: -1});
  }
  const selected = parentTab && candidates.find(item => item.tabId === parentTab.tabId);
  if (selected) return [selected];
  candidates.sort((a, b) => b.rank - a.rank);
  return candidates;
}

async function findParentStudentSet(branch, name, phone) {
  const tabs = await readScheduleTabs(branch);
  const reads = await Promise.all(tabs.map(async tab => {
    const students = await readJSON(branch, tab.stuKey, []);
    const matches = (Array.isArray(students) ? students : [])
      .filter(s => s.n === name && normalizePhone(s.p) === phone);
    return {...tab, students: matches};
  }));
  return reads.find(item => item.students.length) || null;
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

function sameDayCancelError(branch) {
  return `당일 결석취소 요청은 온라인 접수가 불가합니다. 유선문의 부탁드립니다. ${branch.name} ${branch.phone || ""}`.trim();
}

function addDaysString(ds, days) {
  const date = new Date(ds + "T12:00:00+09:00");
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function maxBogangDateString() {
  return addDaysString(todayString(), 10);
}

function makeSessionId() {
  return crypto.randomBytes(24).toString("base64url");
}

function sessionRef(token) {
  return db.collection("parentSessions").doc(token);
}

async function createSession(branch, students, dataKeys) {
  const token = makeSessionId();
  const first = students[0];
  const expiresAt = Timestamp.fromMillis(Date.now() + 1000 * 60 * 60 * 12);
  const keys = normalizeDataKeys(dataKeys);
  await sessionRef(token).set({
    branch: branch.id,
    name: first.n || "",
    phone: normalizePhone(first.p),
    slotKeys: students.map(slotKeyOf),
    tabId: keys.tabId,
    tabName: keys.tabName,
    stuKey: keys.stuKey,
    instKey: keys.instKey,
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
  if (session.name && session.phone) {
    const phone = normalizePhone(session.phone);
    const found = await findParentStudentSet(branch, session.name, phone);
    if (found && found.students.length) {
      const slotKeys = found.students.map(slotKeyOf);
      const changed =
        session.stuKey !== found.stuKey ||
        session.instKey !== found.instKey ||
        JSON.stringify(session.slotKeys || []) !== JSON.stringify(slotKeys);
      session.slotKeys = slotKeys;
      session.tabId = found.tabId;
      session.tabName = found.tabName;
      session.stuKey = found.stuKey;
      session.instKey = found.instKey;
      session.phone = phone;
      if (changed) {
        await sessionRef(token).set({
          slotKeys: session.slotKeys,
          tabId: session.tabId,
          tabName: session.tabName,
          stuKey: session.stuKey,
          instKey: session.instKey,
          phone,
        }, {merge: true});
      }
    }
  }
  return session;
}

function requestMatchesSession(req, slotSet, session) {
  const p = req && req.parent || {};
  if (slotSet.has(p.studentSlotKey)) return true;
  const name = String(session && session.name || "").trim();
  const phone = normalizePhone(session && session.phone);
  return !!(name && phone && p.name === name && normalizePhone(p.phone) === phone);
}

function filterBundle(base, slotKeys, session) {
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
    if (requestMatchesSession(req, slotSet, session)) {
      requests[id] = req;
      const p = req && req.parent || {};
      if (req.instKey && base.inst[req.instKey]) inst[req.instKey] = base.inst[req.instKey];
      if (p.sourceInstKey && base.inst[p.sourceInstKey]) inst[p.sourceInstKey] = base.inst[p.sourceInstKey];
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
  const base = await readBaseData(branch, sessionDataKeys(session));
  return filterBundle(base, session.slotKeys || [], session);
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
  const today = todayString();
  const limit = maxBogangDateString();
  const start = visible.length && visible[0].start > today ? visible[0].start : today;
  const periodEnd = visible.length ? (visible[visible.length - 1].end || visible[visible.length - 1].start) : start;
  const end = periodEnd < limit ? periodEnd : limit;
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
  if (isBangteukInst(inst)) return 6;
  return inst && (inst.elma || inst.cls === "elma" || inst.cls === "elite" || inst.cls === "master") ? 8 : 5;
}

function assertBogangDateAllowed(ds) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ds || ""))) {
    throw new HttpsError("invalid-argument", "보강 날짜가 올바르지 않습니다");
  }
  const today = todayString();
  const limit = maxBogangDateString();
  if (ds < today || ds > limit) {
    throw new HttpsError("failed-precondition", "보강 신청은 오늘부터 10일 이내 날짜만 가능합니다");
  }
}

function availableSlotsFor(base, session, sourceSlotKey, ds, teacherMode) {
  assertBogangDateAllowed(ds);
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
  candidates.sort((a, b) =>
    sortTimeValue(a.day, a.t) - sortTimeValue(b.day, b.t) ||
    String(a.instName || "").localeCompare(String(b.instName || ""), "ko") ||
    Number(a.lane) - Number(b.lane) ||
    Number(a.row) - Number(b.row)
  );
  return candidates;
}

async function login(branch, data) {
  const name = String(data.name || "").trim();
  const phone = normalizePhone(data.phone);
  if (!name || !phone) throw new HttpsError("invalid-argument", "이름과 전화번호를 입력해주세요");
  const found = await findParentStudentSet(branch, name, phone);
  if (!found) throw new HttpsError("not-found", "일치하는 정보가 없습니다");
  const base = await readBaseData(branch, found);
  const students = found.students;
  if (!students.length) throw new HttpsError("not-found", "일치하는 정보가 없습니다");
  const token = await createSession(branch, students, found);
  const session = {slotKeys: students.map(slotKeyOf)};
  return {sessionToken: token, bundle: filterBundle(base, session.slotKeys, {name, phone}), dates: bogangDateOptions(base, todayString())};
}

async function refresh(branch, data) {
  const session = await loadSession(branch, data.sessionToken);
  return {bundle: await bundleForSession(branch, session)};
}

async function submitFeedback(branch, data) {
  const message = String(data.message || "").trim();
  if (!message) throw new HttpsError("invalid-argument", "의견 내용을 입력해주세요");
  if (message.length > 2000) throw new HttpsError("invalid-argument", "의견은 2000자 이내로 입력해주세요");
  const feedbackKey = "swim_parent_feedback";
  await db.runTransaction(async tx => {
    const stored = await readStoredValueWithMeta(branch, feedbackKey, tx);
    const feedback = parseJSON(stored.value, []);
    const list = Array.isArray(feedback) ? feedback : [];
    list.push({
      id: "fb_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      at: new Date().toISOString(),
      context: String(data.context || "의견 제출").slice(0, 80),
      message,
      name: String(data.name || "").trim().slice(0, 40),
      phone: normalizePhone(data.phone).slice(0, 20),
      studentSlotKey: String(data.studentSlotKey || "").slice(0, 80),
      page: String(data.page || "").slice(0, 200),
      userAgent: String(data.userAgent || "").slice(0, 300),
      status: "new",
    });
    while (list.length > 500) list.shift();
    writeStoredValue(tx, branch, feedbackKey, JSON.stringify(list), stored.item);
  });
  return {ok: true};
}

async function submitAbsent(branch, data) {
  const session = await loadSession(branch, data.sessionToken);
  const keys = sessionDataKeys(session);
  const slotKey = String(data.slotKey || "");
  const ds = String(data.ds || "");
  const vehicleMode = String(data.vehicleMode || "") === "bus" ? "bus" : "self";
  let notifyCtx = null;
  await db.runTransaction(async tx => {
    const markStored = await readStoredValueWithMeta(branch, "swim_mark", tx);
    const base = {
      students: parseJSON(await readStoredValue(branch, keys.stuKey, tx), []),
      inst: parseJSON(await readStoredValue(branch, keys.instKey, tx), {}),
      mark: parseJSON(markStored.value, {}),
    };
    const stu = findSessionStudent(base, session, slotKey);
    const inst = base.inst[instKeyOf(stu)];
    const markKey = `${slotKey}/${ds}`;
    const current = base.mark[markKey];
    const absentMark = {
      type: "absent",
      source: "parent",
      status: "accepted",
      acceptedAt: new Date().toISOString(),
      vehicleMode,
      vehicleLabel: vehicleMode === "bus" ? "차량이용" : "자가등하원",
    };
    if (current && (current.type === "bogang" || current.type === "sample")) absentMark.sub = current;
    base.mark[markKey] = absentMark;
    notifyCtx = {stu, inst, ds, vehicleMode};
    await appendAuditLogTx(tx, branch, {
      label: "학부모 결석 신청",
      target: auditStudentText(stu),
      detail: `${auditClassDetail(branch, stu, inst, ds)} / ${absentMark.vehicleLabel}`,
      keys: ["swim_mark"],
      tabId: keys.tabId,
      tabName: keys.tabName || "학부모 기준 시간표",
      user: "학부모 페이지",
    });
    writeStoredValue(tx, branch, "swim_mark", JSON.stringify(base.mark), markStored.item);
  });
  if (notifyCtx) {
    const settings = await readAligoSettings(branch);
    const vars = classVars(branch, notifyCtx.stu, notifyCtx.inst, notifyCtx.ds, {
      "등하원방식": notifyCtx.vehicleMode === "bus" ? "차량이용" : "자가등하원",
    });
    const teacherName = notifyCtx.inst && notifyCtx.inst.n || "";
    const jobs = [
      {templateId: "parent_absent_done", phone: notifyCtx.stu.p, name: notifyCtx.stu.n, vars},
      {templateId: "staff_absent_done", phone: recipientPhone(settings, "teacher", teacherName), name: teacherName, vars},
      {templateId: "staff_absent_done", phone: recipientPhone(settings, "desk"), name: "데스크", vars},
    ];
    const vehicleKey = notifyCtx.vehicleMode === "bus" ? vehicleKeyOfStudent(notifyCtx.stu) : "";
    if (vehicleKey) {
      jobs.push({
        templateId: "vehicle_absent",
        phone: recipientPhone(settings, vehicleKey),
        name: vehicleKey,
        vars: Object.assign({}, vars, {"차량명": `${vehicleKey.replace("bus", "")}호차`}),
      });
    }
    await notifyMany(settings, jobs);
  }
  return {bundle: await bundleForSession(branch, session)};
}

async function submitAbsentCancel(branch, data) {
  const session = await loadSession(branch, data.sessionToken);
  const keys = sessionDataKeys(session);
  const slotKey = String(data.slotKey || "");
  const ds = String(data.ds || "");
  if (ds === todayString()) throw new HttpsError("failed-precondition", sameDayCancelError(branch));
  let notifyCtx = null;
  await db.runTransaction(async tx => {
    const requestsStored = await readStoredValueWithMeta(branch, "swim_requests", tx);
    const students = parseJSON(await readStoredValue(branch, keys.stuKey, tx), []);
    const inst = parseJSON(await readStoredValue(branch, keys.instKey, tx), {});
    const requests = parseJSON(requestsStored.value, {});
    const stu = findSessionStudent({students}, session, slotKey);
    const exists = Object.values(requests).some(req =>
      req && req.type === "absent-cancel" &&
      (!req.status || req.status === "pending") &&
      req.parent && req.parent.studentSlotKey === slotKey &&
      req.target && req.target.ds === ds
    );
    if (exists) throw new HttpsError("already-exists", "이미 취소 신청이 접수되었습니다");
    const teacher = inst[instKeyOf(stu)];
    notifyCtx = {stu, inst: teacher, ds};
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
    await appendAuditLogTx(tx, branch, {
      label: "학부모 결석취소 요청",
      target: auditStudentText(stu),
      detail: auditClassDetail(branch, stu, teacher, ds),
      keys: ["swim_requests"],
      tabId: keys.tabId,
      tabName: keys.tabName || "학부모 기준 시간표",
      user: "학부모 페이지",
    });
    writeStoredValue(tx, branch, "swim_requests", JSON.stringify(requests), requestsStored.item);
  });
  if (notifyCtx) {
    const settings = await readAligoSettings(branch);
    const vars = classVars(branch, notifyCtx.stu, notifyCtx.inst, notifyCtx.ds);
    await notifyMany(settings, [
      {templateId: "parent_absent_cancel_requested", phone: notifyCtx.stu.p, name: notifyCtx.stu.n, vars},
      {templateId: "desk_absent_cancel_requested", phone: recipientPhone(settings, "desk"), name: "데스크", vars},
    ]);
  }
  return {bundle: await bundleForSession(branch, session)};
}

async function getBogangSlots(branch, data) {
  const session = await loadSession(branch, data.sessionToken);
  const base = await readBaseData(branch, sessionDataKeys(session));
  return {
    slots: availableSlotsFor(base, session, String(data.sourceSlotKey || ""), String(data.ds || ""), data.teacherMode === "other" ? "other" : "mine"),
    dates: bogangDateOptions(base, String(data.sourceDs || data.ds || todayString())),
    bundle: filterBundle(base, session.slotKeys || [], session),
  };
}

async function submitBogang(branch, data) {
  const session = await loadSession(branch, data.sessionToken);
  const keys = sessionDataKeys(session);
  const sourceSlotKey = String(data.sourceSlotKey || "");
  const sourceDs = data.sourceDs || null;
  const selected = Array.isArray(data.slots) ? data.slots : [];
  if (!selected.length) throw new HttpsError("invalid-argument", "수업을 선택해주세요");
  let notifyCtx = null;
  await db.runTransaction(async tx => {
    const requestsStored = await readStoredValueWithMeta(branch, "swim_requests", tx);
    const base = {
      students: parseJSON(await readStoredValue(branch, keys.stuKey, tx), []),
      inst: parseJSON(await readStoredValue(branch, keys.instKey, tx), {}),
      mark: parseJSON(await readStoredValue(branch, "swim_mark", tx), {}),
      closed: parseJSON(await readStoredValue(branch, "swim_closed", tx), []),
      periods: parseJSON(await readStoredValue(branch, "swim_periods", tx), DEFAULT_PERIODS),
      requests: parseJSON(requestsStored.value, {}),
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
    notifyCtx = {stu: source, inst: sourceInst, ds: sourceDs};
    await appendAuditLogTx(tx, branch, {
      label: "학부모 보강 신청",
      target: auditStudentText(source),
      detail: `${auditClassDetail(branch, source, sourceInst, sourceDs)} · 후보 ${selected.length}개`,
      keys: ["swim_requests"],
      tabId: keys.tabId,
      tabName: keys.tabName || "학부모 기준 시간표",
      user: "학부모 페이지",
    });
    writeStoredValue(tx, branch, "swim_requests", JSON.stringify(base.requests), requestsStored.item);
  });
  if (notifyCtx) {
    const settings = await readAligoSettings(branch);
    const vars = classVars(branch, notifyCtx.stu, notifyCtx.inst, notifyCtx.ds);
    const teacherName = notifyCtx.inst && notifyCtx.inst.n || "";
    await notifyMany(settings, [
      {templateId: "parent_makeup_pending", phone: notifyCtx.stu.p, name: notifyCtx.stu.n, vars},
      {templateId: "teacher_makeup_pending", phone: recipientPhone(settings, "teacher", teacherName), name: teacherName, vars},
    ]);
  }
  return {bundle: await bundleForSession(branch, session)};
}

async function cancelBogang(branch, data) {
  const session = await loadSession(branch, data.sessionToken);
  const keys = sessionDataKeys(session);
  const sourceSlotKey = String(data.sourceSlotKey || "");
  const sourceDs = String(data.sourceDs || "");
  if (!sourceSlotKey || !sourceDs) throw new HttpsError("invalid-argument", "취소할 보강 신청 정보가 없습니다");
  let notifyCtx = null;
  let cancelStatus = "cancelled";
  await db.runTransaction(async tx => {
    const requestsStored = await readStoredValueWithMeta(branch, "swim_requests", tx);
    const students = parseJSON(await readStoredValue(branch, keys.stuKey, tx), []);
    const inst = parseJSON(await readStoredValue(branch, keys.instKey, tx), {});
    const requests = parseJSON(requestsStored.value, {});
    const stu = findSessionStudent({students}, session, sourceSlotKey);
    const sourceInst = inst[instKeyOf(stu)];
    const matched = Object.entries(requests).filter(([, req]) =>
      req && req.type === "bogang" &&
      (!req.status || req.status === "pending") &&
      req.parent && req.parent.studentSlotKey === sourceSlotKey &&
      req.parent.absentDs === sourceDs
    );
    const cancelledAt = new Date().toISOString();
    if (matched.length) {
      matched.forEach(([id, req]) => {
        requests[id] = Object.assign({}, req, {
          status: "cancelled",
          cancelledAt,
          cancelledBy: "parent",
        });
      });
      notifyCtx = {stu, inst: sourceInst, ds: sourceDs};
      await appendAuditLogTx(tx, branch, {
        label: "학부모 보강 신청 취소",
        target: auditStudentText(stu),
        detail: `${auditClassDetail(branch, stu, sourceInst, sourceDs)} · 대기 후보 ${matched.length}개 취소`,
        keys: ["swim_requests"],
        tabId: keys.tabId,
        tabName: keys.tabName || "학부모 기준 시간표",
        user: "학부모 페이지",
      });
    } else {
      const accepted = Object.entries(requests).find(([, req]) =>
        req && req.type === "bogang" &&
        req.status === "accepted" &&
        req.parent && req.parent.studentSlotKey === sourceSlotKey &&
        req.parent.absentDs === sourceDs
      );
      if (!accepted) throw new HttpsError("not-found", "취소할 보강 신청이 없습니다");
      const [acceptedId, acceptedReq] = accepted;
      const exists = Object.values(requests).some(req =>
        req && req.type === "bogang-cancel" &&
        (!req.status || req.status === "pending") &&
        req.parent && req.parent.studentSlotKey === sourceSlotKey &&
        req.parent.absentDs === sourceDs
      );
      if (exists) throw new HttpsError("already-exists", "이미 보강 취소 요청이 접수되었습니다");
      requests[makeReqId()] = {
        type: "bogang-cancel",
        status: "pending",
        parent: Object.assign({}, acceptedReq.parent || {}, {
          studentSlotKey: sourceSlotKey,
          name: stu.n,
          age: stu.a || null,
          phone: stu.p || null,
          absentDs: sourceDs,
          sourceInstKey: instKeyOf(stu),
          sourceInstName: sourceInst && sourceInst.n || "",
          sourceClassLabel: instClassText(sourceInst),
        }),
        target: Object.assign({}, acceptedReq.target || {}),
        instKey: acceptedReq.instKey || "",
        sourceBogangReqId: acceptedId,
        requestedAt: cancelledAt,
      };
      cancelStatus = "requested";
      await appendAuditLogTx(tx, branch, {
        label: "학부모 보강취소 요청",
        target: auditStudentText(stu),
        detail: `${auditClassDetail(branch, stu, sourceInst, sourceDs)} · 확정 보강 취소 승인 대기`,
        keys: ["swim_requests"],
        tabId: keys.tabId,
        tabName: keys.tabName || "학부모 기준 시간표",
        user: "학부모 페이지",
      });
    }
    writeStoredValue(tx, branch, "swim_requests", JSON.stringify(requests), requestsStored.item);
  });
  if (notifyCtx && cancelStatus === "cancelled") {
    const settings = await readAligoSettings(branch);
    const vars = classVars(branch, notifyCtx.stu, notifyCtx.inst, notifyCtx.ds);
    const teacherName = notifyCtx.inst && notifyCtx.inst.n || "";
    await notifyMany(settings, [
      {templateId: "parent_makeup_cancelled", phone: notifyCtx.stu.p, name: notifyCtx.stu.n, vars},
      {templateId: "teacher_makeup_cancelled", phone: recipientPhone(settings, "teacher", teacherName), name: teacherName, vars},
    ]);
  }
  return {bundle: await bundleForSession(branch, session), cancelStatus};
}

exports.parentPortal = onCall({
  serviceAccount: "45509278949-compute@developer.gserviceaccount.com",
}, async request => {
  const data = request.data || {};
  const branch = safeBranch(data.branch);
  const action = String(data.action || "");
  if (action === "login") return login(branch, data);
  if (action === "refresh") return refresh(branch, data);
  if (action === "submitFeedback") return submitFeedback(branch, data);
  if (action === "submitAbsent") return submitAbsent(branch, data);
  if (action === "submitAbsentCancel") return submitAbsentCancel(branch, data);
  if (action === "getBogangSlots") return getBogangSlots(branch, data);
  if (action === "submitBogang") return submitBogang(branch, data);
  if (action === "cancelBogang") return cancelBogang(branch, data);
  if (action === "notifyStaffRequestProcessed") return notifyStaffRequestProcessed(branch, data, request);
  throw new HttpsError("invalid-argument", "지원하지 않는 요청입니다");
});

exports.customerVoice = onCall({
  serviceAccount: "45509278949-compute@developer.gserviceaccount.com",
  cors: [
    "https://schedule.adminsuperchild.cloud",
    "http://127.0.0.1:8000",
    "http://localhost:8000",
  ],
}, async request => {
  const data = request.data || {};
  const branch = safeBranch(data.branch);
  const action = String(data.action || "submit");
  if (action === "submit") return submitCustomerVoice(branch, data, request);
  throw new HttpsError("invalid-argument", "지원하지 않는 요청입니다");
});

exports.purgeCustomerVoiceContacts = onSchedule({
  schedule: "every day 03:00",
  timeZone: "Asia/Seoul",
  serviceAccount: "45509278949-compute@developer.gserviceaccount.com",
}, async () => {
  const snapshots = await Promise.all(Object.values(BRANCHES).map(branch =>
    customerVoiceTicketCollection(branch)
      .where("contactDeleteAfter", "<=", Timestamp.now())
      .limit(150)
      .get()
  ));
  const docs = snapshots.flatMap(snapshot => snapshot.docs);
  if (docs.length) {
    const batch = db.batch();
    docs.forEach(doc => {
      batch.update(doc.ref, {
        contact: null,
        contactPurgedAt: FieldValue.serverTimestamp(),
        contactDeleteAfter: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
  }
  const expiredRates = await db.collection(CUSTOMER_VOICE_RATE_COLLECTION)
    .where("expiresAt", "<=", Timestamp.now())
    .limit(400)
    .get();
  if (!expiredRates.empty) {
    const rateBatch = db.batch();
    expiredRates.docs.forEach(doc => rateBatch.delete(doc.ref));
    await rateBatch.commit();
  }
  return null;
});

exports.manageScheduleV2Shadow = onCall({
  serviceAccount: "45509278949-compute@developer.gserviceaccount.com",
  timeoutSeconds: 540,
  memory: "1GiB",
}, async request => {
  const data = validateScheduleV2ActionData(request.data);
  const action = data.action;
  const branchId = data.branchId;
  const branch = BRANCHES[branchId];
  const actorEmail = authorizeScheduleV2Action(request, action, branchId);
  if (action === "status") return readScheduleV2Status(branchId);
  const expectation = scheduleV2TransitionExpectation(data);
  if (action === "prepare") return prepareScheduleV2(branch, expectation);
  if (action === "set-shadow") {
    return transitionScheduleV2Authority(branchId, "shadow", expectation, actorEmail);
  }
  if (action === "set-verify") {
    return transitionScheduleV2Authority(branchId, "verify", expectation, actorEmail);
  }
  if (action === "set-v2-read") {
    return frozenScheduleV2CanonicalTransition(
      branchId, "v2-read", expectation, actorEmail, "activation", true,
    );
  }
  if (action === "set-v2") {
    return verifiedScheduleV2CanonicalTransition(
      branchId, "v2", expectation, actorEmail, "v2-promotion",
    );
  }
  if (action === "pause") return pauseScheduleV2Shadow(branchId, expectation, actorEmail);
  return rollbackScheduleV2(branchId, expectation, actorEmail);
});

exports.mutateScheduleV2Operational = onCall({
  cors: true,
  serviceAccount: "45509278949-compute@developer.gserviceaccount.com",
  timeoutSeconds: 540,
  memory: "1GiB",
}, async request => {
  try {
    return await scheduleV2OperationalWriter.mutate(request);
  } catch (error) {
    const allowed = new Set([
      "aborted", "already-exists", "failed-precondition", "internal",
      "invalid-argument", "not-found", "permission-denied",
      "resource-exhausted", "unauthenticated", "unavailable",
    ]);
    const code = String(error?.code || "").replace(/^functions\//, "");
    throw new HttpsError(allowed.has(code) ? code : "internal", "Schedule V2 operational mutation failed");
  }
});

exports.manageScheduleV2RequestRecovery = onCall({
  cors: true,
  serviceAccount: "45509278949-compute@developer.gserviceaccount.com",
  timeoutSeconds: 120,
  memory: "512MiB",
}, async request => {
  try {
    return await scheduleV2OperationalWriter.manageRequestRecovery(request);
  } catch (error) {
    const allowed = new Set([
      "aborted", "already-exists", "failed-precondition", "invalid-argument",
      "not-found", "permission-denied", "resource-exhausted", "unauthenticated", "unavailable",
    ]);
    const code = String(error?.code || "").replace(/^functions\//, "");
    throw new HttpsError(allowed.has(code) ? code : "internal", "Schedule V2 request recovery failed");
  }
});

exports.resolveScheduleV2TerminalRecovery = onCall({
  cors: true,
  serviceAccount: "45509278949-compute@developer.gserviceaccount.com",
  timeoutSeconds: 540,
  memory: "1GiB",
}, async request => {
  try {
    return await scheduleV2OperationalWriter.manageTerminalRecovery(request);
  } catch (error) {
    const allowed = new Set([
      "aborted", "failed-precondition", "invalid-argument", "not-found",
      "permission-denied", "resource-exhausted", "unauthenticated", "unavailable",
    ]);
    const code = String(error?.code || "").replace(/^functions\//, "");
    throw new HttpsError(allowed.has(code) ? code : "internal", "Schedule V2 terminal recovery failed");
  }
});

exports.recoverScheduleV2OperationalMirrors = onSchedule({
  schedule: "every 5 minutes",
  timeZone: "Asia/Seoul",
  serviceAccount: "45509278949-compute@developer.gserviceaccount.com",
  retryCount: 3,
  timeoutSeconds: 540,
  memory: "1GiB",
}, async () => {
  await scheduleV2OperationalWriter.recoverOperationalMirrors();
  return null;
});

exports.recoverScheduleV2RequestPatches = onSchedule({
  schedule: "every 5 minutes",
  timeZone: "Asia/Seoul",
  serviceAccount: "45509278949-compute@developer.gserviceaccount.com",
  retryCount: 3,
  timeoutSeconds: 120,
  memory: "512MiB",
}, async () => {
  await scheduleV2OperationalWriter.recoverRequestPatches();
  return null;
});

exports.queueScheduleV2Shadow = onDocumentWritten({
  document: "scheduleStores/{branchId}/kv/{docId}",
  serviceAccount: "45509278949-compute@developer.gserviceaccount.com",
  retry: true,
  timeoutSeconds: 120,
  memory: "256MiB",
}, async event => {
  const branchId = String(event.params.branchId || "");
  const branch = BRANCHES[branchId];
  if (!branch) return null;
  const key = scheduleV2ShadowPolicy.decodeLegacyKey(event.params.docId);
  if (!scheduleV2ShadowPolicy.isTrackedKey(key)) return null;

  const configRef = scheduleV2RuntimeRef(branchId, "schedule");
  const syncRef = scheduleV2RuntimeRef(branchId, "scheduleSync");
  await db.runTransaction(async tx => {
    const configSnapshot = await tx.get(configRef);
    const config = configSnapshot.data() || {};
    const mode = String(config.mode || "");
    const preparationStatus = String(config.preparationStatus || "");
    const preparingCandidate = ["preparing", "ready"].includes(preparationStatus) &&
      Boolean(String(config.preparationGenerationId || config.preparedGenerationId || ""));
    if (!preparingCandidate && !["shadow", "verify"].includes(mode)) return null;
    const snapshot = await tx.get(syncRef);
    const sync = snapshot.data() || {};
    const remembered = scheduleV2RememberEvent(sync, scheduleV2SourceEventHash(event));
    if (remembered.duplicate) return null;
    const generationId = preparingCandidate ?
      String(config.preparationGenerationId || config.preparedGenerationId || "") :
      String(config.generationId || "");
    const generationRef = generationId ? scheduleV2GenerationRef(branchId, generationId) : null;
    const generationSnapshot = generationRef ? await tx.get(generationRef) : null;
    const now = new Date();
    const queued = scheduleV2ShadowPolicy.mergePending(sync, key, now);
    queued.retryCount = 0;
    queued.recentSourceEvents = remembered.recent;
    tx.set(syncRef, queued, {merge: false});
    if (preparationStatus === "ready") {
      tx.set(configRef, {
        ...config,
        requiresPrepare: true,
        preparationStatus: "syncing",
        invalidatedAt: now.toISOString(),
        updatedAt: now.toISOString(),
      }, {merge: false});
    }
    if (generationRef && generationSnapshot?.exists) {
      tx.set(generationRef, scheduleV2GenerationWithSchedule(
        generationSnapshot.data() || {}, preparationStatus === "preparing" ? "preparing" : "syncing",
        queued, now, {invalidatedAt: now.toISOString()},
      ), {merge: false});
    }
    return null;
  });
  return null;
});

exports.processScheduleV2Shadow = onDocumentWritten({
  document: "scheduleV2/{branchId}/runtime/scheduleSync",
  serviceAccount: "45509278949-compute@developer.gserviceaccount.com",
  retry: true,
  timeoutSeconds: 540,
  memory: "1GiB",
}, async event => {
  const branchId = String(event.params.branchId || "");
  const branch = BRANCHES[branchId];
  if (!branch) return null;

  const configRef = scheduleV2RuntimeRef(branchId, "schedule");
  const syncRef = scheduleV2RuntimeRef(branchId, "scheduleSync");
  const claim = await db.runTransaction(async tx => {
    const config = await tx.get(configRef);
    if (!["shadow", "verify"].includes(config.get("mode"))) return null;
    const generationId = String(config.get("generationId") || "").trim();
    if (!generationId) return null;
    const snapshot = await tx.get(syncRef);
    const generationRef = scheduleV2GenerationRef(branchId, generationId);
    const generationSnapshot = await tx.get(generationRef);
    if (Number(snapshot.data()?.retryCount || 0) >= SCHEDULE_V2_SHADOW_MAX_RETRY_COUNT) return null;
    const nextClaim = scheduleV2ShadowPolicy.claimPending(
      snapshot.data(),
      crypto.randomUUID(),
      new Date()
    );
    if (!nextClaim) return null;
    if (nextClaim.recovered) {
      nextClaim.next.retryCount = scheduleV2ShadowRetryCount(snapshot.data()?.retryCount);
    }
    tx.set(syncRef, nextClaim.next, {merge: false});
    if (generationSnapshot.exists) {
      tx.set(generationRef, scheduleV2GenerationWithSchedule(
        generationSnapshot.data() || {}, "syncing", nextClaim.next, new Date(),
      ), {merge: false});
    }
    return {...nextClaim, generationId};
  });
  if (!claim) return null;

  try {
    const fullGeneration = claim.keys.includes("swim_tab_list");
    let keys = fullGeneration ? await listScheduleV2BaselineKeys(branch) : claim.keys;
    const includesAttendanceSnapshots = key =>
      scheduleV2ShadowPolicy.collectionsForKey(key).includes("attendanceSnapshots");
    if (!fullGeneration && claim.keys.some(includesAttendanceSnapshots)) {
      const baselineKeys = await listScheduleV2BaselineKeys(branch);
      const snapshotKeys = baselineKeys.filter(key =>
        key !== "swim_tab_list" && includesAttendanceSnapshots(key));
      keys = [...new Set([...keys, ...snapshotKeys])];
    }
    const result = await runShadowSync({
      db,
      branchId,
      generationId: claim.generationId,
      keys,
      readLegacyKey: key => readStoredValue(branch, key),
      fence: {ref: syncRef, leaseId: claim.leaseId},
      heartbeat: scheduleV2LeaseHeartbeat(syncRef, claim.leaseId),
      fullGeneration,
    });
    await db.runTransaction(async tx => {
      const snapshot = await tx.get(syncRef);
      const generationRef = scheduleV2GenerationRef(branchId, claim.generationId);
      const generationSnapshot = await tx.get(generationRef);
      const current = snapshot.data() || {};
      const finished = scheduleV2ShadowPolicy.finishPending(current, claim, {
        collections: result.collections,
        writes: result.writes,
        deletes: result.deletes,
        counts: result.counts,
        digests: result.digests,
        retryCount: 0,
        mismatchCount: 0,
      }, new Date());
      if (finished !== current) {
        tx.set(syncRef, finished, {merge: false});
        if (generationSnapshot.exists) {
          tx.set(generationRef, scheduleV2GenerationWithSchedule(
            generationSnapshot.data() || {}, finished.status === "idle" ? "ready" : "syncing",
            finished, new Date(),
          ), {merge: false});
        }
      }
    });
  } catch (error) {
    const now = new Date();
    const redactedDiagnostic = scheduleV2ShadowPolicy.redactedError(error, {
      branchId,
      keys: claim.keys,
      collections: scheduleV2ShadowCollections(claim.keys),
      now,
    });
    const alertRef = scheduleV2ShadowAlertRef(branchId, redactedDiagnostic);
    const recorded = await db.runTransaction(async tx => {
      const config = await tx.get(configRef);
      const syncSnapshot = await tx.get(syncRef);
      const generationId = String(config.get("generationId") || claim.generationId || "");
      const generationRef = generationId ? scheduleV2GenerationRef(branchId, generationId) : null;
      const generationSnapshot = generationRef ? await tx.get(generationRef) : null;
      const current = syncSnapshot.data() || {};
      if (String(current.leaseId || "") !== claim.leaseId) return false;
      if (!["shadow", "verify"].includes(config.get("mode"))) {
        const pendingKeys = (Array.isArray(current.pendingKeys) ? current.pendingKeys : [])
          .filter(scheduleV2ShadowPolicy.isTrackedKey);
        const stopped = {
          ...current,
          pendingKeys,
          status: pendingKeys.length ? "pending" : "idle",
        };
        delete stopped.leaseId;
        delete stopped.leaseUntil;
        delete stopped.processingStartedAt;
        tx.set(syncRef, stopped, {merge: false});
        return false;
      }
      const alertSnapshot = await tx.get(alertRef);
      const requeued = scheduleV2ShadowPolicy.requeueClaim(current, claim);
      const failed = {
        ...requeued,
        retryCount: scheduleV2ShadowRetryCount(current.retryCount),
        mismatchCount: Math.max(1, scheduleV2Count(current.mismatchCount)),
        lastFailedAt: redactedDiagnostic.detectedAt,
      };
      const priorCount = Math.max(0, Number(alertSnapshot.data()?.count || 0) || 0);
      tx.set(syncRef, failed, {merge: false});
      if (generationRef && generationSnapshot?.exists) {
        tx.set(generationRef, scheduleV2GenerationWithSchedule(
          generationSnapshot.data() || {}, "error", failed, now,
          {errorClass: redactedDiagnostic.messageClass},
        ), {merge: false});
      }
      tx.set(alertRef, {
        ...redactedDiagnostic,
        id: alertRef.id,
        type: "schedule-v2-shadow",
        message: `Schedule V2 shadow ${redactedDiagnostic.messageClass} failure`,
        status: "open",
        lastDetectedAt: redactedDiagnostic.detectedAt,
        count: Math.min(Number.MAX_SAFE_INTEGER, priorCount + 1),
      }, {merge: false});
      return true;
    });
    if (recorded) logger.error('schedule-v2-shadow-failed',redactedDiagnostic);
  }
  return null;
});

exports.recoverScheduleV2ShadowLeases = onSchedule({
  schedule: "every 1 minutes",
  timeZone: "Asia/Seoul",
  serviceAccount: "45509278949-compute@developer.gserviceaccount.com",
  retryCount: 3,
  timeoutSeconds: 120,
  memory: "256MiB",
}, async () => {
  const now = new Date();
  await Promise.all(Object.keys(BRANCHES).map(branchId =>
    recoverScheduleV2ShadowBranch(branchId, now)
  ));
  return null;
});

exports.refreshRegularAvailability = onDocumentWritten({
  document: "scheduleStores/{branchId}/kv/{docId}",
  serviceAccount: "45509278949-compute@developer.gserviceaccount.com",
}, async event => {
  const branch = BRANCHES[String(event.params.branchId || "")];
  if (!branch) return null;
  const key = decodedScheduleKey(event.params.docId);
  if (!isPublicAvailabilitySourceKey(key)) return null;
  await computePublicAvailability(branch);
  return null;
});

exports.regularAvailability = onRequest({
  serviceAccount: "45509278949-compute@developer.gserviceaccount.com",
  cors: true,
}, async (request, response) => {
  response.set("Access-Control-Allow-Origin", "*");
  response.set("Cache-Control", "public, max-age=5, s-maxage=10, stale-while-revalidate=30");
  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }
  if (request.method !== "GET") {
    response.status(405).json({ok: false, message: "Method not allowed"});
    return;
  }
  try {
    const results = await Promise.all(Object.values(BRANCHES).map(readPublicAvailability));
    const branches = {};
    let updatedAt = "";
    let basisDate = "";
    results.forEach(result => {
      branches[result.branchId] = result.days;
      if (result.updatedAt > updatedAt) updatedAt = result.updatedAt;
      if (!basisDate) basisDate = result.basisDate;
    });
    response.status(200).json({
      ok: true,
      basisMonth: PUBLIC_AVAILABILITY_BASIS_MONTH,
      basisDate,
      updatedAt,
      branches,
    });
  } catch (error) {
    console.error("regular availability failed", error);
    response.status(500).json({ok: false, message: "현황을 불러오지 못했습니다"});
  }
});
