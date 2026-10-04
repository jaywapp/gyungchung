# 총무 회비 저장 오류 작업

| 작업 | owner | model | effort | depends_on | parallel_group | 상태 |
|---|---|---|---|---|---|---|
| 운영 로그·실제 권한·RLS 원인 확인 | root | GPT | high | 제보 | investigation | completed |
| 최소 조회·목록 호환 마이그레이션 | root | GPT | high | 원인 확인 | implementation | completed |
| 격리 DB 재현·권한 회귀 검사 | root | GPT | high | 마이그레이션 | verification | completed |
| 웹 테스트·lint·production build | root | GPT | high | 구현 | verification | completed |
| 운영 마이그레이션·PR·배포·확인 | root | GPT | high | 검증 | delivery | pending |

SQL 및 배포는 의존 순서로 진행한다. 실제 회원의 회비·직책·권한 값은 변경하지 않는다.

검증: PGlite 격리 DB에서 기존 총무 저장 실패를 재현하고 수정 후 51개 권한·회비 검사를 통과했다. DB 검토에서 새 마이그레이션의 Critical/High/Medium 결함은 발견되지 않았으며 반환형 변경을 막는 운영 DB 의존성도 없다.

웹 검증: 223개 검사 중 222개 통과, 기존 네트워크 제외 fixture 1개 skip. ESLint와 Next production build 통과. 운영 마이그레이션 20261004161934 적용과 반환형·invoker 경계를 확인했으며 적용 전후 보안 advisor 신규 항목은 없다.
