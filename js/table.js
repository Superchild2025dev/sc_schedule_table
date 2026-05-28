/* ════════════════════════════════════════════════════════════════
 * SECTION: 출석 모드 (시간표에 통합)
 * ════════════════════════════════════════════════════════════════ */
// [v118] 오늘 요일 판정 헬퍼 (day-sep-today 클래스 적용용)
function _isTodayDay(day){
  const t=getToday();
  if(typeof dayMatchesDate==='function') return dayMatchesDate(day,t);
  return ['일','월','화','수','목','금','토'][t.getDay()]===day;
}
function _tableLocUsesVehicle(loc){
  const txt=(loc||'').trim();
  if(!txt || /^(자가등하원|도보등하원)$/.test(txt)) return false;
  const lines=txt.split(/[\n\/|]/).map(s=>s.trim()).filter(Boolean);
  return lines.some(line=>{
    const m=line.match(/^(?:승하차|승차|하차)\s*[:：]?\s*(.+)$/);
    const val=(m?m[1]:line).trim();
    return !!val && !/^(자가|도보)/.test(val);
  });
}
let _attendanceMode=false;
let _attendanceDate=null;  // YYYY-MM-DD
let _attEditMode=false;     // true면 셀 클릭 시 출석체크 대신 편집

function toggleAttEditMode(){
  if(window.SCAuth && !SCAuth.requirePermission('attendanceCheck','출석부 편집')) return;
  _attEditMode=!_attEditMode;
  const btn=document.getElementById('att-edit-btn');
  if(btn){
    if(_attEditMode){
      btn.style.background='#F59E0B';
      btn.style.color='#fff';
      btn.textContent='✏️ 편집 중';
    } else {
      btn.style.background='rgba(255,255,255,0.2)';
      btn.style.color='#fff';
      btn.textContent='✏️ 편집';
    }
  }
  // 테이블 재렌더 — 모든 요일 셀에 편집 클릭 핸들러 새로 설치
  buildTable();
}

// 편집 모달 상태
let _editModalCtx=null;

// 원생 추가 모달 (출석부 + 버튼) - 특정 레인에서 첫 빈 row 찾아서 모달 열기
function _openAttAddModalForLane(t, day, lane, cellDs){
  if(window.SCAuth && !SCAuth.requirePermission('attendanceCheck','출석부 원생 추가')) return;
  // row 1~8에서 빈 자리 찾기
  for(let r=1; r<=8; r++){
    const sk=t+'/'+day+'/'+lane+'/'+r;
    if(getStu(t,day,lane,r)) continue;  // 이미 학생 있음
    const mk=MARK_MAP[sk+'/'+cellDs];
    if(mk) continue;  // 이미 보강/샘플/결석 있음
    _openAttAddModal(sk, cellDs);
    return;
  }
  toast('빈 자리가 없습니다 (1~8행 전부 사용 중)','err');
}

// 원생 추가 모달 (출석부 + 버튼)
let _addModalCtx=null;
function _openAttAddModal(slotKey, cellDs){
  _addModalCtx={slotKey, cellDs};
  const [t,d,l,r]=slotKey.split('/');
  const [y,mm,dd]=cellDs.split('-');
  const dateObj=new Date(parseInt(y), parseInt(mm)-1, parseInt(dd));
  const dow=['일','월','화','수','목','금','토'][dateObj.getDay()];
  document.getElementById('att-add-sub').textContent=
    `${t} ${d}요일 ${l}레인 ${r}번 · ${parseInt(mm)}월 ${parseInt(dd)}일 (${dow})`;
  document.getElementById('att-add-name').value='';
  document.getElementById('att-add-age').value='';
  document.getElementById('att-add-modal').style.display='flex';
  setTimeout(()=>{document.getElementById('att-add-name').focus();},50);
}

function _closeAttAddModal(){
  _addModalCtx=null;
  document.getElementById('att-add-modal').style.display='none';
}

async function _saveAttAdd(status){
  if(window.SCAuth && !SCAuth.requirePermission('attendanceCheck','출석부 원생 추가')) return;
  if(!_addModalCtx) return;
  const {slotKey, cellDs}=_addModalCtx;
  const name=document.getElementById('att-add-name').value.trim();
  const age=parseInt(document.getElementById('att-add-age').value)||null;
  if(!name){toast('이름을 입력하세요','err');return;}

  const [t,d,l,r]=slotKey.split('/');
  const li=parseInt(l), ri=parseInt(r);
  const isPast=cellDs<toDateStr(getToday());
  const useSnapshot=isPast && DAY_SNAPSHOT[cellDs];

  try{
    if(status==='present' || status==='absent'){
      // 정규 학생으로 등록 + 해당 날짜 출석 상태
      const newStu={n:name, a:age, t, d, l:li, r:ri};
      if(useSnapshot){
        // 과거 스냅샷에 추가
        if(!DAY_SNAPSHOT[cellDs].students) DAY_SNAPSHOT[cellDs].students=[];
        DAY_SNAPSHOT[cellDs].students.push(newStu);
        saveDaySnapshot();
      } else {
        const stuKey=getTabConfig().stuKey;
        await updateScheduleTx([stuKey,STORAGE_KEYS.ATTENDANCE], ctx=>{
          const students=ctx.get(stuKey,[]);
          if(students.some(s=>s.t===t&&s.d===d&&parseInt(s.l)===li&&parseInt(s.r)===ri)){
            ctx.abort('이미 학생이 있는 자리입니다');
            return;
          }
          students.push(newStu);
          const att=ctx.get(STORAGE_KEYS.ATTENDANCE,{});
          att[slotKey+'/'+cellDs]={s:status, at:new Date().toISOString(), by:null};
          ctx.set(stuKey,students);
          ctx.set(STORAGE_KEYS.ATTENDANCE,att);
          return true;
        });
      }
      if(useSnapshot) await setAttendanceEntryTx(slotKey+'/'+cellDs,{s:status, at:new Date().toISOString(), by:null});
      toast(name+' 등록 + '+(status==='present'?'출석':'결석'),'ok');
    } else if(status==='bogang' || status==='sample'){
      // 일회성 MARK_MAP (정규 학생 등록 X)
      const markKey=slotKey+'/'+cellDs;
      await updateMarkMapTx(marks=>{
        const existing=marks[markKey];
        if(existing && existing.type==='absent'){
          // 결석 + sub 보강/샘플
          marks[markKey]={...existing, sub:{type:status, n:name, a:age}};
        } else {
          marks[markKey]={type:status, n:name, a:age};
        }
        return marks;
      });
      toast(name+' '+(status==='bogang'?'보강':'샘플')+' 등록','ok');
    } else if(status==='hyuwon'){
      // 정규 학생 등록 + 휴원 날짜
      const newStu={n:name, a:age, t, d, l:li, r:ri};
      if(useSnapshot){
        if(!DAY_SNAPSHOT[cellDs].students) DAY_SNAPSHOT[cellDs].students=[];
        DAY_SNAPSHOT[cellDs].students.push(newStu);
        saveDaySnapshot();
      } else {
        const stuKey=getTabConfig().stuKey;
        await updateScheduleTx([stuKey,STORAGE_KEYS.休원], ctx=>{
          const students=ctx.get(stuKey,[]);
          if(students.some(s=>s.t===t&&s.d===d&&parseInt(s.l)===li&&parseInt(s.r)===ri)){
            ctx.abort('이미 학생이 있는 자리입니다');
            return;
          }
          students.push(newStu);
          const hyuwon=ctx.get(STORAGE_KEYS.休원,{});
          if(!hyuwon[slotKey]) hyuwon[slotKey]={dates:[]};
          if(!hyuwon[slotKey].dates) hyuwon[slotKey].dates=[];
          if(!hyuwon[slotKey].dates.includes(cellDs)) hyuwon[slotKey].dates.push(cellDs);
          ctx.set(stuKey,students);
          ctx.set(STORAGE_KEYS.休원,hyuwon);
          return true;
        });
      }
      if(useSnapshot){
        await updateHyuwonMapTx(hyuwon=>{
          if(!hyuwon[slotKey]) hyuwon[slotKey]={dates:[]};
          if(!hyuwon[slotKey].dates) hyuwon[slotKey].dates=[];
          if(!hyuwon[slotKey].dates.includes(cellDs)) hyuwon[slotKey].dates.push(cellDs);
          return hyuwon;
        });
      }
      toast(name+' 등록 + 휴원','ok');
    }
    _closeAttAddModal();
    buildTable();
    _updateAttBarInfo();
  }catch(e){
    toast('저장 실패','err');
    console.error(e);
  }
}

// 과거 날짜 스냅샷 or 현재 STUDENTS 학생 편집 (모달)
function _editAttCell(slotKey, cellDs){
  if(window.SCAuth && !SCAuth.requirePermission('attendanceCheck','출석부 학생 편집')) return;
  const [t,d,l,r]=slotKey.split('/');
  const li=parseInt(l), ri=parseInt(r);
  const targetDs=cellDs||_attendanceDate;
  const isPast=targetDs < toDateStr(getToday());
  const usingSnapshot=isPast && DAY_SNAPSHOT[targetDs];

  let curStu;
  if(usingSnapshot){
    curStu=(DAY_SNAPSHOT[targetDs].students||[]).find(s=>s.t===t&&s.d===d&&s.l===li&&s.r===ri);
  } else {
    curStu=getStu(t,d,li,ri);
  }

  _editModalCtx={slotKey, usingSnapshot, exists:!!curStu, ds:targetDs};
  document.getElementById('att-edit-name').value=curStu?.n||'';
  document.getElementById('att-edit-age').value=curStu?.a||'';
  const infoLabel=`${t} ${d}요일 ${l}레인 ${r}번${isPast?' · '+targetDs+' 스냅샷':''}`;
  document.getElementById('att-edit-sub').textContent=infoLabel;
  document.getElementById('att-edit-delete').style.display=curStu?'inline-block':'none';
  document.getElementById('att-edit-modal').style.display='flex';
  setTimeout(()=>{document.getElementById('att-edit-name').focus();},50);
}

function _closeEditModal(){
  _editModalCtx=null;
  document.getElementById('att-edit-modal').style.display='none';
}

async function _saveEditModal(){
  if(window.SCAuth && !SCAuth.requirePermission('attendanceCheck','출석부 학생 편집')) return;
  if(!_editModalCtx) return;
  const {slotKey, usingSnapshot, ds}=_editModalCtx;
  const [t,d,l,r]=slotKey.split('/');
  const li=parseInt(l), ri=parseInt(r);
  const newName=document.getElementById('att-edit-name').value.trim();
  const newAge=parseInt(document.getElementById('att-edit-age').value)||null;
  if(!newName){toast('이름을 입력하세요','err');return;}

  if(usingSnapshot){
    const arr=DAY_SNAPSHOT[ds].students||[];
    const idx=arr.findIndex(s=>s.t===t&&s.d===d&&s.l===li&&s.r===ri);
    if(idx>=0){arr[idx].n=newName; arr[idx].a=newAge;}
    else arr.push({n:newName, a:newAge, t, d, l:li, r:ri});
    DAY_SNAPSHOT[ds].students=arr;
    saveDaySnapshot();
    toast('과거 시간표 저장','ok');
  } else {
    try{
      await updateStudentsTx(students=>{
        const idx=students.findIndex(s=>s.t===t&&s.d===d&&parseInt(s.l)===li&&parseInt(s.r)===ri);
        if(idx>=0){students[idx].n=newName; students[idx].a=newAge;}
        else students.push({n:newName, a:newAge, t, d, l:li, r:ri});
        return students;
      });
    }catch(e){
      toast(e?.message||'저장 실패','err');
      console.error(e);
      return;
    }
    toast('저장 완료','ok');
  }
  _closeEditModal();
  buildTable();
}

