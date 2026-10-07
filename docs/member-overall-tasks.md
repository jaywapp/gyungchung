# 회원 오버롤 작업

작성일: 2026-10-07 · 브랜치 codex/member-overall · orchestrator Codex

| 작업 | owner | model | effort | depends_on | parallel_group | files | verification | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 요구사항·계약·통합 | root | 세션 기본 모델 | high | 사용자 요청 | plan | docs/member-overall-*.md, clubhouse 통합 | 제안 기준·권한/계정 경계 통합 | 완료 |
| DB 권한·저장·격리 검증 | overall_db | gpt-6.1-sol | high | 계약 | implementation | migrations, DB tests/scripts | SQL417+pgTAP197·root5·운영 적용 | 완료 |
| 능력치 도메인·육각형·회원 입력 | overall_ui | gpt-6.1-sol | high | 계약 | implementation | lib/member-overall.ts, component panels, 관련 tests | 실제 입력/그래프·P2 해결·UI21tests | 완료 |
| 팀 편성 참고·권한 콘솔 연결 | root | 세션 기본 모델 | high | 계약·UI | integration | admin-console/event-detail/permissions/clubhouse | 운영진만 선수/팀 평균, 기존 편성 보존 | 완료 |
| 독립 권한·기능 리뷰 | overall_review | gpt-6-astra | high | 구현·검증 | review | review 문서 | 15해시·검증 원문·P2 해결·ship | 완료 |
| 웹 검사·빌드·브라우저·PR·DB·배포 | root | 세션 기본 모델 | high | ship | release | 이번 웹 범위 | 361pass·build21·browser204·DB 완료/PR 운영 확인중 | 진행 |

사용 가능한 모델 중 구현은 gpt-6.1-sol, 독립 복잡 리뷰는 gpt-6-astra로 역할 기준을 대응한다. 기존 디자인의 기능 확장이므로 테마/레이아웃 재설계 콘셉트 선택은 하지 않는다. 스킬 context/detector는 이 대화에서 이미 실행한 결과를 재사용하며 반복하지 않는다.
