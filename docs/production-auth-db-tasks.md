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

- 운영 transaction에서 함수 정의 교체 후 정상 목록 유지·숨김 계정 제외·익명 거절·미연결 거절 4조건 통과. ROLLBACK 후 원래 정의로 복원됨을 확인했다. 운영 사용자 데이터 INSERT/UPDATE/DELETE는 없었다.
- 부모 SQL 리뷰 후 동일 migration을 정식 적용했다. 원격 이력 version 20260909083249와 로컬 파일명을 일치시켰다. 적용 후 read-only SQL에서 미연결 목록0/관리권한없음, 연결회원 목록유지/숨김제외/익명거절을 재확인했다.
- scripts/verify-member-directory.sql은 기존 숨김 테스트 계정의 실제 권한을 사용하는 읽기 전용 재현 스크립트다. 이름·연락처·식별자 대신 결과 boolean만 반환한다. Auth 비밀번호 인증을 대신 검증하는 스크립트는 아니다.
- npm test 95개, npm run lint, npm run build 통과. 새 pgTAP 회귀5개 및 기존 숨김fixture의 실제 Auth연결을 보강했다. Docker·supabase/config.toml·운영 pgTAP가 없어 이 fixture SQL 파일들은 실행하지 않았다. 운영에는 fixture 데이터를 생성하지 않았다.
- Supabase advisor는 변경 전후 동일: authenticated SECURITY DEFINER 6개 경고, leaked-password protection 비활성 경고1개. 디렉터리의 제한 필드 반환용 definer는 기존 의도이며 이번 연결검사를 추가했다. 별도 Auth설정과 다른 함수 권한은 변경하지 않았다.
- HTTP: Auth설정·공개공지200, 무인증 user/profiles/directory/adminRPC/provisioning401, 잘못된Bearer401, 잘못된phone password grant400. Auth phone활성, disable_signup=false는 확인했으나 신규가입·SMS·메일 발송은 실행하지 않았다.
- 실제 테스트 계정 비밀번호 로그인·브라우저 세션 갱신·역할별 UI E2E는 자격증명 부재로 미검증이다. RLS25개 활성 확인은 각 쓰기 정책의 전수 실행 검증을 뜻하지 않는다.
