const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function sourceBetween(source,startText,endText){
  const start=source.indexOf(startText);
  const end=source.indexOf(endText,start);
  assert.notEqual(start,-1);
  assert.notEqual(end,-1);
  return source.slice(start,end);
}

const tableSource=fs.readFileSync(path.join(__dirname,'..','js','table.js'),'utf8');

function createHarness(){
  const student={sid:'student-1',n:'퇴원예정원생',p:'01012345678',t:'4시',d:'월',l:1,r:1};
  const slotKey='4시/월/1/1';
  const context={
    window:{SCScheduleTime:{
      compareTimes:(_day,a,b)=>String(a).localeCompare(String(b)),
      normalizeTimeBase:value=>String(value),
    }},
    INST_MAP:{'4시/월/1':{n:'담당선생님'}},
    STUDENTS:[student],
    ENROLL_MAP:{},
    RETIRE_MAP:{[slotKey]:{sid:student.sid,name:student.n,p:student.p,ds:'2026-09-10',retireType:'retire'}},
    DISABLED_MAP:{},
    getDays:()=>['월'],
    getLanes:()=>1,
    getTimes:()=>[{t:'4시'}],
    isBangteuk:()=>false,
    _summaryBangteukStatsActive:()=>false,
    _summaryInstExists:inst=>!!inst,
    _summaryIsBangteukGroupDay:()=>false,
    _summaryIsBangteukInst:()=>false,
    _summaryIsBangteukSlotKey:()=>false,
    _summaryRowsForInst:()=>5,
    _summaryIsTemporaryOnly:()=>false,
    _summaryEntryPersonKey:entry=>String(entry?.sid||entry?.n||entry?.name||''),
    _summaryEntryMatchesPerson:()=>true,
    _summaryPairFallback:()=>null,
    _summaryDate:value=>String(value||''),
    _retireReservationSuffix:()=>'',
    _summaryRetireStatus:()=> '퇴원예정',
    _summaryEnrollStatus:()=> '등록예정',
    _summaryRecord:(entry,status,key,_detail,fallback)=>({
      n:entry?.n||entry?.name||fallback?.n||'',
      p:entry?.p||fallback?.p||'',
      status,
      slot:{key,text:key},
    }),
    _summaryAddPerson:(map,record,counted)=>{
      const key=record.n+'|'+record.p;
      if(!map.has(key)) map.set(key,{key,n:record.n,p:record.p,counted,states:new Set(),slots:[]});
      const row=map.get(key);
      row.states.add(record.status);
      row.slots.push(record.slot);
    },
    _summaryRowsFromMap:map=>[...map.values()],
  };
  vm.createContext(context);
  vm.runInContext(
    sourceBetween(tableSource,'function getScheduleSummaryData','function updateScheduleSummary'),
    context,
    {filename:'schedule-summary-retirement.js'},
  );
  return context;
}

test('a retirement reservation stays counted until its student leaves the timetable',()=>{
  const summary=createHarness().getScheduleSummaryData();

  assert.equal(summary.countedRows.length,1);
  assert.equal(summary.regularHours,1);
  assert.equal(summary.excludedRows.length,1);
  assert.equal(summary.excludedOnlyRows.length,0);
});
