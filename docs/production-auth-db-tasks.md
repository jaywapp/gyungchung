# 운영 인증·DB 검증 작업

orchestrator: Codex

| 작업 | owner | model | effort | depends_on | parallel_group | verification | status |
|---|---|---|---|---|---|---|---|
| 실제 운영 경계 조회 | Codex | gpt-6-astra | high | 없음 | sequential | HTTP9개·read-only SQL | completed |
| 최소 권한 수정 설계 | Codex | gpt-6-astra | high | 실제 검증 | sequential | 기존 회원계약·SQL | completed |
| 회귀·정책 검증 | Codex | gpt-6-astra | high | 설계·부모리뷰 | sequential | 운영SQL 4조건·95개/test/lint/build | completed |
| PR 및 운영 재검증 | Codex | gpt-6-astra | high | 회귀 | sequential | checks·운영응답 | pending |

같은 함수·운영 정책은 순차 처리한다. 운영 개인정보 행은 출력하지 않는다.

## 실행 결과

- 읽기 전용 SQL 4조건과 변경 전후 결과 보존을 확인했다. 사용자 데이터 INSERT/UPDATE/DELETE는 없었다.
- 리뷰한 migration을 적용하고 이력과 로컬 파일명을 일치시켰다. 적용 후 읽기 전용 재검증도 통과했다.
- scripts/verify-member-directory.sql은 개인정보 대신 boolean만 반환한다. Auth 비밀번호 인증을 대신 검증하지 않는다.
- npm test 95개, npm run lint, npm run build 통과. 새 pgTAP 회귀5개 및 기존 fixture를 보강했지만 로컬 DB 실행 환경 부재로 fixture SQL 파일은 미실행이다. 운영에는 fixture 데이터를 생성하지 않았다.
- 실제 비밀번호 로그인·브라우저 세션 갱신·역할별 UI E2E는 환경 제약으로 미검증이다. 모든 쓰기 정책의 전수 검증을 완료했다는 뜻은 아니다.
