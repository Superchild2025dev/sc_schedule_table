const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const table=fs.readFileSync(path.join(root,'js','table.js'),'utf8');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');

function loadMobileStudentInfoFunctions(){
  const start=table.indexOf('function _mobileStudentInfoModel(');
  const end=table.indexOf('function _mobileCellItems(',start);
  assert.notEqual(start,-1,'mobile student info model must exist');
  assert.notEqual(end,-1,'mobile student info helpers must be bounded');
  const context={
    esc(value){
      return String(value??'')
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;')
        .replace(/'/g,'&#39;');
    },
  };
  vm.createContext(context);
  vm.runInContext(table.slice(start,end),context);
  return context;
}

test('mobile student details map loaded timetable data without requesting edits',()=>{
  const { _mobileStudentInfoModel }=loadMobileStudentInfoFunctions();
  const info=_mobileStudentInfoModel({
    n:'홍길동',a:'10',p:'010-1234-5678',g:'남',
    loc:'승차: 시청 앞\n하차: 체육관',memo:'보호자 연락 전 확인',
  },{
    teacher:'김선생',day:'수',time:'5시',lane:2,row:4,status:'재원',
  });

  assert.deepEqual(JSON.parse(JSON.stringify(info)),{
    name:'홍길동',age:'10',phone:'010-1234-5678',gender:'남',
    teacher:'김선생',classTime:'수 5시',lane:'2레인 4번',status:'재원',
    transport:'승차: 시청 앞\n하차: 체육관',memo:'보호자 연락 전 확인',
  });
});

test('mobile student details translate stored gender codes for staff',()=>{
  const { _mobileStudentInfoModel }=loadMobileStudentInfoFunctions();
  assert.equal(_mobileStudentInfoModel({n:'남학생',g:'m'},{}).gender,'남');
  assert.equal(_mobileStudentInfoModel({n:'여학생',g:'f'},{}).gender,'여');
});

function loadMobileCellItems({student,enroll,retire,badges=[]}){
  const start=table.indexOf('function _mobileCellItems(');
  const end=table.indexOf('function _mobileRenderTimeCard(',start);
  assert.notEqual(start,-1);
  assert.notEqual(end,-1);
  const context={
    ENROLL_MAP:enroll?{'5시/수/2/4':enroll}:{},
    RETIRE_MAP:retire?{'5시/수/2/4':retire}:{},
    _mobileSlotKey(){return '5시/수/2/4';},
    _isBangteukSlotKey(){return false;},
    _ctxStu(){return student||null;},
    _mobileSlotBadges(){return badges;},
    toDateStr(){return '2026-08-31';},
    getToday(){return new Date('2026-08-31T00:00:00Z');},
    _scheduleReservationMatchesStudent(entry,item){
      return String(entry?.name||entry?.n||'')===String(item?.name||item?.n||'');
    },
    _scheduleReservationName(entry){return String(entry?.name||entry?.n||'');},
    _retireReservationSuffix(){return '까지';},
    _mobileShortDate(){return '9/5';},
    _mobileStudentText(item){return `${item.n}${item.a||''}`;},
    _mobileStudentType(){return 'student';},
    _layoutStudentName(item){return item.n;},
  };
  vm.createContext(context);
  vm.runInContext(table.slice(start,end),context);
  return context._mobileCellItems({},'5시','수',2,4);
}

test('a different retiring student gets a separate mobile detail target',()=>{
  const items=loadMobileCellItems({
    student:{n:'새원생',p:'01022223333'},
    retire:{name:'기존원생',p:'01011112222',ds:'2026-09-05'},
  });
  assert.deepEqual(Array.from(items,item=>item.infoName),['새원생','기존원생']);
  assert.equal(items[1].infoSource.p,'01011112222');
});

test('a different enrolling student gets a separate mobile detail target',()=>{
  const items=loadMobileCellItems({
    student:{n:'현재원생',p:'01011112222'},
    enroll:{name:'등록원생',p:'01033334444',ds:'2026-09-05'},
  });
  assert.deepEqual(Array.from(items,item=>item.infoName),['현재원생','등록원생']);
  assert.equal(items[1].infoSource.p,'01033334444');
});

test('mobile student detail markup is read only and escapes personal data',()=>{
  const { _mobileStudentInfoMarkup }=loadMobileStudentInfoFunctions();
  const html=_mobileStudentInfoMarkup({
    name:'<홍길동>',age:'10',phone:'010-1234-5678',gender:'남',
    teacher:'김선생',classTime:'수 5시',lane:'2레인 4번',status:'재원',
    transport:'승차: 시청 앞',memo:'<script>alert(1)</script>',
  });

  assert.match(html,/&lt;홍길동&gt;/);
  assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<(?:input|textarea|select|form)\b/i);
  assert.doesNotMatch(html,/(?:저장|삭제|이동|수정)/);
});

test('mobile timetable provides a dedicated read-only student dialog',()=>{
  const match=index.match(/<div id="mobile-student-info"[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(match,'mobile student detail dialog must exist');
  assert.match(match[0],/role="dialog"/);
  assert.match(match[0],/aria-modal="true"/);
  assert.doesNotMatch(match[0],/<(?:input|textarea|select|form)\b/i);
});
