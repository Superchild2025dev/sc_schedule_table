/* ════════════════════════════════════════════════════════════════
 * SECTION: 날짜별 등원 원생 인쇄
 * ════════════════════════════════════════════════════════════════ */
function _printTodayStr(){
  try{return toDateStr(getToday());}catch(e){return new Date().toISOString().slice(0,10);}
}

function _printParseDate(ds){
  const d=new Date(String(ds||'')+'T00:00:00');
  return Number.isNaN(d.getTime())?null:d;
}

function _printDateInfo(ds){
  const date=_printParseDate(ds);
  if(!date) return null;
  const dow=DAY_NAMES[date.getDay()]||'';
  const days=typeof getDays==='function'?getDays():[];
  const matches=days.filter(day=>{
    try{return getDayIndexes(day).includes(date.getDay());}catch(e){return false;}
  });
  if(!matches.length) return {ds,date,dow,sourceDay:'',hasClass:false,closed:''};
  const sourceDay=matches.find(day=>day===dow)||matches[0];
  const closed=typeof isClosedDateFull==='function'?isClosedDateFull(date):'';
  const m=date.getMonth()+1;
  const dd=date.getDate();
  const sourceLabel=sourceDay&&sourceDay!==dow?' · '+sourceDay+' 기준':'';
  return {
    ds,
    date,
    dow,
    sourceDay,
    hasClass:true,
    closed,
    label:m+'/'+dd+' '+dow+'요일'+sourceLabel
  };
}

