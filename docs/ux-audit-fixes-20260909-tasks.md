# UX/UI 점검 보완 작업

orchestrator: Codex

| 작업 | owner | model | effort | depends_on | parallel_group | verification | status |
|---|---|---|---|---|---|---|---|
| 요구·규칙·기준 확인 | Codex | gpt-6-astra | high | 없음 | 준비 | 최신 main·코드 근거 확인 | completed |
| 홈 상태·문의 안내·모바일 보완 | Codex | gpt-6-astra | high | 준비 | 구현 | 회귀 검사·브라우저 | completed |
| 일정 관리 키보드 보완 | Codex | gpt-6-astra | high | 준비 | 구현 | 키보드 검사·타입 검사 | completed |
| 통합 검증·리뷰 | Codex | gpt-6-astra | high | 구현 | 검증 | 테스트·lint·build·브라우저 | completed |
| PR·병합·운영 확인 | Codex | gpt-6-astra | high | 검증 | 배포 | 필수 검사·배포·운영 응답 | in_progress |

일정 관리 파일은 독립되어 Codex 하위 에이전트가 담당한다. 홈 상태와 문의 안내는 같은 컴포넌트를 공유하므로 메인이 순차 수정한다.

## 로컬 검증 결과
- npm test: 92/92 통과. 새 테스트 4개가 실제 Home/미연결 모달 선언을 렌더링하여 로딩·오류·빈 상태와 잘못된 문의 링크 제거를 확인한다.
- npm run lint, npm run build, git diff --check 통과.
- 390×844 및 320×740: 제목 2줄, 가로 넘침 없음. 390px에서 다음 일정 영역 시작 위치가 약 605px로 첫 화면 안에 들어온다.
- 로컬 임시 fixture로 실제 EventDetail을 렌더링하여 ArrowDown 첫 항목, ArrowUp 마지막 항목, 방향키 이동, Home 첫 항목, Escape 복원, Tab 다음 버튼 이동을 확인했다. fixture 파일은 제거했다.
- 실제 운영 데이터 변경이나 테스트 계정 생성은 수행하지 않았다. 정상 인증·DB 요청은 현재 브라우저 환경의 연결 실패 때문에 검증 범위 밖이다.
- 디자인 detector 경고 5건은 수정 전과 동일한 기존 테두리/진행 막대 CSS다. 이번 국소 변경에서 새 경고는 없다. 기존 브랜드 장식은 유지한다.
