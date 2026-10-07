# 믹스트존 DB 검증

## 완료 결과

2026-10-08 로컬 PostgreSQL 17.6에서 새 마이그레이션을 적용하고 통합 검사 **190개**, pgTAP 검사 **112개**를 통과했다. pgTAP에는 신규 시간 경계 13개와 기존 전화번호 40개·생일 54개·회원 목록 인증 경계 5개가 포함된다. 운영 Supabase에는 접근하거나 변경하지 않았으며, 커밋·푸시도 수행하지 않았다.

- 마이그레이션: `supabase/migrations/20261007144033_add_mixed_zone_ratings.sql`
- 생성: 설치된 Supabase CLI `2.102.0`의 `migration new --help` 확인 후 `supabase migration new add_mixed_zone_ratings`
- 마이그레이션 SHA-256: `82ba4111276e57566cb3616191fa74d3d8f772d2d0449c871141c5c8637d5716`
- 기존 함수·RLS·권한·수동 점수 스냅샷 SHA-256: `919266d163250d030b4909a43d9d65f58df76f618d646d4ebc102f0c84c3901b`
- 검증 코드: `scripts/verify-mixed-zone.mjs`
- 신규 SQL: `supabase/tests/fixtures/mixed_zone.sql`, `supabase/tests/database/mixed_zone.test.sql`

## 구현 계약

`events.mixed_zone_days`는 기본값 3, 범위 1~30이다. 경기 종료 시각은 `ends_at`, 없으면 `starts_at + 2 hours`이고 작성 구간은 `[종료, 종료 + mixed_zone_days × 24 hours)`이다. DST와 세션 시간대가 바뀌어도 하루는 정확히 24시간이다. POTM의 `mom_voting_days`와 별개다. 기존 신뢰 서버/일정 생성 경로는 보존하고, 회원 클라이언트의 설정 변경에는 활동·인증 연결·비테스트·비밀번호 변경 완료 및 `events.manage`를 확인한다.

평가자는 동일 경기의 실제 출석/지각 회원이어야 하고 다른 실제 참석 활동·비테스트 회원을 평가한다. `check_in_status`가 없을 때만 기존 `checked_in_at`을 출석으로 인정한다. 명시적 `absent`와 RSVP `going`은 출석으로 인정하지 않는다. 평가 대상의 인증 연결·비밀번호 상태는 자격 요건에 추가하지 않았다.

6개 항목은 정확히 정수 1~5다. 평가자 ID는 입력 인자로 받지 않고 로그인 연결에서 결정한다. 경기·평가자·대상 조합은 하나이고 신규 작성은 기대 revision 0, 수정은 읽은 revision이 필요하다. 저장 결과 revision은 증가한다. 원본 조회는 본인 작성분만 허용하고, 평가자의 현재 출석 자격을 확인하되 작성 마감 후에도 읽을 수 있다.

새 `get_mixed_zone_overalls(uuid[])`는 현재 활동·비테스트 대상의 응답이 존재하는 최근 10경기를 종료 시각 내림차순, 같은 시각이면 경기 ID 내림차순으로 선택한다. 먼저 경기별 각 항목 평균을 계산한 뒤 경기를 동일 가중치로 평균내고 20배하여 반올림한다. `response_count`는 선택된 경기들의 응답 합계, `event_count`는 선택된 경기 수, `revision`은 선택된 원본 revision 합계, `updated_at`은 선택된 응답의 최종 수정 시각이다. 현재 평가자 상태나 사후 출석 정정으로 과거 유효 응답을 집계에서 제거하지 않는다. 표본이 없으면 행을 반환하지 않으며 수동 점수로 대체하지 않는다.

기존 `get_member_overalls(uuid[])`의 인자·반환 열·ACL을 보존하고 같은 집계 원천으로 연결했다. 기존 `set_member_overall(uuid,jsonb,bigint)`도 서명·ACL을 보존하지만 항상 `42501`로 수동 작성 종료를 알린다. 설치된 예전 모바일 앱도 수동 점수를 갱신할 수 없다. 수동 저장소의 값·revision·작성자·감사 시각은 보존한다. 집계 조회는 서버에서도 기존 `ratings.manage`가 있는 적격 운영진/시스템 관리자에게만 허용한다.

