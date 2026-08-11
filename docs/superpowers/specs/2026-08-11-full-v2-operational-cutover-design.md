# 직원 운영 데이터 전체 V2 전환 설계

## 목적

가경점과 용암점의 직원용 운영 화면을 V2 개별 문서 구조로 전환한다. 시간표, 출석, 결석, 보강, 예약, 운영 설정과 기록은 V2를 운영 원본으로 사용하고, 안정화 기간에는 V1을 복구용 안전 복사본으로 유지한다.

이번 전환은 기존 화면과 업무 순서를 바꾸지 않는다. 화면 코드는 V1 또는 V2의 실제 저장 경로를 직접 다루지 않고 운영 데이터 관문을 통해서만 읽고 저장한다.

## 범위

두 지점에서 다음 직원용 데이터를 전환한다.

- 시간표 탭과 원생 기본 정보
- 정규반·방학특강 등록 정보와 자리 배치
- 담임 배치와 선생님 목록
- 등록·제외·이동·퇴원·휴원 예약
- 대기자
- 결석·보강·샘플·의무보강 표시
- 정규반·방학특강 출석과 출석부 추가 원생
- 과거 출석부 스냅샷
- 휴관일, 비활성 자리, 운영 기간과 운영월
- 탭 폴더, 박제 시간표와 메인 시간표 설정
- 퇴원 원본 기록과 데스크 하단 기록

V2의 기존 컬렉션 이름을 유지한다.

`tabs`, `people`, `enrollments`, `placements`, `teacherAssignments`, `reservations`, `waitlistEntries`, `classMarks`, `attendanceRecords`, `attendanceGuests`, `attendanceSnapshots`, `attendanceSnapshotStudents`, `attendanceSnapshotTeachers`, `disabledSlots`, `calendarClosures`, `schedulePeriods`, `scheduleSettings`, `teacherProfiles`, `tabFolders`, `archivedTabs`, `systemMetadata`, `retirementRecords`, `deskStudentRecords`

## 범위 밖

- 학부모 페이지의 인증, 조회, 결석·보강 신청 저장은 이번 전환에서 제외한다.
- 친구추천과 고객의 소리 데이터 구조는 변경하지 않는다.
- V1 문서는 안정화 기간에 삭제하지 않는다.
- 기존 UI 디자인과 업무 문구를 변경하지 않는다.

학부모 페이지는 아직 운영하지 않는다는 전제에서 V1에 유지한다. 학부모 페이지를 운영하기 전에는 별도의 V2 요청 관문과 권한 검증을 구현해야 한다.

## 접근법 비교

### V2 단독 즉시 전환

V1 쓰기를 즉시 중단한다. 구조는 단순하지만 전환 직후 발견되는 기능 누락이나 권한 오류에서 최신 데이터를 보존한 V1 복귀가 어렵다. 사용하지 않는다.

### V1 원본과 V2 그림자 유지

현재 방식이다. 안정적이지만 실제 조회와 저장 비용, 큰 문서 충돌 문제가 개선되지 않는다. 전환 완료 상태로 사용하지 않는다.

### V2 원본과 V1 안전 복사 - 선택

직원 화면은 V2에서 읽고 V2에 먼저 저장한다. 성공한 V2 변경은 V1 복구본에도 동일하게 반영한다. V1 복사가 밀리면 해당 상태를 개발자에게 알리고, 복구본이 따라잡기 전에는 V1 복귀와 완전 V2 확정을 차단한다.

## 운영 상태

지점별 운영 상태는 기존 이름을 확장하여 사용한다.

1. `v1`: V1 읽기·쓰기만 사용한다.
2. `shadow`: V1이 원본이며 V2에 복사한다.
3. `verify`: V1이 원본이며 V2 복사 완료와 내용 일치를 확인한다.
4. `v2-read`: V2가 읽기·쓰기 원본이며 V1을 복구본으로 갱신한다.
5. `v2`: V2만 읽고 쓴다. V1은 마지막 정상 복구본으로 보관한다.

두 지점은 서로 독립적인 설정과 세대를 사용한다. 다만 이번 작업의 배포 완료 기준은 가경점과 용암점 모두 `v2-read`로 전환 가능한 상태다.

## 단일 전환 포인터

