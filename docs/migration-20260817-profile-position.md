# 포지션 도메인 마이그레이션 적용 지시서

`profiles.position`을 로스터 코드로 정규화하고 CHECK 제약을 추가한다.
원본 표기는 `profiles.position_detail`에 보존한다.
팀나누기(무작위 편성) 실패를 실제로 해소하는 단계다.

| 항목 | 상태 |
|---|---|
| 프런트엔드 | 배포 완료 (`353565c`) |
| 참가자 유실 방지 코드 | 배포 완료 — 균형 편성이 더 이상 조용히 실패하지 않는다 |
| 마이그레이션 | **미적용** |
| 팀 편성 (무작위·균형 모두) | **여전히 실패** |
| `db push` 사용 가능 여부 | **불가 — 이력 드리프트 확인됨 (2026-08-20)** |

## 왜 아직 안 고쳐졌나

이 저장소에는 GitHub Actions 워크플로가 없고 배포는 Vercel git 연동뿐이다.
**Vercel은 Supabase 마이그레이션을 적용하지 않는다.**
`main` 머지로 반영된 것은 화면 코드뿐이고,
DB에 남아 있는 잘못된 `position` 값은 그대로다.

## 두 가지 실패 방식

같은 잘못된 데이터가 편성 방식에 따라 서로 다르게 터진다.
처음에는 무작위 편성만 기록돼 있었으나, 균형 편성 쪽이 더 위험하다.

| 방식 | 경로 | 증상 |
|---|---|---|
| 무작위 | 전원이 RPC로 전달 | `event_team_members.participant_position`의 CHECK 위반 → 예외 → 전체 롤백 → **오류 표시, 팀 생성 안 됨** |
| 균형 | 포지션별 버킷팅 | 로스터 코드가 아닌 값이 **조용히 탈락** → 전원 탈락 시 팀만 생성되고 멤버 0명 → **오류 없음** |

균형 편성이 위험한 이유는 `save_event_teams`가 기존 팀을 먼저 `delete` 하기 때문이다.
멤버 없는 팀이 성공적으로 저장되면서 **직전 편성이 조용히 사라진다.**

2026-08-20 프로덕션 확인 시점에 `event_teams` 5행이 모두 `generation_mode = 'balanced'`,
`event_team_members`는 0행이었다. 위 균형 편성 경로가 실제로 발생한 흔적이다.

코드 쪽은 이후 수정됐다 — 로스터로 표현 못 하는 포지션은 탈락 대신 `ANY` 버킷으로 보내고,
분배 결과가 선택 인원과 다르거나 빈 팀이 생기면 RPC를 호출하지 않는다.
따라서 지금은 **조용한 실패와 기존 편성 삭제는 없지만, 편성이 성공하지도 않는다.**
RPC가 DB의 `profiles.position`을 직접 읽어 삽입하므로 CHECK 위반은 그대로다.
**이 마이그레이션이 적용되어야 실제로 동작한다.**

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

## 01. 이력 드리프트 — 확인 완료 (2026-08-20)

이전 판에서 "remote 전용 항목이 보이면 멈춘다"고 했던 조건에 **실제로 걸렸다.**
`npx supabase migration list --linked` 결과:

| 구분 | 개수 |
|---|---|
| 양쪽 일치 | 8 |
| **remote에만 있음** | **18** |
| local에만 있음 | 21 (초기 스키마 `20260808234223_club_platform` 포함) |

remote 전용 항목은 local 항목 몇 분 뒤 타임스탬프로 찍혀 있다
(`20260809045911` → `20260809050347`, `20260810203937` → `20260810204307`, …).
같은 변경이 **다른 ID로 원격에 기록된** 형태다.

### 스키마는 최신, 이력만 어긋났다

원격 스키마를 직접 조회해 확인했다.

| 확인 대상 | 출처(로컬 전용 마이그레이션) | 원격 |
|---|---|---|
| `venues` | `20260815205554` | 존재 |
| `event_guest_players` | `20260809055058` | 존재 |
| `attendance.check_in_status` | `20260816143000` | 존재 |
| `profiles.position_detail` | `20260817120000` | **없음** |

로컬 전용 21개 중 확인한 것들은 이미 원격에 반영돼 있고,
진짜로 빠진 것은 `20260817120000` 하나다.

