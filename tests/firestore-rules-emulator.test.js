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

  test.beforeEach(async()=>{
    await env.withSecurityRulesDisabled(async context=>{
      for(const branch of ["gagyeong","yongam"]){
        await setDoc(runtimeConfig(context.firestore(),branch,"operational"),{
          branchId:branch,mode:"v1",generationId:"",epoch:1,revision:0,
        });
        await setDoc(runtimeConfig(context.firestore(),branch,"activationFreeze"),{
          branchId:branch,active:false,state:"idle",
        });
      }
    });
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

  function runtimeConfig(db, branch, documentId){
    return doc(db, "scheduleV2", branch, "runtime", documentId);
  }

  function generationHeader(db, branch, generationId){
    return doc(db, "scheduleV2", branch, "generations", generationId);
  }

  function attendanceRecord(db, branch, generationId, collection, recordId){
    return doc(db, "scheduleV2", branch, "generations", generationId, collection, recordId);
  }

  function operationalMutation(db, branch, operationId){
    return doc(db, "scheduleV2", branch, "operationalMutations", operationId);
  }

  function requestRecovery(db, branch, operationId){
    return doc(db, "scheduleV2", branch, "requestRecoveries", operationId);
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

  test("a teacher can handle attendance after moving branches but cannot edit rosters", async () => {
    await env.withSecurityRulesDisabled(async context=>{
      await setDoc(kv(context.firestore(), "yongam", "swim_attendance"), {value:"{}"});
    });
    const db = staffDb("gagyeong-teacher", "gagyeong.son@scswim.local");

    await assertSucceeds(getDoc(kv(db, "yongam", "swim_attendance")));
    await assertSucceeds(setDoc(kv(db, "yongam", "swim_attendance"), {value:"{}"}));
    await assertSucceeds(setDoc(kv(db, "yongam", "swim_requests"), {value:"{}"}));
    await assertFails(setDoc(kv(db, "yongam", "swim_students"), {value:"{}"}));
    await assertFails(setDoc(kv(db, "yongam", "swim_inst"), {value:"{}"}));
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

  test("tracked V1 parent and chunk writes fail closed under freeze V2 or unknown authority",async()=>{
    const deskDb=staffDb("gagyeong-desk","gagyeong.desk@scswim.local");
    const teacherDb=staffDb("gagyeong-teacher","gagyeong.son@scswim.local");
    const setRuntime=async(documentId,value)=>env.withSecurityRulesDisabled(async context=>{
      await setDoc(runtimeConfig(context.firestore(),"gagyeong",documentId),value);
    });

    await setRuntime("activationFreeze",{branchId:"gagyeong",active:true,state:"draining"});
    await assertFails(setDoc(kv(deskDb,"gagyeong","swim_students"),{value:"[]"}));
    await assertFails(setDoc(kv(teacherDb,"gagyeong","swim_attendance"),{value:"{}"}));
    await assertFails(setDoc(chunk(teacherDb,"gagyeong","swim_attendance","0000"),{text:"{}"}));
    await assertSucceeds(setDoc(kv(teacherDb,"gagyeong","swim_requests"),{value:"{}"}));

    await setRuntime("activationFreeze",{branchId:"gagyeong",active:false,state:"completed"});
    for(const mode of ["v2-read","v2","unknown"]){
      await setRuntime("operational",{branchId:"gagyeong",mode,generationId:"gen_1",epoch:2,revision:1});
      await assertFails(setDoc(kv(deskDb,"gagyeong","swim_students"),{value:"[]"}));
      await assertFails(setDoc(kv(teacherDb,"gagyeong","swim_attendance"),{value:"{}"}));
      await assertSucceeds(setDoc(kv(teacherDb,"gagyeong","swim_requests"),{value:"{}"}));
    }

    await setRuntime("operational",{branchId:"yongam",mode:"v1",generationId:"",epoch:3,revision:1});
    await assertFails(setDoc(kv(deskDb,"gagyeong","swim_students"),{value:"[]"}));

    for(const malformed of [
      {branchId:"gagyeong",mode:"v1"},
      {branchId:"gagyeong",mode:"v1",generationId:"",epoch:null,revision:1},
      {branchId:"gagyeong",mode:"v1",generationId:"",epoch:"1",revision:1},
      {branchId:"gagyeong",mode:"shadow",generationId:"",epoch:1,revision:1},
      {branchId:" gagyeong ",mode:"v1",generationId:"",epoch:1,revision:1},
      {branchId:"gagyeong",mode:" v1 ",generationId:"",epoch:1,revision:1},
      {branchId:"gagyeong",mode:"shadow",generationId:" gen_1 ",epoch:1,revision:1},
    ]){
      await setRuntime("operational",malformed);
      await assertFails(setDoc(kv(deskDb,"gagyeong","swim_students"),{value:"[]"}));
      await assertFails(setDoc(kv(teacherDb,"gagyeong","swim_attendance"),{value:"{}"}));
    }
  });

  test("generic V2 monitor documents are server-write-only while owner and developer keep monitor reads", async () => {
    const developerDb = staffDb("developer", "developer@scswim.local");
    const ownerDb = staffDb("owner", "2025superchild@gmail.com");
    const teacherDb = staffDb("gagyeong-teacher", "gagyeong.son@scswim.local");

    await env.withSecurityRulesDisabled(async context=>{
      await setDoc(v2Monitor(context.firestore(), "gagyeong"), {state:"ok"});
    });
    await assertSucceeds(getDoc(v2Monitor(developerDb, "gagyeong")));
    await assertFails(setDoc(v2Monitor(developerDb, "gagyeong"), {state:"developer-write"}));
    await assertSucceeds(getDoc(v2Monitor(ownerDb, "gagyeong")));
    await assertFails(setDoc(v2Monitor(ownerDb, "gagyeong"), {state:"owner-write"}));
    await assertFails(getDoc(v2Monitor(teacherDb, "gagyeong")));
    await assertFails(setDoc(v2Monitor(teacherDb, "gagyeong"), {state:"teacher-write"}));
  });

  test("teachers read both branches V2 operations while desks remain branch-scoped", async () => {
    const teacherDb = staffDb("gagyeong-teacher", "gagyeong.son@scswim.local");
    const deskDb = staffDb("gagyeong-desk", "gagyeong.desk@scswim.local");
    const ownRecord = attendanceRecord(teacherDb, "gagyeong", "gen_1", "attendanceRecords", "att_1");
    const ownGuest = attendanceRecord(teacherDb, "gagyeong", "gen_1", "attendanceGuests", "guest_1");
    const ownPerson = attendanceRecord(teacherDb, "gagyeong", "gen_1", "people", "person_1");
    const otherRecord = attendanceRecord(teacherDb, "yongam", "gen_1", "attendanceRecords", "att_1");
    const otherDeskRecord = attendanceRecord(deskDb, "yongam", "gen_1", "attendanceRecords", "att_3");

    await env.withSecurityRulesDisabled(async context=>{
      const adminDb=context.firestore();
      await setDoc(attendanceRecord(adminDb, "gagyeong", "gen_1", "attendanceRecords", "att_1"), {
        tabId:"regular", date:"2026-08-07",
      });
      await setDoc(attendanceRecord(adminDb, "gagyeong", "gen_1", "attendanceGuests", "guest_1"), {
        tabId:"regular", date:"2026-08-07",
      });
      await setDoc(attendanceRecord(adminDb, "gagyeong", "gen_1", "people", "person_1"), {
        personId:"person_1",
      });
      await setDoc(attendanceRecord(adminDb, "yongam", "gen_1", "attendanceRecords", "att_1"), {
        tabId:"regular", date:"2026-08-07",
      });
      await setDoc(attendanceRecord(adminDb, "yongam", "gen_1", "attendanceRecords", "att_3"), {
        tabId:"regular", date:"2026-08-07",
      });
    });
    await assertSucceeds(getDoc(ownRecord));
    await assertSucceeds(getDoc(ownGuest));
    await assertSucceeds(getDoc(ownPerson));
    await assertSucceeds(getDoc(otherRecord));
    await assertSucceeds(getDoc(attendanceRecord(deskDb, "gagyeong", "gen_1", "attendanceRecords", "att_1")));
    await assertFails(getDoc(otherDeskRecord));
  });

  test("staff can read allowed runtime pointers but every browser runtime write is denied", async () => {
    await env.withSecurityRulesDisabled(async context=>{
      await setDoc(attendanceConfig(context.firestore(), "gagyeong"), {
        branchId:"gagyeong", mode:"v1", generationId:"",
      });
      await setDoc(runtimeConfig(context.firestore(), "gagyeong", "operational"), {
        branchId:"gagyeong", mode:"v1", generationId:"", epoch:1, revision:0,
      });
      await setDoc(runtimeConfig(context.firestore(), "gagyeong", "scheduleSync"), {
        status:"idle", requestedRevision:0, appliedRevision:0,
      });
    });
    const teacherDb = staffDb("gagyeong-teacher", "gagyeong.son@scswim.local");
    const otherTeacherDb = staffDb("yongam-teacher", "yongam.lee1@scswim.local");
    const developerDb = staffDb("developer", "developer@scswim.local");

    await assertSucceeds(getDoc(attendanceConfig(teacherDb, "gagyeong")));
    await assertFails(setDoc(attendanceConfig(teacherDb, "gagyeong"), {mode:"shadow"}));
    await assertSucceeds(getDoc(attendanceConfig(otherTeacherDb, "gagyeong")));
    await assertSucceeds(getDoc(runtimeConfig(teacherDb, "gagyeong", "operational")));
    await assertSucceeds(getDoc(runtimeConfig(otherTeacherDb, "gagyeong", "scheduleSync")));
    await assertFails(setDoc(attendanceConfig(developerDb, "gagyeong"), {
      branchId:"gagyeong", mode:"shadow", generationId:"gen_1",
    }));
  });

  test("attendance marks mutations and every recovery queue are callable-only", async () => {
    const teacherDb = staffDb("teacher", "gagyeong.son@scswim.local");
    const deskDb = staffDb("desk", "gagyeong.desk@scswim.local");
    const developerDb = staffDb("developer", "developer@scswim.local");
    const writes = [
      attendanceRecord(teacherDb, "gagyeong", "gen_1", "attendanceRecords", "att_1"),
      attendanceRecord(teacherDb, "gagyeong", "gen_1", "attendanceGuests", "guest_1"),
      attendanceRecord(deskDb, "gagyeong", "gen_1", "classMarks", "mark_1"),
      generationHeader(developerDb, "gagyeong", "gen_1"),
      attendanceRecord(developerDb, "gagyeong", "gen_1", "people", "person_1"),
      operationalMutation(developerDb, "gagyeong", "op_1"),
      requestRecovery(developerDb, "gagyeong", "op_1"),
      runtimeConfig(developerDb, "gagyeong", "operationalRecovery"),
    ];
    for(const reference of writes){
      await assertFails(setDoc(reference, {state:"browser-write"}));
    }
    await assertFails(getDoc(operationalMutation(developerDb, "gagyeong", "op_1")));
    await assertFails(getDoc(requestRecovery(developerDb, "gagyeong", "op_1")));
    await assertFails(getDoc(runtimeConfig(developerDb, "gagyeong", "operationalRecovery")));
  });

  test("unauthenticated clients cannot access V2 attendance runtime paths", async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(attendanceConfig(db, "gagyeong")));
    await assertFails(setDoc(attendanceConfig(db, "gagyeong"), {mode:"v1"}));
    await assertFails(getDoc(runtimeConfig(db, "gagyeong", "operational")));
    await assertFails(getDoc(generationHeader(db, "gagyeong", "gen_1")));
    await assertFails(getDoc(attendanceRecord(db, "gagyeong", "gen_1", "attendanceRecords", "att_1")));
    await assertFails(setDoc(
      attendanceRecord(db, "gagyeong", "gen_1", "attendanceGuests", "guest_1"),
      {tabId:"regular", date:"2026-08-07"}
    ));
  });
}
