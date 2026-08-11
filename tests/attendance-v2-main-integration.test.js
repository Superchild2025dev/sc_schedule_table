const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const runtimePath=path.join(__dirname,'..','js','attendance-main-runtime.js');
const root=path.join(__dirname,'..');
function plain(value){ return JSON.parse(JSON.stringify(value)); }
function deferred(){
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
function loadRuntime(){
  const context={window:{},console,Promise};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(runtimePath,'utf8'),context,{filename:'attendance-main-runtime.js'});
  return context.window.SCMainAttendanceRuntime;
}
function fixture(mode,overrides={}){
  const calls={prepared:[],loads:[],attendanceWrites:0,guestWrites:0,batchWrites:0,released:[]};
  let maps=plain(overrides.maps||{
    attendance:{'4시/화/1/1/2026-08-04':{s:'present'}},
    guests:{'4시/화/1/2026-08-04':[{gid:'old'}]},
  });
  let config={mode,generationId:mode==='v1'?'':'gen_1',branchId:'yongam',epoch:3,revision:9,valid:true};
  const gateway={
    async ready(){ return plain(config); },
    mode(){ return mode; },
    context(input={}){
      return {...plain(config),owner:input.owner||'attendance-main',tabId:input.tabId||'',dateRange:[...(input.dates||[])]};
    },
    async loadRange(input){
      calls.loads.push(plain(input));
      if(overrides.loadRange) return overrides.loadRange(input);
      return {
        attendance:{'4시/월/1/1/2026-08-03':{s:'absent'}},
        guests:{'4시/월/1/2026-08-03':[{gid:'new'}]},
        primary:mode==='v2-read'||mode==='v2'?'v2':'v1',
      };
    },
    async updateAttendance(mutator,input){
      calls.attendanceWrites+=1;
      if(overrides.attendanceWrite) return overrides.attendanceWrite(mutator,input);
      const draft=plain(input.before);
      const next=await mutator(draft)||draft;
      return {attendance:plain(next),primary:mode.startsWith('v2')?'v2':'v1'};
    },
    async updateGuests(mutator,input){
      calls.guestWrites+=1;
      if(overrides.guestWrite) return overrides.guestWrite(mutator,input);
      const draft=plain(input.before);
      const next=await mutator(draft)||draft;
      return {guests:plain(next),primary:mode.startsWith('v2')?'v2':'v1'};
    },
    async setManyAttendance(input){
      calls.batchWrites+=1;
      if(overrides.batchWrite) return overrides.batchWrite(input);
      return {attendance:plain(input.after||input.before),primary:mode.startsWith('v2')?'v2':'v1'};
    },
    releaseRange(owner){ calls.released.push(owner); },
  };
  const runtime=loadRuntime().create({
    branchId:'yongam',gateway,
    async prepareKeys(keys){ calls.prepared.push(plain(keys)); },
    getMaps(){ return plain(maps); },
    setMaps(next){ maps=plain(next); },
  });
  return {runtime,calls,maps:()=>plain(maps),setConfig(next){config={...config,...next};}};
}

const regularRange={
  tabId:'regular',courseType:'regular',dates:['2026-08-03'],
  baseKeys:['swim_students','swim_inst'],
  attendanceKeys:['swim_attendance','swim_att_guests'],
};

test('V1 modes prepare legacy attendance keys while V2 authority modes omit them',async()=>{
  for(const mode of ['v1','shadow','verify']){
    const env=fixture(mode);
    await env.runtime.loadRanges({owner:'attendance-main',ranges:[regularRange]});
    assert.deepEqual(env.calls.prepared[0],[
      'swim_students','swim_inst','swim_attendance','swim_att_guests',
    ]);
  }
  for(const mode of ['v2-read','v2']){
    const env=fixture(mode);
    await env.runtime.loadRanges({owner:'attendance-main',ranges:[regularRange]});
    assert.deepEqual(env.calls.prepared[0],['swim_students','swim_inst']);
  }
});

