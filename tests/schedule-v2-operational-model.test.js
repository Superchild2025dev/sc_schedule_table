"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

function clone(value){
  return JSON.parse(JSON.stringify(value));
}

function loadSchema(){
  const context = {window:{},console};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "js", "schedule-time.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "js", "schedule-schema-v2.js"), "utf8"), context);
  return context.window.SCScheduleSchemaV2;
}

function loadModel(){
  const context = {window:{},console};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "js", "schedule-v2-operational-model.js"), "utf8"), context);
  return context.window.SCV2OperationalModel;
}

function fullLegacyFixture(){
  return {
    ignored_key: JSON.stringify({keep:"out of the operational view"}),
    swim_tab_list: JSON.stringify([
      {id:"regular",name:"Regular August",type:"regular",periodMonth:"2026-08"},
      {id:"summer",name:"Summer Camp",type:"bangteuk",periodMonth:"2026-08",seasonStart:"2026-08-03",seasonEnd:"2026-08-28"},
    ]),
    swim_main_tab: JSON.stringify({tabId:"regular",month:"2026-08"}),
    swim_parent_tab: JSON.stringify({tabId:"regular"}),
    swim_students: JSON.stringify([
      {sid:"stu_shared",n:"Shared Student",p:"01011112222",a:10,g:"F",t:"4PM",d:"Mon",l:1,r:1,v:true,loc:"School",memo:"regular memo",paid:true,isNew:true,enrolled:"2026-08-03"},
      {sid:"stu_sibling_a",n:"Sibling Alpha",p:"01099990000",a:8,g:"M",t:"5PM",d:"Tue",l:1,r:1},
      {sid:"stu_sibling_b",n:"Sibling Beta",p:"01099990000",a:11,g:"F",t:"6PM",d:"Wed",l:1,r:1},
      {sid:"stu_rename",n:"Before Rename",p:"01033334444",a:9,g:"M",t:"7PM",d:"Thu",l:1,r:1},
    ]),
    swim_inst: JSON.stringify({"4PM/Mon/1":"Regular Teacher","5PM/Tue/1":"Second Teacher"}),
    swim_bt_summer_stu: JSON.stringify([
      {sid:"stu_shared",n:"*Shared Student",p:"01011112222",a:10,g:"F",t:"10AM",d:"MonWedFri",l:2,r:1,btNew:true,btWeek5:true,memo:"camp memo"},
    ]),
    swim_bt_summer_inst: JSON.stringify({"10AM/MonWedFri/2":"Camp Teacher"}),
    swim_retire: JSON.stringify({"4PM/Mon/1/1":{sid:"stu_shared",n:"Shared Student",tabId:"regular",ds:"2026-08-10",reason:"retire"}}),
    swim_enroll: JSON.stringify({"7PM/Thu/1/1":{sid:"stu_rename",n:"Before Rename",tabId:"regular",ds:"2026-08-11",reason:"enroll"}}),
    swim_hyuwon: JSON.stringify({}),
    swim_move: JSON.stringify({}),
    swim_reserve: JSON.stringify({"4PM/Mon/1":[{sid:"stu_sibling_a",n:"Sibling Alpha",tabId:"regular",m:"wait memo",d:"2026-08-12",teacher:"Regular Teacher"}]}),
    swim_mark: JSON.stringify({
      "4PM/Mon/1/1/2026-08-03":{type:"absent",tabId:"regular",sid:"stu_shared",n:"Shared Student",sub:{type:"bogang",tabId:"regular",sid:"stu_sibling_a",n:"Sibling Alpha",mandatoryMakeup:true}},
    }),
    swim_attendance: JSON.stringify({"4PM/Mon/1/1/2026-08-03":{s:"present",at:"2026-08-03T07:00:00.000Z",by:"Desk"}}),
    swim_att_guests: JSON.stringify({"4PM/Mon/1/2026-08-03":[{gid:"guest_1",n:"Walk In",a:7,slotKey:"4PM/Mon/1/6",type:"bogang",s:"present"}]}),
    swim_bt_attendance_summer: JSON.stringify({"10AM/MonWedFri/2/1/2026-08-03":{s:"absent",at:"2026-08-03T01:00:00.000Z"}}),
    swim_bt_att_guests_summer: JSON.stringify({}),
    swim_day_snapshot: JSON.stringify({"2026-08-03":{date:"2026-08-03",createdAt:"2026-08-03T00:00:00.000Z",students:[{sid:"snapshot_regular",n:"Snapshot Regular",p:"01055556666",t:"4PM",d:"Mon",l:1,r:2}],inst:{"4PM/Mon/1":"Regular Teacher"}}}),
    swim_bt_day_snapshot_summer: JSON.stringify({"2026-08-03":{date:"2026-08-03",students:[{sid:"snapshot_camp",n:"Snapshot Camp",p:"01077778888",t:"10AM",d:"MonWedFri",l:2,r:2}],inst:{"10AM/MonWedFri/2":"Camp Teacher"}}}),
    swim_disabled: JSON.stringify({"7PM/Thu/1/1":true}),
    swim_closed: JSON.stringify([{start:"2026-08-15",end:null,type:"closed",memo:"holiday"}]),
    swim_periods: JSON.stringify([{month:8,start:"2026-08-03",end:"2026-08-28"}]),
    swim_teachers: JSON.stringify([{id:"teacher_b",n:"Teacher B",color:"#222222"},{id:"teacher_a",n:"Teacher A",color:"#111111"}]),
    swim_tab_folders: JSON.stringify(["Archived Schedules"]),
    swim_archived_tabs: JSON.stringify([{id:"may",name:"May Archive",type:"regular",periodMonth:"2026-05",stuKey:"swim_stu_may",instKey:"swim_inst_may",archivedAt:"2026-06-01"}]),
    swim_age_year: JSON.stringify(2026),
    swim_student_id_version: JSON.stringify("v3"),
    swim_ver: JSON.stringify(2222),
    swim_retire_history: JSON.stringify([{id:"retirement_1",sid:"stu_shared",n:"Shared Student",p:"01011112222",tabId:"regular",t:"4PM",d:"Mon",l:1,r:1,retiredAt:"2026-08-10",recordedAt:"2026-08-01T01:02:03.000Z",memo:"retirement memo"}]),
    swim_desk_notes: JSON.stringify([{id:"desk_1",sourceKey:"regular|2026-08|retire-1",tabId:"regular",teacher:"Regular Teacher",student:"Shared Student",change:"retire",date:"8/10",dateKey:"2026-08-10",time:"4PM",day:"Mon",detail:"desk detail",source:"visible-reservation",deleted:false,original:{teacher:"Regular Teacher",student:"Shared Student",change:"retire",date:"8/10",time:"4PM"}}]),
  };
}

