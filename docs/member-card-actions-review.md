# 회원 카드 동작 메뉴 리뷰

작성일: 2026-10-06 · 검토자: 별도 컨텍스트 리뷰 에이전트 · 대상: 웹/모바일 `codex/member-card-actions`

## 범위와 판정

웹 기준 `503d144`의 회원 상세 기능과 모바일 기준 `fa176d2`에 대한 로컬 변경을 소스와 diff로 검토했다. 제품 소스는 수정하지 않았으며 이 리뷰 문서만 작성한다. 카드 전체 선택 → 동작 메뉴 → 전화걸기/연락처 저장, 기존 관리자 기능, 연락처 개인정보와 지연 응답 경계를 중점 검토했다.

최종 웹 판정은 **ship**이다. 사용자 웹 우선 배포 승인 후 실행한 테스트·타입·lint·프로덕션 빌드와 새 Chromium 검증의 원본 증거를 대조했다. 검토 범위에서 미해결 Critical/High 또는 중요 기능 회귀는 발견하지 않았다. 이 판정은 웹 배포 진행 가능 판단이며 운영 배포 완료 확인은 아니다. 상세 실행 결과와 미검증 범위는 마지막 절에 기록한다.

모바일은 이전 **prepared-for-batch / static issues resolved** 기록을 유지한다. 사용자 웹 점검 후 앱 동기화 요청 전까지 추가 작업·검사·빌드·PR·배포를 보류한다. 아래 모바일 내용은 앞선 정적 검토 이력이며 이번 웹 검증 결과를 모바일 통과 근거로 사용하지 않는다.

## 발견 사항

### MC-01 · 중요 기능 회귀 · 관리자 동작에 연락처 자격을 적용 — 정적 해결

- 최초 검토 시 웹 `components/member-directory.tsx`의 `manageMember`는 `isPhoneCurrent()`가 false이면 정보 수정·강퇴를 중단했다.
- 최초 검토 시 모바일 `src/features/members.tsx`는 `canContact`와 `memberPhoneScope`로 카드 전체·메뉴 진입을 제한했다.
- 기존 권한 계산은 활동 중인 숨김 테스트 관리자 계정에도 `members.manage`를 허용하지만 연락처 조회 자격은 `is_test_account` 계정을 제외한다. 따라서 초기 변경은 기존에 가능했던 일반 대상 회원의 수정·강퇴 진입을 막았다.
- 연락처 RPC의 기존 제한과 계정 generation 검증을 유지하면서, 연락처 자격과 카드/관리 메뉴의 계정·권한 검증을 분리하도록 요청했다.
- 수정 확인: 웹은 `isPhoneCurrent`를 관리 조건에서 제거하고 메뉴 actor의 owner·관리 권한·generation 및 현재 메뉴 generation을 확인한다. 기존 부모의 관리 권한 재검증은 유지한다. 모바일은 `memberMenuScope`와 `memberPhoneScope`를 분리해 기존 관리자 메뉴 진입을 허용하면서 전화·저장의 엄격한 조건은 유지한다.
- 회귀 소스: 숨김 활동 관리자 수정·강퇴 허용, 연락처 조회·전화·저장 차단, 본인·시스템 관리자 강퇴 보호, 계정/권한 변경과 ABA 무효화 사례가 추가됐다. 처음에는 소스만 검토했고 이후 웹은 아래 범위로 실행했다.
- 상태: 웹 수정 및 회귀 검증 확인 완료. 모바일은 정적 수정 확인 완료, 실행 검증 보류.

## 확인한 소스 계약

