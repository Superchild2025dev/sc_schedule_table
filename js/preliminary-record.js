(function(root){
  'use strict';

  const TEMPLATE_PATH='assets/templates/preliminary-record-template.xlsx';
  const SATURDAY_TEMPLATE_PATH='assets/templates/preliminary-record-saturday-template.xlsx';
  const YONGAM_SATURDAY_TEMPLATE_PATH='assets/templates/preliminary-record-saturday-yongam-template.xlsx';
  const MAIN_XML_NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const OFFICE_REL_NS='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const XML_NS='http://www.w3.org/XML/1998/namespace';
  const TEMPLATE_LAYOUT={
    '2시':[
      {teacher:'B2',nameCol:'C',lastCol:'I',start:2,end:7},
      {teacher:'B8',nameCol:'C',lastCol:'I',start:8,end:13},
    ],
    '3시':[
      {teacher:'B15',nameCol:'C',lastCol:'I',start:15,end:20},
      {teacher:'B21',nameCol:'C',lastCol:'I',start:21,end:26},
      {teacher:'B27',nameCol:'C',lastCol:'I',start:27,end:32},
    ],
    '4시':[
      {teacher:'B34',nameCol:'C',lastCol:'I',start:34,end:39},
      {teacher:'B40',nameCol:'C',lastCol:'I',start:40,end:45},
      {teacher:'B46',nameCol:'C',lastCol:'I',start:46,end:51},
      {teacher:'B52',nameCol:'C',lastCol:'I',start:52,end:57},
      {teacher:'B58',nameCol:'C',lastCol:'I',start:58,end:63},
    ],
    '5시':[
      {teacher:'L2',nameCol:'M',lastCol:'S',start:2,end:7},
      {teacher:'L8',nameCol:'M',lastCol:'S',start:8,end:13},
      {teacher:'L14',nameCol:'M',lastCol:'S',start:14,end:19},
      {teacher:'L20',nameCol:'M',lastCol:'S',start:20,end:25},
      {teacher:'L26',nameCol:'M',lastCol:'S',start:26,end:31},
    ],
    '6시':[
      {teacher:'L33',nameCol:'M',lastCol:'S',start:33,end:38},
      {teacher:'L39',nameCol:'M',lastCol:'S',start:39,end:44},
      {teacher:'L45',nameCol:'M',lastCol:'S',start:45,end:50},
      {teacher:'L51',nameCol:'M',lastCol:'S',start:51,end:68,large:true},
    ],
    '7시':[
      {teacher:'V2',nameCol:'W',lastCol:'AC',start:2,end:7},
      {teacher:'V8',nameCol:'W',lastCol:'AC',start:8,end:13},
      {teacher:'V14',nameCol:'W',lastCol:'AC',start:14,end:19},
      {teacher:'V20',nameCol:'W',lastCol:'AC',start:20,end:25},
      {teacher:'V26',nameCol:'W',lastCol:'AC',start:26,end:31},
    ],
    '8시':[
      {teacher:'V33',nameCol:'W',lastCol:'AC',start:33,end:38},
      {teacher:'V39',nameCol:'W',lastCol:'AC',start:39,end:44},
      {teacher:'V45',nameCol:'W',lastCol:'AC',start:45,end:50},
      {teacher:'V51',nameCol:'W',lastCol:'AC',start:51,end:68,large:true},
    ],
  };
  const SATURDAY_LAYOUT={
    '9시':[...TEMPLATE_LAYOUT['2시'],...TEMPLATE_LAYOUT['3시']],
    '10시':TEMPLATE_LAYOUT['4시'],
    '11시':TEMPLATE_LAYOUT['5시'],
    '12시':[
      {teacher:'L33',nameCol:'M',lastCol:'S',start:33,end:38},
      {teacher:'L39',nameCol:'M',lastCol:'S',start:39,end:44},
      {teacher:'L45',nameCol:'M',lastCol:'S',start:45,end:50},
      {teacher:'L51',nameCol:'M',lastCol:'S',start:51,end:56},
      {teacher:'L57',nameCol:'M',lastCol:'S',start:57,end:62},
      {teacher:'L63',nameCol:'M',lastCol:'S',start:63,end:68},
    ],
    '1시':TEMPLATE_LAYOUT['7시'],
    '2시':[
      {teacher:'V33',nameCol:'W',lastCol:'AC',start:33,end:38},
      {teacher:'V39',nameCol:'W',lastCol:'AC',start:39,end:44},
      {teacher:'V45',nameCol:'W',lastCol:'AC',start:45,end:50},
      {teacher:'V51',nameCol:'W',lastCol:'AC',start:51,end:56},
      {teacher:'V57',nameCol:'W',lastCol:'AC',start:57,end:62},
      {teacher:'V63',nameCol:'W',lastCol:'AC',start:63,end:68},
    ],
  };
  const YONGAM_SATURDAY_LAYOUT={
    ...SATURDAY_LAYOUT,
    '12시':TEMPLATE_LAYOUT['6시'],
  };
  const SATURDAY_SOURCE_TIMES={
    '9시':'1시',
    '10시':'2시',
    '11시':'3시',
    '12시':'4시',
    '1시':'5시',
    '2시':'6시',
  };

  function selectDisplayedOccupant(items){
    const list=Array.isArray(items)?items.filter(Boolean):[];
    return list.find(item=>item.type==='bogang'||item.type==='sample')
      ||list.find(item=>item.type==='regular'||item.type==='enroll')
      ||null;
  }

  function normalBlockValues(names){
    const values=Array.isArray(names)
      ?names.filter(value=>String(value||'').trim()).slice(0,5)
      :[];
    while(values.length<5) values.push('');
    values.push('');
    return values.map(value=>String(value||''));
  }

  function largeBlockValues(names){
    const values=Array.isArray(names)
      ?names.filter(value=>String(value||'').trim()).slice(0,18)
      :[];
    while(values.length<18) values.push('');
    return values.map(value=>String(value||''));
  }

  function participantRow(name){
    return {name:String(name||''),grade:'',event1:'',record1:'',event2:'',record2:'',division:''};
  }

  function isScheduleDataReady(students,inst){
    return Array.isArray(students)&&!!inst&&typeof inst==='object';
  }

  function isLargeClass(inst){
    if(!inst) return false;
    try{return !!(typeof getInstCls==='function'&&getInstCls(inst));}catch(e){return !!inst.elma;}
  }

  function sameLargeClass(left,right){
    if(!isLargeClass(left)||!isLargeClass(right)) return false;
    let leftCls='',rightCls='';
    try{
      leftCls=typeof getInstCls==='function'?getInstCls(left):(left.cls||'elma');
      rightCls=typeof getInstCls==='function'?getInstCls(right):(right.cls||'elma');
    }catch(e){}
    return String(left.n||'')===String(right.n||'')&&leftCls===rightCls;
  }

  function groupsForTime(time,day){
    const laneCount=typeof getLanes==='function'?getLanes():5;
    const groups=[];
    let lane=1;
    while(lane<=laneCount){
      const inst=typeof getInst==='function'?getInst(time,day,lane):null;
      if(!inst||!String(inst.n||'').trim()){
        lane++;
        continue;
      }
      const next=lane<laneCount&&typeof getInst==='function'?getInst(time,day,lane+1):null;
      if(sameLargeClass(inst,next)){
        groups.push({teacher:String(inst.n||''),large:true,lanes:[lane,lane+1]});
        lane+=2;
      }else{
        groups.push({teacher:String(inst.n||''),large:isLargeClass(inst),lanes:[lane]});
        lane++;
      }
    }
    return groups.sort((left,right)=>(left.lanes[0]||0)-(right.lanes[0]||0));
  }

  function formatParticipantLabel(item){
    if(!item) return '';
    const name=String(item.n||'')
      .replace(/^[*＊]+\s*/,'')
      .replace(/\s*\(보강\)\s*$/,'')
      .trim();
    const ageMatch=String(item.a??'').match(/\d+/);
    const age=ageMatch?ageMatch[0]:'';
    const nameWithAge=age&&!name.endsWith(age)?`${name}${age}`:name;
    const prefix=item.btWeek5?'*':'';
    const suffix=item.type==='bogang'?'(보강)':'';
    return `${prefix}${nameWithAge}${suffix}`;
  }

  function slotName(time,day,lane,row,ds,closed){
    if(typeof _printCellItems!=='function') return '';
    const item=selectDisplayedOccupant(_printCellItems(time,day,lane,row,ds,closed));
    if(!item) return '';
    return formatParticipantLabel(item);
  }

  function seatCoordinatesForGroup(group){
    const lanes=Array.isArray(group?.lanes)?group.lanes:[];
    if(group?.large){
      const seats=[];
      for(let row=1;row<=8;row++) lanes.forEach(lane=>seats.push({lane,row}));
      return seats;
    }
    return Array.from({length:5},(_,index)=>({lane:lanes[0],row:index+1}));
  }

  function namesForGroup(group,time,day,ds,closed){
    const names=seatCoordinatesForGroup(group)
      .map(seat=>slotName(time,day,seat.lane,seat.row,ds,closed));
    return group.large?largeBlockValues(names):normalBlockValues(names);
  }

  function sourceTimeForDay(displayTime,day){
    if(day!=='토') return displayTime;
    if(SATURDAY_SOURCE_TIMES[displayTime]) return SATURDAY_SOURCE_TIMES[displayTime];
    try{
      if(typeof SCScheduleTime!=='undefined'&&typeof SCScheduleTime.internalTimeForDay==='function'){
        return SCScheduleTime.internalTimeForDay(day,displayTime);
      }
    }catch(e){}
    return SATURDAY_SOURCE_TIMES[displayTime]||displayTime;
  }

  function branchId(value){
    return String(typeof value==='string'?value:(value?.id||'')).trim().toLowerCase();
  }

  function saturdayLayoutForBranch(branch){
    return branchId(branch)==='yongam'?YONGAM_SATURDAY_LAYOUT:SATURDAY_LAYOUT;
  }

  function saturdayTemplateForBranch(branch){
    return branchId(branch)==='yongam'?YONGAM_SATURDAY_TEMPLATE_PATH:SATURDAY_TEMPLATE_PATH;
  }

  function decodeColumn(column){
    return String(column||'').toUpperCase().split('').reduce((total,char)=>total*26+char.charCodeAt(0)-64,0)-1;
  }

  function encodeColumn(index){
    let value=Number(index)+1;
    let result='';
    while(value>0){
      const remainder=(value-1)%26;
      result=String.fromCharCode(65+remainder)+result;
      value=Math.floor((value-1)/26);
    }
    return result;
  }

  function setValue(values,address,value){
    values[address]=String(value||'');
  }

  function clearBlock(values,block){
    setValue(values,block.teacher,'');
    const startCol=decodeColumn(block.nameCol);
    const endCol=decodeColumn(block.lastCol);
    for(let row=block.start;row<=block.end;row++){
      for(let col=startCol;col<=endCol;col++) setValue(values,`${encodeColumn(col)}${row}`,'');
    }
  }

  function writeBlock(values,block,group,time,day,ds,closed){
    setValue(values,block.teacher,group.teacher);
    const names=namesForGroup(group,time,day,ds,closed);
    for(let row=block.start;row<=block.end;row++){
      const item=participantRow(names[row-block.start]||'');
      const fields=[item.name,item.grade,item.event1,item.record1,item.event2,item.record2,item.division];
      const startCol=decodeColumn(block.nameCol);
      fields.forEach((value,index)=>setValue(values,`${encodeColumn(startCol+index)}${row}`,value));
    }
  }

  function writeTime(values,displayTime,day,ds,closed,layout){
    const activeLayout=layout||TEMPLATE_LAYOUT;
    const blocks=activeLayout[displayTime]||[];
    const sourceTime=sourceTimeForDay(displayTime,day);
    blocks.forEach(block=>clearBlock(values,block));
    const groups=groupsForTime(sourceTime,day);
    const normalGroups=groups.filter(group=>!group.large);
    const largeGroups=groups.filter(group=>group.large);
    const normalBlocks=blocks.filter(block=>!block.large);
    const largeBlocks=blocks.filter(block=>block.large);
    if(normalGroups.length>normalBlocks.length){
      throw new Error(`${displayTime} 일반반이 기록지 양식의 반 수보다 많습니다`);
    }
    if(largeGroups.length>largeBlocks.length){
      throw new Error(`${displayTime} 엘리트/마스터반이 기록지 양식의 큰 칸보다 많습니다`);
    }
    normalGroups.forEach((group,index)=>writeBlock(values,normalBlocks[index],group,sourceTime,day,ds,closed));
    largeGroups.forEach((group,index)=>writeBlock(values,largeBlocks[index],group,sourceTime,day,ds,closed));
  }

  function parseXml(xml,label){
    const doc=new DOMParser().parseFromString(xml,'application/xml');
    if(doc.getElementsByTagName('parsererror').length) throw new Error(`${label} 구조를 읽지 못했습니다`);
    return doc;
  }

  function ensureXmlDeclaration(xml){
    const declaration='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    const text=String(xml||'').replace(/^\uFEFF/, '');
    return text.startsWith('<?xml')?text:declaration+text;
  }

  function serializeXml(doc){
    return ensureXmlDeclaration(new XMLSerializer().serializeToString(doc));
  }

  function childElementsByName(element,name){
    return Array.from(element.childNodes||[]).filter(node=>node.nodeType===1&&node.localName===name);
  }

  function setXmlCellText(sheetDoc,address,value){
    const cell=Array.from(sheetDoc.getElementsByTagNameNS(MAIN_XML_NS,'c')).find(item=>item.getAttribute('r')===address);
    if(!cell) throw new Error(`예선 기록지 양식에서 ${address} 셀을 찾지 못했습니다`);
    ['f','v','is'].forEach(name=>childElementsByName(cell,name).forEach(node=>cell.removeChild(node)));
    const text=String(value||'');
    if(!text){
      cell.removeAttribute('t');
      return;
    }
    cell.setAttribute('t','inlineStr');
    const inline=sheetDoc.createElementNS(MAIN_XML_NS,'is');
    const textNode=sheetDoc.createElementNS(MAIN_XML_NS,'t');
    if(/^\s|\s$|[\r\n\t]/.test(text)) textNode.setAttributeNS(XML_NS,'xml:space','preserve');
    textNode.textContent=text;
    inline.appendChild(textNode);
    cell.appendChild(inline);
  }

  function normalizeZipPath(base,target){
    const normalizedTarget=String(target||'').replace(/\\/g,'/');
    const source=normalizedTarget.startsWith('/')?normalizedTarget:`${base}/${normalizedTarget}`;
    const parts=source.split('/');
    const normalized=[];
    parts.forEach(part=>{
      if(!part||part==='.') return;
      if(part==='..') normalized.pop();
      else normalized.push(part);
    });
    return normalized.join('/');
  }

  function normalizeWorksheetRowHeights(sheetDoc,startRow,endRow,height){
    const first=Number(startRow);
    const last=Number(endRow);
    const fixedHeight=String(height);
    Array.from(sheetDoc.getElementsByTagNameNS(MAIN_XML_NS,'row')).forEach(row=>{
      const rowNumber=Number(row.getAttribute('r'));
      if(rowNumber<first||rowNumber>last) return;
      row.setAttribute('ht',fixedHeight);
      row.setAttribute('customHeight','1');
    });
  }

  function prepareWorksheetForExport(sheetDoc,values){
    Object.keys(values||{}).forEach(address=>setXmlCellText(sheetDoc,address,values[address]));
    normalizeWorksheetRowHeights(sheetDoc,1,70,20);
  }

  async function patchTemplateArchive(archive,values,sheetName){
    const workbookEntry=archive.file('xl/workbook.xml');
    const relsEntry=archive.file('xl/_rels/workbook.xml.rels');
    if(!workbookEntry||!relsEntry) throw new Error('예선 기록지 통합문서 구조를 찾지 못했습니다');
    const workbookDoc=parseXml(await workbookEntry.async('string'),'예선 기록지 통합문서');
    const relsDoc=parseXml(await relsEntry.async('string'),'예선 기록지 연결 정보');
    const sheet=workbookDoc.getElementsByTagNameNS(MAIN_XML_NS,'sheet')[0];
    if(!sheet) throw new Error('예선 기록지 시트를 찾지 못했습니다');
    const relationId=sheet.getAttributeNS(OFFICE_REL_NS,'id')||sheet.getAttribute('r:id');
    const relation=Array.from(relsDoc.getElementsByTagNameNS('*','Relationship')).find(item=>item.getAttribute('Id')===relationId);
    if(!relation) throw new Error('예선 기록지 시트 연결 정보를 찾지 못했습니다');
    const worksheetPath=normalizeZipPath('xl',relation.getAttribute('Target'));
    const worksheetEntry=archive.file(worksheetPath);
    if(!worksheetEntry) throw new Error('예선 기록지 시트 파일을 찾지 못했습니다');
    const sheetDoc=parseXml(await worksheetEntry.async('string'),'예선 기록지 시트');
    prepareWorksheetForExport(sheetDoc,values);
    sheet.setAttribute('name',safeSheetName(sheetName));
    archive.file('xl/workbook.xml',serializeXml(workbookDoc));
    archive.file(worksheetPath,serializeXml(sheetDoc));
    return archive;
  }

  function safeSheetName(value){
    return String(value||'예선 기록지').replace(/[\\/?*\[\]:]/g,' ').slice(0,31)||'예선 기록지';
  }

  function safeFilePart(value){
    return String(value||'예선기록지').replace(/[\\/:*?"<>|]/g,'_').replace(/\s+/g,'_').slice(0,60)||'예선기록지';
  }

  function datedSheetName(info){
    return safeSheetName(`${info.date.getMonth()+1}월 ${info.date.getDate()}일 ${info.dow}요일`);
  }

  async function loadTemplateArchive(templatePath){
    if(typeof JSZip==='undefined') throw new Error('예선 기록지 압축 라이브러리를 불러오지 못했습니다');
    const path=templatePath||TEMPLATE_PATH;
    const url=typeof scAsset==='function'?scAsset(path):path;
    const response=await fetch(url,{cache:'no-store'});
    if(!response.ok) throw new Error('예선 기록지 양식을 불러오지 못했습니다');
    return JSZip.loadAsync(await response.arrayBuffer());
  }

  async function buildWorkbookForDate(ds){
    const students=typeof STUDENTS==='undefined'?undefined:STUDENTS;
    const inst=typeof INST_MAP==='undefined'?undefined:INST_MAP;
    if(!isScheduleDataReady(students,inst)) throw new Error('시간표 데이터를 불러온 뒤 다시 시도해주세요');
    const info=typeof _printDateInfo==='function'?_printDateInfo(ds):null;
    if(!info||!info.hasClass) throw new Error('선택한 날짜에 수업이 없습니다');
    if(info.closed) throw new Error(`선택한 날짜는 ${info.closed}입니다`);
    const saturday=info.sourceDay==='토';
    const branch=typeof getBranchInfo==='function'?getBranchInfo():null;
    const layout=saturday?saturdayLayoutForBranch(branch):TEMPLATE_LAYOUT;
    const templatePath=saturday?saturdayTemplateForBranch(branch):TEMPLATE_PATH;
    const values={};
    Object.keys(layout).forEach(time=>writeTime(values,time,info.sourceDay,ds,info.closed,layout));
    const archive=await loadTemplateArchive(templatePath);
    await patchTemplateArchive(archive,values,datedSheetName(info));
    return {archive,info};
  }

  function downloadWorkbook(blob,filename){
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url;
    link.download=filename;
    link.style.display='none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function ensureModal(){
    let modal=document.getElementById('preliminary-record-modal');
    if(modal) return modal;
    modal=document.createElement('div');
    modal.id='preliminary-record-modal';
    modal.className='tab-modal';
    modal.innerHTML=`<div class="tab-modal-box schedule-print-modal-box">
      <div class="tab-modal-title">예선 기록지 엑셀</div>
      <label class="tab-modal-label" for="preliminary-record-date">수업 날짜</label>
      <input id="preliminary-record-date" class="tab-modal-input" type="date">
      <div id="preliminary-record-note" class="schedule-print-note"></div>
      <div class="tab-modal-actions">
        <button type="button" class="tab-modal-cancel" id="preliminary-record-cancel">닫기</button>
        <button type="button" class="tab-modal-create" id="preliminary-record-submit">엑셀 내보내기</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click',event=>{if(event.target===modal) closeModal();});
    modal.querySelector('#preliminary-record-cancel').addEventListener('click',closeModal);
    modal.querySelector('#preliminary-record-submit').addEventListener('click',exportSelectedDate);
    modal.querySelector('#preliminary-record-date').addEventListener('change',updateModalNote);
    return modal;
  }

  function updateModalNote(){
    const input=document.getElementById('preliminary-record-date');
    const note=document.getElementById('preliminary-record-note');
    if(!input||!note) return;
    const info=typeof _printDateInfo==='function'?_printDateInfo(input.value):null;
    if(!info||!info.hasClass){
      note.textContent='선택한 날짜에 수업이 없습니다.';
      note.className='schedule-print-note warn';
      return;
    }
    note.textContent=`${info.label} · 결석 원생은 제외하고 이 날짜의 보강 원생으로 교체합니다.`;
    note.className='schedule-print-note'+(info.closed?' warn':'');
  }

  function openModal(){
    const modal=ensureModal();
    const input=modal.querySelector('#preliminary-record-date');
    input.value=(typeof _attendanceDate!=='undefined'&&_attendanceDate)||(typeof _printTodayStr==='function'?_printTodayStr():new Date().toISOString().slice(0,10));
    updateModalNote();
    modal.classList.add('show');
    setTimeout(()=>input.focus(),30);
  }

  function closeModal(){
    document.getElementById('preliminary-record-modal')?.classList.remove('show');
  }

  async function exportSelectedDate(){
    const input=document.getElementById('preliminary-record-date');
    const submit=document.getElementById('preliminary-record-submit');
    const ds=input?.value||'';
    if(!ds){
      if(typeof toast==='function') toast('수업 날짜를 선택해주세요','err');
      return;
    }
    if(submit) submit.disabled=true;
    try{
      const result=await buildWorkbookForDate(ds);
      const branch=typeof getBranchInfo==='function'?getBranchInfo():null;
      const branchName=branch?.name||branch?.label||branch?.id||'지점';
      const compact=ds.replace(/-/g,'');
      const blob=await result.archive.generateAsync({
        type:'blob',
        compression:'DEFLATE',
        compressionOptions:{level:6},
        mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      downloadWorkbook(blob,`슈퍼차일드_예선기록지_${safeFilePart(branchName)}_${compact}.xlsx`);
      closeModal();
      if(typeof toast==='function') toast('예선 기록지 저장 완료','ok');
    }catch(error){
      console.error('예선 기록지 저장 실패',error);
      if(typeof toast==='function') toast(error?.message||'예선 기록지 저장 실패','err');
    }finally{
      if(submit) submit.disabled=false;
    }
  }

  root.SCPreliminaryRecord={
    TEMPLATE_PATH,
    SATURDAY_TEMPLATE_PATH,
    YONGAM_SATURDAY_TEMPLATE_PATH,
    TEMPLATE_LAYOUT,
    SATURDAY_LAYOUT,
    YONGAM_SATURDAY_LAYOUT,
    selectDisplayedOccupant,
    formatParticipantLabel,
    seatCoordinatesForGroup,
    sourceTimeForDay,
    saturdayLayoutForBranch,
    saturdayTemplateForBranch,
    normalBlockValues,
    largeBlockValues,
    participantRow,
    isScheduleDataReady,
    decodeColumn,
    encodeColumn,
    ensureXmlDeclaration,
    normalizeZipPath,
    normalizeWorksheetRowHeights,
    prepareWorksheetForExport,
    patchTemplateArchive,
    buildWorkbookForDate,
    openModal,
    closeModal,
    exportSelectedDate,
  };
  root.openPreliminaryRecordModal=openModal;
  root.closePreliminaryRecordModal=closeModal;
  root.exportPreliminaryRecordDate=exportSelectedDate;
})(typeof window!=='undefined'?window:globalThis);
