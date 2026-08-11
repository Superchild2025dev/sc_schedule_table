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
const BRANCH_IDS=Object.freeze(["gagyeong","yongam"]);
const COLLECTIONS=Object.freeze(Object.values(model.DOMAIN_COLLECTIONS).flat());
const COLLECTION_SET=new Set(COLLECTIONS);
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
    ...counts,
  };
}

function assertWriteSizes(input,changes,counts,chunkCount){
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
  const changes=(Array.isArray(input.changes)?input.changes:[]).map(normalizeChange);
  if(changes.length>MAX_DOCUMENT_CHANGES) fail("resource-exhausted");
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
    if(completedChunks===originalChunkCount){
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

async function readGenerationCollections(db,branchId,generationId){
  const ref=generationRef(db,branchId,generationId);
  const collections={};
  for(const collection of COLLECTIONS){
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
    input.db,input.branchId,input.manifest.generationId,
  ));
  const root=model.legacyRootFromCollections({
    branchId:input.branchId,generationId:input.manifest.generationId,collections,
  });
  if(!root) fail("failed-precondition");
  const values={};
  input.manifest.keys.forEach(key=>{
    if(!input.manifest.removedKeys.includes(key)&&Object.prototype.hasOwnProperty.call(root,key)){
      values[key]=root[key];
    }
  });
  return values;
}

function leaseExpiry(value){
  const expiry=Date.parse(text(value));
  return Number.isFinite(expiry)?expiry:0;
}

function assertRecoveryRevision(runtime,manifest){
  if(text(runtime.activeOperationId)) fail("failed-precondition");
  if(text(runtime.generationId)!==text(manifest.generationId)) fail("failed-precondition");
  if(Number(runtime.revision||0)!==Number(manifest.resultingRevision||0)) fail("failed-precondition");
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
    const runtimeDocument=runtimeRef(input.db,input.branchId);
    const fenceDocument=recoveryFenceRef(input.db,input.branchId);
    const runtimeSnapshot=await tx.get(runtimeDocument);
    const fenceSnapshot=await tx.get(fenceDocument);
    const snapshot=await tx.get(manifestDocument);
    if(!snapshot.exists) fail("not-found");
    const manifest=snapshot.data()||{};
    if(manifest.status!=="committed") fail("failed-precondition");
    if(["applied","not-required","superseded"].includes(manifest.recoveryState)) return null;
    const runtime=runtimeSnapshot.data()||{};
    const fence=fenceSnapshot.exists?fenceSnapshot.data()||{}:{};
    const operationLeaseActive=manifest.recoveryState==="processing"&&
      leaseExpiry(manifest.recoveryLeaseUntil)>input.now.getTime();
    if(operationLeaseActive) return null;
    const fenceLeaseActive=leaseExpiry(fence.recoveryLeaseUntil)>input.now.getTime();
    if(fenceLeaseActive&&text(fence.operationId)!==input.operationId) return {blocked:true};

    const expiredProcessing=manifest.recoveryState==="processing";
    const attempts=Math.max(0,Number(manifest.recoveryAttempts||0))+(expiredProcessing?1:0);
    if(attempts>=MAX_RECOVERY_ATTEMPTS){
      const exhausted=manifestWithRecoveryState(manifest,"error",input);
      exhausted.recoveryAttempts=MAX_RECOVERY_ATTEMPTS;
      exhausted.recoveryFailedAt=input.now.toISOString();
      tx.set(manifestDocument,exhausted,{merge:false});
      if(text(fence.operationId)===input.operationId) tx.set(fenceDocument,releasedFence(fence,input),{merge:false});
      return {terminal:true,recoveryState:"error"};
    }

    const resultingRevision=Number(manifest.resultingRevision||0);
    const appliedRevision=Math.max(0,Number(fence.appliedRevision||0)||0);
    const runtimeRevision=Math.max(0,Number(runtime.revision||0)||0);
    if(appliedRevision>resultingRevision||runtimeRevision>resultingRevision){
      tx.set(manifestDocument,manifestWithRecoveryState(manifest,"superseded",input),{merge:false});
      if(text(fence.operationId)===input.operationId) tx.set(fenceDocument,releasedFence(fence,input),{merge:false});
      return {terminal:true,recoveryState:"superseded"};
    }
    if(text(runtime.activeOperationId)||runtimeRevision!==resultingRevision||
        text(runtime.generationId)!==text(manifest.generationId)) return {blocked:true};
    const leaseId=crypto.randomUUID();
    const leaseUntil=new Date(input.now.getTime()+RECOVERY_LEASE_MS).toISOString();
    const next={
      ...manifest,recoveryState:"processing",recoveryLeaseId:leaseId,
      recoveryLeaseUntil:leaseUntil,recoveryAttempts:attempts,
      recoveryStartedAt:input.now.toISOString(),updatedAt:serverTime(input),
    };
    tx.set(manifestDocument,next,{merge:false});
    tx.set(fenceDocument,{
      ...fence,branchId:input.branchId,operationId:input.operationId,
      resultingRevision,recoveryLeaseId:leaseId,recoveryLeaseUntil:leaseUntil,
      updatedAt:serverTime(input),
    },{merge:false});
    return {...next,recoveryLeaseId:leaseId};
  });
}

