const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const popup=fs.readFileSync(path.join(root,'js','popup-stu.js'),'utf8');
const table=fs.readFileSync(path.join(root,'js','table.js'),'utf8');
const data=fs.readFileSync(path.join(root,'js','data.js'),'utf8');

test('vacation student forms expose a dedicated week-five checkbox',()=>{
  assert.match(popup,/id="sp-bt-week5"/);
  assert.match(popup,/id="sp-enroll-bt-week5"/);
  assert.match(popup,/if\(form\.btWeek5\) obj\.btWeek5=true/);
});

function loadLayoutStudentName(isBangteuk){
  const start=table.indexOf('function _layoutStudentName(stu)');
  const end=table.indexOf('let _attendanceMode',start);
  const context={
    window:{SCScheduleTime:{
      parseBangteukWeek5Name(value){
        const raw=String(value||'');
        const week5=/^[*＊]+\s*/.test(raw);
        return {name:raw.replace(/^[*＊]+\s*/,''),week5};
      },
    }},
    _isBangteukSlotKey(){return isBangteuk;},
  };
  vm.createContext(context);
  vm.runInContext(table.slice(start,end),context);
  return context._layoutStudentName;
}

test('week-five remains a single display-only star in vacation slots',()=>{
  const display=loadLayoutStudentName(true);
  assert.equal(display({n:'홍길동',btWeek5:true,t:'10시',d:'월수금',l:1,r:1}),'*홍길동');
  assert.equal(display({n:'*홍길동',btWeek5:true,t:'10시',d:'월수금',l:1,r:1}),'*홍길동');
});

test('week-five metadata does not add a star to a regular slot',()=>{
  const display=loadLayoutStudentName(false);
  assert.equal(display({n:'홍길동',btWeek5:true,t:'4시',d:'월',l:1,r:1}),'홍길동');
});

test('identity migration reruns after separating the legacy star',()=>{
  assert.match(data,/const targetVersion='v3-bangteuk-week5'/);
  assert.match(data,/normalizeBangteukStudent\(stu\)/);
});
