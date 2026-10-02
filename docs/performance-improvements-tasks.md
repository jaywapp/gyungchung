# 성능 개선 작업

| 작업 | owner | model | effort | depends_on | parallel_group | 상태 |
|---|---|---|---|---|---|---|
| EventCard 팀 명단 보기 Link·웹 날짜/관리 계산·리소스 갱신 | web_ui_performance | inherited GPT | high | 계획 | implementation | 완료 |
| 앱 날짜/계산·재조회 병합·부분 갱신 | mobile_performance | inherited GPT | high | 계획 | implementation | 완료 |
| 업데이트 metadata 제한 병렬화·회귀 | web_data_performance | inherited GPT | high | 계획 | implementation | 완료 |
| APK shrink 설정·문서·통합 | root | inherited GPT | high | 계획 | implementation | 완료 |
| 전체 회귀 테스트·브라우저 검증·교차 리뷰·벤치마크 | root + reviewers | inherited GPT | high | 구현 | verification | 완료 |
| 최종 웹 타입 검사·린트·production build | root | inherited GPT | high | 구현·회귀 검증 | verification | 완료 |
| 외부 PR·main 병합 | root | inherited GPT | high | 최종 검사 | delivery | 진행 예정 |
| Vercel main 운영 배포·운영 검증 | root | inherited GPT | high | main 병합 | delivery | 진행 예정 |
| Supabase mobile-updates 별도 배포·운영 검증 | root | inherited GPT | high | 최종 검사 | delivery | 진행 예정 |

Claude 모델은 이 세션 도구에 제공되지 않아 현재 GPT 모델을 사용한다. 팀원은 커밋·push·PR·배포를 수행하지 않는다.

## 검증 완료 기록

- 웹 전체 테스트 223개 중 222개 통과, 기존 fixture 검사 1개 skip. 최종 타입 검사·린트·production build 통과.
- 독립 검토 High/Medium 모두 해결. 초기 skeleton 경합, 저장 중 RSVP overlay, 계정 전환 데이터/편집 상태 격리와 동일 owner 토큰 갱신 보존을 회귀 검증했다.
- 데스크톱·모바일 초기 조회는 데이터 18개·알림 설정 1개. 일반 일정 이동과 EventCard 팀 명단 보기 NextLink 이동의 추가 query·document 요청은 각각 0개이고 오류·overflow도 없었다.
- 합성 CPU·모의 RTT와 운영/실기기 검증을 구분해 [검증 기록](performance-improvements-validation.md)에 남겼다. APK 최종 크기·설치·출시 상태는 모바일 저장소의 docs/performance-improvements-validation.md를 따른다.
