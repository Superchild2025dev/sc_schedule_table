"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const root=path.join(__dirname,"..");
const liveHandlersApi=require(path.join(root,"js","schedule-live-handlers.js"));

function source(file){return fs.readFileSync(path.join(root,file),"utf8");}
function functionSource(file,name){
  const value=source(file);
  const functionStart=value.indexOf(`function ${name}`);
  assert.notEqual(functionStart,-1,`${name} is missing from ${file}`);
  const asyncStart=value.lastIndexOf("async ",functionStart);
  const start=asyncStart>=0&&/^async\s+$/.test(value.slice(asyncStart,functionStart))?asyncStart:functionStart;
  const open=value.indexOf("{",functionStart);
  let depth=0;
  for(let index=open;index<value.length;index+=1){
    if(value[index]==="{") depth+=1;
    else if(value[index]==="}"&&--depth===0) return value.slice(start,index+1);
  }
  throw new Error(`${name} is incomplete in ${file}`);
}

function transactionalGateway(initial={}){
  let directCalls=0;
  const gateway={
    async transactionKeys(keys,mutator){
      directCalls+=1;
      const rootValue=JSON.parse(JSON.stringify(initial));
      const next=await mutator(rootValue);
      return {committed:next!==undefined,snapshot:{val:()=>next||rootValue}};
    },
  };
  return {gateway,directCalls:()=>directCalls};
}

function loadLiveFactory(updateScheduleTx,gateway){
  const context={
    window:{SCScheduleLiveHandlers:liveHandlersApi},
    SCScheduleLiveHandlers:liveHandlersApi,
    getBranchInfo:()=>({id:"gagyeong"}),
    getMainAttendanceSnapshotWriter:()=>({createOnly:async input=>input}),
    getOperationalAttendanceRuntime:()=>null,
    updateScheduleTx,
    _fb:gateway,
  };
  vm.createContext(context);
  vm.runInContext(
    `let _mainScheduleLiveHandlers=null;let _mainScheduleLiveHandlersBranch='';${functionSource("js/data.js","getMainScheduleLiveHandlers")};this.getHandlers=getMainScheduleLiveHandlers;`,
    context,
    {filename:"data-live-handler-factory.js"},
  );
  return context.getHandlers;
}

test("live replacement preserves complete transaction metadata at updateScheduleTx",async()=>{
  const bridgeCalls=[];
  const direct=transactionalGateway({swim_students:"[]"});
  const getHandlers=loadLiveFactory(async(keys,mutator,meta)=>{
    const state={swim_students:[]};
    const touched={};
    const tx={
      get:key=>JSON.parse(JSON.stringify(state[key])),
      set:(key,value)=>{state[key]=JSON.parse(JSON.stringify(value));touched[key]=true;},
      abort:reason=>{throw new Error(reason);},
    };
    const result=await mutator(tx);
    bridgeCalls.push({keys:[...keys],meta:JSON.parse(JSON.stringify(meta)),touched:Object.keys(touched)});
    return result;
  },direct.gateway);
  const transactionMetadata={
    type:"edit",
    label:"원생 교체",
    detail:"4PM/Mon/1/1 원생 교체",
    deleteReason:"student-replace",
    target:"Before -> After",
    skipUndo:true,
    skipAudit:true,
    skipDeleteSafety:false,
    bangteuk:true,
    futureMetadata:{source:"popup"},
  };

  await getHandlers().replaceScheduledStudents({
    keys:["swim_students"],
    operationId:"replace_metadata_1",
    operationType:"replace-student",
    tabIds:["summer"],
    requireOperationManifest:true,
    transactionMetadata,
    mutateContext:tx=>{tx.set("swim_students",[{sid:"fresh"}]);return true;},
  });

  assert.equal(direct.directCalls(),0);
  assert.deepEqual(bridgeCalls,[{
    keys:["swim_students"],
    meta:{
      ...transactionMetadata,
      operationId:"replace_metadata_1",
      operationType:"replace-student",
      tabIds:["summer"],
      requireOperationManifest:true,
    },
    touched:["swim_students"],
  }]);
});

test("context workflows refuse a generic gateway fallback",async()=>{
  const direct=transactionalGateway({swim_reserve:"{}"});
  const handlers=liveHandlersApi.create({gateway:direct.gateway});

  await assert.rejects(
    Promise.resolve().then(()=>handlers.setReservations({
      keys:["swim_reserve"],operationType:"update-reservation",tabIds:["regular"],
      mutateContext:tx=>{tx.set("swim_reserve",{});return true;},
    })),
    /transaction context/i,
  );
  assert.equal(direct.directCalls(),0);
});

test("attendance workflows refuse a generic schedule transaction fallback",async()=>{
  const direct=transactionalGateway({swim_attendance:"{}"});
  const handlers=liveHandlersApi.create({gateway:direct.gateway,transactionContext:()=>{
    throw new Error("schedule transaction must not handle attendance");
  }});

  await assert.rejects(
    Promise.resolve().then(()=>handlers.updateAttendance({
      mutator:attendance=>attendance,
      context:{owner:"attendance-main",tabId:"regular",courseType:"regular",dates:["2026-08-11"]},
    })),
    /attendance runtime/i,
  );
  assert.equal(direct.directCalls(),0);
});

class FakeClassList{
  constructor(className){this.values=new Set(String(className||"").split(/\s+/).filter(Boolean));}
  contains(value){return this.values.has(value);}
}

