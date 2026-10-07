# 오버롤 기본 그래프와 0점 기준 작업

orchestrator: Codex

| 작업 | owner | model | effort | depends_on | parallel_group | files | verification | status |
|---|---|---|---|---|---|---|---|---|
| 분석·설계·UI·클라이언트 | Codex | gpt-6.1-sol | high | 없음 | 구현 | member-overall-panel.tsx, member-overall.ts, 관련 JS 검사, update-notes.ts, 본 문서 | 기본 그래프·명시적 편집·0점·취소 회귀 33검사 통과 | 완료 |
| DB 마이그레이션·실제 격리 검증 | Codex | gpt-6.1-sol | high | 설계 | 구현 | 새 migration, member_overalls SQL tests, verify-member-overall.mjs | SQL460·pgTAP208 총668 통과 | 완료 |
| 웹 검사·빌드·브라우저 | Codex | gpt-6.1-sol | high | UI·클라이언트 | 검증 | 로컬 검증 산출물 | 웹363pass/기존skip1·TypeScript·lint 오류0·21/21빌드·브라우저434검사 통과 | 완료 |
| 독립 마무리 리뷰 | Codex | gpt-6-astra | high | 구현·검증 | 리뷰 | 읽기 전용 소스·SQL·결과·스크린샷 | SHIP·P1/P2 없음·8sourcehash와현재이미지 확인 | 완료 |
| 운영 DB·PR·병합·웹 배포 | Codex | gpt-6.1-sol | high | 검증·리뷰 | 배포 | 명시적 요청 범위 | DB 적용은 자동 승인 거부로 사용자 승인 대기, PR 준비 | 승인 대기 |

UI와 DB는 소유 파일이 달라 병렬 진행한다. 기존 위키 푸시 승인 대기와 앱 변경은 이 작업에서 진행하지 않는다.
