# 회원 오버롤 0점 DB 검증

2026-10-07 · `codex/member-overall-zero` · 기준 `f057c0654a763da85e7429f782207472775de440`

초기 `supabase/migrations/20261007114237_allow_zero_member_overalls.sql`을 Supabase CLI 2.102.0의 `supabase migration new allow_zero_member_overalls`로 생성했다. 기존 `20261007080520_add_member_overalls.sql`은 수정하지 않았다. 운영 DB, 실제 회원 점수, 외부 설정, 시크릿을 사용하거나 수정하지 않았다. 커밋·푸시·PR은 수행하지 않았다.

## 변경 계약

- private 원본의 `pace`, `shooting`, `passing`, `dribbling`, `defending`, `physical` CHECK 하한만 1에서 0으로 확대했다. 각 열은 계속 smallint이며 0~100을 허용한다.
- `private.set_member_overall(uuid,jsonb,bigint)`의 점수 하한 비교와 관련 오류 문구만 0~100으로 바꿨다. `CREATE OR REPLACE`로 기존 함수 식별자·실행 ACL을 보존했다.
- 호출자·대상 자격, 감사 작성자와 시각, revision CAS, profile 및 permission 행 잠금, SQLSTATE, 빈 search path, security definer/invoker 구분, public wrapper, RLS와 직접 테이블 접근 금지는 그대로다.
- 새 migration은 점수 행을 생성·수정하거나 권한을 재부여하지 않는다. 미평가 조회는 계속 빈 결과이며, 운영진이 저장한 0점은 revision이 있는 실제 평가 행이다.
- DB는 정확히 6개의 숫자 값을 받는다. 빈 입력을 0으로 바꾸는 처리는 웹에서 수행하며, 서버는 누락·null·문자열·음수·100 초과·소수·추가 필드를 계속 `22023`으로 거부한다.

## 실제 검증

PostgreSQL 17.6 portable 바이너리와 기존 `pg@8.16.3`, pgTAP 1.034 소스를 재사용했다. 새 합성 클러스터는 `D:/station/.work/member-overall-zero-validation/data`, 연결은 고정 `127.0.0.1:55439/member_overall_zero_synthetic`이다. 기존 55438 및 55437 클러스터와 그 증거는 보존했다.

| 검증 | 통과 수 |
| --- | ---: |
| SQL·카탈로그·데이터 보존·권한·입력·CAS·감사·실제 3연결 잠금 | 460 |
| 신규 범위가 포함된 `member_overalls.test.sql` pgTAP | 109 |
| 기존 `member_phone.test.sql` pgTAP | 40 |
| 기존 `member_birthdays.test.sql` pgTAP | 54 |
| 기존 `member_directory_auth_boundary.test.sql` pgTAP | 5 |
| 합계 | 668 |

기존 1~100 migration을 먼저 재생하고 권한 있는 호출자로 기존 73점 행을 만든 뒤 새 migration을 적용했다. 적용 전에 0점 저장 거부를 확인했고 적용 후 다음을 검증했다.

- 전체 0점, 0·양수·100이 섞인 점수, 전체 100점을 정확히 저장하고 조회했다. 양수 또는 혼합 점수를 0으로 수정할 때 revision이 증가하며 오래된 revision은 거부됐다.
- 여섯 CHECK의 하한만 0으로 바뀌고 상한은 100이었다. 신뢰된 fixture 작성자의 직접 UPDATE에도 각 축 -1과 101은 CHECK 위반으로 거부됐다.
- 적용 전후 모든 public/private 함수의 OID·signature·반환형·인자·소유자·ACL·security 설정과 함수 정의를 비교했다. private 저장 함수의 하한 비교 및 두 오류 문구를 제외하면 모두 동일했다. public wrapper와 읽기 helper도 동일했다.
- 모든 테이블 ACL·RLS 상태·기존 정책·권한 행·기존 점수·revision·작성자·시각이 같았다. 다른 CHECK·FK·PK도 보존됐다.
- 일반 회원·권한 제외·비활동·초기 비밀번호·미연결 호출자는 기존대로 차단됐다. 숨김 QA 운영진과 일반 회원 역할인 시스템 관리자에 대한 기존 허용 기준도 유지됐다.
- 동시 최초 등록·수정은 실제 독립 PostgreSQL 연결 3개로 실행했다. 0점을 저장한 요청이 성공한 뒤 다른 요청은 `40001`을 받았으며 승자의 0점을 덮어쓰지 못했다. `pg_stat_activity`에서 실제 잠금 대기를 확인했다.
- 권한 제외·호출자 또는 대상 상태 변경·인증 연결 변경·profile 삭제 cascade의 경합, 감사정보 위조 차단, 원본 테이블의 직접 접근 금지와 우발적 grant 상황의 RLS 차단, 기존 계정 권한·전화번호·생일·디렉터리 회귀도 통과했다.

