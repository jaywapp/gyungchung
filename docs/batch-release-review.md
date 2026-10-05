disposition: ship

입력 제한: Android 네이티브 화면/기기·TalkBack·실제 전화 앱/설치·iOS 증거는 없다. 신규 콘셉트 comp/QUALITY BAR 카드/seed 계약은 제공되지 않았으며 기존 Match Console Operate 확장으로 판정했다. 이 판정은 검토한 변경의 배포 차단 결함 해소를 뜻하며 APK 발행·실기기·운영 배포 완료를 뜻하지 않는다.

## persistence

- 작성일: 2026-10-05. 독립 reviewer가 `feat/member-birthdays`의 웹·앱 변경 소스와 테스트를 표본 검토하고 수정 후 증거를 재확인했다. 제품 소스·운영 데이터·설치 상태는 변경하지 않았다.
- 기존 `member-birthdays-*`, `event-potm-design.md`, `app-update-monitor-design.md`, 모바일 기본 분석·설계·작업 문서가 기능·권한·네이티브 경계를 기록한다. 별도 PRODUCT.md/DESIGN.md는 제공되지 않았다. 기존 기능 확장이므로 현재 디자인과 기능 계약을 기준으로 삼았다.
- impeccable/context와 detector는 재실행하지 않았다. 전달된 기존 CSS side-tab 2개·width transition 3개 경고는 이번 변경 밖이다. design-taste-frontend는 운영 UI·네이티브 앱이 주 적용 대상이 아님을 반영하여 기존 체계 유지 기준에 한정했다.
- 모바일: `docs/batch-release-validation-mobile.md`, `.work/batch-release-20261005/evidence.json`에 테스트 563개·타입·lint·Android export 통과와 runtime 소스 131개 해시가 기록돼 있다. 실제 TSX/콜백을 실행하지만 네이티브 요소·RPC·저장소·전화 앱·설치 어댑터는 합성 대체한다.
- 웹: 최종 테스트 315개 통과·기존 skip 1개, 타입·lint·21개 페이지 production build 통과를 담당자에게 전달받았다. `.ux-review/batch-web`의 기존 검사 로그와 최종 `browser/result.json`을 읽었다. 합성 인증·REST를 가로챈 production 브라우저 검사 49개가 통과했고 page error/예기치 않은 외부 요청은 0개다. 뷰포트는 1440×1050 및 390×844다. 본 reviewer는 전체 검사를 반복 실행하지 않았다.
- DB: `docs/batch-release-validation-db.md`는 **DB 구현 담당자의 재검토·격리 검증 증거**다. 리더가 전달한 PostgreSQL 17.6 동시성 22개·pgTAP 148개 및 운영 마이그레이션 3개 적용/원본 SHA 확인 결과를 릴리스 증거로 구분한다. 본 리뷰가 독립 DB 보안 감사를 수행했다는 뜻이 아니다.

## fidelity

| 요소 | 판정 | 근거와 범위 |
| --- | --- | --- |
| TYPE | match | 기존 Pretendard와 네이비 제목·본문 계층, 기존 버튼·폼 크기를 사용하는 소스와 생일·최신 POTM 캡처에서 확인했다. |
| MATERIAL | match | 단색 표면·라임 강조·선형 Lucide 아이콘을 유지한다. 새 물리 재질 모사나 장식용 자산은 추가하지 않았다. |
| 달력·계정 | match | 7열 달력, 날짜별 생일 수, 선택일 이름 목록, 월/일 입력, 출생연도 비공개, 윤일 설명, 미등록 nudge와 오류 재조회 경로를 유지했다. |
| 전화걸기 | adaptation | 선택 회원만 RPC 조회하고 웹은 별도 클릭으로 전화 앱을 연다. 웹의 사용자 동작 제약에 따른 단계이며 번호를 명단/오류에 노출하지 않는다. 모바일은 Linking 전에 최신 actor·target을 확인한다. 실제 전화 앱은 열지 않았다. |
| POTM 상태·권한 | match | 기본 종료 2시간·3일(1~30일), 현재/최종 문구·지정 순위·동률, 제출 직전 자격·출석·계정 generation, 응답 불확실/확정 저장 구분, 서버 거절 후 회복을 확인했다. |
| 웹 마감 결과 신뢰성 | match | 경계/복귀 재조회 중에는 최종 표현을 보류하고 성공 뒤 새 집계를 표시한다. 실제 timer 테스트와 최신 캡처에서 현재 2표가 최종 3표로 갱신됐다. |
| Android 업데이트 안내 | adaptation | 기존 Sheet·테마와 설치 승인 흐름을 유지한다. 전경 5분 확인, 현지 날짜 숨김, 수동 강제 확인, coalesce, AppState generation, 작성 화면 안내 보류를 확인했다. OS 백그라운드 상시 서비스나 iOS 완료로 해석하지 않는다. |