- 카드 내부 상시 전화 버튼이 제거되고 웹은 단일 button, 모바일은 단일 Pressable로 메뉴를 연다. 웹의 포지션·등번호·회원 유형·가입일 상세와 기존 관리자 수정·강퇴 흐름이 메뉴에 포함된다. 본인·시스템 관리자 강퇴 보호가 남아 있다.
- 숨김 대상의 목록 제외는 이번 변경으로 새로 생긴 정책이 아니다. 웹 `clubhouse.tsx`의 목록 병합과 모바일 `mergeBirthdayProfiles`가 이미 `is_test_account` 대상을 제외한다. 해당 조건 자체는 목록 범위 회귀로 판정하지 않았다.
- 메뉴 진입 시 전화번호를 미리 조회하지 않으며 선택 동작에서 기존 `get_member_phone` 단일 대상 RPC를 사용한다. UI 안내에 원시 전화번호나 서버 오류를 넣지 않는다.
- 웹은 조회 후 별도 사용자 클릭에서 전화 앱이나 vCard 다운로드를 요청한다. 준비된 동작의 중복 실행, 메뉴 닫기/전환, actor generation, 대상 상태 변경을 재확인하고 ref를 정리한다.
- 웹 vCard는 이름과 검증된 번호만 사용한다. 텍스트 줄바꿈·구분자 이스케이프, UTF-8 75octet 접기, 파일명 제어문자·예약 이름 처리, 일회성 링크 제거와 Blob URL 해제를 확인했다. 실제 주소록 가져오기 결과는 확인하지 않았다.
- 모바일은 `expo-contacts`를 `57.0.6`으로 정확히 고정했다. 설치 소스의 Android `ACTION_INSERT`/`RESULT_OK` 반환과 iOS `FormDelegate`의 인자 없는 `promise.resolve()`를 직접 대조했다. 현 버전의 불확정 반환을 저장 성공으로 안내하지 않는다.
- 모바일 동적 import 전후와 native dispatch 직전에 현재 요청을 검사한다. 취소·늦은 반환·계정 변경 시 알림 억제와 중복 요청 잠금을 확인했다. 주소록 목록 읽기나 직접 저장 API를 호출하지 않는다.
- 최종 구성의 Android READ/WRITE_CONTACTS는 `blockedPermissions`에 남아 있다. `expo-contacts` config plugin에 iOS 연락처 저장 목적의 한국어 usage description을 명시했다. 앱이 주소록 읽기 권한을 직접 요청하는 코드는 추가하지 않았다. 빌드된 최종 manifest·Info.plist와 iOS 기기 권한 동작은 확인하지 않았다.
- 회귀 테스트 소스는 웹 실제 핸들러·정적 렌더·vCard와 모바일 도메인·presenter의 지연 단계, 잘못된 번호, 중복 요청, 계정/메뉴 변경 사례를 포함한다. 테스트 작성은 실행 통과의 근거가 아니다.

## 추가 연결 재검토

모바일 `Members`의 선택적 `onInteractionChange`가 메뉴 열기 직후, 연락처 조회/네이티브 화면 대기, 회원 편집 상태를 `AppShell`에 전달한다. 메뉴를 닫아도 연락처 작업이 남아 있으면 억제를 유지하며 완료 또는 unmount 때 해제한다. unmount 뒤 늦은 결과는 부모 상태를 다시 변경하지 않는다.

`shouldShowAppUpdatePrompt`의 `memberActionsOpen`은 기본값 false인 선택적 조건이다. 기존 업데이트 요청 상태를 소비하거나 dismiss하지 않고 표시만 보류하므로, 회원 동작이 끝난 뒤 다른 표시 조건도 충족되면 안내가 다시 가능하다. 실제 `Members` 상태 전달과 `AppShell` 연결을 각각 다루는 회귀 소스가 준비됐다. 이 추가 연결에서 새로운 중요 결함은 발견하지 않았으며 iOS 연락처 폼과 업데이트 안내의 실제 화면 중첩 여부는 기기 검증으로 남긴다.

## 최초 정적 검토 시 실행 보류 이력

최초 정적 검토 당시 사용자 보류 지시에 따라 테스트, 타입 검사, lint, 브라우저/네이티브 실행, export, 빌드, 커밋, push, PR, 운영 변경은 수행하지 않았다. 양 저장소의 `git diff --check`만 실행해 exit 0을 확인했으며 줄바꿈 경고가 있었다. 이후 사용자가 웹 우선 배포를 승인했고 웹 검증만 아래와 같이 진행했다.

당시 후속 범위는 회귀 테스트·타입·lint·빌드, 웹 키보드/포커스·터치·화면 읽기, vCard 가져오기, Android/iOS 연락처 화면 열기·저장·취소·복귀와 권한 선언 확인이었다. 정적 준비 판정은 실행 및 실기기 검증을 대신하지 않았다. 웹에서 이후 확인한 범위와 아직 남은 항목은 아래 최종 리뷰를 따른다.

