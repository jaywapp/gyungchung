# 운영 화면 UI 피드백 4건 — 작업

1–4번이 모두 `app/globals.css`와 `components/*`를 함께 고쳐서, 병렬 위임 없이 리더 세션이 순서대로 처리한다.

| ID | 작업 | owner | model | effort | depends_on | parallel_group | 상태 |
|---|---|---|---|---|---|---|---|
| T1 | 참석 인원 박스 전체 너비 | leader | opus | low | - | none | done |
| T2 | 회비 규칙 상수화와 배지 | leader | opus | low | - | none | done |
| T3 | AI 답변 라벨, 링크 배지 분리 | leader | opus | low | - | none | done |
| T4 | 노트 출처 필드·배지·테스트, key 중복 수정, #164와 이번 PR 노트 | leader | opus | medium | 설계 승인(A안) | none | done |
| T5 | AGENTS.md 노트 작성 규칙 | leader | opus | low | T4 | none | done |
| T6 | 검증: lint·test·tsc·build, 라이트·다크 × 1440·390 | leader | opus | medium | T1–T5 | none | done |
