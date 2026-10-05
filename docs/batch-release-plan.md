# 모아둔 기능 일괄 검증·배포 계획
작성일: 2026-10-05
사용자 승인: 2026-10-05 “배포해”. 이전 검증·발행 보류를 해제하고 이 묶음의 검사·필요 수정·DB 적용·작업 브랜치 커밋/push·PR 병합·웹 운영 배포·Android APK 발행을 진행한다.

## 범위와 의존 순서
- 웹/모바일: 생일 월·일 입력 및 캘린더, 입력 유도, 회원 전화 앱 연결, 일정 종료 후 기본 3일 POTM(1~30일 설정/공동 순위).
- 모바일: 실행·복귀/전경 5분 새 APK 확인, 오늘 숨김, 수동 업데이트와 작성 화면 대기. 미발행 0.1.5 공개 노트는 최대 8개 계약을 유지한다.
- DB: 생일→전화→POTM 세 마이그레이션을 검증 후 원본에서 적용한다. 기존 설치 앱과 현재 웹의 읽기/쓰기 계약을 검토하고 기존 회원 데이터에 합성 테스트를 쓰지 않는다.
- Git: 현재 두 feat/member-birthdays worktree 재사용; main/develop 직접 커밋과 허브 gitlink 변경 없음. 각 저장소 PR을 생성/첨부하고 검사 이후 병합한다.
- APK: 기존 main 자동 Actions의 동일 서명·증가 빌드·에뮬레이터 설치·smoke·manifest/체크섬 검사와 draft 발행 절차를 사용한다. 실제 사용자 휴대폰과 iOS 검증은 완료로 주장하지 않는다.

## 분담
| 작업 | owner | model | effort | depends_on | parallel_group | 산출물 |
|---|---|---|---|---|---|---|
| 모바일 전체 검사·실패 수정·Android export | birthday_mobile | gpt-6.1-sol | high | 사용자 지시 | source | docs/batch-release-validation-mobile.md 및 앱 소스 |
| 웹 전체 검사·실패 수정·실제 fixture 브라우저 | birthday_web | gpt-6.1-sol | high | 사용자 지시 | source | docs/batch-release-validation-web.md 및 웹 소스 |
| DB 격리 실행·잠금/권한 보안 리뷰 | birthday_db_audit | gpt-6-astra | high | 사용자 지시 | source | docs/batch-release-validation-db.md 및 SQL/tests |
| 최종 독립 UI/상태 리뷰 | 독립 reviewer | gpt-6-astra | high | 소스 검사·화면 증거 | review | docs/batch-release-review.md |
| 통합 근거 확인·운영 DB 적용·PR/배포/APK 확인 | root | 세션 기본 모델 | high | 위 검사/차단사항 해결 | release | docs/batch-release-result.md |

지원 모델로 기존 역할 매핑을 유지한다. 동일 파일 소유를 겹치지 않는다. 생일의 이전 검증 수치는 최신 통과 증거로 사용하지 않는다. Critical/High 출시 차단 문제는 해결 후 관련 검사를 다시 수행한다.

## 사전 읽기 상태
- 두 원격 main과 작업 HEAD의 차이 0/0, 기존 PR 없음.
- 운영 Supabase gyungchung pamvwzgqkzgsygslmfqo는 ACTIVE_HEALTHY, 최근 이력은 add_profile_avatars까지. 이번 세 마이그레이션 미적용.
- 배포 전 advisor: 보안 WARN 27(anon definer 3/authenticated definer 23/유출암호보호 1), private 정책없음 INFO 17. 성능 WARN 4(기존 permissive 정책), INFO FK 19/unused index 31. 배포 후 동일 baseline과 비교한다.
- 기존 공개 APK 0.1.4/build17/200017. 동일 Android 릴리스 워크플로 성공 이력 확인. 새 APK 결과는 새 실행에서 확인한다.

현재 상태: 검증 진행. 테스트·배포 성공과 미검증 항목은 결과 문서에서 구분한다.
## 운영 이력 대조
Supabase CLI link는 정확한 gyungchung 프로젝트로 성공했다. db push --linked --dry-run은 저장소 시작 이전의 운영 migration 26개가 로컬에 없다고 차단했다. 그 이력은 되돌리거나 지우지 않는다. 이번 검증된 세 원본만 MCP apply_migration으로 적용하고 API가 생성한 실제 운영 버전에 맞춰 아직 미커밋인 이번 로컬 파일과 참조를 정렬한다. 원본 SQL 내용은 적용 당시 hash로 대조하고 경로 변경 뒤 격리 스크립트/이력을 다시 확인한다.

독립 리뷰에서 웹 상세의 마감 직후 집계 재조회 누락 P2가 발견되어 웹 담당자가 보완 중이다. 모바일 생일 최초 리뷰 2개는 actual callback 회귀 증거로 resolved 판정했다. DB는 OS 설치 없이 공식 PostgreSQL17.6 portable/local synthetic instance에서 기존 격리 검사와 실제 2-connection 경합을 검증 중이다. APK verifier가 로컬 서명/다운로드/CI artifact 검증 경로를 준비하며 root의 정확한 새 run/tag 이후 확인한다.
## 2026-10-05 일괄 배포 게이트 갱신
사용자의 “배포해” 지시로 이전 검사·배포 보류가 해제됐다. 최신 모바일 테스트 563개, 웹 테스트 315개(기존 skip 1개), 타입·lint·빌드/export 및 합성 웹 브라우저 49개 검사가 통과했다. 생일 최초 두 P2와 웹 POTM 마감 집계 P2는 수정·회귀 확인 후 독립 최종 리뷰에서 resolved, disposition ship으로 판정했다. 최신 판정은 docs/batch-release-review.md를 따른다. DB 세 변경은 검증 원본과 같은 SHA로 운영에 적용하고 읽기 전용 smoke를 통과했다. PR 병합 및 서명 APK/운영 웹 결과는 별도 최종 배포 기록으로 확인한다.