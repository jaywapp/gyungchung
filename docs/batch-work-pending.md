# 일괄 작업 대기 기록
작성일: 2026-10-05

사용자 지시: “지금부터 내가 말하는건 작업만 해둬. 한번에 모아서 빌드 테스트하고 배포까지 몰아서 하게”

## 현재 방식
- 요청된 항목은 로컬 구현과 검증 코드 작성까지 준비한다.
- 해당 지시 이후 항목별 테스트·타입 검사·lint·빌드·Android export·브라우저 검증·운영 DB 적용·push·PR·APK 발행을 실행하지 않는다.
- 사용자가 모아서 진행하라고 지시하면 전체 최종 소스에 대해 검증·빌드·리뷰·배포를 한 번의 묶음으로 진행한다.
- 검증 이전의 현재 변경을 완료/검사 통과로 표시하지 않는다. 로컬 commit도 최종 검사 이후로 미룬다.

## 모인 변경
| 항목 | 로컬 구현 | 검증 상태 |
|---|---|---|
| 구성원 생일 캘린더/본인 입력 유도 | 기본 기능과 모바일 리뷰 수정 반영 | 이전 snapshot 검증 완료; 최신 추가 수정은 일괄 검증 대기 |
| 회원 메뉴 전화걸기 | 웹·모바일/본인 자격 검증/대상 번호 on-demand 조회 구현 | 테스트 코드 작성, 실행 보류 |
| 일정별 Player of the Match | 웹·모바일·DB 로컬 구현과 검증 코드 준비, 종료 후 기본 3일/기간 설정/공동 순위 | 검사·빌드·리뷰·DB 적용·배포 보류 |
| Android 업데이트 주기 확인·팝업 | 시작/복귀·전경 5분 확인, 당일 숨김 저장, 수동 조회·설치, 작성 화면 안내 대기 | 소스·회귀 코드 준비; 검사·기기 확인·빌드·배포 보류 |

## 앞서 수행한 생일 검증
지시 이전 snapshot에서 웹 281 pass/1 skip, 모바일 324 pass, DB 격리196+pgTAP54+기존directory5, 브라우저38, 웹build/Androidexport를 수행했다.
이 기록과 member-birthdays-validation.md의 소스 해시는 전화걸기 및 모바일 리뷰 수정 이후 최종 소스의 통과 증거가 아니다.

## 생일 독립 리뷰
최초 판정: fix. 모바일 응답 유실 안내, 달력 로딩/실패/unknown 안내와 재조회 경로를 수정 대상으로 기록했다.
모바일 리뷰 2개는 소스에 반영했다. 수정 이후 actual callback/render 테스트 및 reviewer verdict는 일괄 검증 때 수행한다. 지금 검토 통과로 변경하지 않는다.

## 운영 상태
이 묶음의 운영 DB 적용·push·PR·병합·웹 배포·APK 발행 없음.

## 준비한 검증 코드
- 웹 lib/member-phone.test.mjs: 전화 기능 8개 테스트를 작성했으며 실행하지 않았다.
- 모바일 tests/member-phone.test.ts 및 birthday-account.test.ts/birthday-render.test.ts: 실제 버튼·전화 앱 mock·응답 유실·초기 조회/재시도·계정 경계를 작성했으며 최신 수정 이후 실행하지 않았다.
- DB scripts/verify-member-phone.mjs 및 supabase/tests/database/member_phone.test.sql: 전화 조회/권한/기존 기능 보존 검증을 작성했으며 실행하지 않았다.
- DB 원본에 생일·전화 조회 migration 파일을 준비했으며 운영에는 적용하지 않았다.
- 현재 변경은 양쪽 feat/member-birthdays 브랜치의 로컬 working tree에 보관한다. commit/push/PR/배포는 하지 않았다.

- POTM DB: 20261005042615_add_event_potm_voting_window.sql, supabase/tests/fixtures/event_potm.sql, supabase/tests/database/event_potm.test.sql, scripts/verify-event-potm.mjs를 준비했다. 경계·권한·기존 표/동률·cascade·기존 함수 계약 검증 코드만 작성했고, 운영 및 격리 DB 모두 실행하지 않았다. 실제 다중 연결 잠금 경합은 향후 확인한다.

