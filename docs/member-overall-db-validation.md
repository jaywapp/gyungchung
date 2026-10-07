# 회원 오버롤 DB 검증

2026-10-07 · `codex/member-overall` · 웹 우선

`supabase/migrations/20261007070714_add_member_overalls.sql`을 Supabase CLI 2.102.0의 `supabase migration new add_member_overalls`로 생성했다. 실제 회원이나 운영 프로젝트에 적용하지 않았으며 커밋·푸시·PR도 수행하지 않았다.

## 저장·조회 계약

- 권한키는 `ratings.manage`다. 회장·부회장·총무에 이 키만 최초 부여한다. 다른 서비스의 기존 제외 설정을 복원하지 않는다. 기존 시스템 관리자 권한 설정 RPC의 허용 목록에 새 키만 추가하며 트랜잭션, 검증, 잠금, `expected_enabled` 충돌 처리를 보존한다.
- `private.member_overalls`에 `pace`, `shooting`, `passing`, `dribbling`, `defending`, `physical`을 각 1~100 정수로 저장한다. 기존 공개 경기 평점·회원 디렉터리 구조와 분리한다.
- `get_member_overalls(p_member_ids uuid[])`는 최대 300개 ID를 받는다. 허가된 빈 요청은 빈 배열, 미평가·비활동·숨김·미존재 회원은 결과에서 제외한다. 중복 ID는 결과를 중복시키지 않는다. NULL 요청과 NULL ID는 `22023`으로 거부한다.
- `set_member_overall(p_member_id uuid, p_scores jsonb, p_expected_revision bigint)`은 정확히 6개 점수를 받는다. 기대 revision 0은 신규 등록, 양수는 해당 revision 수정이다. 결과는 `member_id`, 6개 점수, `revision`, `updated_at` 한 행이며 감사 작성자는 반환하지 않는다.
- 권한 거부는 `42501`, 잘못된 입력·대상은 `22023`, 오래된 revision·변경 경합은 `40001`이다. 누락·문자열·분수·범위 밖 점수와 감사정보 등 추가 키를 거부한다.

## 권한·동시성

호출자는 최신 Auth 연결 회원이고 활동 상태이며 초기 비밀번호 변경을 완료해야 한다. 운영진 역할과 직책의 `ratings.manage`가 있거나 시스템 관리자여야 한다. 일반 회원 역할인 시스템 관리자도 허용한다. 기존 운영 권한 기준에 따라 관리 가능한 숨김 QA 운영진·관리자도 허용하며, 평가 대상은 활동 중인 숨김 계정이 아닌 회원만 허용한다. 대상의 Auth 등록 유무와 비밀번호 변경 요구 여부는 평가 대상 자격을 제한하지 않는다.

public RPC는 security invoker, private helper는 명시 권한 확인과 빈 search path를 사용하는 security definer다. 모든 신규 함수의 PUBLIC·anon·service_role 실행 권한을 회수하고 authenticated에만 실행을 부여한다. 원본 테이블은 직접 grant가 없고 RLS의 기본 거부를 적용한다. 검증에서는 임시로 테이블 권한을 부여한 상황에서도 RLS가 일반 회원의 조회·삽입·수정을 차단함을 확인했다.

저장은 호출자와 대상 profile을 ID 순서대로 `FOR SHARE NOWAIT`로 잠근다. 운영진의 서비스 권한 행도 `FOR SHARE NOWAIT`로 잠근다. 저장 도중 상태·직책·Auth 연결·관리자 여부 또는 서비스 권한을 변경할 수 없으며, 이미 변경 중이면 `40001`을 반환한다. `FOR KEY SHARE`와 달리 비키 상태 수정도 차단한다. 점수 행의 조건부 UPDATE와 충돌 시 아무것도 쓰지 않는 INSERT로 동일 revision의 요청 중 하나만 성공한다. profile 삭제의 cascade와 점수 행 수정이 반대 순서로 경합하는 경우도 NOWAIT로 교착을 피한다.

`created_by`, `updated_by`, `created_at`, `updated_at`은 서버가 현재 호출자로 작성한다. 다른 운영진이 수정하면 마지막 작성자만 변경하고 최초 작성자는 보존한다. 클라이언트는 감사정보를 입력할 수 없다.

## 실행 결과

공식 EDB portable PostgreSQL 17.6 바이너리를 재사용하고 별도 합성 클러스터 `D:/station/.work/member-overall-validation/data`를 생성했다. 연결은 `127.0.0.1:55438`, DB명은 `member_overall_synthetic`으로 고정했다. 기존 격리 DB의 55437 포트와 운영 연결·환경 변수·회원정보를 사용하지 않았다. Node `pg@8.16.3`도 기존 격리 runtime을 재사용하므로 프로젝트 의존성 변경은 없다.