function _ensureSchedulePrintModal(){
  let modal=document.getElementById('schedule-print-modal');
  if(modal) return modal;
  modal=document.createElement('div');
  modal.id='schedule-print-modal';
  modal.className='tab-modal schedule-print-modal';
  modal.innerHTML=`<div class="tab-modal-box schedule-print-modal-box">
    <div class="tab-modal-title">날짜별 시간표 인쇄</div>
    <label class="tab-modal-label" for="schedule-print-date">인쇄 날짜</label>
    <input id="schedule-print-date" class="tab-modal-input" type="date">
    <div id="schedule-print-note" class="schedule-print-note"></div>
    <div class="tab-modal-actions">
      <button type="button" class="tab-modal-cancel" id="schedule-print-cancel">닫기</button>
      <button type="button" class="tab-modal-create" id="schedule-print-submit">인쇄</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click',e=>{ if(e.target===modal) closeSchedulePrintModal(); });
  modal.querySelector('#schedule-print-cancel').addEventListener('click',closeSchedulePrintModal);
  modal.querySelector('#schedule-print-submit').addEventListener('click',printSelectedScheduleDate);
  modal.querySelector('#schedule-print-date').addEventListener('change',_updateSchedulePrintNote);
  return modal;
}

function openSchedulePrintModal(){
  const modal=_ensureSchedulePrintModal();
  const input=modal.querySelector('#schedule-print-date');
  input.value=(typeof _attendanceDate!=='undefined'&&_attendanceDate)||_printTodayStr();
  _updateSchedulePrintNote();
  modal.classList.add('show');
  setTimeout(()=>input.focus(),30);
}

function closeSchedulePrintModal(){
  const modal=document.getElementById('schedule-print-modal');
  if(modal) modal.classList.remove('show');
}

function _updateSchedulePrintNote(){
  const input=document.getElementById('schedule-print-date');
  const note=document.getElementById('schedule-print-note');
  if(!input||!note) return;
  const info=_printDateInfo(input.value);
  if(!info||!info.hasClass){
    note.textContent='선택한 날짜에 표시할 수업 요일이 없습니다.';
    note.className='schedule-print-note warn';
    return;
  }
  note.textContent=info.label+(info.closed?' · '+info.closed:'')+' / 이 날짜에 등원하는 원생만 인쇄합니다.';
  note.className='schedule-print-note'+(info.closed?' warn':'');
}

function _schedulePrintRoot(){
  let root=document.getElementById('schedule-print-root');
  if(!root){
    root=document.createElement('section');
    root.id='schedule-print-root';
    document.body.appendChild(root);
  }
  return root;
}

function _printEntryDate(entry){
  return typeof entry==='string'?entry:String(entry?.ds||'');
}

function _printNormPhone(v){
  return String(v||'').replace(/\D/g,'');
}

function _printPersonKey(item){
  return [String(item?.n||'').trim(),_printNormPhone(item?.p),String(item?.a||'')].join('|');
}

function _printEntryMatchesStudent(stu,entry){
  if(!stu||!entry) return false;
  const stuName=String(stu.n||'').trim();
  const entryName=String(entry.name||entry.n||'').trim();
  if(stuName&&entryName&&stuName!==entryName) return false;
  const sp=_printNormPhone(stu.p);
  const ep=_printNormPhone(entry.p||entry.phone);
  if(sp&&ep&&sp!==ep) return false;
  const sa=stu.a==null?'':String(stu.a);
  const ea=entry.age==null?'':String(entry.age);
  if(sa&&ea&&sa!==ea) return false;
  return !!(stuName||entryName);
}

function _printStudentFromEntry(entry){
  return {
    n:entry?.name||entry?.n||'',
    a:entry?.age||entry?.a||null,
    p:entry?.p||entry?.phone||'',
    v:entry?.v||false,
    loc:entry?.loc||'',
    memo:entry?.memo||'',
    g:entry?.g||null,
    isNew:entry?.isNew||null,
    reenroll:entry?.reenroll||null,
    enrolled:entry?.enrolled||entry?.ds||null,
    fromEnroll:true
  };
}

function _printItemFromStudent(stu,type){
  return {
    type:type||'regular',
    n:stu?.n||'',
    a:stu?.a||null,
    p:stu?.p||'',
    isNew:!!stu?.isNew,
    reenroll:!!stu?.reenroll,
    enrolled:!!stu?.enrolled,
  };
}

function _printItemFromMark(mark){
  return {
    type:mark?.type||'guest',
    n:mark?.n||'',
    a:mark?.a||null,
    p:mark?.p||'',
  };
}

function _printHyuwonOn(slotKey,ds){
  const hy=HYUWON_MAP&&HYUWON_MAP[slotKey];
  return !!(hy&&Array.isArray(hy.dates)&&hy.dates.includes(ds));
}

function _printRawStudentAt(t,sourceDay,lane,row){
  if(!Array.isArray(STUDENTS)) return null;
  const laneNum=parseInt(lane,10);
  const rowNum=parseInt(row,10);
  return STUDENTS.find(s=>
    s&&s.t===t&&s.d===sourceDay
    &&parseInt(s.l,10)===laneNum
    &&parseInt(s.r,10)===rowNum
  )||null;
}

function _printCellItems(t,sourceDay,lane,row,ds,closed){
  if(closed) return [];
  const slotKey=t+'/'+sourceDay+'/'+lane+'/'+row;
  let base=(typeof getStu==='function'?getStu(t,sourceDay,lane,row):null)||_printRawStudentAt(t,sourceDay,lane,row);
  let baseFromEnroll=false;
  const enroll=ENROLL_MAP&&ENROLL_MAP[slotKey];
  if(enroll){
    if(enroll.ds&&enroll.ds<=ds){
      base=_printStudentFromEntry(enroll);
      baseFromEnroll=true;
    } else if(base && (enroll.convertedFromStudent||_printEntryMatchesStudent(base,enroll))){
      base=null;
    }
  }
  const retire=RETIRE_MAP&&RETIRE_MAP[slotKey];
  const retDs=_printEntryDate(retire);
  if(!baseFromEnroll&&retDs&&retDs<ds) base=null;
  if(base&&_printHyuwonOn(slotKey,ds)) base=null;

  const mark=MARK_MAP&&MARK_MAP[slotKey+'/'+ds];
  const items=[];
  if(mark?.type==='absent'){
    if(mark.sub) items.push(_printItemFromMark(mark.sub));
  } else {
    if(base) items.push(_printItemFromStudent(base,base.fromEnroll?'enroll':'regular'));
    if(mark?.type==='bogang'||mark?.type==='sample') items.push(_printItemFromMark(mark));
  }

  const guestKey=t+'/'+sourceDay+'/'+lane+'/'+ds;
  (ATT_GUESTS&&ATT_GUESTS[guestKey]||[]).forEach(g=>{
    if(!g||g.slotKey!==slotKey) return;
    if(g.s==='absent'||g.s==='hyuwon'||g.type==='hyuwon') return;
    items.push({type:g.type||'guest',n:g.n||'',a:g.a||null,p:g.p||'',guest:true});
  });

  const seen=new Set();
  return items.filter(item=>{
    if(!String(item.n||'').trim()) return false;
    const key=_printPersonKey(item);
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function _printTimeLabel(t,sourceDay){
  if(sourceDay==='토'){
    const sat=typeof getSatLabel==='function'?getSatLabel():{};
    if(sat&&sat[t]) return sat[t];
  }
  try{
    if(window.SCScheduleTime&&typeof SCScheduleTime.displayTimeForDay==='function'){
      return SCScheduleTime.displayTimeForDay(sourceDay,t)||t;
    }
  }catch(e){}
  return t;
}

function _printSatHourValue(label){
  const text=String(label||'').replace(/\s/g,'');
  const m=text.match(/(\d{1,2})시/);
  if(!m) return null;
  let h=parseInt(m[1],10);
  if(!Number.isFinite(h)) return null;
  if(text.includes('오후')&&h<12) h+=12;
  else if(h>=1&&h<=2) h+=12;
  return h;
}

function _printTimesForDay(times,sourceDay){
  const list=Array.isArray(times)?times:[];
  if(sourceDay!=='토') return list.filter(({t})=>String(t||'').trim()!=='1시');
  const sat=typeof getSatLabel==='function'?getSatLabel():{};
  return list.filter(({t})=>{
    if(!sat||!sat[t]) return false;
    const hour=_printSatHourValue(sat[t]);
    return hour!==null&&hour<=14;
  });
}

function _printUseRowFromSlotKey(key,t,sourceDay,useRow){
  const p=String(key||'').split('/');
  if(p.length>=4&&p[0]===t&&p[1]===sourceDay) useRow(p[3]);
}

function _printHasElmaFrame(t,sourceDay){
  if(typeof isBangteuk==='function'&&isBangteuk()) return false;
  try{
    if(typeof getElmaLanes==='function'&&getElmaLanes(t,sourceDay)) return true;
  }catch(e){}
  const lanes=typeof getLanes==='function'?getLanes():5;
  for(let lane=1;lane<=lanes;lane++){
    const inst=typeof getInst==='function'?getInst(t,sourceDay,lane):null;
    if(typeof getInstCls==='function'&&getInstCls(inst)) return true;
    if(inst&&inst.elma) return true;
  }
  return false;
}

function _printRowsForTime(t,sourceDay,ds){
  const isBt=typeof isBangteuk==='function'&&isBangteuk();
  const baseRows=isBt?6:(_printHasElmaFrame(t,sourceDay)?8:5);
  const maxRows=isBt?6:8;
  let rows=baseRows;
  const useRow=row=>{
    const n=parseInt(row,10);
    if(Number.isFinite(n)&&n>rows) rows=n;
  };
  (Array.isArray(STUDENTS)?STUDENTS:[]).forEach(s=>{
    if(s&&s.t===t&&s.d===sourceDay) useRow(s.r);
  });
  [RETIRE_MAP,ENROLL_MAP,DISABLED_MAP,HYUWON_MAP].forEach(map=>{
    Object.keys(map||{}).forEach(key=>_printUseRowFromSlotKey(key,t,sourceDay,useRow));
  });
  Object.keys(MARK_MAP||{}).forEach(key=>{
    const p=key.split('/');
    if(p.length===5&&p[0]===t&&p[1]===sourceDay&&p[4]===ds) useRow(p[3]);
  });
  Object.keys(ATT_GUESTS||{}).forEach(key=>{
    const p=key.split('/');
    if(p.length===4&&p[0]===t&&p[1]===sourceDay&&p[3]===ds){
      (ATT_GUESTS[key]||[]).forEach(g=>{
        const sp=String(g?.slotKey||'').split('/');
        if(sp.length===4) useRow(sp[3]);
      });
    }
  });
  return Math.min(maxRows,Math.max(baseRows,rows));
}

function _printItemHtml(item){
  const cls=item.type==='bogang'?' bogang':item.type==='sample'?' sample':item.type==='enroll'?' enroll':'';
  const tag=item.type==='bogang'?'보':item.type==='sample'?'샘':item.isNew?'신':item.reenroll?'재':item.type==='enroll'?'등':'';
  return `<div class="print-student${cls}"><span>${esc((item.n||'')+(item.a||''))}</span>${tag?`<b>${tag}</b>`:''}</div>`;
}

function _printLayoutStyle(totalRows){
  const tableRows=Math.max(1,totalRows+1);
  const rowMm=Math.max(2.7,Math.min(9.1,276/tableRows));
  const fontPx=Math.max(5.9,Math.min(13.5,rowMm*2.05));
  const thFontPx=Math.max(6.2,Math.min(13,fontPx+0.4));
  const instFontPx=Math.max(5.8,Math.min(13,fontPx-0.2));
  const headFontPx=Math.max(13,Math.min(17,fontPx+2));
  const subFontPx=Math.max(9.5,Math.min(12.5,fontPx));
  const badgePx=Math.max(7,Math.min(12,fontPx*0.9));
  const padX=rowMm>=5.5?3:rowMm>=3.5?2:1;
  return [
    `--print-row-h:${rowMm.toFixed(2)}mm`,
    `--print-font:${fontPx.toFixed(1)}px`,
    `--print-th-font:${thFontPx.toFixed(1)}px`,
    `--print-inst-font:${instFontPx.toFixed(1)}px`,
    `--print-head-font:${headFontPx.toFixed(1)}px`,
    `--print-sub-font:${subFontPx.toFixed(1)}px`,
    `--print-badge:${badgePx.toFixed(1)}px`,
    `--print-pad-x:${padX}px`,
  ].join(';');
}

function _buildSchedulePrintHtml(ds){
  const info=_printDateInfo(ds);
  if(!info||!info.hasClass) throw new Error('선택한 날짜에 수업이 없습니다');
  const rawTimes=_printTimesForDay(typeof getTimes==='function'?getTimes():[],info.sourceDay);
  const lanes=typeof getLanes==='function'?getLanes():5;
  const sourceDay=info.sourceDay;
  const closed=info.closed||'';
  const countKeys=new Set();
  const times=rawTimes.map(({t})=>({t}));
  const rowCounts=times.map(({t})=>_printRowsForTime(t,sourceDay,ds));
  const totalRows=rowCounts.reduce((sum,row)=>sum+row+1,0);
  const density='';
  const layoutStyle=_printLayoutStyle(totalRows);
  const laneColWidth=`calc((100% - 56px) / ${Math.max(1,lanes)})`;
  const colgroup=`<col class="print-time-col"><col class="print-num-col">${Array.from({length:lanes},()=>`<col style="width:${laneColWidth}">`).join('')}`;

  const body=times.map(({t},idx)=>{
    const rows=rowCounts[idx];
    const timeLabel=_printTimeLabel(t,sourceDay);
    const teacherCells=Array.from({length:lanes},(_,i)=>{
      const lane=i+1;
      const inst=typeof getInst==='function'?getInst(t,sourceDay,lane):null;
      return `<td class="print-teacher ${instClass(inst)}">${instDisplay(inst)}</td>`;
    }).join('');
    const instRow=`<tr class="print-inst-row"><td class="print-time" rowspan="${rows+1}">${esc(timeLabel)}</td><td class="print-num">담임</td>${teacherCells}</tr>`;
    const stuRows=Array.from({length:rows},(_,rIdx)=>{
      const row=rIdx+1;
      const cells=Array.from({length:lanes},(_,i)=>{
        const lane=i+1;
        const items=_printCellItems(t,sourceDay,lane,row,ds,closed);
        items.forEach(item=>countKeys.add(_printPersonKey(item)));
        return `<td class="print-stu-cell">${items.map(_printItemHtml).join('')}</td>`;
      }).join('');
      return `<tr><td class="print-num">${row}</td>${cells}</tr>`;
    }).join('');
    return instRow+stuRows;
  }).join('');

  return `<div class="schedule-print-sheet${density}" style="${layoutStyle}">
    <div class="schedule-print-head">
      <span>${esc(info.label)}${closed?` · ${esc(closed)}`:''}</span>
      <em>등원 ${countKeys.size}명</em>
    </div>
    <table class="schedule-print-table">
      <colgroup>${colgroup}</colgroup>
      <thead><tr><th>시간</th><th>번</th>${Array.from({length:lanes},(_,i)=>`<th>${i+1}레인</th>`).join('')}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>`;
}

function printSelectedScheduleDate(){
  const ds=document.getElementById('schedule-print-date')?.value||_printTodayStr();
  try{
    const root=_schedulePrintRoot();
    root.innerHTML=_buildSchedulePrintHtml(ds);
    closeSchedulePrintModal();
    document.body.classList.add('printing-schedule');
    setTimeout(()=>window.print(),80);
  }catch(err){
    toast(err?.message||'인쇄 준비 실패','err');
    console.error(err);
  }
}

window.addEventListener('afterprint',()=>{
  document.body.classList.remove('printing-schedule');
});

window.openSchedulePrintModal=openSchedulePrintModal;
window.closeSchedulePrintModal=closeSchedulePrintModal;
window.printSelectedScheduleDate=printSelectedScheduleDate;
window.__SC_PRINT_LOADED=true;

function _bindSchedulePrintButton(){
  const btn=document.getElementById('schedule-print-btn');
  if(!btn||btn.dataset.printBound) return;
  btn.dataset.printBound='1';
  btn.addEventListener('click',e=>{
    e.preventDefault();
    openSchedulePrintModal();
  });
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',_bindSchedulePrintButton);
else _bindSchedulePrintButton();
