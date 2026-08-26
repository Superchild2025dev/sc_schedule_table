"use strict";

function tabRank(tab,index){
  const month=String(tab&&tab.periodMonth||'');
  const match=String(tab&&tab.id||'').match(/_(\d{10,})$/);
  return `${month}|${String(match?Number(match[1]):index).padStart(16,'0')}`;
}

function regularTab(mainSetting,tabs){
  const list=(Array.isArray(tabs)?tabs:[])
    .filter(tab=>tab&&tab.type!=='snapshot'&&tab.type!=='bangteuk')
    .map((tab,index)=>({tab,index}));
  const mainId=String(mainSetting&&mainSetting.tabId||'');
  const selected=list.find(item=>String(item.tab.id||'regular')===mainId);
  if(selected) return selected.tab;
  list.sort((a,b)=>tabRank(b.tab,b.index).localeCompare(tabRank(a.tab,a.index)));
  return list[0]&&list[0].tab||{id:'regular',name:'정규시간표',type:'regular'};
}

function publicAvailabilityKeys(mainSetting,tabs){
  const tab=regularTab(mainSetting,tabs);
  const id=String(tab.id||'regular');
  return {
    tabId:id,
    tabName:String(tab.name||''),
    stuKey:String(tab.stuKey||(id==='regular'?'swim_students':`swim_stu_${id}`)),
    instKey:String(tab.instKey||(id==='regular'?'swim_inst':`swim_inst_${id}`)),
  };
}

module.exports={publicAvailabilityKeys};
