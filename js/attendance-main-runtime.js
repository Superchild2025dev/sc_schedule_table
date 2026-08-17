(function(global){
  'use strict';

  const V2_AUTHORITY_MODES=new Set(['v2-read','v2']);
  const activeOwnerContexts=new Map();
  let contextSequence=0;

  function text(value){ return String(value==null?'':value).trim(); }
  function clone(value){
    if(value==null) return value;
    return JSON.parse(JSON.stringify(value));
  }
  function objectMap(value){
    return value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  }
  function unique(values){
    return [...new Set((values||[]).map(text).filter(Boolean))];
  }
  function writeContext(value,input={}){
    return {
      owner:text(value?.owner)||text(input.owner)||'attendance-main',
      tabId:text(value?.tabId)||text(input.tabId),
      dateRange:unique(value?.dateRange||input.dates).sort(),
      branchId:text(value?.branchId),generationId:text(value?.generationId),
      epoch:Number(value?.epoch)||0,revision:Number(value?.revision)||0,
    };
  }
  function samePointer(left,right,expectedRevision){
    if(left.owner!==right.owner||left.tabId!==right.tabId
      ||JSON.stringify(left.dateRange)!==JSON.stringify(right.dateRange)
      ||left.branchId!==right.branchId||left.generationId!==right.generationId||left.epoch!==right.epoch) return false;
    if(expectedRevision===undefined) return left.revision===right.revision;
    return right.revision===left.revision||right.revision===expectedRevision;
  }
  function sameScope(left,right){
    return left.owner===right.owner&&left.tabId===right.tabId
      &&JSON.stringify(left.dateRange)===JSON.stringify(right.dateRange)
      &&left.branchId===right.branchId&&left.generationId===right.generationId
      &&left.epoch===right.epoch;
  }
  function staleContextError(){
    return Object.assign(new Error('이전 출석 화면의 저장 결과는 현재 화면에 적용하지 않습니다.'),{
      code:'stale-attendance-context',
    });
  }
  function keyDate(key){
    const match=text(key).match(/\/(\d{4}-\d{2}-\d{2})(?:#sub)?$/);
    return match?match[1]:'';
  }
  function mergeSelectedDates(current,results){
    const next={
      attendance:clone(objectMap(current?.attendance)),
      guests:clone(objectMap(current?.guests)),
    };
    const dates=new Set();
    (results||[]).forEach(item=>{
      (item.range?.dates||[]).forEach(date=>dates.add(text(date)));
    });
    Object.keys(next.attendance).forEach(key=>{
      if(dates.has(keyDate(key))) delete next.attendance[key];
    });
    Object.keys(next.guests).forEach(key=>{
      if(dates.has(keyDate(key))) delete next.guests[key];
    });
    (results||[]).forEach(item=>{
      Object.assign(next.attendance,clone(objectMap(item.result?.attendance)));
      Object.assign(next.guests,clone(objectMap(item.result?.guests)));
    });
    return next;
  }

  function create(options){
    const branchId=text(options?.branchId);
    const gateway=options?.gateway;
    const prepareKeys=options?.prepareKeys;
    const getMaps=options?.getMaps;
    const setMaps=options?.setMaps;
    if(!branchId) throw new Error('지점 정보가 필요합니다.');
    if(!gateway||typeof gateway.ready!=='function') throw new Error('출석 운영 게이트웨이가 필요합니다.');
    if(typeof prepareKeys!=='function') throw new Error('출석 데이터 준비 함수가 필요합니다.');
    if(typeof getMaps!=='function'||typeof setMaps!=='function') throw new Error('출석 화면 상태 연결이 필요합니다.');

    const loadVersions=new Map();
    const rangeOwners=new Map();
    const activeLoads=new Map();
    const refreshes=new Map();

    async function ready(){
      const config=await gateway.ready();
      return clone(config);
    }
    function mode(){ return gateway.mode(); }
    function isV2Authority(){ return V2_AUTHORITY_MODES.has(mode()); }
    function begin(owner){
      const key=text(owner)||'attendance-main';
      const version=(loadVersions.get(key)||0)+1;
      loadVersions.set(key,version);
      const token={key,version,sequence:++contextSequence};
      activeOwnerContexts.set(key,{token,refresh:()=>refreshActive(key)});
      return token;
    }
    function current(token){
      return loadVersions.get(token.key)===token.version
        &&activeOwnerContexts.get(token.key)?.token===token;
    }
    function copyLoad(input,owner){
      return {
        ...(input||{}),owner,
        ranges:(Array.isArray(input?.ranges)?input.ranges:[]).map(range=>({
          ...range,dates:[...(range?.dates||[])],baseKeys:[...(range?.baseKeys||[])],
          attendanceKeys:[...(range?.attendanceKeys||[])],
        })),
      };
    }
    async function refreshActive(owner){
      const key=text(owner)||'attendance-main';
      if(refreshes.has(key)) return refreshes.get(key);
      const request=activeLoads.get(key);
      if(!request) return null;
      const pending=loadRanges(copyLoad(request,key)).finally(()=>refreshes.delete(key));
      refreshes.set(key,pending);
      return pending;
    }
    async function refreshLatestOwner(owner){
      const latest=activeOwnerContexts.get(text(owner)||'attendance-main');
      if(latest&&typeof latest.refresh==='function') await latest.refresh();
    }
    function releaseOwners(owner){
      const key=text(owner)||'attendance-main';
      const owners=rangeOwners.get(key)||new Set();
      owners.forEach(rangeOwner=>gateway.releaseRange(rangeOwner));
      rangeOwners.delete(key);
    }
    async function loadRanges(input){
      const owner=text(input?.owner)||'attendance-main';
      activeLoads.set(owner,copyLoad(input,owner));
      const token=begin(owner);
      const ranges=(Array.isArray(input?.ranges)?input.ranges:[]).filter(range=>{
        return text(range?.tabId)&&Array.isArray(range?.dates)&&range.dates.length;
      }).map(range=>({...range,dates:unique(range.dates)}));
      if(!ranges.length) return {stale:false,mode:mode(),ranges:[]};
      const config=await ready();
      if(!current(token)) return {stale:true,mode:config.mode};
      const v2Authority=V2_AUTHORITY_MODES.has(config.mode);
      const keys=[];
      ranges.forEach(range=>{
        keys.push(...(range.baseKeys||[]));
        if(!v2Authority) keys.push(...(range.attendanceKeys||[]));
      });
      await prepareKeys(unique(keys));
      if(!current(token)) return {stale:true,mode:config.mode};

      releaseOwners(token.key);
      const owners=new Set();
      rangeOwners.set(token.key,owners);
      const loaded=await Promise.all(ranges.map(async range=>{
        const rangeOwner=token.key+':'+text(range.tabId);
        owners.add(rangeOwner);
        const result=await gateway.loadRange({...range,owner:rangeOwner});
        return {range,result};
      }));
      if(!current(token)) return {stale:true,mode:config.mode};
      setMaps(mergeSelectedDates(getMaps(),loaded));
      return {
        stale:false,
        mode:config.mode,
        primary:loaded.some(item=>item.result?.primary==='v2')?'v2':'v1',
        ranges:loaded,
      };
    }
    function captureWriteContext(input){
      const value=typeof gateway.context==='function'?gateway.context(input):{};
      return writeContext({...value,branchId:text(value?.branchId)||branchId},input);
    }
    async function applyWrite(kind,mutator,input,invoke){
      const owner=text(input?.owner)||'attendance-main';
      const token=begin(owner);
      const started=captureWriteContext({...input,owner});
      const currentMaps=getMaps();
      const before=kind==='attendance'?currentMaps?.attendance:currentMaps?.guests;
      const result=await invoke(mutator,{...(input||{}),owner,before:clone(objectMap(before))});
      const response=writeContext(result?.context||{},input);
      const expectedRevision=response.branchId?response.revision:undefined;
      const responseValid=!response.branchId||(
        sameScope(started,response)
        &&response.revision>=started.revision
      );
      const latest=captureWriteContext({...input,owner});
      const latestValid=response.branchId
        ?sameScope(started,latest)&&latest.revision>=expectedRevision
        :samePointer(started,latest,expectedRevision);
      if(!current(token)||!responseValid||!latestValid){
        await refreshLatestOwner(owner);
        throw staleContextError();
      }
      const next={
        attendance:kind==='attendance'?clone(objectMap(result?.attendance)):clone(objectMap(currentMaps?.attendance)),
        guests:kind==='guests'?clone(objectMap(result?.guests)):clone(objectMap(currentMaps?.guests)),
      };
      setMaps(next);
      return clone(kind==='attendance'?next.attendance:next.guests);
    }
    async function updateAttendance(mutator,input){
      return applyWrite('attendance',mutator,input,(next,context)=>gateway.updateAttendance(next,context));
    }
    async function updateGuests(mutator,input){
      return applyWrite('guests',mutator,input,(next,context)=>gateway.updateGuests(next,context));
    }
    async function setManyAttendance(input){
      return applyWrite('attendance',null,input,(unused,context)=>gateway.setManyAttendance(context));
    }
    function release(owner){
      const key=text(owner)||'attendance-main';
      loadVersions.set(key,(loadVersions.get(key)||0)+1);
      activeOwnerContexts.set(key,{token:{key,sequence:++contextSequence},refresh:null});
      releaseOwners(key);
    }

    return Object.freeze({
      ready,
      mode,
      isV2Authority,
      loadRanges,
      updateAttendance,
      updateGuests,
      setManyAttendance,
      release,
    });
  }

  global.SCMainAttendanceRuntime=Object.freeze({create,mergeSelectedDates});
})(typeof window!=='undefined'?window:globalThis);
