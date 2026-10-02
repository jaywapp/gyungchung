# 웰컴 페이지 로컬·운영 검증 기록

- 검증일: 2026-10-02, Asia/Seoul
- 브랜치: `codex/welcome-page-planning-20261002`
- 제품 기준: 회칙 제외, 앱 설치 필수, 03 구단 소개형, 초기 회장·시스템 관리자 권한, 검색 노출 제외
- 최초 로컬 검증 시 원격은 변경하지 않았다. 이후 사용자가 전체 반영을 승인해 아래 운영 검증을 진행했다.

## 자동 검사

| 검사 | 명령·방법 | 결과 |
| --- | --- | --- |
| 회귀·콘텐츠·앱 정보 | `npm test` | 최초 166개, 최신 main 통합 후 173개 통과. 실패·skip 0 |
| lint | `npm run lint` | 통과, 오류·경고 0 |
| 타입·프로덕션 빌드 | `npm run build` | 타입·최적화 빌드·21개 정적 경로 생성 통과 |
| DB 권한·초안·게시·검증 | 실제 신규 SQL + pgTAP 1.3.4를 격리 PGlite에서 실행 | 148개 통과 |
| SQL/TypeScript 계약 일치 | 같은 잘못된 콘텐츠 58개·iOS URL 26개를 두 검사기에 전달 | 84개 통과 |
| 기존 모바일 파서 | 모바일 main `11ac12e`의 실제 `parseAndroidRelease`를 최신 웹 응답에 실행 | 추가 downloadUrl 허용, 버전 코드 200011 처리 |

기존 npm 테스트에는 인증·참석·권한 배치·참여 폼·앱 업데이트·알림 회귀 검사가 포함된다. 신규 콘텐츠 검사에는 제거한 회칙·비공개 필드 거절, 미완성 초안과 게시 필수 항목, 크기·ID·공식 URL 검사를 포함한다. 앱 정보 검사는 기존 최고 versionCode 선택·인증된 다운로드·체크섬·공개 주소 제약을 유지한다.

DB 검사는 익명·일반 회원·활동/대기/비활동/연결되지 않은 계정·회장·시스템 관리자·위임·권한 회수를 다룬다. 초안 조회와 직접 쓰기 거절, 게시본 익명 조회, 저장/게시 분리, 충돌·재게시·잘못된 콘텐츠 거절과 공개 응답 범위를 확인했다.

### 격리 DB 검사 재현

제품 의존성에 PGlite를 추가하지 않는다. 외부 검증 폴더에 `@electric-sql/pglite`와 upstream pgTAP 1.3.4의 `pgtap.sql.in`을 준비한 뒤 실행한다.

```text
node --experimental-default-type=module supabase/tests/welcome-pglite.mjs <pglite/dist/index.js 절대 경로> <pgtap.sql.in 절대 경로>
```

도구는 기존 권한 테이블·역할을 격리 fixture로 만들고 저장소의 실제 기존 권한 함수·신규 마이그레이션·pgTAP 테스트를 읽는다. 전체 Supabase 마이그레이션 이력을 재생하거나 운영 환경을 복제한 검사는 아니다. 로컬 Docker/PostgreSQL이 준비되지 않아 `npm run test:db`의 실제 Supabase 검사는 실행하지 않았다.

## 브라우저 검사

실제 공개 렌더러·관리 콘솔·편집기를 개발용 임시 경로에서 검증했다. 운영 DB를 수정하지 않고 초안/게시 RPC·충돌·권한 오류를 모의 응답으로 제공했다. 검증용 라우트·가상 운영진 데이터는 최종 빌드 전에 제거했다.

