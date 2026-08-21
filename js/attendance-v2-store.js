(function(global){
  'use strict';

  const MODES=Object.freeze(['v1','shadow','verify','v2-read','v2']);
  const MAX_RANGE_DATES=10;
  const MAX_BATCH_CHANGES=400;
  const ATTENDANCE_COLLECTIONS=Object.freeze(['attendanceRecords','attendanceGuests']);
  const V2_AUTHORITY_MODES=new Set(['v2-read','v2']);
  const GENERATION_ID_RE=/^[A-Za-z0-9_-]{1,128}$/;
  const RETRYABLE_CODES=new Set(['cancelled','deadline-exceeded','internal','resource-exhausted','unavailable']);
  const AMBIGUOUS_TERMINAL_CODES=new Set([...RETRYABLE_CODES,'data-loss','unknown']);
  let operationSequence=0;

  function text(value){ return String(value==null?'':value).trim(); }
  function clone(value){ return value==null?value:JSON.parse(JSON.stringify(value)); }
  function object(value){ return !!value&&typeof value==='object'&&!Array.isArray(value); }
  function owns(value,key){ return Object.prototype.hasOwnProperty.call(value,key); }
  function baseStore(){
    const store=global.SCScheduleV2Store;
    if(!store||typeof store.safeDocId!=='function') throw new Error('SCScheduleV2Store is required');
    return store;
  }
  function model(){
    const value=global.SCV2AttendanceModel;
    if(!value||typeof value.compareLegacyRows!=='function') throw new Error('SCV2AttendanceModel is required');
    return value;
  }
  function attendanceDefault(branchId){
    return {mode:'v1',generationId:'',branchId:text(branchId),valid:false};
  }
  function defaultConfig(branchId){
    return {
      mode:'v1',generationId:'',branchId:text(branchId),epoch:0,revision:0,
      valid:false,compatibilityValid:false,compatibilityCode:'attendance-pointer-missing',
    };
  }
  function normalizeConfig(raw,branchId,exists){
    const branch=text(branchId);
    const required=['mode','generationId','branchId'];
    if(!exists||!object(raw)||required.some(key=>!owns(raw,key))
      ||typeof raw.mode!=='string'||typeof raw.generationId!=='string'
      ||typeof raw.branchId!=='string'
      ||raw.mode!==text(raw.mode)||raw.generationId!==text(raw.generationId)
      ||raw.branchId!==text(raw.branchId)
      ||(raw.generationId!==''&&!GENERATION_ID_RE.test(raw.generationId))) return attendanceDefault(branch);
    const mode=text(raw.mode);
    const generationId=text(raw.generationId);
    const storedBranch=text(raw.branchId);
    const valid=MODES.includes(mode)&&storedBranch===branch&&(mode==='v1'||!!generationId);
    if(!valid) return attendanceDefault(branch);
    return {mode,generationId:mode==='v1'?'':generationId,branchId:branch,valid:true};
  }
  function normalizeOperationalConfig(raw,branchId,exists){
    const branch=text(branchId);
    const required=['mode','generationId','branchId','epoch','revision'];
    if(!exists||!object(raw)||required.some(key=>!owns(raw,key))
      ||typeof raw.mode!=='string'||typeof raw.generationId!=='string'
      ||typeof raw.branchId!=='string'
      ||typeof raw.epoch!=='number'||typeof raw.revision!=='number'
      ||raw.mode!==text(raw.mode)||raw.generationId!==text(raw.generationId)
      ||raw.branchId!==text(raw.branchId)
      ||(raw.generationId!==''&&!GENERATION_ID_RE.test(raw.generationId))) return defaultConfig(branch);
    const mode=text(raw.mode);
    const generationId=text(raw.generationId);
    const epoch=raw.epoch;
    const revision=raw.revision;
    const valid=MODES.includes(mode)&&text(raw.branchId)===branch
      &&(mode==='v1'||!!generationId)
      &&Number.isSafeInteger(epoch)&&epoch>=0
      &&Number.isSafeInteger(revision)&&revision>=0;
    if(!valid) return defaultConfig(branch);
    return {mode,generationId:mode==='v1'?'':generationId,branchId:branch,epoch,revision,valid:true};
  }
  function combinedConfig(operational,attendance,branchId){
    const authoritative=operational?.valid?operational:defaultConfig(branchId);
    const compatibilityValid=!!(
      authoritative.valid&&attendance?.valid
      &&attendance.branchId===authoritative.branchId
      &&attendance.mode===authoritative.mode
      &&attendance.generationId===authoritative.generationId
    );
    return {
      mode:authoritative.mode,generationId:authoritative.generationId,
      branchId:authoritative.branchId,epoch:Number(authoritative.epoch)||0,
      revision:Number(authoritative.revision)||0,valid:authoritative.valid===true,
      compatibilityValid,
      compatibilityCode:compatibilityValid?'':(
        attendance?.valid?'attendance-pointer-mismatch':'attendance-pointer-missing'
      ),
    };
  }
  function snapshotRows(snapshot){
    const rows=[];
    snapshot?.forEach?.(doc=>{
      const value=doc?.data?.()||{};
      rows.push({...value,id:text(value.id)||text(doc?.id)});
    });
    return rows;
  }
  function issueTypeCounts(issues){
    return (Array.isArray(issues)?issues:[]).reduce((counts,item)=>{
      const type=text(item?.type)||'unknown';
      counts[type]=(counts[type]||0)+1;
      return counts;
    },{});
  }
  function defaultOperationId(){
    if(global.crypto&&typeof global.crypto.randomUUID==='function') return global.crypto.randomUUID();
    operationSequence=(operationSequence+1)%1000000;
    return `attendance_${Date.now().toString(36)}_${operationSequence.toString(36)}`;
  }
  function authorityFingerprint(value){
    return [
      text(value?.branchId),text(value?.mode),text(value?.generationId),
      typeof value?.epoch==='number'?value.epoch:'invalid',
      typeof value?.revision==='number'?value.revision:'invalid',
    ].join('|');
  }

  function create(options){
    const db=options?.db;
    const branchId=text(options?.branchId);
    if(!db||typeof db.collection!=='function') throw new Error('Firestore 연결이 필요합니다.');
    if(!branchId) throw new Error('지점 정보가 필요합니다.');
    const safeDocId=baseStore().safeDocId;
    const branchRef=db.collection('scheduleV2').doc(safeDocId(branchId));
    const runtimeRef=branchRef.collection('runtime');
    const attendanceConfigRef=runtimeRef.doc('attendance');
    const operationalConfigRef=runtimeRef.doc('operational');
    let attendanceConfig=attendanceDefault(branchId);
    let operationalConfig=defaultConfig(branchId);
    let activeConfig=defaultConfig(branchId);
    const maxMutationAttempts=Math.max(1,Math.min(3,Number(options?.maxMutationAttempts||2)||2));
    const maxConflictAttempts=Math.max(1,Math.min(3,Number(options?.maxConflictAttempts||3)||3));
    const conflictRetryDelayMs=Math.max(0,Math.min(250,Number(options?.conflictRetryDelayMs??30)||0));
    const sleep=typeof options?.sleep==='function'
      ?options.sleep
      :milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
    const mutateCallable=createMutateCallable(options);

    function createMutateCallable(input){
      if(typeof input?.mutate==='function') return input.mutate;
      const functions=input?.functions||(
        global.firebase&&typeof global.firebase.app==='function'
          ?global.firebase.app().functions('asia-northeast3')
          :null
      );
      if(!functions||typeof functions.httpsCallable!=='function') return async()=>{
        throw Object.assign(new Error('V2 operational callable is unavailable.'),{
          code:'operational-callable-unavailable',
        });
      };
      const invoke=functions.httpsCallable('mutateScheduleV2Operational');
      return async request=>(await invoke(request))?.data;
    }
    function generationRef(generationId){
      return branchRef.collection('generations').doc(safeDocId(generationId));
    }
    function requireGeneration(requested){
      const generationId=text(requested)||text(activeConfig.generationId);
      if(!generationId) throw new Error('V2 출석 세대가 설정되지 않았습니다.');
      if(activeConfig.valid&&activeConfig.mode!=='v1'&&activeConfig.generationId!==generationId){
        throw new Error('요청한 출석 데이터가 현재 V2 세대와 일치하지 않습니다.');
      }
      return generationId;
    }
    function collectionRef(generationId,name){
      if(!ATTENDANCE_COLLECTIONS.includes(name)) throw new Error('허용되지 않은 V2 출석 컬렉션입니다.');
      return generationRef(generationId).collection(name);
    }
    function attendanceOwnerQuery(collection,tabId,courseType){
      return text(courseType)==='regular'
        ?collection.where('courseType','==','regular')
        :collection.where('tabId','==',tabId);
    }
    function readCourseType(input){
      const courseType=text(input?.courseType);
      if(courseType==='regular'||courseType==='bangteuk') return courseType;
      if(!courseType&&text(input?.tabId)==='regular') return 'regular';
      throw Object.assign(new Error('출석 시간표의 수업 구분을 확인할 수 없어 조회를 중단했습니다.'),{
        code:'ambiguous-attendance-owner',
      });
    }
    async function readConfig(){
      const [operationalSnapshot,attendanceSnapshot]=await Promise.all([
        operationalConfigRef.get(),attendanceConfigRef.get(),
      ]);
      operationalConfig=normalizeOperationalConfig(
        operationalSnapshot?.data?.(),branchId,!!operationalSnapshot?.exists,
      );
      attendanceConfig=normalizeConfig(
        attendanceSnapshot?.data?.(),branchId,!!attendanceSnapshot?.exists,
      );
      activeConfig=combinedConfig(operationalConfig,attendanceConfig,branchId);
      return clone(activeConfig);
    }
    function subscribeConfig(next,error){
      let operationalReady=false;
      let attendanceReady=false;
      function publish(){
        if(!operationalReady||!attendanceReady) return;
        activeConfig=combinedConfig(operationalConfig,attendanceConfig,branchId);
        next?.(clone(activeConfig));
      }
      const stopOperational=operationalConfigRef.onSnapshot(snapshot=>{
        operationalConfig=normalizeOperationalConfig(snapshot?.data?.(),branchId,!!snapshot?.exists);
        operationalReady=true;publish();
      },error);
      const stopAttendance=attendanceConfigRef.onSnapshot(snapshot=>{
        attendanceConfig=normalizeConfig(snapshot?.data?.(),branchId,!!snapshot?.exists);
        attendanceReady=true;publish();
      },error);
      return ()=>{stopOperational?.();stopAttendance?.();};
    }
    async function setConfig(config){
      const normalized=normalizeConfig({
        mode:text(config?.mode),generationId:text(config?.generationId),branchId,
      },branchId,true);
      if(!normalized.valid) throw new Error('올바른 V2 출석 전환 설정이 아닙니다.');
      await attendanceConfigRef.set({
        mode:normalized.mode,generationId:normalized.generationId,
        branchId:normalized.branchId,updatedAt:new Date().toISOString(),
      },{merge:true});
      attendanceConfig=normalized;
      activeConfig=combinedConfig(operationalConfig,attendanceConfig,branchId);
      return clone(normalized);
    }
    function rangeDates(values){
      const dates=[];
      (Array.isArray(values)?values:[]).forEach(value=>{
        const date=text(value);
        if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('올바르지 않은 출석 날짜입니다.');
        if(!dates.includes(date)) dates.push(date);
      });
      if(!dates.length) throw new Error('조회할 출석 날짜가 없습니다.');
      if(dates.length>MAX_RANGE_DATES) throw new Error('출석 데이터는 한 번에 최대 10일까지만 조회할 수 있습니다.');
      return dates;
    }
    async function readRange(input){
      const generationId=requireGeneration(input?.generationId);
      const tabId=text(input?.tabId);
      if(!tabId) throw new Error('출석 시간표 탭이 필요합니다.');
      const courseType=readCourseType(input);
      const dates=rangeDates(input?.dates);
      const read=async name=>{
        let query=attendanceOwnerQuery(collectionRef(generationId,name),tabId,courseType);
        if(courseType!=='regular') query=query.where('date','in',dates);
        return query.get();
      };
      const [recordSnapshot,guestSnapshot]=await Promise.all([
        read('attendanceRecords'),read('attendanceGuests'),
      ]);
      const selected=new Set(dates);
      const records=snapshotRows(recordSnapshot).filter(row=>selected.has(text(row.date)));
      const guests=snapshotRows(guestSnapshot).filter(row=>selected.has(text(row.date)));
      return {branchId,generationId,tabId,dates:dates.slice(),records,guests,maps:model().mapsFromRows(records,guests)};
    }
    function storageKey(kind,tabId,courseType){
      const bangteuk=text(courseType)==='bangteuk';
      if(kind==='attendance') return bangteuk?`swim_bt_attendance_${tabId}`:'swim_attendance';
      if(kind==='guests') return bangteuk?`swim_bt_att_guests_${tabId}`:'swim_att_guests';
      throw Object.assign(new Error('Invalid attendance mutation kind.'),{code:'invalid-attendance-kind'});
    }
    function callableCode(error){
      return text(error?.code).toLowerCase()
        .replace(/^firebase\/functions\//,'').replace(/^functions\//,'');
    }
    async function invokeMutation(request,startedAuthority){
      let lastError;
      let sawAmbiguousFailure=false;
      for(let attempt=0;attempt<maxMutationAttempts;attempt+=1){
        try{return await mutateCallable(clone(request));}
        catch(error){
          lastError=error;
          const code=callableCode(error);
          const retryable=RETRYABLE_CODES.has(code);
          sawAmbiguousFailure=sawAmbiguousFailure||AMBIGUOUS_TERMINAL_CODES.has(code);
          if(retryable&&attempt+1<maxMutationAttempts) continue;
          if(sawAmbiguousFailure){
            let latest;
            try{ latest=await readConfig(); }
            catch(authorityError){
              throw Object.assign(new Error('Attendance authority could not be reconciled after an ambiguous save.'),{
                code:'attendance-authority-unavailable',cause:error,authorityCause:authorityError,
              });
            }
            if(authorityFingerprint(latest)!==authorityFingerprint(startedAuthority)){
              throw Object.assign(new Error('Attendance authority changed after an ambiguous save.'),{
                code:'attendance-authority-changed',cause:error,authority:clone(latest),
              });
            }
          }
          throw error;
        }
      }
      throw lastError;
    }
    async function mutateMap(input){
      let latest=await readConfig();
      if(!latest.valid||!V2_AUTHORITY_MODES.has(latest.mode)){
        throw Object.assign(new Error('V2 운영 출석 저장이 활성화되지 않았습니다.'),{code:'v2-attendance-inactive'});
      }
      if(!latest.compatibilityValid){
        throw Object.assign(new Error('출석 전환 설정과 운영 전환 설정이 일치하지 않아 저장을 중단했습니다.'),{
          code:latest.compatibilityCode||'attendance-pointer-mismatch',
        });
      }
      const kind=text(input?.kind);
      const tabId=text(input?.tabId);
      const courseType=text(input?.courseType);
      const key=storageKey(kind,tabId,courseType);
      const id=text(input?.operationId)||defaultOperationId();
      const operationType=text(input?.operationType)||(
        kind==='guests'?'attendance-guest':'attendance-update'
      );
      const recordChanges=model().recordChangesFromLegacyDiff({
        kind,tabId,courseType,before:input?.before,after:input?.after,
      });
      const startedAuthority=clone(latest);
      let lastError;
      for(let attempt=0;attempt<maxConflictAttempts;attempt+=1){
        const request={
          branchId,generationId:latest.generationId,expectedEpoch:latest.epoch,
          operationId:id,operationType,keys:[key],beforeRevision:latest.revision,
          recordChanges:clone(recordChanges),
        };
        try{
          const response=await invokeMutation(request,latest);
          if(!response||response.committed!==true||text(response.operationId)!==id
            ||Number(response.revision)!==latest.revision+1){
            throw Object.assign(new Error('Invalid V2 operational response.'),{code:'invalid-operational-response'});
          }
          operationalConfig={...operationalConfig,revision:Number(response.revision)};
          activeConfig={...activeConfig,revision:Number(response.revision)};
          return clone(response);
        }catch(error){
          lastError=error;
          const code=callableCode(error);
          if(!['aborted','failed-precondition'].includes(code)||attempt+1>=maxConflictAttempts) throw error;
          const next=await readConfig();
          const structural=value=>[
            text(value?.branchId),text(value?.mode),text(value?.generationId),Number(value?.epoch)||0,
          ].join('|');
          if(!next.valid||structural(next)!==structural(startedAuthority)){
            throw Object.assign(new Error('Attendance authority changed during conflict recovery.'),{
              code:'attendance-authority-changed',cause:error,authority:clone(next),
            });
          }
          if(Number(next.revision)<Number(latest.revision)
            ||(code==='failed-precondition'&&Number(next.revision)===Number(latest.revision))){
            throw error;
          }
          if(code==='aborted'&&Number(next.revision)===Number(latest.revision)){
            await sleep(conflictRetryDelayMs*(attempt+1));
            latest=await readConfig();
          }else{
            latest=next;
          }
        }
      }
      throw lastError;
    }
    async function directWriteDisabled(){
      throw Object.assign(new Error('V2 attendance writes require the operational callable.'),{
        code:'direct-v2-write-disabled',
      });
    }
    function compareRange(input){
      const comparison=model().compareLegacyRows({
        attendance:input?.legacyAttendance||input?.attendance,
        guests:input?.legacyGuests||input?.guestMap||input?.guestsMap||input?.guests,
        records:input?.records,
        guestRows:input?.guestRows||input?.v2Guests||(Array.isArray(input?.guests)?input.guests:[]),
      });
      return {...comparison,diagnostic:{
        branchId,mode:activeConfig.mode,ready:comparison.ready,
        mismatchCount:comparison.mismatchCount,counts:clone(comparison.counts),
        issueTypes:issueTypeCounts(comparison.issues),
      }};
    }

    return Object.freeze({
      readConfig,subscribeConfig,setConfig,readRange,mutateMap,compareRange,
      setRecord:directWriteDisabled,deleteRecord:directWriteDisabled,
      replaceGuestGroup:directWriteDisabled,writeRecordBatch:directWriteDisabled,
      currentConfig(){return clone(activeConfig);},
    });
  }

  global.SCV2AttendanceStore=Object.freeze({
    MODES,MAX_RANGE_DATES,MAX_BATCH_CHANGES,ATTENDANCE_COLLECTIONS,
    normalizeConfig,normalizeOperationalConfig,create,
  });
})(typeof window!=='undefined'?window:globalThis);
