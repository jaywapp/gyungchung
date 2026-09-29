# 운영 화면 UI 피드백 4건 — 설계

## 1. 참석 인원 박스

- `.capacity-status`를 `display: flex; width: 100%`로 바꾼다. 컴포넌트를 쓰는 모든 곳이 부모 너비를 채운다.
- 홈 히어로 다음 일정 카드: 박스가 줄바꿈되는 flex 행(`.schedule-foot > div`) 안에 있어서, 참석·용병 수 아래 줄을 꽉 채운다. 어색하지 않아서 함께 적용한다.

## 2. 회비 규칙

- `lib/fee-rules.ts`: `FEE_AMOUNTS`(관리자 월·일반 월·참여), `formatWon`, `feeRuleBadges`를 둔다.
- `clubhouse.tsx`의 `feePlan`과 `admin-console.tsx`의 기본 금액·선택지·안내문이 이 상수를 쓴다.
- `PageIntro`가 `children`을 받아 설명 아래에 배지 줄(`.fee-rule-badges`)을 그린다. 운영진 화면에서만 보인다.

## 3. AI 답변과 링크 배지

- `lib/response-links.ts`의 `splitResponseLinks(text)`가 렌더링용으로 본문과 링크를 나눈다.
  - 맨 URL은 본문에서 빼고, 괄호나 끝의 ':'처럼 남는 부분도 정리한다. 마크다운 링크는 글자만 본문에 남긴다.
  - 같은 URL은 배지 하나로 합친다. GitHub 이슈·PR은 'GitHub Issue #N' / 'GitHub PR #N'로, 그 외는 호스트와 경로로 표시한다.
- 카드 상단 이슈와 같은 URL은 답변 배지에서 뺀다(중복 방지).
- 라벨은 'AI 답변'. 배지는 `github-issue-link` 스타일을 재사용한다.

## 4. 업데이트 노트 출처(A안)

- `UpdateNote`에 `id`(고유 key)와 `source: "feedback" | "request"`를 추가한다. 라벨은 `updateSourceLabels`에 둔다.
- `/updates`는 `note.id`를 key로 쓰고(중복 경고 해결), 제목 위에 출처 배지를 표시한다.
  - 제보: `--warn-bg`/`--warn-ink`
  - 직접 요청: `--navy-badge`/`--on-navy`
  - 대비는 라이트 7.31·16.69, 다크 10.99·10.95다.
- PR 번호가 없는 노트는 '변경 기록' 링크 줄을 숨긴다.
- `lib/update-notes.test.mjs`: 고유 id, 유효 source, 날짜 형식, 양수 PR 번호를 검사한다.
- `AGENTS.md`: 사용자에게 보이는 변경 PR은 같은 PR에서 노트를 추가한다는 규칙을 둔다.
- 노트 추가: PR #164(라이트·다크 테마) 1건, 이번 PR 1건. 둘 다 `request`다.