| 흐름 | 확인 결과 |
| --- | --- |
| 공개 정상 | 운영진 소개·필수 설치·계정 이용, 회칙 UI·목차·문구 없음 |
| Android 정상 | 첫 화면·설치 영역의 두 링크가 같은 검증 릴리스 APK를 가리킴 |
| Android 조회 실패 | 브라우저 fetch 실패 모의로 버전 수치 제거·공개 latest 링크 유지 확인 |
| Android 재시도 | 실제 fetch 복원 후 정상 metadata·같은 릴리스 주소 복구 |
| 다운로드 숨김 | Android 링크·설치 단계 숨김, 계정 안내 유지 |
| iOS | 준비 상태에 가짜 버튼 없음, 공식 App Store 링크·숨김 상태 확인 |
| 게시 조회 오류 | 공개 정보 실패·재시도와 설치/계정 기본 안내 유지 |
| 저장·게시 | 저장 revision 1과 공개 0 분리, 게시 후 1/1 일치 |
| 저장 실패 | 작성 내용과 기존 게시 상태 유지 |
| 충돌 | 최신 초안 비교·한국어 텍스트 복사, 확인 전 내 입력 유지 |
| 권한 회수 | 42501 저장 응답 후 입력 유지·편집/저장 비활성·복사 제공 |
| 미저장 이탈 | 관리 탭 이동 확인·취소 시 입력 보존, beforeunload guard 확인 |
| 이탈 승인 | 메뉴 이동 후 편집기 해제, beforeunload guard도 해제 |
| 미리보기 | 현재 입력 렌더, 처음 포커스·Esc 종료, 중복 ID·가로 넘침 없음 |
| 반응형 | 1440·768·390·360 폭에서 가로 넘침 없음, 모바일 행동 영역 44px 이상 |
| 테마·확대 | 라이트·다크와 공개 화면의 글자만 200% 확대 모의에서 가로 넘침 없음 |
| 움직임 줄이기 | reduced-motion에서 실행 중 장식 애니메이션 없음 |
| 브라우저 오류 | 최종 화면 검사에서 페이지 오류 없음. 로고 비율 경고 수정 후 재확인 |

브라우저 화면은 실제 컴포넌트 검증이며 실제 인증된 운영진 세션의 서버 왕복 E2E가 아니다. 관리 화면의 글자만 200% 확대·스크린 리더·기기의 뒤로 가기 등은 후속 운영 검증에 포함한다.

## 로컬 프로덕션 서버 확인

최종 프로덕션 빌드를 `npm run start -- --port 4317`로 실행해 아래 응답을 확인했다.

- 익명 `/welcome`: 200, `noindex, nofollow`, 회칙 없음·앱 설치 필수·계정 안내 표시.
- `/sitemap.xml`: `/welcome` 미포함.
- `/api/welcome/android`: 200, 공개 필드만 반환, 코드 200011의 검증 릴리스 다운로드 주소 제공.
- `/api/welcome/android?download=1`: 400. 웹 metadata 어댑터를 인증 없는 APK 프록시로 전환할 수 없음.
- 제거한 검증용 `/welcome-qa`: 404.
- 공개 페이지 브라우저: 페이지·콘솔 오류, 가로 넘침·중복 ID, 회원·초안·인증 API 요청 없음.

당시에는 운영 DB 적용 전이라 게시 조회 실패 안내가 표시됐다. 이후 DB 적용·기본 콘텐츠 게시·웹 운영 배포를 완료했고, 아래 운영 검사에서 오류 안내 없이 실제 게시본이 렌더되는 것을 확인했다.

## 최초 로컬 검증 시 운영 확인 계획

1. 실제 Supabase 전체 마이그레이션 호환, migration history, security/performance advisor, 복수 연결의 저장·게시 잠금 검사.
2. 익명·활동 회원·회장·시스템 관리자·위임·회수 계정으로 직접 API/RLS와 실제 저장·미리보기·게시 흐름 검사.
3. 배포 후 `/welcome` 200, noindex·sitemap 제외, 회원 데이터 미조회·초안 미노출, 새 방문의 게시본 일치 검사.
4. 운영 APK 링크·앱 정보 일치, Android 실기기 첫 설치·기존 앱 업데이트, 배포 오류 로그 확인.
5. 운영진 공개 자료 등록·최초 게시. 실제 iOS 배포 시 공식 링크 등록·기기 검증.

위 목록은 최초 로컬 검증 시 작성한 계획이다. 실제 완료 범위는 아래 운영 기록으로 판단하며, 실기기 설치·실제 운영진 브라우저 편집과 복수 연결 경쟁은 미실시다.

## 운영 반영 완료 (2026-10-02)

사용자가 “다 진행해”로 DB 적용·푸시·PR·병합·배포를 승인했다. 최신 main의 푸시 운영과 알림 피드백 변경을 통합하고 각 업데이트 안내 항목을 모두 유지했다.