async function _deleteEditModal(){
  if(window.SCAuth && !SCAuth.requirePermission('attendanceCheck','출석부 학생 삭제')) return;
  if(!_editModalCtx) return;
  if(!confirm('이 학생을 삭제하시겠습니까?')) return;
  const {slotKey, usingSnapshot, ds}=_editModalCtx;
  const [t,d,l,r]=slotKey.split('/');
  const li=parseInt(l), ri=parseInt(r);
  if(usingSnapshot){
    const arr=DAY_SNAPSHOT[ds].students||[];
    const idx=arr.findIndex(s=>s.t===t&&s.d===d&&s.l===li&&s.r===ri);
    if(idx>=0) arr.splice(idx,1);
    saveDaySnapshot();
  } else {
    try{
      await updateStudentsTx(students=>{
        const idx=students.findIndex(s=>s.t===t&&s.d===d&&parseInt(s.l)===li&&parseInt(s.r)===ri);
        if(idx>=0) students.splice(idx,1);
        return students;
      });
    }catch(e){
      toast(e?.message||'삭제 실패','err');
      console.error(e);
      return;
    }
  }
  _closeEditModal();
  buildTable();
  toast('삭제 완료','ok');
}

function toggleAttendanceMode(){
  _attendanceMode=!_attendanceMode;
  const bar=document.getElementById('attendance-bar');
  const btn=document.getElementById('attendance-toggle-btn');
  if(_attendanceMode){
    if(!_attendanceDate) _attendanceDate=toDateStr(getToday());
    document.getElementById('att-date-input').value=_attendanceDate;
    bar.style.display='flex';
    btn.style.background='rgba(255,255,255,0.3)';
    btn.style.fontWeight='900';
    // 오늘 스냅샷 저장
    _ensureTodaySnapshot();
  } else {
    bar.style.display='none';
    btn.style.background='';
    btn.style.fontWeight='';
  }
  buildTable();
  _updateAttBarInfo();
}

function setAttendanceDate(ds){
  _attendanceDate=ds;
  buildTable();
  _updateAttBarInfo();
}

function attDayShift(delta){
  const d=new Date(_attendanceDate);
  d.setDate(d.getDate()+delta);
  _attendanceDate=toDateStr(d);
  document.getElementById('att-date-input').value=_attendanceDate;
  buildTable();
  _updateAttBarInfo();
}

function attWeekShift(delta){
  const d=new Date(_attendanceDate);
  d.setDate(d.getDate()+delta*7);
  _attendanceDate=toDateStr(d);
  document.getElementById('att-date-input').value=_attendanceDate;
  buildTable();
  _updateAttBarInfo();
}

function setAttToday(){
  _attendanceDate=toDateStr(getToday());
  document.getElementById('att-date-input').value=_attendanceDate;
  buildTable();
  _updateAttBarInfo();
}

function _updateAttBarInfo(){
  if(!_attendanceMode||!_attendanceDate) return;
  // 선택 주의 월요일~토요일 계산
  const weekMon=_getWeekMon(_attendanceDate);
  const satDate=new Date(weekMon);
  satDate.setDate(satDate.getDate()+5);
  const monStr=toDateStr(weekMon), satStr=toDateStr(satDate);
  const [,mm1,dd1]=monStr.split('-');
  const [,mm2,dd2]=satStr.split('-');
  const label=`📅 ${parseInt(mm1)}/${parseInt(dd1)} ~ ${parseInt(mm2)}/${parseInt(dd2)}`;
  const labelEl=document.getElementById('att-bar-date-label');
  if(labelEl) labelEl.textContent=label;

  // 통계: 주간 전체
  let total=0,present=0,absent=0;
  for(const stu of STUDENTS){
    const cellDs=_dayToCellDs(stu.d);
    if(!cellDs) continue;
    total++;
    const slotKey=stu.t+'/'+stu.d+'/'+stu.l+'/'+stu.r;
    const att=ATTENDANCE[slotKey+'/'+cellDs];
    const v=att?(typeof att==='string'?att:att.s):null;
    if(v==='present') present++;
    else if(v==='absent') absent++;
  }
  const statsEl=document.getElementById('att-bar-stats');
  if(statsEl) statsEl.innerHTML=`👥 ${total}명 · ✅ ${present} · ❌ ${absent} · ⚪ ${total-present-absent}`;
}

// 선택 주의 월요일 Date 객체
function _getWeekMon(ds){
  const [y,m,d]=ds.split('-');
  const date=new Date(parseInt(y), parseInt(m)-1, parseInt(d));
  const dow=date.getDay();
  const off=dow===0?-6:1-dow;
  date.setDate(date.getDate()+off);
  return date;
}

// 요일 → 선택 주의 해당 날짜 (YYYY-MM-DD)
function _dayToCellDs(day){
  if(typeof getDateForDayInWeek==='function'){
    return toDateStr(getDateForDayInWeek(day,_attendanceDate));
  }
  const dayOff={'월':0,'화':1,'수':2,'목':3,'금':4,'토':5,'일':6};
  const mon=_getWeekMon(_attendanceDate);
  const d=new Date(mon);
  d.setDate(d.getDate()+(dayOff[day]||0));
  return toDateStr(d);
}

// 출석 셀 클릭 (순환 토글)
async function _cycleAttendance(slotKey){
  if(!_attendanceDate) return;
  const key=slotKey+'/'+_attendanceDate;
  try{
    await updateAttendanceMapTx(att=>{
      const cur=att[key];
      const curVal=cur?(typeof cur==='string'?cur:cur.s):null;
      let next;
      if(!curVal) next='present';
      else if(curVal==='present') next='absent';
      else next=null;
      if(next===null) delete att[key];
      else att[key]={s:next, at:new Date().toISOString(), by:null};
      return att;
    });
    buildTable();
    _updateAttBarInfo();
  }catch(e){
    toast('출석 저장 실패','err');
    console.error(e);
  }
}

// Sub(보강/샘플 대체) 출석 체크
async function _cycleAttendanceSub(slotKey){
  if(!_attendanceDate) return;
  const key=slotKey+'/'+_attendanceDate+'#sub';
  try{
    await updateAttendanceMapTx(att=>{
      const cur=att[key];
      const curVal=cur?(typeof cur==='string'?cur:cur.s):null;
      let next;
      if(!curVal) next='present';
      else if(curVal==='present') next='absent';
      else next=null;
      if(next===null) delete att[key];
      else att[key]={s:next, at:new Date().toISOString(), by:null};
      return att;
    });
    buildTable();
    _updateAttBarInfo();
  }catch(e){
    toast('출석 저장 실패','err');
    console.error(e);
  }
}

// 출석 체크 모달
let _attModalCtx=null;  // {slotKey, isSub, stu, ds}
function _openAttModal(slotKey, isSub, stu, ds){
  const useDs=ds||_attendanceDate;
  _attModalCtx={slotKey, isSub, stu, ds:useDs};
  const typeLabel=stu.type==='bogang'?' (보강)':stu.type==='sample'?' (샘플)':'';
  document.getElementById('att-modal-title').textContent=stu.n+(stu.a?'('+stu.a+')':'')+typeLabel;
  const [,m,d]=useDs.split('-');
  const [y,mm,dd]=useDs.split('-');
  const dateObj=new Date(parseInt(y), parseInt(mm)-1, parseInt(dd));
  const dow=['일','월','화','수','목','금','토'][dateObj.getDay()];
  document.getElementById('att-modal-sub').textContent=`${parseInt(m)}월 ${parseInt(d)}일 (${dow})`;
  document.getElementById('att-cell-modal').style.display='flex';
}
function _closeAttModal(){
  _attModalCtx=null;
  document.getElementById('att-cell-modal').style.display='none';
}
async function _setAttModal(value){
  if(window.SCAuth && !SCAuth.requirePermission('attendanceCheck','출석 체크')) return;
  if(!_attModalCtx) return;
  const {slotKey, isSub, ds}=_attModalCtx;
  const key=slotKey+'/'+ds+(isSub?'#sub':'');
  try{
    await setAttendanceEntryTx(key,value===null?null:{s:value, at:new Date().toISOString(), by:null});
    _closeAttModal();
    buildTable();
    _updateAttBarInfo();
  }catch(e){
    toast('출석 저장 실패','err');
    console.error(e);
  }
}

// 출석 모달에서 학생 삭제
async function _deleteFromAttModal(){
  if(window.SCAuth && !SCAuth.requirePermission('attendanceCheck','출석부 학생 삭제')) return;
  if(!_attModalCtx) return;
  const {slotKey, isSub, ds}=_attModalCtx;
  if(!confirm('이 학생을 출석부에서 삭제하시겠습니까?')) return;

  try{
    const [t,d,l,r]=slotKey.split('/');
    const li=parseInt(l), ri=parseInt(r);
    const isPast=ds<toDateStr(getToday());
    const useSnapshot=isPast && DAY_SNAPSHOT[ds];

    if(isSub){
      // Sub (결석+대체 보강/샘플 중 sub) 삭제
      const mark=MARK_MAP[slotKey+'/'+ds];
      if(mark && mark.sub){
        const newMark={...mark};
        delete newMark.sub;
        await setMarkEntryTx(slotKey+'/'+ds,newMark);
      }
      await setAttendanceEntryTx(slotKey+'/'+ds+'#sub',null);
    } else {
      // Primary 삭제
      const mark=MARK_MAP[slotKey+'/'+ds];
      if(mark){
        if(mark.type==='bogang' || mark.type==='sample'){
          // 단독 보강/샘플 → 통째로 삭제
          await clearMarkEntryTx(slotKey+'/'+ds);
        } else if(mark.type==='absent'){
          // 결석 마크 삭제 (sub가 있어도 함께 삭제 — sub만 남겨두려면 별도 처리)
          await clearMarkEntryTx(slotKey+'/'+ds);
        }
      }
      // 정규 학생도 삭제 (+ 버튼으로 추가한 경우)
      if(useSnapshot){
        const arr=DAY_SNAPSHOT[ds].students||[];
        const idx=arr.findIndex(s=>s.t===t&&s.d===d&&s.l===li&&s.r===ri);
        if(idx>=0){arr.splice(idx,1); saveDaySnapshot();}
        await updateAttendanceMapTx(att=>{
          delete att[slotKey+'/'+ds];
          delete att[slotKey+'/'+ds+'#sub'];
          return att;
        });
        await updateHyuwonMapTx(hyuwon=>{
          if(hyuwon[slotKey]&&hyuwon[slotKey].dates){
            hyuwon[slotKey].dates=hyuwon[slotKey].dates.filter(x=>x!==ds);
            if(!hyuwon[slotKey].dates.length) delete hyuwon[slotKey];
          }
          return hyuwon;
        });
      } else {
        const stuKey=getTabConfig().stuKey;
        await updateScheduleTx([stuKey,STORAGE_KEYS.ATTENDANCE,STORAGE_KEYS.休원], ctx=>{
          const students=ctx.get(stuKey,[]);
          const idx=students.findIndex(s=>s.t===t&&s.d===d&&parseInt(s.l)===li&&parseInt(s.r)===ri);
          if(idx>=0) students.splice(idx,1);
          const att=ctx.get(STORAGE_KEYS.ATTENDANCE,{});
          delete att[slotKey+'/'+ds];
          delete att[slotKey+'/'+ds+'#sub'];
          const hyuwon=ctx.get(STORAGE_KEYS.休원,{});
          if(hyuwon[slotKey]&&hyuwon[slotKey].dates){
            hyuwon[slotKey].dates=hyuwon[slotKey].dates.filter(x=>x!==ds);
            if(!hyuwon[slotKey].dates.length) delete hyuwon[slotKey];
          }
          ctx.set(stuKey,students);
          ctx.set(STORAGE_KEYS.ATTENDANCE,att);
          ctx.set(STORAGE_KEYS.休원,hyuwon);
          return true;
        });
      }
    }

    toast('삭제 완료','ok');
    _closeAttModal();
    buildTable();
    _updateAttBarInfo();
  }catch(e){
    toast('삭제 실패','err');
    console.error(e);
  }
}

