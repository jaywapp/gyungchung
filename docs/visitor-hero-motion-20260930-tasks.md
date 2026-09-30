# 방문자 히어로 모션(A안) 구현 — 작업

사용자가 독립 작업의 Codex 위임을 허용했다(2026-09-30). 저장소 규칙에 따라 Codex는 별도 작업 트리(`D:\station\.worktrees\gyungchung-hero-impl`)에서만 작업한다. 리더(Claude)는 설계·리뷰·화면 검증·PR을 맡는다.

| ID | 작업 | owner | model | effort | depends_on | parallel_group | 상태 |
|---|---|---|---|---|---|---|---|
| T1 | `components/hero-motion.tsx` + `.hero-motion*` CSS + `Home` 교체 | codex | gpt-6-sol | high | - | none | 위임 |
| T2 | 테스트 바인딩·순수 함수 테스트, 업데이트 노트 | codex | gpt-6-sol | medium | T1 | none | 위임 |
| T3 | 리뷰(diff), lint·tsc·test·build 재실행, 라이트·다크 × 1440·390 화면 확인 | leader | opus | medium | T1, T2 | none | todo |
| T4 | push, PR, (사용자 병합 후) 운영 배포 확인 | leader | opus | low | T3 | none | todo |
