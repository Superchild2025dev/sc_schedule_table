"use strict";

const fs=require("node:fs");
const path=require("node:path");

const ROOT=path.join(__dirname,"..");
require(path.join(ROOT,"js","schedule-time.js"));
require(path.join(ROOT,"js","schedule-schema-v2.js"));
require(path.join(ROOT,"js","schedule-v2-operational-model.js"));
require(path.join(ROOT,"js","schedule-v2-store.js"));
require(path.join(ROOT,"js","attendance-v2-model.js"));
require(path.join(ROOT,"js","attendance-v2-store.js"));
require(path.join(ROOT,"js","attendance-operational-gateway.js"));
require(path.join(ROOT,"js","attendance-main-runtime.js"));

const schema=globalThis.SCScheduleSchemaV2;
const model=globalThis.SCV2OperationalModel;
const storeApi=require(path.join(ROOT,"js","schedule-v2-operational-store.js"));
const gatewayApi=require(path.join(ROOT,"js","schedule-operational-gateway.js"));
const liveHandlersApi=require(path.join(ROOT,"js","schedule-live-handlers.js"));
const snapshotWriterApi=require(path.join(ROOT,"js","attendance-snapshot-writer.js"));
const operational=require(path.join(ROOT,"functions","schedule-v2-operational-writer.js"));
const attendanceStoreApi=globalThis.SCV2AttendanceStore;
const attendanceGatewayApi=globalThis.SCOperationalAttendance;
const attendanceRuntimeApi=globalThis.SCMainAttendanceRuntime;
const attendanceModel=globalThis.SCV2AttendanceModel;

const COLLECTIONS=Object.freeze(Object.values(model.DOMAIN_COLLECTIONS).flat());
const NOW=new Date("2026-08-11T03:00:00.000Z");

function clone(value){
  return value===undefined?undefined:JSON.parse(JSON.stringify(value));
}

function safeDocId(value){
  return encodeURIComponent(String(value)).replace(/\./g,"%2E");
}

class Snapshot{
  constructor(ref,value){
    this.ref=ref;
    this.id=ref.id;
    this.exists=value!==undefined;
    this.value=clone(value);
  }
  data(){return clone(this.value);}
  get(field){return clone(this.value?.[field]);}
  val(){return clone(this.value);}
}

class QuerySnapshot{
  constructor(docs){this.docs=docs;this.size=docs.length;this.empty=!docs.length;}
  forEach(visitor){this.docs.forEach(visitor);}
}

class QueryRef{
  constructor(collection,filters=[],order=null,maximum=Infinity,after=null){
    this.collection=collection;
    this.filters=filters;
    this.order=order;
    this.maximum=maximum;
    this.after=after;
    this.path=collection.path;
  }
  where(field,operator,value){
    return new QueryRef(this.collection,[...this.filters,[field,operator,clone(value)]],this.order,this.maximum,this.after);
  }
  orderBy(field,direction="asc"){
    return new QueryRef(this.collection,this.filters,[field,direction],this.maximum,this.after);
  }
  limit(maximum){return new QueryRef(this.collection,this.filters,this.order,maximum,this.after);}
  startAfter(snapshot){return new QueryRef(this.collection,this.filters,this.order,this.maximum,snapshot);}
  count(){
    const query=this;
    return {get:async()=>{
      const snapshot=await query.get();
      return {data:()=>({count:snapshot.size})};
    }};
  }
  async get(){
    let docs=this.collection.directDocs().filter(doc=>this.filters.every(([field,operator,want])=>{
      const actual=doc.data()?.[field];
      if(operator==="==") return actual===want;
      if(operator==="in") return Array.isArray(want)&&want.includes(actual);
      if(operator===">=") return actual>=want;
      if(operator==="<="){
        const actualTime=Date.parse(String(actual??""));
        const wantedTime=want instanceof Date?want.getTime():Date.parse(String(want??""));
        return Number.isFinite(actualTime)&&Number.isFinite(wantedTime)&&actualTime<=wantedTime;
      }
      throw new Error(`unsupported query operator: ${operator}`);
    }));
    if(this.order){
      const [field,direction]=this.order;
      docs.sort((left,right)=>String(left.data()?.[field]??"").localeCompare(String(right.data()?.[field]??""))*(direction==="desc"?-1:1));
    }
    if(this.after){
      const index=docs.findIndex(doc=>doc.id===this.after.id);
      if(index>=0) docs=docs.slice(index+1);
    }
    docs=docs.slice(0,this.maximum);
    return new QuerySnapshot(docs);
  }
}

