# iPhone 홈 화면 앱 작업

모델명은 이 세션에 제공되는 Codex 모델을 사용한다. 전역 규칙의 opus/sonnet/haiku 명칭은 이 실행 환경에서 제공되지 않는다.

| 작업 | owner | model | effort | depends_on | parallel_group | 상태 |
|---|---|---|---|---|---|---|
| 요구사항 및 기존 계약 조사 | root, ios_plan_review, ios_storage_push | 상속 GPT-6 | high | 없음 | analysis | 완료 |
| 웹 구독/RPC/큐/전송 및 보안 테스트 | ios_storage_push | 상속 GPT-6 | high | 분석 | implementation | 완료 |
| 서비스워커·브라우저 구독·계정/설치 UI | ios_plan_review | 상속 GPT-6 | high | 분석, 서버 계약 | implementation | 완료 |
| 운영 환경·키 설정·배포 절차 조사 | ios_release | 상속 GPT-6 | high | 분석 | release | 완료 |
| 통합·보안 리뷰·브라우저/빌드 검증 | root | 상속 GPT-6 | high | 구현 | verification | 완료 |
| DB/함수/웹 운영 배포·검증 | root | 상속 GPT-6 | high | 검증 | release | DB/함수 완료, 웹 PR 진행 |
| iPhone 사용 안내·검증 결과 문서 | root, ios_storage_push | 상속 GPT-6 | high | 통합 | documentation | 완료 |
| 실제 iPhone 설치·종료 상태 수신·클릭 | 실제 기기 사용자 | 해당 없음 | 해당 없음 | 운영 배포 | device | 실기기 확인 대기 |

## 승인 근거

사용자가 무료 PWA 및 웹 푸시 방향을 논의한 뒤 “그럼 그 방향으로 아이폰 사용자들에게 제공하도록 구성해보자”라고 구현을 요청했다. 웹 저장소 AGENTS.md의 기본 완료 플로우를 적용한다. 모바일 저장소의 이전 커밋/푸시 범위와 분리해 웹 저장소에서 작업한다. 기존 환영 페이지의 승인된 03 콘셉트를 유지하므로 새로운 시각 콘셉트 선택은 요청하지 않는다.