> ### `npx supabase db push`를 실행하지 말 것
> 이미 적용된 20개를 초기 스키마부터 다시 재생하려 든다.
> `create table` 충돌로 실패하거나, 중간까지 적용된 상태를 프로덕션에 남긴다.
> 이력이 정리되기 전까지 이 저장소에서 `db push`는 사용 불가다.

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

## 03. 마이그레이션 적용 — 필요한 하나만

`db push`가 막혔으므로(01단계) **이 파일 하나만** 적용하고 이력을 손으로 맞춘다.

1. Dashboard → SQL Editor에서
   `supabase/migrations/20260817120000_constrain_profile_position.sql` 전체를 실행한다.
2. 성공하면 이력에 기록한다.

   ```powershell
   npx supabase migration repair --status applied 20260817120000
   ```

**2번을 빠뜨리지 않는다.** 기록하지 않으면 드리프트가 한 칸 더 벌어진다.
아래 "하지 말 것"의 SQL Editor 금지 조항은 `repair`와 짝지을 때만 예외다.

이 파일은 트랜잭션 안에서 실행된다.
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

## 남은 일

| # | 할 일 | 상태 | 막힌 이유 |
|---|---|---|---|
| 1 | `20260817120000` 적용 (03단계) | **미완료** | DB 접근 권한 필요 — 사람이 실행해야 한다 |
| 2 | `migration repair`로 이력 기록 | 미완료 | 1번 이후 |
| 3 | 팀 편성 실제 동작 확인 (05단계) | 미완료 | 1번 이후 |
| 4 | 이력 드리프트 전체 정리 | **미착수** | 아래 참고 |
| 5 | 마이그레이션 자동 적용 파이프라인 | 미착수 | 아래 참고 |

### 4. 이력 드리프트 정리

로컬 전용 21개를 원격 18개와 하나씩 대조해,
이미 반영된 것은 `migration repair --status applied`로,
원격 전용인데 로컬에 파일이 없는 것은 `db pull`로 파일을 복원해 맞춘다.
이 작업이 끝나기 전까지 `db push`는 쓸 수 없다.
지금은 매 마이그레이션을 SQL Editor + `repair`로 수동 적용해야 한다.

### 5. 자동 적용 파이프라인

이 저장소에는 GitHub Actions가 없고 Vercel은 Supabase를 건드리지 않는다.
그래서 마이그레이션이 밀려 이번 문제가 생겼다.
4번을 끝낸 뒤 `main` 머지 시 `supabase db push`를 돌리는 워크플로를 붙이면
같은 유형의 사고가 반복되지 않는다.
`SUPABASE_ACCESS_TOKEN`과 DB 비밀번호를 저장소 시크릿으로 등록해야 한다.

---

## 실패 시 대응

| 증상 | 원인 | 대응 |
|---|---|---|
| `Cannot map these position values...` | 별칭 목록에 없는 표기 | 찍힌 값 공유 → 별칭 추가 후 재실행. DB는 무변경 |
| link 단계에서 인증 실패 | DB 비밀번호 불일치 | Dashboard → Project Settings → Database에서 재설정 |
| `Cannot find project ref` | 링크 미수립 | 01단계의 `link`를 먼저 실행 |
| 다른 마이그레이션에서 중단 | 밀려 있던 과거 파일 충돌 | 진행 멈추고 전체 출력 공유 — 임의 수정 금지 |
| `db push`가 과거 파일부터 재생 | 01단계의 이력 드리프트 | 중단. `db push`는 이 저장소에서 사용 불가다 |
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

- **SQL Editor 실행 뒤 `migration repair`를 빠뜨리지 않는다.**
  원칙은 조회·검증 쿼리만 SQL Editor에서 돌리는 것이다.
  이력이 어긋나 `db push`를 못 쓰는 지금은 03단계처럼 SQL Editor로 적용하되,
  반드시 `repair --status applied`로 `supabase_migrations`에 기록해야 한다.
  기록을 빠뜨리면 드리프트가 더 벌어진다.
- **`db push`를 실행하지 않는다.** 이력이 정리되기 전까지는 프로덕션을 망가뜨린다.
- **매핑 실패 예외를 우회하지 않는다.** 그 예외가 데이터 손실을 막는 장치다.
- **비밀번호를 명령줄에 넣지 않는다.** 히스토리와 로그에 남는다.