## POTM 로컬 인계
- 웹: lib/mom-vote.test.mjs, lib/event-potm.test.mjs에 기간·계정 경계·실제 투표/편집 콜백·열린 모달 마감·조회 fallback 검증 코드를 작성했다. 실행하지 않았다.
- 모바일: tests/mom-vote.test.mjs를 갱신하고 tests/potm-window.test.ts, tests/mom-account.test.ts, tests/potm-render.test.ts에 기간·실제 화면/투표/일정 편집·반복 생성·응답 유실·서버 거절 후 최신 회원/출석 반영 검증 코드를 작성했다. 실행하지 않았다.
- 시간 경계의 자동 조회, 서버 거절 뒤 자격 회복 조회, 확정 저장 뒤 표/집계 조회를 구분했다. 기본 경기 시간 질문은 미응답이므로 기존 주간 안내에 맞춰 2시간으로 준비했고 일정별 종료 시각으로 바꿀 수 있다.
- 기존 생일·전화 변경은 보존했고 앱/출시 노트는 미발행 0.1.5에 합산했다. 웹 lib/update-notes.ts에도 직접 요청으로 기록했다.
- 로컬 소스와 테스트 코드 준비 상태이며 검증 통과 상태가 아니다. 검사·빌드·Android export·브라우저·독립 리뷰·운영 DB 적용·commit·push·PR·배포·APK 발행을 실행하지 않았다.
- 일괄 단계에서는 생일 리뷰 수정의 verdict와 전화/POTM 새 범위 리뷰, 기존 기능 회귀, SQL 및 실제 PostgreSQL 다중 연결 잠금, 최종 웹/Android 빌드·설치 확인을 진행한다. iOS는 확인한 것으로 간주하지 않는다.
## 앱 업데이트 로컬 인계
- Android 설치 앱의 시작·복귀와 전경 사용 중 5분마다 새 빌드를 확인하도록 준비했다. 백그라운드 전환은 메타데이터 요청과 타이머만 중단하며 APK 다운로드 취소/권한/Android 설치 확인은 기존 사용자 동작을 따른다.
- 새 버전 팝업에 업데이트/오늘 다시 보지 않기를 제공한다. 기기 현지 날짜로 저장해 재실행에도 유지하고 다음날 안내할 수 있다. 당일의 더 높은 빌드도 숨기며 더보기의 앱 업데이트에서는 수동 확인·설치할 수 있다. 일반 닫기는 저장하지 않는다.
- 로그인·계정·초기 비밀번호·더보기·작성 화면에서는 팝업을 대기시킨다. 업데이트 화면은 진입마다 수동 확인하고 자동 안내와 겹치지 않는다. 조회 실패를 최신 버전이라고 단정하지 않는다.
- 모바일 src/domain/app-update.ts, src/services/app-update-controller.ts, src/services/app-update.ts 및 새 app-update-monitor.ts에 날짜/동시 요청/foreground 정책을 준비했다. 기존 앱 ID·공식 배포 메타데이터·APK 검증·회원 다운로드·Android 설치 확인을 보존한다.
- tests/app-update.test.ts, 새 tests/app-update-monitor.test.ts, 새 tests/app-update-prompt.test.ts, tests/update-manifest.test.mjs에 회귀 코드를 작성만 했다. 기존 설치/계정 경계와 수동·자동 공유 요청, 오늘 숨김/자정/저장 실패, 늦은 응답, AppState/타이머/리스너 정리, 실제 화면 콜백과 작성 화면 복귀를 대상으로 한다. 테스트 수를 통과 수로 간주하지 않는다.
- release/update-notes.json의 미발행 0.1.5 노트를 서버·패키저·클라이언트의 최대 8항목 계약에 맞게 통합했다. 생일·전화·POTM·사진·권한·성능을 보존하고 업데이트 안내를 합산했다. 기존 12항목은 이번 미발행 소스의 문제이며 사용자 제보 시점의 운영 장애 원인으로 확정하지 않았다.
- 상세 계획은 모바일 docs/app-update-monitor-analysis.md, app-update-monitor-design.md, app-update-monitor-tasks.md에 기록했다. 웹/DB/배포 저장소의 업데이트 서버 소스는 바꾸지 않았다. 서버 공개 릴리스 조회 캐시는 유지하므로 발행 즉시 알림을 보장하는 방식은 아니다.
- 실제 사용 중인 APK 버전·빌드/단말 응답은 미확인이다. 일괄 단계에서 Android 실제 설치·새 릴리스 수신·네트워크 실패/복귀·오늘 숨김/다음날·서명/계정 경계와 최종 노트 규격을 확인한다. 앱 종료 상태의 상시 감시나 iOS 제공은 구현하지 않았다.
- 현재 기능은 로컬 준비 상태다. 이번 요청에 대해 테스트·타입·lint·빌드·export·브라우저·독립 완료 리뷰·DB 적용·commit·push·PR·병합·배포·APK 발행을 실행하지 않았다.
## 2026-10-05 일괄 배포 시작
사용자가 “배포해”로 검사·빌드·필요 DB 적용·PR 병합·웹 및 Android 발행을 승인했다. 위 보류 기록은 준비 시점의 이력이며 현재 실행 상태는 batch-release-plan.md와 각 validation/result 문서를 따른다.