한 화면에서 시간표는 V2, 기록은 V1처럼 서로 다른 원본을 섞지 않는다. 각 지점에 직원 운영 전체를 가리키는 단일 런타임 포인터를 둔다.

```text
scheduleV2/{branchId}/runtime/operational
```

포인터에는 다음 값만 저장한다.

- `branchId`
- `mode`
- `generationId`
- `epoch`: 전환이나 복귀 때 증가하는 정수
- `updatedAt`
- `updatedBy`

화면은 로그인과 지점 선택 후 포인터를 한 번 확인하고, 해당 세대와 상태를 한 세션의 기준으로 사용한다. 작업 도중 `epoch`가 바뀌면 이전 요청 결과를 버리고 화면을 다시 준비한다.

기존 `runtime/attendance` 설정은 전환 기간 동안 `runtime/operational`과 같은 모드·세대를 가리킨다. 두 설정은 서버 트랜잭션에서 함께 변경하며 서로 다르면 직원 저장을 차단한다.

## 운영 데이터 관문

기존 화면의 전역 배열과 함수는 당장 전면 재작성하지 않는다. `SCOperationalSchedule` 관문이 기존 화면이 기대하는 형태와 V2 문서 사이를 변환한다.

관문은 다음 책임만 가진다.

- 현재 지점의 런타임 포인터와 세대 확인
- 선택한 탭에 필요한 V2 문서만 조회
- V2 문서를 기존 화면용 원생·담임·뱃지·기록 형태로 조합
- 화면의 변경 전후 차이를 개별 V2 문서 변경으로 변환
- 서버 저장 완료 후 화면 메모리 갱신
- `v2-read`에서 V1 복구본 갱신 상태 확인
- 오래된 탭·지점·세대 요청 결과 폐기

UI 함수는 V2 경로, 컬렉션 이름, 세대 ID를 직접 사용하지 않는다.

## 읽기 흐름

1. 인증과 지점 선택을 완료한다.
2. `runtime/operational`을 읽는다.
3. `v2-read` 또는 `v2`면 V2를 유일한 화면 원본으로 사용한다.
4. 메인 시간표는 탭 목록, 선택한 탭의 배치·담임·표시만 우선 읽는다.
5. 출석부, 기록관리, 대기자, 설정 목록은 해당 화면을 열 때 필요한 범위만 읽는다.
6. 한 조회가 실패해도 같은 화면에서 V1 값을 섞어 채우지 않는다.

`v2-read`에서 V2 조회에 실패하면 현재 화면을 유지하고 편집을 잠근 뒤 재시도 안내를 표시한다. 개발자가 V1으로 복귀한 뒤 새로고침하면 V1을 다시 사용한다.

## 쓰기 흐름

직원 변경은 화면에서 임의의 V2 문서를 직접 덮어쓰지 않는다. 운영 관문이 변경 대상, 현재 세대, 예상 버전과 수정 내용을 서버 저장 함수에 전달한다.

서버는 다음 순서로 처리한다.

1. 인증 계정, 역할, 지점과 작업 권한을 확인한다.
2. 런타임 `epoch`와 요청 세대가 현재 값과 같은지 확인한다.
3. 영향받는 V2 문서만 트랜잭션 또는 제한된 배치로 저장한다.
4. V2 저장 결과와 복구 작업 ID를 확정한다.
5. `v2-read`이면 V1 복구본 갱신을 요청하고 완료 상태를 기록한다.
6. 동일한 작업 ID가 재요청되면 중복 적용하지 않고 기존 결과를 반환한다.

자리 이동은 원생의 `personId`와 `enrollmentId`를 유지하고 `placement`만 변경한다. 원생 교체는 기존 원생의 배치를 제거하고 새 원생의 별도 ID를 사용한다. 정규반과 방학특강은 같은 사람이어도 별도 `enrollment`와 `placement`를 유지한다.

## V1 안전 복사와 복귀

`v2-read`에서 V1은 화면 원본이 아니며 복구본이다. 각 V2 작업에는 고유 작업 ID와 복구 상태를 둔다.

- `pending`: V2 저장은 완료됐고 V1 복구본 갱신 대기
- `applied`: V1 복구본까지 동일하게 반영
- `error`: 복구본 갱신 실패

대기·오류 작업이 하나라도 있으면 다음 동작을 금지한다.

