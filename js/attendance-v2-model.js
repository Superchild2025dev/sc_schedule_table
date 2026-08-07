(function(global){
  'use strict';

  const SCHEMA_VERSION=2;

  function schema(){
    const value=global.SCScheduleSchemaV2;
    if(!value||typeof value.stableHash!=='function'){
      throw new Error('SCScheduleSchemaV2 is required');
    }
    return value;
  }
  function text(value){ return String(value==null?'':value).trim(); }
  function digits(value){ return text(value).replace(/\D/g,''); }
  function clone(value){
    if(value==null) return value;
    return JSON.parse(JSON.stringify(value));
  }
  function issue(type,key){ return {ok:false,issue:{type,key:text(key)}}; }
  function parseRecordKey(legacyKey){
    const raw=text(legacyKey);
    const isSub=raw.endsWith('#sub');
    const baseKey=isSub?raw.slice(0,-4):raw;
    const parts=baseKey.split('/');
    if(parts.length!==5) return issue('invalid-attendance-key',raw);
    const [time,day,laneRaw,seatRaw,date]=parts;
    const lane=Number(laneRaw)||0;
    const seat=Number(seatRaw)||0;
    if(!time||!day||!lane||!seat||!/^\d{4}-\d{2}-\d{2}$/.test(date)){
      return issue('invalid-attendance-key',raw);
    }
    return {
      ok:true,
      value:{time,day,lane,seat,date,isSub,slotKey:[time,day,lane,seat].join('/')},
    };
  }
  function parseGuestKey(legacyKey){
    const raw=text(legacyKey);
    const parts=raw.split('/');
    if(parts.length!==4) return issue('invalid-attendance-guest-key',raw);
    const [time,day,laneRaw,date]=parts;
    const lane=Number(laneRaw)||0;
    if(!time||!day||!lane||!/^\d{4}-\d{2}-\d{2}$/.test(date)){
      return issue('invalid-attendance-guest-key',raw);
    }
    return {
      ok:true,
      value:{time,day,lane,date,slotGroupKey:[time,day,lane].join('/')},
    };
  }
  function recordId(tabId,legacyKey){
    return 'att_'+schema().stableHash(`${text(tabId)}|${text(legacyKey)}`);
  }
  function guestId(tabId,legacyKey,legacyGuestId,index){
    const identity=text(legacyGuestId)||Number(index)||0;
    return 'guest_'+schema().stableHash(`${text(tabId)}|${text(legacyKey)}|${identity}`);
  }
  function attendancePayload(raw){
    if(raw&&typeof raw==='object'&&!Array.isArray(raw)) return clone(raw);
    return {s:text(raw)};
  }
  function recordFromLegacy(input){
    const tabId=text(input?.tabId);
    const legacyKey=text(input?.legacyKey);
    const parsed=parseRecordKey(legacyKey);
    if(!parsed.ok) return parsed;
    const parts=parsed.value;
    const payload=attendancePayload(input?.raw);
    const personId=text(input?.personId);
    return {
      id:recordId(tabId,legacyKey),
      legacyKey,
      tabId,
      courseType:text(input?.courseType),
      recordType:parts.isSub?'marked-student':'scheduled-student',
      slotKey:parts.slotKey,
      time:parts.time,
      day:parts.day,
      lane:parts.lane,
      seat:parts.seat,
      date:parts.date,
      personId,
      enrollmentId:text(input?.enrollmentId)||(personId?schema().enrollmentIdFor(personId,tabId):''),
      classMarkId:text(input?.classMarkId),
      status:text(payload.s||payload.status),
      checkedAt:text(payload.at),
      checkedBy:text(payload.by),
      payload,
      schemaVersion:SCHEMA_VERSION,
    };
  }
  function guestFromLegacy(input){
    const tabId=text(input?.tabId);
    const legacyKey=text(input?.legacyKey);
    const parsed=parseGuestKey(legacyKey);
    if(!parsed.ok) return parsed;
    const raw=input?.raw;
    if(!raw||typeof raw!=='object'||Array.isArray(raw)){
      return issue('invalid-attendance-guest-payload',legacyKey);
    }
    const group=parsed.value;
    const payload=clone(raw);
    const slotParts=text(payload.slotKey).split('/');
    const hasSlot=slotParts.length===4;
    const slotKey=hasSlot?slotParts.join('/'):group.slotGroupKey;
    const lane=hasSlot?(Number(slotParts[2])||group.lane):group.lane;
    const seat=hasSlot?(Number(slotParts[3])||0):0;
    const legacyGuestId=text(payload.gid);
    const personId=text(payload.sid)||schema().personIdFor({
      n:payload.n||payload.name,
      p:payload.p||payload.phone,
      a:payload.a||payload.age,
      g:payload.g||payload.gender,
    });
    const order=Number(input?.index)||0;
    return {
      id:guestId(tabId,legacyKey,legacyGuestId,order),
      legacyKey,
      guestId:legacyGuestId,
      tabId,
      courseType:text(input?.courseType),
      slotGroupKey:group.slotGroupKey,
      slotKey,
      time:group.time,
      day:group.day,
      lane,
      seat,
      date:group.date,
      personId,
      name:text(payload.n||payload.name),
      phone:digits(payload.p||payload.phone),
      age:payload.a??payload.age??null,
      entryType:text(payload.type)||'guest',
      status:text(payload.s||payload.status),
      checkedAt:text(payload.at),
      checkedBy:text(payload.by),
      order,
      payload,
      schemaVersion:SCHEMA_VERSION,
    };
  }
  function mapsFromRows(records,guests){
    const attendance={};
    const guestGroups={};
    const issues=[];
    (Array.isArray(records)?records:[]).forEach(row=>{
      const legacyKey=text(row?.legacyKey);
      const parsed=parseRecordKey(legacyKey);
      if(!parsed.ok){ issues.push(parsed.issue); return; }
      attendance[legacyKey]=clone(row?.payload);
    });
    (Array.isArray(guests)?guests:[]).forEach(row=>{
      const legacyKey=text(row?.legacyKey);
      const parsed=parseGuestKey(legacyKey);
      if(!parsed.ok){ issues.push(parsed.issue); return; }
      if(!guestGroups[legacyKey]) guestGroups[legacyKey]=[];
      guestGroups[legacyKey].push(row);
    });
    const guestMap={};
    Object.keys(guestGroups).sort().forEach(legacyKey=>{
      guestMap[legacyKey]=guestGroups[legacyKey]
        .slice()
        .sort((a,b)=>(Number(a?.order)||0)-(Number(b?.order)||0)||text(a?.id).localeCompare(text(b?.id)))
        .map(row=>clone(row?.payload));
    });
    return {attendance,guests:guestMap,issues};
  }
  function normalized(value){
    if(Array.isArray(value)) return value.map(normalized);
    if(value&&typeof value==='object'){
      return Object.keys(value).sort().reduce((result,key)=>{
        result[key]=normalized(value[key]);
        return result;
      },{});
    }
    return value;
  }
  function sameValue(left,right){
    return JSON.stringify(normalized(left))===JSON.stringify(normalized(right));
  }
  function map(value){
    return value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  }
  function diffLegacyMaps(before,after){
    const previous=map(before);
    const next=map(after);
    const upserts=[];
    const deletes=[];
    const unchanged=[];
    const keys=[...new Set([...Object.keys(previous),...Object.keys(next)])].sort();
    keys.forEach(legacyKey=>{
      if(!Object.prototype.hasOwnProperty.call(next,legacyKey)){
        deletes.push(legacyKey);
      }else if(!Object.prototype.hasOwnProperty.call(previous,legacyKey)||!sameValue(previous[legacyKey],next[legacyKey])){
        upserts.push({legacyKey,raw:clone(next[legacyKey])});
      }else{
        unchanged.push(legacyKey);
      }
    });
    return {upserts,deletes,unchanged};
  }
  function compareMap(kind,legacy,recreated,parse,issues){
    const source=map(legacy);
    const target=map(recreated);
    const validKeys=[];
    Object.keys(source).sort().forEach(key=>{
      const parsed=parse(key);
      if(!parsed.ok){ issues.push(parsed.issue); return; }
      validKeys.push(key);
      if(!Object.prototype.hasOwnProperty.call(target,key)){
        issues.push({type:`${kind}-missing`,key});
      }else if(!sameValue(source[key],target[key])){
        issues.push({type:`${kind}-payload-mismatch`,key});
      }
    });
    Object.keys(target).sort().forEach(key=>{
      if(!validKeys.includes(key)) issues.push({type:`${kind}-extra`,key});
    });
  }
  function compareLegacyRows(input){
    const rebuilt=mapsFromRows(input?.records,input?.guestRows);
    const issues=rebuilt.issues.slice();
    compareMap('attendance',input?.attendance,rebuilt.attendance,parseRecordKey,issues);
    compareMap('attendance-guest',input?.guests,rebuilt.guests,parseGuestKey,issues);
    return {
      ready:issues.length===0,
      mismatchCount:issues.length,
      issues,
      counts:{
        legacyAttendance:Object.keys(map(input?.attendance)).length,
        v2Attendance:Object.keys(rebuilt.attendance).length,
        legacyGuestGroups:Object.keys(map(input?.guests)).length,
        v2GuestGroups:Object.keys(rebuilt.guests).length,
      },
    };
  }

  global.SCV2AttendanceModel=Object.freeze({
    parseRecordKey,
    parseGuestKey,
    recordId,
    guestId,
    recordFromLegacy,
    guestFromLegacy,
    mapsFromRows,
    diffLegacyMaps,
    compareLegacyRows,
  });
})(typeof window!=='undefined'?window:globalThis);
