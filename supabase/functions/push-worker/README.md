# 푸시 worker 운영

[서버 RPC·payload·보호·검증 계약](../../../docs/push-notifications-contract.md)을 따른다.

이 함수만 `verify_jwt=false`로 배포한다. 함수는 서버 전용 Bearer 또는 호환 `x-push-worker-secret`을 자체 검증하므로 사용자 JWT/publishable key만으로 발송을 요청할 수 없다. `PUSH_DELIVERY_ENABLED`와 DB `notification_runtime.enabled`는 기본 false다. 기본 test 모드는 테스트 auth UUID allowlist와 Expo project UUID를 검사한다. production 모드는 전환 시각을 설정하고 allowlist 없이 현재 회원·기기·동의·수신 범위 정책을 검사한다.

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

## 2026-10-02 정상 운영 전환

실제 Android 두 기기가 master ON이며 공지는 한 기기 ON, 다른 기기 OFF 상태로 검증한다. 별도 Expo 직접 테스트 두 건은 ticket·receipt·사용자 표시 확인을 완료했지만 업무 worker 경로 수신 확인은 별도다. 신규 운영 모드/예약 migration을 적용하고 Vault 인증·매분 dispatch·5분 receipts를 연결한다. 설치 중에는 DB/환경 OFF와 신규 Cron 비활성을 유지한다. 실제 HTTP 상태와 운영 설정 확인 후 활성화하며 결과는 이 문서에 추가한다.

검증: 전체 Node 테스트 159개, 격리 PostgreSQL assertion 119개와 lint/production build 통과. 스케줄러 검증은 HTTP/Vault/cron stub이며 실제 확장 설치·ACL·HTTP는 운영에서 별도 확인한다. 전환 전에 쌓인 알림과 이전 예정 안내는 발송하지 않는다.

### 현재 운영 확인 — 2026-10-02 08:31(KST)

- production 모드, 전환 시각 08:31:02, DB enabled=true, worker 환경 ON, 테스트 allowlist 0명으로 정상 운영을 활성화했다. 개인 동의와 회원/프로젝트/수신 범위/바인딩 검증은 유지한다.
- ledger 20261001231341(push_production_rollout), 20261001231617(push_worker_schedules), 20261001232748(push_worker_private_http)를 적용했다. MCP가 생성한 실제 적용 버전에 로컬 파일명을 맞췄으며 운영 history의 수동 수정은 자동 승인 검토 거절 후 수행하지 않았다.
- pg_net 0.20.4의 객체는 supabase_admin 소유여서 postgres REVOKE는 실제 차단되지 않았다. 운영 catalog가 이 점을 발견했고 큐에는 시크릿을 넣지 않았다. 추가 사용자 허용 후 공식 http 1.6의 동기 호출로 교체했다. 현재 요청 큐는 0건이다.
- worker v2 ACTIVE, verify_jwt=false + 자체 서버 시크릿 검증. 올바른 Bearer의 OFF 응답503, 환경 ON/DB OFF 응답200 processed0, DB 정상 운영 ON 이후 helper dispatch200/receipts200 확인.
- private.notification_worker_runs 및 sequence, 관리자 helper는 anon/authenticated/service_role 모두 접근 불가를 운영에서 확인했다. HTTP metadata만14일 보관하며 디버그 헤더 로그는 fail closed한다.
- 비밀이 아닌 공개 marker로 실제 cross-host redirect를 확인했고, HTTP200·목적지 echo·Authorization 미전달을 확인했다. 실 시크릿이나 회원 정보는 이 검사에 사용하지 않았다.
- 전체 Node160, core PostgreSQL119, 최종 private HTTP SQL201 assertion 통과. 최종 SQL 검사의 HTTP/cron은 stub이며 실제 호출200/ACL catalog를 별도 확인했다.
- dispatch 매분/receipts5분 Cron2개 active, postgres 소유. 기존 주간 Cron은 유지했다. 실제 업무 알림의 phone표시/공지ON-OFF별수신/탭 이동은 대기다.

### 실제 신규 공지 — 2026-10-02 08:36(KST)

08:35:57 실제 공지 outbox를08:36 자연 dispatch가 처리했다. 공지ON 기기1대 ticket접수·오류없음과 사용자 휴대전화 표시 확인, 공지OFF 계정 delivery0건 확인. 자연 receipts Cron도08:35 succeeded/HTTP200이며 해당 ticket은15분 대기 후 정상 cadence에서 확인한다. 이번 정확한 원본 탭 이동과 OFF 기기의 직접 미표시는 별도 확인 대기다.
