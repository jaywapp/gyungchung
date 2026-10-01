# 푸시 worker 운영

[서버 RPC·payload·보호·검증 계약](../../../docs/push-notifications-contract.md)을 따른다.

이 함수만 `verify_jwt=false`로 배포한다. 함수는 `x-push-worker-secret`을 자체 검증하므로 사용자 JWT/publishable key만으로 발송을 요청할 수 없다. `PUSH_DELIVERY_ENABLED`와 DB `notification_runtime.enabled`는 기본 false다. 테스트 auth UUID allowlist와 Expo project UUID가 모두 맞아야 발송 대상을 claim한다.

## 2026-10-01 적용 결과

- 사용자 승인 범위에 따라 운영 PostgreSQL 17.6에 `20261001114159_push_notifications.sql`을 적용했다. ledger 이름은 `push_notifications`다.
- `push-worker` version 1이 ACTIVE이며 검증된 entrypoint와 shared worker를 배포했다.
- worker secret과 `PUSH_DELIVERY_ENABLED=false`를 등록했다. 값은 Git·로그에 남기지 않으며 로컬 보관본은 DPAPI로 보호했다.
- 운영 HTTP 확인: GET 405, 인증 없음/오류 POST 401, 올바른 worker 인증 POST 503 `delivery_disabled`.
- DB runtime은 enabled=false, allowlist 0명, project NULL이다. 개인 설정 기본값도 master OFF다.
- private 8개 테이블의 RLS와 anon/authenticated CRUD 차단, 자기 preferences SELECT 정책, 회원/worker RPC 권한 분리를 catalog로 확인했다. 알림 Cron job은 0개다.

## 실제 수신 테스트 전 남은 작업

테스트할 auth UUID·Android 기기를 정하고 제한 발송을 승인한 뒤 allowlist/project를 설정한다. dispatch와 receipts는 각각 예약 호출하며 Cron/pg_net/Vault는 이 OFF 배포에서 연결하지 않았다. 실제 수신·탭 이동·로그아웃 이후 차단·카테고리 OFF를 확인하기 전 운영 전체 발송으로 전환하지 않는다. iOS APNs와 실제 기기 확인도 별도 단계다.

전송 ticket을 기기 표시 완료로 보고하지 않는다. unknown 작업은 provider 수락 여부를 확인하기 전 자동 재발송하지 않는다. 토큰·증명·개인정보를 로그로 남기지 않는다. OFF 상태에서도 업무 outbox는 쌓일 수 있으므로 활성화 전 만료·보관 정책을 점검한다.
