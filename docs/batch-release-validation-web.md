# 생일·전화·POTM 웹 일괄 검증
작성일: 2026-10-05

사용자의 배포 지시 후 `feat/member-birthdays` 최신 웹 소스를 검증했다. 이 문서는 웹 검사 결과만 기록한다. 운영 DB·실제 사용자 데이터에 쓰지 않았으며, 커밋·push·배포는 이 검증 역할에서 수행하지 않았다.

## 최종 명령과 결과

| 명령 | 결과 | 로그 |
|---|---|---|
| `npm test` | exit 0. 316개 중 315 통과, 실패 0, 기존 1 skip | `.ux-review/batch-web/test.log` |
| `npx tsc --noEmit` | exit 0 | `.ux-review/batch-web/type.log` |
| `npm run lint` | exit 0, 경고 없음 | `.ux-review/batch-web/lint.log` |
| `npm run build` | exit 0, Next.js 15.5.27, compile 6.1초, 21개 페이지 생성 | `.ux-review/batch-web/build.log` |
| `npm run start -- --port 3132` | 로컬 production 서버 시작 | `.ux-review/batch-web/server.log` |
| `node .ux-review/batch-web/browser/verify.mjs` | exit 0, 49개 검증 통과, page error 0, 예기치 않은 외부 요청 0 | `.ux-review/batch-web/browser.log`, `browser/result.json` |
| `git diff --check` | exit 0, 공백 오류 없음 | LF→CRLF 알림만 있음 |

기존 skip은 `WEB_PUSH_MODULE`이 없을 때 생략하는 암호화 body/VAPID 네트워크 없는 검사다. DB migration·pgTAP·운영 적용 검증은 DB 담당의 별도 증거를 따른다.

최종 소스 증거는 `.ux-review/batch-web/source-evidence.json`에 app/components/lib 및 package/tsconfig 파일별 SHA256와 묶음 digest로 남겼다. 최종 빌드 뒤 기능 소스를 수정하지 않은 상태에서 아래 UI 검증을 수행했다. 이전 생일 전용 브라우저 기록은 전화/POTM 통합 이전 snapshot이므로 최신 결과는 이 문서를 따른다.

## 확인한 흐름

데스크톱 1440×1050과 모바일 웹 390×844에서 실제 화면 버튼과 입력 폼을 조작했다. 신규 headless Chromium context에서 합성 Auth 세션과 intercept한 REST만 사용했다. 외부 비fixture 요청은 차단했고 실제 회원 인증 상태나 전화번호를 읽지 않았다.

- 생일: 미등록 본인 CTA, 월·일 유효성, 실제 생일 RPC/CAS payload, 구형 필드 없는 서버의 unknown 상태. 단위 검사는 생일만 있는 달력, 날짜 충돌, 윤년/비윤년, 삭제 tombstone, 조회 실패, 계정 ABA와 자격 변경을 포함한다.
- 전화: 초기 전화 조회 없음, DOM에 전화번호 없음, 회원 버튼 클릭 후 1회 on-demand RPC, 전화 앱 열기 버튼, 미등록 번호의 복구 안내. 실제 핸들러 단위 검사는 정상 RPC→mock opener, 번호 정규화, unsafe 입력, 네트워크 실패, 최신 권한과 계정 ABA를 포함한다.
- POTM: 동률 공동 1위 유지, 실제 모달 후보 버튼→본인 표 upsert, 정확한 마감 시 후보 비활성화, 마감 후 scoped 재조회가 마지막 표 2→3표를 최종 집계에 반영, 종료 시간·4일 기간의 실제 편집 PATCH, 기간 수정 후 투표 재개, 구형 이벤트의 무기한 투표 차단.
- 각 주요 화면과 dialog에 가로 넘침이 없다. 모든 페이지 오류와 비fixture 외부 요청이 0이다.

실제 컴포넌트 콜백 테스트는 시간 경계, 반복 생성 종료 시간 이동, 최신 출석/후보/회원 권한, pending 중 계정·권한 ABA, 서버 거절, 서버 반영 후 응답 유실, 알 수 없는 완료 코드, 확정 저장 후 조회 실패를 확인한다. 타이머 및 장기 포커스 복귀의 실제 callback으로 재조회 대기·변경된 결과·실패 후 재시도도 확인한다.

## 검증 중 최소 수정

- `lib/types.ts`: 이벤트의 optional 종료 시간·투표 기간 선언 누락을 실제 쿼리 계약에 맞춰 보완했다.
- `lib/event-potm.test.mjs`: 실제 TSX 렌더 fixture를 CommonJS로 transpile하도록 정정했다. 기존 주장 조건을 약화하지 않았다.
- `components/clubhouse.tsx`: 미사용 구형 projection 변수를 제거했다. 관계/구형 fallback 동작은 그대로 검증했다.
- `components/event-detail.tsx`, `components/clubhouse.tsx`: 열린 상세 화면이 정각 마감 또는 장기 복귀에서 오래된 집계를 최종 결과로 확정하던 P2를 수정했다. events/momVotes/momResults 3개 resource를 재조회하고, 완료 전 결과 확인 중·실패 시 미확인/재시도를 표시한다. 기본 초기 요청과 성공 투표 후 2개 resource 재조회는 유지한다.
- `components/admin-console.tsx`, `app/globals.css`: 기존 일정 편집의 구장/정원 grid 입력이 dialog를 넘던 문제를 이벤트 폼의 최소 너비에 한정해 수정했다. 최종 데스크톱/모바일 편집 입력 및 저장 흐름을 다시 통과했다.

## 스크린샷과 실행 한계

최신 스크린샷은 `.ux-review/batch-web/browser/` 아래에 있다.

| 흐름 | 데스크톱 | 모바일 |
|---|---|---|
| 생일 등록 | `desktop-birthday.png` | `mobile-birthday.png` |
| 회원 전화 | `desktop-phone.png` | `mobile-phone.png` |
| POTM 투표 가능 | `desktop-potm-open.png` | `mobile-potm-open.png` |
| POTM 마감 | `desktop-potm-closed.png` | `mobile-potm-closed.png` |
| 기간 편집 | `desktop-potm-editor.png` | `mobile-potm-editor.png` |
| 기간 수정 후 재개 | `desktop-potm-reopened.png` | `mobile-potm-reopened.png` |

모바일 unknown 생일·전화 미등록·unknown POTM은 각각 `mobile-unknown-birthday.png`, `mobile-missing-phone.png`, `mobile-unknown-potm.png`에 남겼다. `failure.png/txt`는 완료 전 fixture/넘침 진단의 과거 기록이며 최종 통과 증거가 아니다.

필수 Browser 스킬을 읽고 런타임 bootstrap을 시도했지만 node_repl kernel이 sandbox helper 잠금/권한 오류(`helper_sandbox_lock_failed`, `SetNamedSecurityInfoW ... failed: 5`)로 시작 전에 종료됐다. bootstrap troubleshooting에 따라 확인한 뒤 기존 독립 headless Playwright 합성 fixture를 사용했다. 따라서 Codex 내장 Browser 세션에서의 검증을 주장하지 않는다.

실제 tel handler와 전화 발신은 실행하지 않았다. 전화 앱 열기 버튼의 actual callback은 mock opener로 검사했다. 실기기 전화 앱 연동, 실제 운영 Auth/RLS·DB 트리거, 사용자 기기/확장 프로그램 상태는 이 합성 UI 결과의 범위 밖이다.