// 오늘 모두 출석
async function markAllPresentForDate(){
  if(window.SCAuth && !SCAuth.requirePermission('attendanceCheck','출석 체크')) return;
  if(!_attendanceDate) return;
  const dow=['일','월','화','수','목','금','토'][new Date(_attendanceDate).getDay()];
  const now=new Date().toISOString();
  let cnt=0;
  try{
    await updateAttendanceMapTx(att=>{
      cnt=0;
      STUDENTS.forEach(stu=>{
        if(stu.d!==dow) return;
        const slotKey=stu.t+'/'+stu.d+'/'+stu.l+'/'+stu.r;
        const key=slotKey+'/'+_attendanceDate;
        const cur=att[key];
        const curVal=cur?(typeof cur==='string'?cur:cur.s):null;
        if(!curVal){
          att[key]={s:'present', at:now, by:null};
          cnt++;
        }
      });
      return att;
    });
    if(cnt===0){toast('체크할 학생이 없습니다','err');return;}
    buildTable();
    _updateAttBarInfo();
    toast(cnt+'명 출석 처리','ok');
  }catch(e){
    toast('출석 저장 실패','err');
    console.error(e);
  }
}

// 오늘 스냅샷 저장 (과거 날짜 동결용)
let _snapshotTimer=null;
function _ensureTodaySnapshot(){
  if(window.SCAuth && !SCAuth.can('editSchedule') && !SCAuth.can('attendanceCheck')) return;
  const today=toDateStr(getToday());
  if(_snapshotTimer) clearTimeout(_snapshotTimer);
  _snapshotTimer=setTimeout(()=>{
    const existing=DAY_SNAPSHOT[today];
    const nowStr=new Date().toISOString().slice(0,10);
    if(existing && existing.date===nowStr) return;
    DAY_SNAPSHOT[today]={
      date:nowStr,
      students:JSON.parse(JSON.stringify(STUDENTS)),
      inst:JSON.parse(JSON.stringify(INST_MAP)),
    };
    try{saveDaySnapshot();}catch(e){console.warn('snapshot save failed',e);}
  },500);
}

/* ════════════════════════════════════════════════════════════════
 * SECTION: 셀 툴팁 (마우스 hover)
 * ════════════════════════════════════════════════════════════════ */
let _tipTimer=null;
const _tip=document.getElementById('cell-tip');

function _showTip(el,html){
  _tip.innerHTML=html;
  _tip.style.left='-9999px';
  _tip.style.top='0';
  _tip.classList.add('show');
  const tw=_tip.offsetWidth, th=_tip.offsetHeight;
  const rect=el.getBoundingClientRect();
  let left=rect.right+6;
  let top=rect.top;
  if(left+tw>window.innerWidth) left=rect.left-tw-6;
  if(left<0) left=4;
  if(top+th>window.innerHeight) top=window.innerHeight-th-4;
  if(top<0) top=4;
  _tip.style.left=left+'px';
  _tip.style.top=top+'px';
}

document.addEventListener('mouseover',function(e){
  // 출석 모드면 툴팁 비활성화 (별개 데이터 뷰)
  if(_attendanceMode){ clearTimeout(_tipTimer); _tip.classList.remove('show'); return; }
  // 팝업 열려있으면 툴팁 안 보임
  if(document.getElementById('stu-popup').classList.contains('show')) return;
  if(document.getElementById('inst-popup').classList.contains('show')) return;

  // 대기자 뱃지 툴팁 (즉시)
  const rBadge=e.target.closest('.inst-reserve-badge');
  if(rBadge&&rBadge.dataset.reserveTip){
    clearTimeout(_tipTimer);
    _showTip(rBadge,`<div class="cell-tip-row" style="font-weight:700">대기자</div><div class="cell-tip-row">${rBadge.dataset.reserveTip}</div>`);
    return;
  }

  // 뱃지 툴팁 (즉시)
  const badge=e.target.closest('.cb');
  if(badge&&badge.dataset.tip){
    clearTimeout(_tipTimer);
    _showTip(badge,`<div class="cell-tip-row" style="font-weight:700">${badge.dataset.tip}</div>`);
    return;
  }

  // 셀 툴팁 (딜레이)
  const cell=e.target.closest('.stu-clickable');
  if(!cell) return;

  clearTimeout(_tipTimer);
  _tipTimer=setTimeout(()=>{
    const t=cell.dataset.t, day=cell.dataset.day;
    const lane=parseInt(cell.dataset.lane), ri=parseInt(cell.dataset.ri);
    const stu=getStu(t,day,lane,ri);
    if(!stu) return;

    let html=`<div class="cell-tip-name">${esc(stu.n)}${stu.a?'('+stu.a+')':''}${stu.g==='m'?' 👦':stu.g==='f'?' 👧':''}</div>`;
    if(stu.p) html+=`<div class="cell-tip-row"><b>📞</b> ${esc(stu.p)}</div>`;
    const nl2br = s => esc(s).replace(/\n/g,'<br>');
    const tipVehicle=stu.v||_tableLocUsesVehicle(stu.loc);
    if(tipVehicle) html+=`<div class="cell-tip-row"><b>🚐</b> ${stu.loc?nl2br(stu.loc):'차량 이용'}</div>`;
    if(stu.memo) html+=`<div class="cell-tip-row"><b>📝</b> ${nl2br(stu.memo)}</div>`;

    if(!stu.p&&!tipVehicle&&!stu.memo&&!stu.g) return;
    _showTip(cell,html);
  },400);
});

document.addEventListener('mouseout',function(e){
  if(e.target.closest('.stu-clickable')||e.target.closest('.cb')||e.target.closest('.inst-reserve-badge')){
    clearTimeout(_tipTimer);
    _tip.classList.remove('show');
  }
});

/* ════════════════════════════════════════════════════════════════
 * SECTION: 테이블 빌드 (buildTable ~350줄, 분할 대상)
 * ════════════════════════════════════════════════════════════════ */
/**
 * buildTable() 호출 직전 데이터 동기화
 * - 퇴원일 지난 학생 자동 삭제 (RETIRE_MAP은 유지)
 * - 등원일 된 학생 자동 등록 (ENROLL_MAP은 유지)
 * - 앱바 타이틀 갱신
 * - 만료된 isNew/enrolled 플래그 정리
 */
