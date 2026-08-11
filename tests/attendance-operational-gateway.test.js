const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function plain(value){ return JSON.parse(JSON.stringify(value)); }
function deferred(){
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}

function loadGateway(options){
  const context={window:{},console,Date,Promise,setTimeout,clearTimeout};
  vm.createContext(context);
  for(const file of ['schedule-time.js','schedule-schema-v2.js','attendance-v2-model.js','attendance-operational-gateway.js']){
    vm.runInContext(fs.readFileSync(path.join(__dirname,'..','js',file),'utf8'),context,{filename:file});
  }
  return context.window.SCOperationalAttendance.create(options);
}

function fixture(mode,overrides={}){
  const calls={legacyLoads:0,legacyAttendanceWrites:0,legacyGuestWrites:0,v2Reads:0,v2ReadInputs:[],v2Batches:0,v2GuestReplaces:0,operationalMutations:[],compares:0,order:[]};
  let legacyAttendance=plain(overrides.legacyAttendance||{'4시/월/1/1/2026-08-03':{s:'absent'}});
  let legacyGuests=plain(overrides.legacyGuests||{});
  let v2Attendance=plain(overrides.v2Attendance||legacyAttendance);
  let v2Guests=plain(overrides.v2Guests||legacyGuests);
  const modelContext={window:{},console};
  vm.createContext(modelContext);
  for(const file of ['schedule-time.js','schedule-schema-v2.js','attendance-v2-model.js']){
    vm.runInContext(fs.readFileSync(path.join(__dirname,'..','js',file),'utf8'),modelContext,{filename:file});
  }
  const model=modelContext.window.SCV2AttendanceModel;

  function rowsFromMaps(){
    const records=Object.entries(v2Attendance).map(([legacyKey,raw])=>model.recordFromLegacy({
      tabId:'regular',courseType:'regular',legacyKey,raw,
    }));
    const guests=[];
    Object.entries(v2Guests).forEach(([legacyKey,list])=>{
      (Array.isArray(list)?list:[]).forEach((raw,index)=>guests.push(model.guestFromLegacy({
        tabId:'regular',courseType:'regular',legacyKey,raw,index,
      })));
    });
    return {records,guests};
  }
  async function applyLegacy(mutator,kind){
    const current=kind==='attendance'?legacyAttendance:legacyGuests;
    const draft=plain(current);
    const returned=await mutator(draft);
    const next=plain(returned&&typeof returned==='object'?returned:draft);
    if(kind==='attendance') legacyAttendance=next;
    else legacyGuests=next;
    return next;
  }
  const legacy={
    async loadRange(){
      calls.legacyLoads+=1;calls.order.push('legacy-read');
      if(overrides.legacyReadError) throw new Error('legacy read failed');
      return {attendance:plain(legacyAttendance),guests:plain(legacyGuests)};
    },
    async updateAttendance(mutator){
      calls.legacyAttendanceWrites+=1;calls.order.push('legacy-write');
      if(overrides.legacyWriteError) throw new Error('legacy write failed');
      return applyLegacy(mutator,'attendance');
    },
    async updateGuests(mutator){
      calls.legacyGuestWrites+=1;calls.order.push('legacy-guest-write');
      if(overrides.legacyGuestWriteError) throw new Error('legacy guest write failed');
      return applyLegacy(mutator,'guests');
    },
  };
  const v2Store={
    async readConfig(){
      if(overrides.configError) throw new Error('config failed');
      if(Object.prototype.hasOwnProperty.call(overrides,'configValue')) return plain(overrides.configValue);
      return {
        mode,generationId:mode==='v1'?'':'gen_1',branchId:'yongam',
        epoch:7,revision:12,valid:true,
        compatibilityValid:overrides.compatibilityValid!==false,
        compatibilityCode:overrides.compatibilityValid===false?'attendance-pointer-mismatch':'',
      };
    },
    async readRange(input){
      calls.v2Reads+=1;calls.order.push('v2-read');
      calls.v2ReadInputs.push(plain(input));
      if(overrides.v2ReadPromise) return overrides.v2ReadPromise;
      if(overrides.v2ReadError) throw new Error('v2 read failed');
      if(overrides.v2ReadRange) return overrides.v2ReadRange(plain(input));
      const rows=rowsFromMaps();
      return {...rows,maps:{attendance:plain(v2Attendance),guests:plain(v2Guests),issues:[]}};
    },
    async writeRecordBatch(changes){
      calls.v2Batches+=1;calls.order.push('v2-write');
      if(overrides.v2WriteError) throw new Error('v2 write failed');
      for(const change of changes){
        if(change.collection!=='attendanceRecords') continue;
        const key=change.legacyKey||change.row?.legacyKey;
        if(change.type==='delete') delete v2Attendance[key];
        else v2Attendance[key]=plain(change.row.payload);
      }
      return {written:changes.length};
    },
    async replaceGuestGroup(input){
      calls.v2GuestReplaces+=1;calls.order.push('v2-guest-write');
      if(overrides.v2WriteError) throw new Error('v2 write failed');
      const key=input.legacyKey||input.rows[0]?.legacyKey||input.existingRows[0]?.legacyKey;
      if(key) v2Guests[key]=input.rows.map(row=>plain(row.payload));
      return {written:input.rows.length};
    },
    async mutateMap(input){
      calls.operationalMutations.push(plain(input));calls.order.push('operational-mutation');
      if(overrides.operationalWriteError||overrides.v2WriteError) throw Object.assign(new Error('operational failed'),{code:'failed-precondition'});
      const diff=model.diffLegacyMaps(input.before,input.after);
      const apply=current=>{
        const next=plain(current);
        diff.upserts.forEach(change=>{next[change.legacyKey]=plain(change.raw);});
        diff.deletes.forEach(legacyKey=>{delete next[legacyKey];});
        return next;
      };
      if(input.kind==='attendance'){
        v2Attendance=apply(v2Attendance);
        if(mode==='v2-read') legacyAttendance=apply(legacyAttendance);
      }else{
        v2Guests=apply(v2Guests);
        if(mode==='v2-read') legacyGuests=apply(legacyGuests);
      }
      return {operationId:input.operationId,committed:true,revision:13,changeCount:Object.keys(input.after||{}).length,recoveryState:'applied'};
    },
    compareRange(input){
      calls.compares+=1;calls.order.push('compare');
      if(overrides.compareMismatch) return {ready:false,mismatchCount:1,issues:[{type:'attendance-payload-mismatch'}],diagnostic:{ready:false,mismatchCount:1}};
      return {ready:true,mismatchCount:0,issues:[],diagnostic:{ready:true,mismatchCount:0}};
    },
  };
  const gateway=loadGateway({
    branchId:'yongam',legacy,v2Store,model,
    now:()=>new Date('2026-08-07T03:00:00.000Z'),
  });
  return {
    gateway,calls,
    legacyAttendance:()=>plain(legacyAttendance),
    legacyGuests:()=>plain(legacyGuests),
    v2Attendance:()=>plain(v2Attendance),
  };
}

