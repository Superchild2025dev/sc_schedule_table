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

const source=fs.readFileSync(path.join(__dirname,'..','js','popup-stu.js'),'utf8');
const context={
  Date,
  _isReserveMoveEntry:entry=>!!entry?.moveId,
  _popupRetireIsActual:entry=>entry?.retireType==='retire',
  _deleteReserveMovePair:(retire,enroll,kind,key)=>{
    if(kind==='retire') delete retire[key];
    else delete enroll[key];
    return false;
  },
  _isActiveFutureRequestForSlot:()=>false,
};
vm.createContext(context);
vm.runInContext(
  sourceBetween(source,'_replacementRetireShouldStay','handleSave'),
  context,
  {filename:'replacement-retire-preserve.js'},
);

function stateWith(entry){
  return {
    retire:{'4시/월/1/1':entry},
    enroll:{},
    marks:{},
    hyuwon:{'4시/월/1/1':{dates:['2026-08-10']}},
    disabled:{'4시/월/1/1':true},
    requests:{},
    attendance:{},
  };
}

test('replacing a student preserves the previous actual retirement badge data',()=>{
  const retirement={
    ds:'2026-08-10',
    sid:'old-student',
    name:'기존원생',
    p:'01011112222',
    retireType:'retire',
  };
  const state=stateWith(retirement);

  context._clearReplacementFutureState(
    state,
    [{slotKey:'4시/월/1/1'}],
    '2026-08-01',
    {preserveRetire:true},
  );

  assert.deepEqual(state.retire['4시/월/1/1'],retirement);
  assert.equal(state.hyuwon['4시/월/1/1'],undefined);
  assert.equal(state.disabled['4시/월/1/1'],undefined);
});

test('replacement still clears move and reduced-frequency exclusions',()=>{
  const state=stateWith({
    ds:'2026-08-10',
    name:'기존원생',
    retireType:'exclude',
    excludeReason:'reduce',
  });

  context._clearReplacementFutureState(
    state,
    [{slotKey:'4시/월/1/1'}],
    '2026-08-01',
    {preserveRetire:true},
  );

  assert.equal(state.retire['4시/월/1/1'],undefined);
});
