# 방문자 히어로 모션(A안) 구현 — 설계

## 구조

- `components/hero-motion.tsx` (`"use client"`)
  - 렌더링: `<h1 className="sr-only">우리의 주말, 우리의 풋살.</h1>`과 `aria-hidden` 모션 영역
  - 모션 영역: 코트 SVG, 슬로건 두 줄의 글자 span, 공 궤적 SVG(trail, kick, ball)
  - 둘째 줄('우리의 풋살')은 기존처럼 `--brand` 색이고, 마침표는 공이 된다.
- `components/clubhouse.tsx`의 `Home`: 기존 `<h1>…</h1>` 자리에 `<HeroMotion />`을 넣는다. eyebrow, lead-row, hero-actions, fixture-side는 그대로 둔다.
- 스타일: `app/globals.css`의 'Home — hero' 섹션에 `.hero-motion*` 규칙을 둔다.
  - 기존 `.hero h1` 규칙에서 크기, 줄 간격, 자간(모바일 clamp 포함)을 가져와 같은 크기로 보이게 한다.
  - 색은 기존 토큰만 쓴다: 코트 라인 `--line`, 궤적 `--brand`(투명도), 공 `--ink`/`--brand`

## 모션 (시안 A의 시퀀스를 그대로 옮긴다)

- 0–1.3초: 코트 라인이 그려진다(stroke-dashoffset).
- 0.25초: 첫 줄이 떠오른다.
- 1.0초: 킥
- 1.0–2.0초: 로브
- 2.0–2.95초: 공이 굴러가며 둘째 줄 글자가 차례로 떠오른다.
- 약 3.5초: 마침표에 안착
- 약 4.2초: 궤적이 옅어지고 끝난다.
- 재생 방식
  - Web Animations API로 모든 애니메이션을 한곳에서 관리한다.
  - 좌표는 실제 글자 위치를 측정해 계산한다(ResizeObserver로 폭이 바뀌면 다시 계산하고, 재생이 끝난 뒤에는 완성 상태로 다시 그린다).
  - IntersectionObserver와 `visibilitychange`로 일시 정지하고 재개한다.
  - `matchMedia("(prefers-reduced-motion: reduce)")`이면 애니메이션 없이 완성 상태를 그리고, 설정 변경에도 반응한다.
  - 움직이는 속성은 transform, opacity, stroke-dashoffset로 한정한다.
- 서버 렌더링: 첫 HTML에는 글자가 보이는 완성 상태를 출력하고, 클라이언트에서 모션이 준비되면 초기 상태로 되돌려 재생한다(JS 없이도 슬로건이 보인다).
- 언마운트되면 애니메이션과 관찰자를 모두 정리한다.

## 테스트

- `lib/home-ux.test.mjs`: `loadFunctions` 바인딩에 `HeroMotion` 스텁을 추가한다. 기존 단언은 유지한다.
- 좌표 계산 같은 순수 함수가 있으면 `lib/hero-motion.ts`로 분리하고 `lib/hero-motion.test.mjs`로 검증한다(기존 `*.test.mjs` 패턴: typescript `transpileModule`).

## 업데이트 노트

- `lib/update-notes.ts` 맨 앞에 항목을 추가한다.
  - `id: "2026-09-30-visitor-hero-motion"`, `date: "2026-09-30"`, `source: "request"`, `pullRequests: []`
  - 문구: 방문자 첫 화면의 슬로건이 공의 궤적을 따라 나타나고, 움직임 줄이기 설정에서는 정지 화면으로 보인다는 내용
