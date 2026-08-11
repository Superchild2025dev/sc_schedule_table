'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const marks=require('../js/mark-map-transaction.js');

function plain(value){ return JSON.parse(JSON.stringify(value)); }
function deferred(){
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
function functionBody(source,name){
  const asyncStart=source.indexOf(`async function ${name}`);
  const start=asyncStart>=0?asyncStart:source.indexOf(`function ${name}`);
  const open=source.indexOf('{',start);
  let depth=0;
  for(let index=open;index<source.length;index+=1){
    if(source[index]==='{') depth+=1;
    else if(source[index]==='}'&&--depth===0) return source.slice(start,index+1);
  }
  throw new Error(`${name} is incomplete`);
}

test('failed mark transaction retains the prior visible map',async()=>{
  let visible={existing:{type:'absent'}};
  const service=marks.create({
    read(){return visible;},
    async transact(){throw Object.assign(new Error('network'),{code:'unavailable'});},
    apply(next){visible=plain(next);},
  });

  await assert.rejects(()=>service.mutate(map=>({...map,newMark:{type:'sample'}})),/network/);
  assert.deepEqual(visible,{existing:{type:'absent'}});
});

test('only a committed transaction snapshot becomes visible',async()=>{
  let visible={before:{type:'absent'}};
  const service=marks.create({
    read(){return visible;},
    async transact(mutator){
      const server={serverOnly:{type:'sample'}};
      const draft=plain(server);
      mutator(draft);
      return draft;
    },
    apply(next){visible=plain(next);},
  });

  const result=await service.mutate(map=>{map.committed={type:'bogang'};return map;});
  assert.deepEqual(result,{serverOnly:{type:'sample'},committed:{type:'bogang'}});
  assert.deepEqual(visible,result);
});

test('a stale mark response cannot replace a newer committed snapshot',async()=>{
  let visible={prior:{type:'absent'}};
  const first=deferred();
  const second=deferred();
  let call=0;
  let refreshes=0;
  const service=marks.create({
    read(){return visible;},
    transact(){return ++call===1?first.promise:second.promise;},
    apply(next){visible=plain(next);},
    async refresh(){refreshes+=1;},
  });

  const oldWrite=service.mutate(map=>map);
  const newWrite=service.mutate(map=>map);
  second.resolve({newer:{type:'sample'}});
  await newWrite;
  first.resolve({stale:{type:'bogang'}});

  await assert.rejects(()=>oldWrite,error=>error?.code==='stale-mark-response');
  assert.deepEqual(visible,{newer:{type:'sample'}});
  assert.equal(refreshes,1);
});

test('main mark helpers and callers await commit without eager MARK_MAP mutation',()=>{
  const root=path.join(__dirname,'..');
  const data=fs.readFileSync(path.join(root,'js','data.js'),'utf8');
  const popup=fs.readFileSync(path.join(root,'js','popup-stu.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const helperSection=data.slice(data.indexOf('function setMarkEntryTx'),data.indexOf('const ATTENDANCE_TX_META'));

  assert.ok(html.indexOf("scJs('js/mark-map-transaction.js')")<html.indexOf("scJs('js/data.js')"));
  assert.doesNotMatch(helperSection,/MARK_MAP\s*\[|delete\s+MARK_MAP/);
  for(const name of ['handleMarkAbsent','handleBogangSet','handleBogangDel','handleSampleSet','handleSampleDel']){
    assert.match(popup,new RegExp(`async function ${name}\\(`));
  }
  assert.match(popup,/await setMark\(/);
  assert.match(popup,/await clearMark\(/);
});

test('absence and mandatory-makeup callers render no success after failed or stale commits',async()=>{
  const popup=fs.readFileSync(path.join(__dirname,'..','js','popup-stu.js'),'utf8');
  const toasts=[];
  let renders=0;
  const elements={
    'sp-bogang-name':{value:'Student'},'sp-bogang-age':{value:'8'},
    'sp-bogang-mandatory':{checked:true},
  };
  const context={
    console:{error(){}},document:{getElementById(id){return elements[id]||null;}},
    _stuPopup:{selDate:'2026-08-03'},getMark(){return null;},
    requireStuPopupAbsenceEdit(){return true;},requireStuPopupBogangEdit(){return true;},
    _readBogangSelected(){return null;},_readBogangScheduleType(){return '';},
    setMark(){return Promise.reject(Object.assign(new Error('blocked'),{code:'stale-mark-response'}));},
    clearMark(){return Promise.reject(new Error('network'));},
    toast(message,type){toasts.push([message,type]);},
    renderStuPopup(){renders+=1;},buildTable(){renders+=1;},_flashKey:'',
  };
  vm.createContext(context);
  const absent=vm.runInContext(`(${functionBody(popup,'handleMarkAbsent')})`,context);
  const mandatory=vm.runInContext(`(${functionBody(popup,'handleBogangSet')})`,context);

  await absent(null,{slotKey:'4PM/Mon/1/1'});
  await mandatory(null,{slotKey:'4PM/Mon/1/1'});

  assert.deepEqual(toasts,[['마크 저장 실패','err'],['마크 저장 실패','err']]);
  assert.equal(renders,0);
});
