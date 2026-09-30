# A안 '매치 콘솔' 구현 — 설계

## 파일 구성

| 파일 | 역할 |
|---|---|
| `components/club-nav.tsx` | `ClubSidebar`(데스크톱), `ClubMobileBar`(상단 바), `ClubTabBar`(하단 탭), `MoreSheet`(더보기 시트) |
| `components/member-home.tsx` | 로그인 회원 홈: 인사말, 참석 콘솔, 모듈 격자 |
| `components/member-directory.tsx` | 포지션 필터 + 작은 회원 카드 목록, 운영진 '⋯' 메뉴 |
| `lib/member-directory.ts` | 이니셜, 포지션 분류, 정렬, 필터 개수 (순수 함수, 테스트) |
| `components/rsvp-controls.tsx` | `variant="console"` 추가: 큰 참석/불참 버튼과 응답 취소 |
| `components/theme-switch.tsx` | `compact` 표시(아이콘만, 사이드바용) |
| `components/clubhouse.tsx` | 셸 교체(topbar → 사이드바·모바일 바·탭 바), 홈 분기, 회원 목록 교체 |
| `app/globals.css` | 셸·콘솔·모듈·회원 카드·포지션 토큰 |

## 셸

- 901px 이상: `.shell`은 `grid-template-columns: 248px minmax(0,1fr)`이다. 사이드바는 sticky 100dvh이고, 본문 열에 알림 배너·main·footer가 들어간다.
- 900px 이하: 사이드바를 숨긴다. 상단 바(56px, sticky)와 하단 탭 바(fixed, safe-area)를 쓰고, main 아래에 탭 바 높이만큼 여백을 둔다. 토스트는 탭 바 위로 올린다.
- 사이드바 구성
  - 로고, 주 메뉴 5개, '클럽' 묶음, 운영진이면 '운영진·관리' 묶음
  - 아래쪽: 계정 버튼(로그인 전에는 로그인 버튼, 로그인 후에는 아바타·이름·포지션으로 마이페이지 열기), 테마 전환(아이콘형), 업데이트 노트·유튜브 링크
- 하단 탭: 홈·일정·회원·랭킹·더보기. 공지·회비·참여·의견·관리·업데이트 노트 화면에서는 '더보기'를 활성으로 표시한다.
- 더보기 시트
  - 공지 / 클럽(회비·참여·의견) / 운영진(관리) / 계정(마이페이지 또는 로그인, 화면 테마, 업데이트 노트, 유튜브)
  - `useDialogFocus`로 포커스를 가두고 Esc로 닫는다. 닫기 버튼은 1개이고, 경로가 바뀌면 닫힌다.
- 기존 `.topbar`, `.nav`, 햄버거, `.login-button`, `.youtube-link` 스타일은 제거한다.

## 로그인 회원 홈 (`user` 있음)

- 인사말: `{이름}님, {상대 날짜} 경기예요` (오늘 / 내일 / 이번 주 X요일 / M월 D일). 오른쪽에는 시작 시각 · 장소
- 콘솔(`.console`)
  - 날짜 블록: 월, 일(Archivo), 요일, D-n. 네이비 배경
  - 일정: 제목, 시간(시작 시각), 장소 + 네이버 지도 링크
  - 참석: `RsvpControls variant="console"`로 상태 문구, 참석(highlight)/불참(테두리) 버튼, 응답 취소 링크를 그린다.
  - 참석 줄: '참석 N / 정원 M명', '회원 a · 용병 g · r자리 남음', 정원 칸 막대(회원 칸은 `--brand`, 용병 칸은 `--brand` 55%, 빈칸은 `--line`), 참석 회원 얼굴 최대 6 + '+n', '명단 보기'(일정 상세)
  - 비로그인 홈은 기존 `Home`을 그대로 쓰므로 콘솔에는 로그인 상태가 들어오지 않는다.
- 모듈 격자(데스크톱 `1.35fr 1fr 1fr`, 영역 `notice fee poll / notice rank rank`, 1100px 이하 2열, 760px 이하 1열)
  - 공지: 최근 3건(첫 건만 본문 두 줄), 고정 배지
  - 내 회비: 미납 합계 또는 '미납 없음', 상태 배지, 안내, 회비 보기. 내역이 없으면 빈 상태 문구
  - 참여: 진행 중이고 마감 전인 첫 항목의 제목·마감, '참여하기'. 없으면 빈 상태 문구
  - 시즌 랭킹: `buildSeasonRankings` 득점·MVP 상위 3. 공동 순위는 T 표기

## 회원 목록

- 필터: 전체 / FW / MF / DF / GK / 무관(ANY와 미지정). 개수를 함께 표시하고 `aria-pressed`를 쓴다.
- 정렬: 회장 → 부회장 → 총무 → 관리자 → 시스템 관리자 → 가나다
- 카드: 등번호 배경 숫자(없으면 없음), 아바타(이름 뒤 두 글자, 포지션 색), 이름(본인은 '나'), 포지션 칩, 직책 배지, 'No. n · YYYY년 가입'
- 격자: `repeat(auto-fill, minmax(180px, 1fr))`. 390px에서 2열
- 운영진 '⋯': 정보 수정, 회원 강퇴(본인·시스템 관리자 제외, 위험 색, 기존 확인 대화상자)

## 포지션 토큰

- 라이트
  - FW: `--brand-soft` / `--brand`
  - MF: `#E5EFFB` / `#1F5FA8`
  - DF: `--neutral-bg` / `--neutral-ink`
  - GK: `--warn-bg` / `--warn-ink`
  - ANY: `--surface-sunken` / `--body` + 점선
- 다크는 MF만 `rgba(96,165,250,.16)` / `#93C5FD`이고, 나머지는 기존 토큰을 따른다. 모두 4.5:1 이상이다(시안 README).
