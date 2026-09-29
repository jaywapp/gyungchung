# 테마 라이트·다크 적용과 UX 즉시 항목 — 설계

## 1. 폰트

- `pretendard` 패키지(v1.3.9, OFL)를 의존성으로 추가한다.
- `app/layout.tsx`에서 `pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css`를 import한다.
  Next가 CSS의 `url()`을 번들링해 woff2 92개 조각을 `/_next/static/media`로 자체 호스팅한다.
  브라우저는 화면에 나온 글자의 unicode-range 조각만 받는다.
- Archivo(`--font-display`)는 그대로 두되 적용 대상을 영문 대문자 라벨과 숫자로 좁힌다.
- 한글이 들어가는 라벨은 `font-family: var(--font-sans); font-weight: 600; letter-spacing: 0`으로 둔다.
  대상은 `.schedule-head`, `footer`, `.status`, `.admin-badge`, `.pin`, `.badge-new`, `.event-date small`,
  `.event-info > small`, `.notice-list time`, `.schedule-copy dt`, `.participation-copy small`,
  `.question-field legend small`, `.map-link small`, `.event-team > div span`, `.mom-candidates span`,
  `.event-team-badge`, 표 헤더 `th`, `.fee-standing-figure small`, `.fee-standing-facts dt`,
  `.fee-ledger-summary dt`, `.fee-entry-kind`, `.approval-banner span`이다.
- 숫자 표시(`.giant-number`, `.member-number`, `.event-date b`, `.schedule-date b` 등)에는 `tabular-nums`를 적용한다.

## 2. 색 토큰

`:root`에 라이트 값을 두고 `:root[data-theme="dark"]`에서 덮어쓴다. `color-scheme`도 모드별로 바꾼다.

| 토큰 | 라이트 | 다크 | 용도 |
|---|---|---|---|
| `--bg` | #F6F7F4 | #0B1622 | 페이지 배경 |
| `--surface` | #FFFFFF | #13212F | 카드·대화상자 |
| `--surface-sunken` | #F6F7F4 | #0F1C2A | 카드 안 보조 영역, 입력칸 |
| `--ink` | #0E1A26 | #E6EDF3 | 제목·강조 텍스트 |
| `--body` | #3F4B57 | #B4C2CF | 설명문 |
| `--muted` | #6B7784 | #8FA1B3 | 메타 정보 |
| `--line` | #E3E6E1 | #22324A | 테두리·구분선 |
| `--navy` | #0B1F33 | #0F1C2A | 로고·헤더·푸터·고정 패널 |
| `--navy-badge` | #0B1F33 | #22324A | 고정 배지·선택된 날짜 |
| `--on-navy` | #FFFFFF | #E6EDF3 | 네이비 위 글자 |
| `--pitch` | #124A33 | #0F2A1E | 다음 경기 카드 |
| `--pitch-line` | transparent | #1E4A34 | 다음 경기 카드 테두리 |
| `--brand` | #157A43 | #B8F27C | 링크·활성 메뉴·강조 텍스트·진행 막대 |
| `--brand-soft` | #E6F5EC | rgba(184,242,124,.12) | 활성 메뉴·아이콘 배경 |
| `--highlight` | #B8F27C | #B8F27C | 참석 버튼·D-day·선택 칩 |
| `--on-highlight` | #0B1F33 | #0B1F33 | 라임 위 글자 |
| `--primary` / `--on-primary` | #0B1F33 / #FFFFFF | #B8F27C / #0B1F33 | 주요 버튼·선택된 세그먼트 |
| `--danger` | #B42318 | #FF8A7A | 위험 동작 글자·아이콘 |
| `--shadow` | 0 1px 2px rgba(14,26,38,.06), 0 8px 24px rgba(14,26,38,.06) | none | 카드 입체감 |
| `--card-edge` | transparent | #22324A | 카드 1px 테두리 |

상태 색(`--ok-*`, `--warn-*`, `--danger-*`, `--neutral-*`, `--idle-*`, `--note-*`, `--disabled-*`, 스켈레톤)도 다크 값을 둔다.
다크 상태 배경은 반투명 색조로 두고, 글자는 밝은 색조로 4.5:1 이상을 맞춘다.

### 기존 토큰 치환 규칙

