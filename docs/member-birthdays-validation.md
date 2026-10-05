# 구성원 생일 검증 기록
작성일: 2026-10-05

주의: 아래 검증은 전화걸기 추가/모바일 리뷰 수정 이전 snapshot이다. 최신 변경은 사용자 지시에 따라 일괄 검증 대기 상태이며 docs/batch-work-pending.md를 따른다.

## 구현과 보류 범위
- 웹·모바일 작업 브랜치: feat/member-birthdays.
- 양력 월·일만 본인이 등록·변경·삭제한다. 로그인한 활동 회원에게 달력 표시와 미등록 본인 안내를 제공한다.
- 출생연도·나이 저장/표시와 가입 신청서 자동 backfill은 없다. 2월 29일 생일은 비윤년에 2월 28일에 표시한다.
- 사용자 요청으로 운영 DB 적용·push·PR 생성/병합·APK 발행을 보류했다. 기존 운영 서비스와 공개 APK는 바꾸지 않았다.
- 분석·설계·작업 기록은 member-birthdays-analysis.md / member-birthdays-design.md / member-birthdays-tasks.md에서 확인한다.

## 클라이언트
| 대상 | 결과 |
|---|---|
| 웹 npm test | 282개 중 281개 통과, 기존 웹 푸시 검사 1개 skip |
| 웹 타입/ESLint | 통과 |
| 웹 npm run build | exit 0, 21개 페이지 생성, compile 9.2초 |
| 합성 브라우저 | 38개 통과, page error 0, 예기치 않은 외부 요청 0 |
| 화면 | 데스크톱 1440x1050, 모바일 웹 390x844 |
| 모바일 npm test | 324개 통과 (기존 282개 + 생일 42개) |
| 모바일 타입/ESLint | 통과 |
| Android export | exit 0, 2877 modules, Hermes bundle 5,383,913 bytes |
| 앱 소스 버전 | 0.1.5 (미발행) |

실제 SQL directory 14필드만 있는 fixture로 본인 생일 병합과 타인 표시를 확인했다. 조회 중·실패·구형 서버의 필드 부재를 미등록으로 오인하지 않는다. 실제 웹 AccountModal/부모 fresh profile callback과 native AccountSheet→writer→coordinator 경로를 테스트했다. CAS 충돌·삭제 tombstone·로그아웃·계정 ABA·자격 변경·프로필 재연결·확정 저장 후 조회 실패를 확인했다. 달력은 일정 0건, 동일 날짜 여러 회원, 기존 일정과 생일 동시 표시, 윤년/비윤년을 검증했다. 기본 18개 DB 요청을 유지한다.

모바일 export 입력148파일 전후 SHA256:
9f46cb3f1337b8acf2af88b808a06f7bf586d675955f3aab046caa7d9e75b3cd

Hermes 번들 SHA256:
f880b0dc7389e7a51d102dde159dc95949aec0b7195bb6a67183b507b89f0440

로컬 근거(커밋 제외):
- 웹 .ux-review/birthday-browser/result.json, screenshots, verify.mjs.
- 모바일 .work/member-birthdays-export-evidence.json 및 .work/member-birthdays-android-export.

## DB 격리 검증
- 실제 신규 마이그레이션과 기존 avatar/권한 함수·정책을 합성 PGlite에서 실행: 196 assertions 통과.
- 신규 생일 pgTAP: 54개 통과. 기존 directory pgTAP: 5개 통과.
- 기존 avatar 128개, profile permissions 147개, fee 51개 회귀 통과.
- 기존 directory 첫11필드·fee/avatar·ACL 보존을 호출자10종에 대해 전후 비교했다.
- private table 직접 접근 차단, 본인만 쓰기, 활동/인증 연결/초기비밀번호/숨김 계정 경계, 유효 날짜 및 revision CAS를 검증했다.
- 마이그레이션 파일은 Supabase CLI migration new로 생성했다. 적용된 기존 마이그레이션은 수정하지 않았다.

독립 스크립트:
```powershell
$env:PROFILE_PGLITE_MODULE = 'D:/station/welcome-validation/node_modules/@electric-sql/pglite/dist/index.js'
$env:PROFILE_PGTAP_SQL = 'D:/station/welcome-validation/pgtap.sql.in'
node scripts/verify-member-birthdays.mjs
```

DB 변경 전 advisor 결과는 기존 보안 WARN 27개, 성능 WARN 4개다. 운영 마이그레이션을 적용하지 않았으므로 변경 후 운영 advisor를 실행/통과했다고 주장하지 않는다. 신규 private table RLS는 client grants를 회수한 기본 거부 상태이며 정책 없는 private table INFO가 예상된다.

## 독립 리뷰
새 컨텍스트의 Impeccable finish reviewer가 구현·화면·접근권한을 검토한다. 최종 판정은 member-birthdays-review.md에 기록한다.
detector는 변경 화면에 한 번 실행했다. 기존 CSS의 side-tab 2개와 width transition 3개 경고를 리뷰에 전달했으며 이번 생일 변경 줄은 아니다.

## 제한
- 표준 supabase test db --local은 로컬 PostgreSQL 미실행으로 연결되지 않았다. 전체 Supabase 마이그레이션 이력 및 독립 연결 사이의 실제 동시성은 미검증이다.
- 실제 운영 회원 데이터 쓰기는 하지 않았다.
- Android export는 APK 빌드·설치·실물 기기·네이티브 화면·TalkBack 검증과 다르다. 이번 작업에서 해당 검증과 iOS 검증은 하지 않았다.
- 캘린더 월·일은 양력 기준이며 음력 변환은 구현하지 않았다.