const range={owner:'attendance-main',tabId:'regular',courseType:'regular',dates:['2026-08-03']};
const key='4시/월/1/1/2026-08-03';

test('v1 mode reads and writes only the legacy attendance map',async()=>{
  const env=fixture('v1');
  await env.gateway.ready();
  const loaded=await env.gateway.loadRange(range);
  const saved=await env.gateway.updateAttendance(map=>({...map,[key]:{s:'present'}}),{
    ...range,before:loaded.attendance,
  });

  assert.equal(loaded.primary,'v1');
  assert.equal(saved.primary,'v1');
  assert.equal(saved.attendance[key].s,'present');
  assert.deepEqual(env.calls,{legacyLoads:1,legacyAttendanceWrites:1,legacyGuestWrites:0,v2Reads:0,v2ReadInputs:[],v2Batches:0,v2GuestReplaces:0,operationalMutations:[],compares:0,order:['legacy-read','legacy-write']});
});

test('an unreadable attendance authority remains readable from V1 but rejects every V1 write',async()=>{
  const env=fixture('v1',{configError:true});
  const loaded=await env.gateway.loadRange(range);

  assert.equal(loaded.primary,'v1');
  await assert.rejects(()=>env.gateway.updateAttendance(map=>({...map,[key]:{s:'present'}}),{
    ...range,before:loaded.attendance,
  }),error=>error?.code==='operational-authority-unavailable');
  assert.equal(env.calls.legacyLoads,1);
  assert.equal(env.calls.legacyAttendanceWrites,0);
});