test('a range load preserves visible maps until the new response is complete',async()=>{
  const wait=deferred();
  const env=fixture('v2-read',{loadRange:()=>wait.promise});
  const before=env.maps();
  const pending=env.runtime.loadRanges({owner:'attendance-main',ranges:[regularRange]});
  await Promise.resolve();
  assert.deepEqual(env.maps(),before);

  wait.resolve({
    attendance:{'4시/월/1/1/2026-08-03':{s:'present'}},
    guests:{},primary:'v2',
  });
  await pending;
  assert.equal(env.maps().attendance['4시/월/1/1/2026-08-03'].s,'present');
  assert.equal(env.maps().attendance['4시/화/1/1/2026-08-04'].s,'present');
});

test('only the latest rapid date selection may replace the visible range',async()=>{
  const first=deferred();
  const second=deferred();
  let count=0;
  const env=fixture('v2-read',{loadRange:()=>++count===1?first.promise:second.promise});
  const oldLoad=env.runtime.loadRanges({owner:'attendance-main',ranges:[regularRange]});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(count,1);
  const nextRange={...regularRange,dates:['2026-08-10']};
  const newLoad=env.runtime.loadRanges({owner:'attendance-main',ranges:[nextRange]});
  second.resolve({
    attendance:{'4시/월/1/1/2026-08-10':{s:'present'}},guests:{},primary:'v2',
  });
  await newLoad;
  first.resolve({
    attendance:{'4시/월/1/1/2026-08-03':{s:'absent'}},guests:{},primary:'v2',
  });
  const stale=await oldLoad;

  assert.equal(stale.stale,true);
  assert.equal(env.maps().attendance['4시/월/1/1/2026-08-10'].s,'present');
  assert.equal(env.maps().attendance['4시/월/1/1/2026-08-03'],undefined);
});

test('attendance and guest mutations keep the existing update contract',async()=>{
  const env=fixture('v2-read');
  const attendance=await env.runtime.updateAttendance(map=>{
    map['4시/월/1/1/2026-08-03']={s:'present'};
    return map;
  },{tabId:'regular',courseType:'regular',dates:['2026-08-03']});
  const guests=await env.runtime.updateGuests(map=>{
    map['4시/월/1/2026-08-03']=[{gid:'a'}];
    return map;
  },{tabId:'regular',courseType:'regular',dates:['2026-08-03']});

  assert.equal(attendance['4시/월/1/1/2026-08-03'].s,'present');
  assert.equal(guests['4시/월/1/2026-08-03'][0].gid,'a');
  assert.equal(env.calls.attendanceWrites,1);
  assert.equal(env.calls.guestWrites,1);
});

test('a late attendance success cannot replace a newer date and tab context',async()=>{
  const write=deferred();
  const env=fixture('v2',{attendanceWrite:()=>write.promise,loadRange:input=>({
    attendance:{[`loaded/${input.tabId}/${input.dates[0]}`]:{s:'present'}},guests:{},primary:'v2',
  })});
  await env.runtime.loadRanges({owner:'attendance-main',ranges:[regularRange]});
  const pending=env.runtime.updateAttendance(map=>({...map,old:{s:'present'}}),{
    owner:'attendance-main',tabId:'regular',courseType:'regular',dates:['2026-08-03'],
  });
  const newer={...regularRange,tabId:'summer',courseType:'bangteuk',dates:['2026-08-10']};
  await env.runtime.loadRanges({owner:'attendance-main',ranges:[newer]});

  write.resolve({attendance:{old:{s:'present'}},primary:'v2',context:{
    owner:'attendance-main',tabId:'regular',dateRange:['2026-08-03'],
    branchId:'yongam',generationId:'gen_1',epoch:3,revision:10,
  }});
  await assert.rejects(()=>pending,error=>error?.code==='stale-attendance-context');

  assert.equal(env.maps().attendance.old,undefined);
  assert.equal(env.maps().attendance['loaded/summer/2026-08-10'].s,'present');
  assert.equal(env.calls.loads.filter(item=>item.tabId==='summer').length,2);
});

