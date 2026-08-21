(function(global,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  global.SCAttendanceSnapshotWriter=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  function text(value){ return String(value==null?'':value).trim(); }
  function clone(value){ return value==null?value:JSON.parse(JSON.stringify(value)); }
  function ordered(value){
    if(Array.isArray(value)) return value.map(ordered);
    if(value&&typeof value==='object'){
      return Object.keys(value).sort().reduce((result,key)=>{
        result[key]=ordered(value[key]);
        return result;
      },{});
    }
    return value;
  }
  function canonical(value){ return JSON.stringify(ordered(value)); }
  function digest(value){
    const source=text(value);
    const seeds=[0x811c9dc5,0x9e3779b9,0x85ebca6b,0xc2b2ae35];
    return seeds.map(seed=>{
      let hash=seed>>>0;
      for(let index=0;index<source.length;index+=1){
        hash^=source.charCodeAt(index);
        hash=Math.imul(hash,0x01000193)>>>0;
      }
      return hash.toString(16).padStart(8,'0');
    }).join('');
  }
  function immutableError(){
    return Object.assign(new Error('이미 생성된 출석부 스냅샷은 변경하거나 삭제할 수 없습니다.'),{
      code:'attendance-snapshot-immutable',
    });
  }
  function parse(value){
    if(typeof value!=='string') return clone(value);
    try{return JSON.parse(value);}catch(error){return null;}
  }
  function validSnapshot(value){
    return !!(value&&typeof value==='object'&&!Array.isArray(value)&&Array.isArray(value.students));
  }
  function scope(value){
    const normalized=text(value);
    if(normalized==='regular'||/^bt_[A-Za-z0-9_-]+$/.test(normalized)) return normalized;
    throw Object.assign(new Error('출석부 스냅샷 범위를 확인할 수 없습니다.'),{code:'invalid-attendance-snapshot-scope'});
  }

  function create(options={}){
    const branchId=text(options.branchId);
    if(!branchId) throw new TypeError('branchId is required');
    if(typeof options.read!=='function'||typeof options.write!=='function'){
      throw new TypeError('snapshot read and write functions are required');
    }
    const normalize=typeof options.normalize==='function'?options.normalize:value=>clone(value);
    const cache=typeof options.cache==='function'?options.cache:()=>{};

    async function createOnly(input={}){
      const targetScope=scope(input.scope);
      const date=text(input.date);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){
        throw Object.assign(new Error('출석부 스냅샷 날짜를 확인할 수 없습니다.'),{code:'invalid-attendance-snapshot-date'});
      }
      const key=`zz_swim_day_snapshot__${targetScope}__${date}`;
      const normalized=normalize(clone(input.snapshot),key);
      if(!validSnapshot(normalized)){
        throw Object.assign(new Error('출석부 스냅샷 내용을 확인할 수 없습니다.'),{code:'invalid-attendance-snapshot'});
      }
      const existing=parse(await options.read(key));
      if(validSnapshot(existing)){
        if(canonical(existing)===canonical(normalized)) return {created:false,key,snapshot:clone(existing)};
        throw immutableError();
      }
      const creationIdentity=text(input.creationIdentity)||digest(canonical(normalized));
      const operationId='ats_'+digest([branchId,targetScope,date,creationIdentity].join('|'));
      const result=await options.write(key,JSON.stringify(normalized),{
        label:'출석부 스냅샷',operationType:'attendance-snapshot',operationId,
        requireOperationManifest:true,
      });
      if(result&&result.committed===false){
        throw Object.assign(new Error('출석부 스냅샷 저장이 완료되지 않았습니다.'),{code:'attendance-snapshot-not-committed'});
      }
      cache(date,clone(normalized),clone(input));
      return {created:true,key,operationId,snapshot:clone(normalized),result};
    }
    async function remove(){ throw immutableError(); }
    return Object.freeze({createOnly,remove});
  }

  return Object.freeze({create,digest});
});
