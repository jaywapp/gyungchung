# 푸시 알림 서버 작업

| 작업 | owner | model | effort | depends_on | parallel_group | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| 저장 계약·인증 조사 | 서버 담당 | inherited | high | 없음 | research | 완료 |
| RPC·바인딩·payload 협의 | 서버/모바일/root | inherited | high | 조사 | contract | 완료 |
| CLI migration·설정·outbox·권한 | 서버 담당 | inherited | high | 계약 | server | 완료 |
| 비활성 worker·receipt 처리 | 서버 담당 | inherited | high | 계약 | server | 완료 |
| 실제 격리 PostgreSQL/worker 회귀 | 서버 담당 | inherited | high | 구현 | verify | 완료 |
| lint·전체 test·production build | 서버 담당 | inherited | high | 구현 | verify | 완료 |
| 운영 DB/함수/시크릿/실제 발송 | root | inherited | high | 검증·별도 승인 | rollout | 미실행 |


검증 결과: lint·worker strict TypeScript·production build 통과, 전체 Node 테스트 159개 통과, 실제 격리 PostgreSQL 75개 assertion 통과. fixture 버전은 PostgreSQL 18.3/PGlite 0.5.8이며 운영 Supabase migration 통합 적용 검증과 실제 기기 발송은 별도 단계다.
