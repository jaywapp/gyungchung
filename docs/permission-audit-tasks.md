# 운영진 권한 정비 작업

| 작업 | owner | model | effort | depends_on | parallel_group | 상태 |
|---|---|---|---|---|---|---|
| 웹·모바일·DB 전체 감사 | permission_*_audit | GPT-6 Astra | high | 요구사항 | audit | completed |
| 정·부 의미 확인·설계 확정 | root | GPT | high | 감사 | design | completed |
| 관리자 프로필 보호·격리 DB 회귀 검사 | permission_security_db/permission_operations_db | GPT-6.1 Sol | high | 설계 | backend | completed |
| 운영진 기본값·설정 경계·일정 조회 독립성 | permission_operations_db | GPT-6.1 Sol | high | 설계 | backend | completed |
| Edge 계정 발급 대상 보호·회귀 검사 | root | GPT | high | 설계 | backend | completed |
| 웹·앱 권한 조건과 저장 요청 정비 | permission_web_audit/permission_mobile_audit | GPT | high | 서버 계약 | client | completed |
| 독립 리뷰·통합 검사 | permission_*_audit/root | GPT | high | 구현 | verification | completed |
| DB·Edge 운영 반영 | root | GPT | high | 검증 | delivery | completed |
| 웹 PR·운영 배포 | root | GPT | high | DB 반영 | delivery | pending |
| 모바일 PR·Android APK 발행 | root/permission_mobile_audit | GPT | high | DB 반영·사용자 승인 | delivery | in_progress |

회비 오류는 PR #186으로 먼저 운영 반영했다. 개인별 권한 예외·정/부 모델은 구현하지 않는다. 재무 이력 보존은 별도 정책 결정 전 기존 삭제 동작을 변경하지 않는다.

검증: 계정 경계 147개(기존 취약 경로 9개 재현 포함), 운영 서비스 178개, 기존 회비 51개 격리 DB 검사 통과. Edge 실제 핸들러 mock 4개 통과 및 권한 없는 특권 대상 요청의 Auth Admin API 호출 0회 확인. Auth의 실제 INSERT 이후 app_metadata UPDATE 순서와 사용자 metadata 위조·표식 재사용을 검사했다.

웹은 전체 테스트 250개 통과·기존 외부 패키지 검증 1개 skip, lint·프로덕션 빌드 통과. 변경 TSX의 기존 스타일 유지와 디자인 detector 1회 0건을 확인했다. 초기 18개 조회, 외부 권한 회수, 계정 전환, 오프라인 저장 차단, 보호 필드 제외 및 0행 실패를 검증했다.

모바일은 240개 테스트·TypeScript·lint·최종 Android export·root 독립 리뷰 통과. 5078013과 공개 릴리스 노트 bcc24cc를 PR #15로 제출했다. 사용자에게 PR 병합·Android APK 발행 승인을 받았으며 최종 head의 verify 검사 2개 성공을 확인했다. iOS 기기 검증은 수행하지 않았다.

운영 적용 순서: 계정 발급 Edge v7 ACTIVE(JWT 검증 유지) → 20261004170029_harden_profile_account_boundaries → 20261004170054_align_officer_service_permissions. 이력과 함수·트리거·ACL을 읽기 전용으로 확인했다. 각 운영 직책의 9개 서비스, obsolete delegation 0행, invoker RPC와 private 최소 조회 경계, 기존 profiles 개인정보 RLS 유지 및 새 보안 advisor 지적 0건을 확인했다. 실제 회원 회비·계정 초기화는 테스트로 실행하지 않았다.
