# 운영 인증·DB 검증 설계

public.get_member_directory의 auth.uid 조건에 private.current_profile_id() is not null 조건을 추가한다. 이 helper는 실제 auth_user_id 연결을 조회한다. 기존 SECURITY DEFINER·빈 search_path·authenticated 실행 권한을 유지하며 anon/public 권한은 계속 거절한다.

동일 함수에 unlinked, 연결된 회원, 숨김 테스트 계정의 경계를 검증하는 SQL 회귀를 추가한다. 정상 회원의 결과 형식·정렬과 활성 대상 회원 선택을 유지한다. signup 설정 변경·계정 추가·기존 계정 권한 변경·기능 확장은 하지 않는다.

검증 순서: 기존 read-only 운영 증거 → SQL/부모 리뷰 → 격리 rollback 회귀 또는 가능한 로컬 DB 실행 → 승인된 최소 migration → 운영 read-only 재검증 → npm test/lint/build 및 PR 정상 병합. 환경 제약과 실제 로그인 미검증을 결과에 명시한다.
