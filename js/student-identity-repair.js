(function(global){
  'use strict';

  const RELATED_KEYS=[
    'swim_enroll','swim_retire','swim_retire_history','swim_mark','swim_hyuwon',
    'swim_move','swim_requests','swim_reserve','swim_attendance','swim_att_guests',
    'swim_desk_notes',
  ];

  function text(value){ return String(value==null?'':value).trim(); }
  function digits(value){ return text(value).replace(/\D/g,''); }
  function clone(value){ return value==null?value:JSON.parse(JSON.stringify(value)); }
  function parseStored(value,fallback){
    if(value==null) return fallback;
    if(typeof value!=='string') return clone(value);
    try{return JSON.parse(value);}catch(e){return fallback;}
  }
  function encodeStored(value,original){
    return typeof original==='string'?JSON.stringify(value):value;
  }
  function profileKey(entry){
    return global.SCScheduleSchemaV2.identityProfileKey(entry||{});
  }
  function conflictFor(root,branchId,personId){
    const report=global.SCScheduleSchemaV2.diagnoseLegacyRoot(branchId,root||{});
    return (report.identityConflicts||[]).find(item=>item.personId===personId)||null;
  }
  function repairKeysForRoot(root,branchId){
    const bundle=global.SCScheduleSchemaV2.legacyBundleFromRoot(branchId,root||{});
    const keys=new Set(['swim_tab_list']);
    (bundle.tabs||[]).forEach(tab=>keys.add(global.SCScheduleSchemaV2.legacyTabKeys(tab).students));
    RELATED_KEYS.forEach(key=>{
      if(Object.prototype.hasOwnProperty.call(root||{},key)) keys.add(key);
    });
    return [...keys];
  }
  function sameProfileSet(conflict,expectedKeys){
    if(!conflict) return false;
    const actual=(conflict.profiles||[]).map(item=>item.key).sort();
    const expected=(expectedKeys||[]).slice().sort();
    return actual.length===expected.length&&actual.every((value,index)=>value===expected[index]);
  }
  function splitIdMap(conflict){
    const used=new Set([conflict.personId]);
    const map={};
    const keepKey=conflict.suggestedKeepKey||conflict.profiles?.[0]?.key||'';
    (conflict.profiles||[]).forEach(profile=>{
      if(profile.key===keepKey){
        map[profile.key]=conflict.personId;
        return;
      }
      let next=text(profile.expectedPersonId);
      if(!next||used.has(next)){
        next='stu_'+global.SCScheduleSchemaV2.stableHash(`identity-split|${conflict.personId}|${profile.key}`);
      }
      let suffix=1;
      while(used.has(next)){
        next='stu_'+global.SCScheduleSchemaV2.stableHash(`identity-split|${conflict.personId}|${profile.key}|${suffix++}`);
      }
      used.add(next);
      map[profile.key]=next;
    });
    return map;
  }
  function entryName(entry){
    return text(entry?.n||entry?.name||entry?.studentName);
  }
  function entryPhone(entry){
    return digits(entry?.p||entry?.phone||entry?.studentPhone);
  }
  function profileForReference(entry,profiles,path){
    const name=entryName(entry);
    const phone=entryPhone(entry);
    let candidates=profiles||[];
    if(name){
      const normalized=global.SCScheduleTime.normalizeIdentityName(name);
      const byName=candidates.filter(profile=>global.SCScheduleTime.normalizeIdentityName(profile.name)===normalized);
      if(byName.length) candidates=byName;
    }
    if(phone){
      const byPhone=candidates.filter(profile=>digits(profile.phone)===phone);
      if(byPhone.length) candidates=byPhone;
    }
    if(candidates.length===1) return candidates[0];
    const slot=text(entry?.slotKey||entry?.sourceSlotKey||entry?.targetSlotKey||path?.[0]);
    if(slot){
      const bySlot=candidates.filter(profile=>(profile.occurrences||[]).some(item=>item.slotKey===slot));
      if(bySlot.length===1) return bySlot[0];
    }
    return null;
  }
  function rewriteReferences(value,conflict,idMap,mode,chosenProfile,stats,path){
    if(!value||typeof value!=='object') return;
    if(Array.isArray(value)){
      value.forEach((item,index)=>rewriteReferences(item,conflict,idMap,mode,chosenProfile,stats,(path||[]).concat(String(index))));
      return;
    }
    if(text(value.sid)===conflict.personId){
      if(mode==='split'){
        const profile=profileForReference(value,conflict.profiles,path||[]);
        if(profile&&idMap[profile.key]){
          value.sid=idMap[profile.key];
          stats.referencesUpdated++;
        }else{
          stats.referencesUnresolved++;
        }
      }else{
        const name=chosenProfile.name;
        const phone=chosenProfile.phone;
        if(Object.prototype.hasOwnProperty.call(value,'n')) value.n=name;
        if(Object.prototype.hasOwnProperty.call(value,'name')) value.name=name;
        if(Object.prototype.hasOwnProperty.call(value,'studentName')) value.studentName=name;
        if(Object.prototype.hasOwnProperty.call(value,'p')) value.p=phone;
        if(Object.prototype.hasOwnProperty.call(value,'phone')) value.phone=phone;
        if(Object.prototype.hasOwnProperty.call(value,'studentPhone')) value.studentPhone=phone;
        stats.referencesUpdated++;
      }
    }
    Object.entries(value).forEach(([key,item])=>rewriteReferences(item,conflict,idMap,mode,chosenProfile,stats,[key].concat(path||[])));
  }
  function applyRepair(root,options){
    const branchId=text(options?.branchId);
    const personId=text(options?.personId);
    const mode=options?.mode==='merge'?'merge':'split';
    const conflict=conflictFor(root,branchId,personId);
    if(!sameProfileSet(conflict,options?.expectedProfileKeys)){
      throw new Error('진단 후 원생 정보가 변경되었습니다. 다시 진단해주세요.');
    }
    const chosenProfile=mode==='merge'
      ? (conflict.profiles||[]).find(profile=>profile.key===options?.chosenProfileKey)
      : null;
    if(mode==='merge'&&!chosenProfile) throw new Error('통합 기준 원생을 찾지 못했습니다.');
    const idMap=mode==='split'?splitIdMap(conflict):{};
    const stats={studentsUpdated:0,referencesUpdated:0,referencesUnresolved:0};
    const studentKeys=[...new Set((conflict.profiles||[]).flatMap(profile=>(profile.occurrences||[]).map(item=>item.stuKey)))];
    studentKeys.forEach(key=>{
      const original=root[key];
      const students=parseStored(original,[]);
      if(!Array.isArray(students)) return;
      let changed=false;
      students.forEach(student=>{
        if(text(student?.sid)!==personId) return;
        if(mode==='split'){
          const nextSid=idMap[profileKey(student)];
          if(!nextSid) throw new Error('분리할 원생 자리의 정보를 다시 확인해주세요.');
          if(nextSid!==student.sid){student.sid=nextSid;changed=true;stats.studentsUpdated++;}
          return;
        }
        const weekFive=student.btWeek5===true||global.SCScheduleTime.parseBangteukWeek5Name(student.n||student.name).week5;
        const nextName=weekFive?'*'+chosenProfile.name:chosenProfile.name;
        if(student.n!==nextName){student.n=nextName;changed=true;stats.studentsUpdated++;}
        if(chosenProfile.phone&&digits(student.p)!==chosenProfile.phone){student.p=chosenProfile.phone;changed=true;}
      });
      if(changed) root[key]=encodeStored(students,original);
    });
    RELATED_KEYS.forEach(key=>{
      if(!Object.prototype.hasOwnProperty.call(root,key)) return;
      const original=root[key];
      const value=parseStored(original,null);
      if(value==null) return;
      const before=JSON.stringify(value);
      rewriteReferences(value,conflict,idMap,mode,chosenProfile,stats,[]);
      if(JSON.stringify(value)!==before) root[key]=encodeStored(value,original);
    });
    return {root,conflict,idMap,stats};
  }

  global.SCStudentIdentityRepair=Object.freeze({
    RELATED_KEYS:RELATED_KEYS.slice(),
    conflictFor,
    repairKeysForRoot,
    splitIdMap,
    applyRepair,
  });
})(typeof window!=='undefined'?window:globalThis);