function convertedFixture(){
  const schema = loadSchema();
  return schema.diagnoseLegacyRoot("yongam", fullLegacyFixture()).conversion;
}

test("all tracked staff data survives V1 to V2 to legacy-view round trip", () => {
  const model = loadModel();
  const root = fullLegacyFixture();
  const rebuilt = model.legacyRootFromCollections({branchId:"yongam",generationId:"gen_1",collections:convertedFixture()});

  assert.deepEqual(model.trackedLegacyView(rebuilt), model.trackedLegacyView(root));
  assert.equal(Object.hasOwn(rebuilt, "ignored_key"), false);
});

test("per-day attendance snapshots round-trip independent of their legacy storage key", () => {
  const model = loadModel();
  const schema = loadSchema();
  const root = fullLegacyFixture();
  root["zz_swim_day_snapshot__regular__2026-08-03"] = JSON.stringify({
    date:"2026-08-03",
    students:[{sid:"snapshot_final",n:"Final Snapshot",p:"01000001111",t:"4PM",d:"Mon",l:1,r:3}],
    inst:{"4PM/Mon/1":"Final Teacher"},
  });
  const rebuilt = model.legacyRootFromCollections({
    branchId:"yongam",
    collections:schema.diagnoseLegacyRoot("yongam", root).conversion,
  });

  assert.deepEqual(model.trackedLegacyView(rebuilt), model.trackedLegacyView(root));
});

test("siblings with one phone remain separate legacy student rows", () => {
  const model = loadModel();
  const rebuilt = model.legacyRootFromCollections({branchId:"yongam",collections:convertedFixture()});
  const students = JSON.parse(rebuilt.swim_students).filter(row => row.p === "01099990000");

  assert.deepEqual(students.map(row => row.n), ["Sibling Alpha", "Sibling Beta"]);
});

test("regular and bangteuk enrollments remain separate and preserve week-five display metadata", () => {
  const model = loadModel();
  const rebuilt = model.legacyRootFromCollections({branchId:"yongam",collections:convertedFixture()});
  const regular = JSON.parse(rebuilt.swim_students).find(row => row.sid === "stu_shared");
  const camp = JSON.parse(rebuilt.swim_bt_summer_stu).find(row => row.sid === "stu_shared");

  assert.equal(regular.n, "Shared Student");
  assert.equal(camp.n, "*Shared Student");
  assert.equal(camp.btWeek5, true);
});

test("deleted placement removes its legacy roster row", () => {
  const model = loadModel();
  const collections = convertedFixture();
  collections.placements = collections.placements.filter(row => row.personId !== "stu_rename");
  const rebuilt = model.legacyRootFromCollections({branchId:"yongam",collections});

  assert.equal(JSON.parse(rebuilt.swim_students).some(row => row.sid === "stu_rename"), false);
});

test("renamed person is restored through every current placement", () => {
  const model = loadModel();
  const collections = convertedFixture();
  collections.people.find(row => row.id === "stu_rename").name = "After Rename";
  const rebuilt = model.legacyRootFromCollections({branchId:"yongam",collections});

  assert.equal(JSON.parse(rebuilt.swim_students).find(row => row.sid === "stu_rename").n, "After Rename");
});

