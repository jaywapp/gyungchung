# 푸시 피드백 서버 설계

## 데이터 계약

기존 `data.version=1` 및 이동·계정 연결 필드는 유지한다. worker는 Expo 제목과 240자 제한을 적용한 본문을 `data.display={title,body}`에도 동일하게 넣는다. 새 앱은 선택적 display를 검증하고, 구버전 payload는 기존 종류별 문구로 처리한다.

## 변경 시점 스냅샷

- 참석 트리거: `going_count`는 해당 일정에서 `status='going'`인 `public.attendance` 행 수다. AFTER 트리거에서 변경 직후 계산한다. 게스트 테이블은 조회하지 않는다.
- 의견 트리거: `response_changed`, `response_change`(`added`/`edited`/`removed`), `response_summary`, `before_status`, `after_status`, `status_changed`를 저장한다. 공백뿐인 답변은 없는 답변으로 간주한다. 요약은 답변의 공백을 정리하고 길이를 제한한다.
- 기존 notification snapshot에는 새 필드가 없으므로 worker가 종전 문구로 안전하게 처리한다.

## 문구와 대상

- 참석/불참: `{일정 이름} 참석 인원이 변경되었습니다 ({현재인원})`와 `{회원 이름}님이 참석으로 변경하였습니다.` 또는 `불참으로 변경하였습니다.` `going_count`가 없는 과거 이벤트는 종전 문구를 사용한다.
- 일정: 변경된 시간, 장소명, 주소를 각각 표시한다. 주소 삭제는 삭제 안내를 표시한다.
- 의견: 답변 등록/수정/삭제와 처리 상태 변경을 구분하고, 동시에 바뀌면 두 정보를 함께 표시한다. 상태는 `접수`/`검토 중`/`처리 완료`/`종료`로 표시한다.
- 참석 여부 안내: `manual=true`는 운영진 재알림 문구, `false` 또는 과거 snapshot은 자동 안내 문구를 사용한다.
- 참석 수신 대상은 기존 정책을 따르되 `subject_profile_id`가 일치하는 변경 대상 회원은 제외한다. actor가 운영진인 대리 변경에서도 actor가 아닌 대상 회원을 제외한다.

## 배포 순서와 위험

마이그레이션을 worker보다 먼저 적용한다. 새 스냅샷과 기존 worker는 호환되지만, 새 worker가 먼저 배포돼도 구 스냅샷에 fallback한다. 모바일 앱이 이전 버전이면 추가 `display`는 무시되고 시스템 알림은 새 문구로 표시된다. 기존 운영 runtime 설정, cutoff, Cron 설정은 마이그레이션에서 변경하지 않는다.
