# 믹스트존 설계

orchestrator: Codex. 사용자 최신 전체 구현·배포 지시에 따라 권장 기본 정책을 확정했다.

## 화면 흐름

지난 일정 상세 → 믹스트존 참여 자격과 마감 확인 → 실제 참석한 다른 회원 선택 → 6개 항목별 1~5점 선택 → 제출. 대상별 기존 본인 응답을 조회하고 마감 전 수정할 수 있다. 기본 선택은 비어 있으며 미평가를 3점으로 자동 제출하지 않는다. 입력·기간·자격을 확인하는 동안 중복 제출을 차단한다. 마감 이후 원본은 본인 조회만 가능하다.

회원 상세와 운영 능력치 화면은 기본 육각형 그래프와 6항목을 유지하고 수동 수정 입력을 제거한다. 믹스트존 응답 수·일정 수·최근 10일정 기준을 표시한다. 기존 ratings.manage 권한과 시스템관리자/운영진 조건을 유지한다. 팀 목록·편성의 참고 평균은 평가가 있는 회원만 포함한다.

## DB와 API

- events.mixed_zone_days: default 3, integer 1~30. events.manage가 설정한다. 종료 기준은 ends_at 또는 starts_at+2h이다. [종료, 종료+기간)이며 서버 시간을 최종 판단으로 사용한다.
- private 평가 표: event_id, actor_profile_id, member_id, 6개 정수 1~5, revision, 감사 시각. event/actor/member 유일성, FK와 조회 인덱스, RLS와 직접 접근 차단.
- get_mixed_zone_entries(p_event_id): 현재 인증 사용자 자신의 event 평가만 반환한다. event_id/member_id/6점/revision/updated_at.
- set_mixed_zone_entry(p_event_id,p_member_id,p_scores,p_expected_revision): 인증 사용자로 actor를 결정하고 자격·실제 출석·자기 제외·마감·전체 6점·기대 revision을 확인한다. 기대 0은 신규 작성이다.
- get_mixed_zone_overalls(p_member_ids): 기존 overall 필드와 response_count/event_count를 반환한다. 권한은 ratings.manage다. 대상별 최근 평가 있는 10일정의 event 평균들을 동일 가중 평균하고 20배·반올림한다.
- 기존 get_member_overalls 시그니처는 유지하고 동일한 peer 집계를 반환한다. 기존 set_member_overall은 서버에서 거절한다. private.member_overalls 수동 자료는 보존한다.
- private SECURITY DEFINER에 명시적 actor 검사를 두고 public wrapper는 SECURITY INVOKER, 빈 search_path 및 실행 권한을 한정한다. 출석/계정/일정/권한 잠금과 CAS로 경쟁 변경을 거절한다.

## 웹·앱 경계

로그아웃·계정 교체·권한 회수·대상 변경·일정 변경·마감 뒤 늦은 응답은 화면/저장을 갱신하지 못한다. 읽기 실패에는 재시도, 저장 결과가 불명확하거나 revision 경쟁이면 최신 본인 응답을 재조회한다. POTM과 출석·public 팀 평점은 변경하지 않는다. 앱은 웹 소스를 직접 import하지 않고 같은 순수 업무 계약을 이식한다. 기존 연락처 메뉴·사진·생일·POTM·업데이트 팝업 및 권한 서비스 제외 설정도 포함한다.

## 검증

실제 격리 PG에서 역할/본인/직접 표/마감/숫자/CAS/집계/경합을 검사한다. 웹 및 모바일 전체 회귀·타입/lint·빌드/export와 합성 인증 두 화면 폭 검사를 수행한다. 독립 리뷰는 핵심 권한·시간·표본·회복 흐름과 실제 화면을 확인한다. 운영에는 synthetic 평가나 실제 회원 점수를 작성하지 않는다.
