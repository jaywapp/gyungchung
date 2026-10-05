# 일괄 배포 DB 검증

검증일: 2026-10-05. 대상 브랜치: `feat/member-birthdays`.

판정: 검증 범위에서 배포를 차단할 DB 권한·정합성 결함은 없다. 운영의 기존 과도한 투표 테이블 권한을 발견해 신규 POTM 마이그레이션에서 회수했고, 동일 SQL을 PGlite 및 실제 PostgreSQL 17.6에서 검증했다. 이 담당자는 운영에 쓰지 않았으며, 운영 적용은 루트 담당자가 수행했다.

## 적용 원본과 운영 이력

API 적용 후 생성된 실제 이력 버전에 맞춰 아직 미커밋인 파일명만 변경했다. 과거 운영 이력을 수정하지 않았고 아래 원본 SHA256은 변경 전후 같다.

| 기능 | 최초 로컬 버전 | 실제 운영 버전·현재 파일 | SHA256 |
| --- | --- | --- | --- |
| 생일 | 20261005005930 | `20261005042552_add_member_birthdays.sql` | `2E78588C7380062046A41374D7D02959818968AB4CDFE76F5EC94C63BC479BE6` |
| 전화 | 20261005013341 | `20261005042603_add_member_phone_lookup.sql` | `0B9165C9375BD0A7F6588E808FA37B646D3B0CA14683255C667A60A375633D15` |
| POTM | 20261005020029 | `20261005042615_add_event_potm_voting_window.sql` | `45E36433717DD05E6633C797581CC36A3C61C56A71C5D467FFFFD0F9275097DE` |

파일 위치는 모두 `supabase/migrations/`다. 적용 순서는 생일 → 전화 → POTM이다. 검증 스크립트는 파일명 접미사로 원본을 찾으므로 운영 버전 정렬 뒤에도 같은 원본을 실행한다.

운영 버전으로 파일명을 정렬한 뒤 3개 PGlite 스크립트와 포함 pgTAP를 다시 실행했으며 위 결과와 동일하게 통과했다.

## 실행 결과

| 실행 대상 | 검증 수 | 결과 |
| --- | ---: | --- |
| `scripts/verify-member-birthdays.mjs` / PGlite | 196 | 통과 |
| 위 스크립트의 생일·directory pgTAP | 54 + 5 | 통과 |
| `scripts/verify-member-phone.mjs` / PGlite | 134 | 통과 |
| 위 스크립트의 전화·생일·directory pgTAP | 40 + 54 + 5 | 통과 |
| `scripts/verify-event-potm.mjs` / PGlite | 87 | 통과 |
| 위 스크립트의 POTM pgTAP | 49 | 통과 |
| 기존 `verify-profile-avatars.mjs` | 128 | 통과 |
| 기존 `verify-profile-permissions.mjs` | 147 | 통과, 기존 취약 동작 9개 재현 후 보호 검증 |
| 기존 `verify-fee-database.mjs` | 51 | 통과, 기존 실패 재현 후 보호 검증 |
| 실제 PostgreSQL의 POTM 검증 및 pgTAP | 87 + 49 | 통과 |
| 실제 PostgreSQL의 생일·전화·directory pgTAP | 54 + 40 + 5 | 통과 |
| `verify-event-potm-concurrency.mjs` / 실제 독립 연결 3개 | 22 | 통과 |
| `verify-batch-release-readonly.sql` / 실제 PostgreSQL | 메타데이터·역할·시간 assertions | 통과 |
| DB 관련 JS 검증 스크립트 5개 ESLint | 오류 0 | 통과 |

중복 실행한 pgTAP는 독립 검증 수로 합산하지 않는다. PostgreSQL 어댑터로 실행할 때 기존 POTM 스크립트의 출력 문구에는 `synthetic PGlite`가 남지만, 실제 연결 엔진은 별도 경합 로그에 `PostgreSQL 17.6 on x86_64-windows`로 기록된다.

## 격리 환경과 재실행 명령

- PGlite 0.5.8: `D:/station/welcome-validation/node_modules/@electric-sql/pglite/dist/index.js`.
- pgTAP 소스: `D:/station/welcome-validation/pgtap.sql.in`.
- 실제 DB: 공식 EDB 배포 `postgresql-17.6-1-windows-x64-binaries.zip`을 `D:/station/.work/db-batch-validation/`에 내려받았다. OS 설치·서비스 등록·영구 권한 변경은 없다.
- 실제 DB 연결은 `127.0.0.1:55437`, DB명 `potm_batch_synthetic`으로 고정한다. 데이터는 합성 fixture뿐이다. 앱 환경 변수·운영 비밀·실제 회원 데이터는 사용하지 않았다.
- Node `pg@8.16.3`는 위 임시 경로의 `runtime/`에만 고정 설치했다. 저장소 package/lock 파일은 변경하지 않았다.
- 실제 DB 준비에는 기존 fixture와 실제 기존 함수·정책·최신 마이그레이션의 필요한 부분을 재생한다. 전체 Supabase 이력 재생은 아니다.

