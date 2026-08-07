"use strict";

const policy=require("./schedule-v2-shadow-policy.js");

require("./shared/schedule-time.js");
require("./shared/schedule-schema-v2.js");

const ROOT_COLLECTION="scheduleV2";
const WRITE_BATCH_SIZE=350;
const RESERVATION_KEYS=Object.freeze([
  "swim_retire","swim_enroll","swim_hyuwon","swim_move",
]);
const METADATA_KEYS=Object.freeze([
  "swim_age_year","swim_student_id_version","swim_ver",
]);
const GLOBAL_LEGACY_KEYS=Object.freeze([
  "swim_parent_tab","swim_teachers","swim_tab_folders","swim_archived_tabs",
  "swim_age_year","swim_student_id_version","swim_ver","swim_reserve",
  "swim_mark","swim_disabled","swim_closed","swim_periods",
  "swim_retire_history","swim_desk_notes",
]);
const TAB_SCOPED_COLLECTIONS=new Set([
  "enrollments","placements","teacherAssignments",
]);
const SAFE_ERROR_CODES=new Set([
  "aborted","already-exists","cancelled","data-loss","deadline-exceeded",
  "failed-precondition","internal","invalid-argument","not-found","out-of-range",
  "permission-denied","resource-exhausted","unauthenticated","unavailable",
  "unimplemented","unknown","invalid-firestore","conversion-mismatch",
  "verification-mismatch","stale-run",
]);

function text(value){
  return String(value==null?"":value).trim();
}

function tabLegacyKeys(tabMetadata){
  const students=[];
  const teachers=[];
  (Array.isArray(tabMetadata)?tabMetadata:[]).forEach(tab=>{
    const tabId=text(tab?.id)||"regular";
    if(tab?.type==="bangteuk"){
      students.push(`swim_bt_${tabId}_stu`);
      teachers.push(`swim_bt_${tabId}_inst`);
    }else{
      students.push(tabId==="regular"?"swim_students":`swim_stu_${tabId}`);
      teachers.push(tabId==="regular"?"swim_inst":`swim_inst_${tabId}`);
    }
  });
  return {students,teachers};
}

function requiredLegacyKeys(keys,tabMetadata){
  const required=new Set(["swim_tab_list","swim_main_tab"]);
  const changed=(Array.isArray(keys)?keys:[]).map(text).filter(policy.isTrackedKey);
  changed.forEach(key=>required.add(key));
  const selected=new Set(selectedCollections(changed));
  const tabKeys=tabLegacyKeys(tabMetadata);
  if(changed.includes("swim_tab_list")){
    [...tabKeys.students,...tabKeys.teachers,...GLOBAL_LEGACY_KEYS,...RESERVATION_KEYS]
      .forEach(key=>required.add(key));
  }
  if(selected.has("reservations")){
    RESERVATION_KEYS.forEach(key=>required.add(key));
    tabKeys.students.forEach(key=>required.add(key));
    required.add("swim_periods");
  }
  if(hasTabKey(changed,"student")){
    tabKeys.students.forEach(key=>required.add(key));
  }
  if(selected.has("waitlistEntries")){
    required.add("swim_reserve");
    required.add("swim_periods");
  }
  if(selected.has("scheduleSettings")){
    required.add("swim_parent_tab");
  }
  if(selected.has("systemMetadata")){
    METADATA_KEYS.forEach(key=>required.add(key));
  }
  if(selected.has("classMarks")){
    [...tabKeys.students,...tabKeys.teachers,"swim_mark","swim_periods"]
      .forEach(key=>required.add(key));
  }
  if(selected.has("disabledSlots")){
    [...tabKeys.students,...tabKeys.teachers,"swim_disabled"]
      .forEach(key=>required.add(key));
  }
  if(selected.has("retirementRecords")){
    required.add("swim_retire_history");
    required.add("swim_periods");
  }
  if(selected.has("deskStudentRecords")){
    required.add("swim_desk_notes");
    required.add("swim_periods");
  }
  return [...required];
}

