# 경충FC 웰컴 페이지 설계

신규 회원이 운영진을 확인하고 필수 앱 설치·계정 이용을 시작하는 공개 페이지다. 선택한 03 구단 소개형을 적용하되 사용자 정정에 따라 회칙은 화면·편집기·스키마에서 제외한다.

- 기준일: 2026-10-02
- 공개 주소: `/welcome`
- 관련 문서: [요구사항](welcome-page-analysis.md), [작업 계획](welcome-page-tasks.md), [검증 기록](welcome-page-verification.md)

## 방문 흐름과 화면

| 순서 | 내용 | 행동 |
| --- | --- | --- |
| 첫 안내 | GCFC 브랜드, 환영 제목·소개 | Android 다운로드, 계정 이용 안내, 웹 이용 |
| 운영진 | 첫 운영진 소개 패널과 나머지 공개 소개 | 소개 확인. 등록된 운영진이 없으면 영역·이동 링크 숨김 |
| 앱·계정 | 필수 앱 설치 문구, 버전 정보, 설치 방법과 계정 이용 단계 | 같은 릴리스의 APK 다운로드, iOS 공식 배포 이동 |
| 하단 | 브랜드·관리된 콘텐츠의 게시 시점·테마 제어 | 처음으로 이동, 라이트·다크 전환 |

네이비 첫 화면, 운영진 소개의 타이포그래피와 코트 표현, 그린 설치 영역을 선택 시안의 시각적 기준으로 사용한다. 한글은 기존 Pretendard, 영문은 Archivo를 사용하고 기존 로고·앱 아이콘을 재사용한다. 공통 회원 페이지를 바꾸는 전역 스타일을 추가하지 않는다.

모바일 360·390px, 태블릿 768px, PC 1440px에 맞게 재배치한다. 의미 있는 제목·링크·버튼, 키보드 포커스, 미리보기 모달의 포커스 복귀, 44px 이상의 모바일 행동 영역, 움직임 줄이기를 지원한다. 글자 확대와 어두운 테마에서도 읽기 흐름을 유지한다.

## 공개 경로와 조회

`app/welcome/page.tsx`는 동적 서버 페이지다. 방문자의 로그인 쿠키를 사용하지 않는 익명 클라이언트로 게시본만 조회한다. 회원 디렉터리·계정·초안을 읽지 않는다. 조회는 `no-store`와 8초 제한을 적용한다.

`noindex, nofollow`와 canonical `/welcome`을 제공하고 sitemap에 추가하지 않는다. 링크 접근은 누구나 가능하다. 로그인 안내에서 신규 회원 안내 링크를 제공하며 공개 경로에서는 기존 설치형 웹의 시작 화면을 띄우지 않는다.

| 게시 조회 | 표시 |
| --- | --- |
| 정상 | 검증한 게시 콘텐츠 |
| 게시본 없음 | 기본 앱·계정 안내와 게시 준비 상태, 가상 운영진 없음 |
| 오류·시간 초과·잘못된 데이터 | 기본 앱·계정 안내 유지, 공개 정보 조회 실패·재시도 표시 |

공개 페이지와 권한 있는 초안 미리보기는 `components/welcome-page.tsx`를 함께 사용한다. 임의 HTML을 렌더링하지 않고 입력 문자열을 텍스트로 출력한다.

## 콘텐츠 계약

`lib/welcome-content.ts`의 `WelcomeContent`가 클라이언트·서버 계약이다. 최상위 키는 아래 7개만 허용하며 회칙 필드는 받지 않는다.

| 키 | 내용·제한 |
| --- | --- |
| schemaVersion | `1` |
| title | 환영 제목, 최대 160자 |
| introduction | 소개 문구, 최대 1,000자 |
| accountSteps | 제목 160자·본문 2,000자, 최대 10단계 |
| officers | 안정적인 ID·공개 이름·직책 표시명·소개, 최대 30명 |
| android | 다운로드 표시 여부·설치 안내 최대 10단계 |
| ios | 준비·테스트·출시·숨김 상태, 안내·공식 URL |

전체 compact JSON은 UTF-8 500KB 이하로 제한한다. 운영진 ID는 ASCII 허용 문자·길이·중복·예약된 화면 ID를 검사한다. 회원 계정 ID나 개인 연락처 필드를 허용하지 않는다. 이름·직책은 100자, 운영진 소개는 2,000자, iOS 안내는 1,000자, URL은 2,000자 이하로 제한한다. 글자 제한은 JavaScript와 DB에서 UTF-16 기준으로 맞춘다.

미완성 초안은 저장할 수 있다. 게시 시 제목·소개, 등록된 안내 단계의 제목·본문, 운영진 이름·직책과 활성 iOS 링크를 확인한다. iOS 주소는 공식 `apps.apple.com` 또는 `testflight.apple.com` HTTPS 주소만 허용한다. 자격 증명·포트·공백·제어 문자·원시 Unicode URL을 거절한다.

## 초안·게시본과 권한

| 객체 | 조회 | 쓰기 |
| --- | --- | --- |
| welcome_page_drafts | 활동 중이며 연결 계정이 있고 `welcome.manage`를 가진 운영진 | 저장 RPC만 허용 |
| welcome_page_publications | 익명·로그인 사용자 모두 | 게시 RPC만 허용 |

각 테이블은 `id=true` 단일 행이다. 초안은 `revision`, `published_revision`, `updated_at`, `updated_by`를 기록한다. 공개 행은 `content`, `revision`, `published_at`만 가진다. 직접 INSERT·UPDATE·DELETE 권한은 허용하지 않는다.