function syncStudentsBeforeRender(){
  // [v118] 타임머신 모드에서도 sync는 실행 (ENROLL_MAP→STUDENTS 옮겨야 미래 학생이 보임).
  //   영구 저장은 saveJSON 타임머신 가드로 차단됨.
  //   buildTable 끝에서 메모리 복원되므로 일반 모드 데이터 손상 X.
  let changed=false;
  let enrollChanged=false;
  let retireChanged=false;
  let hyuwonChanged=false;
  const todayStr=toDateStr(getToday());

  // 퇴원일 지난 학생 자동 삭제
  for(const [slotKey,entry] of Object.entries(RETIRE_MAP)){
    const retDs=entry?.ds||entry; // backward compat
    if(retDs<todayStr){
      const [t,d,l,r]=slotKey.split('/');
      const idx=STUDENTS.findIndex(s=>s.t===t&&s.d===d&&s.l===parseInt(l)&&s.r===parseInt(r));
      if(idx>=0){STUDENTS.splice(idx,1);changed=true;}
      delete _stuIdx[slotKey];

      // 같은 슬롯의 등원 항목이 퇴원일보다 이전이면(소비된 과거 등원) 같이 삭제
      // → 다음 enroll 패스에서 학생이 재등록되는 버그 방지
      const enr=ENROLL_MAP[slotKey];
      if(enr && enr.ds < retDs){
        delete ENROLL_MAP[slotKey];
        enrollChanged=true;
      }

      // [FIX #15] 퇴원 항목 소비 → 삭제 (재처리 방지).
      //  이전엔 RETIRE_MAP 항목이 영구히 남아, 같은 슬롯에 새 학생이 들어오면
      //  (등원 패스로 push되든 사용자가 직접 등록하든) 다음 render에서 슬롯키만 보고
      //  그 새 학생까지 splice해서 죽이는 race가 있었음.
      //  특히 "4/20 퇴원 + 4/27 신규 등원" 시나리오에서 4/27에 등원이 사라짐.
      delete RETIRE_MAP[slotKey];
      retireChanged=true;
      // 퇴원한 슬롯의 휴원도 정리 (orphan 방지 — 빈 셀에 휴원 뱃지 안 남음)
      if(HYUWON_MAP[slotKey]){
        delete HYUWON_MAP[slotKey];
        hyuwonChanged=true;
      }
    }
  }

  // 등원일 된 학생 자동 등록
  for(const [slotKey,entry] of Object.entries(ENROLL_MAP)){
    if(entry.ds<=todayStr){
      const [t,d,l,r]=slotKey.split('/');
      const li=parseInt(l),ri=parseInt(r);
      const existing=getStu(t,d,li,ri);
      if(!existing){
        const obj={n:entry.name,a:entry.age||null,t,d,l:li,r:ri};
        if(entry.p) obj.p=entry.p;
        if(entry.isNew) obj.isNew=entry.isNew;
        else if(entry.reenroll) obj.reenroll=entry.reenroll;
        else if(entry.enrolled){
          obj.enrolled=entry.ds;
        }
        // [v99] 등원 예약 시 입력한 차량/승하차/메모 적용
        if(entry.v) obj.v=true;
        if(entry.loc) obj.loc=entry.loc;
        if(entry.memo) obj.memo=entry.memo;
        // [v100] 성별도 적용
        if(entry.g) obj.g=entry.g;
        STUDENTS.push(obj);
        _stuIdx[slotKey]=obj;
        changed=true;
        // 등원 항목 소비 → 삭제 (재등록 방지)
        delete ENROLL_MAP[slotKey];
        enrollChanged=true;
      } else if(existing.n===entry.name){
        // 이미 등록된 같은 이름 → 과거 잔여 항목 정리
        delete ENROLL_MAP[slotKey];
        enrollChanged=true;
      }
    }
  }

  // 앱바 타이틀 업데이트
  const cp=SCHEDULE_PERIODS[getCurrentPeriod()];
  const yr=cp.start.split('-')[0];
  document.getElementById('app-period').textContent=yr+'년 '+cp.month+'월';

  // 만료된 신규/등원 플래그 정리
  // [FIX] 이전엔 in-memory만 mutate하고 저장하지 않아 새로고침/다른 디바이스에서 플래그가 부활했음.
  let flagChanged=false;
  STUDENTS.forEach(s=>{
    if(s.isNew&&s.isNew!==cp.month){ delete s.isNew; flagChanged=true; }
    if(s.reenroll&&s.reenroll!==cp.month){ delete s.reenroll; flagChanged=true; }
    if(s.enrolled&&s.enrolled<todayStr){ delete s.enrolled; flagChanged=true; }
  });
  if(changed||enrollChanged||retireChanged||hyuwonChanged||flagChanged){
    const periodMonth=cp.month;
    const stuKey=getTabConfig().stuKey;
    updateScheduleTx([stuKey,STORAGE_KEYS.ENROLL,STORAGE_KEYS.RETIRE,STORAGE_KEYS.休원], ctx=>{
      const students=ctx.get(stuKey,[]);
      const enroll=ctx.get(STORAGE_KEYS.ENROLL,{});
      const retire=ctx.get(STORAGE_KEYS.RETIRE,{});
      const hyuwon=ctx.get(STORAGE_KEYS.休원,{});
      let txStudentsChanged=false;
      let txEnrollChanged=false;
      let txRetireChanged=false;
      let txHyuwonChanged=false;

      const slotMatch=(s,slotKey)=>{
        const [t,d,l,r]=slotKey.split('/');
        return s.t===t&&s.d===d&&parseInt(s.l)===parseInt(l)&&parseInt(s.r)===parseInt(r);
      };

      for(const [slotKey,entry] of Object.entries(retire)){
        const retDs=entry?.ds||entry;
        if(retDs<todayStr){
          const idx=students.findIndex(s=>slotMatch(s,slotKey));
          if(idx>=0){students.splice(idx,1);txStudentsChanged=true;}
          const enr=enroll[slotKey];
          if(enr&&enr.ds<retDs){delete enroll[slotKey];txEnrollChanged=true;}
          delete retire[slotKey];
          txRetireChanged=true;
          if(hyuwon[slotKey]){delete hyuwon[slotKey];txHyuwonChanged=true;}
        }
      }

      for(const [slotKey,entry] of Object.entries(enroll)){
        if(entry.ds<=todayStr){
          const [t,d,l,r]=slotKey.split('/');
          const li=parseInt(l),ri=parseInt(r);
          const existing=students.find(s=>slotMatch(s,slotKey));
          if(!existing){
            const obj={n:entry.name,a:entry.age||null,t,d,l:li,r:ri};
            if(entry.p) obj.p=entry.p;
            if(entry.isNew) obj.isNew=entry.isNew;
            else if(entry.reenroll) obj.reenroll=entry.reenroll;
            else if(entry.enrolled) obj.enrolled=entry.ds;
            if(entry.v) obj.v=true;
            if(entry.loc) obj.loc=entry.loc;
            if(entry.memo) obj.memo=entry.memo;
            if(entry.g) obj.g=entry.g;
            students.push(obj);
            txStudentsChanged=true;
            delete enroll[slotKey];
            txEnrollChanged=true;
          } else if(existing.n===entry.name){
            delete enroll[slotKey];
            txEnrollChanged=true;
          }
        }
      }

      students.forEach(s=>{
        if(s.isNew&&s.isNew!==periodMonth){delete s.isNew;txStudentsChanged=true;}
        if(s.reenroll&&s.reenroll!==periodMonth){delete s.reenroll;txStudentsChanged=true;}
        if(s.enrolled&&s.enrolled<todayStr){delete s.enrolled;txStudentsChanged=true;}
      });

      if(txStudentsChanged) ctx.set(stuKey,students);
      if(txEnrollChanged) ctx.set(STORAGE_KEYS.ENROLL,enroll);
      if(txRetireChanged) ctx.set(STORAGE_KEYS.RETIRE,retire);
      if(txHyuwonChanged) ctx.set(STORAGE_KEYS.休원,hyuwon);
      return true;
    }).catch(e=>{console.error('syncStudentsBeforeRender transaction failed',e);});
  }
}

/**
 * <colgroup> 빌드: 요일별로 [시간열, (번호열?), 레인열×N]
 */
function buildColgroup(DAYS, HAS_NUM, LANE_COUNT){
  const colgroup=document.createElement('colgroup');
  // [v118] CSS 변수로 동적 줌 적용
  DAYS.forEach(day=>{
    const hasNum=HAS_NUM.includes(day);
    colgroup.appendChild(Object.assign(document.createElement('col'),{style:'width:var(--w-time-col)'}));
    if(hasNum) colgroup.appendChild(Object.assign(document.createElement('col'),{style:'width:var(--w-num-col)'}));
    for(let i=0;i<LANE_COUNT;i++) colgroup.appendChild(Object.assign(document.createElement('col'),{style:'width:var(--w-cell)'}));
  });
  return colgroup;
}

/**
 * <thead> 빌드: 2행 (날짜 헤더 + 레인 헤더)
 */
function buildThead(DAYS, HAS_NUM, LANE_COUNT, DATE_HDR){
  const thead=document.createElement('thead');
  const todayDs=toDateStr(getToday());

  // r1: 요일/날짜 헤더
  const r1=document.createElement('tr');r1.className='day-hdr-row';
  DAYS.forEach((day,di)=>{
    const th=document.createElement('th');
    th.colSpan=HAS_NUM.includes(day)?LANE_COUNT+2:LANE_COUNT+1;
    th.className='dh'+(day==='토'?' dh-sat':'')+(di<DAYS.length-1?(' day-sep'+(_isTodayDay(day)?' day-sep-today':'')):'');
    th.style.textAlign='center';
    const hdr=DATE_HDR[day];
    if(hdr.ds===todayDs) th.classList.add('dh-today');
    if(hdr.closedLabel){
      th.classList.add('dh-closed');
      th.innerHTML=`<span class="dh-closed-tag">${esc(hdr.closedLabel)}</span>${esc(hdr.label)}`;
    } else {
      th.textContent=hdr.label;
    }
    r1.appendChild(th);
  });
  thead.appendChild(r1);

  // r2: 시간/번/레인 헤더
  const r2=document.createElement('tr');r2.className='lh-row';
  DAYS.forEach((day,di)=>{
    const hasNum=HAS_NUM.includes(day);
    const thT=document.createElement('th');thT.className='col-time-day-hdr';thT.textContent='시간';r2.appendChild(thT);
    if(hasNum){const thN=document.createElement('th');thN.className='col-num-day-hdr';thN.textContent='번';r2.appendChild(thN);}
    for(let li=0;li<LANE_COUNT;li++){
      const th=document.createElement('th');th.className='lh dc';
      if(li===LANE_COUNT-1&&di<DAYS.length-1){ th.classList.add('day-sep'); if(_isTodayDay(day)) th.classList.add('day-sep-today'); }
      th.textContent=`${li+1}레인`;r2.appendChild(th);
    }
  });
  thead.appendChild(r2);
  return thead;
}

/**
 * 담임 행(instRow) 빌드: 한 시간대의 담임 정보 표시
 * - 시간 셀(rowspan), 담임 라벨(번호열), 레인별 담임 셀
 * - 엘마반 인접 합치기 처리
 */
function buildInstRow(t, rows, hasSat, DAYS, HAS_NUM, LANE_COUNT, SAT_TIME_LABEL){
  const instRow=document.createElement('tr');
  instRow.className='inst-hdr-row';

  DAYS.forEach((day,di)=>{
    const hasNum=HAS_NUM.includes(day);
    const isSat=day==='토';
    const satEmpty=isSat&&!hasSat;
    const kimhs=getElmaLanes(t,day);

    // 시간 셀 (rowspan으로 학생 행까지 덮음)
    const tdT=document.createElement('td');
    tdT.rowSpan=1+rows;
    tdT.className='col-time-day';
    if(satEmpty){tdT.textContent='';tdT.classList.add('cell-blocked');}
    else if(isSat){tdT.textContent=SAT_TIME_LABEL[t];}
    else{tdT.textContent=t;}
    instRow.appendChild(tdT);

    // 번호 열 라벨 ("담임")
    if(hasNum){
      const tdN=document.createElement('td');
      tdN.className='col-num-day inst-lbl';
      if(satEmpty){tdN.textContent='';tdN.classList.add('cell-blocked');}
      else{tdN.textContent='담임';}
      instRow.appendChild(tdN);
    }

    // 레인별 담임 셀
    let li=0;
    while(li<LANE_COUNT){
      const td=document.createElement('td');

      if(satEmpty){
        td.className='dc cell-blocked';
        if(li===LANE_COUNT-1&&di<DAYS.length-1){td.classList.add('day-sep');if(_isTodayDay(day))td.classList.add('day-sep-today');}
        instRow.appendChild(td);
        li++;
        continue;
      }

      const inst=getInst(t,day,li+1);
      const pairStart=getElmaPairStart(kimhs,li);
      const pairEnd=getElmaPairEnd(kimhs,li);
      const isElma=isElmaLane(kimhs,li);
      const _lane=li+1;

      // 출석 모드 + 이 요일에 해당하는 + 버튼을 inst 셀에 추가하는 헬퍼
      const _addAttPlusBtn=(td, laneNum)=>{
        if(!_attendanceMode || !_attendanceDate) return;
        if(window.SCAuth && !SCAuth.can('attendanceCheck')) return;
        const cellDs=_dayToCellDs(day);
        const btn=document.createElement('span');
        btn.className='att-add-inst';
        btn.textContent='＋';
        btn.title='원생 추가';
        btn.addEventListener('click',function(e){
          e.stopPropagation();
          _openAttAddModalForLane(t, day, laneNum, cellDs);
        });
        td.appendChild(btn);
      };

      if(pairStart){
        // 인접 엘마/엘리트/마스터 쌍 시작 → 합치기 (colspan=2)
        td.colSpan=2;
        const elmaInst=inst||getInst(t,day,li+2);
        // [v117] 선생님 색상 클래스 추가 (지정되어 있으면 디폴트 보라 대신 선생님 색상 사용)
        const _tCls=elmaInst?teacherCssClass(elmaInst.n):'';
        td.className='dc inst-cell-kimhs inst-clickable'+(_tCls?' '+_tCls:'');
        if(pairStart[1]>=4&&di<DAYS.length-1){td.classList.add('day-sep');if(_isTodayDay(day))td.classList.add('day-sep-today');}
        const iKey=t+'/'+day+'/'+(li+1);
        // [v117] cls(엘/마/엘리트/마스터)에 따라 라벨 동적
        const _cls=getInstCls(elmaInst);
        const _lbl=getInstClsLabel(_cls)||'(엘/마)';
        const _lblTextOnly=_lbl.replace(/[()]/g,'');
        td.innerHTML=instCellHTML(elmaInst?(elmaInst.n+_lbl):_lblTextOnly,iKey);
        td.style.fontWeight='700';td.style.fontSize='11px';
        td.addEventListener('click',function(){openInstPopup(this,t,day,_lane);});
        _addAttPlusBtn(td, _lane);
        instRow.appendChild(td);
        li+=2;
      } else if(pairEnd){
        // 인접 엘마 쌍의 두번째 → 이미 합쳐짐, 스킵
        li++;
      } else if(isElma){
        // 단독 엘마/엘리트/마스터 (합치기 없음)
        // [v117] 선생님 색상 클래스 추가
        const _tCls=inst?teacherCssClass(inst.n):'';
        td.className='dc inst-cell-kimhs inst-clickable'+(_tCls?' '+_tCls:'');
        if(li===LANE_COUNT-1&&di<DAYS.length-1){td.classList.add('day-sep');if(_isTodayDay(day))td.classList.add('day-sep-today');}
        const iKey=t+'/'+day+'/'+(li+1);
        // [v117] cls(엘/마/엘리트/마스터)에 따라 라벨 동적
        const _cls=getInstCls(inst);
        const _lbl=getInstClsLabel(_cls)||'(엘/마)';
        const _lblTextOnly=_lbl.replace(/[()]/g,'');
        td.innerHTML=instCellHTML(inst?(inst.n+_lbl):_lblTextOnly,iKey);
        td.style.fontWeight='700';td.style.fontSize='11px';
        td.addEventListener('click',function(){openInstPopup(this,t,day,_lane);});
        _addAttPlusBtn(td, _lane);
        instRow.appendChild(td);
        li++;
      } else {
        // 일반 담임 셀
        td.className='dc '+instClass(inst)+' inst-clickable';
        if(li===LANE_COUNT-1&&di<DAYS.length-1){td.classList.add('day-sep');if(_isTodayDay(day))td.classList.add('day-sep-today');}
        const iKey=t+'/'+day+'/'+(li+1);
        td.innerHTML=instCellHTML(instDisplay(inst),iKey);
        td.style.fontWeight='700';td.style.fontSize='11px';
        td.addEventListener('click',function(){openInstPopup(this,t,day,_lane);});
        if(inst && inst.n){
          _addAttPlusBtn(td, _lane);  // 담임 있을 때만
        }
        instRow.appendChild(td);
        li++;
      }
    }
  });

  return instRow;
}

