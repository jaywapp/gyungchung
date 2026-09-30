# 방문자 히어로 모션(A안) 구현 — 작업

사용자가 독립 작업의 Codex 위임을 허용했다(2026-09-30). 저장소 규칙에 따라 Codex는 별도 작업 트리(`D:\station\.worktrees\gyungchung-hero-impl`)에서만 작업한다. 리더(Claude)는 설계·리뷰·화면 검증·PR을 맡는다.

| ID | 작업 | owner | model | effort | depends_on | parallel_group | 상태 |
|---|---|---|---|---|---|---|---|
| T1 | `components/hero-motion.tsx` + `.hero-motion*` CSS + `Home` 교체 | leader | opus | high | - | none | done |
| T2 | 테스트 바인딩·순수 함수 테스트, 업데이트 노트, WEEKLY SUNDAY | leader | opus | medium | T1 | none | done |
| T3 | lint·tsc·test·build, 라이트·다크 × 1440·390, 움직임 줄이기 확인 | leader | opus | medium | T1, T2 | none | done |
| T4 | push, PR, (사용자 병합 후) 운영 배포 확인 | leader | opus | low | T3 | none | todo |

## 경과

- Codex(gpt-6-sol, gpt-6.1-sol) 위임은 두 번 모두 로컬 Codex 샌드박스 권한 오류(`helper_sandbox_lock_failed`, `C:\Users\jaywa\.codex\.sandbox-bin` ACL 접근 거부)로 시작하지 못했다. 파일 변경은 없었다.
- 사용자 지시("직접해")에 따라 리더가 구현했다.
