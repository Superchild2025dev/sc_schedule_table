(function(global){
  'use strict';

  const ACTIONS=Object.freeze(['prepare','set-shadow','set-verify','rollback','status']);
  const MUTATIONS=new Set(['prepare','set-shadow','set-verify','rollback']);

  function text(value){return String(value==null?'':value).trim();}
  function count(value){
    const number=Number(value);
    return Number.isFinite(number)&&number>0?Math.floor(number):0;
  }
  function result(allowed,reason){return {allowed:!!allowed,reason:reason||''};}
  function canView(profile){return text(profile?.role)==='developer';}

  function evaluate(input){
    const action=text(input?.action);
    const role=text(input?.profile?.role);
    const status=input?.status&&typeof input.status==='object'?input.status:{};
    if(!ACTIONS.includes(action)) return result(false,'지원하지 않는 Schedule V2 작업입니다.');
    if(action==='status'){
      return role==='developer'||role==='superAdmin'
        ?result(true,'Schedule V2 상태를 확인할 수 있습니다.')
        :result(false,'Schedule V2 상태를 확인할 권한이 없습니다.');
    }
    if(MUTATIONS.has(action)&&role!=='developer'){
      return result(false,'개발자 계정만 Schedule V2 설정을 변경할 수 있습니다.');
    }
    if(action==='rollback') return result(true,'V1으로 즉시 복귀할 수 있습니다.');
    if(action==='prepare') return result(true,'새 Schedule V2 기준점을 준비할 수 있습니다.');
    if(text(status.generationStatus)!=='ready'){
      return result(false,'준비가 완료된 Schedule V2 세대가 필요합니다.');
    }
    if(count(status.pendingCount)>0||count(status.inFlightCount)>0){
      return result(false,'대기 중이거나 처리 중인 Schedule V2 변경이 남아 있습니다.');
    }
    if(count(status.unresolvedMismatchCount)>0){
      return result(false,'해결되지 않은 Schedule V2 불일치가 남아 있습니다.');
    }
    if(action==='set-shadow'){
      return text(status.mode)==='ready'
        ?result(true,'그림자 복사를 시작할 수 있습니다.')
        :result(false,'새 기준점 준비를 완료한 뒤 그림자 복사를 시작할 수 있습니다.');
    }
    return result(true,'Schedule V2 검증 모드로 변경할 수 있습니다.');
  }

  global.SCScheduleV2SettingsPolicy=Object.freeze({ACTIONS,canView,evaluate});
})(typeof window!=='undefined'?window:globalThis);