class DocumentRef{
  constructor(db,documentPath){this.db=db;this.path=documentPath;this.id=documentPath.split("/").pop();}
  collection(name){return new CollectionRef(this.db,`${this.path}/${name}`);}
  async get(){return new Snapshot(this,this.db.docs.get(this.path));}
  onSnapshot(next,error){return this.db.subscribe(this.path,next,error);}
}

class CollectionRef extends QueryRef{
  constructor(db,collectionPath){
    const holder={path:collectionPath};
    super(holder);
    this.db=db;
    this.path=collectionPath;
    this.collection=this;
  }
  doc(id){return new DocumentRef(this.db,`${this.path}/${id}`);}
  directDocs(){
    const prefix=this.path+"/";
    const docs=[];
    for(const [documentPath,value] of this.db.docs){
      const suffix=documentPath.startsWith(prefix)?documentPath.slice(prefix.length):"";
      if(suffix&&!suffix.includes("/")) docs.push(new Snapshot(new DocumentRef(this.db,documentPath),value));
    }
    return docs;
  }
}

class InMemoryFirestore{
  constructor(initial={}){
    this.docs=new Map(Object.entries(initial).map(([key,value])=>[key,clone(value)]));
    this.listeners=new Map();
    this.transactions=[];
    this.batches=[];
    this.transactionTail=Promise.resolve();
    this.failNextLegacyTransactions=0;
    this.legacyTransactions=0;
  }
  collection(name){return new CollectionRef(this,String(name));}
  value(documentPath){return clone(this.docs.get(documentPath));}
  subscribe(documentPath,next){
    if(!this.listeners.has(documentPath)) this.listeners.set(documentPath,new Set());
    const listeners=this.listeners.get(documentPath);
    listeners.add(next);
    next(new Snapshot(new DocumentRef(this,documentPath),this.docs.get(documentPath)));
    return ()=>listeners.delete(next);
  }
  notify(paths){
    [...new Set(paths)].forEach(documentPath=>{
      const snapshot=new Snapshot(new DocumentRef(this,documentPath),this.docs.get(documentPath));
      this.listeners.get(documentPath)?.forEach(listener=>listener(snapshot));
    });
  }
  apply(operations){
    const changed=[];
    operations.forEach(operation=>{
      changed.push(operation.ref.path);
      if(operation.type==="delete"){
        this.docs.delete(operation.ref.path);
        return;
      }
      const current=this.docs.get(operation.ref.path);
      const next=operation.options?.merge&&current&&typeof current==="object"
        ?{...clone(current),...clone(operation.value)}
        :clone(operation.value);
      this.docs.set(operation.ref.path,next);
    });
    this.notify(changed);
  }
  batch(){
    const operations=[];
    return {
      set:(ref,value,options)=>operations.push({type:"set",ref,value:clone(value),options}),
      delete:ref=>operations.push({type:"delete",ref}),
      commit:async()=>{this.batches.push(operations);this.apply(operations);},
    };
  }
  async runTransaction(visitor){
    const prior=this.transactionTail;
    let release;
    this.transactionTail=new Promise(resolve=>{release=resolve;});
    await prior;
    const operations=[];
    const attempt={reads:[],operations};
    this.transactions.push(attempt);
    const tx={
      get:async ref=>{
        attempt.reads.push(ref.path);
        if(ref instanceof QueryRef) return ref.get();
        return new Snapshot(ref,this.docs.get(ref.path));
      },
      set:(ref,value,options)=>operations.push({type:"set",ref,value:clone(value),options}),
      delete:ref=>operations.push({type:"delete",ref}),
    };
    try{
      const result=await visitor(tx);
      if(operations.some(operation=>operation.ref.path.startsWith("scheduleStores/"))){
        this.legacyTransactions+=1;
        if(this.failNextLegacyTransactions>0){
          this.failNextLegacyTransactions-=1;
          throw Object.assign(new Error("forced local mirror failure"),{code:"unavailable"});
        }
      }
      this.apply(operations);
      return result;
    }finally{
      release();
    }
  }
}

