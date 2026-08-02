(function(global){
  'use strict';

  const DEVELOPER_EMAIL='developer@scswim.local';
  const DEBOUNCE_MS=700;
  const states=new Map();
  const ALL_COLLECTIONS=[
    'tabs','people','enrollments','placements','teacherAssignments','reservations',
    'waitlistEntries','classMarks','attendanceRecords','attendanceGuests',
    'attendanceSnapshots','attendanceSnapshotStudents','attendanceSnapshotTeachers',
    'disabledSlots','calendarClosures','schedulePeriods','scheduleSettings',
    'teacherProfiles','tabFolders','archivedTabs','systemMetadata','retirementRecords','deskStudentRecords'
  ];
  const SNAPSHOT_COLLECTIONS=['attendanceSnapshots','attendanceSnapshotStudents','attendanceSnapshotTeachers'];
  const OPERATIONAL_KEYS=new Set([
    'swim_audit_log','swim_restore_points',
    'zz_swim_audit_index','zz_swim_restore_index','zz_swim_student_delete_index',
  ]);
  const OPERATIONAL_PREFIXES=[
    'swim_restore_point_','swim_snap_','zz_swim_audit_entry__',
    'zz_swim_restore_point__','zz_swim_student_delete__',
  ];

  function text(value){return String(value==null?'':value).trim();}
  function clone(value){
    if(value==null) return value;
    try{return JSON.parse(JSON.stringify(value));}catch(error){return value;}
  }
  function developerSignedIn(){
    try{
      const user=global.firebase?.auth?.().currentUser;
      return text(user?.email).toLowerCase()===text(global.SC_V2_SHADOW_EMAIL||DEVELOPER_EMAIL).toLowerCase();
    }catch(error){return false;}
  }
  function isOperationalKey(key){
    key=text(key);
    return OPERATIONAL_KEYS.has(key)||OPERATIONAL_PREFIXES.some(prefix=>key.startsWith(prefix));
  }
  function isAttendanceSnapshotKey(key){
    key=text(key);
    return key==='swim_day_snapshot'||/^swim_bt_day_snapshot_/.test(key)||/^zz_swim_day_snapshot__/.test(key);
  }
  function collectionsForKey(key){
    key=text(key);
    if(key==='swim_tab_list') return ALL_COLLECTIONS.slice();
    if(key==='swim_students'||/^swim_stu_/.test(key)||/^swim_bt_.+_stu$/.test(key)){
      return ['people','enrollments','placements'];
    }
    if(key==='swim_inst'||/^swim_inst_/.test(key)||/^swim_bt_.+_inst$/.test(key)){
      return ['teacherAssignments'];
    }
    if(['swim_retire','swim_enroll','swim_hyuwon','swim_move'].includes(key)){
      return ['reservations'];
    }
    if(key==='swim_main_tab') return ['reservations','scheduleSettings'];
    if(key==='swim_parent_tab') return ['scheduleSettings'];
    if(key==='swim_teachers') return ['teacherProfiles'];
    if(key==='swim_tab_folders') return ['tabFolders'];
    if(key==='swim_archived_tabs') return ['archivedTabs'];
    if(['swim_age_year','swim_student_id_version','swim_ver'].includes(key)) return ['systemMetadata'];
    if(key==='swim_reserve') return ['waitlistEntries'];
    if(key==='swim_mark') return ['classMarks'];
    if(key==='swim_disabled') return ['disabledSlots'];
    if(key==='swim_closed') return ['calendarClosures'];
    if(key==='swim_periods') return ['schedulePeriods'];
    if(key==='swim_retire_history') return ['retirementRecords'];
    if(key==='swim_desk_notes') return ['deskStudentRecords'];
    if(key==='swim_attendance'||/^swim_bt_attendance_/.test(key)) return ['attendanceRecords'];
    if(key==='swim_att_guests'||/^swim_bt_att_guests_/.test(key)) return ['attendanceGuests'];
    if(isAttendanceSnapshotKey(key)) return SNAPSHOT_COLLECTIONS.slice();
    return [];
  }
  function unsupportedChangedKeys(keys){
    return [...new Set((keys||[]).map(text).filter(Boolean))]
      .filter(key=>!isOperationalKey(key)&&key.startsWith('swim_')&&!collectionsForKey(key).length);
  }
  function stateFor(root){
    const branchId=text(root?.branchId)||'schedule';
    if(!states.has(branchId)) states.set(branchId,{
      branchId,root,rootCache:null,lastReport:null,generation:null,pending:new Map(),
      full:false,timer:null,running:false,rerun:false,status:null,monitorLoaded:false,
      unresolvedUnsupported:new Set(),snapshotMigrationComplete:false,
    });
    const state=states.get(branchId);
    state.root=root||state.root;
    return state;
  }
  function dispatchStatus(status){
    try{global.dispatchEvent(new CustomEvent('sc:v2-shadow-status',{detail:status}));}catch(error){}
  }
  async function ensureMonitorLoaded(state,store){
    if(state.monitorLoaded) return;
    state.monitorLoaded=true;
    try{
      const branchSnapshot=await state.root.db.collection(store.ROOT_COLLECTION).doc(store.safeDocId(state.branchId)).get();
      const prior=branchSnapshot.exists?(branchSnapshot.data()||{}):{};
      state.snapshotMigrationComplete=prior.shadowSnapshotsMigrated===true;
      (Array.isArray(prior.shadowUnsupportedKeys)?prior.shadowUnsupportedKeys:[])
        .filter(key=>!collectionsForKey(key).length)
        .forEach(key=>state.unresolvedUnsupported.add(key));
    }catch(error){}
  }
  async function loadAttendanceSnapshotRoot(root){
    if(!root||typeof root._listKeys!=='function'||typeof root.child!=='function') return {};
    const keys=(await root._listKeys({includeDeferred:true})).filter(isAttendanceSnapshotKey);
    const out={};
    for(let offset=0;offset<keys.length;offset+=8){
      const chunk=keys.slice(offset,offset+8);
      const values=await Promise.all(chunk.map(async key=>{
        const snapshot=await root.child(key).once('value');
        return [key,snapshot?.val?.()];
      }));
      values.forEach(([key,value])=>{
        if(value!==undefined&&value!==null) out[key]=clone(value);
      });
    }
    return out;
  }
  function snapshotScopeName(tab){
    return tab?.type==='bangteuk'
      ?'bt_'+text(tab.id||'bangteuk').replace(/[^\w-]/g,'_')
      :'regular';
  }
  function snapshotId(schema,tabId,date){
    return 'ats_'+schema.stableHash(`${tabId}|${date}`);
  }
  function snapshotScopesForKeys(keys,report,previousReport,schema){
    const reports=[previousReport,report].filter(Boolean);
    const rows=reports.flatMap(item=>item?.conversion?.attendanceSnapshots||[]);
    const tabs=report?.conversion?.tabs||previousReport?.conversion?.tabs||[];
    const bundle=report?.bundle||previousReport?.bundle||{};
    const scopes=new Map();
    const add=(tabId,date,id)=>{
      tabId=text(tabId);date=text(date);
      if(!tabId||!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      scopes.set(`${tabId}|${date}`,{tabId,date,snapshotId:text(id)||snapshotId(schema,tabId,date)});
    };
    (keys||[]).filter(isAttendanceSnapshotKey).forEach(key=>{
      const perDay=text(key).match(/^zz_swim_day_snapshot__(.+)__(\d{4}-\d{2}-\d{2})$/);
      if(perDay){
        const scopeName=perDay[1],date=perDay[2];
        const matches=rows.filter(row=>row.date===date&&snapshotScopeName(tabs.find(tab=>tab.id===row.tabId))===scopeName);
        matches.forEach(row=>add(row.tabId,row.date,row.id));
        if(!matches.length){
          let tab=null;
          if(scopeName==='regular'){
            const mainId=text(bundle?.mainTab?.tabId);
            tab=tabs.find(item=>item.id===mainId&&item.type!=='bangteuk')
              ||tabs.find(item=>item.id==='regular')
              ||tabs.find(item=>item.type!=='bangteuk');
          }else{
            tab=tabs.find(item=>snapshotScopeName(item)===scopeName);
          }
          if(tab) add(tab.id,date,'');
          else if(scopeName.startsWith('bt_')) add(scopeName.slice(3),date,'');
        }
        return;
      }
      if(key==='swim_day_snapshot'){
        rows.filter(row=>{
          const tab=tabs.find(item=>item.id===row.tabId);
          return !tab||tab.type!=='bangteuk';
        }).forEach(row=>add(row.tabId,row.date,row.id));
        return;
      }
      const bt=text(key).match(/^swim_bt_day_snapshot_(.+)$/);
      if(bt) rows.filter(row=>row.tabId===bt[1]).forEach(row=>add(row.tabId,row.date,row.id));
    });
    return [...scopes.values()];
  }
  async function writeMonitor(state,status,alert){
    state.status=status;
    dispatchStatus(status);
    const store=global.SCScheduleV2Store;
    const db=state.root?.db;
    if(!store||!db) return;
    const branchRef=db.collection(store.ROOT_COLLECTION).doc(store.safeDocId(state.branchId));
    const payload={
      branchId:state.branchId,
      schemaVersion:2,
      shadowStatus:status.state,
      shadowMessage:status.message||'',
      shadowGenerationId:status.generationId||'',
      shadowChangedKeys:status.changedKeys||[],
      shadowUnsupportedKeys:status.unsupportedKeys||[],
      shadowWrites:Number(status.writes||0),
      shadowDeletes:Number(status.deletes||0),
      shadowLastSyncedAt:new Date().toISOString(),
    };
    if(status.snapshotMigrationComplete!==undefined){
      payload.shadowSnapshotsMigrated=status.snapshotMigrationComplete===true;
    }
    try{
      await branchRef.set(payload,{merge:true});
      if(alert){
        const hash=global.SCScheduleSchemaV2?.stableHash?.(JSON.stringify({
          type:alert.type,keys:alert.keys||[],message:alert.message||'',
        }))||String(Date.now());
        const alertRef=branchRef.collection('alerts').doc(`alert_${hash}`);
        let increment=1;
        try{increment=global.firebase.firestore.FieldValue.increment(1);}catch(error){}
        await alertRef.set({
          id:`alert_${hash}`,
          branchId:state.branchId,
          type:alert.type||'mismatch',
          message:alert.message||status.message||'',
          keys:alert.keys||[],
          status:'open',
          lastDetectedAt:new Date().toISOString(),
          count:increment,
        },{merge:true});
      }
    }catch(error){
      console.warn('[SCV2Shadow] 상태 기록 실패:',error);
    }
  }
  async function execute(state){
    if(state.running){state.rerun=true;return;}
    if(!developerSignedIn()) return;
    const schema=global.SCScheduleSchemaV2;
    const store=global.SCScheduleV2Store;
    if(!schema||!store||!state.root?._list) return;
    state.running=true;
    const changedKeys=[...state.pending.keys()];
    const changes=new Map(state.pending);
    const full=state.full;
    state.pending.clear();
    state.full=false;
    try{
      await ensureMonitorLoaded(state,store);
      if(!state.generation){
        state.generation=await store.latestUsableGeneration(state.root.db,state.branchId);
        if(!state.generation?.id) state.snapshotMigrationComplete=false;
      }
      let hydratedSnapshots=false;
      if(!state.rootCache||full){
        state.rootCache=await state.root._list({includeDeferred:false});
        if(!state.snapshotMigrationComplete){
          Object.assign(state.rootCache,await loadAttendanceSnapshotRoot(state.root));
          hydratedSnapshots=true;
        }
      }else{
        changes.forEach((value,key)=>{
          if(value===null||value===undefined) delete state.rootCache[key];
          else state.rootCache[key]=clone(value);
        });
      }
      const report=schema.diagnoseLegacyRoot(state.branchId,state.rootCache);
      if(!report?.checks?.ready){
        const message=`V1 데이터를 V2로 변환할 수 없는 항목 ${report?.blockingIssues?.length||1}건`;
        await writeMonitor(state,{state:'mismatch',message,changedKeys,generationId:state.generation?.id||''},{type:'conversion',message,keys:changedKeys});
        return;
      }
      if(!state.generation?.id){
        await writeMonitor(state,{
          state:'syncing',
          message:'이 지점의 V2 시작 데이터를 안전하게 만들고 있습니다.',
          changedKeys,
        });
        const created=await store.writeGeneration(state.root.db,state.branchId,report,{
          baselineCreatedAt:new Date().toISOString(),
          sourceBuildVersion:text(global.SC_BUILD_VERSION||global.SC_ASSET_VERSION),
          rollbackPolicy:'v1-remains-source',
        });
        state.generation={
          id:created.generationId,
          status:'ready',
          createdAt:new Date().toISOString(),
        };
        // 방금 만든 세대는 현재 보고서와 이미 동일하므로 다시 전체 조회하지 않는다.
        state.lastReport=report;
      }
      const unsupported=full?[]:unsupportedChangedKeys(changedKeys);
      unsupported.forEach(key=>state.unresolvedUnsupported.add(key));
      [...state.unresolvedUnsupported].forEach(key=>{
        if(collectionsForKey(key).length) state.unresolvedUnsupported.delete(key);
      });
      const changedSnapshotKeys=changedKeys.filter(isAttendanceSnapshotKey);
      const collections=(full
        ? ALL_COLLECTIONS.filter(collection=>hydratedSnapshots||!SNAPSHOT_COLLECTIONS.includes(collection))
        : [...new Set(changedKeys.flatMap(collectionsForKey))].filter(collection=>!SNAPSHOT_COLLECTIONS.includes(collection)));
      let result={writes:0,deletes:0};
      if(collections.length){
        result=await store.syncShadowGeneration(state.root.db,state.branchId,state.generation.id,report,{
          collections,
          changedKeys,
          previousReport:state.lastReport,
        });
      }
      if(!full&&changedSnapshotKeys.length){
        const scopes=snapshotScopesForKeys(changedSnapshotKeys,report,state.lastReport,schema);
        const snapshotResult=await store.syncShadowSnapshotScopes(
          state.root.db,state.branchId,state.generation.id,report,scopes,{changedKeys:changedSnapshotKeys}
        );
        result.writes+=snapshotResult.writes;
        result.deletes+=snapshotResult.deletes;
      }
      if(hydratedSnapshots) state.snapshotMigrationComplete=true;
      state.lastReport=report;
      if(state.unresolvedUnsupported.size){
        const unresolved=[...state.unresolvedUnsupported];
        const message=`아직 V2 형식이 없는 기능 데이터가 변경되었습니다: ${unresolved.join(', ')}`;
        await writeMonitor(state,{
          state:'mismatch',message,changedKeys,unsupportedKeys:unresolved,
          generationId:state.generation.id,writes:result.writes,deletes:result.deletes,
          snapshotMigrationComplete:state.snapshotMigrationComplete,
        },unsupported.length?{type:'unsupported-key',message,keys:unsupported}:null);
        return;
      }
      await writeMonitor(state,{
        state:'ok',message:(collections.length||changedSnapshotKeys.length)?'V1과 V2가 일치합니다.':'V2에 영향을 주지 않는 변경입니다.',
        changedKeys,generationId:state.generation.id,writes:result.writes,deletes:result.deletes,
        snapshotMigrationComplete:state.snapshotMigrationComplete,
      });
    }catch(error){
      console.error('[SCV2Shadow] 동기화 실패:',error);
      const message=error?.message||String(error);
      await writeMonitor(state,{state:'error',message,changedKeys,generationId:state.generation?.id||''},{type:'sync-error',message,keys:changedKeys});
    }finally{
      state.running=false;
      if(state.rerun||state.pending.size||state.full){
        state.rerun=false;
        schedule(state.root,{reason:'queued'});
      }
    }
  }
  function schedule(root,options){
    if(!root) return;
    const state=stateFor(root);
    const opts=options||{};
    if(opts.full) state.full=true;
    Object.entries(opts.changes||{}).forEach(([key,value])=>state.pending.set(text(key),clone(value)));
    if(state.timer) clearTimeout(state.timer);
    state.timer=setTimeout(()=>{
      state.timer=null;
      execute(state);
    },DEBOUNCE_MS);
  }
  function getStatus(branchId){return states.get(text(branchId))?.status||null;}
  function refresh(root){schedule(root,{full:true,reason:'manual-refresh'});}

  global.SCV2Shadow=Object.freeze({
    schedule,refresh,getStatus,collectionsForKey,unsupportedChangedKeys,isOperationalKey,
    isDeveloperSession:developerSignedIn,
  });
})(typeof window!=='undefined'?window:globalThis);
