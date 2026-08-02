(function(global){
  'use strict';

  const ROOT_COLLECTION='scheduleV2';
  const WRITE_BATCH_SIZE=350;
  const COLLECTIONS=[
    'tabs','people','enrollments','placements','teacherAssignments','reservations',
    'waitlistEntries','classMarks','attendanceRecords','attendanceGuests',
    'attendanceSnapshots','attendanceSnapshotStudents','attendanceSnapshotTeachers',
    'disabledSlots','calendarClosures','schedulePeriods','scheduleSettings',
    'teacherProfiles','tabFolders','archivedTabs','systemMetadata','retirementRecords','deskStudentRecords'
  ];

  function text(value){ return String(value==null?'':value).trim(); }
  function safeDocId(value){
    return encodeURIComponent(text(value)).replace(/\./g,'%2E')||'missing';
  }
  function generationId(now){
    const date=now instanceof Date?now:new Date(now||Date.now());
    const pad=(value,size)=>String(value).padStart(size,'0');
    return `gen_${date.getFullYear()}${pad(date.getMonth()+1,2)}${pad(date.getDate(),2)}_${pad(date.getHours(),2)}${pad(date.getMinutes(),2)}${pad(date.getSeconds(),2)}_${pad(date.getMilliseconds(),3)}`;
  }
  function generationDocuments(report){
    const conversion=report?.conversion||{};
    const rows=[];
    COLLECTIONS.forEach(collection=>{
      const source=collection==='teacherAssignments'
        ? conversion.teacherAssignments
        : conversion[collection];
      (Array.isArray(source)?source:[]).forEach(value=>{
        if(!value?.id) return;
        rows.push({collection,id:String(value.id),value:{...value}});
      });
    });
    return rows;
  }
  function expectedCounts(report){
    const conversion=report?.conversion||{};
    return {
      tabs:Array.isArray(conversion.tabs)?conversion.tabs.length:0,
      people:Array.isArray(conversion.people)?conversion.people.length:0,
      enrollments:Array.isArray(conversion.enrollments)?conversion.enrollments.length:0,
      placements:Array.isArray(conversion.placements)?conversion.placements.length:0,
      teacherAssignments:Array.isArray(conversion.teacherAssignments)?conversion.teacherAssignments.length:0,
      reservations:Array.isArray(conversion.reservations)?conversion.reservations.length:0,
      waitlistEntries:Array.isArray(conversion.waitlistEntries)?conversion.waitlistEntries.length:0,
      classMarks:Array.isArray(conversion.classMarks)?conversion.classMarks.length:0,
      attendanceRecords:Array.isArray(conversion.attendanceRecords)?conversion.attendanceRecords.length:0,
      attendanceGuests:Array.isArray(conversion.attendanceGuests)?conversion.attendanceGuests.length:0,
      attendanceSnapshots:Array.isArray(conversion.attendanceSnapshots)?conversion.attendanceSnapshots.length:0,
      attendanceSnapshotStudents:Array.isArray(conversion.attendanceSnapshotStudents)?conversion.attendanceSnapshotStudents.length:0,
      attendanceSnapshotTeachers:Array.isArray(conversion.attendanceSnapshotTeachers)?conversion.attendanceSnapshotTeachers.length:0,
      disabledSlots:Array.isArray(conversion.disabledSlots)?conversion.disabledSlots.length:0,
      calendarClosures:Array.isArray(conversion.calendarClosures)?conversion.calendarClosures.length:0,
      schedulePeriods:Array.isArray(conversion.schedulePeriods)?conversion.schedulePeriods.length:0,
      scheduleSettings:Array.isArray(conversion.scheduleSettings)?conversion.scheduleSettings.length:0,
      teacherProfiles:Array.isArray(conversion.teacherProfiles)?conversion.teacherProfiles.length:0,
      tabFolders:Array.isArray(conversion.tabFolders)?conversion.tabFolders.length:0,
      archivedTabs:Array.isArray(conversion.archivedTabs)?conversion.archivedTabs.length:0,
      systemMetadata:Array.isArray(conversion.systemMetadata)?conversion.systemMetadata.length:0,
      retirementRecords:Array.isArray(conversion.retirementRecords)?conversion.retirementRecords.length:0,
      deskStudentRecords:Array.isArray(conversion.deskStudentRecords)?conversion.deskStudentRecords.length:0,
    };
  }
  function generationRefs(db,branchId,id){
    const branchRef=db.collection(ROOT_COLLECTION).doc(safeDocId(branchId));
    const generationRef=branchRef.collection('generations').doc(safeDocId(id));
    return {branchRef,generationRef};
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
  function latestReadyFromRows(rows){
    return (Array.isArray(rows)?rows:[])
      .filter(row=>row&&row.status==='ready')
      .sort((a,b)=>text(b.createdAt).localeCompare(text(a.createdAt))||text(b.id).localeCompare(text(a.id)))[0]||null;
  }
  function latestUsableFromRows(rows){
    return (Array.isArray(rows)?rows:[])
      .filter(row=>row&&(row.status==='ready'||row.status==='shadow'))
      .sort((a,b)=>text(b.createdAt).localeCompare(text(a.createdAt))||text(b.id).localeCompare(text(a.id)))[0]||null;
  }
  async function latestReadyGeneration(db,branchId){
    if(!db||typeof db.collection!=='function') throw new Error('Firestore 연결이 필요합니다.');
    const {branchRef}=generationRefs(db,branchId,'preview');
    const snapshot=await branchRef.collection('generations').get();
    return latestReadyFromRows(snapshotRows(snapshot));
  }
  async function latestUsableGeneration(db,branchId){
    if(!db||typeof db.collection!=='function') throw new Error('Firestore 연결이 필요합니다.');
    const {branchRef}=generationRefs(db,branchId,'shadow');
    const snapshot=await branchRef.collection('generations').get();
    return latestUsableFromRows(snapshotRows(snapshot));
  }
  async function readDocsByIds(collection,ids){
    const unique=[...new Set((Array.isArray(ids)?ids:[]).map(text).filter(Boolean))];
    const rows=[];
    for(let offset=0;offset<unique.length;offset+=30){
      const chunk=unique.slice(offset,offset+30);
      const snapshots=await Promise.all(chunk.map(id=>collection.doc(safeDocId(id)).get()));
      snapshots.forEach(doc=>{
        if(!doc?.exists) return;
        const value=doc.data()||{};
        rows.push({...value,id:text(value.id)||text(doc.id)});
      });
    }
    return rows;
  }
  async function readGenerationTabs(db,branchId,id){
    const {generationRef}=generationRefs(db,branchId,id);
    return snapshotRows(await generationRef.collection('tabs').get());
  }
  async function readGenerationTab(db,branchId,id,tabId){
    const {generationRef}=generationRefs(db,branchId,id);
    const targetTab=text(tabId)||'regular';
    const [placementsSnap,assignmentsSnap,attendanceSnap,guestsSnap]=await Promise.all([
      generationRef.collection('placements').where('tabId','==',targetTab).get(),
      generationRef.collection('teacherAssignments').where('tabId','==',targetTab).get(),
      generationRef.collection('attendanceRecords').where('tabId','==',targetTab).get(),
      generationRef.collection('attendanceGuests').where('tabId','==',targetTab).get(),
    ]);
    const placements=snapshotRows(placementsSnap);
    const teacherAssignments=snapshotRows(assignmentsSnap);
    const attendanceRecords=snapshotRows(attendanceSnap);
    const attendanceGuests=snapshotRows(guestsSnap);
    const [people,enrollments]=await Promise.all([
      readDocsByIds(generationRef.collection('people'),placements.map(item=>item.personId)),
      readDocsByIds(generationRef.collection('enrollments'),placements.map(item=>item.enrollmentId)),
    ]);
    return {
      tabId:targetTab,placements,teacherAssignments,people,enrollments,
      attendanceRecords,attendanceGuests,
    };
  }
  function canonicalValue(value){
    if(Array.isArray(value)) return value.map(canonicalValue);
    if(value&&typeof value==='object'){
      const out={};
      Object.keys(value).sort().forEach(key=>{out[key]=canonicalValue(value[key]);});
      return out;
    }
    return value===undefined?null:value;
  }
  function sameDocument(a,b){
    try{return JSON.stringify(canonicalValue(a))===JSON.stringify(canonicalValue(b));}catch(error){return false;}
  }
  function collectionDigest(rows){
    const normalized=(Array.isArray(rows)?rows:[])
      .map(row=>({id:text(row?.id),value:canonicalValue(row?.value)}))
      .sort((a,b)=>a.id.localeCompare(b.id));
    const input=JSON.stringify(normalized);
    let h1=0xdeadbeef^input.length;
    let h2=0x41c6ce57^input.length;
    for(let index=0;index<input.length;index++){
      const code=input.charCodeAt(index);
      h1=Math.imul(h1^code,2654435761);
      h2=Math.imul(h2^code,1597334677);
    }
    h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);
    h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);
    return (h2>>>0).toString(36)+(h1>>>0).toString(36);
  }
  function expectedCollectionDocuments(report,collection,branchId,id){
    return generationDocuments(report)
      .filter(item=>item.collection===collection)
      .map(item=>({
        id:safeDocId(item.id),
        value:{...item.value,generationId:id,branchId:text(branchId)},
      }));
  }
  async function syncShadowGeneration(db,branchId,id,report,options){
    if(!db||typeof db.collection!=='function') throw new Error('Firestore 연결이 필요합니다.');
    if(!report?.checks?.ready) throw new Error('V1 데이터 진단을 통과하지 못해 V2 동기화를 중단했습니다.');
    const opts=options||{};
    const selected=(Array.isArray(opts.collections)&&opts.collections.length?opts.collections:COLLECTIONS)
      .filter(collection=>COLLECTIONS.includes(collection));
    const {generationRef}=generationRefs(db,branchId,id);
    let writes=0;
    let deletes=0;
    const collectionCounts={};
    for(const collection of selected){
      const expected=expectedCollectionDocuments(report,collection,branchId,id);
      const expectedById=new Map(expected.map(item=>[item.id,item.value]));
      const actualById=new Map();
      if(opts.previousReport){
        expectedCollectionDocuments(opts.previousReport,collection,branchId,id)
          .forEach(item=>actualById.set(item.id,item.value));
      }else{
        const actualSnapshot=await generationRef.collection(collection).get();
        actualSnapshot.forEach(doc=>actualById.set(doc.id,doc.data()||{}));
      }
      const operations=[];
      expectedById.forEach((value,docId)=>{
        if(!sameDocument(actualById.get(docId),value)) operations.push({type:'set',docId,value});
      });
      actualById.forEach((value,docId)=>{
        if(!expectedById.has(docId)) operations.push({type:'delete',docId});
      });
      for(let offset=0;offset<operations.length;offset+=WRITE_BATCH_SIZE){
        const batch=db.batch();
        operations.slice(offset,offset+WRITE_BATCH_SIZE).forEach(operation=>{
          const ref=generationRef.collection(collection).doc(operation.docId);
          if(operation.type==='delete'){batch.delete(ref);deletes+=1;}
          else{batch.set(ref,operation.value,{merge:false});writes+=1;}
        });
        await batch.commit();
      }
      collectionCounts[collection]=expectedById.size;
    }
    const counts={...expectedCounts(report)};
    await generationRef.set({
      status:'shadow',
      shadowUpdatedAt:new Date().toISOString(),
      shadowCollections:selected,
      shadowChangedKeys:Array.isArray(opts.changedKeys)?opts.changedKeys.map(text).filter(Boolean):[],
      counts,
    },{merge:true});
    return {generationId:id,status:'shadow',collections:selected,writes,deletes,counts,collectionCounts};
  }
  async function syncShadowSnapshotScopes(db,branchId,id,report,scopes,options){
    if(!db||typeof db.collection!=='function') throw new Error('Firestore 연결이 필요합니다.');
    if(!report?.checks?.ready) throw new Error('V1 데이터 진단을 통과하지 못해 V2 동기화를 중단했습니다.');
    const {generationRef}=generationRefs(db,branchId,id);
    const unique=new Map();
    (Array.isArray(scopes)?scopes:[]).forEach(scope=>{
      if(!scope?.snapshotId) return;
      unique.set(text(scope.snapshotId),{
        snapshotId:text(scope.snapshotId),tabId:text(scope.tabId),date:text(scope.date),
      });
    });
    let writes=0;
    let deletes=0;
    for(const scope of unique.values()){
      for(const collection of ['attendanceSnapshots','attendanceSnapshotStudents','attendanceSnapshotTeachers']){
        const expected=expectedCollectionDocuments(report,collection,branchId,id).filter(item=>{
          if(collection==='attendanceSnapshots') return text(item.value.id)===scope.snapshotId;
          return text(item.value.snapshotId)===scope.snapshotId;
        });
        const expectedById=new Map(expected.map(item=>[item.id,item.value]));
        const actualById=new Map();
        if(collection==='attendanceSnapshots'){
          const doc=await generationRef.collection(collection).doc(safeDocId(scope.snapshotId)).get();
          if(doc?.exists) actualById.set(doc.id,doc.data()||{});
        }else{
          const snapshot=await generationRef.collection(collection).where('snapshotId','==',scope.snapshotId).get();
          snapshot.forEach(doc=>actualById.set(doc.id,doc.data()||{}));
        }
        const operations=[];
        expectedById.forEach((value,docId)=>{
          if(!sameDocument(actualById.get(docId),value)) operations.push({type:'set',docId,value});
        });
        actualById.forEach((value,docId)=>{
          if(!expectedById.has(docId)) operations.push({type:'delete',docId});
        });
        for(let offset=0;offset<operations.length;offset+=WRITE_BATCH_SIZE){
          const batch=db.batch();
          operations.slice(offset,offset+WRITE_BATCH_SIZE).forEach(operation=>{
            const ref=generationRef.collection(collection).doc(operation.docId);
            if(operation.type==='delete'){batch.delete(ref);deletes+=1;}
            else{batch.set(ref,operation.value,{merge:false});writes+=1;}
          });
          await batch.commit();
        }
      }
    }
    await generationRef.set({
      status:'shadow',
      shadowSnapshotUpdatedAt:new Date().toISOString(),
      shadowChangedKeys:Array.isArray(options?.changedKeys)?options.changedKeys.map(text).filter(Boolean):[],
    },{merge:true});
    return {generationId:id,status:'shadow',scopes:unique.size,writes,deletes};
  }
  async function verifyGeneration(db,branchId,id,expected,expectedDocuments){
    const {generationRef}=generationRefs(db,branchId,id);
    const actual={};
    const actualDigests={};
    const expectedDigests={};
    for(const collection of COLLECTIONS){
      const snapshot=await generationRef.collection(collection).get();
      actual[collection]=Number(snapshot?.size)||0;
      const actualRows=[];
      snapshot.forEach(doc=>actualRows.push({id:doc.id,value:doc.data()||{}}));
      actualDigests[collection]=collectionDigest(actualRows);
      if(Array.isArray(expectedDocuments)){
        const expectedRows=expectedDocuments
          .filter(item=>item.collection===collection)
          .map(item=>({
            id:safeDocId(item.id),
            value:{...item.value,generationId:id,branchId:text(branchId)},
          }));
        expectedDigests[collection]=collectionDigest(expectedRows);
      }
    }
    const countMatches=COLLECTIONS.every(collection=>actual[collection]===Number(expected?.[collection]||0));
    const contentMatches=!Array.isArray(expectedDocuments)
      ||COLLECTIONS.every(collection=>actualDigests[collection]===expectedDigests[collection]);
    const mismatchedCollections=COLLECTIONS.filter(collection=>
      actual[collection]!==Number(expected?.[collection]||0)
      ||(Array.isArray(expectedDocuments)&&actualDigests[collection]!==expectedDigests[collection])
    );
    return {
      matches:countMatches&&contentMatches,countMatches,contentMatches,mismatchedCollections,
      expected:{...expected},actual,expectedDigests,actualDigests,
    };
  }
  async function writeGeneration(db,branchId,report,options){
    if(!db||typeof db.collection!=='function') throw new Error('Firestore 연결이 필요합니다.');
    if(!report?.checks?.ready) throw new Error('진단을 통과한 데이터만 V2 구조로 만들 수 있습니다.');
    const opts=options||{};
    const id=text(opts.generationId)||generationId();
    const {generationRef}=generationRefs(db,branchId,id);
    const counts=expectedCounts(report);
    const docs=generationDocuments(report);
    const createdAt=new Date().toISOString();
    await generationRef.set({
      id,
      branchId:text(branchId),
      schemaVersion:2,
      status:'writing',
      createdAt,
      baselineCreatedAt:text(opts.baselineCreatedAt),
      sourceBuildVersion:text(opts.sourceBuildVersion),
      rollbackPolicy:text(opts.rollbackPolicy)||'return-to-v1-baseline',
      counts,
    },{merge:false});
    let written=0;
    try{
      for(let offset=0;offset<docs.length;offset+=WRITE_BATCH_SIZE){
        const batch=db.batch();
        docs.slice(offset,offset+WRITE_BATCH_SIZE).forEach(item=>{
          const ref=generationRef.collection(item.collection).doc(safeDocId(item.id));
          batch.set(ref,{...item.value,generationId:id,branchId:text(branchId)},{merge:false});
        });
        await batch.commit();
        written=Math.min(offset+WRITE_BATCH_SIZE,docs.length);
        if(typeof opts.onProgress==='function') opts.onProgress({written,total:docs.length,generationId:id});
      }
      const verification=await verifyGeneration(db,branchId,id,counts,docs);
      if(!verification.matches){
        await generationRef.set({status:'invalid',verification,verifiedAt:new Date().toISOString()},{merge:true});
        throw new Error('V2 문서 수 검증에 실패했습니다.');
      }
      await generationRef.set({
        status:'ready',
        verification,
        verifiedAt:new Date().toISOString(),
      },{merge:true});
      return {generationId:id,written,counts,verification,status:'ready'};
    }catch(error){
      try{
        await generationRef.set({
          status:'failed',
          failedAt:new Date().toISOString(),
          error:String(error?.message||error),
          written,
        },{merge:true});
      }catch(ignore){}
      throw error;
    }
  }

  global.SCScheduleV2Store=Object.freeze({
    ROOT_COLLECTION,
    WRITE_BATCH_SIZE,
    COLLECTIONS,
    safeDocId,
    generationId,
    generationDocuments,
    expectedCounts,
    snapshotRows,
    latestReadyFromRows,
    latestUsableFromRows,
    latestReadyGeneration,
    latestUsableGeneration,
    readGenerationTabs,
    readGenerationTab,
    expectedCollectionDocuments,
    sameDocument,
    collectionDigest,
    syncShadowGeneration,
    syncShadowSnapshotScopes,
    verifyGeneration,
    writeGeneration,
  });
})(typeof window!=='undefined'?window:globalThis);