function legacyFixture(branchId){
  const label=branchId==="gagyeong"?"G":"Y";
  return {
    swim_tab_list:JSON.stringify([
      {id:"regular",name:`${label} Regular`,type:"regular",periodMonth:"2026-08"},
      {id:"summer",name:`${label} Summer`,type:"bangteuk",periodMonth:"2026-08",seasonStart:"2026-08-03",seasonEnd:"2026-08-28"},
    ]),
    swim_main_tab:JSON.stringify({tabId:"regular",month:"2026-08"}),
    swim_parent_tab:JSON.stringify({tabId:"regular"}),
    swim_students:JSON.stringify([
      {sid:`${label}_r1`,n:`${label} Regular One`,p:"01000000001",t:"4PM",d:"Mon",l:1,r:1},
      {sid:`${label}_r2`,n:`${label} Regular Two`,p:"01000000002",t:"5PM",d:"Tue",l:1,r:1},
    ]),
    swim_inst:JSON.stringify({"4PM/Mon/1":`${label} Teacher A`,"5PM/Tue/1":`${label} Teacher B`}),
    swim_bt_summer_stu:JSON.stringify([
      {sid:`${label}_b1`,n:`*${label} Camp One`,p:"01000000003",t:"10AM",d:"MonWedFri",l:2,r:1,btWeek5:true},
      {sid:`${label}_b2`,n:`${label} Camp Two`,p:"01000000004",t:"11AM",d:"TueThu",l:1,r:1},
    ]),
    swim_bt_summer_inst:JSON.stringify({"10AM/MonWedFri/2":`${label} Camp Teacher A`,"11AM/TueThu/1":`${label} Camp Teacher B`}),
    swim_retire:JSON.stringify({}),
    swim_enroll:JSON.stringify({}),
    swim_hyuwon:JSON.stringify({}),
    swim_move:JSON.stringify({}),
    swim_reserve:JSON.stringify({}),
    swim_mark:JSON.stringify({}),
    swim_attendance:JSON.stringify({}),
    swim_att_guests:JSON.stringify({}),
    swim_bt_attendance_summer:JSON.stringify({}),
    swim_bt_att_guests_summer:JSON.stringify({}),
    swim_day_snapshot:JSON.stringify({}),
    swim_bt_day_snapshot_summer:JSON.stringify({}),
    swim_disabled:JSON.stringify({}),
    swim_closed:JSON.stringify([]),
    swim_periods:JSON.stringify([{month:8,start:"2026-08-03",end:"2026-08-28"}]),
    swim_teachers:JSON.stringify([{id:`${label}_teacher_a`,n:`${label} Teacher A`,color:"#335577"}]),
    swim_tab_folders:JSON.stringify([]),
    swim_archived_tabs:JSON.stringify([]),
    swim_age_year:JSON.stringify(2026),
    swim_student_id_version:JSON.stringify("v3"),
    swim_ver:JSON.stringify(1),
    swim_retire_history:JSON.stringify([]),
    swim_desk_notes:JSON.stringify([]),
  };
}

function runtimePath(branchId,name){return `scheduleV2/${branchId}/runtime/${name}`;}
function generationPath(branchId,generationId){return `scheduleV2/${branchId}/generations/${generationId}`;}
function generationDocumentPath(branchId,generationId,collection,id){
  return `${generationPath(branchId,generationId)}/${collection}/${safeDocId(id)}`;
}
function legacyPath(branchId,key){return `scheduleStores/${branchId}/kv/${safeDocId(key)}`;}
function mutationPath(branchId,operationId){return `scheduleV2/${branchId}/operationalMutations/${operationId}`;}

