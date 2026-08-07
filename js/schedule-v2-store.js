(function(global){
  'use strict';

  const ROOT_COLLECTION='scheduleV2';

  function text(value){return String(value==null?'':value).trim();}
  function safeDocId(value){
    return encodeURIComponent(text(value)).replace(/\./g,'%2E')||'missing';
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
  function readyCapability(row,domain){
    const capability=row?.capabilities?.[domain];
    const appliedRevision=Number(capability?.appliedRevision);
    if(!!capability
      &&capability.status==='ready'
      &&Number.isSafeInteger(appliedRevision)
      &&appliedRevision>=0
      &&!!text(capability.verifiedAt)) return true;
    if(domain!=='attendance'||row?.capabilities||row?.status!=='ready'||!text(row?.verifiedAt)) return false;
    const verification=row?.verification;
    const expected=verification?.expected;
    const attendanceCollections=[
      'attendanceRecords','attendanceGuests','attendanceSnapshots',
      'attendanceSnapshotStudents','attendanceSnapshotTeachers',
    ];
    return verification?.matches===true
      &&verification?.countMatches===true
      &&verification?.contentMatches===true
      &&expected&&attendanceCollections.every(name=>Object.prototype.hasOwnProperty.call(expected,name));
  }
  function latestDomainReadyFromRows(rows,domain){
    return (Array.isArray(rows)?rows:[])
      .filter(row=>row&&readyCapability(row,domain))
      .sort((a,b)=>text(b.createdAt).localeCompare(text(a.createdAt))||text(b.id).localeCompare(text(a.id)))[0]||null;
  }
  function latestScheduleReadyFromRows(rows){
    return latestDomainReadyFromRows(rows,'schedule');
  }
  function latestAttendanceReadyFromRows(rows){
    return latestDomainReadyFromRows(rows,'attendance');
  }
  async function latestDomainReadyGeneration(db,branchId,domain){
    if(!db||typeof db.collection!=='function') throw new Error('Firestore connection is required');
    const {branchRef}=generationRefs(db,branchId,domain);
    const rows=snapshotRows(await branchRef.collection('generations').get());
    return latestDomainReadyFromRows(rows,domain);
  }
  function latestScheduleReadyGeneration(db,branchId){
    return latestDomainReadyGeneration(db,branchId,'schedule');
  }
  function latestAttendanceReadyGeneration(db,branchId){
    return latestDomainReadyGeneration(db,branchId,'attendance');
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
    try{return JSON.stringify(canonicalValue(a))===JSON.stringify(canonicalValue(b));}
    catch(error){return false;}
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

  global.SCScheduleV2Store=Object.freeze({
    ROOT_COLLECTION,
    safeDocId,
    snapshotRows,
    latestScheduleReadyFromRows,
    latestAttendanceReadyFromRows,
    latestScheduleReadyGeneration,
    latestAttendanceReadyGeneration,
    readGenerationTabs,
    readGenerationTab,
    sameDocument,
    collectionDigest,
  });
})(typeof window!=='undefined'?window:globalThis);