test('malformed attendance authority never grants an implicit V1 write',async()=>{
  const invalidConfigs=[
    {mode:'v1',generationId:'',branchId:'yongam',epoch:7,revision:12,valid:false,compatibilityValid:true},
    {mode:'unknown',generationId:'',branchId:'yongam',epoch:7,revision:12,valid:true,compatibilityValid:true},
    {mode:'v1',generationId:'',branchId:'gagyeong',epoch:7,revision:12,valid:true,compatibilityValid:true},
    {mode:'v1',generationId:'',branchId:'yongam',epoch:7,revision:-1,valid:true,compatibilityValid:true},
  ];
  for(const candidate of invalidConfigs){
    const env=fixture('v1',{configValue:candidate});
    await env.gateway.ready();
    await assert.rejects(()=>env.gateway.updateAttendance(map=>({...map,[key]:{s:'present'}}),{
      ...range,before:{[key]:{s:'absent'}},
    }),error=>error?.code==='operational-authority-unavailable',JSON.stringify(candidate));
    assert.equal(env.calls.legacyAttendanceWrites,0,JSON.stringify(candidate));
  }
});

test('a compatibility pointer mismatch blocks a confirmed V2 save with redacted diagnostics',async()=>{
  const env=fixture('v2',{compatibilityValid:false});
  await env.gateway.ready();

  await assert.rejects(()=>env.gateway.updateAttendance(map=>({...map,[key]:{s:'present',n:'private'}}),{
    ...range,before:{[key]:{s:'absent'}},
  }),error=>error?.code==='attendance-pointer-mismatch');

  assert.equal(env.calls.v2Batches,0);
  assert.equal(env.calls.operationalMutations.length,0);
  assert.doesNotMatch(JSON.stringify(env.gateway.diagnostics()),/private/);
});

test('confirmed V2 attendance uses one idempotent operational mutation request',async()=>{
  const env=fixture('v2');
  await env.gateway.ready();
  const result=await env.gateway.updateAttendance(map=>({...map,[key]:{s:'present'}}),{
    ...range,before:{[key]:{s:'absent'}},operationId:'attendance_regular_1',
  });

  assert.equal(result.primary,'v2');
  assert.equal(env.calls.v2Batches,0);
  assert.equal(env.calls.operationalMutations.length,1);
  assert.deepEqual(env.calls.operationalMutations[0],{
    kind:'attendance',tabId:'regular',courseType:'regular',
    before:{[key]:{s:'absent'}},after:{[key]:{s:'present'}},
    operationId:'attendance_regular_1',operationType:'attendance-update',
  });
});

test('shadow keeps V1 authoritative without direct browser V2 mirroring',async()=>{
  const env=fixture('shadow',{v2WriteError:true});
  await env.gateway.ready();
  const result=await env.gateway.updateAttendance(map=>({...map,[key]:{s:'present'}}),{
    ...range,before:{[key]:{s:'absent'}},
  });

  assert.equal(result.attendance[key].s,'present');
  assert.equal(result.degraded,false);
  assert.equal(result.primary,'v1');
  assert.equal(env.calls.legacyAttendanceWrites,1);
  assert.equal(env.calls.v2Batches,0);
  assert.equal(env.calls.operationalMutations.length,0);
});

test('verify writes V1 first then awaits V2 and parity comparison',async()=>{
  const env=fixture('verify');
  await env.gateway.ready();
  const result=await env.gateway.updateAttendance(map=>({...map,[key]:{s:'present'}}),{
    ...range,before:{[key]:{s:'absent'}},
  });

  assert.equal(result.primary,'v1');
  assert.equal(result.degraded,false);
  assert.deepEqual(env.calls.order,['legacy-write','v2-read','compare']);
  assert.deepEqual(env.calls.v2ReadInputs,[{
    generationId:'gen_1',tabId:'regular',courseType:'regular',dates:['2026-08-03'],
  }]);
  assert.equal(env.calls.compares,1);
});