function seedBranch(target,branchId,mode="verify"){
  const generationId=`gen_${branchId}`;
  const root=legacyFixture(branchId);
  const report=schema.diagnoseLegacyRoot(branchId,root);
  if(!report?.checks?.ready||!report.conversion){
    throw new Error(`invalid fixture for ${branchId}: ${JSON.stringify(report?.issues||[])}`);
  }
  target[runtimePath(branchId,"schedule")]=clonedPointer({branchId,mode,generationId,requiresPrepare:false});
  target[runtimePath(branchId,"scheduleSync")]= {
    generationId,status:"idle",pendingKeys:[],inFlightKeys:[],mismatchCount:0,
    requestedRevision:0,appliedRevision:0,
  };
  target[runtimePath(branchId,"operational")]=clonedPointer({branchId,mode,generationId,epoch:3,revision:0});
  target[runtimePath(branchId,"attendance")]=clonedPointer({branchId,mode,generationId,epoch:3,revision:0});
  target[generationPath(branchId,generationId)]={
    id:generationId,branchId,generationId,status:"ready",
    capabilities:{
      schedule:{status:"ready",requestedRevision:0,appliedRevision:0,verifiedAt:NOW.toISOString()},
      attendance:{status:"ready",appliedRevision:0,verifiedAt:NOW.toISOString()},
    },
  };
  for(const collection of COLLECTIONS){
    const rows=report.conversion[collection]||[];
    for(const row of rows){
      target[generationDocumentPath(branchId,generationId,collection,row.id)]={
        ...clone(row),branchId,generationId,operationalRevision:0,
      };
    }
  }
  for(const [key,value] of Object.entries(root)){
    target[legacyPath(branchId,key)]={key,value,chunked:false,branchId};
  }
  return {generationId,root};
}

function clonedPointer(value){return clone(value);}

function developerRequest(data){
  const email="developer@scswim.local";
  return {data,auth:{uid:`uid-${email}`,token:{email,email_verified:true}}};
}

function functionWrapper(options,handler){handler.__options=options;return handler;}

function loadManagement(db){
  const indexPath=path.join(ROOT,"functions","index.js");
  const functionsDir=path.dirname(indexPath);
  class HttpsError extends Error{
    constructor(code,message){super(message);this.code=code;}
  }
  const localRequire=request=>{
    if(request==="firebase-functions/v2/https") return {onCall:functionWrapper,onRequest:functionWrapper,HttpsError};
    if(request==="firebase-functions/v2/firestore") return {onDocumentWritten:functionWrapper};
    if(request==="firebase-functions/v2/scheduler") return {onSchedule:functionWrapper};
    if(request==="firebase-functions/v2") return {setGlobalOptions:()=>{}};
    if(request==="firebase-functions/logger") return {error:()=>{}};
    if(request==="firebase-admin/app") return {initializeApp:()=>{}};
    if(request==="firebase-admin/firestore") return {
      getFirestore:()=>db,
      FieldValue:{serverTimestamp:()=>"server-time",delete:()=>"delete",increment:value=>({increment:value})},
      Timestamp:{
        now:()=>({toDate:()=>cloneDate(NOW)}),
        fromMillis:value=>({toDate:()=>new Date(value)}),
      },
    };
    if(request==="./regular-availability") return {buildRegularAvailability:()=>({})};
    if(request==="./schedule-v2-shadow-runner.js") return {runShadowSync:async()=>({collections:[],writes:0,deletes:0,counts:{},digests:{}})};
    if(request.startsWith("./")) return require(path.join(functionsDir,request));
    return require(request);
  };
  const source=fs.readFileSync(indexPath,"utf8");
  const module={exports:{}};
  new Function("exports","require","module","__filename","__dirname",source)(
    module.exports,localRequire,module,indexPath,functionsDir,
  );
  return module.exports;
}

function cloneDate(value){return new Date(value.getTime());}