function safeDocId(value){
  return encodeURIComponent(text(value)).replace(/\./g,"%2E")||"missing";
}

function canonicalValue(value){
  if(Array.isArray(value)) return value.map(canonicalValue);
  if(value&&typeof value==="object"){
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

function coded(code){
  return Object.assign(new Error(code),{code});
}

function sanitizedError(error){
  let code="unknown";
  try{code=text(error?.code).replace(/^functions\//,"").toLowerCase()||"unknown";}
  catch(ignore){}
  return coded(SAFE_ERROR_CODES.has(code)?code:"unknown");
}

function parsedTabs(value){
  if(Array.isArray(value)) return value;
  if(typeof value!=="string") return [];
  try{
    const parsed=JSON.parse(value);
    return Array.isArray(parsed)?parsed:[];
  }catch(error){
    return [];
  }
}

function affectedTabIds(keys,tabs,kind){
  const ids=new Set();
  const metadata=Array.isArray(tabs)?tabs:[];
  (Array.isArray(keys)?keys:[]).forEach(rawKey=>{
    const key=text(rawKey);
    metadata.forEach(tab=>{
      const tabId=text(tab?.id)||"regular";
      const studentKey=tab?.type==="bangteuk"?`swim_bt_${tabId}_stu`:(tabId==="regular"?"swim_students":`swim_stu_${tabId}`);
      const teacherKey=tab?.type==="bangteuk"?`swim_bt_${tabId}_inst`:(tabId==="regular"?"swim_inst":`swim_inst_${tabId}`);
      if((kind==="student"&&key===studentKey)||(kind==="teacher"&&key===teacherKey)) ids.add(tabId);
    });
  });
  return ids;
}

function collectionTabIds(collection,keys,tabs){
  if(collection==="people"||collection==="enrollments"||collection==="placements"){
    return affectedTabIds(keys,tabs,"student");
  }
  if(collection==="teacherAssignments") return affectedTabIds(keys,tabs,"teacher");
  return new Set();
}

function hasTabKey(keys,kind){
  return (Array.isArray(keys)?keys:[]).some(key=>{
    if(kind==="student") return key==="swim_students"||/^swim_stu_/.test(key)||/^swim_bt_.+_stu$/.test(key);
    return key==="swim_inst"||/^swim_inst_/.test(key)||/^swim_bt_.+_inst$/.test(key);
  });
}

function selectedCollections(keys){
  const selected=[];
  const seen=new Set();
  (Array.isArray(keys)?keys:[]).forEach(key=>{
    policy.collectionsForKey(key).forEach(collection=>{
      if(seen.has(collection)) return;
      seen.add(collection);
      selected.push(collection);
    });
  });
  return selected;
}

function snapshotRows(snapshot){
  const rows=[];
  snapshot?.forEach?.(doc=>rows.push({id:doc.id,value:doc.data()||{}}));
  return rows;
}

async function readPeopleScope(collection,ids){
  const rows=[];
  for(const id of ids){
    const doc=await collection.doc(safeDocId(id)).get();
    if(doc?.exists) rows.push({id:doc.id,value:doc.data()||{}});
  }
  return rows;
}

async function readCollectionScope(collectionRef,collection,tabIds,personIds,fullGeneration){
  if(fullGeneration) return snapshotRows(await collectionRef.get());
  if(collection==="people") return readPeopleScope(collectionRef,personIds);
  if(TAB_SCOPED_COLLECTIONS.has(collection)&&tabIds.size){
    const rows=[];
    for(const tabId of tabIds){
      rows.push(...snapshotRows(await collectionRef.where("tabId","==",tabId).get()));
    }
    return rows;
  }
  return snapshotRows(await collectionRef.get());
}

function scopedDesired(conversion,collection,tabIds){
  const source=Array.isArray(conversion?.[collection])?conversion[collection]:[];
  if(TAB_SCOPED_COLLECTIONS.has(collection)&&tabIds.size){
    return source.filter(row=>tabIds.has(text(row?.tabId)));
  }
  if(collection==="people"&&tabIds.size){
    const personIds=new Set((Array.isArray(conversion?.placements)?conversion.placements:[])
      .filter(row=>tabIds.has(text(row?.tabId)))
      .map(row=>text(row?.personId)));
    return source.filter(row=>personIds.has(text(row?.id)));
  }
  return source;
}

function sameIds(left,right){
  if(left.size!==right.size) return false;
  for(const id of left.keys()) if(!right.has(id)) return false;
  return true;
}

function normalizedFence(db,value){
  const leaseId=text(value?.leaseId);
  if(!value?.ref||typeof value.ref.path!=="string"||!leaseId||typeof db.runTransaction!=="function"){
    throw coded("invalid-argument");
  }
  return {ref:value.ref,leaseId};
}

async function assertFence(transaction,fence){
  const snapshot=await transaction.get(fence.ref);
  if(!snapshot?.exists||text(snapshot.data()?.leaseId)!==fence.leaseId) throw coded("stale-run");
}

async function commitOperations(db,collectionRef,operations,fence){
  await db.runTransaction(async transaction=>{
    await assertFence(transaction,fence);
    operations.forEach(operation=>{
      const ref=collectionRef.doc(operation.id);
      if(operation.type==="delete") transaction.delete(ref);
      else transaction.set(ref,operation.value,{merge:false});
    });
  });
}

async function verifyFence(db,fence){
  await db.runTransaction(transaction=>assertFence(transaction,fence));
}

async function collectionRows(generationRef,name,heartbeat){
  await heartbeat();
  return snapshotRows(await generationRef.collection(name).get());
}

async function verifyReferences(generationRef,heartbeat){
  const tabs=await collectionRows(generationRef,"tabs",heartbeat);
  const people=await collectionRows(generationRef,"people",heartbeat);
  const enrollments=await collectionRows(generationRef,"enrollments",heartbeat);
  const placements=await collectionRows(generationRef,"placements",heartbeat);
  const assignments=await collectionRows(generationRef,"teacherAssignments",heartbeat);
  const tabIds=new Set(tabs.map(row=>text(row.value?.id||row.id)));
  const personIds=new Set(people.map(row=>text(row.value?.id||row.id)));
  const enrollmentById=new Map(enrollments.map(row=>[
    text(row.value?.id||row.id),row.value,
  ]));

  for(const row of enrollments){
    const value=row.value||{};
    if(!personIds.has(text(value.personId))||!tabIds.has(text(value.tabId))){
      throw coded("verification-mismatch");
    }
  }
  for(const row of placements){
    const value=row.value||{};
    const enrollment=enrollmentById.get(text(value.enrollmentId));
    if(!personIds.has(text(value.personId))||!enrollment||!tabIds.has(text(value.tabId))){
      throw coded("verification-mismatch");
    }
    if(text(enrollment.personId)!==text(value.personId)||text(enrollment.tabId)!==text(value.tabId)){
      throw coded("verification-mismatch");
    }
  }
  for(const row of assignments){
    if(!tabIds.has(text(row.value?.tabId))||!text(row.value?.teacherName)){
      throw coded("verification-mismatch");
    }
  }
}

async function runShadowSyncUnsafe(input){
  const source=input&&typeof input==="object"?input:{};
  const {db,readLegacyKey}=source;
  const branchId=text(source.branchId);
  const generationId=text(source.generationId);
  const keys=(Array.isArray(source.keys)?source.keys:[]).map(text).filter(policy.isTrackedKey);
  const fullGeneration=source.fullGeneration===true;
  const heartbeat=typeof source.heartbeat==="function"?source.heartbeat:async()=>{};
  if(!db||typeof db.collection!=="function") throw coded("invalid-firestore");
  if(!branchId||!generationId||typeof readLegacyKey!=="function") throw coded("invalid-argument");

  if(!keys.length) return {collections:[],writes:0,deletes:0,counts:{},digests:{}};
  const fence=normalizedFence(db,source.fence);

  const legacyRoot={};
  await heartbeat();
  legacyRoot.swim_tab_list=await readLegacyKey("swim_tab_list");
  const tabs=parsedTabs(legacyRoot.swim_tab_list);
  for(const key of requiredLegacyKeys(keys,tabs)){
    if(key==="swim_tab_list") continue;
    await heartbeat();
    const value=await readLegacyKey(key);
    if(value!==null&&value!==undefined) legacyRoot[key]=value;
  }

  const schema=globalThis.SCScheduleSchemaV2;
  const report=schema.diagnoseLegacyRoot(branchId,legacyRoot);
  if(!report.checks.ready) throw coded("conversion-mismatch");

  const collections=selectedCollections(keys);
  const convertedTabs=report.bundle?.tabs||tabs;
  if(!keys.includes("swim_tab_list")){
    if(hasTabKey(keys,"student")&&!affectedTabIds(keys,convertedTabs,"student").size){
      throw coded("conversion-mismatch");
    }
    if(hasTabKey(keys,"teacher")&&!affectedTabIds(keys,convertedTabs,"teacher").size){
      throw coded("conversion-mismatch");
    }
  }
  const generationRef=db.collection(ROOT_COLLECTION).doc(safeDocId(branchId))
    .collection("generations").doc(safeDocId(generationId));
  const counts={};
  const digests={};
  let writes=0;
  let deletes=0;

  for(const collection of collections){
    const tabIds=fullGeneration?new Set():collectionTabIds(collection,keys,convertedTabs);
    const desired=scopedDesired(report.conversion,collection,tabIds);
    const expectedRows=desired.filter(row=>text(row?.id)).map(row=>({
      id:safeDocId(row.id),
      value:{...row,generationId,branchId},
    }));
    const expectedById=new Map(expectedRows.map(row=>[row.id,row.value]));
    const personIds=collection==="people"?desired.map(row=>text(row.id)):[];
    const collectionRef=generationRef.collection(collection);
    await heartbeat();
    const existingRows=await readCollectionScope(collectionRef,collection,tabIds,personIds,fullGeneration);
    const existingById=new Map(existingRows.map(row=>[row.id,row.value]));
    const operations=[];
    expectedById.forEach((value,id)=>{
      if(!sameDocument(existingById.get(id),value)) operations.push({type:"set",id,value});
    });
    if(collection!=="people"||fullGeneration){
      existingById.forEach((value,id)=>{
        if(!expectedById.has(id)) operations.push({type:"delete",id});
      });
    }

    for(let offset=0;offset<operations.length;offset+=WRITE_BATCH_SIZE){
      const chunk=operations.slice(offset,offset+WRITE_BATCH_SIZE);
      await heartbeat();
      await commitOperations(db,collectionRef,chunk,fence);
      writes+=chunk.filter(operation=>operation.type==="set").length;
      deletes+=chunk.filter(operation=>operation.type==="delete").length;
    }

    await heartbeat();
    const actualRows=await readCollectionScope(collectionRef,collection,tabIds,personIds,fullGeneration);
    const actualById=new Map(actualRows.map(row=>[row.id,row.value]));
    const expectedDigest=collectionDigest(expectedRows);
    const actualDigest=collectionDigest(actualRows);
    if(actualRows.length!==expectedRows.length||!sameIds(expectedById,actualById)||expectedDigest!==actualDigest){
      throw coded("verification-mismatch");
    }
    counts[collection]=actualRows.length;
    digests[collection]=actualDigest;
  }

  await verifyReferences(generationRef,heartbeat);
  await heartbeat();
  await verifyFence(db,fence);
  return {collections,writes,deletes,counts,digests};
}

async function runShadowSync(input){
  try{return await runShadowSyncUnsafe(input);}
  catch(error){throw sanitizedError(error);}
}

module.exports={requiredLegacyKeys,runShadowSync};
