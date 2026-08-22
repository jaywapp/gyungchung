# ADR-0001: 클럽하우스 클라이언트 일괄 데이터 로딩을 당분간 유지한다

| 항목 | 값 |
|---|---|
| 상태 | 승인 (2026-08-22) |
| 관련 이슈 | #131 (Severity: Low, Category: Performance) |
| 결정 | 지금은 구조를 바꾸지 않는다. 재검토 트리거를 명시하고 계측만 준비한다. |
| 영향 파일 | `components/clubhouse.tsx`, `lib/ui-feedback.ts`, `lib/load-state.ts` |

## 맥락

### 관찰된 사실 (이슈 #131)

어느 페이지로 진입하든 클라이언트가 앱 전체 데이터셋을 한 번에 가져온다.

- `/rankings` 단일 하드 내비게이션 기준 Supabase REST 요청 **18건**
- 그중 8건이 조건 없는 `select=*` 조회 (`profiles`, `fees`, `attendance`, `feedback`, `guest_players`, `participation_forms`, `event_guest_fees`, `event_mom_votes`)
- `events` 다단 중첩 조인 1건 + RPC 4건
- 응답은 전부 200, 실패 없음
- 현재 활성 회원 26명, 체감 지연 없음

### 실제 구조

`app/(clubhouse)/layout.tsx`가 모든 섹션을 `Clubhouse` 클라이언트 컴포넌트로 감싼다. 각 라우트의 `page.tsx`는 메타데이터만 내보내고 `null`을 반환한다. 화면 선택은 `usePathname()` 결과로 `Clubhouse` 내부에서 이뤄진다.

이 구조에서 나오는 성질이 이번 판단의 핵심이다.

1. **로딩 지점은 두 곳뿐이다.** `loadPublicData`(4건)와 `loadMemberData`(14건). 둘 다 `components/clubhouse.tsx`의 `useCallback`이며, 각각 하나의 `Promise.all` 배치다. 흩어진 훅이나 컴포넌트별 개별 fetch는 없다 — 다른 컴포넌트의 `.from()` 호출은 전부 변경(mutation)이다.
2. **트리거는 라우트가 아니라 인증 상태다.** `supabase.auth.onAuthStateChange` 안에서 `authLoadKeyRef`로 중복을 막고 한 번만 호출한다. 즉 18건은 **하드 내비게이션(직접 URL 진입·새로고침) 1회당 1번**이며, 이후 섹션 간 이동은 클라이언트 라우팅이라 `Clubhouse`가 언마운트되지 않는다. **페이지를 옮겨도 재로드되지 않는다.**
3. **공유 범위가 넓다.** 18개 결과는 `Clubhouse`의 18개 `useState`에 담겨 props로 내려간다. Context도 props drilling도 없고 깊이는 한 단계다. 대신 소비자가 겹친다 — `events`는 홈·회비·일정·랭킹·관리·일정상세·에디터 7곳, `attendance`는 6곳, `profiles`는 5곳이 읽는다.
4. **Supabase 클라이언트는 브라우저 전용이다.** `lib/supabase/client.ts`의 `createBrowserClient` 하나뿐이고 서버 클라이언트는 존재하지 않는다. 권한 분리는 전적으로 RLS가 담당한다.
5. **4상태 계약이 props로 고정돼 있다.** 모든 섹션이 `loading → error → empty → data` 순서로 읽고, `loading`은 `publicLoading`/`memberLoading`/`authLoading`의 조합, `loadError`는 `lib/load-state.ts`의 리소스 키에서 온다.

### 라우트별로 실제 쓰이는 요청 수

로그인한 일반 회원 기준. `profiles`(본인 프로필), `role_permissions`, `officer_permissions` 3건은 헤더 계정 버튼과 네비게이션의 `관리` 링크 노출에 쓰이므로 어느 라우트에서든 필요하다.

| 라우트 | 화면이 실제로 읽는 요청 | 쓰이지 않는 요청 |
|---|---|---|
| `/` | 8 | 10 |
| `/members` | 4 | 14 |
| `/fees` | 6 | 12 |
| `/notices` | 4 | 14 |
| `/events` | 5 | 13 |
| `/events/[date]` | 8 | 10 |
| `/rankings` | **6** | **12** |
| `/feedback` | 4 | 14 |
| `/participation` | 5 | 13 |
| `/admin` | 13 | 5 |