function legacyRootAdapter(db,branchId){
  function values(){
    const root={};
    const prefix=`scheduleStores/${branchId}/kv/`;
    for(const [documentPath,item] of db.docs){
      const suffix=documentPath.startsWith(prefix)?documentPath.slice(prefix.length):"";
      if(suffix&&!suffix.includes("/")&&item?.key) root[item.key]=clone(item.value);
    }
    return root;
  }
  async function transactionKeys(keys,mutator){
    const current=values();
    const selected={};
    keys.forEach(key=>{if(Object.hasOwn(current,key)) selected[key]=clone(current[key]);});
    const draft=clone(selected);
    const returned=await mutator(draft);
    if(returned===undefined) return {committed:false,snapshot:new Snapshot({id:"legacy"},null)};
    const next=returned&&typeof returned==="object"?returned:draft;
    keys.forEach(key=>{
      const documentPath=legacyPath(branchId,key);
      if(!Object.hasOwn(next,key)) db.docs.delete(documentPath);
      else db.docs.set(documentPath,{key,value:clone(next[key]),chunked:false,branchId});
    });
    return {committed:true,snapshot:new Snapshot({id:"legacy"},next)};
  }
  return {
    once:async()=>new Snapshot({id:branchId},values()),
    transactionKeys,
    child:key=>({once:async()=>new Snapshot({id:key},values()[key])}),
  };
}

function storedCollections(db,branchId,generationId){
  const collections={};
  for(const name of COLLECTIONS){
    const prefix=`${generationPath(branchId,generationId)}/${name}/`;
    collections[name]=[];
    for(const [documentPath,stored] of db.docs){
      const suffix=documentPath.startsWith(prefix)?documentPath.slice(prefix.length):"";
      if(!suffix||suffix.includes("/")) continue;
      const row=clone(stored);
      delete row.branchId;
      delete row.generationId;
      delete row.operationalRevision;
      delete row.lastOperationId;
      if(name==="attendanceSnapshots") delete row.complete;
      collections[name].push(row);
    }
  }
  return collections;
}

function reconstructV2(db,branchId,generationId){
  return model.legacyRootFromCollections({
    branchId,generationId,collections:storedCollections(db,branchId,generationId),
  });
}

function legacyValues(db,branchId){return legacyRootAdapter(db,branchId).once("value").then(snapshot=>snapshot.val());}

function createDeriveBarrier(count){
  if(!count) return null;
  let reached=0;
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  return async input=>{
    const plan=await operational.deriveChanges(input);
    reached+=1;
    if(reached===count) release();
    if(reached<=count) await gate;
    return plan;
  };
}

