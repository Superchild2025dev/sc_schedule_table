(function(global){
  'use strict';

  const MAX_DIAGNOSTICS=80;
  const V2_AUTHORITY_MODES=new Set(['v2-read','v2']);

  function text(value){ return String(value==null?'':value).trim(); }
  function clone(value){
    if(value==null) return value;
    return JSON.parse(JSON.stringify(value));
  }
  function objectMap(value){
    return value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  }
  function modelFrom(options){
    const model=options?.model||global.SCV2AttendanceModel;
    if(!model||typeof model.diffLegacyMaps!=='function') throw new Error('SCV2AttendanceModel is required');
    return model;
  }
  function staleError(){
    const error=new Error('이전 출석 조회 결과는 더 이상 사용하지 않습니다.');
    error.code='stale-attendance-range';
    return error;
  }

  function create(options){
    const branchId=text(options?.branchId);
    const legacy=options?.legacy;
    const v2Store=options?.v2Store;
    const model=modelFrom(options);
    const now=typeof options?.now==='function'?options.now:()=>new Date();
    if(!branchId) throw new Error('지점 정보가 필요합니다.');
    if(!legacy||typeof legacy.loadRange!=='function') throw new Error('V1 출석 저장소가 필요합니다.');
    if(!v2Store||typeof v2Store.readConfig!=='function') throw new Error('V2 출석 저장소가 필요합니다.');

    let config={mode:'v1',generationId:'',branchId,valid:false};
    let readyPromise=null;
    let confirmedV2=false;
    const rangeVersions=new Map();
    const diagnosticRows=[];

    function nowDate(){
      const value=now();
      return value instanceof Date?value:new Date(value||Date.now());
    }
    function diagnostic(input){
      const row={
        at:nowDate().toISOString(),
        branchId,
        tabId:text(input?.tabId),
        dates:(Array.isArray(input?.dates)?input.dates:[]).map(text).filter(Boolean),
        mode:config.mode,
        kind:text(input?.kind),
        outcome:text(input?.outcome),
        recordCount:Number(input?.recordCount)||0,
        durationMs:Math.max(0,Number(input?.durationMs)||0),
      };
      diagnosticRows.push(row);
      if(diagnosticRows.length>MAX_DIAGNOSTICS) diagnosticRows.splice(0,diagnosticRows.length-MAX_DIAGNOSTICS);
      return row;
    }
    async function ready(){
      if(readyPromise) return readyPromise;
      readyPromise=(async()=>{
        try{
          const next=await v2Store.readConfig();
          config=next&&typeof next==='object'?clone(next):config;
          if(V2_AUTHORITY_MODES.has(config.mode)&&config.valid) confirmedV2=true;
          return clone(config);
        }catch(error){
          if(confirmedV2) throw new Error('V2 출석 전환 설정을 확인하지 못해 작업을 중단했습니다.');
          config={mode:'v1',generationId:'',branchId,valid:false};
          return clone(config);
        }
      })();
      try{return await readyPromise;}catch(error){readyPromise=null;throw error;}
    }
    function mode(){ return config.mode; }
    function beginRange(owner){
      const key=text(owner)||'attendance';
      const version=(rangeVersions.get(key)||0)+1;
      rangeVersions.set(key,version);
      return {key,version};
    }
    function assertCurrentRange(token){
      if(rangeVersions.get(token.key)!==token.version) throw staleError();
    }
    function releaseRange(owner){
      const key=text(owner)||'attendance';
      rangeVersions.set(key,(rangeVersions.get(key)||0)+1);
    }
    function legacyMaps(result){
      const value=result&&typeof result==='object'?result:{};
      return {
        attendance:clone(objectMap(value.attendance)),
        guests:clone(objectMap(value.guests)),
      };
    }
    function v2Maps(result){
      if(result?.maps) return {
        attendance:clone(objectMap(result.maps.attendance)),
        guests:clone(objectMap(result.maps.guests)),
      };
      const rebuilt=model.mapsFromRows(result?.records,result?.guests);
      if(rebuilt.issues?.length) throw new Error('V2 출석 데이터 형식을 확인할 수 없습니다.');
      return {attendance:clone(rebuilt.attendance),guests:clone(rebuilt.guests)};
    }
    async function loadRange(input){
      const token=beginRange(input?.owner);
      await ready();
      assertCurrentRange(token);
      const started=nowDate().getTime();
      const base={tabId:text(input?.tabId),dates:clone(input?.dates||[])};
      if(V2_AUTHORITY_MODES.has(config.mode)){
        try{
          const result=await v2Store.readRange({
            generationId:config.generationId,tabId:base.tabId,dates:base.dates,
          });
          assertCurrentRange(token);
          const maps=v2Maps(result);
          diagnostic({...base,kind:'load',outcome:'ok',recordCount:Object.keys(maps.attendance).length,durationMs:nowDate().getTime()-started});
          return {...maps,records:result?.records||[],guestRows:result?.guests||[],primary:'v2',degraded:false};
        }catch(error){
          if(error?.code==='stale-attendance-range') throw error;
          diagnostic({...base,kind:'load',outcome:'v2-error',durationMs:nowDate().getTime()-started});
          throw new Error('V2 출석 데이터를 불러오지 못했습니다. 화면을 새로고침한 뒤 다시 시도해주세요.');
        }
      }

      const legacyResult=await legacy.loadRange(input);
      assertCurrentRange(token);
      const maps=legacyMaps(legacyResult);
      let degraded=false;
      if((config.mode==='shadow'||config.mode==='verify')&&config.generationId){
        try{
          const v2Result=await v2Store.readRange({
            generationId:config.generationId,tabId:base.tabId,dates:base.dates,
          });
          assertCurrentRange(token);
          const comparison=v2Store.compareRange({
            legacyAttendance:maps.attendance,
            legacyGuests:maps.guests,
            records:v2Result?.records||[],
            guests:v2Result?.guests||[],
          });
          degraded=!comparison?.ready;
        }catch(error){
          if(error?.code==='stale-attendance-range') throw error;
          degraded=true;
        }
      }
      diagnostic({...base,kind:'load',outcome:degraded?'degraded':'ok',recordCount:Object.keys(maps.attendance).length,durationMs:nowDate().getTime()-started});
      return {...maps,primary:'v1',degraded};
    }
    function resultMap(result,field){
      if(result&&typeof result==='object'&&!Array.isArray(result)&&result[field]&&typeof result[field]==='object'){
        return clone(objectMap(result[field]));
      }
      return clone(objectMap(result));
    }
    async function applyMutator(before,mutator){
      const draft=clone(objectMap(before));
      const returned=await mutator(draft);
      return clone(objectMap(returned&&typeof returned==='object'?returned:draft));
    }
    function applyChangedKeys(current,before,after){
      const draft=clone(objectMap(current));
      const diff=model.diffLegacyMaps(before,after);
      diff.upserts.forEach(change=>{ draft[change.legacyKey]=clone(change.raw); });
      diff.deletes.forEach(legacyKey=>{ delete draft[legacyKey]; });
      return draft;
    }
    function recordMeta(input,legacyKey,raw){
      if(typeof input?.recordMeta==='function') return input.recordMeta(legacyKey,raw)||{};
      return input?.recordMetaByKey?.[legacyKey]||{};
    }
    async function writeV2Attendance(before,after,input){
      const diff=model.diffLegacyMaps(before,after);
      const changes=[];
      diff.upserts.forEach(change=>{
        const meta=recordMeta(input,change.legacyKey,change.raw);
        const row=model.recordFromLegacy({
          tabId:text(input?.tabId),
          courseType:text(input?.courseType),
          legacyKey:change.legacyKey,
          raw:change.raw,
          ...meta,
        });
        if(row?.ok===false) throw new Error('출석 V2 변환 오류가 있어 저장을 중단했습니다.');
        changes.push({type:'set',collection:'attendanceRecords',id:row.id,legacyKey:change.legacyKey,row});
      });
      diff.deletes.forEach(legacyKey=>changes.push({
        type:'delete',collection:'attendanceRecords',
        id:model.recordId(text(input?.tabId),legacyKey),legacyKey,
      }));
      if(changes.length) await v2Store.writeRecordBatch(changes,config.generationId);
      return {changed:changes.length,diff};
    }
    function existingGuestRows(input,legacyKey,beforeList){
      const supplied=(Array.isArray(input?.v2GuestRows)?input.v2GuestRows:[])
        .filter(row=>text(row?.legacyKey)===legacyKey);
      if(supplied.length) return supplied;
      return (Array.isArray(beforeList)?beforeList:[]).map((raw,index)=>model.guestFromLegacy({
        tabId:text(input?.tabId),courseType:text(input?.courseType),legacyKey,raw,index,
      })).filter(row=>row&&row.ok!==false);
    }
    async function writeV2Guests(before,after,input){
      const diff=model.diffLegacyMaps(before,after);
      const groups=[
        ...diff.upserts.map(change=>({legacyKey:change.legacyKey,list:change.raw})),
        ...diff.deletes.map(legacyKey=>({legacyKey,list:[]})),
      ];
      for(const group of groups){
        if(!Array.isArray(group.list)) throw new Error('추가 원생 출석 목록 형식이 올바르지 않습니다.');
        const rows=group.list.map((raw,index)=>model.guestFromLegacy({
          tabId:text(input?.tabId),courseType:text(input?.courseType),
          legacyKey:group.legacyKey,raw,index,
        }));
        if(rows.some(row=>row?.ok===false)) throw new Error('추가 원생 V2 변환 오류가 있어 저장을 중단했습니다.');
        await v2Store.replaceGuestGroup({
          generationId:config.generationId,
          legacyKey:group.legacyKey,
          rows,
          existingRows:existingGuestRows(input,group.legacyKey,objectMap(before)[group.legacyKey]),
        });
      }
      return {changed:groups.length,diff};
    }
    async function verifyAfterWrite(after,input,kind){
      if(config.mode!=='verify') return {ready:true};
      const result=await v2Store.readRange({
        generationId:config.generationId,tabId:text(input?.tabId),dates:input?.dates||[],
      });
      return v2Store.compareRange({
        legacyAttendance:kind==='attendance'?after:objectMap(input?.attendance),
        legacyGuests:kind==='guests'?after:objectMap(input?.guestMap),
        records:result?.records||[],guests:result?.guests||[],
      });
    }
    async function updateMap(kind,mutator,input){
      await ready();
      const started=nowDate().getTime();
      const before=clone(objectMap(input?.before));
      const legacyMethod=kind==='attendance'?'updateAttendance':'updateGuests';
      const writeV2=kind==='attendance'?writeV2Attendance:writeV2Guests;
      const outputField=kind==='attendance'?'attendance':'guests';
      const base={tabId:text(input?.tabId),dates:input?.dates||[],kind:`write-${kind}`};

      if(!V2_AUTHORITY_MODES.has(config.mode)){
        const legacyResult=await legacy[legacyMethod](mutator,input);
        const after=resultMap(legacyResult,outputField);
        let degraded=false;
        let changed=0;
        if((config.mode==='shadow'||config.mode==='verify')&&config.generationId){
          try{
            const write=await writeV2(before,after,input);
            changed=write.changed;
            const comparison=await verifyAfterWrite(after,input,kind);
            degraded=!comparison?.ready;
          }catch(error){
            degraded=true;
          }
        }
        diagnostic({...base,outcome:degraded?'degraded':'ok',recordCount:changed,durationMs:nowDate().getTime()-started});
        return {[outputField]:after,primary:'v1',degraded,changed};
      }

      const after=await applyMutator(before,mutator);
      let changed=0;
      try{
        const write=await writeV2(before,after,input);
        changed=write.changed;
      }catch(error){
        diagnostic({...base,outcome:'v2-error',durationMs:nowDate().getTime()-started});
        throw new Error('V2 출석 데이터를 저장하지 못했습니다. 화면을 새로고침한 뒤 다시 시도해주세요.');
      }
      let degraded=false;
      if(config.mode==='v2-read'){
        try{
          await legacy[legacyMethod](current=>applyChangedKeys(current,before,after),input);
        }catch(error){
          degraded=true;
        }
      }
      diagnostic({...base,outcome:degraded?'backup-error':'ok',recordCount:changed,durationMs:nowDate().getTime()-started});
      return {[outputField]:after,primary:'v2',degraded,changed};
    }
    function updateAttendance(mutator,input){ return updateMap('attendance',mutator,input); }
    function updateGuests(mutator,input){ return updateMap('guests',mutator,input); }
    function setManyAttendance(input){
      return updateAttendance(()=>clone(objectMap(input?.after)),input);
    }
    function diagnostics(limit){
      const count=Math.max(0,Math.min(MAX_DIAGNOSTICS,Number(limit)||MAX_DIAGNOSTICS));
      return clone(diagnosticRows.slice(-count));
    }

    return Object.freeze({
      ready,
      mode,
      loadRange,
      updateAttendance,
      updateGuests,
      setManyAttendance,
      releaseRange,
      diagnostics,
    });
  }

  global.SCOperationalAttendance=Object.freeze({create,MAX_DIAGNOSTICS});
})(typeof window!=='undefined'?window:globalThis);
