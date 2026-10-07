# 믹스트존 작업 계획

orchestrator: Codex. 최신 사용자 지시로 웹과 모바일 구현·배포 진행 중.

| 작업 | owner | model | effort | depends_on | parallel_group | verification | status |
|---|---|---|---|---|---|---|---|
| 기존 계약 조사·권장 기본 정책 확정 | root | gpt-6.1-sol | high | 없음 | 설계 | 사용자 요청과 기존 출석·POTM·오버롤 대조 | 완료 |
| 비공개 평가·집계·RPC·실제 PG | mixed_zone_db | gpt-6.1-sol | high | 설계 | 구현 | 자격·마감·CAS·집계·이력·잠금 | 완료 |
| 일정 평가 UI·운영진 집계 그래프 | mixed_zone_web | gpt-6.1-sol | high | 설계·RPC 계약 | 구현 | 입력·조회·0값·권한·오류·접근성 | 완료 |
| 기간 편집·앱 계약·웹 노트·통합 | root | gpt-6.1-sol | high | 설계 | 구현 | 반복 일정과 API 선택·캐시 경계 | 완료 |
| 웹 전체 변경 모바일 대응 | mixed_zone_mobile | gpt-6.1-sol | high | 설계·웹 기준·RPC 계약 | 구현 | 회원 메뉴/연락처·집계·믹스트존·권한·기존 기능 | 완료 |
| 전체 검사·화면 QA·독립 리뷰 | root/reviewer | gpt-6-astra | high | 구현 | 검증 | 실제PG·전체 회귀·웹 build·Android export·SHIP | 완료 |
| DB 운영 반영·웹 PR 병합·배포 | root | gpt-6.1-sol | high | 검증 | 웹 출시 | 동일 SQL·이력·READY·HTTP·오류 로그 | 완료 · PR195/운영 READY |
| 앱 PR 병합·서명 APK 발행 확인 | root | gpt-6.1-sol | high | 웹 출시·앱 검증 | 앱 출시 | CI 설치·서명·버전·익명 APK/manifest | 모바일 인계 · PR18/실행19 |
