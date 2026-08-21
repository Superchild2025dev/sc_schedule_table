"use strict";

const crypto=require("node:crypto");

require("./schedule-v2-operational-model.js");

const model=globalThis.SCV2OperationalModel;
const COLLECTIONS=Object.freeze(Object.values(model.DOMAIN_COLLECTIONS).flat());
const MAX_CHUNKS=10000;

function text(value){return String(value==null?"":value).trim();}
function clone(value){return value===undefined?undefined:JSON.parse(JSON.stringify(value));}
function decodeDocId(value){
  const encoded=text(value).replace(/%2E/gi,".");
  try{return decodeURIComponent(encoded);}catch(error){return encoded;}
}
function digest(value){
  return crypto.createHash("sha256").update(model.canonicalDigest(value),"utf8").digest("hex");
}
function storageFreeRow(name,doc){
  const value=clone(doc.data()||{});
  delete value.branchId;
  delete value.generationId;
  delete value.operationalRevision;
  delete value.lastOperationId;
  if(name==="attendanceSnapshots") delete value.complete;
  if(!text(value.id)) value.id=decodeDocId(doc.id);
  return value;
}
function compareCanonicalParity(input){
  const legacyRoot=input?.legacyRoot&&typeof input.legacyRoot==="object"?input.legacyRoot:{};
  const collections=input?.collections&&typeof input.collections==="object"?input.collections:{};
  const v1View=model.trackedLegacyView(legacyRoot);
  const v2Root=model.legacyRootFromCollections({
    branchId:text(input?.branchId),generationId:text(input?.generationId),collections,
  });
  if(v2Root===null){
    throw Object.assign(new Error("invalid-v2-collection-graph"),{code:"failed-precondition"});
  }
  const v2View=model.trackedLegacyView(v2Root);
  const v1Digest=digest(v1View);
  const v2Digest=digest(v2View);
  return {
    matches:v1Digest===v2Digest,
    v1Digest,
    v2Digest,
    v1KeyCount:Object.keys(v1View).length,
    v2KeyCount:Object.keys(v2View).length,
  };
}
async function readLegacyDocument(doc){
  const value=doc.data()||{};
  if(value.chunked!==true) return clone(value.value??null);
  const count=Number(value.chunkCount);
  if(!Number.isSafeInteger(count)||count<0||count>MAX_CHUNKS){
    throw Object.assign(new Error("invalid-v1-chunk-count"),{code:"failed-precondition"});
  }
  const snapshot=await doc.ref.collection("chunks").get();
  const chunks=[];
  snapshot.forEach(chunk=>chunks.push({id:text(chunk.id),text:String(chunk.data()?.text||"")}));
  chunks.sort((left,right)=>left.id.localeCompare(right.id));
  if(chunks.length!==count){
    throw Object.assign(new Error("incomplete-v1-chunks"),{code:"failed-precondition"});
  }
  const serialized=chunks.map(chunk=>chunk.text).join("");
  if(value.valueType==="string"||value.isString===true) return serialized;
  try{return JSON.parse(serialized);}catch(error){
    throw Object.assign(new Error("invalid-v1-chunk-json"),{code:"failed-precondition"});
  }
}
async function readLegacyRoot(db,branchId){
  const snapshot=await db.collection("scheduleStores").doc(branchId).collection("kv").get();
  const root={};
  for(const doc of snapshot.docs||[]){
    const key=decodeDocId(doc.id);
    if(model.domainForLegacyKey(key)) root[key]=await readLegacyDocument(doc);
  }
  return root;
}
async function readGenerationCollections(db,branchId,generationId){
  const generationRef=db.collection("scheduleV2").doc(branchId)
    .collection("generations").doc(generationId);
  const collections={};
  for(const name of COLLECTIONS){
    const snapshot=await generationRef.collection(name).get();
    collections[name]=(snapshot.docs||[]).map(doc=>storageFreeRow(name,doc));
  }
  return collections;
}
async function readCanonicalParity(input){
  const db=input?.db;
  const branchId=text(input?.branchId);
  const generationId=text(input?.generationId);
  if(!db||typeof db.collection!=="function"||!branchId||!generationId){
    throw Object.assign(new Error("invalid-canonical-parity-input"),{code:"invalid-argument"});
  }
  const [legacyRoot,collections]=await Promise.all([
    readLegacyRoot(db,branchId),readGenerationCollections(db,branchId,generationId),
  ]);
  return compareCanonicalParity({branchId,generationId,legacyRoot,collections});
}

module.exports={compareCanonicalParity,readCanonicalParity};
