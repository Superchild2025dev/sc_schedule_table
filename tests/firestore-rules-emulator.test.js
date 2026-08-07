"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {createRequire} = require("node:module");

const root = path.join(__dirname, "..");
const testPackagePath = path.join(root, "tools", "firebase-test", "package.json");
const requireTestDependency = createRequire(testPackagePath);
const emulatorEnabled = !!process.env.FIRESTORE_EMULATOR_HOST;

test("Firestore rules test dependency and emulator are configured", {skip:!emulatorEnabled}, () => {
  assert.ok(fs.existsSync(testPackagePath), "Firebase test package is missing");
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "run this test through the Firestore emulator");
});

if(emulatorEnabled){
  const {
    initializeTestEnvironment,
    assertSucceeds,
    assertFails,
  } = requireTestDependency("@firebase/rules-unit-testing");
  const {doc, getDoc, setDoc, setLogLevel} = requireTestDependency("firebase/firestore");

  setLogLevel("silent");

  let env;

  test.before(async () => {
    env = await initializeTestEnvironment({
      projectId:"sc-schedule-rules-test",
      firestore:{rules:fs.readFileSync(path.join(root, "firestore.rules"), "utf8")},
    });
  });

  test.afterEach(async () => {
    await env.clearFirestore();
  });

  test.after(async () => {
    await env.cleanup();
  });

  function staffDb(uid, email){
    return env.authenticatedContext(uid, {email}).firestore();
  }

  function kv(db, branch, key){
    return doc(db, "scheduleStores", branch, "kv", key);
  }

  function chunk(db, branch, key, chunkId){
    return doc(db, "scheduleStores", branch, "kv", key, "chunks", chunkId);
  }

  function v2Monitor(db, branch){
    return doc(db, "scheduleV2", branch);
  }

  function attendanceConfig(db, branch){
    return doc(db, "scheduleV2", branch, "runtime", "attendance");
  }

  function attendanceRecord(db, branch, generationId, collection, recordId){
    return doc(db, "scheduleV2", branch, "generations", generationId, collection, recordId);
  }

  test("a teacher can write regular and vacation attendance documents", async () => {
    const db = staffDb("gagyeong-teacher", "gagyeong.son@scswim.local");

    await assertSucceeds(setDoc(kv(db, "gagyeong", "swim_attendance"), {value:"{}"}));
    await assertSucceeds(setDoc(kv(db, "gagyeong", "swim_bt_attendance_2026_summer"), {value:"{}"}));
    await assertSucceeds(setDoc(kv(db, "gagyeong", "swim_bt_att_guests_2026_summer"), {value:"[]"}));
    await assertSucceeds(setDoc(kv(db, "gagyeong", "swim_bt_day_snapshot_2026_summer"), {value:"{}"}));
  });

  test("a teacher cannot edit regular or vacation schedule rosters", async () => {
    const db = staffDb("gagyeong-teacher", "gagyeong.son@scswim.local");

    await assertFails(setDoc(kv(db, "gagyeong", "swim_students"), {value:"{}"}));
    await assertFails(setDoc(kv(db, "gagyeong", "swim_inst"), {value:"{}"}));
    await assertFails(setDoc(kv(db, "gagyeong", "swim_bt_summer_stu"), {value:"{}"}));
    await assertFails(setDoc(kv(db, "gagyeong", "swim_bt_summer_inst"), {value:"{}"}));
  });

  test("a teacher cannot access the other branch", async () => {
    await env.withSecurityRulesDisabled(async context=>{
      await setDoc(kv(context.firestore(), "yongam", "swim_attendance"), {value:"{}"});
    });
    const db = staffDb("gagyeong-teacher", "gagyeong.son@scswim.local");

    await assertFails(getDoc(kv(db, "yongam", "swim_attendance")));
    await assertFails(setDoc(kv(db, "yongam", "swim_attendance"), {value:"{}"}));
  });

  test("each desk manages only its own branch", async () => {
    const gagyeongDb = staffDb("gagyeong-desk", "gagyeong.desk@scswim.local");
    const yongamDb = staffDb("yongam-desk", "yongam.desk@scswim.local");

    await assertSucceeds(setDoc(kv(gagyeongDb, "gagyeong", "swim_students"), {value:"{}"}));
    await assertSucceeds(setDoc(kv(yongamDb, "yongam", "swim_students"), {value:"{}"}));
    await assertFails(setDoc(kv(gagyeongDb, "yongam", "swim_students"), {value:"{}"}));
    await assertFails(setDoc(kv(yongamDb, "gagyeong", "swim_students"), {value:"{}"}));
  });

  test("chunk permissions follow their parent schedule key", async () => {
    const db = staffDb("gagyeong-teacher", "gagyeong.son@scswim.local");

    await assertSucceeds(setDoc(chunk(db, "gagyeong", "swim_attendance", "0000"), {text:"{}"}));
    await assertFails(setDoc(chunk(db, "gagyeong", "swim_students", "0000"), {text:"{}"}));
  });

  test("V2 writes are developer-only while the owner keeps read access", async () => {
    const developerDb = staffDb("developer", "developer@scswim.local");
    const ownerDb = staffDb("owner", "2025superchild@gmail.com");
    const teacherDb = staffDb("gagyeong-teacher", "gagyeong.son@scswim.local");

    await assertSucceeds(setDoc(v2Monitor(developerDb, "gagyeong"), {state:"ok"}));
    await assertSucceeds(getDoc(v2Monitor(ownerDb, "gagyeong")));
    await assertFails(setDoc(v2Monitor(ownerDb, "gagyeong"), {state:"owner-write"}));
    await assertFails(getDoc(v2Monitor(teacherDb, "gagyeong")));
    await assertFails(setDoc(v2Monitor(teacherDb, "gagyeong"), {state:"teacher-write"}));
  });

  test("teachers and desks can manage only their branch V2 attendance rows", async () => {
    const teacherDb = staffDb("gagyeong-teacher", "gagyeong.son@scswim.local");
    const deskDb = staffDb("gagyeong-desk", "gagyeong.desk@scswim.local");
    const ownRecord = attendanceRecord(teacherDb, "gagyeong", "gen_1", "attendanceRecords", "att_1");
    const ownGuest = attendanceRecord(teacherDb, "gagyeong", "gen_1", "attendanceGuests", "guest_1");
    const otherRecord = attendanceRecord(teacherDb, "yongam", "gen_1", "attendanceRecords", "att_1");

    await assertSucceeds(setDoc(ownRecord, {tabId:"regular", date:"2026-08-07"}));
    await assertSucceeds(getDoc(ownRecord));
    await assertSucceeds(setDoc(ownGuest, {tabId:"regular", date:"2026-08-07"}));
    await assertSucceeds(setDoc(
      attendanceRecord(deskDb, "gagyeong", "gen_1", "attendanceRecords", "att_2"),
      {tabId:"regular", date:"2026-08-07"}
    ));
    await assertFails(setDoc(otherRecord, {tabId:"regular", date:"2026-08-07"}));
    await assertFails(getDoc(otherRecord));
  });

  test("staff can read attendance config but only a developer can change it", async () => {
    await env.withSecurityRulesDisabled(async context=>{
      await setDoc(attendanceConfig(context.firestore(), "gagyeong"), {
        branchId:"gagyeong", mode:"v1", generationId:"",
      });
    });
    const teacherDb = staffDb("gagyeong-teacher", "gagyeong.son@scswim.local");
    const otherTeacherDb = staffDb("yongam-teacher", "yongam.lee1@scswim.local");
    const developerDb = staffDb("developer", "developer@scswim.local");

    await assertSucceeds(getDoc(attendanceConfig(teacherDb, "gagyeong")));
    await assertFails(setDoc(attendanceConfig(teacherDb, "gagyeong"), {mode:"shadow"}));
    await assertFails(getDoc(attendanceConfig(otherTeacherDb, "gagyeong")));
    await assertSucceeds(setDoc(attendanceConfig(developerDb, "gagyeong"), {
      branchId:"gagyeong", mode:"shadow", generationId:"gen_1",
    }));
  });

  test("unauthenticated clients cannot access V2 attendance runtime paths", async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(attendanceConfig(db, "gagyeong")));
    await assertFails(setDoc(attendanceConfig(db, "gagyeong"), {mode:"v1"}));
    await assertFails(getDoc(attendanceRecord(db, "gagyeong", "gen_1", "attendanceRecords", "att_1")));
    await assertFails(setDoc(
      attendanceRecord(db, "gagyeong", "gen_1", "attendanceGuests", "guest_1"),
      {tabId:"regular", date:"2026-08-07"}
    ));
  });
}