## 리더의 최종 메뉴 콜백 정적 보완
모바일의 연락/관리 콜백이 실행 시 최신 menuRef를 읽으면 이전 메뉴의 콜백이 재개방한 다른 회원 메뉴에 적용될 수 있었다. Members가 렌더 당시 menu 객체를 요청으로 고정하고 menuRef와 동일한지 dispatch 전에 확인하도록 보완했다. openMenu도 렌더 당시 scope와 현재 actor scope를 비교한다. 리더가 해당 조건과 같은 회원/다른 회원 재개방 actual callback 회귀 소스를 직접 읽었다. 이는 source 정적 확인이며 해당 회귀 실행 통과 증거는 아니다. 최신 소스는 일괄 검증 준비 상태이고 테스트·빌드·UI/기기 확인은 후속 범위로 유지한다.

## 웹 우선 배포 최종 리뷰 · 2026-10-06

판정: **ship**. 제품 소스를 추가 수정하거나 검사를 재실행하지 않고 최종 소스, 실제 핸들러를 추출하는 테스트 코드, 리더와 웹 담당자가 생성한 아래 원본 증거를 직접 읽었다. 검토자는 이 문서만 수정했다. 검증 기록에 포함된 5개 파일의 현재 SHA-256과 `source-evidence.json`이 일치함을 확인했다.

| 웹 검증 | 확인 결과 | 근거 |
| --- | --- | --- |
| 전체 테스트 | 329 통과, 기존 1건 skip, 실패 0 | `.ux-review/member-card-actions/test.log` |
| TypeScript | exit 0 | `.ux-review/member-card-actions/source-evidence.json` |
| ESLint | exit 0, 오류 0, effect 의존성 경고 2 | `.ux-review/member-card-actions/lint.log` |
| 프로덕션 빌드 | exit 0, 컴파일 성공, 21/21 페이지 생성 | `.ux-review/member-card-actions/build.log`, `source-evidence.json` |
| 새 headless Chromium 검증 | 116개 확인, 실패·pageerror·예상외 console 오류·외부 요청·DB 쓰기 0 | `.ux-review/member-card-actions/result.json`, `verify.mjs` |
| vCard 실제 다운로드 | 데스크톱/모바일 웹 2개 파일의 한국어·emoji 이름, 선택한 번호, UTF-8 내용 일치 | `desktop-contact.vcf`, `mobile-contact.vcf` |

Chromium은 로컬 프로덕션 웹에 합성 로그인과 가로챈 REST/API 응답을 사용했다. viewport는 1440×1050과 390×844다. 24개 스크린샷 중 `desktop-menu.png`, `mobile-menu.png`, `mobile-hidden-manager-menu.png`, `desktop-manager-editor.png`를 직접 열어 메뉴 상세·연락 동작·숨김 관리자 관리 동작·편집 화면을 대조했다. 카드 전체 클릭, 단일 trigger, 카드 전화 버튼 제거, Escape 포커스 복귀와 dialog 내부 키보드 포커스, 일반 회원 메뉴, 관리자와 숨김 QA 관리자의 수정 진입·강퇴 확인 후 취소, 본인·시스템 관리자 보호, 번호 없음/503 오류, 메뉴 닫기와 A-B-A 중 늦은 응답 폐기는 실행 결과에 포함된다. 의도적으로 발생시킨 503 console 메시지 2건은 기록돼 있으며 예상외 오류로 오인하지 않았다.

`lib/member-phone.test.mjs`는 운영 컴포넌트/부모 소스의 실제 함수를 AST로 추출하고 RPC·전화 앱·다운로드 경계를 대역으로 바꾼다. MC-01 수정, actor/메뉴 generation, 오래된 관리 콜백, 중복 요청, 번호·권한 응답 폐기, vCard 이스케이프·UTF-8 접기·파일명과 Blob cleanup 검증의 근거다. 해당 테스트만으로 React effect·브라우저·운영 DB 전체를 검증했다고 주장하지 않으며 실제 브라우저 evidence와 구분한다.

신규 effect 의존성 경고 2건을 검토했다. 현재 효과는 actor와 메뉴 generation 변경 시 준비된 연락처를 폐기하는 목적이고, 소스·회귀·실제 브라우저 검증에서 관련 오동작은 발견하지 않았다. 이번 범위의 배포 차단 사유로 판정하지 않았다.

미검증: 실제 전화 앱 실행/발신, 기기 주소록으로 vCard 가져오기, 실제 회원 데이터·운영 인증/RLS, 화면 읽기 도구·실제 모바일 OS. 모바일 앱 검증·배포는 계속 보류한다. 웹 운영 배포 완료 및 운영 URL 확인은 리더의 후속 릴리스 기록에서 별도로 확인해야 한다.
