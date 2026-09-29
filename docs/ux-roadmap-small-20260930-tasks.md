# UX 로드맵 남은 항목(소규모) — 작업

소규모 항목은 모두 `app/globals.css`와 `components/clubhouse.tsx`를 함께 고쳐서 리더가 순서대로 처리한다.
콘셉트 3종은 파일이 겹치지 않아 designer 서브에이전트에게 별도 작업 트리로 병렬 위임했다.

| ID | 작업 | owner | model | effort | depends_on | parallel_group | 상태 |
|---|---|---|---|---|---|---|---|
| T1 | 로그아웃 테두리형 | leader | opus | low | - | A | done |
| T2 | 홈 회비·페어플레이어 빈 상태 | leader | opus | low | - | A | done |
| T3 | 랭킹 T1·이름 강조·3열 | leader | opus | low | - | A | done |
| T4 | 타이포 스케일 | leader | opus | medium | - | A | done |
| T5 | 의견 목록 접기·더 보기·sticky 폼 | leader | opus | medium | - | A | done |
| T6 | 세로선 제거, 관리 탭·배지, 회비 헤더 | leader | opus | low | - | A | done |
| T7 | 업데이트 노트, 검증 | leader | opus | low | T1–T6 | A | done |
| C1 | 홈 히어로·내비·회원 목록 콘셉트 3종 | designer | opus | high | - | B | 진행 중 |
| C2 | 선택된 콘셉트 구현 | 미정 | - | high | C1 + 사용자 선택 | - | blocked(사용자 선택 대기) |
