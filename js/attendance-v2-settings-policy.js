(function(global){
  'use strict';

  const MODES=Object.freeze(['v1','shadow','verify','v2-read','v2']);
  const VERIFIED_STATES=new Set(['ok','verified']);

  function text(value){ return String(value==null?'':value).trim(); }
  function canView(profile){ return text(profile?.role)==='developer'; }
  function result(allowed,reason){ return {allowed:!!allowed,reason:reason||''}; }

  function evaluate(input){
    if(!canView(input?.profile)) return result(false,'개발자 계정만 출석 전환 설정을 변경할 수 있습니다.');
    const targetMode=text(input?.targetMode);
    if(!MODES.includes(targetMode)) return result(false,'알 수 없는 출석 운영 모드입니다.');
    if(targetMode==='v1') return result(true,'V1으로 복귀할 수 있습니다.');

    const generationId=text(input?.generationId);
    if(!generationId) return result(false,'검증할 V2 세대를 먼저 선택해주세요.');
    const verifiedGenerationId=text(input?.verifiedGenerationId);
    if(!verifiedGenerationId||generationId!==verifiedGenerationId){
      return result(false,'선택한 V2 세대가 최신 검증 완료 세대와 일치하지 않습니다.');
    }
    if(targetMode==='shadow'||targetMode==='verify') return result(true,'선택한 V2 세대로 수동 전환할 수 있습니다.');

    const mismatchCount=Number(input?.mismatchCount);
    const parityStatus=text(input?.parityStatus).toLowerCase();
    if(!VERIFIED_STATES.has(parityStatus)) return result(false,'V1과 V2 출석 데이터 검증이 완료되지 않았습니다.');
    if(!Number.isFinite(mismatchCount)||mismatchCount!==0) return result(false,'출석 데이터 불일치를 모두 해결해야 합니다.');
    return result(true,'검증된 V2 출석 데이터로 수동 전환할 수 있습니다.');
  }

  function nextMode(currentMode){
    const mode=text(currentMode);
    return MODES.includes(mode)?mode:'v1';
  }

  global.SCAttendanceV2SettingsPolicy=Object.freeze({
    MODES,
    canView,
    evaluate,
    nextMode,
  });
})(typeof window!=='undefined'?window:globalThis);