- `v1` 복귀
- `v2` 완전 전환
- V2 세대 교체 또는 삭제

복귀는 개발자 계정만 실행한다. 복구 상태가 모두 `applied`이고 V1·V2 내용 검증이 일치할 때 서버 트랜잭션으로 포인터를 `v1`로 변경하고 `epoch`를 증가시킨다. 화면은 자동으로 원본을 섞지 않고 새로고침 후 V1을 사용한다.

## 불일치와 오류 처리

- 변환 불가, 중복 문서 ID, 자리 충돌, 원생 정보 충돌이 있으면 전환을 차단한다.
- 저장 중 일부 V2 문서만 성공한 상태를 허용하지 않는다. Firestore 제한을 넘는 변경은 작은 단위로 나누고 완료 표식을 마지막에 기록한다.
- V2는 성공했지만 V1 복구가 실패한 경우 운영 결과는 V2 성공으로 유지하며 개발자에게 복구 지연을 알린다. 사용자의 재시도로 같은 변경이 중복되지 않도록 작업 ID를 사용한다.
- 같은 자리를 두 기기가 수정하면 예상 버전이 뒤처진 요청을 거절하고 최신 내용을 다시 불러오게 한다.
- 진단에는 이름, 전화번호, 메모 원문을 저장하지 않는다. 지점, 작업 종류, 문서 수, 오류 종류와 작업 ID만 기록한다.

## 권한

- 선생님은 기존과 동일하게 양 지점의 출석, 결석 확인과 보강 업무를 수행할 수 있다.
- 선생님의 시간표 원생·담임·운영 기간 편집 제한은 유지한다.
- 데스크와 관리자는 기존 화면에서 허용되던 시간표 편집을 계속 수행한다.
- 전환, 복귀, 세대 준비와 불일치 진단은 개발자 계정만 가능하다.
- 규칙은 `config/schedule-permissions.json`에서 생성되는 단일 권한 정책과 계속 일치해야 한다.
- 인증되지 않은 사용자는 모든 직원용 V1·V2 데이터에 접근할 수 없다.

## 전환 절차

1. 운영 데이터 관문과 서버 쓰기 함수를 배포하되 두 지점은 `verify`에 둔다.
2. 현재 V1 변경이 V2에 모두 반영되고 대기·처리 중·불일치가 0인지 다시 확인한다.
3. 가경점과 용암점의 새 기준 세대를 각각 고정한다.
4. 서버가 두 지점의 내용 해시와 문서 수를 재검증한다.
5. 개발자 승인으로 두 지점을 `v2-read`로 전환한다.
6. 직원용 메인, 선생님, 데스크 화면의 읽기와 저장이 V2 원본인지 확인한다.
7. V1 복구 대기·오류가 0인지 계속 감시한다.
8. 안정화 기간과 별도 승인 전에는 `v2` 단독 모드로 올리지 않는다.

## 테스트 시나리오

### 데이터 왕복

- V1 전체를 V2로 변환한 뒤 화면용 형태로 복원했을 때 원생, 자리, 담임, 뱃지, 기록과 운영 설정이 일치한다.
- 형제처럼 전화번호가 같고 이름이 다른 원생은 별도 `personId`를 유지한다.
- 같은 원생의 정규반과 방학특강 등록은 하나의 사람과 별도 등록·자리로 복원된다.
- 주 5일 표시용 별표는 이름 원문과 분리된 속성으로 유지된다.

### 주요 업무

- 원생 등록, 수정, 교체, 복사와 삭제
- 자리 이동, 반 이동, 시간 변경과 전체 이동
- 등록·제외·퇴원·휴원 예약과 날짜 변경
- 담임 추가·삭제·정렬과 방특 묶음 처리
- 결석, 결석 취소, 보강, 샘플, 의무보강
- 정규·방특 개별 출석, 일괄 출석과 추가 원생
- 대기자 추가·수정·삭제
- 하단 기록 자동 생성, 수기 추가·수정·삭제
- 탭, 운영월, 휴관일, 기간, 폴더와 박제 시간표
- 인쇄, 엑셀 내보내기와 원생 목록 집계

### 동시 작업과 복구