## 권한과 동시성

새 공개 RPC는 invoker이고 실제 접근은 비공개 definer 함수로 제한했다. 모든 함수의 `search_path`는 비어 있다. 새 RPC는 `authenticated`에만 실행 권한이 있으며 `PUBLIC`·`anon`·`service_role`의 기본 실행 권한을 제거했다. 원본 테이블은 비공개 스키마, RLS 활성화, 클라이언트 직접 CRUD/부가 테이블 권한 전부 차단으로 구성했다. 각 FK의 선두 열을 포함하는 인덱스도 확인했다.

작성은 평가자·대상 회원, 경기, 양쪽 출석 행에 공유 잠금을 확보한다. 응답별 비차단 트랜잭션 advisory 잠금은 동시에 새 응답을 만드는 경우도 직렬화한다. 기존 응답은 비차단 행 잠금을 추가한다. 모든 잠금 후 `clock_timestamp()`로 마감 여부를 확인한다. 부모 삭제나 자격/기간 변경과 충돌하면 기다리거나 교착하지 않고 `40001`을 반환한다. 자격/기간 위반은 `42501`, 항목/인자 오류는 `22023`이다. 일반 이벤트 테이블의 기간 범위 위반에는 PostgreSQL 제약 오류 `23514`가 적용된다.

기간 일수뿐 아니라 경기 시작·종료 시각 변경에도 같은 설정 보호를 적용한다. 기간 설정 중에는 평가자 프로필과 `events.manage` 권한 행에도 공유 잠금을 적용했다. 다른 트랜잭션의 권한 철회는 완료된 설정 트랜잭션을 기다리며, 진행 중인 철회/계정 변경과 충돌한 설정은 `40001`을 반환한다.

## 실제 검증 범위

- 인증 연결 없음, 미활동/대기, 비밀번호 변경 필수, 숨김 계정, 본인 대상, 실제 미참석, 명시적 결석의 접근 거부.
- 지각·기존 체크인 시각 호환, 미연결/비밀번호 변경 필수인 적격 대상 평가 허용.
- 본인 응답만 조회, 마감 후 본인 조회, 본인 출석 자격 철회 후 조회 거부.
- 새 응답/수정 CAS, 중복 새 응답, 오래된 revision, 미작성 행의 양수 revision, 6항목 누락/추가/null/문자열/소수/범위 초과/거대 숫자 거부.
- `PUBLIC` 상속 역할·익명·서비스 역할의 새 RPC 실행 거부, 직접 테이블 권한 거부, 공개 invoker/비공개 definer 및 빈 search path.
- 운영진 조회 권한 철회, 일반 회원 집계 거부, 수동 RPC 종료, 수동 감사 값/기존 함수 ACL/권한 제외 정책/프로필/POTM RLS 보존.
- 응답 수가 다른 경기 간 동일 가중치, 최근 평가가 있는 10경기만 선택, 미평가 최신 경기 제외, 같은 종료 시각의 안정적 ID 순서, 표본 없는 대상의 빈 결과.
- 사후 출석 정정·평가자 비활동/숨김 변경이 과거 집계를 지우지 않음, 대상의 현재 비활동/숨김 변경은 제외.
- 정확한 개방/마감 경계, 명시 종료 우선, 2시간 기본 종료, 봄/가을 DST 24시간, 트랜잭션 시작 시각으로 마감을 늘릴 수 없음.
- 3개 독립 PostgreSQL 연결로 경기/평가자/대상/출석 변경, 부모 삭제, 동일 응답 동시 신규/수정, 서로 다른 평가자의 동시 평가, 출석 철회 대기, 기간 일수/시작/종료 시각 설정 중 권한 철회 경합.
- 기존 POTM 투표 입력이 동작하고 믹스트존 입력이 POTM 표를 변경하지 않음.
- 기존 전화번호·생일·회원 목록 pgTAP를 수정 없이 재실행.

## 실행 환경과 명령