| 기존 | 새 토큰 | 비고 |
|---|---|---|
| `color: var(--navy)` | `var(--ink)` | 라임 배경 위 글자는 `--on-highlight` |
| `background: var(--navy)` (버튼·선택 상태) | `--primary` + `--on-primary` | |
| `background: var(--navy)` (헤더·푸터·패널) | `--navy` + `--on-navy` | |
| `background: var(--navy)` (배지) | `--navy-badge` + `--on-navy` | |
| `var(--green-text)` | `--brand` | |
| `var(--green)` (선·막대·테두리) | `--brand` | |
| `var(--green)` (배경 + 네이비 글자) | `--highlight` + `--on-highlight` | 라이트 `--brand`는 네이비 글자 대비가 부족 |
| `var(--lime)` | `--highlight` | |
| `var(--paper)` | `--bg`(페이지) / `--surface-sunken`(카드 안) / `--surface`(대화상자) | |
| `--shadow-block`, `--shadow-panel`, `Npx Npx 0` 오프셋 | `--shadow` 또는 없음 | |
| 하드코딩 rgba | `--topbar-bg`, `--overlay`, `--watermark`, `--index-ink`, `--brand-line`, `--warn-solid` | |

## 3. 형태

- 반경: 카드 16px(`--radius-card`), 대화상자 20px(`--radius-dialog`), 버튼·입력 12px(`--radius-control`), 배지·칩 999px(`--radius-pill`).
- 카드 상단 5px 강조선(`border-top: var(--accent-bar)`)과 카드 왼쪽 강조선을 없애고 `1px solid var(--card-edge)` + `--shadow`로 바꾼다.
- 상태 콜아웃(참석 상태, 정원, 미납 안내 등)의 왼쪽 선은 상태 신호이므로 유지하고 두께만 3px로 줄인다.
- 주요 버튼(`.cta`)은 그림자 없이 `--primary`로 채운다. `.cta.secondary`는 라임 채움, `.cta.danger`는 위험 색 채움이다.
- 참석/불참: 선택된 참석은 `--highlight` 채움, 불참은 테두리형이다.

## 4. 모드 전환

- 저장 키: `localStorage["gc-theme"]` = `light` | `dark` | `system`(기본).
- `app/layout.tsx`의 `<head>`에 동기 인라인 스크립트를 둬서 첫 페인트 전에 `data-theme`을 정한다(깜빡임 방지).
  `system`이면 `prefers-color-scheme`로 결정한다.
- `lib/theme.ts`: 모드 해석(`resolveTheme`), 저장값 검증(`parseThemePreference`), 인라인 스크립트 문자열을 둔다.
- `components/theme-switch.tsx`: 라이트·다크·시스템 3단 라디오 그룹. `system`을 고르면 `matchMedia` 변경을 구독한다.
  저장 실패(사생활 보호 모드 등)는 조용히 무시하고 현재 세션에만 적용한다.
- 위치: `AccountModal`, `UnlinkedAccountModal`(프로필 메뉴 역할). 비로그인 방문자는 시스템 설정을 따른다.

## 5. 컴포넌트 변경

- `participation-hub.tsx`
  - `isParticipationClosed(form, now)`: `status === "closed"` 또는 `ends_at <= now`.
  - 배지: 마감이면 `… · 마감`, 카드에 `closed` 클래스를 붙인다.
  - 버튼: 마감이면 '참여하기'를 숨긴다. `status === "closed" && show_results`일 때만 '결과 보기'를 보인다.
    이미 제출했으면 '내 응답 보기'는 유지한다.
  - `formatDeadline`: 지난 마감은 `9. 8. (월) 23:59 마감됨`처럼 한 번만 쓴다.
  - 흐림은 opacity 대신 배경(`--surface-sunken`)과 그림자 제거로 처리한다(본문 대비 유지, 기존 `.event-card.past` 규칙과 같다).
- `clubhouse.tsx` `Members`: 수정 버튼은 그대로 두고, 강퇴를 `<details>` 기반 '⋯' 메뉴(`event-management-menu` 패턴 재사용) 안의
  위험 색 메뉴 항목으로 옮긴다. 항목을 누르면 기존 `ConfirmDialog` 확인 단계를 거친다.
- `feedback-hub.tsx`: 페이지 제목 '사용자 제보' → '의견'.
- 링크: 기본 `a { color: var(--brand) }`를 두고 `.event-card-schedule a`, `.inline-map-link`에 `--brand`를 쓴다.
