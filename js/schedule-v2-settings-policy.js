(function(global){
  'use strict';

  const ACTIONS=Object.freeze([
    'prepare','set-shadow','set-verify','set-v2-read','set-v2','rollback','status',
  ]);
  const MUTATIONS=new Set(ACTIONS.filter(action=>action!=='status'));

  function text(value){return String(value==null?'':value).trim();}
  function count(value){
    const number=Number(value);
    return Number.isFinite(number)&&number>0?Math.floor(number):0;
  }
  function result(allowed,reason){return {allowed:!!allowed,reason:reason||''};}
  function canView(profile){return text(profile?.role)==='developer';}
  function scheduleQueueBlocked(status){
    return count(status.transitionBlockerCount)>0
      ||count(status.pendingCount)>0||count(status.inFlightCount)>0
      ||count(status.unresolvedMismatchCount)>0;
  }
  function recoveryBlocked(status){
    return count(status.recoveryPendingCount)>0||count(status.recoveryErrorCount)>0;
  }
  function revisionsMatch(status){
    const requested=Number(status.requestedRevision);
    const applied=Number(status.appliedRevision);
    return Number.isSafeInteger(requested)&&requested>=0
      &&Number.isSafeInteger(applied)&&applied>=0
      &&requested===applied;
  }
  function cutoverReady(status){
    if(text(status.generationStatus)!=='ready'||status.scheduleReady!==true||status.attendanceReady!==true){
      return result(false,'시간표와 출석 준비가 모두 완료된 Schedule V2 세대가 필요합니다.');
    }
    if(status.pointerConsistent!==true){
      return result(false,'시간표와 출석 운영 포인터가 같은 지점과 세대를 가리켜야 합니다.');
    }
    if(scheduleQueueBlocked(status)||!revisionsMatch(status)){
      return result(false,'대기 중인 동기화 또는 불일치를 먼저 해결해야 합니다.');
    }
    if(recoveryBlocked(status)){
      return result(false,'V1 복구 대기 또는 오류 작업을 먼저 해결해야 합니다.');
    }
    return result(true,'Schedule V2 운영 전환 준비가 완료되었습니다.');
  }

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
    if(action==='prepare'){
      return count(status.preparationBlockerCount)>0||(text(status.mode)==='v2'&&status.recoverySafe!==true)
        ?result(false,'대기 중인 동기화 또는 복구 작업을 먼저 해결해야 합니다.')
        :result(true,'새 Schedule V2 기준점을 준비할 수 있습니다.');
    }
    if(action==='set-v2-read'||action==='set-v2'){
      const ready=cutoverReady(status);
      if(!ready.allowed) return ready;
      if(action==='set-v2-read'&&text(status.mode)!=='verify'){
        return result(false,'검증 모드에서만 V2 읽기 운영으로 전환할 수 있습니다.');
      }
      if(action==='set-v2'&&text(status.mode)!=='v2-read'){
        return result(false,'V2 읽기 운영에서만 V2 단독 운영으로 전환할 수 있습니다.');
      }
      return result(true,action==='set-v2-read'
        ?'V2 읽기 운영으로 전환할 수 있습니다.'
        :'V2 단독 운영으로 전환할 수 있습니다.');
    }
    if(action==='rollback'){
      const ready=cutoverReady(status);
      if(!ready.allowed) return ready;
      return status.recoverySafe===true
        ?result(true,'검증된 V1 복구본으로 전환할 수 있습니다.')
        :result(false,'현재 세대는 V1 복귀에 안전한 리비전으로 검증되지 않았습니다.');
    }
    if(count(status.pendingCount)>0||count(status.inFlightCount)>0||recoveryBlocked(status)){
      return result(false,'대기 중이거나 처리 중인 Schedule V2 변경이 남아 있습니다.');
    }
    if(count(status.unresolvedMismatchCount)>0){
      return result(false,'해결되지 않은 Schedule V2 불일치가 남아 있습니다.');
    }
    if(action==='set-shadow'){
      return status.preparationStatus==='ready'&&status.preparedScheduleReady===true
        &&status.preparedAttendanceReady===true&&['v1','v2-read','v2'].includes(text(status.mode))
        ?result(true,'그림자 복사를 시작할 수 있습니다.')
        :result(false,'새 기준점 준비를 완료해야 그림자 복사를 시작할 수 있습니다.');
    }
    if(action==='set-verify'){
      return text(status.mode)==='shadow'&&text(status.generationStatus)==='ready'
        ?result(true,'Schedule V2 검증 모드로 변경할 수 있습니다.')
        :result(false,'그림자 복사 상태에서만 검증 모드로 변경할 수 있습니다.');
    }
    return result(false,'지원하지 않는 Schedule V2 작업입니다.');
  }

  function createResponseGate(){
    let nextSequence=0;
    const latestByBranch=new Map();
    const activeActionByBranch=new Map();
    const statusByBranch=new Map();
    return Object.freeze({
      begin(branchId,kind='status'){
        const branch=text(branchId);
        const sequence=++nextSequence;
        if(kind==='action'){
          activeActionByBranch.set(branch,sequence);
          latestByBranch.set(branch,sequence);
        }else if(!activeActionByBranch.has(branch)){
          latestByBranch.set(branch,sequence);
        }
        return sequence;
      },
      accept(branchId,sequence,status){
        const branch=text(branchId);
        if(latestByBranch.get(branch)!==sequence) return false;
        statusByBranch.set(branch,status&&typeof status==='object'?status:{});
        if(activeActionByBranch.get(branch)===sequence) activeActionByBranch.delete(branch);
        return true;
      },
      finish(branchId,sequence){
        const branch=text(branchId);
        if(activeActionByBranch.get(branch)===sequence) activeActionByBranch.delete(branch);
      },
      status(branchId){return statusByBranch.get(text(branchId))||{};},
    });
  }

  global.SCScheduleV2SettingsPolicy=Object.freeze({ACTIONS,canView,evaluate,createResponseGate});
})(typeof window!=='undefined'?window:globalThis);