저장소 루트의 PowerShell 명령:

```powershell
$env:PROFILE_PGLITE_MODULE='D:\station\welcome-validation\node_modules\@electric-sql\pglite\dist\index.js'
$env:PROFILE_PGTAP_SQL='D:\station\welcome-validation\pgtap.sql.in'
node scripts/verify-member-birthdays.mjs
node scripts/verify-member-phone.mjs
node scripts/verify-event-potm.mjs
node scripts/verify-profile-avatars.mjs
node scripts/verify-profile-permissions.mjs
$env:FEE_PGLITE_MODULE=$env:PROFILE_PGLITE_MODULE
node scripts/verify-fee-database.mjs
```

실제 PostgreSQL은 새 합성 클러스터·빈 `potm_batch_synthetic` DB를 먼저 만들고 실행한다. 이미 재생한 DB에 다시 fixture를 덧씌우지 않는다. 검증 도중 생성한 역할도 클러스터 범위이므로 반복 초기화할 때 합성 클러스터만 새로 준비한다.

```powershell
$env:POTM_PG_MODULE='D:\station\.work\db-batch-validation\runtime\node_modules\pg\lib\index.js'
$env:PROFILE_PGLITE_MODULE='D:\station\repos\.performance-work-20261003\gyungchung\scripts\local-synthetic-postgres.mjs'
$env:PROFILE_PGTAP_SQL='D:\station\welcome-validation\pgtap.sql.in'
node scripts/verify-event-potm.mjs
node scripts/verify-event-potm-concurrency.mjs
```

로그·임시 추가 pgTAP 실행기는 `D:/station/.work/db-batch-validation/`에 보존한다:

- `potm-pglite-final.log`
- `potm-postgres-final.log`
- `concurrency-final.log`
- `pgtap-postgres-final.log`
- `readonly-smoke-final.log`
- `run-extra-pgtap.mjs`, `postgres.stdout.log`, `postgres.stderr.log`

검증 종료 후 `pg_ctl stop -m fast -w`로 임시 서버를 정상 종료했다. 로그에서 `database system is shut down`을 확인했으며 재현용 바이너리·합성 데이터 디렉터리·로그만 보존했다.

## 권한·정합성 검토

- 생일은 private 테이블에 월·일과 CAS revision만 저장한다. DOB/출생연도 backfill은 없고 원본 테이블은 RLS 기본 거부와 직접 grant 회수를 함께 적용한다. 호출자에게 대상 ID를 받지 않고 현재 연결된 본인의 profile 행을 잠근 뒤 상태를 확인한다. NULL 쌍 삭제도 revision을 남겨 오래된 탭의 재등록을 막는다.
- directory 기존 11개 필드의 값·행 범위와 회비·사진 노출 조건을 보존하며 생일 3개 필드만 추가한다. 생일은 호출자와 대상 모두 엄격한 자격을 만족해야 보이고 revision은 본인만 받는다. 기존 directory 호출자 계약 전체를 임의로 강화하지 않는다.
- 전화는 선택한 1명 RPC만 추가했다. 호출자는 active·Auth 연결·초기 비밀번호 해제·비숨김 조건을 만족해야 한다. 대상은 active·비숨김만 필요하며 Auth 미연결/초기 비밀번호여도 연락처 대상에서 제외하지 않는다. 함수는 stable이고 읽기만 한다. 공개 invoker 및 private definer 둘 다 기본 EXECUTE를 회수하며 authenticated만 허용한다.
- POTM 직접 INSERT/UPDATE/DELETE와 기존 upsert 사용을 보존한다. RLS 본인 범위와 definer 트리거가 모든 쓰기 경로에 적용된다. 엄격한 투표자, 후보의 active·비숨김 상태, 실제 체크인, 자기 투표 금지, 일정/투표자 불변을 확인한다. 후보 Auth 연결·초기 비밀번호는 제한하지 않는다.
- 투표 창은 종료 포함·마감 제외이며 1일은 정확히 24시간이다. NULL 종료는 시작 2시간 후다. 실제 벽시계와 마이크로초 경계, DST, 트랜잭션 시작 후 마감 경과를 검증했다.
- 이벤트·투표자·후보·출석 행을 `FOR SHARE NOWAIT`로 잠근다. 잠금 충돌은 `40001`이므로 클라이언트는 재조회 후 재시도해야 한다. 실제 연결에서 일정 수정, 회원 상태/초기 비밀번호 전환, 출석 변경과 투표 경합을 확인했다.
- 실제 연결에서 투표 행을 먼저 잠근 상태로 부모 일정 삭제가 cascade를 기다리는 역순 잠금을 재현했다. 투표 측은 `40001`로 종료하고, 승인된 부모 삭제는 계속 진행하여 마감된 표까지 제거했다. 이는 개인 취소 기간의 예외가 아니다.
- birthday 최초 등록 두 연결 경합은 하나만 저장되고 다른 하나가 `40001`로 거부된다. 잠금 대기 중 본인 초기 비밀번호가 재설정되면 저장이 `42501`로 거부된다.
- 결과·누적 RPC의 기존 5/6열과 public invoker ACL을 보존한다. 숨김 투표자·후보를 순위 산정 전에 제외하며 attendance JOIN 없이 과거 표를 보존한다. 누적 MOM은 마감된 일정만 반영하고 시즌 MVP는 변경하지 않는다.
- 기존 주간 자동 생성 함수는 postgres 소유 definer다. 새 일정 기간 트리거의 신뢰 실행자 경로와 호환된다. 일반 관리자는 엄격한 회원 상태 및 `events.manage`가 필요하며, 초기 비밀번호/숨김 관리자도 기간을 다시 열 수 없다.

