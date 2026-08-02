const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function sourceBetween(source,startName,endName){
  const start=source.indexOf(`function ${startName}`);
  let end=source.indexOf(`async function ${endName}`,start);
  if(end<0) end=source.indexOf(`function ${endName}`,start);
  assert.notEqual(start,-1);
  assert.notEqual(end,-1);
  return source.slice(start,end);
}

function createHarness(confirmResult){
  const source=fs.readFileSync(path.join(__dirname,'..','js','popup-stu.js'),'utf8');
  const slotKey='4시/월/1/1';
  const student={sid:'stu-1',n:'홍길동',a:10,p:'01012345678',t:'4시',d:'월',l:1,r:1};
  const state={
    swim_students:[{...student}],
    swim_retire:{},
    swim_retire_history:[],
    swim_enroll:{},
    swim_hyuwon:{[slotKey]:{dates:['2026-07-30']}},
  };
  const deskNotes=[];
  let transactionCount=0;
  const context={
    console,
    Date,
    Promise,
    window:{},
    INST_MAP:{'4시/월/1':{n:'담당선생님'}},
    RETIRE_MAP:state.swim_retire,
    STORAGE_KEYS:{
      RETIRE:'swim_retire',
      RETIRE_HISTORY:'swim_retire_history',
      ENROLL:'swim_enroll',
      休원:'swim_hyuwon',
    },
    getTabConfig:()=>({stuKey:'swim_students'}),
    getToday:()=>new Date('2026-08-01T12:00:00'),
    toDateStr:()=> '2026-08-01',
    _dl:value=>value,
    confirm:()=>confirmResult,
    toast:()=>{},
    renderStuPopup:()=>{},
    buildTable:()=>{},
    _flashKey:'',
    _isReserveMoveEntry:()=>false,
    _retireEntryDate:entry=>entry?.ds||null,
    _retireChoiceKind:entry=>entry?.retireType||'move',
    _slotParts:key=>{
      const [t,d,l,r]=key.split('/');
      return {t,d,l:Number(l),r:Number(r)};
    },
    _isBangteukPopupSlot:()=>false,
    _findStudentIndexAt:(students,key)=>students.findIndex(row=>[
      row.t,row.d,String(row.l),String(row.r),
    ].join('/')===key),
    _studentIdentityMatches:(a,b)=>a?.sid===b?.sid,
    _retireHistoryPersonSlotMatches:(row,stu,key)=>{
      return row.sid===stu.sid&&[row.t,row.d,String(row.l),String(row.r)].join('/')===key;
    },
    _retireHistoryMatches:(row,stu,ds,key)=>{
      return row.retiredAt===ds&&row.sid===stu.sid&&[row.t,row.d,String(row.l),String(row.r)].join('/')===key;
    },
    _reservationEntryFromStudent:(stu,ds,extra)=>({ds,name:stu.n,sid:stu.sid,...extra}),
    ensureDeskNoteForRetireReservation:async(key,entry,stu)=>{
      deskNotes.push({key,entry,stu});
      return true;
    },
    updateRetireMapTx:async()=>{ throw new Error('past retirement must not use reservation save'); },
    updateScheduleTx:async(keys,mutator)=>{
      transactionCount++;
      let abortReason='';
      const result=mutator({
        get(key,fallback){ return state[key]===undefined?fallback:state[key]; },
        set(key,value){ state[key]=value; },
        abort(reason){ abortReason=reason||''; },
      });
      if(result===undefined) throw new Error(abortReason||'transaction aborted');
      context.RETIRE_MAP=state.swim_retire;
      return {committed:true};
    },
    ensureDeskNoteForStudentMove:()=>Promise.resolve(),
    _removeMatchingRetireHistory:()=>false,
    _removeOtherRetireHistories:()=>false,
    _hasMatchingRetireHistory:()=>false,
    addRetireHistory:()=>{},
  };
  context.window=context;
  vm.createContext(context);
  vm.runInContext(
    sourceBetween(source,'_pastRetireHistoryRecord','handleRetireChoiceSet'),
    context,
  );
  return {context,state,student,slotKey,deskNotes,getTransactionCount:()=>transactionCount};
}

test('confirming a past retirement removes the student immediately and records retirement once',async()=>{
  const harness=createHarness(true);

  const result=await harness.context._setRetireChoice(
    harness.slotKey,'2026-07-30',harness.student,null,'retire',
  );

  assert.equal(result.immediate,true);
  assert.equal(harness.getTransactionCount(),1);
  assert.equal(harness.state.swim_students.length,0);
  assert.equal(harness.state.swim_retire_history.length,1);
  assert.equal(harness.state.swim_retire_history[0].retiredAt,'2026-07-30');
  assert.equal(harness.state.swim_retire_history[0].recordedAt.startsWith('2026-07-30'),false);
  assert.equal(harness.state.swim_hyuwon[harness.slotKey],undefined);
  assert.equal(harness.deskNotes.length,1);
  assert.equal(harness.deskNotes[0].entry.retireType,'retire');
});

test('cancelling the confirmation leaves the schedule and history unchanged',async()=>{
  const harness=createHarness(false);

  const result=await harness.context._setRetireChoice(
    harness.slotKey,'2026-07-30',harness.student,null,'retire',
  );

  assert.equal(result.cancelled,true);
  assert.equal(harness.getTransactionCount(),0);
  assert.equal(harness.state.swim_students.length,1);
  assert.equal(harness.state.swim_retire_history.length,0);
  assert.equal(harness.deskNotes.length,0);
});