이슈가 지적한 `/rankings`는 18건 중 6건(`events`, `get_member_rankings`, `get_mom_leaderboard`, `profiles`, `role_permissions`, `officer_permissions`)만 쓴다. `feedback` 전체 조회가 랭킹 화면에 필요 없다는 지적은 사실이다.

다만 **세션 단위로 보면 낭비가 훨씬 작다.** 클라이언트 라우팅이라 한 번 받은 데이터는 세션 내내 재사용된다. 홈 → 일정 → 랭킹을 도는 일반적인 흐름의 합집합은 10건이고, `/feedback`·`/participation`·`/admin`·`/events/[date]`를 한 번도 열지 않아야만 8건이 끝까지 낭비된다. 즉 실제 절감 가능분은 "페이지당 12건"이 아니라 **"세션당 최대 8건"** 이다.

### `select=*`가 실제로 무엇을 가져오는가

RLS가 서버에서 이미 대부분을 좁힌다. "조건 없는 전체 테이블 조회"는 일반 회원에게는 사실이 아니다.

| 쿼리 | 일반 회원이 받는 행 | 운영진이 받는 행 |
|---|---|---|
| `profiles` | 본인 1행 | 전체 (`members.manage`) |
| `fees` | 본인 행만 | 전체 (`fees.manage`) |
| `feedback` | 본인이 쓴 것만 | 전체 (`feedback.manage`) |
| `event_mom_votes` | 본인 투표만 | 본인 투표만 |
| `event_guest_fees` | **0행** (`fees.manage` 필요) | 전체 |
| `guest_players` | **0행** (`events.manage` 필요) | 전체 |
| `participation_forms` | 공개(open/closed) 폼 | 전체 |
| `attendance` | **전량** (`using (true)`) | 전량 |

정말로 무제한인 것은 두 개뿐이다.

- `attendance` — 유일하게 `using (true)`인 회원 데이터. 행 수가 `일정 수 × 응답 회원 수`로 자란다.
- `events` 중첩 조인 — `event_teams → event_team_members`, `event_matches → event_match_players / event_match_scorers`까지 한 번에 끌어온다. 날짜 필터가 없어 클럽 전체 경기 이력을 매번 받으며, **로그인하지 않은 방문자도 받는다.** 성장 속도가 가장 빠른 쿼리다.

컬럼 관점에서는 `select=*` 좁히기의 실익이 거의 없다. `lib/types.ts`의 인터페이스가 이미 테이블 컬럼과 거의 1:1이고, 앱은 사실상 전 컬럼을 쓴다. 명시 목록으로 바꿔서 줄어드는 것은 행당 `created_at`/`updated_at`/`note` 같은 1~3개 컬럼뿐이다.

| 테이블 | 테이블 컬럼 | 앱이 쓰는 컬럼 | 좁혀서 빠지는 것 |
|---|---|---|---|
| `profiles` | 17 | 15 | `created_at`, `updated_at` |
| `fees` | 11 | 8 | `note`, `created_at`, `updated_at` |
| `attendance` | 7 | 6 | `updated_at` |
| `feedback` | 20 | 19 | `updated_at` |
| `event_mom_votes` | 4 | 4 | 없음 |

게다가 `AdminEditor`는 행을 `Record<string, unknown>`으로 받아 `row.<컬럼>`으로 직접 읽는다. 명시 목록으로 바꾸면 컬럼을 추가할 때마다 `select` 문자열을 함께 고쳐야 하고, 빠뜨리면 **타입 검사에 걸리지 않고 런타임에 조용히 `undefined`가 된다.** 얻는 바이트에 비해 부채가 크다.

### 더 큰 비용은 초기 로드가 아니라 재로드 증폭이다

저장·삭제마다 `reload(scope)`가 돈다 (`lib/ui-feedback.ts`의 `tableScopes`/`editorScopes`).

- `reload("all")` → 18건
- `reload("member")` → 14건
- `reload("public")` → 4건

관리자 화면에서 출석을 한 번 저장하면 RPC 1건 + 재조회 14건이다. 운영진이 연달아 저장하는 흐름에서는 초기 18건보다 이쪽이 먼저 아프다. 다만 이 역시 현재 규모에서는 보고된 증상이 없다.

## 검토한 선택지

### A. 라우트 스코프 지연 로딩