test('late guest and batch successes are fenced from a newer range',async()=>{
  for(const kind of ['guest','batch']){
    const wait=deferred();
    const env=fixture('v2',{
      guestWrite:kind==='guest'?()=>wait.promise:undefined,
      batchWrite:kind==='batch'?()=>wait.promise:undefined,
      loadRange:input=>({attendance:{[`current/${input.dates[0]}`]:{s:'present'}},guests:{},primary:'v2'}),
    });
    await env.runtime.loadRanges({owner:'attendance-main',ranges:[regularRange]});
    const context={owner:'attendance-main',tabId:'regular',courseType:'regular',dates:['2026-08-03']};
    const pending=kind==='guest'
      ?env.runtime.updateGuests(map=>({...map,oldGuest:[{gid:'old'}]}),context)
      :env.runtime.setManyAttendance({...context,after:{oldBatch:{s:'present'}}});
    await env.runtime.loadRanges({owner:'attendance-main',ranges:[{...regularRange,dates:['2026-08-10']}]});
    wait.resolve({
      ...(kind==='guest'?{guests:{oldGuest:[{gid:'old'}]}}:{attendance:{oldBatch:{s:'present'}}}),
      primary:'v2',context:{...context,dateRange:context.dates,branchId:'yongam',generationId:'gen_1',epoch:3,revision:10},
    });

    await assert.rejects(()=>pending,error=>error?.code==='stale-attendance-context');
    assert.equal(env.maps().guests.oldGuest,undefined,kind);
    assert.equal(env.maps().attendance.oldBatch,undefined,kind);
  }
});

test('a late write from the old branch refreshes the newer branch owner without replacing it',async()=>{
  const api=loadRuntime();
  const write=deferred();
  let oldMaps={attendance:{oldVisible:{s:'absent'}},guests:{}};
  let newMaps={attendance:{},guests:{}};
  let newLoads=0;
  const oldGateway={
    async ready(){return {mode:'v2',branchId:'yongam',generationId:'gen_y',epoch:1,revision:4,valid:true};},
    mode(){return 'v2';},
    context(input={}){return {branchId:'yongam',generationId:'gen_y',epoch:1,revision:4,owner:input.owner,tabId:input.tabId,dateRange:input.dates};},
    async loadRange(){return {attendance:{oldVisible:{s:'absent'}},guests:{},primary:'v2'};},
    async updateAttendance(){return write.promise;},
    releaseRange(){},
  };
  const newGateway={
    async ready(){return {mode:'v2',branchId:'gagyeong',generationId:'gen_g',epoch:2,revision:7,valid:true};},
    mode(){return 'v2';},
    context(input={}){return {branchId:'gagyeong',generationId:'gen_g',epoch:2,revision:7,owner:input.owner,tabId:input.tabId,dateRange:input.dates};},
    async loadRange(){newLoads+=1;return {attendance:{newBranch:{s:'present'}},guests:{},primary:'v2'};},
    releaseRange(){},
  };
  const oldRuntime=api.create({branchId:'yongam',gateway:oldGateway,async prepareKeys(){},getMaps:()=>plain(oldMaps),setMaps:value=>{oldMaps=plain(value);}});
  const newRuntime=api.create({branchId:'gagyeong',gateway:newGateway,async prepareKeys(){},getMaps:()=>plain(newMaps),setMaps:value=>{newMaps=plain(value);}});
  await oldRuntime.loadRanges({owner:'attendance-main',ranges:[regularRange]});
  const pending=oldRuntime.updateAttendance(map=>({...map,oldWrite:{s:'present'}}),{
    owner:'attendance-main',tabId:'regular',courseType:'regular',dates:['2026-08-03'],
  });
  await newRuntime.loadRanges({owner:'attendance-main',ranges:[regularRange]});
  write.resolve({attendance:{oldWrite:{s:'present'}},primary:'v2',context:{
    owner:'attendance-main',tabId:'regular',dateRange:['2026-08-03'],
    branchId:'yongam',generationId:'gen_y',epoch:1,revision:5,
  }});

  await assert.rejects(()=>pending,error=>error?.code==='stale-attendance-context');
  assert.equal(oldMaps.attendance.oldWrite,undefined);
  assert.equal(newMaps.attendance.newBranch.s,'present');
  assert.equal(newLoads,2);
});

