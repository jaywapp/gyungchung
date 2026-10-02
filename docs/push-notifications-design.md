# 푸시 알림 서버 설계

DB AFTER 트리거→private outbox→서버 인증 worker→Expo ticket→별도 receipt 경계를 사용한다. 기존 웹/이전 APK의 업무 저장 API를 바꾸지 않는다. 기본 runtime disabled와 테스트 UUID allowlist, Expo 프로젝트 제한을 함께 적용한다.

SecureStore 설치 증명/사전 저장 해제 capability/지속 epoch와 서버 revision으로 계정 전환·로그아웃 경쟁을 막는다. 동일 binding token refresh는 proof/revision을 유지하고 revoke epoch는 tombstone이다. 전송 직전 회원·설정·원본·OS·바인딩·token hash를 검사하며 이전 receipt로 새 token을 끄지 않는다.

명시 취소는 snapshot과 기존 삭제/exclusions를 같은 트랜잭션에 남긴다. 납부·면제 참여비 및 현장·경기 기록을 보호하며 직접 DELETE는 취소로 취급하지 않는다.

[정확한 계약](push-notifications-contract.md) · [worker 운영 준비](../supabase/functions/push-worker/README.md).

신규 binding은 인증된 설치 예약을 await한 뒤 현재 요청 세대를 확인하고 등록한다. 익명 unknown 해제는 저장하지 않으며 정확한 예약 또는 현재 설치 증명만 해제한다. 회원별 미완료 예약 20개/신규 5개·60초 제한과 30일 또는 검증된 JWT exp+15분 보관을 적용하고 완료/만료 예약을 정리한다. 정상 설치 해제는 quota와 관계없이 실행된다.

## 2026-10-02 운영 모드와 자동 호출

`delivery_mode`는 기본 test이며 production 전환은 `production_activated_at` 설정을 요구한다. 테스트 모드는 allowlist를 유지한다. 운영 모드는 allowlist 제한을 제거하고 활성 회원·종류별 동의·허용 Expo 프로젝트·바인딩·수신 범위 검증을 유지한다. 전환 시각은 outbox 확장과 준비/전송 재검증에 적용하고 예약 세 종류에는 원래 예정 시각을 적용한다. 접수된 ticket receipt는 opt-out 이후에도 상태 확인을 마친다.

dispatch 매분, receipts 5분마다 실행하며 신규 job은 비활성 상태로 적용한다. 기존 주간 일정 Cron은 보존한다. 중단 시 runtime.enabled=false와 worker 환경 OFF, 신규 Cron 비활성화를 적용한다.

운영 pg_net 객체는 supabase_admin 소유이므로 postgres의 REVOKE가 warning만 남기고 실제 큐 접근을 차단하지 못했다. 실제 catalog를 통해 발견했으며 worker 시크릿을 큐에 넣지 않았다. Vault 시크릿을 메모리에서만 사용하고 큐 없이 호출하는 공식 http 확장으로 보완했다. 관리 helper는 Authorization Bearer 인증, 요청 60초/연결 5초 제한과 TLS 검증을 적용한다. 서버가 debug 로그 수준이면 인증 값을 읽기 전 호출을 중지하고 요청 헤더·응답 원문·예외 원문은 저장하지 않는다. 실행 기록은 HTTP 상태·처리 건수·고정 오류 코드만 14일 유지한다. 동기 네트워크 동안 업무 row를 잠그지 않으며 worker의 기존 lease/unknown 정책을 유지한다. 새 확장의 운영 설치는 자동 승인 검토에서 별도 승인 부족으로 거절됐고, 구체 구현과 SQL 검증 후 사용자의 추가 허용을 받아 적용·활성화했다.
