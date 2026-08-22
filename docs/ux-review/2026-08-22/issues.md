# 경충FC 클럽하우스 — UX/UI 점검 이슈 목록

- 대상: https://gyungchung.vercel.app
- 점검일: 2026-08-22
- 모드: `--audit-only` (수정·재검증 미수행)
- 역할: `테스트 계정` (운영 관리 `관리` 탭 접근 권한 보유)
- 뷰포트: 1280x800 (desktop), 390x844 (mobile)

---

ID: UX-001
Severity: High
Category: Visual
Page: /admin (회원·용병·회비·일정·공지 등 모든 목록 탭)
Role: manager / 시스템 관리 권한
Component: AdminConsole 툴바 (`.admin-toolbar > .resource-actions`)
Problem: `.resource-actions button` 규칙이 아이콘 전용 버튼을 가정해 모든 하위 버튼을 44x44로 강제한다. 운영 관리 툴바의 텍스트 CTA(`새로 등록`, `월회비 일괄 등록`)가 이 규칙에 걸려 44x44 정사각형으로 찌그러지고, 라벨이 버튼 박스 밖으로 흘러나와 주변 요소와 겹친다.
Evidence:
  - .ux-review/evidence/UX-001-admin-newbutton-1280.png (회원 관리 탭 · 데스크톱)
  - .ux-review/evidence/UX-001-admin-fees-buttons-1280.png (회비 관리 탭 · 버튼 2개 모두 깨짐)
  - .ux-review/evidence/admin-390.png (모바일)
Repro:
  1. 관리 권한 계정으로 로그인
  2. `/admin` 진입 → `회원 관리` 탭
  3. 목록 상단 우측 `새로 등록` 버튼 확인 → 44x44 박스에 "새로/등록"이 밖으로 넘침
  4. `회비 관리` 탭으로 이동 → `월회비 일괄 등록`도 동일하게 깨짐 (더 심함)
Measured:
  - `새로 등록`: 44x44, scrollHeight 63 vs clientHeight 42 → 세로 21px 넘침
  - `월회비 일괄 등록`: 44x44, scrollHeight 80 vs clientHeight 42 → 세로 38px 넘침
  - 1280x800과 390x844 양쪽 모두 재현 (미디어쿼리 밖 규칙이라 뷰포트 무관)
Impact: 운영진의 주요 생성 액션이 모든 관리 목록 화면에서 시각적으로 파손된 상태. 라벨을 읽을 수 없어 어떤 버튼인지 아이콘으로만 추측해야 한다.
Recommendation: `.resource-actions button` 셀렉터를 아이콘 전용 버튼(`.resource-icon-action` 등)으로 한정하거나, `.cta` 클래스를 가진 버튼은 고정 크기에서 제외한다.
Files: app/globals.css:1656-1664, components/admin-console.tsx:130
Status: Open

---

ID: UX-002
Severity: Medium
Category: Responsive
Page: / (로그인 상태)
Role: member / manager
Component: NEXT SCHEDULE 히어로 카드
Problem: 로그인하면 카드 하단 정보 행에 `참석 예정 N명` 열이 추가되면서 flex 행이 좁아지고, 우측 `일정 보기` 버튼이 62px로 압축돼 텍스트가 "일정 / 보기" 2줄로 감긴다. 밑줄도 두 줄로 쪼개져 깨져 보인다.
Evidence: .ux-review/evidence/home-loggedin-1280.png (우측 상단 카드), .ux-review/evidence/home-loggedout-1280.png (로그아웃 시 정상 1줄)
Repro:
  1. 1280x800에서 로그인
  2. `/` 진입 → 우측 NEXT SCHEDULE 카드 하단의 `일정 보기` 버튼 확인
