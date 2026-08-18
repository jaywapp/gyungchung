# 포지션 도메인 마이그레이션 적용 지시서

`profiles.position`을 로스터 코드로 정규화하고 CHECK 제약을 추가한다.
원본 표기는 `profiles.position_detail`에 보존한다.
팀나누기(무작위 편성) 실패를 실제로 해소하는 단계다.

| 항목 | 상태 |
|---|---|
| 프런트엔드 | 배포 완료 (`353565c`) |
| 마이그레이션 | **미적용** |
| 무작위 편성 | **여전히 실패** |

## 왜 아직 안 고쳐졌나

이 저장소에는 GitHub Actions 워크플로가 없고 배포는 Vercel git 연동뿐이다.
**Vercel은 Supabase 마이그레이션을 적용하지 않는다.**
`main` 머지로 반영된 것은 화면 코드(포지션 드롭다운, 오류 메시지)뿐이고,
DB에 남아 있는 잘못된 `position` 값은 그대로다.

기존 값이 `event_team_members.participant_position`의 CHECK를 위반해
`save_event_teams` RPC 전체가 롤백되는 것이 실패 원인이다.

## 이 마이그레이션이 하는 일

1. `profiles.position_detail` 컬럼 추가 — 회원이 입력한 원본 표기를 보존한다.
2. **매핑 검사** — 로스터 코드로 읽을 수 없는 값이 하나라도 있으면 예외를 던지고 전체를 롤백한다.
3. `position`을 단일 로스터 코드로 정규화하고, 원본과 다른 행만 `position_detail`에 원본을 남긴다.
4. `profiles_position_check` 제약 추가.

### 복수 포지션 처리 규칙

`LW, RW, LWB`처럼 여러 포지션을 적은 값은 **첫 항목**을 대표 포지션으로 삼는다.
구분자는 `,` `/` `|` `·` `&`. 비교 전 `upper(btrim(...))`를 거친다.

| 결과 코드 | 인식하는 표기 |
|---|---|
| `GK` | GK · G · 골키퍼 · 키퍼 · 골리 |
| `DF` | DF · DEF · D · CB · LB · RB · WB · LWB · RWB · FB · SW · 수비 · 수비수 · 센터백 · 풀백 · 윙백 · 리베로 |
| `MF` | MF · M · CM · DM · AM · CDM · CAM · CMF · DMF · AMF · LM · RM · 미드 · 미들 · 미드필더 · 수비형미드필더 · 공격형미드필더 |
| `FW` | FW · F · ST · CF · SS · LW · RW · LWF · RWF · WF · 공격 · 공격수 · 스트라이커 · 윙어 · 윙포워드 |
| `ANY` | ANY · 무관 · 상관없음 · 전천후 · 아무데나 |

`LW, RW, LWB` → 첫 항목 `LW` → `FW`, 원본은 `position_detail`에 보존.

> **표에 없는 표기가 하나라도 있으면 마이그레이션이 실패한다.**
> 이는 의도된 동작이다. 값을 조용히 `null`로 만드는 대신 중단해서 데이터 손실을 막는다.
> 예외 메시지에 매핑 불가 값이 배열로 찍히므로, 그 표기를 별칭 목록에 추가하고 다시 실행한다.

## 적용 대상

| | |
|---|---|
| 파일 | `supabase/migrations/20260817120000_constrain_profile_position.sql` |
| 프로젝트 | gyungchung · Northeast Asia (Seoul) |
| Project ref | `pamvwzgqkzgsygslmfqo` |
| 작업 위치 | `D:\workspace\repositories\apps\gyungchung` |
| 필요 권한 | Supabase DB 비밀번호 (Dashboard → Project Settings → Database) |

---

## 01. 링크하고 마이그레이션 이력 확인

`db push`는 이번 파일만이 아니라 **원격에 없는 모든 마이그레이션**을 순서대로 적용한다.

```powershell
npx supabase link --project-ref pamvwzgqkzgsygslmfqo
npx supabase migration list --linked
```

**출력 전체를 저장한다.** 원격 26개 / 로컬 29개로 확인됐는데, 두 해석이 가능하다.

- **정상** — 최근 3개(`accept_auth_phone_format`, `add_attendance_check_in_status`,
  `constrain_profile_position`)가 미적용. CI가 없어 쌓인 것뿐이므로 그대로 진행 가능.
- **드리프트** — 로컬에 파일이 없는 원격 전용 이력이 있음.
  초기 커밋 `8f9d28b`에서 `202608090001_initial_schema.sql`이 삭제된 이력이 있어,
  이 버전이 원격에 남아 있을 수 있다.

