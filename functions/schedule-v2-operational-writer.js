"use strict";

const crypto=require("node:crypto");
const policy=require("./schedule-v2-operational-policy.js");

require("./shared/schedule-time.js");
require("./shared/schedule-schema-v2.js");
require("./schedule-v2-operational-model.js");

const model=globalThis.SCV2OperationalModel;
const schema=globalThis.SCScheduleSchemaV2;
const ROOT_COLLECTION="scheduleV2";
const LEGACY_COLLECTION="scheduleStores";
const DOCUMENT_CHUNK_SIZE=400;
const LEGACY_CHUNK_THRESHOLD=650000;
const LEGACY_CHUNK_SIZE=600000;
const MAX_DOCUMENT_CHANGES=2000;
const MAX_DOCUMENT_ID_BYTES=1500;
const MAX_ESTIMATED_DOCUMENT_BYTES=900000;
const MAX_RECOVERY_ATTEMPTS=10;
const DEFAULT_RECOVERY_LIMIT=10;
const RECOVERY_LEASE_MS=4*60*1000;
const REQUEST_RECOVERY_VERSION=1;
const REQUEST_RECOVERY_MAX_ATTEMPTS=5;
const REQUEST_RECOVERY_LIMIT=20;
const REQUEST_RECOVERY_LEASE_MS=4*60*1000;
const REQUEST_RECOVERY_EXPIRY_MS=24*60*60*1000;
const REQUEST_RECOVERY_TERMINAL_RETENTION_MS=7*24*60*60*1000;
const REQUEST_RECOVERY_MAX_PAGES=10;
const REQUEST_RECOVERY_STATES=new Set(["staged","waiting-primary","processing","error","completed","conflict","cancelled","rejected"]);
const REQUEST_RECOVERY_CODES=new Set(["","primary-pending","primary-expired","manifest-mismatch","request-conflict","retry-exhausted","invalid-record"]);
const BRANCH_IDS=Object.freeze(["gagyeong","yongam"]);
const COLLECTIONS=Object.freeze(Object.values(model.DOMAIN_COLLECTIONS).flat());
const COLLECTION_SET=new Set(COLLECTIONS);
const SNAPSHOT_COLLECTIONS=new Set([
  "attendanceSnapshots","attendanceSnapshotStudents","attendanceSnapshotTeachers",
]);
const SAFE_ERROR_CODES=new Set([
  "aborted","already-exists","cancelled","data-loss","deadline-exceeded",
  "failed-precondition","internal","invalid-argument","not-found","out-of-range",
  "permission-denied","resource-exhausted","unauthenticated","unavailable",
  "unimplemented","unknown",
]);

function fail(code){
  throw Object.assign(new Error(code),{code});
}

function text(value){
  return String(value==null?"":value).trim();
}

function clone(value){
  return value===undefined?undefined:JSON.parse(JSON.stringify(value));
}

function plainObject(value){
  if(!value||typeof value!=="object"||Array.isArray(value)) return false;
  const prototype=Object.getPrototypeOf(value);
  return prototype===Object.prototype||prototype===null;
}

function safeDocId(value){
  return encodeURIComponent(text(value)).replace(/\./g,"%2E");
}

function estimatedBytes(value){
  try{return Buffer.byteLength(JSON.stringify(value),"utf8");}
  catch(error){fail("invalid-argument");}
}

function canonical(value){
  if(Array.isArray(value)) return value.map(canonical);
  if(!plainObject(value)) return value;
  const result={};
  Object.keys(value).sort().forEach(key=>{
    if(value[key]!==undefined) result[key]=canonical(value[key]);
  });
  return result;
}

