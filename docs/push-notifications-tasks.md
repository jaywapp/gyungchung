# 푸시 알림 서버 작업

| 작업 | owner | model | effort | depends_on | parallel_group | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| 저장 계약·인증 조사 | 서버 담당 | inherited | high | 없음 | research | 완료 |
| RPC·바인딩·payload 협의 | 서버/모바일/root | inherited | high | 조사 | contract | 완료 |
| CLI migration·설정·outbox·권한 | 서버 담당 | inherited | high | 계약 | server | 완료 |
| 비활성 worker·receipt 처리 | 서버 담당 | inherited | high | 계약 | server | 완료 |
| 실제 격리 PostgreSQL/worker 회귀 | 서버 담당 | inherited | high | 구현 | verify | 완료 |
| lint·전체 test·production build | 서버 담당 | inherited | high | 구현 | verify | 완료 |
| 운영 DB·함수·시크릿 적용, 발송 OFF | root | inherited | high | 검증·사용자 승인 | rollout | 완료 |
| 제한 대상·Cron/Vault·실제 Android 수신 | root/사용자 | inherited | high | 대상 지정·제한 발송 승인 | delivery | 대기 |
| Android 피드백 완료 후 iOS APNs·수신 | 모바일/사용자 | inherited | high | Android 실제 확인·완료 | ios | 대기 |

검증 결과: lint·worker strict TypeScript·production build 통과, 전체 Node 테스트 159개 통과, 실제 격리 PostgreSQL 97개 assertion 통과. fixture 버전은 PostgreSQL 18.3/PGlite 0.5.8이다. 운영 PostgreSQL 17.6 migration 적용과 권한/default-OFF catalog 확인도 완료했다. 실제 기기 수신은 아직 확인하지 않았다.

운영 전 보강: 인증 예약과 익명 무저장, proof 탈취·예약 응답 유실·늦은 등록 방어, 회원별 quota·만료·완료 정리 검증 완료.

2026-10-01 사용자 승인으로 `20261001114159_push_notifications.sql`을 운영에 적용하고 `push-worker` version 1을 배포했다. worker 환경 OFF와 DB runtime false / allowlist 0 / project NULL을 유지한다. HTTP GET 405, 인증 없음·오류 POST 401, 올바른 인증 POST 503 `delivery_disabled` 확인. 알림 Cron job 0개이며 실제 발송은 수행하지 않았다. 자세한 결과와 다음 조건은 [worker 운영 문서](../supabase/functions/push-worker/README.md)를 따른다.