소비자가 한 화면뿐인 리소스를 그 화면 진입 시에만 로드한다. 후보는 명확하다 — `event_mom_votes`/`get_event_mom_results`는 `EventDetail`만, `participation_submissions`는 `ParticipationHub`만, `event_guest_fees`는 `AdminConsole`만 읽는다.

비용과 위험:

- 4상태 계약에 "아직 요청하지 않음" 상태가 새로 생긴다. 스코프별 pending 플래그를 각 섹션의 `loading`에 OR로 합치지 않으면, 데이터가 오기 전에 **빈 상태가 먼저 깜빡인다.**
- 지금은 섹션을 옮겨도 데이터가 이미 있어 즉시 그려진다. 지연 로딩은 **없던 스켈레톤을 새로 만든다.** UX 점검 과정에서 UX를 되돌리는 변경이다.
- `reload(scope)`가 "로드된 스코프만 다시 받는다"는 장부를 들고 있어야 한다. 인증 변경 시 초기화, 빠른 탭 전환 시 경쟁 조건도 새로 생긴다.
- `venues`/`guest_players`를 `/admin`으로 미루면 **일정·회비·회원 화면의 빠른 편집기가 깨진다.** `AdminEditor`는 `/admin` 밖에서도 열리고 구장 선택과 팀 편성에 두 데이터를 쓴다. 겉보기에 안전한 후보에 이미 함정이 있다.
- 절감은 세션당 최대 8건. 라우트당 12건이 아니다.

### B. 서버 컴포넌트로 경계 이동

각 `page.tsx`가 서버에서 필요한 것만 읽어 내려준다.

비용과 위험: `@supabase/ssr` 서버 클라이언트 도입, 쿠키 기반 세션 처리, RLS 적용 지점 이동, `Clubhouse`가 들고 있는 18개 공유 상태의 재설계, `reload`/낙관적 RSVP 갱신 경로 재작성이 동시에 필요하다. 이번 UX 점검의 범위를 명백히 넘는다.

### C. `select=*`를 실제 사용 컬럼으로 좁히기

요청 **건수는 그대로**이고 행당 timestamp 1~3개만 줄어든다. 대신 `AdminEditor`의 `Record<string, unknown>` 경로에 조용한 런타임 파손 위험을 새로 만든다. 이익 대비 위험이 맞지 않는다.

### D. 운영진 전용 데이터를 권한 확인 후 2차 배치로 분리

`event_guest_fees`·`guest_players`는 일반 회원에게 RLS가 0행을 돌려주므로 왕복이 순수 낭비다. 다만 권한(`role_permissions`/`officer_permissions`)이 같은 배치에서 오기 때문에, 이를 분리하면 하나의 병렬 배치가 **2단 워터폴**이 된다. 일반 회원은 2건을 아끼지만 운영진은 왕복 1회를 더 기다린다. 그리고 A와 같은 로딩 상태 문제를 그대로 안는다.

### E. 현행 유지 + 계측·트리거 정의 (선택)

## 결정

**지금은 코드를 바꾸지 않는다.** 인증 방식, RLS, 권한 정책, 컴포넌트 경계, 라우팅 구조 모두 그대로 둔다. 대신 언제 다시 열지를 수치로 못 박고, 착수 순서를 미리 정해 둔다.

근거는 넷이다.

1. **일괄 로딩은 사고가 아니라 이 구조에서 나오는 이득이다.** SPA 셸이 언마운트되지 않으므로 선행 로드 18건은 이후 모든 섹션 이동을 0건으로 만든다. 지연 로딩은 비용을 없애는 게 아니라 뒤로 옮기는 쪽에 가깝고, 세션당 실절감은 최대 8건이다.
2. **`select=*`는 오탐에 가깝다.** RLS가 일반 회원에게 대부분 0~N행으로 좁히고, 컬럼도 앱이 거의 다 쓴다. 좁혀서 얻는 것이 없다.
3. **안전해 보이는 국소 개선에 실제 함정이 있다.** `venues`/`guest_players`를 관리자 화면으로 미루는 가장 그럴듯한 안이 `/events`·`/fees`의 빠른 편집기를 깬다. 브라우저 검증도 타입 검사도 이 작업 범위에서 돌릴 수 없는 상태에서 감수할 위험이 아니다.
4. **증상이 없다.** 26명, 전부 200, 체감 지연 없음. 실측 없이 구조를 바꾸면 개선했는지조차 증명할 수 없다.

## 받아들이는 비용

