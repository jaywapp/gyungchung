# 푸시 worker 운영 준비

[서버 RPC·payload·보호·검증 계약](../../../docs/push-notifications-contract.md)을 따른다.

이 디렉토리의 함수를 따로 배포할 때만 verify_jwt=false로 구성한다. 함수는 x-push-worker-secret을 자체 검증하므로 사용자 JWT/publishable key만으로 발송을 요청할 수 없다. PUSH_DELIVERY_ENABLED는 기본 false다. DB notification_runtime 또한 기본 false이며 auth UUID 테스트 allowlist와 Expo project UUID를 설정한 경우에만 발송 대상을 claim한다.

배포·Cron/Vault·시크릿 등록·실제 발송은 이 소스 작업에서 수행하지 않았다. dispatch와 receipts를 별도 예약 호출하며 전송 ticket을 표시 완료로 보고하지 않는다. unknown 작업은 provider 수락 여부를 운영자가 확인하기 전 자동 재발송하지 않는다. 토큰·증명·개인정보를 로그로 남기지 않는다.