> **Remote에만 있는 항목이 보이면 여기서 멈춘다.** 출력을 공유하고 이력 정리 방안을 먼저 정한다.

> **비밀번호는 프롬프트로만 입력한다.** `-p` 플래그는 셸 히스토리에 남는다.

## 02. 매핑되지 않는 값 미리 확인 (선택)

건너뛰어도 데이터는 안전하다 — 매핑 불가 값이 있으면 03단계가 스스로 중단한다.
다만 미리 보면 `db push` 실패를 한 번 겪지 않아도 된다.

Supabase Dashboard → SQL Editor:

```sql
select "position", count(*)
from public.profiles
where "position" is not null and btrim("position") <> ''
group by 1
order by 2 desc;
```

위 별칭 표와 대조해 첫 항목이 인식되지 않는 값이 있으면 공유한다.

## 03. 마이그레이션 적용

```powershell
npx supabase db push
```

각 마이그레이션 파일은 트랜잭션 안에서 실행된다.
매핑 검사가 예외를 던지면 컬럼 추가까지 통째로 롤백되므로 어중간한 상태로 남지 않는다.

`Cannot map these position values onto a roster code: {...}` 예외가 나오면
찍힌 값을 그대로 공유한다. 별칭 목록에 추가해 후속 PR로 올린다.

`protect_account_roles_before_write` 트리거는 `profiles`의 모든 UPDATE에 걸리지만,
이 마이그레이션은 `role`·`officer_title`·`fee_plan`·`is_system_admin`을 건드리지 않고
이미 올바른 행은 `where`에서 제외하므로 예외를 일으키지 않는다.

## 04. DB 상태 검증

```sql
-- 제약 존재 확인
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.profiles'::regclass
  and conname = 'profiles_position_check';
```

```sql
-- 정규화 결과와 보존된 원본 확인
select coalesce("position", '(미정)') as position, count(*) as members,
       count(position_detail) as with_detail
from public.profiles
group by 1
order by 2 desc;
```

```sql
-- 보존된 원본 표기 확인
select name, "position", position_detail
from public.profiles
where position_detail is not null
order by name;
```

**기대 결과** — 제약 한 줄이 조회되고, 분포에 `GK`·`DF`·`MF`·`FW`·`ANY`·`(미정)` 외의 값이 없으며,
복수 포지션을 적었던 회원(약 22명)의 원본이 `position_detail`에 남아 있어야 한다.

## 05. 기능 확인

<https://gyungchung.vercel.app>에 운영진 계정으로 로그인해
**팀 편성 수정 → 무작위 편성 → 팀나누기**를 실행한다. 정상 저장되면 해결된 것이다.

같은 화면에서 **균형 편성**도 한 번 돌려본다.
이전에는 포지션이 잘못된 회원이 조용히 빠졌으므로, 이제 전원이 팀에 포함되는지 인원수로 확인한다.

회원 관리에서 **등록 포지션**이 드롭다운(미정 / GK / DF / MF / FW / 상관없음)으로 바뀌었는지도 확인한다.

---

## 실패 시 대응

| 증상 | 원인 | 대응 |
|---|---|---|
| `Cannot map these position values...` | 별칭 목록에 없는 표기 | 찍힌 값 공유 → 별칭 추가 후 재실행. DB는 무변경 |
| link 단계에서 인증 실패 | DB 비밀번호 불일치 | Dashboard → Project Settings → Database에서 재설정 |
| `Cannot find project ref` | 링크 미수립 | 01단계의 `link`를 먼저 실행 |
| 다른 마이그레이션에서 중단 | 밀려 있던 과거 파일 충돌 | 진행 멈추고 전체 출력 공유 — 임의 수정 금지 |
| 적용 후 회원 저장 실패 | 구버전 화면이 캐시됨 | 강력 새로고침으로 최신 배포 로드 |

### 롤백

제약을 먼저 제거한 뒤 원본을 되돌린다.

```sql
alter table public.profiles
drop constraint profiles_position_check;

update public.profiles
set "position" = position_detail
where position_detail is not null;
```

`position_detail`이 남아 있으므로 원본 표기는 그대로 복원된다.
컬럼까지 제거하려면 복원 후 `alter table public.profiles drop column position_detail;`.

## 하지 말 것

- **SQL Editor에 마이그레이션 내용을 직접 붙여넣지 않는다.**
  `supabase_migrations` 이력에 기록되지 않아 다음 `db push`에서 드리프트가 난다.
  조회·검증 쿼리만 SQL Editor에서 실행한다.
- **매핑 실패 예외를 우회하지 않는다.** 그 예외가 데이터 손실을 막는 장치다.
- **비밀번호를 명령줄에 넣지 않는다.** 히스토리와 로그에 남는다.