test('named current and archived regular tabs read one canonical regular map without bangteuk',async()=>{
  const currentKey='4시/월/1/1/2026-08-03';
  const archivedKey='5시/화/1/1/2026-08-04';
  const bangteukKey='10시/월/1/1/2026-08-03';
  const currentGuestKey='4시/월/1/2026-08-03';
  const archivedGuestKey='5시/화/1/2026-08-04';
  const bangteukGuestKey='10시/월/1/2026-08-03';
  const env=fixture('v2',{
    v2ReadRange(input){
      assert.equal(input.courseType,'regular');
      return {records:[],guests:[],maps:{
        attendance:{
          [currentKey]:{s:'present'},
          [archivedKey]:{s:'absent'},
        },
        guests:{
          [currentGuestKey]:[{gid:'current'}],
          [archivedGuestKey]:[{gid:'archive'}],
        },
        issues:[],
      }};
    },
  });

  const current=await env.gateway.loadRange({
    owner:'attendance-current',tabId:'august',courseType:'regular',
    dates:['2026-08-03','2026-08-04'],
  });
  const archived=await env.gateway.loadRange({
    owner:'attendance-archive',tabId:'july-archive',courseType:'regular',
    dates:['2026-08-03','2026-08-04'],
  });

  for(const result of [current,archived]){
    assert.deepEqual(plain(result.attendance),{
      [currentKey]:{s:'present'},
      [archivedKey]:{s:'absent'},
    });
    assert.deepEqual(plain(result.guests),{
      [currentGuestKey]:[{gid:'current'}],
      [archivedGuestKey]:[{gid:'archive'}],
    });
    assert.equal(result.attendance[bangteukKey],undefined);
    assert.equal(result.guests[bangteukGuestKey],undefined);
  }
  assert.deepEqual(env.calls.v2ReadInputs.map(input=>({tabId:input.tabId,courseType:input.courseType})),[
    {tabId:'august',courseType:'regular'},
    {tabId:'july-archive',courseType:'regular'},
  ]);
});

test('shadow and verify comparison reads retain the requested course type',async()=>{
  for(const mode of ['shadow','verify']){
    const env=fixture(mode);
    await env.gateway.loadRange({
      owner:`attendance-${mode}`,tabId:'august',courseType:'regular',dates:['2026-08-03'],
    });
    assert.deepEqual(env.calls.v2ReadInputs,[{
      generationId:'gen_1',tabId:'august',courseType:'regular',dates:['2026-08-03'],
    }]);
  }
});

test('literal regular ownership is safely inferred but an ambiguous named tab is rejected',async()=>{
  const safe=fixture('v2');
  await safe.gateway.loadRange({owner:'attendance-safe',tabId:'regular',dates:['2026-08-03']});
  assert.equal(safe.calls.v2ReadInputs[0].courseType,'regular');

  const ambiguous=fixture('v2');
  await assert.rejects(()=>ambiguous.gateway.loadRange({
    owner:'attendance-ambiguous',tabId:'august',dates:['2026-08-03'],
  }),error=>error?.code==='ambiguous-attendance-owner');
  assert.equal(ambiguous.calls.v2Reads,0);
});

test('v2-read loads V2 and never mixes a failed range with V1',async()=>{
  const env=fixture('v2-read',{v2ReadError:true});
  await env.gateway.ready();

  await assert.rejects(()=>env.gateway.loadRange(range),/V2 출석 데이터를 불러오지 못했습니다/);
  assert.equal(env.calls.legacyLoads,0);
});

test('v2-read uses the callable recovery path and blocks recovery after V2 failure',async()=>{
  const success=fixture('v2-read');
  await success.gateway.ready();
  const result=await success.gateway.updateAttendance(map=>({...map,[key]:{s:'present'}}),{
    ...range,before:{[key]:{s:'absent'}},
  });
  assert.equal(result.primary,'v2');
  assert.deepEqual(success.calls.order,['operational-mutation']);
  assert.equal(success.calls.legacyAttendanceWrites,0);

  const failed=fixture('v2-read',{v2WriteError:true});
  await failed.gateway.ready();
  await assert.rejects(()=>failed.gateway.updateAttendance(map=>({...map,[key]:{s:'present'}}),{
    ...range,before:{[key]:{s:'absent'}},
  }),/V2 출석 데이터를 저장하지 못했습니다/);
  assert.equal(failed.calls.legacyAttendanceWrites,0);
});

