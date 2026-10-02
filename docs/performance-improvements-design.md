# 성능 개선 설계

## 갱신과 계정 격리

초기 모든 리소스 로드와 명시적 전체 새로고침은 유지한다. 저장은 트리거의 파생 데이터까지 포함한 리소스 집합을 무효화한다. 동일 owner와 리소스의 진행 중 읽기는 공유한다. 읽기 중 저장이 완료되면 강제 후속 갱신을 예약해 저장 이전 응답을 최신으로 오인하지 않는다. 계정 전환·언마운트 시 요청을 취소하고 이전 owner 결과를 반영하지 않는다. 오류는 해당 리소스에 유지하고 사용자 명시 재시도는 생략하지 않는다.

초기 skeleton의 완료는 전체 초기 조회 그룹에 맡기며 좁은 배경 조회는 loading을 해제하지 않는다. identity 변경 콜백에서 회원·공개 데이터 배열 17개와 이전 owner의 편집/우승/삭제/강퇴 dialog 4개를 즉시 비우고 프로필 source와 RSVP pending refs를 초기화한다. 동일 owner의 토큰 갱신은 기존 데이터와 편집 상태를 유지한다. 진행 중 RSVP는 낙관 overlay로 늦은 읽기를 방어한다. 이 경합과 계정 격리의 구현 및 회귀 검증을 완료했다.

## 계산과 렌더

고정 locale/timezone/options의 Intl formatter를 재사용한다. 행별 반복 find/filter는 ID Map으로 대체한다. 배열 변경을 기준으로 달력/랭킹을 메모화한다. 탐색·스크롤·편집·초안 상태는 유지하며 화면 구성과 디자인은 바꾸지 않는다. EventCard(일정 카드)의 **팀 명단 보기** 링크를 NextLink로 전환하고 일반 일정 이동과 함께 추가 query·document 요청 없이 이동하는 것을 데스크톱·모바일에서 확인했다.

## 업데이트와 빌드

릴리스 검증은 기존 strict URL·manifest·hash·size·version·중복 코드 검사를 유지하고 작은 파일 읽기의 동시 수를 제한한다. 전송 API의 인증·바이트 스트림 계약은 유지한다. APK는 4 ABI와 서명을 유지한 채 R8/리소스 축소를 실제 빌드·설치 회귀로 평가한다. 검증 실패하는 네이티브 최적화는 출시 후보에서 제외한다.

## 검증과 운영 반영

계정 전환/동시 요청/저장 중 reload/부분 실패의 의미 있는 회귀 검사와 구현을 완료했다. 웹 전체 테스트는 223개 중 222개 통과, 기존 fixture 검사 1개 skip이다. 최종 웹 타입 검사·린트·production build를 통과했고, 브라우저 검증과 독립 검토의 High/Medium 해결도 완료했다. 앱 Android/iOS export와 서명 APK·설치 smoke의 정확한 검증 범위는 모바일 저장소의 docs/performance-improvements-validation.md를 따른다. 합성 CPU와 모의 RTT 개선은 실제 기기 지표와 구분한다. 비밀 파일은 출력·스테이징하지 않는다.

외부 PR·main 병합·Vercel 운영 배포와 별도 Supabase mobile-updates 배포는 진행 예정이다. mobile-updates의 entrypoint·verify_jwt=false·함수 내부 다운로드 인증을 유지하며 두 런타임의 배포와 롤백을 별도로 검증한다.
