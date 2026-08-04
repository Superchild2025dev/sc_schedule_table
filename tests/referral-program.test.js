const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function loadProgram(){
  const window={};
  const context={window,console,Date};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','js','referral.js'),'utf8'),context);
  return context.window.SCReferralProgram;
}

test('stamp additions use a new cycle only after ten stamps',()=>{
  const api=loadProgram();
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.stampTransition({currentStamps:4,totalStamps:7,cycle:1},'add'))),
    {beforeCurrent:4,beforeTotal:7,beforeCycle:1,afterCurrent:5,afterTotal:8,afterCycle:1,reset:false}
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.stampTransition({currentStamps:10,totalStamps:10,cycle:1},'add'))),
    {beforeCurrent:10,beforeTotal:10,beforeCycle:1,afterCurrent:1,afterTotal:11,afterCycle:2,reset:true}
  );
});

test('manual removal and set operations keep cumulative earned stamps',()=>{
  const api=loadProgram();
  const removed=api.stampTransition({currentStamps:3,totalStamps:8,cycle:2},'remove');
  assert.equal(removed.afterCurrent,2);
  assert.equal(removed.afterTotal,8);
  const set=api.stampTransition({currentStamps:3,totalStamps:8,cycle:2},'set',6);
  assert.equal(set.afterCurrent,6);
  assert.equal(set.afterTotal,8);
  assert.throws(()=>api.stampTransition({currentStamps:0,totalStamps:0,cycle:1},'remove'),/차감할 적립/);
});

test('benefit application stays per stamp and follows count changes safely',()=>{
  const api=loadProgram();
  assert.deepEqual(Array.from(api.normalizeAppliedStamps([3,1,3,8,0],4)),[1,3]);
  const removed=api.stampTransition({currentStamps:4,totalStamps:4,cycle:1},'remove');
  assert.deepEqual(Array.from(api.appliedStampsAfterTransition({appliedStamps:[1,4]},removed)),[1]);
  const added=api.stampTransition({currentStamps:4,totalStamps:4,cycle:1},'add');
  assert.deepEqual(Array.from(api.appliedStampsAfterTransition({appliedStamps:[1,4]},added)),[1,4]);
  const reset=api.stampTransition({currentStamps:10,totalStamps:10,cycle:1},'add');
  assert.deepEqual(Array.from(api.appliedStampsAfterTransition({appliedStamps:[1,5,10]},reset)),[]);
});

test('siblings sharing a phone stay separate while repeated placements collapse',()=>{
  const api=loadProgram();
  const tab={id:'regular',name:'정규시간표',type:'regular'};
  const rows=api.directoryRows(tab,[
    {n:'홍길동',p:'010-1234-5678',t:'4시',d:'월',l:1,r:1},
    {n:'홍길동',p:'01012345678',t:'4시',d:'수',l:1,r:1},
    {n:'홍길순',p:'01012345678',t:'5시',d:'화',l:2,r:1},
  ]);
  assert.equal(rows.length,2);
  assert.deepEqual(Array.from(rows.map(row=>row.name).sort()),['홍길동','홍길순']);
});

test('regular and vacation students with the same identity remain separate links',()=>{
  const api=loadProgram();
  const regular=api.directoryRows({id:'regular',type:'regular'},[{n:'홍길동',p:'01012345678'}]);
  const vacation=api.directoryRows({id:'summer',type:'bangteuk'},[{n:'*홍길동',p:'01012345678'}]);
  assert.notEqual(regular[0].key,vacation[0].key);
  assert.equal(vacation[0].name,'홍길동');
});

test('one referral account can resolve siblings and regular-vacation links by student id',()=>{
  const api=loadProgram();
  const selected={studentId:'student-a',name:'홍길동',phone:'01012345678'};
  const directory=[
    {studentId:'student-a',name:'홍길동',phone:'01012345678',courseType:'regular'},
    {studentId:'student-a',name:'홍길동',phone:'01012345678',courseType:'bangteuk'},
    {studentId:'student-b',name:'홍길순',phone:'01012345678',courseType:'regular'},
    {studentId:'student-c',name:'다른가정',phone:'01099998888',courseType:'regular'},
  ];
  assert.deepEqual(Array.from(api.accountLookupStudentIds(selected,directory)),['student-a','student-b']);
  assert.deepEqual(Array.from(api.linkedStudentIds(directory)),['student-a','student-b','student-c']);
});

