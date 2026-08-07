(function(global){
  'use strict';

  const MODES=Object.freeze(['v1','shadow','verify','v2-read','v2']);
  const MAX_RANGE_DATES=10;
  const MAX_BATCH_CHANGES=450;
  const ATTENDANCE_COLLECTIONS=Object.freeze(['attendanceRecords','attendanceGuests']);

  function text(value){ return String(value==null?'':value).trim(); }
  function clone(value){
    if(value==null) return value;
    return JSON.parse(JSON.stringify(value));
  }
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
  function defaultConfig(branchId){
    return {mode:'v1',generationId:'',branchId:text(branchId),valid:false};
  }
  function normalizeConfig(raw,branchId,exists){
    const branch=text(branchId);
    if(!exists||!raw||typeof raw!=='object') return defaultConfig(branch);
    const mode=text(raw.mode);
    const generationId=text(raw.generationId);
    const storedBranch=text(raw.branchId);
    const validMode=MODES.includes(mode);
    const validBranch=storedBranch===branch;
    const validGeneration=mode==='v1'||!!generationId;
    if(!validMode||!validBranch||!validGeneration) return defaultConfig(branch);
    return {mode,generationId:mode==='v1'?'':generationId,branchId:branch,valid:true};
  }
  function snapshotRows(snapshot){
    const rows=[];
    if(!snapshot||typeof snapshot.forEach!=='function') return rows;
    snapshot.forEach(doc=>{
      const value=doc&&typeof doc.data==='function'?(doc.data()||{}):{};
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

  function create(options){
    const db=options?.db;
    const branchId=text(options?.branchId);
    if(!db||typeof db.collection!=='function') throw new Error('Firestore 연결이 필요합니다.');
    if(!branchId) throw new Error('지점 정보가 필요합니다.');
    const safeDocId=baseStore().safeDocId;
    const branchRef=db.collection('scheduleV2').doc(safeDocId(branchId));
    const configRef=branchRef.collection('runtime').doc('attendance');
    let activeConfig=defaultConfig(branchId);

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
    async function readConfig(){
      const snapshot=await configRef.get();
      activeConfig=normalizeConfig(snapshot?.data?.(),branchId,!!snapshot?.exists);
      return clone(activeConfig);
    }
    function subscribeConfig(next,error){
      return configRef.onSnapshot(snapshot=>{
        activeConfig=normalizeConfig(snapshot?.data?.(),branchId,!!snapshot?.exists);
        if(typeof next==='function') next(clone(activeConfig));
      },error);
    }
    async function setConfig(config){
      const requested={
        mode:text(config?.mode),
        generationId:text(config?.generationId),
        branchId,
      };
      const normalized=normalizeConfig(requested,branchId,true);
      if(!normalized.valid) throw new Error('올바른 V2 출석 전환 설정이 아닙니다.');
      await configRef.set({
        mode:normalized.mode,
        generationId:normalized.generationId,
        branchId:normalized.branchId,
        updatedAt:new Date().toISOString(),
      },{merge:true});
      activeConfig=normalized;
      return clone(activeConfig);
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
      const dates=rangeDates(input?.dates);
      const filters=collection=>collection
        .where('tabId','==',tabId)
        .where('date','in',dates)
        .get();
      const [recordSnapshot,guestSnapshot]=await Promise.all([
        filters(collectionRef(generationId,'attendanceRecords')),
        filters(collectionRef(generationId,'attendanceGuests')),
      ]);
      const records=snapshotRows(recordSnapshot);
      const guests=snapshotRows(guestSnapshot);
      return {
        branchId,generationId,tabId,dates:dates.slice(),records,guests,
        maps:model().mapsFromRows(records,guests),
      };
    }
    function storedRow(row,generationId){
      return {...clone(row),branchId,generationId};
    }
    async function setRecord(record){
      const generationId=requireGeneration(record?.generationId);
      const id=text(record?.id);
      if(!id) throw new Error('출석 문서 ID가 필요합니다.');
      const ref=collectionRef(generationId,'attendanceRecords').doc(safeDocId(id));
      await db.runTransaction(async transaction=>{
        transaction.set(ref,storedRow(record,generationId),{merge:false});
      });
      return storedRow(record,generationId);
    }
    async function deleteRecord(recordId,generation){
      const generationId=requireGeneration(generation);
      const id=text(recordId);
      if(!id) throw new Error('삭제할 출석 문서 ID가 필요합니다.');
      const ref=collectionRef(generationId,'attendanceRecords').doc(safeDocId(id));
      await db.runTransaction(async transaction=>{ transaction.delete(ref); });
      return {id,generationId,deleted:true};
    }
    async function replaceGuestGroup(input){
      const generationId=requireGeneration(input?.generationId);
      const rows=Array.isArray(input?.rows)?input.rows:[];
      const existingRows=Array.isArray(input?.existingRows)?input.existingRows:null;
      if(!existingRows) throw new Error('기존 추가 원생 목록이 필요합니다.');
      const desiredIds=new Set(rows.map(row=>text(row?.id)).filter(Boolean));
      const batch=db.batch();
      existingRows.forEach(row=>{
        const id=text(row?.id);
        if(id&&!desiredIds.has(id)) batch.delete(collectionRef(generationId,'attendanceGuests').doc(safeDocId(id)));
      });
      rows.forEach(row=>{
        const id=text(row?.id);
        if(!id) throw new Error('추가 원생 문서 ID가 필요합니다.');
        batch.set(
          collectionRef(generationId,'attendanceGuests').doc(safeDocId(id)),
          storedRow(row,generationId),
          {merge:false}
        );
      });
      await batch.commit();
      return {generationId,written:rows.length,deleted:existingRows.filter(row=>!desiredIds.has(text(row?.id))).length};
    }
    async function writeRecordBatch(changes,generation){
      const list=Array.isArray(changes)?changes:[];
      if(list.length>MAX_BATCH_CHANGES) throw new Error('출석 일괄 변경은 한 번에 450개까지만 가능합니다.');
      const generationId=requireGeneration(generation);
      if(!list.length) return {generationId,written:0,deleted:0};
      const batch=db.batch();
      let written=0;
      let deleted=0;
      list.forEach(change=>{
        const collection=text(change?.collection);
        const id=text(change?.id||change?.row?.id);
        if(!id) throw new Error('출석 일괄 변경 문서 ID가 필요합니다.');
        const ref=collectionRef(generationId,collection).doc(safeDocId(id));
        if(change?.type==='delete'){
          batch.delete(ref);deleted+=1;
        }else{
          batch.set(ref,storedRow(change?.row||change?.value||{},generationId),{merge:false});written+=1;
        }
      });
      await batch.commit();
      return {generationId,written,deleted};
    }
    function compareRange(input){
      const comparison=model().compareLegacyRows({
        attendance:input?.legacyAttendance||input?.attendance,
        guests:input?.legacyGuests||input?.guestMap||input?.guestsMap||input?.guests,
        records:input?.records,
        guestRows:input?.guestRows||input?.v2Guests||(
          Array.isArray(input?.guests)?input.guests:[]
        ),
      });
      const diagnostic={
        branchId,
        mode:activeConfig.mode,
        ready:comparison.ready,
        mismatchCount:comparison.mismatchCount,
        counts:clone(comparison.counts),
        issueTypes:issueTypeCounts(comparison.issues),
      };
      return {...comparison,diagnostic};
    }

    return Object.freeze({
      readConfig,
      subscribeConfig,
      setConfig,
      readRange,
      setRecord,
      deleteRecord,
      replaceGuestGroup,
      writeRecordBatch,
      compareRange,
      currentConfig(){ return clone(activeConfig); },
    });
  }

  global.SCV2AttendanceStore=Object.freeze({
    MODES,
    MAX_RANGE_DATES,
    MAX_BATCH_CHANGES,
    ATTENDANCE_COLLECTIONS,
    normalizeConfig,
    create,
  });
})(typeof window!=='undefined'?window:globalThis);
