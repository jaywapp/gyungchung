# 회원 오버롤 독립 리뷰

2026-10-07 · `codex/member-overall` · 기준 `0edb7fc` · 웹 기능만 검토

## 현재 판정

**SHIP — 웹 변경의 코드 리뷰를 통과했다.** 리뷰·브라우저 검증에서 확인한 P2 세 건을 모두 수정했고, 현재 남은 P1/P2는 없다. 최종 소스와 전체 검사·프로덕션 빌드·브라우저 검증 증거를 대조했다. 운영 DB 적용과 운영 배포 완료를 뜻하는 판정은 아니며, 해당 단계의 migration 이력·API·운영 URL 검증은 릴리스 담당이 진행한다. 앱은 요청된 웹 점검 이후 별도 동기화 요청까지 보류한다.

독립 reviewer는 제품 코드를 수정하거나 운영 데이터에 쓰기 작업을 수행하지 않았다.

## 발견 후 해결한 사항

1. **[P2] 저장된 팀의 대상 상태 변경 시 이전 점수가 남음** — `components/team-overall-summary.tsx`, `components/event-detail.tsx`, `components/admin-console.tsx`
   - 점수를 조회한 뒤 다른 운영진이 선수를 비활동·숨김으로 변경하고 최신 profiles를 받아도, 저장된 팀의 roster ID와 actor scope/version이 그대로면 요약 identity가 바뀌지 않는다. 기존 선수 점수와 팀 평균이 유지된다.
   - DB 조회는 활동 중인 공개 대상만 반환하므로 이미 확인된 대상 자격 변경을 화면 캐시에 반영해야 한다. 최신 대상 목록·signature를 요약에 전달하고 캐시와 늦은 응답을 폐기하는 수정이 필요하다.
   - 확신도: 소스 흐름으로 확인됨. 이벤트 상세는 요약에 profiles를 전달하지 않고, 편성 화면은 선택한 회원만 전달한다.
   - 해결 확인: `targetProfiles`를 필수로 받아 두 호출부가 전체 최신 profiles를 전달한다. 저장·선택 대상 전체의 Auth 연결/상태/숨김/미존재 signature가 렌더 세대와 늦은 응답 guard에 포함된다. 실제 평균도 최신 활동 대상의 행만 사용한다. 비활동·숨김·목록 제거·대상 ABA·렌더 없는 객체 상태 변경 회귀 검증을 확인했다.
2. **[P2] 능력치 관리 탭의 조회 실패·재시도 안내 누락** — `components/clubhouse.tsx`, `components/admin-console.tsx`
   - `sectionLoadErrors`에 `ratings`가 없다. 권한 관련 조회 실패로 `overallReady=false`가 되면 이전 permissions는 능력치 탭을 유지하지만 `overallAccess=null`이라 내용이 사라진다. 오류·재시도 표시가 없다.
   - profiles/memberDirectory/officerPermissions/rolePermissions 오류를 해당 탭에 연결하거나 능력치 접근 준비 실패에 대한 재시도를 제공해야 한다.
   - 확신도: 소스 흐름으로 확인됨.
   - 해결 확인: ratings의 4개 조회 오류를 연결하고, 접근 객체가 없어도 해당 4개 자원을 다시 읽는 LoadError 경로를 추가했다.
3. **[P2] 재조회 후 포커스를 잃어 회원 대화상자의 Escape가 동작하지 않음** — `components/member-overall-panel.tsx`, `components/team-overall-summary.tsx`
   - 초기 실제 브라우저 검증에서 재조회 버튼이 사라지면 포커스가 body로 옮겨가 대화상자의 Escape 처리에 도달하지 않았다. 데스크톱·좁은 웹 화면에서 동일하게 확인됐다.
   - 해결 확인: 유지되는 section에 ref와 `tabIndex=-1`을 두고, 포커스가 body이며 같은 actor·대상 세대이고 여전히 마운트·연결된 경우만 복구한다. 다른 요소를 사용 중인 경우와 actor/target 변경·unmount에서 포커스를 가져오지 않는 회귀 검증을 확인했다. 실패한 두 viewport의 입력 흐름을 다시 실행해 Escape 닫기와 원래 버튼 포커스 복원을 확인했다.

## 확인된 경계