function createOperationalSystem(options={}){
  const branches=options.branches||["gagyeong","yongam"];
  const initial={};
  const branchInfo={};
  branches.forEach(branchId=>{branchInfo[branchId]=seedBranch(initial,branchId,options.mode||"verify");});
  const db=new InMemoryFirestore(initial);
  const writer=operational.createOperationalWriter({
    db,now:()=>cloneDate(NOW),serverTimestamp:()=>"server-time",
    ...(options.deriveBarrierCount?{deriveChanges:createDeriveBarrier(options.deriveBarrierCount)}:{}),
  });
  const management=loadManagement(db);
  let operationSequence=0;
  const coordinationEvents=new Map();

  function recordCoordination(branchId,event){
    const events=coordinationEvents.get(branchId)||[];
    events.push(clone(event));
    coordinationEvents.set(branchId,events);
  }

  function gateway(branchId){
    const v2Store=storeApi.create({db,branchId,model});
    return gatewayApi.create({
      branchId,legacyRoot:legacyRootAdapter(db,branchId),v2Store,model,
      mutate:data=>writer.mutate(developerRequest(data)),
      makeOperationId:()=>`task7_${branchId}_${++operationSequence}`,
      now:()=>cloneDate(NOW),
    });
  }
  function liveHandlers(branchId){
    const operationalGateway=gateway(branchId);
    const snapshotWriter=snapshotWriterApi.create({
      branchId,
      read:async key=>(await operationalGateway.child(key).once("value")).val(),
      write:(key,value,meta)=>operationalGateway.child(key).set(value,meta),
      normalize:value=>clone(value),
    });
    const transactionContext=(keys,mutator,meta)=>{
      let abortReason="";
      const touched=new Set();
      const allowed=new Set(keys);
      return operationalGateway.transactionKeys(keys,root=>{
        const context={
          get(key,fallback){
            if(!allowed.has(key)) throw new Error(`transaction key missing: ${key}`);
            try{return JSON.parse(root[key]);}
            catch(error){return clone(fallback);}
          },
          set(key,value){
            if(!allowed.has(key)) throw new Error(`transaction key missing: ${key}`);
            root[key]=JSON.stringify(clone(value));touched.add(key);
          },
          abort(reason){abortReason=String(reason||"");},
        };
        const result=mutator(context);
        if(result===undefined) return undefined;
        return root;
      },meta).then(result=>{
        if(!result?.committed) throw new Error(abortReason||"transaction aborted");
        recordCoordination(branchId,{
          branch:"transaction-context",keys:[...keys],operationId:meta?.operationId,
          operationType:meta?.operationType,touched:[...touched],metadata:meta,
        });
        return result;
      });
    };
    const attendanceStore=attendanceStoreApi.create({
      db,branchId,now:()=>cloneDate(NOW),
      mutate:data=>writer.mutate(developerRequest(data)),
    });
    const legacyAttendance={
      async loadRange(){return {attendance:{},guests:{}};},
      async updateAttendance(){throw new Error("V1 attendance path is not expected in V2-read scenario");},
      async updateGuests(){throw new Error("V1 attendance path is not expected in V2-read scenario");},
    };
    const attendanceGateway=attendanceGatewayApi.create({
      branchId,legacy:legacyAttendance,v2Store:attendanceStore,model:attendanceModel,now:()=>cloneDate(NOW),
    });
    const attendanceRuntimes=new Map();
    const getAttendanceRuntime=context=>{
      const tabId=String(context?.tabId||"regular");
      recordCoordination(branchId,{
        branch:"attendance-runtime",tabId,courseType:context?.courseType,
        operationId:context?.operationId,operationType:context?.operationType,
      });
      if(attendanceRuntimes.has(tabId)) return attendanceRuntimes.get(tabId);
      let maps={attendance:{},guests:{}};
      const runtime=attendanceRuntimeApi.create({
        branchId,gateway:attendanceGateway,prepareKeys:async()=>{},
        getMaps:()=>clone(maps),setMaps:next=>{maps=clone(next);},
      });
      const ready=runtime.ready();
      const liveRuntime={
        async updateAttendance(mutator,input){await ready;return runtime.updateAttendance(mutator,input);},
        async updateGuests(mutator,input){await ready;return runtime.updateGuests(mutator,input);},
      };
      attendanceRuntimes.set(tabId,liveRuntime);
      return liveRuntime;
    };
    return liveHandlersApi.create({
      gateway:operationalGateway,snapshotWriter,transactionContext,getAttendanceRuntime,
    });
  }
  async function transition(branchId,action){
    const runtime=db.value(runtimePath(branchId,"operational"));
    return management.manageScheduleV2Shadow(developerRequest({
      action,branchId,expectedMode:runtime.mode,expectedGenerationId:runtime.generationId,
      expectedEpoch:runtime.epoch,expectedRevision:runtime.revision,
    }));
  }
  return {
    db,writer,management,branchInfo,gateway,liveHandlers,transition,
    reconstructV2:branchId=>reconstructV2(db,branchId,branchInfo[branchId].generationId),
    legacyValues:branchId=>legacyValues(db,branchId),
    runtime:(branchId,name="operational")=>db.value(runtimePath(branchId,name)),
    manifest:(branchId,operationId)=>db.value(mutationPath(branchId,operationId)),
    coordinationTrace:branchId=>clone(coordinationEvents.get(branchId)||[]),
  };
}

function parse(root,key,fallback){
  try{return JSON.parse(root[key]);}catch(error){return clone(fallback);}
}

function completeSelection(root){
  return {
    tabIds:["regular","summer"],
    domains:Object.keys(model.DOMAIN_COLLECTIONS),
    keys:Object.keys(root).filter(key=>model.domainForLegacyKey(key)),
    dateRange:{from:"2026-08-01",to:"2026-08-31"},
  };
}

module.exports={
  clone,model,schema,NOW,InMemoryFirestore,createOperationalSystem,developerRequest,
  legacyFixture,runtimePath,generationPath,generationDocumentPath,legacyPath,mutationPath,
  parse,completeSelection,
};