이전 생일 리뷰 verdict:

- **resolved**: `src/domain/birthday-account.ts`는 응답 유실/불명확 결과를 확정 실패와 구분한다. `tests/birthday-render.test.ts`의 실제 AccountSheet 저장·삭제 콜백이 writer/coordinator를 실행하고 재조회 후 서버 revision·월·일과 이중 쓰기 방지를 검증한다.
- **resolved**: 실제 Events 렌더 검사가 loading/failed/legacy·초기 본인 미확정 상태를 각각 안내하고 미등록 nudge를 숨긴다. 실제 재조회 버튼은 profiles만 읽어 오류·본인 정보를 회복한다. 네이티브 시각 배치와 스크린리더 검증은 별도다.

## ceiling

기존 운영 UI의 읽기 순서·정보 밀도를 유지했다. 이전 생일 캡처에 이어 최신 `.ux-review/batch-web/browser/desktop-potm-open.png`, `desktop-potm-closed.png`, `desktop-potm-editor.png`, `mobile-potm-closed.png`, `mobile-potm-editor.png`를 직접 열어 확인했다. 마감 안내·비활성 후보·최신 최종 표수·폼 입력과 안내의 줄바꿈을 확인했고 최종 49개 검사도 가로 넘침이 없음을 기록한다. 폼 폭 보완에서 새 material regression은 발견하지 못했다. 기존 장식 요소를 재설계하거나 새 스타일을 추가하지 않았다. 네이티브 실기기 품질 상한까지 확인했다는 주장은 하지 않는다.

## material_fixes

열린 material fix: **없음**.

- **P2 resolved · 마감 전 집계를 최종으로 표시**: 최초 `components/event-detail.tsx:90` 타이머가 시각만 바꾸고 이전 결과를 최종으로 표시하던 문제다. 현재 `refreshMomWindowState`와 `components/clubhouse.tsx`의 연결이 events/momVotes/momResults를 재조회하며, pending/error에는 “결과 확인 중/미확인”과 재시도를 표시한다. `lib/event-potm.test.mjs`의 실제 경계 callback 검사는 지연 응답 동안 최종/무표 문구가 없고 성공 후 3표, 실패 시 미확인·재시도가 나타남을 검증한다. 장기 복귀의 변경 집계도 검증한다. 최신 데스크톱/모바일 브라우저 검사가 마지막 표의 최종 반영과 열린 모달 마감을 확인했고 캡처와 일치한다.

검토한 클라이언트 범위에서 High 코드/보안 차단 사항은 발견하지 못했다. DB 구현 담당자의 결과와 독립 클라이언트 리뷰를 구분하며, 실기기·서명 APK·운영 배포 검증은 릴리스 담당자의 후속 증거로 남는다.

## keep

선택적 월·일 공유와 본인 CAS/tombstone, 엄격한 공개·호출자 경계, 계정 ABA 뒤 늦은 결과 폐기, on-demand 전화 조회와 사용자 발신, 현재/최종 POTM 구분·서버 시계 우선, 전경 업데이트 확인·현지 달력 날짜 숨김·기존 Android 설치 승인을 유지한다.