## 발견과 수정

운영 `event_mom_votes` 카탈로그에 anon/authenticated의 `TRUNCATE`, `REFERENCES`, `TRIGGER` 권한이 남아 있었다. 일반 PostgREST CRUD에서 즉시 호출 가능한 취약점이라고 단정하지는 않지만, TRUNCATE는 RLS 대상이 아니므로 불필요한 권한이다. 신규 POTM SQL에서 public/anon/authenticated의 해당 세 권한만 회수했다. authenticated CRUD와 service_role 기존 ACL은 그대로다. fixture에 실제 기존 과도한 grant를 재현해 회수, 직접 TRUNCATE, 트리거 생성·비활성화 거부 및 service ACL 동일성을 검증했다.

테스트 준비 중 회비 런타임 환경 변수 이름, Windows ESM URL·inet 주소 표기, 시스템 관리자 합성 후보의 비활동 전환 금지, 임시 DB 재생성 후 남은 storage 역할을 수정했다. 이 실패들은 검증 환경/fixture 준비 오류였고 제품 SQL 오류는 아니었다. 마지막 실행은 모두 통과했다.

## 운영 사전 확인과 읽기 smoke

운영 프로젝트 선택은 `gyungchung / pamvwzgqkzgsygslmfqo`다. 직접 확인한 metadata는 PostgreSQL 17.6, events/event_mom_votes RLS 활성, profiles 자격 컬럼 NOT NULL, directory 반환 11열·의존 객체 0, 기존 MOM 결과 5열/누적 6열이다. 기존 public 결과 RPC는 authenticated/service_role EXECUTE, private helper는 authenticated만 허용했다. 이름·전화·생년월일 값은 조회·출력하지 않았다.

루트 담당자가 운영 대상 상태·이력·advisors를 별도로 확인하고 3개 SQL을 적용했다. 이 담당자는 운영 DDL·데이터 변경을 실행하지 않았다. CLI dry-run의 과거 원격 26개 이력/로컬 불일치는 이전 이력 변경으로 해결하지 않았다.

`scripts/verify-batch-release-readonly.sql`은 실제 로컬 PG에서 검증한 배포 후 smoke다. READ ONLY 트랜잭션 안에서 함수 정의/ACL/RLS 메타데이터, anon 접근 거부, 실제로 존재하지 않는 synthetic Auth UUID의 빈 조회·전화 거부, 순수 시간 경계만 확인하고 ROLLBACK한다. 회원 값과 실제 본인 쓰기는 확인하지 않는다. 파일은 루트 담당자에게 운영 실행용으로 전달했다.

루트 담당자는 운영에서 이 원본 쿼리를 실행해 `batch release read-only smoke passed`와 ROLLBACK을 확인했다. 적용 후 advisors는 security WARN 27·performance WARN 4로 baseline과 같았다. private 기본 거부 RLS INFO는 생일 테이블 추가로 17→18, FK INFO 19·unused index INFO 31은 동일했다. 이 운영 실행·advisors 원본 증거는 루트 담당자가 보관한다.

공식 근거: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Database Functions](https://supabase.com/docs/guides/database/functions), [2026-09-25 PostgreSQL 변경](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes), [변경 기록](https://supabase.com/changelog.md). 이번 SQL은 변경 공지의 ltree/btree_gist/legacy pgcrypto/custom operator 기능을 도입하지 않는다.

## 검증 한계

- 전체 과거 Supabase migration 이력, Storage/Auth/Realtime 서버 전체를 로컬에서 재생하지 않았다. 필요한 실제 함수·정책·마이그레이션과 합성 schema로 검증했다.
- 실제 독립 연결 검증은 localhost PostgreSQL 17.6의 기본 READ COMMITTED 기준이다. 운영 PostgREST 요청·휴대폰 네트워크·실제 사용자의 쓰기와 브라우저 검증은 루트 통합 검증 범위다.
- pgTAP/JS 검증 수는 보장 범위를 나타내며 운영 부하 테스트 결과가 아니다. 읽기 호출은 statement snapshot 기준이고, 이미 진행 중인 조회를 회원 권한 변경 시 소급 취소하지 않는다.
- 운영 적용 이후의 advisors 비교 및 최종 운영 smoke 결과는 루트 담당자의 배포 기록과 함께 판단한다.