- private 테이블, 기본 거부 RLS, 원본 직접 grant 없음. public invoker와 private definer 모두 직접 호출하더라도 최신 actor 권한 검사를 통과해야 한다. definer search path는 비어 있다.
- 일반 회원은 본인 점수도 조회할 수 없다. 일반 회원 역할의 시스템 관리자와 기존 정책상 허용된 숨김 QA 운영진은 허용한다. 숨김·비활동 평가 대상은 제외한다.
- 정확히 6개 1~100 정수, 양의 저장 revision, 생성 revision 0, 서버 감사 필드, 조건부 INSERT/UPDATE CAS를 확인했다. 기존 공개 경기 평점·회원 디렉터리 payload에 능력치를 합치지 않는다.
- actor와 target profile 및 권한 행의 SHARE NOWAIT 잠금은 비키 상태 변경도 차단한다. 충돌 시 재조회하고 결과 불명확 시 임의 재저장하지 않는다.
- clubhouse의 수락된 actor key와 단조 증가 generation을 확인했다. actor 권한 취소·복원, Auth 연결/직책/상태 변경, 검증 실패가 이전 요청의 scope를 폐기한다. 같은 actor의 성공적인 새 검증은 입력을 불필요하게 버리지 않는다.
- 회원 메뉴는 능력치 권한과 회원 편집 권한을 따로 검사한다. 관리 탭도 ratings.manage만 가진 운영진에게 별도 진입을 제공한다.
- 회원 패널의 렌더 세대 검사, 늦은 read/save 폐기, 입력 오류, 충돌·저장 결과 불명확 복구와 숫자형 차트 대안을 확인했다.

## 검증 증거와 제한

- `docs/member-overall-db-validation.md`와 원본 `D:/station/.work/member-overall-validation/verification-final.log`를 대조했다. PostgreSQL 17.6의 독립 3연결 검증 417개와 pgTAP 197개가 통과했다.
- 로그에 기록된 마이그레이션 SHA-256은 `8ea5ac7a31dbecb29197958996def842b2f0f227b0d6735272ddff470ee9944f`다.
- 기존 함수/ACL/RLS/회원/생일/권한 제외/디렉터리 결과를 before/after로 비교하는 회귀 검증과 public/private 직접 호출, RLS 기본 거부, 실제 CAS 및 권한 경합 검증 구조를 읽었다. 실행 중인 격리 DB를 중복 조작하지 않았다.
- production JSX와 콜백을 실행하는 자체 hook adapter 테스트를 읽었고 실제 브라우저 결과로 보완했다.
- `.ux-review/member-overall/`의 최종 원본 테스트·타입·lint·빌드·DB smoke 로그와 `source-evidence.json`을 읽었다. 전체 362개 중 361 통과·기존 1 skip·실패 0, 타입 검사 0, lint 오류 0(기존 경고 2), 프로덕션 21개 페이지 생성 완료다. reviewer가 최종 15개 소스 파일의 SHA-256을 다시 독립 계산해 증거와 모두 일치함을 확인했다.
- root의 읽기 전용 DB/client parser smoke는 회장·부회장·일반 역할 시스템 관리자·숨김 QA 운영진의 정상 결과와 일반 회원 42501 거부 5건이다.
- `.ux-review/member-overall/browser/result.json`의 최종 204개 고유 검증 통과, 실패·page error·금지된 쓰기·예상 밖 외부 요청 없음 확인. 데스크톱 1440×1050과 좁은 웹 390×844에서 입력/6축/숫자 대안/반올림/CAS/결과 불명확 복구/ratings-only 진입/3직책/일반 역할 시스템 관리자/권한 제외·복원/actor ABA/대상 ABA/팀 평균과 게스트·미평가 표시를 검증했다. 의도한 409/503 오류 주입만 console에 남았다.
- 초기 16개 시나리오의 186개 통과와 제품 포커스 실패 2회·fixture의 메뉴 재열기 누락 2회를 `result-initial.json`과 `failure-analysis.json`에 보존했다. 수정 후 영향받은 4개 시나리오만 한 번 재검증한 `result-confirmation.json`은 92개 통과다. 초기 통과 시나리오를 무조건 반복하지 않았으며 최종 204는 중복 제거된 합계다.
- reviewer가 최종 desktop saved-radar 및 mobile saved-score-team-refresh PNG를 직접 확인했다. 육각형과 6개 저장값, 오버롤 72, 변경 후 팀 평균 89.0, 평가/전체/미평가 인원 및 게스트 표시가 렌더됐다. 여기서 mobile은 웹 viewport이며 앱 검사 결과가 아니다.
- 전체 migration history·PostgREST HTTP를 재생한 검증은 아니다. 로컬 Supabase advisor는 TLS 연결 한계로 미완료이며 통과로 간주하지 않는다. 실제 운영 카탈로그·migration 이력·웹 RPC는 릴리스 단계에서 확인해야 한다.
- 브라우저는 기록된 standalone headless Chromium 대체 경로와 합성 Auth/REST/CAS/권한 응답을 사용했다. 운영 데이터나 격리 PostgreSQL에 브라우저가 직접 연결하지 않았으므로 실제 DB 권한·CAS는 별도의 위 614개 SQL 검증과 root smoke로 보완한다.

공식 [Supabase 함수 보안](https://supabase.com/docs/guides/database/functions)과 [API 보안](https://supabase.com/docs/guides/api/securing-your-api)을 대조했다. 실제 운영 적용·커밋·푸시·PR·모바일 검사는 이 독립 리뷰에서 수행하지 않았다.