Measured: 버튼 62x52 (정상은 1줄), font-size 12px, `white-space: normal`, `flex-shrink` 미지정. 형제 정보 블록 282px / 부모 flex 405px
Impact: 로그인한 모든 회원이 첫 화면에서 보는 카드. 로그아웃 상태에서는 정상이라 로그인 직후 레이아웃이 무너지는 것처럼 보인다.
Recommendation: 버튼에 `white-space: nowrap` + `flex-shrink: 0` 적용, 또는 좁은 폭에서 정보 행을 세로로 쌓는다.
Files: app/globals.css (`.schedule-*` 카드 하단 액션 행)
Status: Open

---

ID: UX-003
Severity: Low
Category: Visual
Page: /participation (참여 폼 모달), 그 외 모든 모달
Role: member / manager
Component: `.login-modal h2`, `.editor h2`
Problem: 모달 제목에 `line-height: .95`가 적용돼 있다. 한글 글리프는 em 박스를 거의 꽉 채우므로 제목이 2줄로 감기면 leading이 0 이하가 되고 위아래 줄의 글리프 잉크 박스가 겹친다.
Evidence: .ux-review/evidence/participation-form-390.png
Repro:
  1. 390x844에서 `/participation` 진입
  2. `참여하기` 클릭 → 모달 제목 `경충FC 운영 만족도 조사`가 2줄로 감김
Measured: font-size 40px, line-height 38px (0.95), 줄 간격(advance) 38px vs 한글 잉크 높이 39px → 실측 1px 겹침. 데스크톱은 48px/0.95, 제목이 1줄이면 증상 없음
Impact: 육안으로는 "많이 답답한" 수준이며 파손으로 보이지는 않는다. 제목이 길어질수록 악화된다.
Recommendation: 모달 제목 `line-height`를 1.1~1.2로 올린다 (라틴 기준 타이트 값이 한글에는 과함).
Files: app/globals.css:4476-4481, app/globals.css:5401-5402
Status: Open

---

ID: UX-004
Severity: Low
Category: Accessibility
Page: /, /events
Role: member / manager
Component: 일정 카드 보조 문구
Problem: 본문 보조 텍스트 2곳이 11px로 렌더링된다. 권장 최소치(12px, 이상적으로 14px) 미만이라 고DPI 모바일에서 읽기 어렵다.
Evidence: .ux-review/evidence/home-loggedin-1280.png, .ux-review/evidence/home-390.png
Repro:
  1. `/` 진입 (로그인 상태)
  2. NEXT SCHEDULE 카드의 `잔여 N자리 · 용병 포함`, RSVP 카드의 `참석 또는 불참을 선택해 주세요.` 확인
Measured: 두 요소 모두 `font-size: 11px`, color `rgb(88,102,117)`. 대비 자체는 AA 통과
Impact: 정원/응답 안내라는 실질 정보가 가장 작은 글자로 표시된다.
Recommendation: 12px 이상으로 상향하거나 해당 문구를 보조가 아닌 본문 스케일로 승격한다.
Files: app/globals.css
Status: Open

---

ID: UX-005
Severity: Low
Category: Auth
Page: / (로그인 모달)
Role: 비로그인
Component: LoginModal
Problem: 로그인 모달이 초기 비밀번호를 평문으로 안내한다 — 비밀번호 입력칸 placeholder가 `초기 비밀번호 1234`이고, 하단 안내문도 `초기 비밀번호는 1234입니다.`다. 회원 전화번호만 알면 비밀번호를 바꾸지 않은 계정에 로그인할 수 있다.
Evidence: 로그인 모달 (로그아웃 상태에서 헤더 `로그인` 클릭)
Repro:
  1. 로그아웃 상태로 `/` 진입
  2. 헤더 `로그인` 클릭 → 비밀번호 필드 placeholder와 하단 안내 문구 확인
Impact: 운영진 프로비저닝 모델상 의도된 온보딩 안내로 보이나, 초기 비밀번호 변경을 강제하지 않으면 전화번호만으로 계정 접근이 가능하다.
Recommendation: **인증 정책 사항이라 이번 점검에서 코드를 수정하지 않았다.** 최초 로그인 시 비밀번호 변경 유도 또는 안내 문구 노출 범위 조정을 검토할지 확인 필요.
Files: components/clubhouse.tsx:382
Status: Deferred (정책 결정 필요)