/**
 * 학생 행(stuRow) 빌드: 한 시간대 한 줄(번호 ri)
 * - 4가지 셀 상태: satEmpty / satSkip(or dayBlocked) / disabled / 일반
 * - 일반 셀: 학생 + 뱃지(퇴원/등원/결석/보강/샘플) + 클래스(신규/등원/차량/보강전용)
 *
 * ctx: { DAYS, HAS_NUM, LANE_COUNT, DATE_HDR, classDatesCache, namePrefix, todayStr }
 */
function buildStuRow(t, ri, rows, hasSat, ctx){
  const {DAYS, HAS_NUM, LANE_COUNT, DATE_HDR, classDatesCache, namePrefix, todayStr} = ctx;
  const stuRow=document.createElement('tr');
  const isBangteukTable=typeof isBangteuk==='function'&&isBangteuk();
  const baseSlotRows=isBangteukTable?6:5;
  // 정규 5행(ri 0~4) 이후는 반칸 높이 (추가 학생용)
  // 단, 엘마 시간대는 6~8행도 엘마반 정규 자리이므로 풀 높이 유지
  if(ri>=baseSlotRows && !hasElmaInTime(t)) stuRow.classList.add('half-row');
  const curMonth=SCHEDULE_PERIODS[getCurrentPeriod()].month;

  const slotHasStoredContent=(day,lane,row)=>{
    const slotKey=t+'/'+day+'/'+lane+'/'+row;
    if(getStu(t,day,lane,row)) return true;
    if(RETIRE_MAP[slotKey]||ENROLL_MAP[slotKey]||DISABLED_MAP[slotKey]||HYUWON_MAP[slotKey]) return true;
    const markPrefix=slotKey+'/';
    return Object.keys(MARK_MAP||{}).some(k=>k.startsWith(markPrefix));
  };
  const rowHasStoredContent=(day,row)=>{
    for(let lane=1;lane<=LANE_COUNT;lane++){
      if(slotHasStoredContent(day,lane,row)) return true;
    }
    return false;
  };

  DAYS.forEach((day,di)=>{
    const hasNum=HAS_NUM.includes(day);
    const isSat=day==='토';
    const satEmpty=isSat&&!hasSat;
    const kimhs=getElmaLanes(t,day);
    const rowHasContent=rowHasStoredContent(day,ri+1);
    const satSkip=isSat&&!satEmpty&&rows>5&&!kimhs&&ri>=5&&!rowHasContent;
    const dayBlocked=!satSkip&&rows>baseSlotRows&&!kimhs&&ri>=baseSlotRows&&!rowHasContent;

    // 번호 셀
    if(hasNum){
      const tdNn=document.createElement('td');
      tdNn.className='col-num-day';
      if(satEmpty||satSkip||dayBlocked){tdNn.textContent='';tdNn.classList.add('cell-blocked');}
      else{tdNn.textContent=ri+1;}
      stuRow.appendChild(tdNn);
    }

    // 토요일 5행 초과 → 전체 막기
    if(satSkip){
      for(let li=0;li<LANE_COUNT;li++){
        const td=document.createElement('td');
        td.className='dc cell-blocked';
        if(li===LANE_COUNT-1&&di<DAYS.length-1){td.classList.add('day-sep');if(_isTodayDay(day))td.classList.add('day-sep-today');}
        stuRow.appendChild(td);
      }
      return;
    }

    // 레인별 셀
    for(let li=0;li<LANE_COUNT;li++){
      const td=document.createElement('td');

      // 케이스 1: 토요일 시간 자체가 비어있음
      if(satEmpty){
        td.className='dc cell-blocked';
        if(li===LANE_COUNT-1&&di<DAYS.length-1){td.classList.add('day-sep');if(_isTodayDay(day))td.classList.add('day-sep-today');}
        stuRow.appendChild(td);
        continue;
      }

      const isElma=isElmaLane(kimhs,li);
      const _l=li+1, _r=ri+1;
      const slotKey=t+'/'+day+'/'+_l+'/'+_r;
      // 일반 레인 5행 초과는 기본적으로 blocked
      // 단, 실제 저장 데이터가 있는 칸은 6~8번이어도 가리지 않는다.
      let isBlocked=rows>baseSlotRows&&!isElma&&ri>=baseSlotRows&&!slotHasStoredContent(day,_l,_r);
      if(isBlocked && _attendanceMode && _attendanceDate){
        const _cellDsChk=_dayToCellDs(day);
        const _hasContent=MARK_MAP[slotKey+'/'+_cellDsChk]
          || STUDENTS.some(s=>s.t===t&&s.d===day&&s.l===_l&&s.r===_r);
        if(_hasContent) isBlocked=false;
      }

      // 케이스 2: 평일 5행 초과 (엘마 제외)
      if(isBlocked){
        td.className='dc cell-blocked';
        if(li===LANE_COUNT-1&&di<DAYS.length-1){td.classList.add('day-sep');if(_isTodayDay(day))td.classList.add('day-sep-today');}
        stuRow.appendChild(td);
        continue;
      }

      // 케이스 3: 비활성화된 빈 셀 (회색이지만 클릭 가능)
      if(isDisabled(slotKey)&&!getStu(t,day,_l,_r)){
        td.className='dc cell-blocked stu-clickable';
        td.style.cursor='pointer';
        if(li===LANE_COUNT-1&&di<DAYS.length-1){td.classList.add('day-sep');if(_isTodayDay(day))td.classList.add('day-sep-today');}
        td.dataset.t=t;td.dataset.day=day;td.dataset.lane=_l;td.dataset.ri=_r;
        td.addEventListener('click',function(){openStuPopup(this,t,day,_l,_r);});
        stuRow.appendChild(td);
        continue;
      }

      // 케이스 4: 일반 학생 셀 ─────────────────────────────
      const stu=getStu(t,day,_l,_r);

      td.className='stu-cell dc stu-clickable';
      // 출석 모드 상태 판단 (특수 배경 클래스 분기에 필요)
      const _attIsActive=_attendanceMode && _attendanceDate;
      // 출석 모드면 특수 배경/마크 클래스 적용 안 함 (흰 배경 유지)
      if(!_attIsActive){
        const stuVehicle=stu&&(stu.v||_tableLocUsesVehicle(stu.loc));
        if(stuVehicle) td.classList.add('stu-vehicle');
        if(stu&&stu.isNew&&stu.isNew===curMonth) td.classList.add('stu-new');
        if(stu&&(stu.memo||stuVehicle||stu.p||stu.g)) td.classList.add('stu-has-note');
      }
      if(li===LANE_COUNT-1&&di<DAYS.length-1){td.classList.add('day-sep');if(_isTodayDay(day))td.classList.add('day-sep-today');}
      td.dataset.t=t;td.dataset.day=day;td.dataset.lane=_l;td.dataset.ri=_r;
      // 출석 모드에서는 각 요일 셀이 해당 주의 그 날짜로 작동 (모든 요일 활성)
      const _attDayMatch=_attIsActive;
      const _cellDs=_attIsActive?_dayToCellDs(day):null;

      // 출석 모드 + 해당 요일이 휴관일이면 흐림 처리
      let _attDayClosed=false;
      if(_attIsActive){
        const _hdr=DATE_HDR?.[day];
        if(_hdr && _hdr.closedLabel){
          td.classList.add('att-closed-col');
          _attDayClosed=true;
        }
      }

      // 출석 모드 + 해당 요일 → 정규/보강/샘플/결석/휴원 혼합 상태 계산 (cellDs 기준)
      let _attPrimary=null, _attSub=null;
      if(_attDayMatch && !_attDayClosed){
        const _mark=MARK_MAP[slotKey+'/'+_cellDs];
        const _hy=HYUWON_MAP[slotKey];
        const _isHy=!!(_hy && _hy.dates && _hy.dates.includes(_cellDs));
        if(stu){
          _attPrimary={type:'regular', n:stu.n, a:stu.a, hyuwon:_isHy};
        }
        if(_mark){
          if(_mark.type==='absent'){
            if(_attPrimary) _attPrimary.absent=true;
            if(_mark.sub){
              _attSub={type:_mark.sub.type, n:_mark.sub.n, a:_mark.sub.a};
            }
          } else if(_mark.type==='bogang'||_mark.type==='sample'){
            if(_attPrimary){
              // 원생이 있으면 보강/샘플은 sub로 추가 표시
              _attSub={type:_mark.type, n:_mark.n, a:_mark.a};
            } else {
              // 원생 없으면 보강/샘플을 primary로
              _attPrimary={type:_mark.type, n:_mark.n, a:_mark.a};
            }
          }
        }
      }

      // 클릭 핸들러
      if(_attDayMatch){
        const cellDsCaptured=_cellDs;
        td.addEventListener('click',function(e){
          // 편집 모드면 셀 편집 (출석 모달 대신)
          if(_attEditMode){
            e.stopPropagation();
            _editAttCell(slotKey, cellDsCaptured);
            return;
          }
          if(_attDayClosed) return;
          // 2칸 분할: row 내부 data-pk로 분기
          const rowEl=e.target.closest('[data-pk]');
          if(rowEl){
            const pk=rowEl.dataset.pk;
            e.stopPropagation();
            if(pk==='sub' && _attSub){
              _openAttModal(slotKey, true, _attSub, cellDsCaptured);
            } else if(pk==='primary' && _attPrimary && !_attPrimary.hyuwon){
              _openAttModal(slotKey, false, _attPrimary, cellDsCaptured);
            }
            return;
          }
          // 단일 셀: primary 우선
          if(_attPrimary && !_attPrimary.hyuwon){
            e.stopPropagation();
            _openAttModal(slotKey, false, _attPrimary, cellDsCaptured);
          } else if(_attSub){
            e.stopPropagation();
            _openAttModal(slotKey, true, _attSub, cellDsCaptured);
          }
        });
      } else {
        td.addEventListener('click',function(){openStuPopup(this,t,day,_l,_r);});
      }

      // 등원(비신규) 빨간 배경 — 등원일까지만 (출석 모드에선 스킵)
      if(!_attIsActive && stu&&!td.classList.contains('stu-new')){
        if(stu.reenroll&&stu.reenroll===curMonth){
          td.classList.add('stu-enrolled');
        } else if(stu.enrolled&&stu.enrolled>=todayStr){
          td.classList.add('stu-enrolled');
        }
      }

      // ── 이벤트 수집 (그리드 뱃지) ──
      const classDates=classDatesCache[day];
      const allDates=[...classDates.cur,...classDates.next];
      const retEntry=RETIRE_MAP[slotKey];
      const retDs=retEntry?.ds||null;
      const enrEntry=ENROLL_MAP[slotKey];

      const badges=[];
      const _dl=ds=>{ const p=ds.slice(5).split('-'); return parseInt(p[0])+'/'+parseInt(p[1]); };

      // 출석 모드에서는 뱃지/마크 전부 숨김 (출석만 깔끔하게)
      const _skipBadges = _attendanceMode;

      // 휴원
      const hyuwon=HYUWON_MAP[slotKey];
      if(!_skipBadges && hyuwon){
        // 신 형식(dates 배열)
        if(hyuwon.dates&&hyuwon.dates.length){
          const futureDates=hyuwon.dates.filter(d=>d>=todayStr).sort();
          if(futureDates.length){
            const first=futureDates[0];
            const last=futureDates[futureDates.length-1];
            const labels=futureDates.map(d=>_dl(d)).join(',');
            // [v118] 휴원은 최대 2주 → 1일이면 단일 날짜, 여러 일이면 시작~종료
            const text = futureDates.length===1
              ? '휴 '+_dl(first)
              : '휴 '+_dl(first)+'~'+_dl(last);
            badges.push({type:'hyuwon', ds:first, text, tip:'휴원 '+labels});
          }
        }
        // 구 형식(from/to) 호환
        else if(hyuwon.from&&hyuwon.to>=todayStr){
          const fl=_dl(hyuwon.from), tl=_dl(hyuwon.to);
          badges.push({type:'hyuwon', ds:hyuwon.from, text:'휴 '+fl+'~'+tl, tip:'휴원 '+fl+' ~ '+tl});
        }
      }
      // 퇴원
      if(!_skipBadges && retDs&&retDs>=todayStr){
        const dl=_dl(retDs), nm=retEntry?.name||'';
        badges.push({type:'retire', ds:retDs, text:nm+' '+dl, tip:'제외 '+nm+' '+dl});
      }
      // 등원
      if(!_skipBadges && enrEntry&&enrEntry.ds>todayStr){
        const dl=_dl(enrEntry.ds), nm=enrEntry.name||'';
        badges.push({type:'enroll', ds:enrEntry.ds, text:nm+' '+dl, tip:'등록 '+nm+(enrEntry.age?' '+enrEntry.age:'')+' '+dl});
      }
      // 결석/보강/샘플
      if(!_skipBadges) allDates.forEach(d=>{
        if(d.closed||d.ds<todayStr) return;
        const mark=getMark(slotKey,d.ds);
        if(!mark) return;
        const dl=_dl(d.ds);
        if(mark.type==='absent'){
          badges.push({type:'absent', ds:d.ds, text:dl, tip:'결석 '+dl});
          if(mark.sub){
            const nm=mark.sub.n||'';
            let stip=(mark.sub.type==='bogang'?'보강 ':'샘플 ')+nm+(mark.sub.a?' '+mark.sub.a:'')+' '+dl;
            if(mark.sub.p) stip+='<br>'+esc(mark.sub.p);
            if(mark.sub.memo) stip+='<br>'+esc(mark.sub.memo);
            badges.push({type:mark.sub.type, ds:d.ds, text:nm+' '+dl, tip:stip});
          }
        } else if(mark.type==='bogang'||mark.type==='sample'){
          const nm=mark.n||'';
          let mtip=(mark.type==='bogang'?'보강 ':'샘플 ')+nm+(mark.a?' '+mark.a:'')+' '+dl;
          if(mark.p) mtip+='<br>'+esc(mark.p);
          if(mark.memo) mtip+='<br>'+esc(mark.memo);
          badges.push({type:mark.type, ds:d.ds, text:nm+' '+dl, tip:mtip});
        }
      });

      // 학부모가 신청한 대기중 보강 요청 (도착지 셀)
      if(!_skipBadges) for(const req of Object.values(REQUESTS||{})){
        if(req.type!=='bogang') continue;
        if(req.status && req.status!=='pending') continue;
        const tg=req.target;
        if(!tg) continue;
        if(tg.t!==t||tg.d!==day||parseInt(tg.l)!==_l||parseInt(tg.r)!==_r) continue;
        if(tg.ds<todayStr) continue;
        const nm=req.parent?.name||'';
        const dl=_dl(tg.ds);
        let ptip='보강 신청 (승인 대기) '+nm+(req.parent?.age?'('+req.parent.age+')':'')+' '+dl;
        if(req.parent?.phone) ptip+='<br>'+esc(req.parent.phone);
        badges.push({type:'pending-bogang', ds:tg.ds, text:'⏳'+nm+' '+dl, tip:ptip});
      }
      // 대기중 결석 취소 요청 (자기 슬롯)
      if(!_skipBadges) for(const req of Object.values(REQUESTS||{})){
        if(req.type!=='absent-cancel') continue;
        if(req.status && req.status!=='pending') continue;
        const p=req.parent;
        if(!p) continue;
        if(p.studentSlotKey!==slotKey) continue;
        const tg=req.target;
        if(!tg||tg.ds<todayStr) continue;
        const nm=p.name||'';
        const dl=_dl(tg.ds);
        let ptip='결석 취소 신청 (승인 대기) '+nm+' '+dl;
        badges.push({type:'pending-cancel', ds:tg.ds, text:'⏳취소 '+dl, tip:ptip});
      }

      // 등원 대기 → 빨간 테두리 (출석 모드에선 숨김)
      if(!_skipBadges && enrEntry&&enrEntry.ds>todayStr) td.classList.add('stu-enroll-pending');
      // 대기중 요청 있으면 주황 테두리
      if(badges.some(b=>b.type==='pending-bogang'||b.type==='pending-cancel')){
        td.classList.add('stu-req-pending');
      }

      // 뱃지 HTML (당일~다음주 → 상단, 그 외 → 하단 2x2)
      badges.sort((a,b)=>a.ds<b.ds?-1:a.ds>b.ds?1:0);
      const nearDates=new Set(allDates.filter(d=>!d.closed&&d.ds>=todayStr).map(d=>d.ds));
      const topBadges=badges.filter(b=>nearDates.has(b.ds));
      const btmBadges=badges.filter(b=>!nearDates.has(b.ds)).slice(0,4);
      let badgeHtml='';
      if(topBadges.length){
        const t=topBadges[0];
        badgeHtml+=`<span class="cb cb-top cb-${t.type}" data-tip="${esc(t.tip)}">${t.text}</span>`;
        // 상단 나머지도 하단으로
        topBadges.slice(1).forEach(b=>{ if(btmBadges.length<4) btmBadges.push(b); });
        btmBadges.sort((a,b)=>a.ds<b.ds?-1:a.ds>b.ds?1:0);
      }
      if(btmBadges.length){
        const items=btmBadges.map(b=>`<span class="cb cb-${b.type}" data-tip="${esc(b.tip)}">${b.text}</span>`).join('');
        badgeHtml+=`<span class="cell-badges">${items}</span>`;
      }

      // 셀 내용 그리기
      if(_attDayMatch){
        // 출석 모드: primary/sub 혼합 렌더링
        if(!_attPrimary && !_attSub){
          td.classList.add('stu-empty');
        } else {
          const renderIcon=(s)=> s==='present'?'<span class="att-icon att-icon-p">✓</span>'
            :s==='absent'?'<span class="att-icon att-icon-a">✗</span>'
            :s==='hyuwon'?'<span class="att-icon att-icon-h">휴</span>'
            :'<span class="att-icon att-icon-u">○</span>';

          // Primary + Sub 둘 다 있으면 2칸 분할 렌더링
          if(_attPrimary && _attSub){
            td.classList.add('att-split');
            // Primary row 상태
            let ps;
            if(_attPrimary.hyuwon) ps='hyuwon';
            else if(_attPrimary.absent) ps='absent';
            else {
              const a=ATTENDANCE[slotKey+'/'+_cellDs];
              ps=a?(typeof a==='string'?a:a.s):'';
            }
            const primaryBg=_attPrimary.hyuwon?'att-hyuwon':
              _attPrimary.type==='bogang'?'att-bogang':
              _attPrimary.type==='sample'?'att-sample':
              ps==='present'?'att-present':
              ps==='absent'?'att-absent':'att-unchecked';
            const primaryTag=_attPrimary.type==='bogang'?'<span class="att-tag tag-bo">보</span>':
                             _attPrimary.type==='sample'?'<span class="att-tag tag-sa">샘</span>':'';

            // Sub row 상태
            const sa=ATTENDANCE[slotKey+'/'+_cellDs+'#sub'];
            const ss=sa?(typeof sa==='string'?sa:sa.s):'';
            const subBg=_attSub.type==='bogang'?'att-bogang':
              _attSub.type==='sample'?'att-sample':'att-unchecked';
            const subTag=_attSub.type==='bogang'?'<span class="att-tag tag-bo">보</span>':
                         '<span class="att-tag tag-sa">샘</span>';

            td.innerHTML=
              `<div class="att-row att-row-primary ${primaryBg}" data-pk="primary">`+
                renderIcon(ps)+`<span class="att-nm">${esc(_attPrimary.n)}${_attPrimary.a||''}${primaryTag}</span>`+
              `</div>`+
              `<div class="att-row att-row-sub ${subBg}" data-pk="sub">`+
                renderIcon(ss)+`<span class="att-nm">${esc(_attSub.n)}${_attSub.a||''}${subTag}</span>`+
              `</div>`;
          } else {
            // 단일 렌더링 (Primary 또는 Sub 중 하나만)
            let html='';
            if(_attPrimary){
              let s;
              if(_attPrimary.hyuwon) s='hyuwon';
              else if(_attPrimary.absent) s='absent';
              else {
                const a=ATTENDANCE[slotKey+'/'+_cellDs];
                s=a?(typeof a==='string'?a:a.s):'';
              }
              if(s==='hyuwon') td.classList.add('att-hyuwon');
              else if(_attPrimary.type==='bogang') td.classList.add('att-bogang');
              else if(_attPrimary.type==='sample') td.classList.add('att-sample');
              else if(s==='present') td.classList.add('att-present');
              else if(s==='absent') td.classList.add('att-absent');
              else td.classList.add('att-unchecked');

              const typeTag=_attPrimary.type==='bogang'?'<span class="att-tag tag-bo">보</span>':
                            _attPrimary.type==='sample'?'<span class="att-tag tag-sa">샘</span>':'';
              html+=renderIcon(s)+`<span class="att-nm">${esc(_attPrimary.n)}${_attPrimary.a||''}${typeTag}</span>`;
            }
            if(_attSub){
              const sa=ATTENDANCE[slotKey+'/'+_cellDs+'#sub'];
              const ss=sa?(typeof sa==='string'?sa:sa.s):'';
              const subTypeTag=_attSub.type==='bogang'?'보':'샘';
              html+=` <span class="att-sub" data-pk="sub">[${renderIcon(ss)}${esc(_attSub.n)}${_attSub.a||''}${subTypeTag}]</span>`;
            }
            td.innerHTML=html;
          }
        }
      } else if(stu){
        const prefix=namePrefix[slotKey]||'';
        const display=(prefix?prefix+'.':'')+stu.n+(stu.a||'');
        let html=`<span class="stu-name-text">${esc(display)}</span>`;
        if(badgeHtml) html+=badgeHtml;
        td.innerHTML=html;
      } else {
        if(badgeHtml){
          let hasMark=false, allBogang=true;
          allDates.forEach(d=>{
            const mk=getMark(slotKey,d.ds);
            if(mk){hasMark=true; if(mk.type!=='bogang')allBogang=false;}
          });
          if(hasMark&&allBogang) td.classList.add('stu-bogang-only');
          td.innerHTML=badgeHtml;
        } else {
          td.classList.add('stu-empty');
          // 출석 편집 모드 + 다른 요일 빈 셀에도 + 추가 힌트
          if(_attIsActive && _attEditMode){
            td.innerHTML='<span style="color:#D1D5DB;font-size:10px">+ 추가</span>';
          }
        }
      }

      stuRow.appendChild(td);
    }
  });

  return stuRow;
}

