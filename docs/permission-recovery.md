# 시스템 관리자 권한 복구

앱은 시스템 관리자가 자기 권한을 제거하지 못하게 하고, 활성 시스템 관리자가 한 명도 남지 않는 변경을 DB 트리거에서 거부한다. 정상 운영에서는 관리자 화면의 회원 편집과 권한 일괄 적용만 사용한다.

아래 절차는 레거시 데이터, 수동 DB 변경 또는 마이그레이션 장애로 활성 시스템 관리자가 이미 0명이 된 경우에만 사용하는 비상 복구 경로다. Supabase 프로젝트 소유자만 SQL Editor에서 실행하며, 앱 클라이언트나 운영자 브라우저에서는 실행하지 않는다.

## 복구 전 확인

대상 회원의 `id`, `auth_user_id`, 현재 상태를 먼저 확인한다. 로그인 계정이 연결된 회원만 복구 대상으로 선택한다.

```sql
select id, name, auth_user_id, status, is_system_admin
from public.profiles
order by name;
```

## 권한 복구

`<profile-id>`를 확인한 회원 ID로 바꾼다. 트리거 비활성화와 복구 변경은 같은 트랜잭션에 있어 실패 시 모두 롤백된다.

```sql
begin;

lock table public.profiles in share row exclusive mode;
alter table public.profiles disable trigger protect_account_roles_before_write;

update public.profiles
set is_system_admin = true,
    status = 'active'::public.member_status,
    updated_at = now()
where id = '<profile-id>'::uuid
  and auth_user_id is not null;

alter table public.profiles enable trigger protect_account_roles_before_write;

commit;
```

실행 직후 활성 시스템 관리자가 존재하고 보호 트리거가 활성 상태인지 확인한다.

```sql
select id, name, auth_user_id
from public.profiles
where is_system_admin
  and status = 'active'::public.member_status;

select tgname, tgenabled
from pg_catalog.pg_trigger
where tgrelid = 'public.profiles'::regclass
  and tgname = 'protect_account_roles_before_write';
```

`tgenabled`가 `O`이고 활성 시스템 관리자가 한 명 이상이어야 한다. 확인 후 복구 대상이 관리자 화면에 접근할 수 있는지 로그인으로 검증하고, 실행자·시각·대상·사유를 운영 기록에 남긴다.