## 해시와 증거

- 새 migration SHA-256: `699bf44626f80bca37a54ae3c4d47f7928863f7ba2572ac71d251861ba8e9f14`
- 변경하지 않은 기존 migration SHA-256: `8ea5ac7a31dbecb29197958996def842b2f0f227b0d6735272ddff470ee9944f`
- 기존 profile·함수·정책·디렉터리 스냅샷 SHA-256: `8e878384a431cd4f8d17f98ec25aab790d0bf475f1a1116afe93b53e167c90ad`
- 새 migration 적용 직전 설치 상태 스냅샷 SHA-256: `1897a63da097f85557ecbe38b297c195d42330e53141f1958c53fba3acfd8ca5`
- 최종 검사 로그: `D:/station/.work/member-overall-zero-validation/verification-final.log`
- 클러스터 로그: `D:/station/.work/member-overall-zero-validation/postgres.log`

스냅샷 해시는 합성 시각·함수 OID를 포함하므로 재실행마다 달라질 수 있다. 같은 실행 안에서의 적용 전후 동일성 assertion이 보존 여부의 판단 기준이다. `node --check scripts/verify-member-overall.mjs`와 DB 담당 변경의 `git diff --check`도 통과했다.

## 재실행과 제한

새 빈 전용 클러스터와 `member_overall_zero_synthetic` DB를 준비한 뒤 저장소 루트에서 실행한다. 실행기는 루프백 DB 신원과 테이블이 없는 상태를 확인하므로 기존 DB에 fixture를 덧씌우지 않는다. 실패 후 재실행할 때도 이 합성 DB만 새로 준비한다.

```powershell
$env:OVERALL_PG_MODULE='D:\station\.work\db-batch-validation\runtime\node_modules\pg\lib\index.js'
$env:OVERALL_PGTAP_SQL='D:\station\welcome-validation\pgtap.sql.in'
node scripts/verify-member-overall.mjs
```

기존 합성 profile/Storage fixture와 실제 관련 함수·정책·migration을 재생한 검증이다. 전체 Supabase migration 이력, Auth/PostgREST HTTP 서버 또는 운영 카탈로그를 재현한 검증은 아니다. 공식 Supabase 함수·RLS 지침은 앞선 동일 기능 작업에서 확인한 내용을 재사용했다. 운영 DB 적용·advisor·migration history 검증은 루트의 후속 릴리스 단계에서 수행한다.

검증 종료 후 전용 55439 서버를 정상 종료했고 리스너가 없음을 확인했다. 새 클러스터 데이터와 로그는 보존했으며 기존 55438/55437 환경은 변경하지 않았다.

## 승인 후 운영 적용

사용자가 운영 DB 적용·웹 병합·배포를 승인한 뒤 검증한 SQL을 적용했다. 운영 이력 20261007134645에 파일명을 맞췄으며 SQL 바이트와 SHA256699bf44626f80bca37a54ae3c4d47f7928863f7ba2572ac71d251861ba8e9f14는 같다. 최초 격리 실행 로그와 해시 증거는 원본 그대로 보존했다. 실행기는 마이그레이션 이름을 자동 탐색하므로 코드 변경이 없었다.

운영 여섯 CHECK는 0~100, helper 본문 MD5는 b2d5b7302dc87cd8e15cb0ff040705b4다. 기존 점수 데이터 digest·행 수, 함수 OID·ACL·보안 설정·빈 search path·RLS·직접 읽기 차단은 적용 전후 동일했다. 보안·성능 advisor 신규 공지도 없다. 실제 운영 회원 점수를 입력·수정하지 않았다.