test('student id links never silently overwrite another referral account',()=>{
  const api=loadProgram();
  const docs=[
    {exists:true,data:()=>({familyId:'family-a'})},
    {exists:true,data:()=>({familyId:'family-a'})},
    {exists:false,data:()=>({})},
  ];
  assert.deepEqual(Array.from(api.occupiedFamilyIds(docs)),['family-a']);
  const split=[...docs,{exists:true,data:()=>({familyId:'family-b'})}];
  assert.deepEqual(Array.from(api.occupiedFamilyIds(split)),['family-a','family-b']);
});

test('student directory reads the main regular tab and active vacation tab only',()=>{
  const api=loadProgram();
  const tabs=api.selectDirectoryTabs([
    {id:'may',name:'5월',type:'regular'},
    {id:'july',name:'7월',type:'regular'},
    {id:'summer',name:'여름방특',type:'bangteuk',seasonStart:'2026-07-20',seasonEnd:'2026-08-14'},
    {id:'winter',name:'겨울방특',type:'bangteuk',seasonStart:'2027-01-01',seasonEnd:'2027-01-31'},
    {id:'snap',name:'과거',type:'snapshot'},
  ],{tabId:'july'},'2026-08-01');
  assert.deepEqual(Array.from(tabs.map(tab=>tab.id)),['july','summer']);
});

test('student search accepts names and partial phone numbers',()=>{
  const api=loadProgram();
  const rows=[
    {key:'a',name:'홍길동',phone:'01012345678'},
    {key:'b',name:'김슈차',phone:'01098765432'},
    {key:'c',name:'홍길순',phone:'01055556666'},
  ];
  assert.deepEqual(Array.from(api.searchDirectoryRows(rows,'홍길').map(row=>row.key)),['a','c']);
  assert.deepEqual(Array.from(api.searchDirectoryRows(rows,'9876').map(row=>row.key)),['b']);
});

test('student name prefers the new field and keeps legacy records readable',()=>{
  const api=loadProgram();
  assert.equal(api.familyStudentName({studentName:'김슈차',parentName:'보호자'}),'김슈차');
  assert.equal(api.familyStudentName({parentName:'보호자',linkedStudents:[{name:'이수영'}]}),'이수영');
  assert.equal(api.familyStudentName({parentName:'기존이름'}),'기존이름');
});

test('referral notifications have one template for every stamp count',()=>{
  const api=loadProgram();
  const ids=Array.from({length:10},(_,index)=>api.referralTemplateId(index+1));
  assert.deepEqual(ids,Array.from({length:10},(_,index)=>`parent_referral_stamp_${index+1}`));
  assert.match(api.defaultReferralTemplate(1).body,/\(1\/10\)/);
  assert.match(api.defaultReferralTemplate(5).body,/1개월 수업 무료/);
  assert.match(api.defaultReferralTemplate(10).body,/2개월 수업 무료/);
});

test('settings exposes all ten referral templates as one group',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','js','settings.js'),'utf8');
  assert.match(source,/\.\.\.Array\.from\(\{length:10\}/);
  assert.match(source,/친구추천 적립 1개 ~ 10개/);
});

test('referral screen contains every element referenced by the script',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','referral.html'),'utf8');
  const script=fs.readFileSync(path.join(__dirname,'..','js','referral.js'),'utf8');
  const ids=new Set(Array.from(html.matchAll(/id="([^"]+)"/g),match=>match[1]));
  const references=Array.from(script.matchAll(/\$\('([^']+)'\)/g),match=>match[1]);
  assert.deepEqual(references.filter(id=>!ids.has(id)),[]);
  assert.doesNotMatch(html,/학부모 이름|신규 학부모/);
  assert.match(html,/스탬프별 혜택 적용/);
  assert.match(html,/id="family-phone-input"/);
  assert.match(script,/data-stamp-applied/);
  assert.match(script,/collection\('studentAccounts'\)/);
  assert.match(script,/where\('phone','==',normalized\)/);
  assert.match(script,/type:'profile_update'/);
  assert.match(script,/const defaultAll=isNew\|\|linkedKeys\.size===0/);
});

test('referral Firestore rules are branch-scoped to desks and administrators',()=>{
  const rules=fs.readFileSync(path.join(__dirname,'..','firestore.rules'),'utf8');
  assert.match(rules,/match \/referralPrograms\/\{branch\}\/\{document=\*\*\}/);
  assert.match(rules,/gagyeong\.desk@scswim\.local/);
  assert.match(rules,/yongam\.desk@scswim\.local/);
});