async function finishRecovery(input,manifestDocument,claim,state,error){
  const diagnostic=error?policy.redactedDiagnostic(error,{
    branchId:input.branchId,operationId:input.operationId,
    operationType:claim.operationType,keyCount:claim.keys.length,
    changeCount:claim.changeCount,now:input.now,
  }):null;
  return input.db.runTransaction(async tx=>{
    const runtimeDocument=runtimeRef(input.db,input.branchId);
    const fenceDocument=recoveryFenceRef(input.db,input.branchId);
    const runtimeSnapshot=await tx.get(runtimeDocument);
    const fenceSnapshot=await tx.get(fenceDocument);
    const snapshot=await tx.get(manifestDocument);
    const current=snapshot.data()||{};
    if(text(current.recoveryLeaseId)!==claim.recoveryLeaseId) return current.recoveryState;
    const fence=fenceSnapshot.data()||{};
    const ownsFence=text(fence.recoveryLeaseId)===claim.recoveryLeaseId&&
      text(fence.operationId)===input.operationId;
    let finalState=state;
    if(state==="applied"){
      const runtime=runtimeSnapshot.data()||{};
      const exactRevision=!text(runtime.activeOperationId)&&
        text(runtime.generationId)===text(claim.generationId)&&
        Number(runtime.revision||0)===Number(claim.resultingRevision||0);
      if(!ownsFence||!exactRevision){
        finalState=Number(runtime.revision||0)>Number(claim.resultingRevision||0)?"superseded":"error";
      }
    }
    const attempts=finalState==="error"
      ?Math.min(MAX_RECOVERY_ATTEMPTS,Math.max(0,Number(current.recoveryAttempts||0))+1)
      :Math.max(0,Number(current.recoveryAttempts||0));
    const next=manifestWithRecoveryState(current,finalState,input);
    next.recoveryAttempts=attempts;
    if(finalState==="applied"){
      next.recoveryAppliedAt=serverTime(input);
      delete next.diagnostic;
    }else if(finalState==="error"){
      next.recoveryFailedAt=input.now.toISOString();
      next.diagnostic=diagnostic;
    }
    tx.set(manifestDocument,next,{merge:false});
    if(ownsFence){
      const nextFence=releasedFence(fence,input);
      if(finalState==="applied"){
        nextFence.appliedRevision=Number(claim.resultingRevision||0);
        nextFence.appliedOperationId=input.operationId;
        nextFence.appliedAt=serverTime(input);
      }
      tx.set(fenceDocument,nextFence,{merge:false});
    }
    return finalState;
  });
}

async function writeRecoveryKey(input,claim,key,values,manifestDocument){
  const runtimeDocument=runtimeRef(input.db,input.branchId);
  const fenceDocument=recoveryFenceRef(input.db,input.branchId);
  const ref=legacyKeyRef(input.db,input.branchId,key);
  return input.db.runTransaction(async tx=>{
    const runtimeSnapshot=await tx.get(runtimeDocument);
    const fenceSnapshot=await tx.get(fenceDocument);
    const manifestSnapshot=await tx.get(manifestDocument);
    const previous=await tx.get(ref);
    const fence=fenceSnapshot.data()||{};
    const manifest=manifestSnapshot.data()||{};
    assertRecoveryRevision(runtimeSnapshot.data()||{},claim);
    if(text(fence.recoveryLeaseId)!==claim.recoveryLeaseId||
        text(fence.operationId)!==input.operationId||
        Number(fence.resultingRevision||0)!==Number(claim.resultingRevision||0)||
        leaseExpiry(fence.recoveryLeaseUntil)<=input.now.getTime()||
        text(manifest.recoveryLeaseId)!==claim.recoveryLeaseId||manifest.recoveryState!=="processing"){
      fail("failed-precondition");
    }
    if(claim.removedKeys.includes(key)){
      deleteLegacyValue(tx,input,key,previous.exists?previous.data()||{}:null);
    }else{
      if(!Object.prototype.hasOwnProperty.call(values,key)) fail("failed-precondition");
      writeLegacyValue(tx,input,key,values[key],previous.exists?previous.data()||{}:null);
    }
  });
}

async function applyV1Recovery(rawInput){
  const input={...rawInput,now:normalizeNow(rawInput.now)};
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
  try{
    const values=input.legacyValues||await input.resolveRecoveryValues(input);
    for(const key of claim.keys){
      await writeRecoveryKey(input,claim,key,values,manifestDocument);
    }
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
  async function countState(state){
    const query=collection.where("status","==","committed").where("recoveryState","==",state);
    if(typeof query.count==="function"){
      const snapshot=await query.count().get();
      return Math.max(0,Number(snapshot.data()?.count||0)||0);
    }
    const snapshot=await query.get();
    return Math.max(0,Number(snapshot.size||snapshot.docs?.length||0)||0);
  }
  const [recoveryPendingCount,recoveryErrorCount,recoveryProcessingCount]=await Promise.all([
    countState("pending"),countState("error"),countState("processing"),
  ]);
  return {
    branchId:input.branchId,
    mode:text(runtimeSnapshot.data()?.mode)||"v1",
    generationId:text(runtimeSnapshot.data()?.generationId),
    epoch:Math.max(0,Number(runtimeSnapshot.data()?.epoch||0)||0),
    revision:Math.max(0,Number(runtimeSnapshot.data()?.revision||0)||0),
    recoveryPendingCount,
    recoveryErrorCount,
    recoveryProcessingCount,
  };
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
      legacyValues:plan.legacyValues,resolveRecoveryValues,now:now(),serverTimestamp,
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
          resolveRecoveryValues,now:recoveryNow,serverTimestamp,
        });
        if(result.recoveryState==="applied") summary.applied+=1;
        else if(result.recoveryState==="error") summary.error+=1;
        else summary.skipped+=1;
      }
    }
    return summary;
  }

  return Object.freeze({
    mutate,
    recoverOperationalMirrors,
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
