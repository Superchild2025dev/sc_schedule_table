# Firestore 규칙 배포 체크리스트

## 1. 사전 검증

운영 배포 없이 전체 검증만 실행합니다.

```powershell
npm.cmd run release:rules -- --dry-run
```

최근 커밋과 현재 스테이징 변경의 광범위 삭제 검사, 권한 설정 동기화, 전체 기능 테스트, Firestore 에뮬레이터 권한 테스트가 모두 통과해야 다음 단계로 갑니다.

## 2. 규칙 배포

명시적으로 운영 배포를 실행합니다.

```powershell
npm.cmd run release:rules -- --production
```

이 명령은 `firestore.rules`만 배포합니다. Functions, Firestore 데이터, 웹 파일은 변경하지 않습니다.
추적 중인 파일에 커밋되지 않은 변경이 남아 있으면 운영 배포를 거부합니다.

광범위한 삭제가 의도된 작업일 때만 커밋 전에 사유를 명시해 예외를 사용합니다.

```powershell
$env:SC_ALLOW_BROAD_ROLLBACK = "1"
$env:SC_ROLLBACK_REASON = "승인된 되돌리기 사유"
git commit -m "Approved rollback"
Remove-Item Env:SC_ALLOW_BROAD_ROLLBACK
Remove-Item Env:SC_ROLLBACK_REASON
```

## 3. 웹 반영

로컬 변경을 커밋하고 GitHub `main`에 푸시한 뒤 Lightsail에서 실행합니다.

```bash
cd /var/www/schedule
sudo git pull origin main
```

nginx 설정을 수정하지 않았다면 `systemctl reload nginx`는 필수가 아닙니다.

## 4. 강사 계정 스모크 테스트

1. 강사 계정으로 담당 지점 시간표에 로그인합니다.
2. 정규 출석 한 명을 체크합니다.
3. 저장 오류와 빨간 Firebase 연결 배너가 나타나지 않는지 확인합니다.
4. 방특 출석 한 명을 체크합니다.
5. 방특 일괄 선택도 한 번 저장합니다.
6. 다른 브라우저 또는 기기에서 두 출석 결과가 동기화됐는지 확인합니다.
7. 강사 계정으로 원생 자리 편집이 차단되는지 확인합니다.

하나라도 실패하면 추가 규칙 배포나 웹 수정을 멈추고, 브라우저 콘솔의 실제 오류 코드부터 확인합니다.