class FakeCell{
  constructor({text="",className="",dataset={}}={}){
    this.textContent=text;
    this.className=className;
    this.classList=new FakeClassList(className);
    this.dataset={...dataset};
    this.attributes=new Map();
    this.tagName="TD";
  }
  cloneNode(){
    const clone=new FakeCell({text:this.textContent,className:this.className,dataset:this.dataset});
    this.attributes.forEach((value,key)=>clone.attributes.set(key,value));
    return clone;
  }
  querySelectorAll(){return [];}
  setAttribute(key,value){this.attributes.set(key,String(value));}
  getAttribute(key){return this.attributes.has(key)?this.attributes.get(key):null;}
}

class FakeTable{
  constructor(cells){this.cells=cells;this.attributes=new Map();}
  cloneNode(){
    const clone=new FakeTable(this.cells.map(cell=>cell.cloneNode(true)));
    this.attributes.forEach((value,key)=>clone.attributes.set(key,value));
    return clone;
  }
  querySelectorAll(selector){
    if(selector==="th,td") return this.cells;
    if(selector.includes("data-inst-key")) return this.cells.filter(cell=>cell.dataset.instKey);
    if(selector.includes("data-ri")||selector.includes("stu-cell")||selector.includes("stu-clickable")){
      return this.cells.filter(cell=>cell.dataset.t&&cell.dataset.day&&cell.dataset.lane&&cell.dataset.ri);
    }
    return [];
  }
  setAttribute(key,value){this.attributes.set(key,String(value));}
  getAttribute(key){return this.attributes.has(key)?this.attributes.get(key):null;}
}

test("Excel conversion receives prepared V2 cell text instead of stale DOM text",async()=>{
  const sourceTable=new FakeTable([
    new FakeCell({text:"Stale Teacher",className:"inst-clickable",dataset:{instKey:"4PM/Mon/1"}}),
    new FakeCell({text:"Stale One",className:"stu-cell stu-clickable",dataset:{t:"4PM",day:"Mon",lane:"1",ri:"1"}}),
    new FakeCell({text:"Stale Two",className:"stu-cell stu-clickable",dataset:{t:"4PM",day:"Mon",lane:"1",ri:"2"}}),
  ]);
  const view={
    primary:"v2",
    tabId:"regular",
    exportTab:{id:"regular",name:"Prepared Regular",type:"regular"},
    root:{
      swim_tab_list:JSON.stringify([{id:"regular",name:"Prepared Regular",type:"regular"}]),
      swim_students:JSON.stringify([
        {sid:"fresh-2",n:"Fresh Two",a:11,t:"4PM",d:"Mon",l:1,r:2},
        {sid:"fresh-1",n:"Fresh One",a:10,t:"4PM",d:"Mon",l:1,r:1},
      ]),
      swim_inst:JSON.stringify({"4PM/Mon/1":{n:"Fresh Teacher"}}),
      swim_enroll:JSON.stringify({}),
      swim_mark:JSON.stringify({}),
      swim_requests:JSON.stringify({}),
      swim_retire:JSON.stringify({}),
      swim_hyuwon:JSON.stringify({}),
    },
  };
  const direct=transactionalGateway();
  const handlers=liveHandlersApi.create({
    gateway:direct.gateway,
    transactionContext:()=>Promise.reject(new Error("unused")),
    getAttendanceRuntime:()=>null,
  });
  let convertedCells=[];
  let convertedSheetName="";
  const context={
    console,
    document:{querySelector:selector=>selector==="#tbl table"?sourceTable:null},
    prepareLiveScheduleExportView:async()=>view,
    renderLiveScheduleExportView:(prepared,source)=>handlers.renderExportTable({view:prepared,source}),
    XLSX:{
      utils:{
        book_new:()=>({}),
        table_to_sheet:table=>{
          convertedCells=table.querySelectorAll("th,td").map(cell=>cell.textContent);
          const sheet={"!ref":"A1:C1"};
          convertedCells.forEach((value,index)=>{sheet[`${String.fromCharCode(65+index)}1`]={t:"s",v:value};});
          return sheet;
        },
        encode_cell:({r,c})=>`${String.fromCharCode(65+c)}${r+1}`,
        book_append_sheet:(workbook,sheet,name)=>{convertedSheetName=name;},
      },
      writeFile:()=>{},
    },
    toDateStr:()=>"2026-08-11",
    getToday:()=>new Date("2026-08-11T03:00:00.000Z"),
    _excelCellMemoLines:()=>[],
    _excelStudentDisplayForSlot:()=>"STALE GLOBAL",
    _excelBadgeDisplayForSlot:()=>"",
    _excelBadgeFillKind:()=>"",
    _excelStyleFromCell:()=>({}),
    _excelApplyBadgeOnlyStyle:style=>style,
    _excelWalkTableCells:(table,visitor)=>table.cells.forEach((cell,index)=>visitor(cell,0,index,1,1)),
    _excelAppendRecords:()=>{},
    _excelSheetMaxRow:()=>0,
    _excelSafeSheetName:value=>value,
    _excelSafeFilePart:value=>value,
    _tabById:()=>({id:"regular",name:"Stale Tab",type:"regular"}),
    _activeTab:"regular",
    toast:()=>{},
  };
  vm.createContext(context);
  vm.runInContext(
    `${functionSource("js/table.js","_excelCleanCellForExport")};${functionSource("js/table.js","exportExcel")};this.runExport=exportExcel;`,
    context,
    {filename:"table-export-runtime.js"},
  );

  await context.runExport();

  assert.deepEqual(convertedCells,["Fresh Teacher","Fresh One10","Fresh Two11"]);
  assert.equal(convertedSheetName,"Prepared Regular");
});
