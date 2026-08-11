"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.join(__dirname,"..");
function source(file){return fs.readFileSync(path.join(root,file),"utf8");}
function body(file,name){
  const value=source(file);
  const start=value.indexOf(`function ${name}`);
  assert.notEqual(start,-1,`${name} is missing from ${file}`);
  const open=value.indexOf("{",start);
  let depth=0;
  for(let index=open;index<value.length;index+=1){
    if(value[index]==="{") depth+=1;
    else if(value[index]==="}"&&--depth===0) return value.slice(start,index+1);
  }
  throw new Error(`${name} is incomplete in ${file}`);
}

test("live staff handlers use the shared operational adapter for every scenario workflow",()=>{
  const popup=body("js/popup-stu.js","handleSave");
  const reservations=body("js/data.js","updateReserveMapTx");
  const addReservation=body("js/data.js","addReserve");
  const attendance=body("js/data.js","updateAttendanceMapTx");
  const guests=body("js/data.js","updateAttGuestsMapTx");
  const records=body("js/data.js","_updateDeskNotesTx");
  const tabs=body("js/tabs.js","updateTabSettingsTx");

  assert.match(popup,/getMainScheduleLiveHandlers\(\).*replaceScheduledStudents/s);
  assert.match(reservations,/getMainScheduleLiveHandlers\(\).*setReservations/s);
  assert.match(addReservation,/getMainScheduleLiveHandlers\(\).*addWaitlistEntry/s);
  assert.match(attendance,/getMainScheduleLiveHandlers\(\).*updateAttendance/s);
  assert.match(guests,/getMainScheduleLiveHandlers\(\).*updateAttendance/s);
  assert.match(records,/getMainScheduleLiveHandlers\(\).*updateManualRecords/s);
  assert.match(tabs,/getMainScheduleLiveHandlers\(\).*updateTabs/s);
});

test("live export awaits and renders the prepared operational view",()=>{
  const exportExcel=body("js/table.js","exportExcel");
  assert.match(source("js/table.js"),/async function exportExcel/);
  assert.match(exportExcel,/await prepareLiveScheduleExportView\(\)/);
  assert.match(exportExcel,/renderLiveScheduleExportView\(/);
  assert.doesNotMatch(exportExcel,/prepareLiveScheduleExportView\(\)\.catch/);
});