- 두 기기가 서로 다른 원생을 수정하면 두 변경이 모두 남는다.
- 같은 자리를 동시에 수정하면 오래된 요청이 최신 값을 덮지 않는다.
- V2 저장 실패 시 성공으로 표시하지 않는다.
- V1 복구 지연 중에는 복귀와 완전 전환이 차단된다.
- V1 복구 완료 후 `v1` 복귀와 재진입을 실제 테스트 저장소에서 검증한다.
- 가경점과 용암점 데이터가 서로 섞이지 않는다.

## 완료 기준

- 두 지점의 변환 불가, 대기, 처리 중, 불일치 건수가 모두 0이다.
- 전체 자동 테스트, Firestore 규칙 테스트와 에뮬레이터 테스트가 통과한다.
- 직원용 메인·선생님·데스크 화면의 주요 업무 시나리오가 V2 원본에서 통과한다.
- V1 복구본이 최신 V2 변경까지 따라간 상태에서 복귀 절차를 검증한다.
- 학부모 페이지와 공개 페이지의 기존 동작에는 변경이 없다.
- 운영 전환은 별도 배포와 검증을 마친 뒤 개발자 제어로 수행하며 코드 배포만으로 자동 전환하지 않는다.

## Local Task 7 Rollback Evidence (2026-08-11)

- Tested branches: `gagyeong` and `yongam`; each ran regular and bangteuk V2-read workflows.
- Mode sequence: `verify -> v2-read -> v1` for the rollback scenario. No deployment, production access, push, or mode switch was performed.
- Workflow count: 17 committed V2 operations per branch (34 total): registration, replacement, move, teacher change, retirement/enrollment/leave reservations, waitlist, all absence/makeup mark transitions, attendance/guests, snapshots, calendar, periods, tabs, and manual records.
- Concurrency evidence: each branch/course pair proved a fenced retry preserves different-document edits; stale same-slot writes returned `aborted` and did not overwrite the committed value.
- Recovery evidence: a forced V1 mirror failure left the V2 commit at revision 2, blocked rollback, then `recoverOperationalMirrors` applied one recovery and restored V1/V2 values for both changed rosters.
- Pointer parity: each committed V2 mutation advances both `runtime/operational.revision` and `runtime/attendance.revision` in the same finalization transaction.
- Rollback outcome: after recovery and parity, rollback reached `v1`; a newly constructed gateway session loaded the complete legacy staff view as V1 and matched the recovered legacy data.

## Local Task 7 Fix Round 1 Evidence (2026-08-11)

- Both runtime pointers are preflight-validated before a V2 document, manifest, or active-operation write; a mismatched attendance pointer produces zero writes.
- `gagyeong` and `yongam` each run 20 V2 operations through the production operational workflow adapter: regular and Bangteuk registration, replacement, move, teacher, reservations, waitlist, absence, bogang, sample, mandatory makeup, both cancellations, attendance/guests, two immutable snapshots, calendar, periods, tabs, manual records, and export.
- The operational gateway rebases non-overlapping stale leaf edits onto a fresh V2 read. Four branch/course different-student races retain both original requests without a third replay; four same-slot races remain `aborted` and retain the winner.
- Ordered roster, tab, waitlist, period, and export views are compared without recursive array sorting. Placement conversion persists source order and V2 reconstruction preserves it.
- For each branch, a forced Bangteuk V1 mirror failure blocks rollback at revision 2. Recovery returns `{applied:1,error:0,skipped:0}`, complete tracked V1/V2 staff views match, and a newly constructed V1 gateway session independently reconstructs the same complete view after rollback.

## Local Task 7 Fix Round 2 Evidence (2026-08-11)

- Resumed snapshot header completion validates both runtime pointers before changing snapshot completion or its manifest.
- Operational rebase awaits async mutator intent and fails closed before a retry when mode, generation, or epoch changes.
- Tab conversion stores `sourceOrder`; reconstruction restores it despite deliberately reordered collection retrieval while older rows without that field keep stable retrieval order.
- The staff page uses `SCScheduleLiveHandlers` for snapshot, V2 mark, scheduled replacement/future-state cleanup, and export preparation. The two-branch scenario drives that same production adapter through the real operational gateway.
- The round-two focused suite passed 123 tests and the full suite passed 601 of 603 tests with no failures. The remaining two tests are explicit emulator-environment skips.

