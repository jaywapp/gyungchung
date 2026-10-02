# 경충FC 웰컴 페이지 실행 계획

공개 03 구단 소개형과 관리 공통안을 구현한다. 사용자 정정에 따라 회칙은 제외하고 앱 설치는 필수로 안내한다.

- 작성·갱신일: 2026-10-02
- orchestrator: Codex
- 브랜치: `codex/welcome-page-planning-20261002`
- 기준: [요구사항](welcome-page-analysis.md), [설계](welcome-page-design.md), [시안 요청서](welcome-page-design-request.md), [검증 기록](welcome-page-verification.md)
- verified는 해당 행에 명시한 검증 완료, planned는 미착수, in_progress는 진행 중이다. 로컬 검증을 운영 반영 완료로 표시하지 않는다.
- model·effort는 작업 계획의 제안값이다. W01은 이미 완료된 Claude 디자인 핸드오프다.

## 작업과 현재 상태

| ID | 작업·산출물 | owner | model | effort | depends_on | parallel_group | verification | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| W00 | 세 프로젝트 조사·기획·설계·시안 요청 문서 | Codex | gpt-6.1-sol | high | 없음 | planning | 저장소 책임·익명 배포·문서 링크·변경 범위 | verified |
| W01 | 공개 시안 3종·관리 공통안·비교 문서 | Claude | claude-opus-5-5 | high | W00 | concepts | 핸드오프의 모바일·PC·테마·브랜드 검사 | verified |
| W02 | 디자인·권한·검색·앱 설치·회칙 제외 결정 | Codex | gpt-6.1-sol | medium | W01, 사용자 선택 | decision | 최신 분석·설계·작업 기준 일치 | verified |
| W03 | 초안·게시본·권한·revision·RPC·DB 검사 | Codex | gpt-6.1-sol | high | W02 | backend | 격리 PostgreSQL pgTAP 148개·SQL/TS 계약 84개. 실제 Supabase 적용·복수 연결 검사는 W09 | verified |
| W04 | 검증 릴리스와 같은 APK URL·웹 API | Codex | gpt-6.1-sol | high | W02 | release_contract | 익명 GET·버전/주소 일치·기존 앱 파서·실패/재시도 | verified |
| W05 | 회칙 없는 공개 /welcome | Codex | gpt-6.1-sol | high | W03, W04 | ui | 공개 렌더·운영진·설치·계정·모바일·테마·상태 | verified |
| W06 | 기존 관리 메뉴·편집·미리보기·게시 | Codex | gpt-6.1-sol | high | W03 | ui | 모의 UI 저장/게시·실패·충돌·권한 회수·메뉴 이탈. 실제 인증 E2E는 W09 | verified |
| W07 | 실제 운영진 공개 소개 등록·최초 게시 | 운영진 | 해당 없음 | 해당 없음 | W06, W09, 운영진 자료 | content | 예시 제외·실제 공개 항목·모바일 확인 | planned |
| W08 | 로컬 통합 QA·문서·제품 변경 안내 | Codex | gpt-6.1-sol | high | W05, W06 | integration | npm test·lint·타입·프로덕션 빌드·브라우저·변경 범위 | verified |
| W09 | 운영 DB·원격 푸시·배포·실제 URL 확인 | Codex | gpt-6.1-sol | high | W08, 사용자 반영 요청 | delivery | 실제 DB 51개 검사·익명 HTTP·기본 게시·앱 정보 서버 배포 완료, 웹 반영 진행 | in_progress |

실제 운영진 자료가 없어도 구현·로컬 검증은 가능하다. 기본 콘텐츠에 가상 인물을 넣지 않고 운영진 영역을 숨긴다. 배포 후 운영진이 편집기에서 실제 자료를 등록·게시한다.

## 병렬 실행과 공유 경계

- `welcome_backend`: 신규 마이그레이션·DB 테스트·격리 검증 도구.
- `welcome_public`: 공개 렌더러·다운로드·전용 CSS.
- `welcome_admin`: 편집기·전용 CSS.
- 리더: 공통 타입·공개 조회/API·기존 릴리스 로직·관리 메뉴·권한·페이지 이동·문서·Git 통합.

공통 콘텐츠 계약을 먼저 확정하고 독립 파일을 병렬 구현했다. 회칙 제외 결정은 모든 담당에 전달해 화면·편집·서버 검사에서 함께 제거했다. 공유 파일 변경·통합 검증·Git은 순차 실행한다.

## 검증 기록

최종 실행 결과와 재현 명령은 [검증 기록](welcome-page-verification.md)에 둔다.

| 구분 | 결과·범위 |
| --- | --- |
| 계획·시안 | 세 저장소 조사, 공개 3종·관리 공통안, 03 선택과 최종 정정 반영 |
| 회귀·계약 | npm test 166개 통과 |
| DB | 실제 신규 마이그레이션을 격리 PGlite에 적용하고 pgTAP 148개·SQL/TypeScript 계약 84개 통과 |
| UI | 공개·관리 실제 컴포넌트를 개발용 모의 데이터로 검사. 실패·충돌·권한 회수 때 입력 보존 |
| 화면 | 1440·768·390·360 폭, 라이트·다크, 공개 200% 글자 확대·움직임 줄이기 확인 |
| 앱 호환 | 기존 모바일 main의 실제 버전 파서가 추가 downloadUrl 필드를 허용함 |
| 운영 | 운영 DB 적용·푸시·PR·배포·실기기 설치는 미실시 |

## 운영 반영 순서

1. 사용자의 반영 요청 후 실제 Supabase에서 전체 마이그레이션 이력과 신규 SQL을 검증한다.
2. 신규 마이그레이션을 앱보다 먼저 적용하고 익명·활동 회원·회장·위임·권한 회수의 직접 API/RLS를 확인한다.
3. 작업 브랜치 푸시·PR·필수 검사·병합·Vercel 배포는 승인된 범위에서 진행한다.
4. 운영 `/welcome`·Android metadata·APK 접근·검색 메타데이터·기존 회원 기능을 확인한다.
5. 실제 운영진 콘텐츠를 편집·미리보기·게시하고 새 방문에서 일치하는지 확인한다.
6. Android 실기기 최초 설치와 기존 앱 업데이트를 확인한다. iOS 공식 링크는 실제 배포 시 등록한다.

사용자가 2026-10-02 “다 진행해”로 운영 DB·원격 푸시·PR·병합·배포를 승인했다. 이 승인 범위에서 W09를 진행한다.