---

ID: UX-006
Severity: Low
Category: Performance
Page: 전 페이지
Role: member / manager
Component: 클라이언트 데이터 로딩
Problem: 어느 페이지로 진입하든 클라이언트가 앱 전체 데이터셋을 한 번에 가져온다. `/rankings` 단일 로드 기준 Supabase 요청 18건이 발생하며, 그중 8건이 조건 없는 `select=*` 전체 테이블 조회다.
Evidence: .ux-review/network-rankings.txt
Repro:
  1. `/rankings`로 직접 진입 (하드 내비게이션)
  2. DevTools Network에서 `supabase.co/rest/v1/*` 요청 수 확인
Measured: 18 requests. 무조건 조회 대상 — `profiles`, `fees`, `attendance`, `feedback`, `guest_players`, `participation_forms`, `event_guest_fees`, `event_mom_votes` (모두 `select=*`) + `events` 다단 중첩 조인 + RPC 4건
Impact: 회원 26명 규모에서는 체감 문제가 없고 응답도 모두 200이다. 다만 랭킹 화면을 보는 데 `feedback` 전체가 필요하지 않는 등 페이지와 무관한 데이터를 받는다. 데이터 증가 시 선형으로 악화된다.
Recommendation: 페이지별 필요 데이터로 쿼리를 분리하거나 서버 컴포넌트에서 필요한 컬럼만 선택한다. 즉시 조치 대상은 아니다.
Files: components/clubhouse.tsx (데이터 로딩부)
Status: Open

---

## 확인했으나 이슈로 잡지 않은 것 (오탐 / 정상)

- **detector `low-contrast` 4건** — `우리의 주말,`, `2026SEASON`, `팀 클럽하우스`는 gradient 텍스트(`background-clip:text`)라 detector가 1.0:1로 잘못 읽었다. 알파 합성까지 반영해 직접 계산한 결과 전 페이지 대비 실패 0건.
- **detector `slop` 계열 10건** (`cream-palette`, `kicker-above-heading`, `hero-eyebrow-chip`, `side-tab`, `dark-glow`) — 스포츠 클럽 에디토리얼 톤으로 일관되게 적용된 의도적 디자인. 취향 문제라 제외.
- **`/members` 장식 숫자 01~22 대비 1.15:1** — `aria-hidden="true"` 처리된 배경 장식.
- **`/feedback` 인트로 문단 우측 넘침 의심** — 실측 left 20 / right 371 / vw 390, 넘침 없음.
- **홈 GYUNGCHUNG FILM 배너 텍스트 잘림 의심** — 실측 padding 25px 정상 유지, 잘림 없음.
- **`응답 취소` disabled 버튼** — `disabled` 속성 + `opacity .65` + `cursor: not-allowed`로 구분됨.
- **`.admin-tabs` 가로 스크롤(14px)** — 내부가 모두 `button`이라 탭 포커스로 스크롤됨.

## 잘 되어 있는 부분

- console 에러/경고 **0건**, 네트워크 4xx/5xx **0건**
- 전 페이지·양 뷰포트에서 가로 스크롤 **0건**
- 모바일 드로어: `aria-expanded`/`aria-controls`, 포커스 이동, **Esc 닫힘 + 트리거로 포커스 복귀**, body 스크롤 락 전부 정상
- 모달: `role="dialog"` + `aria-modal` + `aria-label` 일관 적용, 닫기 버튼 44x44 `aria-label="닫기"`
- 아이콘 전용 버튼에 대상명을 포함한 `aria-label` (`김상혁 회원 정보 수정` 등)
- 폼 컨트롤 전부 `<label>` 연결, 설문은 `<fieldset><legend>` 사용
- 터치 타겟 44x44 준수 (`--tap` 토큰)
- 장식 요소 `aria-hidden` 처리, `본문 바로가기` 스킵 링크 제공
- 빈 상태에 아이콘 + 설명 + 다음 행동 안내 제공
