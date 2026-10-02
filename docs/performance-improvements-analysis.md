# 성능 개선 분석

- 작성일: 2026-10-03
- 사용자 승인: 세 프로젝트 성능 검토 후 개선 작업 진행 요청.
- 목적: 저장·복귀의 중복 네트워크, 날짜 집계 CPU, 업데이트 확인 대기와 APK 크기를 줄인다.
- 보존 계약: 인증/RLS·계정 전환·낙관 갱신·실패 상태·정렬/동순위·현재 탐색/편집 상태·기존 설치 앱 업데이트 계약.
- 범위: 안전하게 검증 가능한 리소스별 갱신, 진행 중 요청 병합, 고정 날짜 포맷터 재사용/메모화, 내부 Link, 반복 ID 탐색 인덱스, 업데이트 metadata 제한 병렬화, 네이티브 release 축소 설정의 실빌드 평가.
- 조건부 후속: 첫 화면 로딩 경계 재설계·화면 목록 가상화·푸시/설문 DB 동시성·ABI별 배포·이어받기는 실기기/운영 계측과 호환 설계가 필요한 별도 단계다. 현행 일괄 선행 로딩은 승인 ADR을 따른다.
- 기준선: Windows Node22 합성 입력 이벤트200/출석3000 랭킹~10ms, 이벤트1000/출석15000~50ms. metadata6 releases25 outbound requests,20 releases81. warm cache 추가0. 로컬 APK4 ABI native64.4MB.

## 구현과 검증 결과

- 웹 리소스별 갱신·요청 병합·계정 격리, 날짜/랭킹/관리 계산 재사용, 업데이트 metadata 제한 병렬화와 앱의 계산·갱신 개선을 구현했다. 내부 링크 변경 대상은 EventCard(일정 카드)의 **팀 명단 보기** 링크다.
- 웹 전체 테스트 223개 중 222개 통과, 기존 fixture 검사 1개 skip. 최종 타입 검사·린트·production build는 모두 통과했다. 독립 검토의 High/Medium 사항은 모두 해결했다.
- 데스크톱·모바일 브라우저에서 초기 데이터 18개와 알림 설정 1개 조회를 확인했다. 일반 일정 이동과 EventCard의 팀 명단 보기 NextLink 이동은 추가 데이터 query·document 요청이 각각 0개이고 오류·overflow도 없었다. 모의 백엔드 결과이며 운영 데이터 쓰기는 하지 않았다.
- 합성 CPU·모의 RTT 전후 수치와 계정 전환 회귀는 [검증 기록](performance-improvements-validation.md)에 정리했다. 모바일 실빌드/설치 범위는 모바일 저장소의 docs/performance-improvements-validation.md를 따른다.
- 외부 PR·main 병합과 Vercel 운영 배포, 별도 Supabase mobile-updates 배포 및 운영 검증은 진행 예정이다.
