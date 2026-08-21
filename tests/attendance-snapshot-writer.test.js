'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const writer=require('../js/attendance-snapshot-writer.js');

function plain(value){ return JSON.parse(JSON.stringify(value)); }
function deferred(){
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
function snapshot(){
  return {date:'2026-08-03',students:[{sid:'student_1',n:'Student'}],inst:{'4PM/Mon/1':'Teacher'}};
}

test('create-only snapshot waits for authoritative completion and caches only after success',async()=>{
  const wait=deferred();
  const writes=[];
  const cached=[];
  const service=writer.create({
    branchId:'yongam',
    async read(){ return null; },
    write(key,value,meta){ writes.push({key,value,meta:plain(meta)}); return wait.promise; },
    cache(date,value){ cached.push([date,plain(value)]); },
  });

  let settled=false;
  const pending=service.createOnly({scope:'regular',date:'2026-08-03',snapshot:snapshot()})
    .then(result=>{settled=true;return result;});
  await Promise.resolve();

  assert.equal(settled,false);
  assert.deepEqual(cached,[]);
  assert.equal(writes[0].key,'zz_swim_day_snapshot__regular__2026-08-03');
  assert.equal(writes[0].meta.operationType,'attendance-snapshot');
  assert.match(writes[0].meta.operationId,/^ats_[0-9a-f]{32}$/);

  wait.resolve({committed:true});
  const result=await pending;
  assert.equal(result.created,true);
  assert.deepEqual(cached,[['2026-08-03',snapshot()]]);
});

test('snapshot retry retains its opaque operation id and an interrupted write never updates cache',async()=>{
  const operationIds=[];
  const cached=[];
  let attempts=0;
  const service=writer.create({
    branchId:'yongam',
    async read(){ return null; },
    async write(key,value,meta){
      operationIds.push(meta.operationId);
      attempts+=1;
      if(attempts===1) throw Object.assign(new Error('interrupted'),{code:'unavailable'});
      return {committed:true};
    },
    cache(date,value){ cached.push([date,plain(value)]); },
  });
  const input={scope:'regular',date:'2026-08-03',snapshot:snapshot()};

  await assert.rejects(()=>service.createOnly(input),/interrupted/);
  assert.deepEqual(cached,[]);
  await service.createOnly(input);

  assert.equal(operationIds.length,2);
  assert.equal(operationIds[0],operationIds[1]);
  assert.equal(cached.length,1);
});

test('existing historical snapshots reject edit and delete attempts',async()=>{
  const existing=snapshot();
  let writes=0;
  const service=writer.create({
    branchId:'yongam',
    async read(){ return existing; },
    async write(){ writes+=1;return {committed:true}; },
    cache(){},
  });

  await assert.rejects(()=>service.createOnly({
    scope:'regular',date:'2026-08-03',snapshot:{...existing,students:[]},
  }),error=>error?.code==='attendance-snapshot-immutable');
  await assert.rejects(()=>service.remove({scope:'regular',date:'2026-08-03'}),
    error=>error?.code==='attendance-snapshot-immutable');
  assert.equal(writes,0);
});

test('main and teacher pages load and call the shared snapshot writer',()=>{
  const root=path.join(__dirname,'..');
  const main=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const teacherHtml=fs.readFileSync(path.join(root,'teacher.html'),'utf8');
  const data=fs.readFileSync(path.join(root,'js','data.js'),'utf8');
  const teacher=fs.readFileSync(path.join(root,'js','teacher.js'),'utf8');

  assert.ok(main.indexOf("scJs('js/attendance-snapshot-writer.js')")<main.indexOf("scJs('js/data.js')"));
  assert.ok(teacherHtml.indexOf("scJs('js/attendance-snapshot-writer.js')")<teacherHtml.indexOf("scJs('js/teacher.js')"));
  assert.match(data,/SCAttendanceSnapshotWriter\.create/);
  assert.match(teacher,/SCAttendanceSnapshotWriter\.create/);
  assert.doesNotMatch(teacher,/function teacherSnapshotOperationId/);
  const mainCaller=fs.readFileSync(path.join(root,'js','table.js'),'utf8');
  const mainStart=mainCaller.indexOf('function _ensureTodaySnapshot');
  const mainEnd=mainCaller.indexOf('/*',mainStart+10);
  const teacherStart=teacher.indexOf('function ensureTodaySnapshot');
  const teacherEnd=teacher.indexOf('function getAllTimes',teacherStart);
  assert.doesNotMatch(mainCaller.slice(mainStart,mainEnd),/DAY_SNAPSHOT\[today\]\s*=/);
  assert.doesNotMatch(teacher.slice(teacherStart,teacherEnd),/DAY_SNAPSHOT\[today\]\s*=/);
});

test('historical attendance editor rejects snapshot changes without showing success',()=>{
  const table=fs.readFileSync(path.join(__dirname,'..','js','table.js'),'utf8');
  function body(name){
    const start=table.indexOf(`function ${name}`);
    const open=table.indexOf('{',start);
    let depth=0;
    for(let index=open;index<table.length;index+=1){
      if(table[index]==='{') depth+=1;
      else if(table[index]==='}'&&--depth===0) return table.slice(start,index+1);
    }
    return '';
  }
  const edit=body('_saveEditModal');
  const remove=body('_deleteEditModal');

  assert.match(edit,/attendance-snapshot-immutable/);
  assert.doesNotMatch(edit,/과거 시간표 저장['"],['"]ok/);
  assert.match(remove,/attendance-snapshot-immutable/);
  assert.doesNotMatch(remove,/saveDaySnapshot/);
});