초기 `welcome.manage`는 회장과 시스템 관리자에게 제공한다. 권한 허용 목록, 기존 직책별 배치 위임 RPC와 관리 UI를 함께 확장한다. 공개 소개의 직책 표시명을 바꿔도 실제 회원 유형·직책·계정 권한은 바뀌지 않는다.

| RPC | 동작 |
| --- | --- |
| save_welcome_page_draft(page_content, expected_revision) | 서버 권한·구조 검사 후 현재 revision과 일치할 때 초안 저장·증가 |
| publish_welcome_page(expected_revision) | 서버 권한·게시 필수 항목 검사 후 저장된 초안을 원자적으로 공개 |

private 함수의 고정 search_path, 명시적 권한 검사, advisory lock·행 잠금·revision 비교를 사용한다. 충돌은 `40001`, 권한 상실은 `42501`로 반환한다. 같은 리비전의 재게시 요청은 기존 게시 시각을 유지한다. 공개 래퍼·private 함수의 GRANT도 검증한다.

## 관리 메뉴와 편집

기존 관리 → 운영 → 웰컴 페이지를 추가하고 권한이 있을 때만 노출한다. 편집기는 필요할 때 로드하며 기본 안내·운영진 소개·앱 설치의 세 영역을 제공한다. Android 자동 버전 정보는 읽기 전용이다.

하단에는 초안 저장·미리보기·게시와 변경 상태를 표시한다. 게시하려면 변경을 먼저 저장해야 한다. 입력 오류는 해당 영역·필드로 이동할 수 있게 안내한다. 미리보기는 현재 입력임을 명시하고 공개 링크로 초안을 전달하지 않는다.

저장·게시 실패 때 입력을 유지한다. 충돌 때 최신 초안을 비교하고 내 내용을 텍스트로 복사할 수 있으며, 명시적 확인 뒤 최신 초안을 다시 불러온다. 권한이 회수되면 저장을 막고 작성 내용을 복사해 보관하도록 한다. 관리 메뉴·주요 페이지 이동과 새로고침에는 미저장 이탈 확인을 제공한다.

## Android·iOS 배포 연동

`/api/welcome/android`는 읽기 전용 GET이다. 기존 `createMobileUpdatesHandler`를 재사용해 완료된 정식 릴리스 중 검증한 최고 `versionCode`를 선택한다. 버전·파일명·크기·체크섬·릴리스 일치 검사를 유지하고 같은 선택 릴리스의 공개 `downloadUrl`을 응답에 추가한다.

첫 화면과 앱 설치 영역은 동일한 응답 상태를 공유한다. 정상일 때 버전 정보와 두 다운로드 버튼의 주소가 같은 릴리스에 속한다. APK를 Vercel에 복제하거나 웹에서 바이너리를 프록시하지 않는다.

조회 중·조회 실패에는 수치 정보를 숨기고 공개 최신 주소를 사용한다. 실패 때 재시도를 제공한다. 고정 주소는 `https://github.com/jaywapp/gyungchung-releases/releases/latest/download/gyungchung-latest.apk`다. 임의 저장소·인증 주소·query/hash가 있는 APK 링크를 허용하지 않는다.

기존 Edge Function의 공개 metadata 응답에도 같은 필드를 추가한다. 앱 내 인증된 다운로드의 토큰·프록시 계약을 유지한다. 실제 모바일 파서는 필요한 필드만 읽으므로 추가 필드와 호환된다. 웹은 로컬 어댑터를 사용하므로 Edge Function의 추가 필드 배포에 선행 의존하지 않는다.

기존 릴리스 선택 캐시는 무토큰 600초·선택 토큰 사용 시 120초다. 웹은 `no-store`로 장기 캐시를 중첩하지 않는다. 새 APK 공개는 콘텐츠 재게시 없이 자동 반영된다.

iOS는 준비 중에는 설명만 제공한다. 실제 TestFlight·App Store URL이 있을 때 해당 행동을 활성화하고 숨김이면 영역을 제거한다. 현재 배포 주소를 임의로 만들지 않는다.

## 구현 파일과 운영 반영

- 공개 페이지·조회: `app/welcome/page.tsx`, `lib/welcome-publication.ts`
- 공유 렌더러·다운로드: `components/welcome-page.tsx`, `components/welcome-downloads.tsx`, 전용 CSS
- 편집기·통합: `components/welcome-editor.tsx`, 전용 CSS, `components/admin-console.tsx`, `components/clubhouse.tsx`
- 계약·검사: `lib/welcome-content.ts`, 대응 테스트
- DB: `supabase/migrations/20261002005032_welcome_page.sql`, `supabase/tests/database/welcome_page.test.sql`
- 앱 정보: `app/api/welcome/android/route.ts`, `supabase/functions/_shared/mobile-updates.ts`, 대응 테스트
- 기존 설치형 시작 화면·변경 안내: `lib/splash-motion.ts`, `lib/update-notes.ts`

마이그레이션 파일의 버전은 운영 MCP가 실제 적용한 20261002005032에 맞춰 동기화했다. 초기 파일은 CLI로 생성했으며 SQL 내용은 동일하다. 운영 DB에 적용·권한 검증한 뒤 웹을 배포한다. 최초에는 lib/welcome-content.ts의 검증된 기본 안내를 시스템 작업으로 리비전 1에 저장·게시했다(updated_by=null). 실제 운영진 소개는 회장·시스템 관리자가 초안을 저장·미리보기·게시한다. 원격 반영과 실기기 검사는 [검증 기록](welcome-page-verification.md)의 남은 항목을 따른다.