test("teacher profiles restore in explicit sort order", () => {
  const model = loadModel();
  const collections = convertedFixture();
  collections.teacherProfiles[0].order = 1;
  collections.teacherProfiles[1].order = 0;
  const rebuilt = model.legacyRootFromCollections({branchId:"yongam",collections});

  assert.deepEqual(JSON.parse(rebuilt.swim_teachers).map(row => row.n), ["Teacher A", "Teacher B"]);
});

test("class mark updates retain the deterministic document identity and layers", () => {
  const model = loadModel();
  const before = convertedFixture();
  const after = clone(before);
  const primary = after.classMarks.find(row => row.layer === "primary");
  primary.payload.note = "updated";
  const result = model.collectionChanges({before,after});
  const rebuilt = model.legacyRootFromCollections({branchId:"yongam",collections:after});
  const mark = JSON.parse(rebuilt.swim_mark)[primary.legacyKey];

  assert.deepEqual(clone(result.issues), []);
  assert.deepEqual(clone(result.changes.filter(change => change.collection === "classMarks").map(change => change.id)), [primary.id]);
  assert.equal(mark.note, "updated");
  assert.equal(mark.sub.type, "bogang");
});

test("archived tabs, retirement history, and desk records retain stable IDs", () => {
  const model = loadModel();
  const schema = loadSchema();
  const root = fullLegacyFixture();
  const before = schema.diagnoseLegacyRoot("yongam", root).conversion;
  const changedRoot = clone(root);
  const retirements = JSON.parse(changedRoot.swim_retire_history);
  const deskRecords = JSON.parse(changedRoot.swim_desk_notes);
  retirements[0].memo = "changed retirement memo";
  deskRecords[0].detail = "changed desk detail";
  changedRoot.swim_retire_history = JSON.stringify(retirements);
  changedRoot.swim_desk_notes = JSON.stringify(deskRecords);
  const after = schema.diagnoseLegacyRoot("yongam", changedRoot).conversion;
  const rebuilt = model.legacyRootFromCollections({branchId:"yongam",collections:after});

  assert.equal(after.retirementRecords[0].id, before.retirementRecords[0].id);
  assert.equal(after.deskStudentRecords[0].id, before.deskStudentRecords[0].id);
  assert.deepEqual(JSON.parse(rebuilt.swim_archived_tabs), JSON.parse(root.swim_archived_tabs));
  assert.equal(JSON.parse(rebuilt.swim_retire_history)[0].memo, "changed retirement memo");
  assert.equal(JSON.parse(rebuilt.swim_desk_notes)[0].detail, "changed desk detail");
});

test("fixed legacy key routing does not rely on substring matches", () => {
  const model = loadModel();

  assert.equal(model.domainForLegacyKey("swim_students"), "roster");
  assert.equal(model.domainForLegacyKey("swim_bt_summer_stu"), "roster");
  assert.equal(model.domainForLegacyKey("swim_mark"), "workflow");
  assert.equal(model.domainForLegacyKey("zz_swim_day_snapshot__regular__2026-08-03"), "attendance");
  assert.equal(model.domainForLegacyKey("swim_students_backup"), "");
});

test("collection changes use deterministic IDs and reject invalid writable collections", () => {
  const model = loadModel();
  const before = convertedFixture();
  const after = clone(before);
  after.people.find(row => row.id === "stu_rename").name = "After Rename";
  const result = model.collectionChanges({before,after});

  assert.deepEqual(clone(result.issues), []);
  assert.deepEqual(clone(result.changes.filter(change => change.collection === "people")), [{
    type:"set",collection:"people",id:"stu_rename",value:after.people.find(row => row.id === "stu_rename"),
  }]);

  for(const invalid of [
    {people:[{id:"duplicate",name:"One"},{id:"duplicate",name:"Two"}]},
    {people:[{name:"Missing ID"}]},
    {placements:[{id:"one",tabId:"regular",slotKey:"4PM/Mon/1/1",personId:"one"},{id:"two",tabId:"regular",slotKey:"4PM/Mon/1/1",personId:"two"}]},
    {people:[{id:"profile",name:"One",phone:"01011112222"},{id:"profile",name:"Two",phone:"01022223333"}]},
  ]){
    const validation = model.validateRoundTrip({branchId:"yongam",collections:invalid});
    assert.ok(validation.issues.length > 0);
    assert.equal(validation.root, null);
  }
});

test("canonical digests and changed legacy keys ignore object-key order and honor allowed keys", () => {
  const model = loadModel();
  const before = {swim_mark:JSON.stringify({b:2,a:1}),swim_students:JSON.stringify([])};
  const after = {swim_mark:JSON.stringify({a:1,b:3}),swim_students:JSON.stringify([])};

  assert.equal(model.canonicalDigest({b:2,a:1}), model.canonicalDigest({a:1,b:2}));
  assert.deepEqual(clone(model.changedLegacyKeys(before, after, ["swim_mark"])), ["swim_mark"]);
  assert.deepEqual(clone(model.changedLegacyKeys(before, after, ["swim_students"])), []);
});
