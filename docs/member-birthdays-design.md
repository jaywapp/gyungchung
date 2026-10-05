# 구성원 생일 설계
작성일: 2026-10-05

## 설계
- 양력 월·일만 저장한다. 출생연도/나이는 저장하거나 표시하지 않는다.
- private.member_birthdays에 본인 프로필 ID, birthday_month, birthday_day, revision을 저장한다. 직접 테이블 접근은 차단한다.
- 기존 get_member_directory 결과 뒤에 birthday_month, birthday_day, birthday_revision을 추가한다. 활동/인증 연결/초기 비밀번호 변경/비숨김 조건을 만족하는 호출자와 대상에게만 생일을 반환한다. revision은 본인에게만 반환하고 미등록은 0이다.
- public.set_my_birthday(p_month integer, p_day integer, p_expected_revision bigint)는 invoker wrapper로 private guarded definer를 호출한다. auth.uid()로 본인을 결정하고 profiles FOR UPDATE, 자격 재검증, revision CAS를 수행한다. 반환은 birthday_month, birthday_day, birthday_revision이다. 삭제는 NULL 쌍으로 revision 증가한 행을 남긴다.
- 프로필의 생일 정보는 성공한 directory 결과에서만 병합한다. 조회 중/실패/구형 서버의 필드 부재는 미등록과 구별한다. 기존 인증/권한 필드를 목록 기본값으로 덮지 않는다.
- 로그인/로그아웃/계정 교체/자격 변경 뒤에는 이전 읽기·쓰기의 결과를 반영하지 않는다. 저장 성공 뒤 읽기 실패는 저장 실패로 안내하지 않는다.
- 달력에는 일정과 별개의 생일 표시와 날짜별 회원 목록을 추가한다. 일정이 없어도 생일을 표시한다. 날짜별 인덱스는 한 번 계산한다.
- 2월 29일 생일은 비윤년에 2월 28일에 표시한다. 입력 화면에서 이 기준을 안내한다.
- 생일을 등록하지 않은 본인에게 달력과 마이페이지에서 비강제 안내/입력 경로를 제공한다. 월·일 선택, 수정, 삭제, 오류/로딩 상태를 제공한다.
- 기존 디자인/모달/버튼/아이콘 시스템을 이어 쓰는 Operate 확장이다. 별도 세계관·화면 재설계는 하지 않는다.
- 실제 회원 데이터를 편집하지 않고 합성 SQL/browser fixture로 검증한다. 운영 DB 및 배포는 검토 가능한 로컬 결과 준비 후 승인 범위에 맞춰 진행한다.