function buildTable(){
  const DAYS=getDays(),TIMES=getTimes(),SAT_TIME_LABEL=getSatLabel(),HAS_NUM=getHasNum(),LANE_COUNT=getLanes();

  // [v118] 타임머신 모드: sync로 메모리 변경되더라도 buildTable 끝에 복원 → 영구 손상 X
  let _tmBackup = null;
  if(typeof _fakeDate !== 'undefined' && _fakeDate){
    _tmBackup = {
      stu: STUDENTS.slice(),
      stuIdx: Object.assign({}, _stuIdx),
      enroll: JSON.parse(JSON.stringify(ENROLL_MAP)),
      retire: JSON.parse(JSON.stringify(RETIRE_MAP)),
    };
  }

  syncStudentsBeforeRender();
  const todayStr=toDateStr(getToday());

  // 출석 모드 + 과거 주 → 해당 주의 스냅샷 사용
  // (주 내의 각 날짜 스냅샷을 찾고, 없으면 가장 가까운 과거 스냅샷 사용)
  let _snapshotSwapped=false;
  let _origStudentsCopy=null, _origInstCopy=null, _origStuIdxKeys=null;
  let _snapRef=null;
  if(_attendanceMode && _attendanceDate){
    // 선택 주의 월요일~토요일 중 가장 최근 날짜의 스냅샷 찾기 (주 전체가 과거일 때)
    const weekMon=_getWeekMon(_attendanceDate);
    const sat=new Date(weekMon); sat.setDate(sat.getDate()+5);
    const satStr=toDateStr(sat);
    if(satStr<todayStr){  // 주 전체가 과거
      // 주 내의 모든 날짜의 스냅샷 중 하나 선택
      for(let off=5; off>=0; off--){
        const d=new Date(weekMon); d.setDate(d.getDate()+off);
        const dsStr=toDateStr(d);
        if(DAY_SNAPSHOT[dsStr] && DAY_SNAPSHOT[dsStr].students){
          _snapRef=DAY_SNAPSHOT[dsStr];
          break;
        }
      }
    }
  }
  if(_snapRef){
    const snap=_snapRef;
    if(snap.students && snap.inst){
      // STUDENTS/INST_MAP 내용 교체 (참조 유지)
      _origStudentsCopy=STUDENTS.slice();
      _origInstCopy=Object.assign({},INST_MAP);
      _origStuIdxKeys=Object.keys(_stuIdx);
      // 기존 clear
      STUDENTS.length=0;
      Object.keys(INST_MAP).forEach(k=>delete INST_MAP[k]);
      Object.keys(_stuIdx).forEach(k=>delete _stuIdx[k]);
      // 스냅샷 주입
      snap.students.forEach(s=>STUDENTS.push(s));
      Object.assign(INST_MAP, snap.inst);
      STUDENTS.forEach(s=>{_stuIdx[s.t+'/'+s.d+'/'+s.l+'/'+s.r]=s;});
      _snapshotSwapped=true;
    }
  }

  const wrap=document.getElementById('tbl');
  const tbl=document.createElement('table');
  tbl.className='sched-tbl';

  const DATE_HDR=getDateHeaders();
  // 요일별 수업일 캐시 (학생 행에서도 사용)
  const _classDatesCache={};
  DAYS.forEach(day=>{_classDatesCache[day]=getClassDatesForDay(day);});

  tbl.appendChild(buildColgroup(DAYS, HAS_NUM, LANE_COUNT));
  tbl.appendChild(buildThead(DAYS, HAS_NUM, LANE_COUNT, DATE_HDR));

  /* tbody */
  const tbody=document.createElement('tbody');

  // 같은 시간+요일 동명이인 접두어 계산
  const _namePrefix={};
  TIMES.forEach(({t})=>{
    DAYS.forEach(day=>{
      const nameSlots={};
      const maxRows=getTimeRows(t);
      for(let l=1;l<=LANE_COUNT;l++) for(let r=1;r<=maxRows;r++){
        const s=getStu(t,day,l,r);
        if(s){
          if(!nameSlots[s.n]) nameSlots[s.n]=[];
          nameSlots[s.n].push(t+'/'+day+'/'+l+'/'+r);
        }
      }
      for(const [name,slots] of Object.entries(nameSlots)){
        if(slots.length>1){
          const abc='abcdefghijklmnop';
          slots.forEach((key,i)=>{ _namePrefix[key]=abc[i]||''; });
        }
      }
    });
  });

  TIMES.forEach(({t})=>{
    let rows=getTimeRows(t);
    // 출석 모드: 해당 시간대의 해당 주에 추가된 row들(MARK_MAP)까지 확장
    if(_attendanceMode && _attendanceDate){
      let maxRi=rows;
      DAYS.forEach(ddKey=>{
        const dsStr=_dayToCellDs(ddKey);
        for(const mk of Object.keys(MARK_MAP)){
          if(!mk.startsWith(t+'/'+ddKey+'/')) continue;
          const parts=mk.split('/');
          if(parts.length!==5) continue;
          if(parts[4]!==dsStr) continue;
          const ri=parseInt(parts[3]);
          if(ri>maxRi) maxRi=ri;
        }
      });
      rows=Math.max(rows, maxRi);
    }
    const hasSat=!!SAT_TIME_LABEL[t];

    const instRow=buildInstRow(t, rows, hasSat, DAYS, HAS_NUM, LANE_COUNT, SAT_TIME_LABEL);
    tbody.appendChild(instRow);

    for(let ri=0;ri<rows;ri++){
      const stuRow=buildStuRow(t, ri, rows, hasSat, {
        DAYS, HAS_NUM, LANE_COUNT, DATE_HDR,
        classDatesCache: _classDatesCache,
        namePrefix: _namePrefix,
        todayStr
      });
      tbody.appendChild(stuRow);
    }
  });
  tbl.appendChild(tbody);
  wrap.replaceChildren(tbl);

  // 팝업 열려있으면 활성 셀 하이라이트 복원
  if(_stuPopup.key&&document.getElementById('stu-popup').classList.contains('show')){
    const [st,sd,sl,sr]=_stuPopup.key.split('/');
    document.querySelectorAll('.stu-clickable').forEach(td=>{
      if(td.dataset.t===st&&td.dataset.day===sd&&td.dataset.lane===sl&&td.dataset.ri===sr){
        td.classList.add('stu-active');
        _stuPopup.td=td;
      }
    });
  }

  // 후처리: 스크롤 복원, 프록시, 오늘 컬럼 프레임, 플래시
  const savedScroll=_tblOuter?_tblOuter.scrollLeft:0;
  updateProxyPosition();
  drawTodayColFrame();
  if(_tblOuter&&savedScroll){
    _tblOuter.scrollLeft=savedScroll;
    _proxy.scrollLeft=savedScroll;
  }
  if(_flashKey){
    const fk=_flashKey;_flashKey=null;
    requestAnimationFrame(()=>{
      const [ft,fd,fl,fr]=fk.split('/');
      document.querySelectorAll('.stu-clickable').forEach(td=>{
        if(td.dataset.t===ft&&td.dataset.day===fd&&td.dataset.lane===fl&&td.dataset.ri===fr){
          td.classList.add('stu-flash');
          setTimeout(()=>td.classList.remove('stu-flash'),2000);
        }
      });
    });
  }

  // 학부모 요청 대기 카운트 업데이트
  updateParentReqCount();

  // 스냅샷 사용했다면 원복
  if(_snapshotSwapped){
    STUDENTS.length=0;
    _origStudentsCopy.forEach(s=>STUDENTS.push(s));
    Object.keys(INST_MAP).forEach(k=>delete INST_MAP[k]);
    Object.assign(INST_MAP, _origInstCopy);
    Object.keys(_stuIdx).forEach(k=>delete _stuIdx[k]);
    // 원래 _stuIdx 재구축
    STUDENTS.forEach(s=>{_stuIdx[s.t+'/'+s.d+'/'+s.l+'/'+s.r]=s;});
  }

  // [v118] 타임머신 모드: 화면용으로 sync한 메모리를 원본으로 복원
  if(_tmBackup){
    STUDENTS.length=0;
    _tmBackup.stu.forEach(s=>STUDENTS.push(s));
    Object.keys(_stuIdx).forEach(k=>delete _stuIdx[k]);
    Object.assign(_stuIdx, _tmBackup.stuIdx);
    Object.keys(ENROLL_MAP).forEach(k=>delete ENROLL_MAP[k]);
    Object.assign(ENROLL_MAP, _tmBackup.enroll);
    Object.keys(RETIRE_MAP).forEach(k=>delete RETIRE_MAP[k]);
    Object.assign(RETIRE_MAP, _tmBackup.retire);
  }
}

