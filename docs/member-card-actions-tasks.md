# 회원 카드 동작 메뉴 작업
작성일: 2026-10-06 · orchestrator: Codex

| 작업 | owner | model | effort | depends_on | parallel_group | files | verification | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 분석·설계·최신 main 브랜치 | root | 세션 기본 모델 | high | 사용자 요청 | plan | docs/member-card-actions-*.md | 최신 소스 및 SDK 계약 읽기 | 완료 |
| 웹 카드·메뉴·vCard·노트·회귀 준비 | member_menu_web | gpt-6.1-sol | high | plan | implementation | web components/member-directory.tsx, app/globals.css, lib/member-contact.ts, lib/member-phone.test.mjs, lib/update-notes.ts | 소스/diff 검토 완료, 관리자 자격·메뉴 actor generation 분리 및 숨김 QA 관리/연락 차단·ABA 회귀 소스 준비, 테스트 실행 보류 | 구현 완료·정적 재검토 대기 |
| 모바일 카드·Sheet·OS 연락처 폼·노트·회귀 준비 | member_menu_mobile | gpt-6.1-sol | high | plan | implementation | mobile src/features/members.tsx, domain/service contact, package/lock/config, 관련 tests/update-notes | SDK source/권한 정적 검토, 실행 보류 | 진행 |
| 통합 소스 검토·pending 기록 | root | 세션 기본 모델 | high | web,mobile | review | 담당 문서 | 카드의 전화 상시 노출 제거·권한/세대/최신 상세 보존 | 로컬 소스 검토 완료, 실행 보류 |
| 전체 검사·빌드·네이티브 확인·배포 | root | 세션 기본 모델 | high | 사용자 후속 지시 | release | 추후 확정 | 사용자 보류 | 보류 |

대상은 각 저장소 codex/member-card-actions 브랜치다. 이미 배포한 앱 버전/공개 릴리스 노트의 과거 내용을 바꾸지 않는다. 다음 버전 번호는 묶음 발행 시 결정한다. 테스트·타입·lint·export·빌드를 실행하지 않고 회귀 테스트 소스만 준비한다. 운영/공개 릴리스 저장소에는 쓰지 않는다.

## 로컬 준비 결과
웹/모바일 카드 전체 → 메뉴 전화걸기·연락처 저장을 구현했다. 웹 상세·관리 수정/강퇴를 유지하고 연락처와 관리 자격 결합 회귀 MC-01을 정적으로 해결했다. 모바일에서는 이전 메뉴 콜백 객체 검증과 AppShell memberActionsOpen 연동을 추가했다. 별도 review 문서의 prepared-for-batch는 source 상태이며 배포/실행 성공을 뜻하지 않는다.

모바일 root 담당 변경: App.tsx, src/domain/app-update-visibility.ts, tests/app-update-prompt.test.ts. iOS Contacts UsageDescription은 명시 저장 목적 문구를 사용하며 Android 주소록 READ/WRITE 차단을 유지한다. 향후 묶음 버전/공개 release notes를 정리한 다음 전체 테스트·타입·lint·웹 build/UI와 Android APK/native 폼을 검증한다.

이번에 수행한 실행은 설치 패키지 소스 읽기와 git diff --check뿐이다. Contacts 의존성은 57.0.6 한 개를 --ignore-scripts로 설치했다. 커밋·push·PR·빌드·export·운영/기기 데이터 쓰기는 하지 않았다.

## 2026-10-06 웹 우선 배포 전환

사용자가 웹부터 배포하고 점검 후 앱 동기화를 요청하는 방식으로 변경했다. 위 실행 보류는 준비 당시의 이력이다. 현재 회원 메뉴 변경의 웹 검사·빌드·PR·배포를 진행하고 모바일은 준비 소스를 유지한다.

| 작업 | owner | model | effort | depends_on | parallel_group | files | verification | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 웹 전체 검사·생산 빌드·작업 규칙 기록 | root | 세션 기본 모델 | high | 웹 우선 지시 | web-release | AGENTS.md, docs/member-card-actions-*.md, docs/batch-work-pending.md | 329 pass/1 skip, TypeScript·lint exit0, build 21/21 | 완료 |
| 웹 데스크톱·모바일 브라우저 메뉴 확인 | member_menu_web | gpt-6.1-sol | high | 웹 생산 빌드 | web-release | .ux-review/member-card-actions/* | 합성 브라우저 116 통과, 실제 vCard 2개·화면 24개, 서버 종료 | 완료 |
| 웹 독립 최종 리뷰 | member_card_review | gpt-6-astra | high | 웹 검사·브라우저 증거 | web-review | docs/member-card-actions-review.md | 원로그·실제 다운로드·대표 화면 직접 대조, ship 판정 | 완료 |
| 웹 commit·push·PR·병합·운영 확인 | root | 세션 기본 모델 | high | 웹 리뷰 ship | web-deploy | 현재 웹 요청 범위 | 필수 검사, 운영 SHA·HTTP·최근 오류 로그 | 진행 |
| 모바일 동기화 | root | 세션 기본 모델 | high | 사용자 웹 점검 후 명시 동기화 요청 | mobile-later | 기존 준비 변경 | 이번 웹 배포에서 실행하지 않음 | 보류 |