test('releasing the attendance view cancels every active tab range',async()=>{
  const env=fixture('v2-read');
  await env.runtime.loadRanges({owner:'attendance-main',ranges:[
    regularRange,
    {...regularRange,tabId:'summer',courseType:'bangteuk',dates:['2026-08-04']},
  ]});
  env.runtime.release('attendance-main');

  assert.deepEqual(env.calls.released.sort(),[
    'attendance-main:regular','attendance-main:summer',
  ]);
});

function source(file){ return fs.readFileSync(path.join(root,file),'utf8'); }
function functionBody(file,name){
  const value=source(file);
  const start=value.indexOf(`function ${name}`);
  assert.notEqual(start,-1,`${name} is missing from ${file}`);
  const open=value.indexOf('{',start);
  let depth=0;
  for(let index=open;index<value.length;index++){
    if(value[index]==='{') depth+=1;
    else if(value[index]==='}'&&--depth===0) return value.slice(start,index+1);
  }
  throw new Error(`${name} body is incomplete`);
}

test('main page loads the attendance runtime before core initialization',()=>{
  const html=source('index.html');
  const gateway=html.indexOf("scJs('js/attendance-operational-gateway.js')");
  const runtime=html.indexOf("scJs('js/attendance-main-runtime.js')");
  const core=html.indexOf("scJs('js/core.js')");
  assert.ok(runtime>gateway);
  assert.ok(core>runtime);
});

test('main gateway is created lazily for the authenticated selected branch',()=>{
  const body=functionBody('js/core.js','getOperationalAttendanceRuntime');
  assert.match(body,/getBranchInfo\(\)/);
  assert.match(body,/firebase\.firestore\(\)/);
  assert.match(body,/SCV2AttendanceStore\.create/);
  assert.match(body,/SCOperationalAttendance\.create/);
  assert.match(body,/SCMainAttendanceRuntime\.create/);
});

test('existing main attendance update functions delegate through the runtime',()=>{
  const attendance=functionBody('js/data.js','updateAttendanceMapTx');
  const guests=functionBody('js/data.js','updateAttGuestsMapTx');
  assert.match(attendance,/getOperationalAttendanceRuntime/);
  assert.match(attendance,/runtime\.updateAttendance/);
  assert.match(guests,/getOperationalAttendanceRuntime/);
  assert.match(guests,/runtime\.updateGuests/);
  assert.match(source('js/data.js'),/function _updateLegacyAttendanceMapTx/);
  assert.match(source('js/data.js'),/function _updateLegacyAttGuestsMapTx/);
});

test('single-entry helpers do not mutate visible maps before the gateway captures the previous value',()=>{
  const attendance=functionBody('js/data.js','setAttendanceEntryTx');
  const guests=functionBody('js/data.js','setAttGuestsEntryTx');
  const attendanceCall=attendance.indexOf('updateAttendanceMapTx');
  const guestCall=guests.indexOf('updateAttGuestsMapTx');
  assert.equal(attendance.slice(0,attendanceCall).includes('ATTENDANCE['),false);
  assert.equal(guestCall>0,true);
  assert.equal(guests.slice(0,guestCall).includes('ATT_GUESTS['),false);
});

test('V2 authority keeps merged attendance maps when other schedule keys render',()=>{
  const body=functionBody('js/data.js','reloadBadgeMaps');
  assert.match(body,/isOperationalAttendanceV2Authority/);
});
