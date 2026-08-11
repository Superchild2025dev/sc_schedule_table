(function(global,factory){
  'use strict';
  const api=factory(global);
  if(typeof module==='object'&&module.exports) module.exports=api;
  global.SCV2OperationalStore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(global){
  'use strict';

  const ROOT_COLLECTION='scheduleV2';
  const MODES=new Set(['v1','shadow','verify','v2-read','v2']);
  const V2_POINTER_MODES=new Set(['shadow','verify','v2-read','v2']);
  const TAB_DOMAINS=new Set(['roster','workflow','attendance']);
  const MAX_ID_READS=30;
  const MAX_DIAGNOSTICS=80;
  const STORAGE_FIELDS=new Set(['branchId','generationId','operationalRevision','lastOperationId']);
  const SHARED_KEY_COLLECTIONS=Object.freeze({
    swim_tab_list:['tabs'],
    swim_retire:['reservations'],swim_enroll:['reservations'],swim_hyuwon:['reservations'],swim_move:['reservations'],
    swim_reserve:['waitlistEntries'],swim_mark:['classMarks'],
    swim_disabled:['disabledSlots'],swim_closed:['calendarClosures'],swim_periods:['schedulePeriods'],
    swim_main_tab:['scheduleSettings'],swim_parent_tab:['scheduleSettings'],
    swim_teachers:['teacherProfiles'],swim_tab_folders:['tabFolders'],swim_archived_tabs:['archivedTabs'],
    swim_age_year:['systemMetadata'],swim_student_id_version:['systemMetadata'],swim_ver:['systemMetadata'],
    swim_retire_history:['retirementRecords'],swim_desk_notes:['deskStudentRecords'],
  });

  function text(value){ return String(value==null?'':value).trim(); }
  function clone(value){ return value==null?value:JSON.parse(JSON.stringify(value)); }
  function object(value){ return !!value&&typeof value==='object'&&!Array.isArray(value); }
  function unique(values){ return [...new Set((Array.isArray(values)?values:[]).map(text).filter(Boolean))]; }
  function parseLegacyValue(value){
    if(typeof value!=='string') return value;
    try{return JSON.parse(value);}catch(error){return value;}
  }
  function safeDocId(value){ return encodeURIComponent(text(value)).replace(/\./g,'%2E')||'missing'; }
  function fail(code,message){ throw Object.assign(new Error(message||code),{code}); }
  function safeInteger(value){ return Number.isSafeInteger(value)&&value>=0; }
  function snapshotRows(snapshot){
    const rows=[];
    snapshot?.forEach?.(doc=>{
      const source=object(doc?.data?.())?doc.data():{};
      const row={...source,id:text(source.id)||text(doc?.id)};
      STORAGE_FIELDS.forEach(key=>delete row[key]);
      rows.push(row);
    });
    return rows;
  }
  function sameContext(left,right){
    return text(left?.branchId)===text(right?.branchId)
      &&text(left?.generationId)===text(right?.generationId)
      &&Number(left?.epoch)===Number(right?.epoch)
      &&Number(left?.revision)===Number(right?.revision);
  }
  function normalizeConfig(value,branchId){
    if(!object(value)) fail('invalid-operational-config','운영 전환 설정을 확인할 수 없습니다.');
    const mode=text(value.mode)||'v1';
    const generationId=text(value.generationId);
    const storedBranch=text(value.branchId)||branchId;
    const epoch=Number(value.epoch??0);
    const revision=Number(value.revision??0);
    if(!MODES.has(mode)||storedBranch!==branchId||!safeInteger(epoch)||!safeInteger(revision)){
      fail('invalid-operational-config','운영 전환 설정이 올바르지 않습니다.');
    }
    if(V2_POINTER_MODES.has(mode)&&!generationId) fail('invalid-operational-config','운영 V2 버전이 지정되지 않았습니다.');
    return {branchId,mode,generationId,epoch,revision,valid:true};
  }
  function tabIdForKey(key){
    if(['swim_students','swim_inst','swim_attendance','swim_att_guests','swim_day_snapshot'].includes(key)) return 'regular';
    let match=key.match(/^swim_bt_([A-Za-z0-9_-]+)_(?:stu|inst)$/);
    if(match) return match[1];
    match=key.match(/^swim_(?:stu|inst)_([A-Za-z0-9_-]+)$/);
    if(match) return match[1];
    match=key.match(/^swim_bt_(?:attendance|att_guests|day_snapshot)_([A-Za-z0-9_-]+)$/);
    if(match) return match[1];
    match=key.match(/^zz_swim_day_snapshot__(regular|bt_([A-Za-z0-9_-]+))__\d{4}-\d{2}-\d{2}$/);
    return match?(match[2]||'regular'):'';
  }
  function normalizeSelection(value,model){
    const domains=unique(value?.domains);
    const tabIds=unique(value?.tabIds);
    const keys=unique(value?.keys);
    const known=new Set(Object.keys(model.DOMAIN_COLLECTIONS||{}));
    if(!domains.length||domains.some(domain=>!known.has(domain))){
      fail('invalid-operational-selection','조회할 운영 데이터 범위를 확인해 주세요.');
    }
    const needsTab=domains.some(domain=>TAB_DOMAINS.has(domain))
      &&(!keys.length||keys.some(key=>!SHARED_KEY_COLLECTIONS[key]));
    if(needsTab&&!tabIds.length) fail('invalid-operational-selection','조회할 시간표 탭을 선택해 주세요.');
    const dateRange=object(value?.dateRange)?{
      start:text(value.dateRange.start),end:text(value.dateRange.end),dates:unique(value.dateRange.dates),
    }:null;
    return {tabIds,domains,dateRange,keys};
  }
  function appendRows(target,name,rows){
    const byId=new Map((target[name]||[]).map(row=>[text(row.id),row]));
    rows.forEach(row=>{ if(text(row?.id)) byId.set(text(row.id),row); });
    target[name]=[...byId.values()];
  }
  function queryForTab(collection,tabIds){
    if(tabIds.length===1) return collection.where('tabId','==',tabIds[0]);
    return collection.where('tabId','in',tabIds);
  }
  function dateMatches(row,dateRange){
    if(!dateRange) return true;
    const date=text(row?.date);
    if(dateRange.dates.length) return dateRange.dates.includes(date);
    if(dateRange.start&&date<dateRange.start) return false;
    if(dateRange.end&&date>dateRange.end) return false;
    return true;
  }
  function mutationAttendanceSelection(selection,model){
    const attendanceKeys=selection.keys.filter(key=>model.domainForLegacyKey(key)==='attendance');
    const dailyDates=attendanceKeys.map(key=>{
      const match=key.match(/^zz_swim_day_snapshot__(?:regular|bt_[A-Za-z0-9_-]+)__(\d{4}-\d{2}-\d{2})$/);
      return match?match[1]:'';
    }).filter(Boolean);
    const hasBundledKey=attendanceKeys.some(key=>!/^zz_swim_day_snapshot__/.test(key));
    return {
      ...selection,
      dateRange:hasBundledKey||!dailyDates.length?null:{start:'',end:'',dates:unique(dailyDates)},
    };
  }
  function rosterKeysForTab(tab){
    const id=text(tab?.id)||'regular';
    if(tab?.type==='bangteuk') return [`swim_bt_${id}_stu`,`swim_bt_${id}_inst`];
    return id==='regular'?['swim_students','swim_inst']:[`swim_stu_${id}`,`swim_inst_${id}`];
  }
  function attendanceKeysForTab(tab){
    const id=text(tab?.id)||'regular';
    return id==='regular'
      ?['swim_attendance','swim_att_guests','swim_day_snapshot']
      :[`swim_bt_attendance_${id}`,`swim_bt_att_guests_${id}`,`swim_bt_day_snapshot_${id}`];
  }
  function domainKeys(selection,collections){
    const result=[];
    const selectedTabs=(collections.tabs||[]).filter(tab=>selection.tabIds.includes(text(tab.id)));
    if(selection.domains.includes('roster')){
      result.push('swim_tab_list');
      selectedTabs.forEach(tab=>result.push(...rosterKeysForTab(tab)));
    }
    if(selection.domains.includes('workflow')) result.push('swim_retire','swim_enroll','swim_hyuwon','swim_move','swim_reserve','swim_mark');
    if(selection.domains.includes('attendance')) selectedTabs.forEach(tab=>result.push(...attendanceKeysForTab(tab)));
    if(selection.domains.includes('calendar')) result.push('swim_disabled','swim_closed','swim_periods','swim_main_tab','swim_parent_tab');
    if(selection.domains.includes('administration')) result.push('swim_teachers','swim_tab_folders','swim_archived_tabs','swim_age_year','swim_student_id_version','swim_ver');
    if(selection.domains.includes('history')) result.push('swim_retire_history','swim_desk_notes');
    return unique(result);
  }
  function projectRoot(reconstructed,keys){
    const root={};
    keys.forEach(key=>{
      if(Object.prototype.hasOwnProperty.call(reconstructed,key)){
        root[key]=reconstructed[key];
        return;
      }
      const daily=key.match(/^zz_swim_day_snapshot__(regular|bt_([A-Za-z0-9_-]+))__(\d{4}-\d{2}-\d{2})$/);
      if(!daily) return;
      const bundledKey=daily[1]==='regular'?'swim_day_snapshot':`swim_bt_day_snapshot_${daily[2]}`;
      const bundled=parseLegacyValue(reconstructed[bundledKey]);
      if(object(bundled)&&Object.prototype.hasOwnProperty.call(bundled,daily[3])) root[key]=JSON.stringify(bundled[daily[3]]);
    });
    return root;
  }
  function collectionsForModel(collections){
    const result=clone(collections)||{};
    if(result.attendanceRecords){
      result.attendanceRecords=result.attendanceRecords.map(row=>{
        const copy={...row};
        if(!result.people) delete copy.personId;
        if(!result.enrollments) delete copy.enrollmentId;
        if(!result.classMarks) delete copy.classMarkId;
        return copy;
      });
    }
    return result;
  }

  function create(options){
    options=options||{};
    const db=options.db;
    const branchId=text(options.branchId);
    const model=options.model||global.SCV2OperationalModel;
    const now=typeof options.now==='function'?options.now:()=>new Date();
    if(!db||typeof db.collection!=='function') throw new TypeError('Firestore connection is required');
    if(!branchId) throw new TypeError('branchId is required');
    if(!model||typeof model.legacyRootFromCollections!=='function'||!model.DOMAIN_COLLECTIONS) throw new TypeError('SCV2OperationalModel is required');

    const branchRef=db.collection(ROOT_COLLECTION).doc(safeDocId(branchId));
    const runtimeRef=branchRef.collection('runtime').doc('operational');
    const shadowRef=branchRef.collection('runtime').doc('scheduleSync');
    const verifyPollMs=Math.max(1,Number(options.verifyPollMs)||25);
    const verifyTimeoutMs=Math.max(verifyPollMs,Number(options.verifyTimeoutMs)||2000);
    const sleep=typeof options.sleep==='function'?options.sleep:milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
    let selectionVersion=0;
    const diagnosticRows=[];

    function record(kind,outcome,details){
      const at=now();
      const row={
        at:(at instanceof Date?at:new Date(at||Date.now())).toISOString(),branchId,kind:text(kind),outcome:text(outcome),
        mode:text(details?.mode),generationId:text(details?.generationId),epoch:Math.max(0,Number(details?.epoch)||0),
        revision:Math.max(0,Number(details?.revision)||0),domainCount:Math.max(0,Number(details?.domainCount)||0),
        tabCount:Math.max(0,Number(details?.tabCount)||0),documentCount:Math.max(0,Number(details?.documentCount)||0),
        code:text(details?.code)||'',
      };
      diagnosticRows.push(row);
      if(diagnosticRows.length>MAX_DIAGNOSTICS) diagnosticRows.splice(0,diagnosticRows.length-MAX_DIAGNOSTICS);
    }
    async function readConfig(){
      const snapshot=await runtimeRef.get();
      if(!snapshot?.exists) fail('invalid-operational-config','운영 전환 설정이 없습니다.');
      return normalizeConfig(snapshot.data()||{},branchId);
    }
    function subscribeConfig(next,error){
      if(typeof next!=='function') throw new TypeError('config callback is required');
      if(typeof runtimeRef.onSnapshot!=='function') throw new TypeError('runtime config subscription is unavailable');
      return runtimeRef.onSnapshot(snapshot=>{
        try{
          if(!snapshot?.exists) fail('invalid-operational-config','운영 전환 설정이 없습니다.');
          next(normalizeConfig(snapshot.data()||{},branchId));
        }catch(actual){ if(typeof error==='function') error(actual); }
      },actual=>{ if(typeof error==='function') error(actual); });
    }
    function generationRef(generationId){ return branchRef.collection('generations').doc(safeDocId(generationId)); }
    async function readDocsByIds(collection,ids){
      const values=unique(ids);
      const rows=[];
      for(let offset=0;offset<values.length;offset+=MAX_ID_READS){
        const chunk=values.slice(offset,offset+MAX_ID_READS);
        const snapshots=await Promise.all(chunk.map(id=>collection.doc(safeDocId(id)).get()));
        snapshots.forEach(snapshot=>{ if(snapshot?.exists) rows.push(...snapshotRows({forEach:callback=>callback(snapshot)})); });
      }
      return rows;
    }
    async function readTabCollection(ref,name,tabIds){
      const rows=[];
      for(let offset=0;offset<tabIds.length;offset+=MAX_ID_READS){
        const chunk=tabIds.slice(offset,offset+MAX_ID_READS);
        rows.push(...snapshotRows(await queryForTab(ref.collection(name),chunk).get()));
      }
      return rows;
    }
    async function readRowsByFieldIds(collection,field,ids){
      const rows=[];
      const values=unique(ids);
      for(let offset=0;offset<values.length;offset+=MAX_ID_READS){
        const chunk=values.slice(offset,offset+MAX_ID_READS);
        const query=chunk.length===1?collection.where(field,'==',chunk[0]):collection.where(field,'in',chunk);
        rows.push(...snapshotRows(await query.get()));
      }
      return rows;
    }
    async function readRoster(ref,selection,collections){
      const tabRead=selection.keys.includes('swim_tab_list')
        ?ref.collection('tabs').get().then(snapshotRows)
        :readDocsByIds(ref.collection('tabs'),selection.tabIds);
      const [tabs,placements,teacherAssignments]=await Promise.all([
        tabRead,readTabCollection(ref,'placements',selection.tabIds),
        readTabCollection(ref,'teacherAssignments',selection.tabIds),
      ]);
      appendRows(collections,'tabs',tabs);appendRows(collections,'placements',placements);
      appendRows(collections,'teacherAssignments',teacherAssignments);
      const [people,enrollments]=await Promise.all([
        readDocsByIds(ref.collection('people'),placements.map(row=>row.personId)),
        readDocsByIds(ref.collection('enrollments'),placements.map(row=>row.enrollmentId)),
      ]);
      appendRows(collections,'people',people);appendRows(collections,'enrollments',enrollments);
    }
    async function readWorkflow(ref,selection,collections){
      await Promise.all(['reservations','waitlistEntries','classMarks'].map(async name=>{
        appendRows(collections,name,await readTabCollection(ref,name,selection.tabIds));
      }));
    }
    async function readAttendance(ref,selection,collections){
      const [tabs,records,guests,snapshots]=await Promise.all([
        readDocsByIds(ref.collection('tabs'),selection.tabIds),readTabCollection(ref,'attendanceRecords',selection.tabIds),
        readTabCollection(ref,'attendanceGuests',selection.tabIds),readTabCollection(ref,'attendanceSnapshots',selection.tabIds),
      ]);
      appendRows(collections,'tabs',tabs);
      appendRows(collections,'attendanceRecords',records.filter(row=>dateMatches(row,selection.dateRange)));
      appendRows(collections,'attendanceGuests',guests.filter(row=>dateMatches(row,selection.dateRange)));
      const selectedSnapshots=snapshots.filter(row=>dateMatches(row,selection.dateRange));
      appendRows(collections,'attendanceSnapshots',selectedSnapshots);
      const snapshotIds=selectedSnapshots.map(row=>row.id);
      const [students,teachers]=await Promise.all([
        readRowsByFieldIds(ref.collection('attendanceSnapshotStudents'),'snapshotId',snapshotIds),
        readRowsByFieldIds(ref.collection('attendanceSnapshotTeachers'),'snapshotId',snapshotIds),
      ]);
      appendRows(collections,'attendanceSnapshotStudents',students);
      appendRows(collections,'attendanceSnapshotTeachers',teachers);
    }
    async function readWholeDomain(ref,domain,collections){
      await readCollections(ref,model.DOMAIN_COLLECTIONS[domain]||[],collections);
    }
    async function readCollections(ref,names,collections){
      await Promise.all(unique(names).map(async name=>{
        appendRows(collections,name,snapshotRows(await ref.collection(name).get()));
      }));
    }
    function assertCurrent(token,started,latest){
      if(token!==selectionVersion||!sameContext(started,latest)) fail('stale-operational-selection','이전 운영 데이터 조회 결과는 사용할 수 없습니다.');
    }
    async function load(input={},mutation=false){
      const selection=normalizeSelection(input,model);
      const token=++selectionVersion;
      const started=input.config?normalizeConfig(input.config,branchId):await readConfig();
      if(!started.generationId) fail('invalid-operational-config','조회할 운영 V2 버전이 없습니다.');
      const ref=generationRef(started.generationId);
      const collections={};
      try{
        const tasks=[];
        if(mutation){
          const ownedTabs=unique(selection.keys.map(tabIdForKey));
          const selectedTabs=ownedTabs.length?ownedTabs:selection.tabIds;
          if(selection.keys.some(key=>model.domainForLegacyKey(key)==='roster'&&key!=='swim_tab_list')){
            tasks.push(readRoster(ref,{...selection,tabIds:selectedTabs},collections));
          }
          const sharedCollections=selection.keys.flatMap(key=>SHARED_KEY_COLLECTIONS[key]||[]);
          if(sharedCollections.length) tasks.push(readCollections(ref,sharedCollections,collections));
          if(selection.keys.some(key=>model.domainForLegacyKey(key)==='attendance')){
            tasks.push(readAttendance(ref,{
              ...mutationAttendanceSelection(selection,model),tabIds:selectedTabs,
            },collections));
          }
        }else{
          if(selection.domains.includes('roster')) tasks.push(readRoster(ref,selection,collections));
          if(selection.domains.includes('workflow')) tasks.push(readWorkflow(ref,selection,collections));
          if(selection.domains.includes('attendance')) tasks.push(readAttendance(ref,selection,collections));
          for(const domain of ['calendar','administration','history']){
            if(selection.domains.includes(domain)) tasks.push(readWholeDomain(ref,domain,collections));
          }
        }
        await Promise.all(tasks);
        const latest=await readConfig();
        assertCurrent(token,started,latest);
        const reconstructed=model.legacyRootFromCollections({
          branchId,generationId:started.generationId,collections:collectionsForModel(collections),
        });
        if(!reconstructed) fail('invalid-operational-data','운영 V2 데이터를 화면 형태로 조합할 수 없습니다.');
        const requestedKeys=selection.keys.length?selection.keys:domainKeys(selection,collections);
        const root=projectRoot(reconstructed,requestedKeys);
        const loadedKeys=unique(requestedKeys);
        const documentCount=Object.values(collections).reduce((sum,rows)=>sum+rows.length,0);
        record(mutation?'mutation-load':'load','ok',{...started,domainCount:selection.domains.length,tabCount:selection.tabIds.length,documentCount});
        return {
          root,loadedKeys,collections,config:clone(latest),
          context:{branchId,generationId:started.generationId,epoch:started.epoch,revision:started.revision},selection:clone(selection),
        };
      }catch(error){
        record(mutation?'mutation-load':'load','error',{...started,domainCount:selection.domains.length,tabCount:selection.tabIds.length,code:error?.code});
        throw error;
      }
    }
    function loadSelection(input={}){ return load(input,false); }
    function loadMutation(input={}){
      const keys=unique(input.keys);
      if(!keys.length) fail('invalid-operational-selection','변경할 운영 키가 필요합니다.');
      const domains=unique(keys.map(key=>model.domainForLegacyKey(key)));
      return load({...input,keys,domains},true);
    }
    async function readShadowState(){
      const snapshot=await shadowRef.get();
      if(!snapshot?.exists) return {status:'idle',requestedRevision:0,appliedRevision:0,pendingKeys:[],inFlightKeys:[],mismatchCount:0};
      const value=object(snapshot.data?.())?snapshot.data():{};
      return {
        status:text(value.status),requestedRevision:Math.max(0,Number(value.requestedRevision)||0),
        appliedRevision:Math.max(0,Number(value.appliedRevision)||0),pendingKeys:unique(value.pendingKeys),
        inFlightKeys:unique(value.inFlightKeys),mismatchCount:Math.max(0,Number(value.mismatchCount)||0),
      };
    }
    async function waitForShadow(input={}){
      const started=Date.now();
      const baseline=Math.max(0,Number(input.afterShadowRevision)||0);
      while(true){
        const state=await readShadowState();
        const settled=state.appliedRevision>=state.requestedRevision
          &&state.pendingKeys.length===0&&state.inFlightKeys.length===0
          &&!['pending','processing','running'].includes(state.status);
        const advanced=input.requireShadowAdvance!==true||state.requestedRevision>baseline;
        if(settled&&advanced){
          return state;
        }
        if(Date.now()-started>=verifyTimeoutMs) fail('v2-operational-shadow-timeout','V2 그림자 동기화를 기다리는 시간이 초과되었습니다.');
        await sleep(verifyPollMs);
      }
    }
    async function parityMismatches(selection,keys,values,config){
      const loaded=keys.length
        ?await loadMutation({...selection,keys,config})
        :await loadSelection({...selection,config});
      const comparedKeys=keys.length?keys:Object.keys(loaded.root);
      const mismatched=comparedKeys.filter(key=>
        model.canonicalDigest(parseLegacyValue(values[key]))!==model.canonicalDigest(parseLegacyValue(loaded.root[key]))
      );
      return {mismatched,keyCount:comparedKeys.length};
    }
    async function verifyParity(input={}){
      const selection=normalizeSelection(input.selection||input,model);
      const values=object(input.values)?input.values:{};
      const keys=unique(input.keys?.length?input.keys:selection.keys);
      if(input.requireShadowAdvance!==true){
        await waitForShadow(input);
        const compared=await parityMismatches(selection,keys,values,input.config);
        if(compared.mismatched.length) fail('v2-operational-parity-mismatch','V1과 V2 운영 데이터가 일치하지 않습니다.');
        return {matches:true,keyCount:compared.keyCount};
      }

      const started=Date.now();
      const baseline=Math.max(0,Number(input.afterShadowRevision)||0);
      let sawAdvancedSettled=false;
      let lastCheckedState='';
      while(true){
        const state=await readShadowState();
        const settled=state.appliedRevision>=state.requestedRevision
          &&state.pendingKeys.length===0&&state.inFlightKeys.length===0
          &&!['pending','processing','running'].includes(state.status);
        const advanced=state.requestedRevision>baseline;
        const stateSignature=[state.status,state.requestedRevision,state.appliedRevision,state.pendingKeys.join(','),state.inFlightKeys.join(',')].join('|');
        if(settled&&advanced&&stateSignature!==lastCheckedState){
          sawAdvancedSettled=true;
          lastCheckedState=stateSignature;
          const compared=await parityMismatches(selection,keys,values,input.config);
          if(!compared.mismatched.length) return {matches:true,keyCount:compared.keyCount};
        }
        if(Date.now()-started>=verifyTimeoutMs){
          if(sawAdvancedSettled) fail('v2-operational-parity-mismatch','V1과 V2 운영 데이터가 일치하지 않습니다.');
          fail('v2-operational-shadow-timeout','V2 그림자 동기화를 기다리는 시간이 초과되었습니다.');
        }
        await sleep(verifyPollMs);
      }
    }
    function invalidate(){ selectionVersion+=1; }
    function diagnostics(limit){
      const count=Math.max(0,Math.min(MAX_DIAGNOSTICS,Number(limit)||MAX_DIAGNOSTICS));
      return clone(diagnosticRows.slice(-count));
    }

    return Object.freeze({
      readConfig,subscribeConfig,loadSelection,loadMutation,readShadowState,verifyParity,invalidate,diagnostics,
    });
  }

  return Object.freeze({ROOT_COLLECTION,MAX_ID_READS,create,normalizeConfig});
});