- 운영 Supabase: gyungchung, PostgreSQL 17.6.1. 마이그레이션 welcome_page 적용 성공, 이력 20261002005032 확인. 로컬 파일명을 실제 버전에 맞춰 동기화했다.
- 실제 PostgreSQL: [롤백 검증 SQL](../supabase/tests/welcome-production-rollback.sql) 51개 검사 통과. 익명·일반·회장·시스템 관리자·위임/회수·비활동/대기/미연결, 직접 쓰기 거절, 저장/게시 분리·충돌·재게시·공식 URL을 검사했다.
- 모든 fixture·권한 변경·검증 게시본은 서브트랜잭션에서 롤백했다. fixture 회원·auth 계정 0개, 보호 트리거 활성 상태를 확인했다.
- 실제 DB에서 확인한 회원 유형·직책·회비 방식 제약을 격리 PGlite fixture에도 반영했다. 다시 pgTAP 148개·SQL/TypeScript 계약 84개 통과.
- 최초 콘텐츠는 DEFAULT_WELCOME_CONTENT의 앱·계정 기본 안내를 시스템 작업으로 저장·게시했다. 초안/게시 revision 1/1, updated_by=null, 운영진 0명, 회칙 없음. 실제 인물을 임의로 만들거나 회원 디렉터리에서 가져오지 않았다.
- 익명 실제 REST: 게시본 200·1행, 초안 SELECT 401, 저장 RPC 401.
- mobile-updates: 배포 버전 5 ACTIVE. 기존 verify_jwt=false와 함수 내부 다운로드 인증을 유지했다. 익명 metadata 200·코드 200011·공개 downloadUrl, 유효한 APK 프록시의 무인증 요청 401.
- Advisor: 새 보안 경고 없음. 기존 보안/성능 경고는 이번 범위에서 변경하지 않았다. 단일 행 초안 테이블의 updated_by 외래키에 unindexed_foreign_keys INFO 1건이 추가됐으며 최대 1행 구조라 별도 인덱스를 추가하지 않았다.
- 웹 [PR #179](https://github.com/jaywapp/gyungchung/pull/179): Vercel 검사 통과 후 squash 병합. 운영 코드 commit `bf85495948fa7e05e7f598b4f17be00301402fd9`.
- Vercel 운영 배포 `dpl_AjBg5hWLy8teEsd9ycuZ1YS9VS9n`: READY, 빌드 약 49초, 운영 alias `gyungchung.vercel.app` 연결. 프리뷰에서 게시 조회 오류가 있었으나 운영 배포에서는 실제 DB 게시본 정상 조회를 확인했다.

### 실제 운영 URL·브라우저 검사

| 검사 | 실제 결과 |
| --- | --- |
| [공개 /welcome](https://gyungchung.vercel.app/welcome) | 비로그인 200. 오류·미게시 안내 없이 기본 게시본 표시. 회칙 없음, 앱 설치 필수, 운영진 0명인 영역·목차 숨김 |
| 검색 | noindex·nofollow, /sitemap.xml 200·/welcome 미포함 |
| Android metadata | /api/welcome/android 200. versionCode 200011, 공개 downloadUrl 제공 |
| APK 일치 | 첫 화면·설치 영역 두 다운로드 주소가 metadata의 검증 릴리스와 일치. 공개 APK HEAD 200, 85,611,780 bytes로 sizeBytes와 일치 |
| 프록시 제한·임시 라우트 | /api/welcome/android?download=1 → 400, /welcome-qa → 404 |
| 기존 웹 진입 | / 응답 200 |
| 공개 브라우저 | 1440·360 폭에서 가로 넘침 없음, 중복 ID 없음, 모바일 다운로드 버튼 높이 54px |
| 공개 네트워크 | 회원·초안·인증 REST 요청 없음. 앱 정보 API만 조회 |
| 브라우저 오류 | 페이지·콘솔 오류 없음 |
| 운영 로그 | /welcome·/api/welcome/android 최근 1시간 runtime error 없음. 해당 운영 deployment error/fatal 로그 0건 |

운영 화면 캡처는 로컬 .work/tasks/welcome-page-20261002/production-mobile-360.png와 production-desktop-1440.png에 저장했다. 캡처는 저장소에 커밋하지 않는다.

실제 운영진 소개 등록, Android 실기기 설치, 실제 운영진 세션의 브라우저 편집 E2E, 복수 연결에서의 잠금 경쟁과 스크린 리더 검사는 이번 자동 운영 검사에 포함하지 않는다. 과거의 미실시 항목은 이 운영 기록에서 명시적으로 확인한 것만 완료로 바뀐다.