별도 클러스터 `D:\station\.work\mixed-zone-validation\data`, 루프백 `127.0.0.1:55440`, 사용자 `postgres`, 합성 DB `mixed_zone_synthetic_4`에서 실행했다. 기존 `db-batch-validation`과 그 이전 검증 DB/증거는 덮어쓰지 않았다. 최초 합성 부트스트랩에서 과거 정책 이름을 잘못 참조한 실패 DB와 첫 성공 DB `_2`도 유지하고, 확장 검사는 새 DB `_3`, 시작/종료 시각 설정 잠금 보완까지 포함한 최종 검사는 새 DB `_4`에서 수행했다. 검증 스크립트는 원격 URL/비밀번호를 받지 않으며 루프백·합성 DB 이름·빈 DB 조건을 검증한다.

```powershell
& 'D:\station\.work\db-batch-validation\pgsql\bin\initdb.exe' -D 'D:\station\.work\mixed-zone-validation\data' -U postgres -A trust --encoding=UTF8 --locale=C
& 'D:\station\.work\db-batch-validation\pgsql\bin\pg_ctl.exe' -D 'D:\station\.work\mixed-zone-validation\data' -l 'D:\station\.work\mixed-zone-validation\postgres.log' -o '-h 127.0.0.1 -p 55440' -w start
& 'D:\station\.work\db-batch-validation\pgsql\bin\createdb.exe' -h 127.0.0.1 -p 55440 -U postgres mixed_zone_synthetic_4
$env:MIXED_ZONE_RUN='4'
$env:MIXED_ZONE_PG_MODULE='D:\station\.work\db-batch-validation\runtime\node_modules\pg\lib\index.js'
$env:MIXED_ZONE_PGTAP_SQL='D:\station\welcome-validation\pgtap.sql.in'
node scripts/verify-mixed-zone.mjs
```

이미 생성된 클러스터/DB에는 위 생성 명령을 반복하지 않는다. 재검증은 새 숫자 접미사의 합성 DB를 만들어 `MIXED_ZONE_RUN`과 일치시키면 된다.

```json
{"passed":true,"checks":190,"tapChecks":112,"engine":"PostgreSQL 17.6 on x86_64-windows, compiled by msvc-19.44.35213, 64-bit","migration":"supabase/migrations/20261007144033_add_mixed_zone_ratings.sql","migrationSha256":"82ba4111276e57566cb3616191fa74d3d8f772d2d0449c871141c5c8637d5716","originalSnapshotSha256":"919266d163250d030b4909a43d9d65f58df76f618d646d4ebc102f0c84c3901b","scope":"three independent loopback PostgreSQL connections; synthetic fixtures only"}
```

## 운영 반영 전 남은 확인

이 결과는 합성 로컬 DB 검증이다. 운영 반영 담당자는 독립 코드 리뷰, 운영 스키마/기존 데이터의 전후 보존 비교, 새 RPC·기본값·마이그레이션 이력, Supabase 보안/성능 Advisors를 확인해야 한다. 기본 거부인 새 private RLS 테이블의 정책 없음 INFO는 의도된 경계다. 운영 반영 및 웹·모바일 배포 결과는 전체 작업 검증 문서에서 별도로 기록한다.

## 운영 반영 확인 · 2026-10-08

운영 이력의 실제 버전 20261007153120에 맞춰 저장소 파일을 20261007153120_add_mixed_zone_ratings.sql로 이름만 맞췄다. SQL SHA-256은 82ba4111276e57566cb3616191fa74d3d8f772d2d0449c871141c5c8637d5716로 검증 원본과 동일하다. 위 원시 로컬 검증 JSON의 이전 파일명은 검증 당시 이력으로 보존한다. 운영 새 평가 0건, 기존 수동 평가 1건의 전체 행 digest 및 직책 권한 digest 동일, POTM 0건·출석22건·일정16건 유지. 16개 기존 일정에 기본 3일이 적용됐고 잘못된 기간 0건이다. private RLS ON·anon/authenticated 직접조회 불가·anon RPC 불가·authenticated RPC 허용을 확인했다.

Advisors의 WARN은 전후 동일하다. private RLS 기본 거부 표의 정책 없음 INFO 1건 및 아직 사용되지 않은 새 인덱스 INFO 2건은 예상 상태이며, 새 미인덱스 FK 경고는 없다.