- 데이터가 늘면 초기 payload가 선형으로 악화된다. 특히 `attendance`와 `events` 중첩 조인.
- 운영진의 저장 1회가 14~18건의 재조회를 부른다.
- 랭킹 화면이 `feedback` 전체를 받는 식의 논리적 부정합은 남는다.

## 재검토 트리거

**하나라도 충족되면 이 ADR을 다시 연다.**

| 트리거 | 임계값 | 현재 |
|---|---|---|
| 활성 회원 수 | 60명 초과 | 26명 |
| 누적 일정 수 | 200건 초과 — `events` 중첩 조인의 성장 지점 | — |
| `attendance` 행 수 | 3,000행 초과 (`using (true)`라 전 회원이 전량 수신) | — |
| 하드 내비게이션 1회 응답 총량 | 500KB 초과 | — |
| 모바일 4G `/rankings` LCP | 2.5초 초과 | 체감 지연 없음 |
| 로그인 후 첫 데이터 표시까지 | 1.5초 초과 | 체감 지연 없음 |
| Supabase egress | 요금제 한도의 50% 초과 | — |
| 운영진 보고 | 관리자 화면에서 "저장할 때마다 느리다" | 없음 |

수치가 비어 있는 항목은 아직 측정하지 않았다는 뜻이다. 아래 1단계가 그것을 채운다.

## 착수할 때의 단계별 계획

추정이 아니라 실측으로 시작하고, 위험이 낮고 효과가 확실한 것부터 간다.

1. **계측 (선행 필수)** — 하드 내비게이션 1회의 요청 건수·응답 크기·소요 시간과 위 표의 행 수를 실제로 기록한다. 이후 모든 단계의 전후 비교 기준이 된다.
2. **`reload` 스코프 세분화** — `ReloadScope`를 `"all" | "public" | "member"` 3분류에서 리소스 키 집합으로 바꾼다. 회비 저장이 출석·의견·랭킹까지 다시 받지 않게 된다. `lib/ui-feedback.ts`의 `tableScopes`/`editorScopes`와 `lib/load-state.ts`만 바뀌고 **화면의 4상태 계약은 건드리지 않는다.** 가장 싸고 효과가 즉시 보이는 단계다.
3. **`attendance`·`events` 범위 제한** — `attendance`를 최근 N개월로 자르고, 랭킹·출석 집계는 이미 있는 RPC 방식으로 서버에 넘긴다. `lib/attendance.ts`와 관리자 출석 편집기가 "전체 이력이 클라이언트에 있다"를 전제하는지 먼저 확인한다. `events`도 목록용 얕은 조회와 상세용 중첩 조회로 나눈다.
4. **단일 소비자 리소스부터 라우트 스코프 지연 로딩** — `event_mom_votes`/`get_event_mom_results` → `/events/[date]`, `participation_submissions` → `/participation`, `event_guest_fees` → `/admin` 순서. 각 섹션 `loading`에 스코프별 pending을 합치고, **새로 생기는 스켈레톤을 UX 관점에서 먼저 승인받는다.** `venues`/`guest_players`는 `AdminEditor` 의존 때문에 이 단계에 넣지 않는다.
5. **그래도 부족하면 서버 컴포넌트 경계 이동** — 서버 Supabase 클라이언트, 쿠키 세션, RLS 적용 지점, 공유 상태 재설계를 한 묶음으로 다루는 **별도 과제**로 계획한다. 성능 개선의 곁가지로 끼워 넣지 않는다.

## 참고

- `components/clubhouse.tsx` — `loadPublicData`(109행~), `loadMemberData`(130행~), `reload`(170행~), 인증 상태 이펙트(177행~)
- `app/(clubhouse)/layout.tsx` — 셸이 언마운트되지 않는 이유
- `lib/load-state.ts` — 리소스 키와 `getLoadErrors`
- `lib/ui-feedback.ts` — `ReloadScope`, `tableScopes`, `editorScopes`
- `lib/supabase/client.ts` — 브라우저 클라이언트 단일 진입점
- `supabase/migrations/20260808234223_club_platform.sql` — `attendance`/`fees`/`feedback` RLS
- `supabase/migrations/20260810114056_secure_profile_directory.sql` — `profiles` 조회 제한과 `get_member_directory`
- `supabase/migrations/20260821223412_hidden_test_account_visibility.sql` — 현재 디렉터리·랭킹 RPC 정의
