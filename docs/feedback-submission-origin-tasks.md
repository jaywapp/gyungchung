# 제보 접수 경로 기록 작업

| 작업 | owner | model | effort | depends_on | parallel_group | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| 기존 쓰기·공개·발행 계약 확인 | developer | gpt-6-sol | high | 없음 | A | 완료 |
| nullable 출처 마이그레이션과 격리 DB 검증 | developer | gpt-6-sol | high | 계약 확인 | B | 완료 |
| 웹·앱 새 제출 payload와 타입·앱 회귀 검사 | developer | gpt-6-sol | high | 계약 확인 | B | 완료 |
| 변경 범위 검사와 배포 순서 인계 | developer | gpt-6-sol | high | 앞의 두 구현 | C | 완료 |

운영 DB 적용·웹 배포·앱 배포는 통합 담당자가 순서대로 수행한다. 로컬 검사로 운영 DB 적용 여부를 완료 처리하지 않는다.

통합 단계에서 2026-10-02 운영 migration `20261002003502` 적용과 nullable/default 없음/허용값을 확인했다. 기존 제보는 백필하지 않았다. 새 웹·앱 클라이언트 배포는 진행 중이다.

로컬 검증: PGlite 9개 검사, 앱 제보 계약 6개, 앱 TypeScript·ESLint, 웹 Node 검사 164개·ESLint·프로덕션 빌드가 통과했다. 앱 전체 빌드와 운영 DB 적용은 이 작업에서 확인하지 않았다.