function updateParentReqCount(){
  const btn=document.getElementById('parent-req-cnt');
  if(!btn) return;
  const pending=Object.values(REQUESTS||{}).filter(r=>!r.status||r.status==='pending').length;
  if(pending>0){
    btn.textContent=pending;
    btn.style.display='inline-block';
  } else {
    btn.style.display='none';
  }
}

/* ════════════════════════════════════════════════════════════════
 * SECTION: 하단 고정 스크롤 프록시 [v111]
 *   proxy는 tbl-outer 밖에 있는 sibling이고 항상 position:fixed.
 *   updateProxyPosition()가 display/width/left + inner width를 한 번에 갱신.
 * ════════════════════════════════════════════════════════════════ */
const _proxy=document.getElementById('scroll-proxy');
const _proxyInner=document.getElementById('scroll-proxy-inner');
const _tblOuter=document.getElementById('tab-regular');
let _proxySync=false;

function updateProxyPosition(){
  const tbl=_tblOuter.querySelector('table');
  if(!tbl){ _proxy.style.display='none'; return; }
  const needScroll = tbl.scrollWidth > _tblOuter.clientWidth;
  if(!needScroll){ _proxy.style.display='none'; return; }
  _proxyInner.style.width=tbl.scrollWidth+'px';
  const rect=_tblOuter.getBoundingClientRect();
  _proxy.style.display='block';
  _proxy.style.left=rect.left+'px';
  _proxy.style.width=rect.width+'px';
}

