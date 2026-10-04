# 운영진 권한 전체 점검

## 확정 요구사항

- 회장·부회장·총무는 팀 운영 서비스 전체에 기본 접근한다.
- 정·부는 암묵적인 업무 담당 구분이다. 시스템에 담당 모델을 추가하지 않는다.
- 시스템 관리자는 직책별 서비스 접근을 허용하거나 제외할 수 있다. 예: 부회장 회비 관리 제외.
- 관리자 지위 부여·인증 연결·권한 설정은 시스템 관리 영역으로 보호한다.
- 개인별 예외, 서비스별 읽기/쓰기 분리, 새 직책은 이번 범위에 추가하지 않는다.

## 점검 범위와 결과

웹·모바일의 화면 조건, 저장 요청, DB RLS·RPC·트리거, 계정 발급 Edge Function을 병렬 점검했다. 운영 계정으로 권한 변경이나 계정 초기화 요청을 실행하지 않았다.

| 영역 | 확인된 문제 | 우선순위 |
|---|---|---|
| 계정 보호 | 회원 관리자에게 특권 프로필 INSERT, 인증 연결 변경, 관리자 계정 초기화 경로가 열려 있음 | High |
| 기본 권한 | 부회장은 회원·일정, 총무는 회비만 허용됨 | 요구사항 차이 |
| 설정 권한 | 회장이 부회장·총무 권한을 편집할 수 있음 | 요구사항 차이 |
| 회비 | 금액 적용 트리거의 회원 전체 조회가 회원 관리 권한에 의존 | High, 별도 수정 |
| 출석·팀 편성 | 일정 권한만 있으면 대상 회원 조회가 RLS로 제한됨 | High |
| 회원 편집 | 보호 필드 fee_plan의 null을 monthly로 전송하여 운영진 기본정보 수정 실패 | High |
| 선거·투표·설문 | 웹 운영 콘솔이 권한 없는 종류의 작업을 노출 | Medium |
| 저장 결과 | RLS로 0행 변경된 요청에도 성공 문구 표시 가능 | Medium |
| 권한 회수 | 외부 변경 뒤 전경 화면의 메뉴·조회 데이터 갱신이 늦음 | Medium |
| 모바일 서비스 목록 | welcome.manage 설정 항목 누락 | Medium |
| 용병 회비 | 회비 권한만 있으면 용병 이름 조인 결과가 비어 있음 | Medium |
| 재무 이력 | 일정·용병·회원 삭제가 회비 이력으로 cascade됨 | 보존 정책 별도 결정 필요 |

## 주요 근거

- profiles INSERT: 20260816111500_admin_managed_member_accounts.sql, members.manage만 검사.
- protect_account_roles: 20260821135553_atomic_permission_batch.sql, UPDATE/DELETE이며 auth_user_id 비교 누락.
- provision-member-account/index.ts: 대상 관리자 여부 확인 없이 Auth Admin API 사용.
- can_manage_officer_permission: 시스템 관리자 외 회장에게도 권한 변경 허용.
- save_attendance_batch와 save_event_teams: invoker 내부 profiles 직접 조회.
- 웹 admin-console.tsx와 앱 admin-crud.tsx: 기존 manager의 fee_plan null을 monthly로 대체.

직책별 제외는 서비스의 관리 권한을 제거한다. 공개/일반 회원용 조회는 서비스 관리 권한과 별개의 기존 정책을 따른다. 삭제를 통한 재무 이력 제거는 별도 보존 정책을 확정한 뒤 처리한다.