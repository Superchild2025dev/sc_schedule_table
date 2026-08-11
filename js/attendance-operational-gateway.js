(function(global){
  'use strict';

  const MAX_DIAGNOSTICS=80;
  const V2_AUTHORITY_MODES=new Set(['v2-read','v2']);
  const V1_AUTHORITY_MODES=new Set(['v1','shadow','verify']);
  const AUTHORITY_MODES=new Set([...V1_AUTHORITY_MODES,...V2_AUTHORITY_MODES]);
  let operationSequence=0;

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
  function pointerError(code){
    return Object.assign(new Error('출석 전환 설정과 운영 전환 설정이 일치하지 않아 저장을 중단했습니다.'),{
      code:code||'attendance-pointer-mismatch',
    });
  }
  function readCourseType(input){
    const courseType=text(input?.courseType);
    if(courseType==='regular'||courseType==='bangteuk') return courseType;
    if(!courseType&&text(input?.tabId)==='regular') return 'regular';
    throw Object.assign(new Error('출석 시간표의 수업 구분을 확인할 수 없어 조회를 중단했습니다.'),{
      code:'ambiguous-attendance-owner',
    });
  }
  function operationId(){
    if(global.crypto&&typeof global.crypto.randomUUID==='function') return global.crypto.randomUUID();
    operationSequence=(operationSequence+1)%1000000;
    return `attendance_${Date.now().toString(36)}_${operationSequence.toString(36)}`;
  }
  function authorityError(cause){
    return Object.assign(new Error('출석 운영 저장 권한을 확인할 수 없어 읽기 전용으로 전환했습니다.'),{
      code:'operational-authority-unavailable',cause,
    });
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

    const unknownConfig=()=>({mode:'unknown',generationId:'',branchId,epoch:0,revision:0,valid:false,compatibilityValid:false});
    let config=unknownConfig();
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
    function normalizeAuthority(value){
      if(!value||typeof value!=='object'||Array.isArray(value)) throw authorityError();
      const next=clone(value);
      next.mode=text(next.mode);
      next.generationId=text(next.generationId);
      next.branchId=text(next.branchId);
      next.epoch=Number(next.epoch);
      next.revision=Number(next.revision);
      next.valid=next.valid===true;
      if(!next.valid||next.branchId!==branchId||!AUTHORITY_MODES.has(next.mode)
        ||!Number.isSafeInteger(next.epoch)||next.epoch<0
        ||!Number.isSafeInteger(next.revision)||next.revision<0
        ||(next.mode!=='v1'&&!next.generationId)) throw authorityError();
      return next;
    }
    async function ready(){
      if(readyPromise) return readyPromise;
      readyPromise=(async()=>{
        try{
          const next=normalizeAuthority(await v2Store.readConfig());
          config=next;
          if(V2_AUTHORITY_MODES.has(config.mode)&&config.valid) confirmedV2=true;
          return clone(config);
        }catch(error){
          if(confirmedV2) throw Object.assign(new Error('V2 출석 전환 설정을 확인하지 못해 작업을 중단했습니다.'),{
            code:'v2-operational-config-failed',cause:error,
          });
          config=unknownConfig();
          return clone(config);
        }
      })();
      try{return await readyPromise;}catch(error){readyPromise=null;throw error;}
    }
    function mode(){ return config.mode; }
    function context(input={}){
      return {
        owner:text(input.owner)||'attendance-main',tabId:text(input.tabId),
        dateRange:(Array.isArray(input.dates)?input.dates:[]).map(text).filter(Boolean).sort(),
        branchId,generationId:text(config.generationId),epoch:Number(config.epoch)||0,
        revision:Number(config.revision)||0,
      };
    }
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
      const needsV2Read=V2_AUTHORITY_MODES.has(config.mode)||(
        (config.mode==='shadow'||config.mode==='verify')&&config.generationId
      );
      const courseType=needsV2Read?readCourseType(input):'';
      if(V2_AUTHORITY_MODES.has(config.mode)){
        try{
          const result=await v2Store.readRange({
            generationId:config.generationId,tabId:base.tabId,courseType,dates:base.dates,
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
            generationId:config.generationId,tabId:base.tabId,courseType,dates:base.dates,
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
    async function verifyAfterWrite(after,input,kind){
      if(config.mode!=='verify') return {ready:true};
      const result=await v2Store.readRange({
        generationId:config.generationId,tabId:text(input?.tabId),
        courseType:readCourseType(input),dates:input?.dates||[],
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
      const outputField=kind==='attendance'?'attendance':'guests';
      const base={tabId:text(input?.tabId),dates:input?.dates||[],kind:`write-${kind}`};

      try{
        const latest=normalizeAuthority(await v2Store.readConfig());
        config=latest;
        if(V2_AUTHORITY_MODES.has(config.mode)&&config.valid) confirmedV2=true;
      }catch(error){
        config=unknownConfig();
        diagnostic({...base,outcome:'authority-unavailable',durationMs:nowDate().getTime()-started});
        throw authorityError(error);
      }
      if(!config.valid||!AUTHORITY_MODES.has(config.mode)) throw authorityError();
      if(config.compatibilityValid===false){
        diagnostic({...base,outcome:'pointer-mismatch',durationMs:nowDate().getTime()-started});
        throw pointerError(config.compatibilityCode);
      }

      if(V1_AUTHORITY_MODES.has(config.mode)){
        const legacyResult=await legacy[legacyMethod](mutator,input);
        const after=resultMap(legacyResult,outputField);
        let degraded=false;
        const diff=model.diffLegacyMaps(before,after);
        const changed=diff.upserts.length+diff.deletes.length;
        if((config.mode==='shadow'||config.mode==='verify')&&config.generationId){
          try{
            const comparison=await verifyAfterWrite(after,input,kind);
            degraded=!comparison?.ready;
          }catch(error){
            degraded=true;
          }
        }
        diagnostic({...base,outcome:degraded?'degraded':'ok',recordCount:changed,durationMs:nowDate().getTime()-started});
        return {[outputField]:after,primary:'v1',degraded,changed,context:context(input)};
      }

      const after=await applyMutator(before,mutator);
      const diff=model.diffLegacyMaps(before,after);
      const changed=diff.upserts.length+diff.deletes.length;
      if(!changed){
        diagnostic({...base,outcome:'ok',recordCount:0,durationMs:nowDate().getTime()-started});
        return {[outputField]:after,primary:'v2',degraded:false,changed:0,context:context(input)};
      }
      try{
        const response=await v2Store.mutateMap({
          kind,tabId:text(input?.tabId),courseType:text(input?.courseType),before,after,
          operationId:text(input?.operationId)||operationId(),
          operationType:text(input?.operationType)||(
            kind==='guests'?'attendance-guest':(changed>1?'attendance-batch':'attendance-update')
          ),
        });
        if(Number.isSafeInteger(Number(response?.revision))) config.revision=Number(response.revision);
      }catch(error){
        diagnostic({...base,outcome:error?.code?.startsWith?.('attendance-pointer-')?'pointer-mismatch':'v2-error',durationMs:nowDate().getTime()-started});
        if(error?.code==='attendance-pointer-mismatch'||error?.code==='attendance-pointer-missing') throw error;
        throw Object.assign(new Error('V2 출석 데이터를 저장하지 못했습니다. 화면을 새로고침한 뒤 다시 시도해주세요.'),{
          code:error?.code||'v2-attendance-write-failed',cause:error,
        });
      }
      diagnostic({...base,outcome:'ok',recordCount:changed,durationMs:nowDate().getTime()-started});
      return {[outputField]:after,primary:'v2',degraded:false,changed,context:context(input)};
    }
    function updateAttendance(mutator,input){ return updateMap('attendance',mutator,input); }
    function updateGuests(mutator,input){ return updateMap('guests',mutator,input); }
    function setManyAttendance(input){
      return updateAttendance(()=>clone(objectMap(input?.after)),{
        ...(input||{}),operationType:text(input?.operationType)||'attendance-batch',
      });
    }
    function diagnostics(limit){
      const count=Math.max(0,Math.min(MAX_DIAGNOSTICS,Number(limit)||MAX_DIAGNOSTICS));
      return clone(diagnosticRows.slice(-count));
    }

    return Object.freeze({
      ready,
      mode,
      context,
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
