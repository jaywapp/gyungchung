# A안 '매치 콘솔' 구현 — 작업

셸 교체가 `clubhouse.tsx`와 `globals.css`를 모든 작업과 공유해서 병렬 위임하지 않고 리더가 순서대로 처리한다.

| ID | 작업 | owner | model | effort | depends_on | parallel_group | 상태 |
|---|---|---|---|---|---|---|---|
| T1 | `lib/member-directory.ts` + 테스트 | leader | opus | low | - | none | done |
| T2 | `RsvpControls` console 변형, `ThemeSwitch` compact | leader | opus | low | - | none | done |
| T3 | `club-nav.tsx` + 셸 교체 + CSS | leader | opus | high | T2 | none | done |
| T4 | `member-home.tsx` + 콘솔·모듈 CSS | leader | opus | high | T2 | none | done |
| T5 | `member-directory.tsx` + 회원 CSS | leader | opus | medium | T1 | none | done |
| T6 | 업데이트 노트, 검증(lint·tsc·test·build, 라이트·다크 × 1440·1100·390) | leader | opus | medium | T3–T5 | none | done |
| F1 | 방문자 히어로 모션 그래픽 시안 | 미정 | - | - | T6 | - | 다음 단계 |