test('v2-read backup patches attendance without deleting legacy dates outside the loaded range',async()=>{
  const otherKey='4시/화/1/1/2026-08-04';
  const env=fixture('v2-read',{
    legacyAttendance:{
      [key]:{s:'absent'},
      [otherKey]:{s:'present',by:'기존 기록'},
    },
    v2Attendance:{[key]:{s:'absent'}},
  });
  await env.gateway.ready();
  await env.gateway.updateAttendance(map=>({...map,[key]:{s:'present'}}),{
    ...range,before:{[key]:{s:'absent'}},
  });

  assert.equal(env.legacyAttendance()[key].s,'present');
  assert.deepEqual(env.legacyAttendance()[otherKey],{s:'present',by:'기존 기록'});
});

test('v2-read backup patches guests without deleting legacy dates outside the loaded range',async()=>{
  const guestKey='4시/월/1/2026-08-03';
  const otherGuestKey='4시/화/1/2026-08-04';
  const env=fixture('v2-read',{
    legacyGuests:{
      [guestKey]:[{gid:'guest_a',n:'당일 원생'}],
      [otherGuestKey]:[{gid:'guest_b',n:'다른 날짜 원생'}],
    },
    v2Guests:{[guestKey]:[{gid:'guest_a',n:'당일 원생'}]},
  });
  await env.gateway.ready();
  await env.gateway.updateGuests(map=>({...map,[guestKey]:[
    {gid:'guest_a',n:'당일 원생',s:'present'},
  ]}),{
    ...range,before:{[guestKey]:[{gid:'guest_a',n:'당일 원생'}]},
  });

  assert.equal(env.legacyGuests()[guestKey][0].s,'present');
  assert.deepEqual(env.legacyGuests()[otherGuestKey],[{gid:'guest_b',n:'다른 날짜 원생'}]);
});

test('v2 mode does not read or write the V1 attendance map',async()=>{
  const env=fixture('v2');
  await env.gateway.ready();
  const loaded=await env.gateway.loadRange(range);
  await env.gateway.updateAttendance(map=>({...map,[key]:{s:'present'}}),{
    ...range,before:loaded.attendance,
  });

  assert.equal(env.calls.v2Reads,1);
  assert.equal(env.calls.operationalMutations.length,1);
  assert.equal(env.calls.legacyLoads,0);
  assert.equal(env.calls.legacyAttendanceWrites,0);
});

test('an unchanged map performs no V2 write',async()=>{
  const env=fixture('shadow');
  await env.gateway.ready();
  const result=await env.gateway.updateAttendance(map=>map,{
    ...range,before:{[key]:{s:'absent'}},
  });

  assert.equal(result.changed,0);
  assert.equal(env.calls.v2Batches,0);
});

test('releasing a range rejects a late response as stale',async()=>{
  const wait=deferred();
  const env=fixture('v2-read',{v2ReadPromise:wait.promise});
  await env.gateway.ready();
  const pending=env.gateway.loadRange(range);
  env.gateway.releaseRange('attendance-main');
  wait.resolve({records:[],guests:[],maps:{attendance:{},guests:{},issues:[]}});

  await assert.rejects(()=>pending,error=>error&&error.code==='stale-attendance-range');
});

test('diagnostics are bounded and never retain attendance payload values',async()=>{
  const env=fixture('shadow',{v2WriteError:true});
  await env.gateway.ready();
  for(let index=0;index<85;index++){
    await env.gateway.updateAttendance(map=>({...map,[key]:{s:'present',n:'비밀원생',p:'01012345678'}}),{
      ...range,before:{[key]:{s:'absent'}},
    });
  }
  const rows=env.gateway.diagnostics(100);

  assert.equal(rows.length,80);
  assert.doesNotMatch(JSON.stringify(rows),/비밀원생|01012345678/);
  assert.deepEqual(Object.keys(rows[0]).sort(),[
    'at','branchId','dates','durationMs','kind','mode','outcome','recordCount','tabId',
  ]);
});
