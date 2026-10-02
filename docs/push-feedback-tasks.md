# 푸시 피드백 서버 작업

| 작업 | owner | model | effort | depends_on | parallel_group | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| 기존 트리거·worker·운영 계약 분석 | 서버 developer | gpt-6-sol | medium | 없음 | analysis | 완료 |
| 변경 시점 스냅샷과 본인 수신 제외 마이그레이션 | 서버 developer | gpt-6-sol | high | 분석 | implementation | 완료 |
| worker 제목·본문과 선택적 display 구현 | 서버 developer | gpt-6-sol | medium | 설계 | implementation | 완료 |
| PGlite와 worker 회귀 검증 | 서버 developer | gpt-6-sol | high | 구현 | verification | 완료 |
| 운영 적용·배포·실기기 확인 | root/릴리스 담당 | inherited | high | 검증 | release | DB·worker 적용 완료, PR·웹·APK 배포 진행 |

## 통합 검증·운영 적용

- 2026-10-02: 최종 서버 Node 검사 166개, lint, Next.js 프로덕션 빌드 통과. worker 검사 18개에 긴 복합 일정 변경에서 시간·장소·새 주소 보존과 문구 공백·제어문자 정규화 회귀를 포함한다.
- 격리 PGlite 알림 계약 130개와 제보 접수 경로 계약 9개를 통과했다.
- 운영 migration `20261002003438` / `20261002003502` 적용 및 ledger 일치 확인. 로컬 파일명과 검사 참조를 실제 운영 버전에 맞췄다.
- `going_count`, 의견 변경 상세 스냅샷, 변경 대상 회원 제외 및 제보 nullable 컬럼·허용값을 운영 읽기 조회로 확인했다. 트리거·private 판정 함수의 anon/authenticated 실행 차단과 빈 search_path를 유지한다.
- worker v4 ACTIVE 배포 완료. 정상 운영 ON·기존 cutoff·발송/receipt Cron을 유지한다. 배포 후 익명 POST 401 및 자연 dispatch 00:36~00:39 UTC HTTP 200·오류 없음 확인. PR·웹/앱 배포는 별도 진행한다.
