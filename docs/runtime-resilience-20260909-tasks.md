# 작업 계획

orchestrator: Codex

| 작업 | owner | model | effort | depends_on | parallel_group | files | verification | status |
|---|---|---|---|---|---|---|---|---|
| 소스 및 경계 조사 | Codex | gpt-6-astra | high | 없음 | web-repos | 소스·기존 테스트 | 기존 동작 근거 확인 | completed |
| 확인된 개선 및 회귀 테스트 | Codex | gpt-6-astra | high | 조사 | web-repos | 아래 검증 결과 참조 | 기존 및 새 테스트 실행 | completed |

완료 표시는 아래에 명시한 변경과 로컬 회귀 검증 범위에 한정한다. 실제 외부 연동이나 모든 실행 환경을 검증했다는 뜻은 아니다.

저장소 간 작업은 루트의 Codex 에이전트와 병렬 수행한다. 이 담당 그룹은 추가 슬롯이 없어 순차 처리하며 같은 소스의 구현과 회귀 검증도 의존성이 있어 순차 진행한다.


루트 인계 검증(2026-09-09): lib/submission-history.ts: 응답 인덱스를 한 번 생성하여 중첩 옵션 탐색 제거, 필터 중간 배열 제거. lib/submission-history.test.mjs 2개 추가. 루트 원문 검토, lib/*.test.mjs 84/84 PASS. 프로덕션 빌드·DB·운영 배포 미검증.