최종 실행 결과:

| 검증 | 통과 수 |
| --- | ---: |
| 권한·원본 RLS·입력·CAS·감사·기존 함수/정책/데이터/디렉터리 회귀·실제 3연결 동시성 | 417 |
| 신규 `member_overalls.test.sql` pgTAP | 98 |
| 기존 `member_phone.test.sql` pgTAP | 40 |
| 기존 `member_birthdays.test.sql` pgTAP | 54 |
| 기존 `member_directory_auth_boundary.test.sql` pgTAP | 5 |
| 합계 | 614 |

동시성 검증은 독립 PostgreSQL 연결 3개를 사용해 실제 잠금 대기를 `pg_stat_activity`에서 확인했다. 동시 최초 등록·수정의 단일 승자, 진행 중 및 커밋 후의 권한/상태 변경, 권한 제외와 이미 승인된 저장의 순서, profile 삭제/cascade의 역순 경합을 재현했다. 일반 회원과 제외된 운영진은 public wrapper·private helper·직접 테이블 경로 모두 차단됐다. 기존 관리자의 역할/인증 연결 보호 및 일반 회원의 전화번호·생일 접근도 보존했다.

- 마이그레이션 SHA-256: `8ea5ac7a31dbecb29197958996def842b2f0f227b0d6735272ddff470ee9944f`
- 기존 함수/정책/profile/디렉터리 스냅샷 SHA-256: `68aa6054b8a980fcf8a0b0387838182c2c58b461b770013494f3cba74b7f3da2`
- 최종 로그: `D:/station/.work/member-overall-validation/verification-final.log`

스냅샷 digest는 최종 실행의 합성 시각 값을 포함한다. 재실행 시 digest가 달라도 내부 before/after 일치 assertion이 회귀 판단 기준이다.

## 재실행

처음에는 새 빈 합성 클러스터와 DB를 준비한다. 실행기는 DB 신원과 테이블이 없는 상태를 확인한 뒤 진행하며 기존 DB에 fixture를 덧씌우지 않는다. 실패 후 재실행 시에도 이 전용 합성 DB를 새로 준비한다.

```powershell
$env:OVERALL_PG_MODULE='D:\station\.work\db-batch-validation\runtime\node_modules\pg\lib\index.js'
$env:OVERALL_PGTAP_SQL='D:\station\welcome-validation\pgtap.sql.in'
node scripts/verify-member-overall.mjs
```

신규 fixture는 `supabase/tests/fixtures/member_overalls.sql`, pgTAP는 `supabase/tests/database/member_overalls.test.sql`이다. 실행기는 기존 profile/Storage 합성 fixture에 실제 기존 함수·정책·관련 최신 마이그레이션을 재생한다. 전체 Supabase migration 이력과 PostgREST HTTP 서버를 재생한 검증은 아니므로 운영 적용 전 실제 카탈로그·마이그레이션 이력·웹 RPC 연결은 별도 릴리스 단계에서 확인해야 한다.

## 공식 문서 대조와 제한

[최신 changelog](https://supabase.com/changelog.md), [RLS 가이드](https://supabase.com/docs/guides/database/postgres/row-level-security), [DB 함수 가이드](https://supabase.com/docs/guides/database/functions)를 확인했다. [Data API 자동 노출 변경](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)에 맞춰 원본은 private에 유지하고 함수 실행 grant를 명시했다. [PostgreSQL 15.19/17.11 변경](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes)의 ltree·legacy pgcrypto·NaN btree_gist·사용자 정의 연산자는 이 변경에 사용하지 않는다.

Supabase CLI의 `db advisors --db-url`을 이 루프백 DB에 실행했으나 2.102.0에서 TLS가 없는 portable 서버 연결을 거부했다. `sslmode=disable`을 지정한 재시도도 같은 오류여서 중단했다. advisor 통과로 보고하지 않는다. DB 권한·함수 ACL·RLS·빈 search path·호출자/대상/감사/동시성 보안 검증은 위 실제 PostgreSQL assertion으로 확인했다.

## root 운영 적용
최초 CLI 생성 파일을 운영 이력 20261007080520과 일치시키려고 supabase/migrations/20261007080520_add_member_overalls.sql로 이동했다. SQL 내용·614개 검증·SHA256은 동일하다. root가 운영 RLS/ACL/RPC·신규 직책 권한·rows0와 advisor 새 알림 없음을 확인했다. 앞선 운영 미적용 내용은 DB 담당의 준비 이력이다.
