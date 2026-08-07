(function(global){
  'use strict';

  const V2_AUTHORITY_MODES=new Set(['v2-read','v2']);

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
      return {key,version};
    }
    function current(token){ return loadVersions.get(token.key)===token.version; }
    function releaseOwners(owner){
      const key=text(owner)||'attendance-main';
      const owners=rangeOwners.get(key)||new Set();
      owners.forEach(rangeOwner=>gateway.releaseRange(rangeOwner));
      rangeOwners.delete(key);
    }
    async function loadRanges(input){
      const token=begin(input?.owner);
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
    async function updateAttendance(mutator,input){
      const currentMaps=getMaps();
      const result=await gateway.updateAttendance(mutator,{
        ...(input||{}),before:clone(objectMap(currentMaps?.attendance)),
      });
      const next={
        attendance:clone(objectMap(result?.attendance)),
        guests:clone(objectMap(currentMaps?.guests)),
      };
      setMaps(next);
      return clone(next.attendance);
    }
    async function updateGuests(mutator,input){
      const currentMaps=getMaps();
      const result=await gateway.updateGuests(mutator,{
        ...(input||{}),before:clone(objectMap(currentMaps?.guests)),
      });
      const next={
        attendance:clone(objectMap(currentMaps?.attendance)),
        guests:clone(objectMap(result?.guests)),
      };
      setMaps(next);
      return clone(next.guests);
    }
    function release(owner){
      const key=text(owner)||'attendance-main';
      loadVersions.set(key,(loadVersions.get(key)||0)+1);
      releaseOwners(key);
    }

    return Object.freeze({
      ready,
      mode,
      isV2Authority,
      loadRanges,
      updateAttendance,
      updateGuests,
      release,
    });
  }

  global.SCMainAttendanceRuntime=Object.freeze({create,mergeSelectedDates});
})(typeof window!=='undefined'?window:globalThis);
