# 푸시 알림 서버 설계

DB AFTER 트리거→private outbox→서버 인증 worker→Expo ticket→별도 receipt 경계를 사용한다. 기존 웹/이전 APK의 업무 저장 API를 바꾸지 않는다. 기본 runtime disabled와 테스트 UUID allowlist, Expo 프로젝트 제한을 함께 적용한다.

SecureStore 설치 증명/사전 저장 해제 capability/지속 epoch와 서버 revision으로 계정 전환·로그아웃 경쟁을 막는다. 동일 binding token refresh는 proof/revision을 유지하고 revoke epoch는 tombstone이다. 전송 직전 회원·설정·원본·OS·바인딩·token hash를 검사하며 이전 receipt로 새 token을 끄지 않는다.

명시 취소는 snapshot과 기존 삭제/exclusions를 같은 트랜잭션에 남긴다. 납부·면제 참여비 및 현장·경기 기록을 보호하며 직접 DELETE는 취소로 취급하지 않는다.

[정확한 계약](push-notifications-contract.md) · [worker 운영 준비](../supabase/functions/push-worker/README.md).