_proxy.addEventListener('scroll',function(){
  if(_proxySync) return;
  _proxySync=true;
  _tblOuter.scrollLeft=_proxy.scrollLeft;
  requestAnimationFrame(()=>{_proxySync=false;});
});

_tblOuter.addEventListener('scroll',function(){
  if(_proxySync) return;
  _proxySync=true;
  _proxy.scrollLeft=_tblOuter.scrollLeft;
  requestAnimationFrame(()=>{_proxySync=false;});
});

let _proxyRaf=0;
function _rafProxy(){cancelAnimationFrame(_proxyRaf);_proxyRaf=requestAnimationFrame(updateProxyPosition);}
window.addEventListener('scroll',_rafProxy,{passive:true});
window.addEventListener('resize',function(){_rafProxy();drawTodayColFrame();});

/* ════════════════════════════════════════════════════════════════
 * [v109] 오늘 날짜 column 사각형 테두리
 * tblWrap 안에 absolute-positioned overlay div를 그려 전체 column을 감쌈.
 * tblWrap이 scroll container 안에 있어서 가로/세로 스크롤 시 같이 움직임.
 * ════════════════════════════════════════════════════════════════ */
function drawTodayColFrame(){
  const tblWrap=document.getElementById('tbl');
  if(!tblWrap) return;
  // 기존 frame 제거
  tblWrap.querySelectorAll('.today-col-frame').forEach(el=>el.remove());

  const dhToday=tblWrap.querySelector('th.dh-today');
  if(!dhToday) return;
  const tbl=tblWrap.querySelector('table');
  if(!tbl) return;

  tblWrap.style.position='relative';

  const tblRect=tbl.getBoundingClientRect();
  const dhRect=dhToday.getBoundingClientRect();
  const left=dhRect.left - tblRect.left;
  const width=dhRect.width;
  const height=tbl.offsetHeight;

  const frame=document.createElement('div');
  frame.className='today-col-frame';
  frame.style.cssText='position:absolute;left:'+left+'px;top:0;width:'+width+'px;height:'+height+'px;border:3px solid #0F9D58;border-radius:4px;pointer-events:none;box-sizing:border-box;z-index:3;background:transparent';
  tblWrap.appendChild(frame);
}

let _flashKey=null;

/* ════════════════════════════════════════════════════════════════
 * 엑셀 저장 (SheetJS)
 * ════════════════════════════════════════════════════════════════ */
function exportExcel(){
  if(typeof XLSX==='undefined'){toast('엑셀 라이브러리 로드 실패','err');return;}

  const DAYS=getDays(),TIMES=getTimes(),LANE_COUNT=getLanes(),HAS_NUM=getHasNum();
  const DATE_HDR=getDateHeaders();
  const SAT_TIME_LABEL=getSatLabel();
  const wb=XLSX.utils.book_new();
  const data=[];

  // 1행: 요일 헤더
  const hdr1=[];
  DAYS.forEach(day=>{
    hdr1.push(DATE_HDR[day].label||day);
    for(let i=1;i<LANE_COUNT;i++) hdr1.push('');
  });
  data.push([''].concat(hdr1));

  // 2행: 레인 헤더
  const hdr2=[];
  DAYS.forEach(()=>{
    for(let l=1;l<=LANE_COUNT;l++) hdr2.push(l+'레인');
  });
  data.push([''].concat(hdr2));

  // 데이터 행
  TIMES.forEach(({t})=>{
    const rows=getTimeRows(t);
    const satLabel=SAT_TIME_LABEL[t];

    // 담임 행
    const instRow=[t+' 담임'];
    DAYS.forEach(day=>{
      const isSat=day==='토';
      for(let l=1;l<=LANE_COUNT;l++){
        if(isSat&&!satLabel){instRow.push('');continue;}
        const inst=getInst(t,day,l);
        instRow.push(inst?inst.n:'');
      }
    });
    data.push(instRow);

    // 학생 행
    for(let ri=0;ri<rows;ri++){
      const stuRow=[t+' '+(ri+1)+'번'];
      DAYS.forEach(day=>{
        const isSat=day==='토';
        for(let l=1;l<=LANE_COUNT;l++){
          if(isSat&&!satLabel){stuRow.push('');continue;}
          const _l=l,_r=ri+1;
          const stu=getStu(t,day,_l,_r);
          if(!stu){stuRow.push('');continue;}
          let txt=stu.n+(stu.a||'');
          // 이벤트 정보 추가
          const slotKey=t+'/'+day+'/'+_l+'/'+_r;
          const ret=RETIRE_MAP[slotKey];
          if(ret) txt+=' [퇴'+ret.ds.slice(5).replace('-','/')+']';
          const enr=ENROLL_MAP[slotKey];
          if(enr) txt+=' [등'+(enr.name||'')+' '+enr.ds.slice(5).replace('-','/')+']';
          const hyu=HYUWON_MAP[slotKey];
          if(hyu) txt+=' [휴원]';
          if(stu.v||_tableLocUsesVehicle(stu.loc)) txt+=' 🚐';
          if(stu.isNew) txt+=' (신규)';
          if(stu.reenroll) txt+=' (재등록)';
          stuRow.push(txt);
        }
      });
      data.push(stuRow);
    }
  });

  const ws=XLSX.utils.aoa_to_sheet(data);

  // 열 너비 설정
  const colWidths=[{wch:10}];
  for(let i=0;i<DAYS.length*LANE_COUNT;i++) colWidths.push({wch:14});
  ws['!cols']=colWidths;

  // 요일별 셀 병합 (1행)
  const merges=[];
  let col=1;
  DAYS.forEach(()=>{
    if(LANE_COUNT>1) merges.push({s:{r:0,c:col},e:{r:0,c:col+LANE_COUNT-1}});
    col+=LANE_COUNT;
  });
  ws['!merges']=merges;

  const today=getToday();
  const ds=today.getFullYear()+String(today.getMonth()+1).padStart(2,'0')+String(today.getDate()).padStart(2,'0');
  const tabName=getTabConfig().name||'시간표';
  XLSX.utils.book_append_sheet(wb,ws,tabName);
  XLSX.writeFile(wb,'가경수영장_'+tabName+'_'+ds+'.xlsx');
  toast('엑셀 저장 완료','ok');
}



// 출석 체크 모달 이벤트 (DOM 준비 후)
document.addEventListener("DOMContentLoaded",function(){
  const mp=document.getElementById("att-modal-present");
  const ma=document.getElementById("att-modal-absent");
  const mc=document.getElementById("att-modal-cancel");
  const mx=document.getElementById("att-modal-close");
  const md=document.getElementById("att-cell-modal");
  if(mp) mp.addEventListener("click",()=>_setAttModal("present"));
  if(ma) ma.addEventListener("click",()=>_setAttModal("absent"));
  if(mc) mc.addEventListener("click",()=>_setAttModal(null));
  if(mx) mx.addEventListener("click",_closeAttModal);
  if(md) md.addEventListener("click",function(e){if(e.target===md)_closeAttModal();});
  const mdel=document.getElementById("att-modal-delete");
  if(mdel) mdel.addEventListener("click",_deleteFromAttModal);

  // 편집 모달
  const es=document.getElementById("att-edit-save");
  const ec=document.getElementById("att-edit-cancel");
  const ed=document.getElementById("att-edit-delete");
  const em=document.getElementById("att-edit-modal");
  const en=document.getElementById("att-edit-name");
  if(es) es.addEventListener("click",_saveEditModal);
  if(ec) ec.addEventListener("click",_closeEditModal);
  if(ed) ed.addEventListener("click",_deleteEditModal);
  if(em) em.addEventListener("click",function(e){if(e.target===em)_closeEditModal();});
  if(en) en.addEventListener("keydown",function(e){
    if(e.key==="Enter"){e.preventDefault();_saveEditModal();}
  });

  // 원생 추가 모달
  const ap=document.getElementById("att-add-present");
  const aa=document.getElementById("att-add-absent");
  const ab=document.getElementById("att-add-bogang");
  const as=document.getElementById("att-add-sample");
  const ah=document.getElementById("att-add-hyuwon");
  const ax=document.getElementById("att-add-cancel");
  const am=document.getElementById("att-add-modal");
  if(ap) ap.addEventListener("click",()=>_saveAttAdd("present"));
  if(aa) aa.addEventListener("click",()=>_saveAttAdd("absent"));
  if(ab) ab.addEventListener("click",()=>_saveAttAdd("bogang"));
  if(as) as.addEventListener("click",()=>_saveAttAdd("sample"));
  if(ah) ah.addEventListener("click",()=>_saveAttAdd("hyuwon"));
  if(ax) ax.addEventListener("click",_closeAttAddModal);
  if(am) am.addEventListener("click",function(e){if(e.target===am)_closeAttAddModal();});
});