function digest(value){
  return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function requestFingerprint(request){
  return digest({
    branchId:request.branchId,generationId:request.generationId,
    expectedEpoch:request.expectedEpoch,operationId:request.operationId,
    operationType:request.operationType,keys:request.keys.slice().sort(),
    beforeRevision:request.beforeRevision,nextValues:request.nextValues,
    removedKeys:request.removedKeys.slice().sort(),
  });
}

function actorId(actor){
  return crypto.createHash("sha256").update(text(actor?.email).toLowerCase()).digest("hex").slice(0,24);
}

function runtimeRef(db,branchId){
  return db.collection(ROOT_COLLECTION).doc(branchId).collection("runtime").doc("operational");
}

function mutationRef(db,branchId,operationId){
  return db.collection(ROOT_COLLECTION).doc(branchId).collection("operationalMutations").doc(operationId);
}

function requestRecoveryRef(db,branchId,operationId){
  return db.collection(ROOT_COLLECTION).doc(branchId).collection("requestRecoveries").doc(operationId);
}

function recoveryFenceRef(db,branchId){
  return db.collection(ROOT_COLLECTION).doc(branchId).collection("runtime").doc("operationalRecovery");
}

function generationRef(db,branchId,generationId){
  return db.collection(ROOT_COLLECTION).doc(branchId).collection("generations").doc(generationId);
}

function generationDocumentRef(db,request,change){
  return generationRef(db,request.branchId,request.generationId)
    .collection(change.collection).doc(safeDocId(change.id));
}

function legacyKeyRef(db,branchId,key){
  return db.collection(LEGACY_COLLECTION).doc(branchId).collection("kv").doc(safeDocId(key));
}

function legacyChunkRef(db,branchId,key,index){
  return legacyKeyRef(db,branchId,key).collection("chunks").doc(String(index).padStart(4,"0"));
}

function normalizeNow(value){
  const now=value instanceof Date?value:new Date(value);
  return Number.isNaN(now.getTime())?new Date():now;
}

function serverTime(input){
  return typeof input.serverTimestamp==="function"?input.serverTimestamp():normalizeNow(input.now).toISOString();
}

function normalizedError(error){
  const code=text(error?.code).replace(/^functions\//,"").toLowerCase();
  const safeCode=SAFE_ERROR_CODES.has(code)?code:"unknown";
  return Object.assign(new Error(safeCode),{code:safeCode});
}

function assertRuntime(runtime,request,operationId){
  if(!runtime||!["v2-read","v2"].includes(text(runtime.mode))) fail("failed-precondition");
  if(text(runtime.branchId)&&text(runtime.branchId)!==request.branchId) fail("failed-precondition");
  if(text(runtime.generationId)!==request.generationId) fail("failed-precondition");
  if(Number(runtime.epoch)!==request.expectedEpoch) fail("failed-precondition");
  if(Number(runtime.revision||0)!==request.beforeRevision) fail("failed-precondition");
  const active=text(runtime.activeOperationId);
  if(active&&active!==operationId) fail("aborted");
}

function resultFromManifest(manifest){
  if(!plainObject(manifest?.result)) return null;
  return clone(manifest.result);
}

function assertManifestFingerprint(manifest,fingerprint){
  if(manifest&&text(manifest.requestFingerprint)!==fingerprint) fail("already-exists");
}

function normalizeChange(change){
  if(!plainObject(change)||!["set","delete"].includes(change.type)||
      !COLLECTION_SET.has(text(change.collection))||
      !/^[^/]{1,512}$/.test(text(change.id))) fail("invalid-argument");
  if(change.type==="set"&&!plainObject(change.value)) fail("invalid-argument");
  return {
    type:change.type,collection:text(change.collection),id:text(change.id),
    ...(change.type==="set"?{value:clone(change.value)}:{}),
    ...(Object.prototype.hasOwnProperty.call(change,"beforeExists")?{beforeExists:change.beforeExists===true}:{}),
    ...(text(change.beforeDigest)?{beforeDigest:text(change.beforeDigest)}:{}),
  };
}

function changeCounts(changes){
  return {
    changeCount:changes.length,
    setCount:changes.filter(change=>change.type==="set").length,
    deleteCount:changes.filter(change=>change.type==="delete").length,
  };
}

function baseManifest(input,counts,chunkCount){
  const request=input.request;
  return {
    operationId:request.operationId,
    branchId:request.branchId,
    generationId:request.generationId,
    expectedEpoch:request.expectedEpoch,
    beforeRevision:request.beforeRevision,
    resultingRevision:request.beforeRevision+1,
    operationType:request.operationType,
    keys:request.keys.slice(),
    removedKeys:request.removedKeys.slice(),
    requestFingerprint:input.fingerprint,
    actorRole:text(input.actor?.role),
    actorId:actorId(input.actor),
    status:"committing",
    recoveryState:"blocked",
    recoveryAttempts:0,
    chunkCount,
    changedDocumentRefs:input.changedDocumentRefs,
    deletedDocumentRefs:input.deletedDocumentRefs,
    snapshotHeaderIds:input.snapshotHeaderIds,
    snapshotCompletionCount:input.snapshotHeaderIds.length,
    completedSnapshotHeaders:0,
    ...counts,
  };
}

function assertWriteSizes(input,changes,counts,chunkCount){
  for(const key of input.request.keys||[]){
    if(Buffer.byteLength(safeDocId(key),"utf8")>MAX_DOCUMENT_ID_BYTES) fail("invalid-argument");
  }
  for(const change of changes){
    const documentId=safeDocId(change.id);
    if(Buffer.byteLength(documentId,"utf8")>MAX_DOCUMENT_ID_BYTES) fail("invalid-argument");
    if(change.type==="set"){
      const stored={
        ...change.value,
        branchId:input.request.branchId,
        generationId:input.request.generationId,
        operationalRevision:input.request.beforeRevision+1,
        lastOperationId:input.request.operationId,
      };
      if(estimatedBytes(stored)>MAX_ESTIMATED_DOCUMENT_BYTES) fail("resource-exhausted");
    }
  }
  const manifestEstimate={
    ...baseManifest(input,counts,chunkCount),
    completedChunks:chunkCount,
    startedAt:input.now.toISOString(),
    updatedAt:input.now.toISOString(),
    committedAt:input.now.toISOString(),
    result:{
      operationId:input.request.operationId,committed:true,
      revision:input.request.beforeRevision+1,...counts,recoveryState:"pending",
    },
  };
  if(estimatedBytes(manifestEstimate)>MAX_ESTIMATED_DOCUMENT_BYTES) fail("resource-exhausted");
}

function assertFinalManifestSize(input,manifest,counts){
  const estimate={
    ...manifest,status:"committed",recoveryState:"pending",
    committedAt:input.now.toISOString(),updatedAt:input.now.toISOString(),
    result:{
      operationId:input.request.operationId,committed:true,
      revision:input.request.beforeRevision+1,...counts,recoveryState:"pending",
    },
  };
  if(estimatedBytes(estimate)>MAX_ESTIMATED_DOCUMENT_BYTES) fail("resource-exhausted");
}

async function commitChangeChunk(input,changes,chunkIndex,chunkCount,counts){
  const {db,request,fingerprint}=input;
  const operationId=request.operationId;
  const runtimeDocument=runtimeRef(db,request.branchId);
  const manifestDocument=mutationRef(db,request.branchId,operationId);
  await db.runTransaction(async tx=>{
    const runtimeSnapshot=await tx.get(runtimeDocument);
    const manifestSnapshot=await tx.get(manifestDocument);
    const recoveryFenceSnapshot=await tx.get(recoveryFenceRef(db,request.branchId));
    const currentManifest=manifestSnapshot.exists?manifestSnapshot.data()||{}:null;
    assertManifestFingerprint(currentManifest,fingerprint);
    if(currentManifest?.status==="committed") return;
    assertRuntime(runtimeSnapshot.data()||{},request,operationId);
    if(leaseExpiry(recoveryFenceSnapshot.data()?.recoveryLeaseUntil)>input.now.getTime()) fail("aborted");

    const documentSnapshots=[];
    for(const change of changes){
      const ref=generationDocumentRef(db,request,change);
      documentSnapshots.push({change,ref,snapshot:await tx.get(ref)});
    }
    documentSnapshots.forEach(({change,snapshot})=>{
      const current=snapshot.exists?snapshot.data()||{}:null;
      const currentRevision=Number(current?.operationalRevision||0);
      const sameOperation=text(current?.lastOperationId)===operationId&&currentRevision===request.beforeRevision+1;
      if(SNAPSHOT_COLLECTIONS.has(change.collection)){
        if(request.operationType!=="attendance-snapshot"||change.type==="delete") fail("failed-precondition");
        if(snapshot.exists&&!sameOperation) fail("failed-precondition");
      }
      if(currentRevision>request.beforeRevision&&!sameOperation) fail("failed-precondition");
      if(Object.prototype.hasOwnProperty.call(change,"beforeExists")&&!sameOperation){
        if(change.beforeExists!==snapshot.exists) fail("aborted");
        if(change.beforeDigest&&digest(current)!==change.beforeDigest) fail("aborted");
      }
    });

    const nowValue=serverTime(input);
    documentSnapshots.forEach(({change,ref})=>{
      if(change.type==="delete"){
        tx.delete(ref);
      }else{
        tx.set(ref,{
          ...change.value,
          branchId:request.branchId,
          generationId:request.generationId,
          operationalRevision:request.beforeRevision+1,
          lastOperationId:operationId,
        },{merge:false});
      }
    });
    const manifest={
      ...(currentManifest||baseManifest(input,counts,chunkCount)),
      status:"committing",
      recoveryState:"blocked",
      completedChunks:chunkIndex+1,
      updatedAt:nowValue,
      startedAt:currentManifest?.startedAt||nowValue,
    };
    tx.set(manifestDocument,manifest,{merge:false});
    const nextRuntime={...(runtimeSnapshot.data()||{}),activeOperationId:operationId,activeOperationRevision:request.beforeRevision+1};
    tx.set(runtimeDocument,nextRuntime,{merge:false});
  });
}

async function reserveEmptyMutation(input,counts){
  const {db,request,fingerprint}=input;
  const runtimeDocument=runtimeRef(db,request.branchId);
  const manifestDocument=mutationRef(db,request.branchId,request.operationId);
  await db.runTransaction(async tx=>{
    const runtimeSnapshot=await tx.get(runtimeDocument);
    const manifestSnapshot=await tx.get(manifestDocument);
    const recoveryFenceSnapshot=await tx.get(recoveryFenceRef(db,request.branchId));
    const manifest=manifestSnapshot.exists?manifestSnapshot.data()||{}:null;
    assertManifestFingerprint(manifest,fingerprint);
    if(manifest?.status==="committed") return;
    assertRuntime(runtimeSnapshot.data()||{},request,request.operationId);
    if(leaseExpiry(recoveryFenceSnapshot.data()?.recoveryLeaseUntil)>input.now.getTime()) fail("aborted");
    const nowValue=serverTime(input);
    tx.set(manifestDocument,{
      ...baseManifest(input,counts,0),
      completedChunks:0,startedAt:manifest?.startedAt||nowValue,updatedAt:nowValue,
    },{merge:false});
    tx.set(runtimeDocument,{
      ...(runtimeSnapshot.data()||{}),
      activeOperationId:request.operationId,
      activeOperationRevision:request.beforeRevision+1,
    },{merge:false});
  });
}

async function completeSnapshotHeaders(input,chunkCount){
  const ids=input.snapshotHeaderIds||[];
  if(!ids.length) return;
  const {db,request,fingerprint}=input;
  const runtimeDocument=runtimeRef(db,request.branchId);
  const manifestDocument=mutationRef(db,request.branchId,request.operationId);
  await db.runTransaction(async tx=>{
    const runtimeSnapshot=await tx.get(runtimeDocument);
    const manifestSnapshot=await tx.get(manifestDocument);
    const manifest=manifestSnapshot.exists?manifestSnapshot.data()||{}:null;
    assertManifestFingerprint(manifest,fingerprint);
    if(manifest?.status==="committed") return;
    assertRuntime(runtimeSnapshot.data()||{},request,request.operationId);
    if(!manifest||manifest.status!=="committing"||Number(manifest.completedChunks||0)!==chunkCount){
      fail("failed-precondition");
    }
    if(Number(manifest.completedSnapshotHeaders||0)===ids.length) return;
    const headers=[];
    for(const id of ids){
      const ref=generationRef(db,request.branchId,request.generationId)
        .collection("attendanceSnapshots").doc(safeDocId(id));
      const snapshot=await tx.get(ref);
      const value=snapshot.exists?snapshot.data()||{}:null;
      if(!value||text(value.lastOperationId)!==request.operationId
        ||Number(value.operationalRevision)!==request.beforeRevision+1){
        fail("failed-precondition");
      }
      headers.push({ref,value});
    }
    const nowValue=serverTime(input);
    headers.forEach(({ref,value})=>tx.set(ref,{...value,complete:true},{merge:false}));
    tx.set(manifestDocument,{
      ...manifest,completedSnapshotHeaders:ids.length,updatedAt:nowValue,
    },{merge:false});
  });
}

async function finalizeMutation(input,counts,chunkCount){
  const {db,request,fingerprint}=input;
  const runtimeDocument=runtimeRef(db,request.branchId);
  const manifestDocument=mutationRef(db,request.branchId,request.operationId);
  return db.runTransaction(async tx=>{
    const runtimeSnapshot=await tx.get(runtimeDocument);
    const manifestSnapshot=await tx.get(manifestDocument);
    const manifest=manifestSnapshot.exists?manifestSnapshot.data()||{}:null;
    assertManifestFingerprint(manifest,fingerprint);
    if(manifest?.status==="committed") return resultFromManifest(manifest);
    assertRuntime(runtimeSnapshot.data()||{},request,request.operationId);
    if(!manifest||manifest.status!=="committing"||Number(manifest.completedChunks||0)!==chunkCount) fail("failed-precondition");
    if(Number(manifest.completedSnapshotHeaders||0)!==Number(manifest.snapshotCompletionCount||0)){
      fail("failed-precondition");
    }

    const recoveryState=text(runtimeSnapshot.data()?.mode)==="v2-read"?"pending":"not-required";
    const resultCounts={
      changeCount:Number(manifest.changeCount??counts.changeCount),
      setCount:Number(manifest.setCount??counts.setCount),
      deleteCount:Number(manifest.deleteCount??counts.deleteCount),
    };
    const result={
      operationId:request.operationId,
      committed:true,
      revision:request.beforeRevision+1,
      ...resultCounts,
      recoveryState,
    };
    const nowValue=serverTime(input);
    const nextRuntime={...(runtimeSnapshot.data()||{})};
    delete nextRuntime.activeOperationId;
    delete nextRuntime.activeOperationRevision;
    nextRuntime.revision=request.beforeRevision+1;
    nextRuntime.updatedAt=nowValue;
    tx.set(runtimeDocument,nextRuntime,{merge:false});
    tx.set(manifestDocument,{
      ...manifest,
      status:"committed",
      recoveryState,
      committedAt:nowValue,
      updatedAt:nowValue,
      result,
    },{merge:false});
    return result;
  });
}

async function commitV2Mutation(rawInput){
  const input={...rawInput};
  if(!input.db||typeof input.db.runTransaction!=="function"||!plainObject(input.request)) fail("invalid-argument");
  input.now=normalizeNow(input.now);
  input.fingerprint=text(input.fingerprint)||requestFingerprint(input.request);
  const changes=(Array.isArray(input.changes)?input.changes:[]).map(normalizeChange).map(change=>{
    if(input.request.operationType==="attendance-snapshot"
      &&change.collection==="attendanceSnapshots"&&change.type==="set"){
      return {...change,value:{...change.value,complete:false}};
    }
    return change;
  });
  if(changes.length>MAX_DOCUMENT_CHANGES) fail("resource-exhausted");
  input.snapshotHeaderIds=changes
    .filter(change=>change.collection==="attendanceSnapshots"&&change.type==="set")
    .map(change=>change.id);
  if(input.snapshotHeaderIds.length>DOCUMENT_CHUNK_SIZE) fail("resource-exhausted");
  input.changedDocumentRefs=changes
    .filter(change=>change.type==="set")
    .map(change=>`${change.collection}/${safeDocId(change.id)}`);
  input.deletedDocumentRefs=changes
    .filter(change=>change.type==="delete")
    .map(change=>`${change.collection}/${safeDocId(change.id)}`);
  const counts=changeCounts(changes);
  const chunkCount=Math.ceil(changes.length/DOCUMENT_CHUNK_SIZE);
  assertWriteSizes(input,changes,counts,chunkCount);
  const existing=await mutationRef(input.db,input.request.branchId,input.request.operationId).get();
  let manifest=null;
  if(existing.exists){
    manifest=existing.data()||{};
    assertManifestFingerprint(manifest,input.fingerprint);
    if(manifest.status==="committed") return resultFromManifest(manifest);
    if(estimatedBytes(manifest)>MAX_ESTIMATED_DOCUMENT_BYTES) fail("resource-exhausted");
    if(manifest.status!=="committing") fail("failed-precondition");
    assertFinalManifestSize(input,manifest,{
      changeCount:Number(manifest.changeCount||0),
      setCount:Number(manifest.setCount||0),
      deleteCount:Number(manifest.deleteCount||0),
    });
    const completedChunks=Math.max(0,Number(manifest.completedChunks||0)||0);
    const originalChunkCount=Math.max(0,Number(manifest.chunkCount||0)||0);
    input.snapshotHeaderIds=clone(manifest.snapshotHeaderIds||[]);
    if(completedChunks===originalChunkCount){
      await completeSnapshotHeaders(input,originalChunkCount);
      return finalizeMutation(input,counts,originalChunkCount);
    }
    if(completedChunks+chunkCount!==originalChunkCount) fail("failed-precondition");
    input.changedDocumentRefs=clone(manifest.changedDocumentRefs||[]);
    input.deletedDocumentRefs=clone(manifest.deletedDocumentRefs||[]);
  }

  if(!changes.length) await reserveEmptyMutation(input,counts);
  const completedChunks=manifest?Math.max(0,Number(manifest.completedChunks||0)||0):0;
  const targetChunkCount=manifest?Math.max(0,Number(manifest.chunkCount||0)||0):chunkCount;
  const originalCounts=manifest?{
    changeCount:Number(manifest.changeCount||0),
    setCount:Number(manifest.setCount||0),
    deleteCount:Number(manifest.deleteCount||0),
  }:counts;
  for(let offset=0,chunkIndex=completedChunks;offset<changes.length;offset+=DOCUMENT_CHUNK_SIZE,chunkIndex+=1){
    await commitChangeChunk(
      input,changes.slice(offset,offset+DOCUMENT_CHUNK_SIZE),chunkIndex,targetChunkCount,originalCounts,
    );
  }
  await completeSnapshotHeaders(input,targetChunkCount);
  return finalizeMutation(input,originalCounts,targetChunkCount);
}

function snapshotRows(snapshot){
  const rows=[];
  snapshot?.forEach?.(doc=>{
    const value=doc.data()||{};
    rows.push({...value,id:text(value.id)||doc.id});
  });
  return rows;
}

async function readGenerationCollections(db,branchId,generationId,heartbeat=async()=>{}){
  const ref=generationRef(db,branchId,generationId);
  const collections={};
  for(const collection of COLLECTIONS){
    await heartbeat();
    collections[collection]=snapshotRows(await ref.collection(collection).get());
  }
  return collections;
}

function modelCollections(storedCollections){
  const collections={};
  COLLECTIONS.forEach(name=>{
    collections[name]=(storedCollections[name]||[]).map(row=>{
      const value=clone(row);
      delete value.branchId;
      delete value.generationId;
      delete value.operationalRevision;
      delete value.lastOperationId;
      if(name==="attendanceSnapshots") delete value.complete;
      return value;
    });
  });
  return collections;
}

async function deriveChangesDefault(input){
  const storedCollections=await readGenerationCollections(
    input.db,input.request.branchId,input.request.generationId,
  );
  const collections=modelCollections(storedCollections);
  const beforeRoot=model.legacyRootFromCollections({
    branchId:input.request.branchId,generationId:input.request.generationId,collections,
  });
  if(!beforeRoot) fail("failed-precondition");
  const afterRoot={...beforeRoot};
  input.request.keys.forEach(key=>{
    if(input.request.removedKeys.includes(key)) delete afterRoot[key];
    else afterRoot[key]=clone(input.request.nextValues[key]);
  });
  if(input.request.keys.includes("swim_mark")){
    policy.validateMarkMutationSemantics(
      input.request.operationType,beforeRoot.swim_mark,afterRoot.swim_mark,
    );
  }
  const changedKeys=model.changedLegacyKeys(beforeRoot,afterRoot,input.request.keys);
  if(changedKeys.some(key=>!input.request.keys.includes(key))) fail("invalid-argument");
  const report=schema.diagnoseLegacyRoot(input.request.branchId,afterRoot);
  if(!report?.checks?.ready||!report.conversion) fail("failed-precondition");
  const planned=model.collectionChanges({before:collections,after:report.conversion});
  if(planned.issues.length) fail("failed-precondition");
  const beforeByCollection={};
  COLLECTIONS.forEach(name=>{
    beforeByCollection[name]=new Map((storedCollections[name]||[]).map(row=>[text(row.id),row]));
  });
  const changes=planned.changes.map(change=>{
    const before=beforeByCollection[change.collection].get(text(change.id));
    return {
      ...change,
      beforeExists:before!==undefined,
      beforeDigest:digest(before??null),
    };
  });
  const legacyValues=model.legacyRootFromCollections({
    branchId:input.request.branchId,generationId:input.request.generationId,
    collections:report.conversion,
  });
  if(!legacyValues) fail("failed-precondition");
  return {changes,collections:report.conversion,legacyValues};
}

function splitLegacyChunks(value){
  const chunks=[];
  for(let index=0;index<value.length;index+=LEGACY_CHUNK_SIZE) chunks.push(value.slice(index,index+LEGACY_CHUNK_SIZE));
  return chunks.length?chunks:[""];
}

function encodedLegacyValue(value){
  const isString=typeof value==="string";
  const encoded=isString?value:JSON.stringify(value);
  return {isString,text:encoded===undefined?"null":encoded};
}

function knownChunkCount(item){
  return item?.chunked?Math.max(0,Number(item.chunkCount||0)||0):0;
}

function writeLegacyValue(batch,input,key,value,previousItem){
  const encoded=encodedLegacyValue(value);
  const previousCount=knownChunkCount(previousItem);
  const ref=legacyKeyRef(input.db,input.branchId,key);
  if(encoded.text.length>LEGACY_CHUNK_THRESHOLD){
    const chunks=splitLegacyChunks(encoded.text);
    batch.set(ref,{
      key,chunked:true,chunkCount:chunks.length,
      valueType:encoded.isString?"string":"json",updatedAt:serverTime(input),
    },{merge:false});
    chunks.forEach((chunk,index)=>batch.set(
      legacyChunkRef(input.db,input.branchId,key,index),{text:chunk},{merge:false},
    ));
    for(let index=chunks.length;index<previousCount;index+=1){
      batch.delete(legacyChunkRef(input.db,input.branchId,key,index));
    }
    return;
  }
  batch.set(ref,{key,value,chunked:false,updatedAt:serverTime(input)},{merge:false});
  for(let index=0;index<previousCount;index+=1){
    batch.delete(legacyChunkRef(input.db,input.branchId,key,index));
  }
}

function deleteLegacyValue(batch,input,key,previousItem){
  batch.delete(legacyKeyRef(input.db,input.branchId,key));
  for(let index=0;index<knownChunkCount(previousItem);index+=1){
    batch.delete(legacyChunkRef(input.db,input.branchId,key,index));
  }
}

async function resolveRecoveryValuesDefault(input){
  const runtimeSnapshot=await runtimeRef(input.db,input.branchId).get();
  const runtime=runtimeSnapshot.data()||{};
  assertRecoveryRevision(runtime,input.manifest);
  const collections=modelCollections(await readGenerationCollections(
    input.db,input.branchId,input.manifest.generationId,input.heartbeat,
  ));
  const root=model.legacyRootFromCollections({
    branchId:input.branchId,generationId:input.manifest.generationId,collections,
  });
  if(!root) fail("failed-precondition");
  const values={};
  input.manifest.keys.forEach(key=>{
    if(Object.prototype.hasOwnProperty.call(root,key)){
      values[key]=root[key];
    }
  });
  return values;
}

function leaseExpiry(value){
  const expiry=Date.parse(text(value));
  return Number.isFinite(expiry)?expiry:0;
}

function freshRecoveryNow(input){
  return normalizeNow(typeof input.clock==="function"?input.clock():new Date());
}

function recoverySourceRevision(manifest){
  return Number(manifest.recoverySourceRevision??manifest.resultingRevision??0);
}

function renewedLeaseUntil(now){
  return new Date(now.getTime()+RECOVERY_LEASE_MS).toISOString();
}

function assertRecoveryRevision(runtime,manifest){
  if(text(runtime.activeOperationId)) fail("failed-precondition");
  if(text(runtime.generationId)!==text(manifest.generationId)) fail("failed-precondition");
  if(Number(runtime.revision||0)!==recoverySourceRevision(manifest)) fail("failed-precondition");
}

function releasedFence(fence,input){
  const next={...fence,branchId:input.branchId,updatedAt:serverTime(input)};
  delete next.recoveryLeaseId;
  delete next.recoveryLeaseUntil;
  delete next.operationId;
  delete next.resultingRevision;
  return next;
}

function manifestWithRecoveryState(manifest,state,input){
  const next={...manifest,recoveryState:state,updatedAt:serverTime(input)};
  delete next.recoveryLeaseId;
  delete next.recoveryLeaseUntil;
  if(state==="superseded") next.recoverySupersededAt=input.now.toISOString();
  next.result={...(plainObject(manifest.result)?manifest.result:{}),recoveryState:state};
  return next;
}

async function claimRecovery(input,manifestDocument){
  return input.db.runTransaction(async tx=>{
    const now=freshRecoveryNow(input);
    const timedInput={...input,now};
    const runtimeDocument=runtimeRef(input.db,input.branchId);
    const fenceDocument=recoveryFenceRef(input.db,input.branchId);
    const runtimeSnapshot=await tx.get(runtimeDocument);
    const fenceSnapshot=await tx.get(fenceDocument);
    const snapshot=await tx.get(manifestDocument);
    if(!snapshot.exists) fail("not-found");
    const manifest=snapshot.data()||{};
    if(manifest.status!=="committed") fail("failed-precondition");
    if(["applied","not-required","superseded"].includes(manifest.recoveryState)) return null;
    if(!Array.isArray(manifest.keys)||manifest.keys.some(key=>
      Buffer.byteLength(safeDocId(key),"utf8")>MAX_DOCUMENT_ID_BYTES
    )) fail("invalid-argument");
    const runtime=runtimeSnapshot.data()||{};
    const fence=fenceSnapshot.exists?fenceSnapshot.data()||{}:{};
    const operationLeaseActive=manifest.recoveryState==="processing"&&
      leaseExpiry(manifest.recoveryLeaseUntil)>now.getTime();
    if(operationLeaseActive) return null;
    const fenceLeaseActive=leaseExpiry(fence.recoveryLeaseUntil)>now.getTime();
    if(fenceLeaseActive&&text(fence.operationId)!==input.operationId) return {blocked:true};

    const expiredProcessing=manifest.recoveryState==="processing";
    const attempts=Math.max(0,Number(manifest.recoveryAttempts||0))+(expiredProcessing?1:0);
    if(attempts>=MAX_RECOVERY_ATTEMPTS){
      const exhausted=manifestWithRecoveryState(manifest,"error",timedInput);
      exhausted.recoveryAttempts=MAX_RECOVERY_ATTEMPTS;
      exhausted.recoveryFailedAt=now.toISOString();
      tx.set(manifestDocument,exhausted,{merge:false});
      if(text(fence.operationId)===input.operationId){
        tx.set(fenceDocument,releasedFence(fence,timedInput),{merge:false});
      }
      return {terminal:true,recoveryState:"error"};
    }

    const resultingRevision=Number(manifest.resultingRevision||0);
    const runtimeRevision=Math.max(0,Number(runtime.revision||0)||0);
    if(text(runtime.activeOperationId)||runtimeRevision<resultingRevision||
        text(runtime.generationId)!==text(manifest.generationId)) return {blocked:true};
    const leaseId=crypto.randomUUID();
    const leaseUntil=renewedLeaseUntil(now);
    const next={
      ...manifest,recoveryState:"processing",recoveryLeaseId:leaseId,
      recoveryLeaseUntil:leaseUntil,recoveryAttempts:attempts,
      recoverySourceRevision:runtimeRevision,
      recoveryStartedAt:now.toISOString(),updatedAt:serverTime(timedInput),
    };
    tx.set(manifestDocument,next,{merge:false});
    tx.set(fenceDocument,{
      ...fence,branchId:input.branchId,operationId:input.operationId,
      operationResultingRevision:resultingRevision,sourceRevision:runtimeRevision,
      resultingRevision:runtimeRevision,recoveryLeaseId:leaseId,recoveryLeaseUntil:leaseUntil,
      updatedAt:serverTime(timedInput),
    },{merge:false});
    return {...next,recoveryLeaseId:leaseId};
  });
}

function ownsLiveRecoveryLease(input,manifest,fence,claim,now){
  return manifest.recoveryState==="processing"&&
    text(manifest.recoveryLeaseId)===claim.recoveryLeaseId&&
    text(fence.recoveryLeaseId)===claim.recoveryLeaseId&&
    text(fence.operationId)===input.operationId&&
    Number(fence.sourceRevision??fence.resultingRevision??0)===recoverySourceRevision(claim)&&
    leaseExpiry(manifest.recoveryLeaseUntil)>now.getTime()&&
    leaseExpiry(fence.recoveryLeaseUntil)>now.getTime();
}

async function renewRecoveryLease(input,manifestDocument,claim){
  return input.db.runTransaction(async tx=>{
    const now=freshRecoveryNow(input);
    const timedInput={...input,now};
    const runtimeDocument=runtimeRef(input.db,input.branchId);
    const fenceDocument=recoveryFenceRef(input.db,input.branchId);
    const runtimeSnapshot=await tx.get(runtimeDocument);
    const fenceSnapshot=await tx.get(fenceDocument);
    const manifestSnapshot=await tx.get(manifestDocument);
    const runtime=runtimeSnapshot.data()||{};
    const fence=fenceSnapshot.data()||{};
    const manifest=manifestSnapshot.data()||{};
    assertRecoveryRevision(runtime,claim);
    if(!ownsLiveRecoveryLease(input,manifest,fence,claim,now)) fail("failed-precondition");
    const leaseUntil=renewedLeaseUntil(now);
    tx.set(manifestDocument,{
      ...manifest,recoveryLeaseUntil:leaseUntil,updatedAt:serverTime(timedInput),
    },{merge:false});
    tx.set(fenceDocument,{
      ...fence,recoveryLeaseUntil:leaseUntil,updatedAt:serverTime(timedInput),
    },{merge:false});
    return leaseUntil;
  });
}

async function finishRecovery(input,manifestDocument,claim,state,error){
  return input.db.runTransaction(async tx=>{
    const now=freshRecoveryNow(input);
    const timedInput={...input,now};
    const runtimeDocument=runtimeRef(input.db,input.branchId);
    const fenceDocument=recoveryFenceRef(input.db,input.branchId);
    const runtimeSnapshot=await tx.get(runtimeDocument);
    const fenceSnapshot=await tx.get(fenceDocument);
    const snapshot=await tx.get(manifestDocument);
    const current=snapshot.data()||{};
    const fence=fenceSnapshot.data()||{};
    if(!ownsLiveRecoveryLease(input,current,fence,claim,now)) return current.recoveryState;
    let finalState=state;
    if(state==="applied"){
      const runtime=runtimeSnapshot.data()||{};
      const exactRevision=!text(runtime.activeOperationId)&&
        text(runtime.generationId)===text(claim.generationId)&&
        Number(runtime.revision||0)===recoverySourceRevision(claim);
      if(!exactRevision) finalState="error";
      else if(recoverySourceRevision(claim)>Number(claim.resultingRevision||0)) finalState="superseded";
    }
    const attempts=finalState==="error"
      ?Math.min(MAX_RECOVERY_ATTEMPTS,Math.max(0,Number(current.recoveryAttempts||0))+1)
      :Math.max(0,Number(current.recoveryAttempts||0));
    const next=manifestWithRecoveryState(current,finalState,timedInput);
    next.recoveryAttempts=attempts;
    if(["applied","superseded"].includes(finalState)){
      next.recoveryCoveredAtRevision=recoverySourceRevision(claim);
      if(finalState==="applied") next.recoveryAppliedAt=serverTime(timedInput);
      delete next.diagnostic;
    }else if(finalState==="error"){
      next.recoveryFailedAt=now.toISOString();
      next.diagnostic=policy.redactedDiagnostic(error,{
        branchId:input.branchId,operationId:input.operationId,
        operationType:claim.operationType,keyCount:claim.keys.length,
        changeCount:claim.changeCount,now,
      });
    }
    tx.set(manifestDocument,next,{merge:false});
    const nextFence=releasedFence(fence,timedInput);
    if(["applied","superseded"].includes(finalState)){
      nextFence.appliedRevision=Math.max(
        Number(fence.appliedRevision||0),recoverySourceRevision(claim),
      );
      nextFence.appliedOperationId=input.operationId;
      nextFence.appliedAt=serverTime(timedInput);
    }
    tx.set(fenceDocument,nextFence,{merge:false});
    return finalState;
  });
}

async function writeRecoveryKey(input,claim,key,values,manifestDocument){
  const runtimeDocument=runtimeRef(input.db,input.branchId);
  const fenceDocument=recoveryFenceRef(input.db,input.branchId);
  const ref=legacyKeyRef(input.db,input.branchId,key);
  return input.db.runTransaction(async tx=>{
    const now=freshRecoveryNow(input);
    const timedInput={...input,now};
    const runtimeSnapshot=await tx.get(runtimeDocument);
    const fenceSnapshot=await tx.get(fenceDocument);
    const manifestSnapshot=await tx.get(manifestDocument);
    const previous=await tx.get(ref);
    const fence=fenceSnapshot.data()||{};
    const manifest=manifestSnapshot.data()||{};
    assertRecoveryRevision(runtimeSnapshot.data()||{},claim);
    if(!ownsLiveRecoveryLease(input,manifest,fence,claim,now)) fail("failed-precondition");
    if(Object.prototype.hasOwnProperty.call(values,key)){
      writeLegacyValue(tx,timedInput,key,values[key],previous.exists?previous.data()||{}:null);
    }else deleteLegacyValue(tx,timedInput,key,previous.exists?previous.data()||{}:null);
    const leaseUntil=renewedLeaseUntil(now);
    tx.set(manifestDocument,{
      ...manifest,recoveryLeaseUntil:leaseUntil,updatedAt:serverTime(timedInput),
    },{merge:false});
    tx.set(fenceDocument,{
      ...fence,recoveryLeaseUntil:leaseUntil,updatedAt:serverTime(timedInput),
    },{merge:false});
  });
}

async function applyV1Recovery(rawInput){
  const clock=typeof rawInput.clock==="function"?rawInput.clock:
    (typeof rawInput.now==="function"?rawInput.now:()=>new Date());
  const initialNow=typeof rawInput.now==="function"?rawInput.now():(rawInput.now??clock());
  const input={...rawInput,clock,now:normalizeNow(initialNow)};
  if(!input.db||!BRANCH_IDS.includes(text(input.branchId))||!text(input.operationId)) fail("invalid-argument");
  const manifestDocument=mutationRef(input.db,input.branchId,input.operationId);
  const claim=await claimRecovery(input,manifestDocument);
  if(claim?.blocked) return {operationId:input.operationId,recoveryState:"pending"};
  if(claim?.terminal) return {operationId:input.operationId,recoveryState:claim.recoveryState};
  if(!claim) {
    const snapshot=await manifestDocument.get();
    return {operationId:input.operationId,recoveryState:text(snapshot.data()?.recoveryState)||"pending"};
  }
  input.manifest=claim;
  input.heartbeat=()=>renewRecoveryLease(input,manifestDocument,claim);
  try{
    await input.heartbeat();
    const plannedValuesAreCurrent=
      recoverySourceRevision(claim)===Number(claim.resultingRevision||0)&&plainObject(input.legacyValues);
    const values=plannedValuesAreCurrent?input.legacyValues:await input.resolveRecoveryValues(input);
    if(!plainObject(values)) fail("failed-precondition");
    await input.heartbeat();
    for(const key of claim.keys){
      await writeRecoveryKey(input,claim,key,values,manifestDocument);
    }
    await input.heartbeat();
    const recoveryState=await finishRecovery(input,manifestDocument,claim,"applied");
    return {operationId:input.operationId,recoveryState};
  }catch(error){
    const safeError=normalizedError(error);
    const recoveryState=await finishRecovery(input,manifestDocument,claim,"error",safeError);
    return {operationId:input.operationId,recoveryState};
  }
}

async function recoveryCandidates(db,branchId,limit,now){
  const collection=db.collection(ROOT_COLLECTION).doc(branchId).collection("operationalMutations");
  const snapshots=await Promise.all(["pending","error","processing"].map(state=>
    collection.where("status","==","committed").where("recoveryState","==",state).limit(limit).get()
  ));
  const byId=new Map();
  snapshots.forEach(snapshot=>snapshot.forEach(doc=>byId.set(doc.id,{
    ...(doc.data()||{}),operationId:text(doc.data()?.operationId)||doc.id,
  })));
  return [...byId.values()]
    .filter(manifest=>Number(manifest.recoveryAttempts||0)<MAX_RECOVERY_ATTEMPTS)
    .filter(manifest=>manifest.recoveryState!=="processing"||
      leaseExpiry(manifest.recoveryLeaseUntil)<=now.getTime())
    .sort((left,right)=>Number(right.resultingRevision||0)-Number(left.resultingRevision||0))
    .slice(0,limit);
}

async function readOperationalStatus(rawInput,maybeBranchId){
  const input=rawInput?.db?rawInput:{db:rawInput,branchId:maybeBranchId};
  if(!input.db||!BRANCH_IDS.includes(text(input.branchId))) fail("invalid-argument");
  const runtimeSnapshot=await runtimeRef(input.db,input.branchId).get();
  const collection=input.db.collection(ROOT_COLLECTION).doc(input.branchId).collection("operationalMutations");
  const requestCollection=input.db.collection(ROOT_COLLECTION).doc(input.branchId).collection("requestRecoveries");
  async function countQuery(query){
    if(typeof query.count==="function"){
      const snapshot=await query.count().get();
      return Math.max(0,Number(snapshot.data()?.count||0)||0);
    }
    const snapshot=await query.get();
    return Math.max(0,Number(snapshot.size||snapshot.docs?.length||0)||0);
  }
  function countState(state){
    return countQuery(collection.where("status","==","committed").where("recoveryState","==",state));
  }
  function countRequestState(state){
    return countQuery(requestCollection.where("state","==",state));
  }
  const [
    committingMutationCount,recoveryPendingCount,recoveryErrorCount,recoveryProcessingCount,
    requestStaged,requestWaiting,requestProcessing,requestError,requestCompleted,requestConflict,
    requestCancelled,requestRejected,
  ]=await Promise.all([
    countQuery(collection.where("status","==","committing")),
    countState("pending"),countState("error"),countState("processing"),
    countRequestState("staged"),countRequestState("waiting-primary"),countRequestState("processing"),
    countRequestState("error"),countRequestState("completed"),countRequestState("conflict"),
    countRequestState("cancelled"),countRequestState("rejected"),
  ]);
  return {
    branchId:input.branchId,
    mode:text(runtimeSnapshot.data()?.mode)||"v1",
    generationId:text(runtimeSnapshot.data()?.generationId),
    epoch:Math.max(0,Number(runtimeSnapshot.data()?.epoch||0)||0),
    revision:Math.max(0,Number(runtimeSnapshot.data()?.revision||0)||0),
    committingMutationCount,
    activeOperationCount:text(runtimeSnapshot.data()?.activeOperationId)?1:0,
    recoveryPendingCount,
    recoveryErrorCount,
    recoveryProcessingCount,
    requestRecoveryStagedCount:requestStaged,
    requestRecoveryWaitingCount:requestWaiting,
    requestRecoveryProcessingCount:requestProcessing,
    requestRecoveryPendingCount:requestStaged+requestWaiting+requestProcessing,
    requestRecoveryErrorCount:requestError,
    requestRecoveryCompletedCount:requestCompleted,
    requestRecoveryConflictCount:requestConflict,
    requestRecoveryCancelledCount:requestCancelled,
    requestRecoveryRejectedCount:requestRejected,
  };
}

function requestRecoveryFingerprint(command){
  return digest({
    version:command.version,branchId:command.branchId,operationId:command.operationId,
    operationType:command.operationType,intents:command.intents,
  });
}

function requestRecoveryResponse(record,operationId=""){
  const state=REQUEST_RECOVERY_STATES.has(text(record?.state))?text(record.state):"error";
  const code=REQUEST_RECOVERY_CODES.has(text(record?.code))?text(record.code):"invalid-record";
  return {
    operationId:text(record?.operationId)||text(operationId),state,
    attempts:Math.max(0,Math.min(REQUEST_RECOVERY_MAX_ATTEMPTS,Number(record?.attempts||0)||0)),code,
  };
}

function requestRecoveryBase(command,input){
  const now=normalizeNow(input.now);
  return {
    version:REQUEST_RECOVERY_VERSION,
    branchId:command.branchId,
    operationId:command.operationId,
    linkedV2OperationId:command.operationId,
    operationType:command.operationType,
    intents:clone(command.intents),
    intentFingerprint:requestRecoveryFingerprint(command),
    state:"staged",
    attempts:0,
    primaryChecks:0,
    createdAt:now.toISOString(),
    updatedAt:now.toISOString(),
    expiresAt:new Date(now.getTime()+REQUEST_RECOVERY_EXPIRY_MS),
    code:"",
  };
}

const REQUEST_RECOVERY_COMMON_KEYS=[
  "version","branchId","operationId","linkedV2OperationId","operationType","intents",
  "intentFingerprint","state","attempts","primaryChecks","createdAt","updatedAt","expiresAt",
  "code",
];
const REQUEST_RECOVERY_STATE_KEYS={
  staged:[],
  "waiting-primary":[],
  processing:["leaseId","leaseUntil"],
  error:["failedAt"],
  completed:["completedAt"],
  conflict:["conflictAt"],
  cancelled:["cancelledAt"],
};

function timestampMillis(value){
  if(value instanceof Date) return value.getTime();
  if(value&&typeof value.toDate==="function") return value.toDate().getTime();
  const parsed=Date.parse(text(value));
  return Number.isFinite(parsed)?parsed:NaN;
}

function exactRecordKeys(record,expected){
  const actual=Object.keys(record||{});
  return actual.length===expected.length&&actual.every(key=>expected.includes(key));
}

function requestRecoveryState(record,state,now,code,extra={}){
  const next={};
  REQUEST_RECOVERY_COMMON_KEYS.forEach(key=>{
    next[key]=key==="intents"?clone(record[key]):record[key];
  });
  next.state=state;
  next.code=code;
  next.updatedAt=now.toISOString();
  if(["error","completed","conflict","cancelled"].includes(state)){
    next.expiresAt=new Date(now.getTime()+REQUEST_RECOVERY_TERMINAL_RETENTION_MS);
  }
  return {...next,...extra};
}

function validateStoredRequestRecovery(record,branchId,operationId){
  if(!plainObject(record)) fail("invalid-record");
  if(record.state==="rejected"){
    const rejectedKeys=[
      "version","branchId","operationId","linkedV2OperationId","state","attempts","primaryChecks",
      "createdAt","updatedAt","expiresAt","rejectedAt","code",
    ];
    if(!exactRecordKeys(record,rejectedKeys)||record.version!==REQUEST_RECOVERY_VERSION||
        record.branchId!==branchId||record.operationId!==operationId||record.linkedV2OperationId!==operationId||
        record.code!=="invalid-record"||record.attempts!==0||record.primaryChecks!==0||
        !Number.isFinite(timestampMillis(record.createdAt))||!Number.isFinite(timestampMillis(record.updatedAt))||
        !Number.isFinite(timestampMillis(record.rejectedAt))||!Number.isFinite(timestampMillis(record.expiresAt))){
      fail("invalid-record");
    }
    return record;
  }
  const state=text(record.state);
  if(!Object.prototype.hasOwnProperty.call(REQUEST_RECOVERY_STATE_KEYS,state)||
      !exactRecordKeys(record,REQUEST_RECOVERY_COMMON_KEYS.concat(REQUEST_RECOVERY_STATE_KEYS[state]))) fail("invalid-record");
  const command=policy.validateRequestRecoveryCommand({
    version:record.version,action:"stage",branchId:record.branchId,
    operationId:record.operationId,operationType:record.operationType,intents:record.intents,
  });
  if(command.branchId!==branchId||command.operationId!==operationId||
      text(record.linkedV2OperationId)!==operationId||
      text(record.intentFingerprint)!==requestRecoveryFingerprint(command)) fail("invalid-record");
  if(!REQUEST_RECOVERY_STATES.has(state)||!REQUEST_RECOVERY_CODES.has(text(record.code))) fail("invalid-record");
  if(!Number.isSafeInteger(record.attempts)||record.attempts<0||record.attempts>REQUEST_RECOVERY_MAX_ATTEMPTS) fail("invalid-record");
  if(!Number.isSafeInteger(record.primaryChecks)||record.primaryChecks<0||record.primaryChecks>1000) fail("invalid-record");
  for(const key of ["createdAt","updatedAt","expiresAt"]){
    if(!Number.isFinite(timestampMillis(record[key]))) fail("invalid-record");
  }
  for(const key of REQUEST_RECOVERY_STATE_KEYS[state].filter(key=>key!=="leaseId")){
    if(!Number.isFinite(timestampMillis(record[key]))) fail("invalid-record");
  }
  if(state==="processing"&&!/^[0-9a-f-]{36}$/.test(text(record.leaseId))) fail("invalid-record");
  const codeByState={
    staged:new Set([""]),"waiting-primary":new Set(["primary-pending"]),processing:new Set([""]),
    error:new Set(["retry-exhausted"]),completed:new Set([""]),
    conflict:new Set(["manifest-mismatch","request-conflict"]),cancelled:new Set(["primary-expired"]),
  };
  if(!codeByState[state].has(record.code)) fail("invalid-record");
  if(state==="error"&&record.attempts!==REQUEST_RECOVERY_MAX_ATTEMPTS) fail("invalid-record");
  return {...record,intents:clone(command.intents)};
}

function rejectedRequestRecovery(branchId,operationId,now){
  return {
    version:REQUEST_RECOVERY_VERSION,branchId,operationId,linkedV2OperationId:operationId,
    state:"rejected",attempts:0,primaryChecks:0,createdAt:now.toISOString(),updatedAt:now.toISOString(),
    expiresAt:new Date(now.getTime()+REQUEST_RECOVERY_TERMINAL_RETENTION_MS),
    rejectedAt:now.toISOString(),code:"invalid-record",
  };
}

function requestRecoveryLeaseExpired(record,now){
  return !Number.isFinite(timestampMillis(record.leaseUntil))||timestampMillis(record.leaseUntil)<=now.getTime();
}

async function readLegacyValueInTransaction(tx,db,branchId,key,item){
  if(!item?.chunked) return clone(item?.value);
  const count=Math.max(0,Number(item.chunkCount||0)||0);
  const chunks=[];
  for(let index=0;index<count;index+=1){
    const snapshot=await tx.get(legacyChunkRef(db,branchId,key,index));
    if(!snapshot.exists||typeof snapshot.data()?.text!=="string") fail("data-loss");
    chunks.push(snapshot.data().text);
  }
  const encoded=chunks.join("");
  return item.valueType==="string"?encoded:JSON.parse(encoded);
}

function parseLegacyRequests(value){
  const parsed=typeof value==="string"?JSON.parse(value):clone(value);
  if(!plainObject(parsed)) fail("data-loss");
  return parsed;
}

function currentRequestVersion(request){
  const value=request?.requestVersion??request?.version;
  return Number.isSafeInteger(value)&&value>=0?value:null;
}

function applyRequestIntent(request,intent,processorName){
  const currentStatus=text(request.status)||"pending";
  const versionCompatible=intent.expectedVersion===null||currentRequestVersion(request)===intent.expectedVersion;
  if(currentStatus===intent.patch.status){
    const transitionFields=[
      "status","processedAt","supersededBy","cancelledAt","cancelledBy","cancelledRequestId",
    ];
    const fieldsMatch=transitionFields.every(key=>
      Object.prototype.hasOwnProperty.call(intent.patch,key)
        ?request[key]===intent.patch[key]
        :!Object.prototype.hasOwnProperty.call(request,key)
    );
    const processingCleared=!Object.prototype.hasOwnProperty.call(request,"processingAt")&&
      !Object.prototype.hasOwnProperty.call(request,"processingBy");
    if(versionCompatible&&fieldsMatch&&processingCleared&&request.processedBy===processorName){
      return {value:request,alreadyApplied:true};
    }
    return {conflict:true};
  }
  if(currentStatus!==intent.expectedStatus||!versionCompatible){
    return {conflict:true};
  }
  const next={...request};
  Object.entries(intent.patch).forEach(([key,value])=>{
    if(key!=="clearProcessing") next[key]=clone(value);
  });
  delete next.processingAt;
  delete next.processingBy;
  next.processedBy=processorName;
  return {value:next,alreadyApplied:false};
}

async function stageRequestRecovery(input,command){
  const ref=requestRecoveryRef(input.db,command.branchId,command.operationId);
  const fingerprint=requestRecoveryFingerprint(command);
  return input.db.runTransaction(async tx=>{
    const snapshot=await tx.get(ref);
    if(snapshot.exists){
      const stored=validateStoredRequestRecovery(snapshot.data()||{},command.branchId,command.operationId);
      if(stored.intentFingerprint!==fingerprint) fail("already-exists");
      return requestRecoveryResponse(stored,command.operationId);
    }
    const record=requestRecoveryBase(command,input);
    tx.set(ref,record,{merge:false});
    return requestRecoveryResponse(record,command.operationId);
  });
}

async function claimRequestRecovery(input,branchId,operationId){
  const recoveryDocument=requestRecoveryRef(input.db,branchId,operationId);
  const manifestDocument=mutationRef(input.db,branchId,operationId);
  return input.db.runTransaction(async tx=>{
    const now=normalizeNow(input.now());
    const recoverySnapshot=await tx.get(recoveryDocument);
    if(!recoverySnapshot.exists) return {state:"missing",operationId};
    try{
      policy.validateRequestRecoveryCommand({
        version:REQUEST_RECOVERY_VERSION,action:"drain",branchId,operationId,
      });
    }catch(error){
      tx.delete(recoveryDocument);
      return {state:"rejected",operationId:"",code:"invalid-record"};
    }
    let record;
    try{
      record=validateStoredRequestRecovery(recoverySnapshot.data()||{},branchId,operationId);
    }catch(error){
      tx.set(recoveryDocument,rejectedRequestRecovery(branchId,operationId,now),{merge:false});
      return {state:"rejected",operationId,code:"invalid-record"};
    }
    if(["error","completed","conflict","cancelled","rejected"].includes(record.state)) return record;
    if(record.state==="processing"&&!requestRecoveryLeaseExpired(record,now)) return record;
    if(record.attempts>=REQUEST_RECOVERY_MAX_ATTEMPTS){
      const exhausted=requestRecoveryState(record,"error",now,"retry-exhausted",{failedAt:now.toISOString()});
      tx.set(recoveryDocument,exhausted,{merge:false});
      return exhausted;
    }
    const manifestSnapshot=await tx.get(manifestDocument);
    const manifest=manifestSnapshot.exists?manifestSnapshot.data()||{}:null;
    if(!manifest||text(manifest.status)!=="committed"){
      if(timestampMillis(record.expiresAt)<=now.getTime()){
        const cancelled=requestRecoveryState(record,"cancelled",now,"primary-expired",{cancelledAt:now.toISOString()});
        tx.set(recoveryDocument,cancelled,{merge:false});
        return cancelled;
      }
      const waiting=requestRecoveryState(record,"waiting-primary",now,"primary-pending",{
        primaryChecks:Math.min(1000,record.primaryChecks+1),
      });
      tx.set(recoveryDocument,waiting,{merge:false});
      return waiting;
    }
    if(text(manifest.operationId)!==operationId||text(manifest.branchId)!==branchId||
        text(manifest.operationType)!==record.operationType){
      const conflict=requestRecoveryState(record,"conflict",now,"manifest-mismatch",{conflictAt:now.toISOString()});
      tx.set(recoveryDocument,conflict,{merge:false});
      return conflict;
    }
    const leaseId=crypto.randomUUID();
    const claimed=requestRecoveryState(record,"processing",now,"",{
      attempts:record.attempts+1,leaseId,
      leaseUntil:new Date(now.getTime()+REQUEST_RECOVERY_LEASE_MS),
    });
    tx.set(recoveryDocument,claimed,{merge:false});
    return claimed;
  });
}

async function applyClaimedRequestRecovery(input,claim){
  const branchId=claim.branchId;
  const operationId=claim.operationId;
  const recoveryDocument=requestRecoveryRef(input.db,branchId,operationId);
  const manifestDocument=mutationRef(input.db,branchId,operationId);
  const requestDocument=legacyKeyRef(input.db,branchId,"swim_requests");
  return input.db.runTransaction(async tx=>{
    const now=normalizeNow(input.now());
    const recoverySnapshot=await tx.get(recoveryDocument);
    const manifestSnapshot=await tx.get(manifestDocument);
    const requestSnapshot=await tx.get(requestDocument);
    const record=validateStoredRequestRecovery(recoverySnapshot.data()||{},branchId,operationId);
    const manifest=manifestSnapshot.exists?manifestSnapshot.data()||{}:{};
    if(record.state!=="processing"||record.leaseId!==claim.leaseId||requestRecoveryLeaseExpired(record,now)){
      return requestRecoveryResponse(record,operationId);
    }
    if(text(manifest.status)!=="committed"||text(manifest.operationId)!==operationId||
        text(manifest.branchId)!==branchId||text(manifest.operationType)!==record.operationType) fail("failed-precondition");
    const processorName=policy.requestRecoveryProcessorName(manifest.actorId);
    if(!requestSnapshot.exists) fail("not-found");
    const previous=requestSnapshot.data()||{};
    const raw=await readLegacyValueInTransaction(tx,input.db,branchId,"swim_requests",previous);
    const requests=parseLegacyRequests(raw);
    let conflict=false;
    for(const intent of record.intents){
      const current=requests[intent.requestId];
      if(!plainObject(current)){ conflict=true;break; }
      const result=applyRequestIntent(current,intent,processorName);
      if(result.conflict){ conflict=true;break; }
      requests[intent.requestId]=result.value;
    }
    if(conflict){
      const next=requestRecoveryState(record,"conflict",now,"request-conflict",{conflictAt:now.toISOString()});
      tx.set(recoveryDocument,next,{merge:false});
      return requestRecoveryResponse(next,operationId);
    }
    const output=typeof raw==="string"?JSON.stringify(requests):requests;
    writeLegacyValue(tx,{...input,branchId,now},"swim_requests",output,previous);
    const completed=requestRecoveryState(record,"completed",now,"",{completedAt:now.toISOString()});
    tx.set(recoveryDocument,completed,{merge:false});
    return requestRecoveryResponse(completed,operationId);
  });
}

async function requestRecoveryCandidates(db,branchId,limit){
  const collection=db.collection(ROOT_COLLECTION).doc(branchId).collection("requestRecoveries");
  const rows=[];
  for(const state of ["staged","waiting-primary","processing"]){
    let cursor=null;
    for(let page=0;page<REQUEST_RECOVERY_MAX_PAGES;page+=1){
      let query=collection.where("state","==",state).orderBy("updatedAt","asc").limit(limit);
      if(cursor&&typeof query.startAfter==="function") query=query.startAfter(cursor);
      const snapshot=await query.get();
      snapshot.forEach(doc=>rows.push({operationId:doc.id,record:doc.data()||{}}));
      const docs=snapshot.docs||[];
      if(docs.length<limit) break;
      cursor=docs[docs.length-1];
    }
  }
  return rows;
}

async function cleanupTerminalRequestRecoveries(input){
  const collection=input.db.collection(ROOT_COLLECTION).doc(input.branchId).collection("requestRecoveries");
  const batch=input.db.batch();
  let remaining=input.limit;
  let cleaned=0;
  for(const state of ["completed"]){
    if(remaining<=0) break;
    const snapshot=await collection.where("state","==",state)
      .where("expiresAt","<=",input.now).orderBy("expiresAt","asc").limit(remaining).get();
    snapshot.forEach(doc=>{
      batch.delete(collection.doc(doc.id));
      cleaned+=1;
      remaining-=1;
    });
  }
  if(cleaned) await batch.commit();
  return cleaned;
}

function createOperationalWriter(options={}){
  if(!options.db) fail("invalid-argument");
  const now=typeof options.now==="function"?options.now:()=>new Date();
  const serverTimestamp=typeof options.serverTimestamp==="function"
    ?options.serverTimestamp
    :()=>new Date().toISOString();
  const deriveChanges=typeof options.deriveChanges==="function"?options.deriveChanges:deriveChangesDefault;
  const resolveRecoveryValues=typeof options.resolveRecoveryValues==="function"
    ?options.resolveRecoveryValues
    :resolveRecoveryValuesDefault;
  const requestRecoveryLocks=new Map();

  function withRequestRecoveryLock(branchId,operationId,worker){
    const key=`${branchId}:${operationId}`;
    const previous=requestRecoveryLocks.get(key)||Promise.resolve();
    const current=previous.catch(()=>undefined).then(worker);
    requestRecoveryLocks.set(key,current);
    return current.finally(()=>{
      if(requestRecoveryLocks.get(key)===current) requestRecoveryLocks.delete(key);
    });
  }

  async function mutate(callableRequest){
    const request=policy.validateMutationRequest(callableRequest?.data);
    const actor=policy.authorizeMutation(callableRequest,request);
    const fingerprint=requestFingerprint(request);
    const manifestDocument=mutationRef(options.db,request.branchId,request.operationId);
    const existing=await manifestDocument.get();
    if(existing.exists){
      const manifest=existing.data()||{};
      assertManifestFingerprint(manifest,fingerprint);
      if(manifest.status==="committed") return resultFromManifest(manifest);
    }

    const plan=await deriveChanges({db:options.db,request,actor});
    const commitResult=await commitV2Mutation({
      db:options.db,request,actor,changes:plan.changes,
      fingerprint,now:now(),serverTimestamp,
    });
    if(commitResult.recoveryState!=="pending") return commitResult;
    const recovery=await applyV1Recovery({
      db:options.db,branchId:request.branchId,operationId:request.operationId,
      legacyValues:plan.legacyValues,resolveRecoveryValues,clock:now,now:now(),serverTimestamp,
    });
    return {...commitResult,recoveryState:recovery.recoveryState};
  }

  async function recoverOperationalMirrors(input={}){
    const perBranchLimit=Math.max(1,Math.min(
      DEFAULT_RECOVERY_LIMIT,Number(input.perBranchLimit||DEFAULT_RECOVERY_LIMIT)||DEFAULT_RECOVERY_LIMIT,
    ));
    const summary={applied:0,error:0,skipped:0};
    for(const branchId of BRANCH_IDS){
      const recoveryNow=normalizeNow(now());
      const candidates=await recoveryCandidates(options.db,branchId,perBranchLimit,recoveryNow);
      for(const manifest of candidates){
        if(manifest.status!=="committed"){
          summary.skipped+=1;
          continue;
        }
        const result=await applyV1Recovery({
          db:options.db,branchId,operationId:manifest.operationId,
          resolveRecoveryValues,clock:now,now:recoveryNow,serverTimestamp,
        });
        if(result.recoveryState==="applied") summary.applied+=1;
        else if(result.recoveryState==="error") summary.error+=1;
        else summary.skipped+=1;
      }
    }
    return summary;
  }

  async function processRequestRecovery(branchId,operationId){
    return withRequestRecoveryLock(branchId,operationId,async()=>{
      const workerInput={db:options.db,now,serverTimestamp};
      const claim=await claimRequestRecovery(workerInput,branchId,operationId);
      if(claim.state!=="processing"||!text(claim.leaseId)) return requestRecoveryResponse(claim,operationId);
      try{
        return await applyClaimedRequestRecovery(workerInput,claim);
      }catch(error){
        return requestRecoveryResponse(claim,operationId);
      }
    });
  }

  async function recoverRequestPatches(input={}){
    const branches=input.branchId?[text(input.branchId)]:BRANCH_IDS;
    if(branches.some(branchId=>!BRANCH_IDS.includes(branchId))) fail("invalid-argument");
    const limit=Math.max(1,Math.min(REQUEST_RECOVERY_LIMIT,Number(input.limit||REQUEST_RECOVERY_LIMIT)||REQUEST_RECOVERY_LIMIT));
    const cleanupLimit=Math.max(1,Math.min(100,Number(input.cleanupLimit||50)||50));
    const summary={completed:0,conflict:0,waiting:0,error:0,rejected:0,skipped:0,cleaned:0};
    for(const branchId of branches){
      summary.cleaned+=await cleanupTerminalRequestRecoveries({
        db:options.db,branchId,limit:cleanupLimit,now:normalizeNow(now()),
      });
      const candidates=await requestRecoveryCandidates(options.db,branchId,limit);
      for(const candidate of candidates){
        const result=await processRequestRecovery(branchId,candidate.operationId);
        if(result.state==="completed") summary.completed+=1;
        else if(result.state==="conflict") summary.conflict+=1;
        else if(result.state==="waiting-primary") summary.waiting+=1;
        else if(result.state==="rejected"||result.code==="invalid-record") summary.rejected+=1;
        else if(result.state==="error") summary.error+=1;
        else summary.skipped+=1;
      }
    }
    return summary;
  }

  async function manageRequestRecovery(callableRequest){
    const command=policy.validateRequestRecoveryCommand(callableRequest?.data);
    policy.authorizeRequestRecovery(callableRequest,command);
    if(command.action==="stage"){
      return stageRequestRecovery({db:options.db,now:now(),serverTimestamp},command);
    }
    if(command.action==="status"){
      const status=await readOperationalStatus({db:options.db,branchId:command.branchId});
      return {
        operationId:"",state:"status",attempts:0,code:"",
        counts:{
          staged:status.requestRecoveryStagedCount,
          waiting:status.requestRecoveryWaitingCount,
          processing:status.requestRecoveryProcessingCount,
          pending:status.requestRecoveryPendingCount,
          error:status.requestRecoveryErrorCount,
          completed:status.requestRecoveryCompletedCount,
          conflict:status.requestRecoveryConflictCount,
          cancelled:status.requestRecoveryCancelledCount,
          rejected:status.requestRecoveryRejectedCount,
        },
      };
    }
    if(command.operationId) return processRequestRecovery(command.branchId,command.operationId);
    const summary=await recoverRequestPatches({branchId:command.branchId});
    return {operationId:"",state:"drained",attempts:0,code:"",summary};
  }

  return Object.freeze({
    mutate,
    recoverOperationalMirrors,
    manageRequestRecovery,
    recoverRequestPatches,
    readOperationalStatus:branchId=>readOperationalStatus({db:options.db,branchId}),
  });
}

module.exports={
  authorizeMutation:policy.authorizeMutation,
  createOperationalWriter,
  commitV2Mutation,
  applyV1Recovery,
  readOperationalStatus,
  deriveChanges:deriveChangesDefault,
};