## 2026-10-05 일괄 배포 게이트 갱신
사용자의 “배포해” 지시로 이전 검사·배포 보류가 해제됐다. 최신 모바일 테스트 563개, 웹 테스트 315개(기존 skip 1개), 타입·lint·빌드/export 및 합성 웹 브라우저 49개 검사가 통과했다. 생일 최초 두 P2와 웹 POTM 마감 집계 P2는 수정·회귀 확인 후 독립 최종 리뷰에서 resolved, disposition ship으로 판정했다. 최신 판정은 docs/batch-release-review.md를 따른다. DB 세 변경은 검증 원본과 같은 SHA로 운영에 적용하고 읽기 전용 smoke를 통과했다. PR 병합 및 서명 APK/운영 웹 결과는 별도 최종 배포 기록으로 확인한다.
## 2026-10-06 두 번째 변경 묶음 시작
사용자가 앞으로 요청은 구현만 준비하고 빌드·배포를 나중에 모아 진행하도록 지정했다. 이전 0.1.5 발행은 완료 이력이며 이번 묶음과 구분한다.

- 회원 카드 전체 선택 → 회원 메뉴: 카드의 전화 상시 버튼 제거, 전화걸기·연락처 저장, 기존 상세/관리 권한 유지.
- 로컬 브랜치 codex/member-card-actions, 분석·설계·작업 문서 member-card-actions-*.md.
- 전체 테스트·타입/lint·UI/native 실행·빌드/export·운영 적용·commit/push/PR/발행: 보류.
- 회귀 준비: 메뉴 닫기/바꾸기·계정 ABA·대상 변경·중복·번호 미등록/오류·vCard 주입/UTF8·native form 결과 미확정. 실행 결과는 다음 묶음 검증으로 기록한다.

추가 회귀 준비: 연락처 자격과 기존 관리 자격 분리(MC-01), 회원 메뉴/연락처 작성 중 새 버전 popup 보류 및 종료 후 재노출. iOS는 저장 목적 Info.plist 문구를 유지하고 실제 Contacts 화면/저장은 후속 검증한다.

## 2026-10-06 웹 우선 배포

사용자 지시로 현재 회원 카드 메뉴 변경의 웹 검증·빌드·배포를 시작한다. 앞으로 웹을 먼저 배포해 사용자 점검을 받고, 앱은 동기화 요청 이후 진행한다. 준비된 모바일 변경은 로컬에 유지하며 이번 단계의 앱 검사·빌드·PR·APK 발행은 진행하지 않는다. 웹 검증과 배포 상태는 member-card-actions-tasks.md 및 member-card-actions-review.md를 따른다.
