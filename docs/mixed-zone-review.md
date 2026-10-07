# 믹스트존 독립 최종 리뷰

## 현재 판정

**SHIP (검토한 웹 구현·DB 마이그레이션)**. 2026-10-08 최종 브라우저 원본, 소스 해시 및 실제 PNG를 확인했다. 미해결 P0/P1/P2는 없으며 발견한 P2 두 건은 아래 증거로 종결했다. 이 판정은 운영 DB 적용·배포·모바일 APK 완료를 뜻하지 않는다.

리뷰 기준은 `codex/mixed-zone`, 기준 커밋 `872afe2` 이후 변경과 신규 미추적 파일이다. 리뷰어는 구현·커밋·푸시·운영 DB 변경을 수행하지 않았으며 이 문서만 작성한다.

## 완료 계약

1. 목적: 실제 참석한 동료를 지난 일정에서 자발적으로 평가하고, 운영 권한이 있는 사용자만 집계를 확인한다.
2. 시각 체계: 기존 Operate 화면의 Pretendard·네이비·라임·테마 토큰과 일정 상세 구조를 유지한다. 마케팅 랜딩 페이지 구성은 이 업무 화면의 기준으로 적용하지 않는다.
3. 핵심 동작: 대상 선택, 미응답 기본값, 여섯 항목 선택, 저장, 마감 전 수정, 결과 불명확 시 본인 응답 재조회.
4. 경계 상태: 미평가는 정상 빈 결과의 0 표시이며 조회 실패와 구별한다. 마감 후 읽기 전용, 미참석·본인·테스트 계정 제외, 비권한 사용자 집계 숨김, 계정·대상·일정 변경 및 ABA 늦은 응답 폐기.
5. 증거: 실제 렌더링한 데스크톱 작성·저장, 모바일 집계·미평가·마감, 오류 복구 PNG와 소스 해시, 회귀 검사, 격리 PostgreSQL 검증을 연결한다.

## 발견 사항과 조치

- **P2, 정상 저장 후 선택과 성공 안내 초기화**: `components/clubhouse.tsx`의 저장 `onChanged`가 믹스트존 버전을 올리고 `components/mixed-zone-panel.tsx`의 버전 의존 effect가 `load()`를 실행하여 `selected`와 `notice`를 지웠다. 상위 연결은 집계 버전만 갱신하고 입력 패널은 확정 저장 응답으로 자체 상태를 갱신하도록 수정됨을 소스에서 확인했다. 최종 실제 Clubhouse 브라우저에서 대상 유지·성공 안내·revision 1 수정 저장을 확인했다. 데스크톱 및 모바일 saved PNG를 직접 열어 확인했으며 종결했다.
- **P2, 밝은 테마의 키보드 포커스 대비**: `components/mixed-zone.css:14`의 외곽 포커스가 `--focus: #ffd84d`를 사용하여 흰 배경 대비가 1.383:1이었다. 숨겨진 native radio의 가시적 초점 표시에도 적용된다. 해당 규칙이 var(--primary)로 한정 수정됐고, 데스크톱 keyboard-focus PNG에서 네이비 외곽선과 상태 구분을 직접 확인하여 종결했다. 어두운 테마는 라임 primary를 사용한다. 사용자 정의 포커스 상태에는 인접 배경과 3:1 대비가 필요하다. [W3C SC 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)

## 코드·DB 확인

- 원문은 private 테이블, RLS와 직접 CRUD 권한 차단. 공개 invoker/비공개 definer, 빈 search_path, authenticated 실행 한정 및 함수 안의 현재 인증 연결 검사를 확인했다.
- 평가자·대상·일정·실제 출석 공유 잠금, 응답별 비차단 advisory/행 잠금, 잠금 후 clock_timestamp 마감 확인, 기대 revision CAS와 오류 코드를 확인했다.
- 기간은 종료 시각 또는 시작 후 2시간부터 정확한 24시간 단위이며 기본 3일, 1~30일. 일정 관리 권한과 POTM 독립 설정을 확인했다.
- 동일 일정 실제 참석자, 자기 평가 제외, 여섯 정수 1~5, 본인 원문 조회와 마감 후 조회, 저장 불명확 시 재조회 경로를 확인했다.
- 최근 평가가 있는 10일정의 일정별 평균을 동일 가중 평균한 뒤 20배 반올림하며, 응답 수·일정 수를 별도 반환한다. 빈 집계를 수동 점수로 대체하지 않으며 팀 평균에서 미평가자를 제외한다.
- 기존 수동 점수 테이블과 감사 자료 보존, 기존 get 함수 반환 서명 유지, set 함수의 42501 종료를 확인했다.
- 계정·대상·출석·일정 식별 및 세대, 선택 세대, 마운트 토큰을 이용한 늦은 응답 폐기를 검토했다.

## 검증 증거와 한계

- 마이그레이션 SHA-256 직접 확인: `82ba4111276e57566cb3616191fa74d3d8f772d2d0449c871141c5c8637d5716`.
- `docs/mixed-zone-db-validation.md`: PostgreSQL 17.6 합성 로컬 DB의 통합 190개, pgTAP 112개 통과 보고와 검사 코드를 읽었다. 리뷰어가 운영 DB 또는 해당 통합 검사를 재실행한 것은 아니다.
- `.ux-review/mixed-zone/tests.xml`: 저장된 원본은 총 377개, 통과 376개, 실패 0개, 생략 1개다. 이후 루트의 추가 실행 결과와 별도로 취급한다.
- `.ux-review/mixed-zone/browser/verified-result.json`: 8개 시나리오 중 실패 6개가 남은 과거 관찰이다. 접근 가능한 이름 문제, 브라우저 실행/캐시 문제를 최종 기능·보안 통과 증거로 바꾸어 해석하지 않는다.
- 최종 `final-result.json`의 생성 시각은 2026-10-07T15:25:24.875Z이며 8개 시나리오·56개 확인, failures/errors/forbiddenWrites 모두 빈 배열이다. 합성 인증·RPC fixture이며 외부 요청을 차단했다. 7개 기록 소스 해시 모두 현재 파일과 직접 비교하여 일치를 확인했다.
- 운영 스키마 반영·Advisors·배포 URL 확인과 모바일 앱/APK 검증은 루트 및 별도 담당자의 범위이며 이 독립 웹/DB 리뷰의 실행 증거에 포함하지 않는다.

## 최종 화면 및 검증 확인

아래 파일은 `.ux-review/mixed-zone/browser/`에서 리뷰어가 `view_image`로 직접 열었다.

| 화면 | 실제 확인 |
|---|---|
| desktop-mixed-zone-draft.png | 기존 일정 상세와 일관된 2열 점수 입력, 여섯 항목과 선택 대상, 저장 버튼 |
| desktop-mixed-zone-saved.png | 대상의 작성 완료 표시 유지, 여섯 5점 선택, 수정 저장 버튼, 저장일과 성공 안내 |
| desktop-keyboard-focus.png | 네이비 외곽선으로 현재 포커스와 선택 상태 구분 |
| mobile-mixed-zone-saved.png | 좁은 화면 단일 열 입력, 저장한 대상·여섯 점수·수정 동작 유지 |
| mobile-aggregate-detail.png | 기존 회원 상세 모달·육각형 그래프·오버롤 72 및 실제 점수 |
| mobile-unrated-detail.png | 빈 그래프와 오버롤 0, 기존 집계 실패와 별개인 정상 미평가 상태 |
| closed-own.png | 마감 안내와 본인 점수, 비활성 입력, 저장 동작 없음 |
| unknown-save-recovered.png | 재조회한 본인 저장 항목과 점수, 최신 revision에 기반한 수정 흐름 |
| aggregate-retry.png | 실패 후 재시도로 돌아온 집계 그래프 |
| mobile-mixed-zone-dark.png | 기존 네이비 바탕·라임 선택 상태 및 단일 열 배치 |
| mobile-keyboard-focus.png | 모바일 점수 입력과 선택 상태; 고정 내비게이션이 캡처 일부를 가리므로 포커스 전 영역의 독립 증거로 확대 해석하지 않음 |

전체 페이지/요소 캡처에는 고정 상·하단 내비게이션이 중간에 합성되어 보이는 부분이 있다. 긴 모달의 하단 설명은 이 정지 이미지 한 장에 모두 나오지 않으므로 6개 값·응답 수·재시도·숨김 동작은 최종 브라우저 assertion과 코드 검토를 함께 근거로 사용했다. 이 리뷰는 스크린리더 실기기 인증이나 모든 배율의 WCAG 준수 인증이 아니다.

최종 전체 Node 결과는 377개 중 376개 통과·1개 기존 생략·실패 0개다. 루트가 최종 수정 뒤 프로덕션 빌드 21페이지/exit 0을 보고했다. 리뷰어는 동일 빌드를 중복 실행하지 않았다. DB 합성 검증의 실행 주체와 수치는 앞 절과 같다.

## 기술 감사 요약

| 차원 | 점수 | 근거와 한계 |
|---|---:|---|
| 접근성 | 3/4 | native select/radio, fieldset/legend, 항목별 이름, 상태 알림과 포커스 수정. 스크린리더 실기기 검증 없음 |
| 성능 | 3/4 | 일정 단위 원문 조회, 최대 300명 집계 요청, 추가 대형 의존성 없음. 운영 부하 측정 없음 |
| 반응형 | 3/4 | 데스크톱 2열·모바일 1열, 44px 입력, 실제 두 폭 확인. 모든 배율 검사 아님 |
| 테마 | 4/4 | 기존 의미 토큰 사용, 라이트·다크 실제 확인 |
| 구현 일관성 | 4/4 | 목적·기존 화면·실패/빈 상태·권한 경계가 일관됨. 기존 세션의 context/detector를 중복 실행하지 않음 |
| 합계 | 17/20 | 검토 범위 양호, 미해결 출시 차단 결함 없음 |

## 최종 소스 해시

아래 7개는 final-result.json과 현재 파일이 모두 일치한다. CSS와 migration은 별도 직접 계산한 해시다.

| 파일 | SHA-256 |
|---|---|
| components/mixed-zone-panel.tsx | 991f7afcf4dc923f37d15b0441d29d3899170c98d16a04ecc6c4bef69a022c8a |
| lib/mixed-zone.ts | bd46c2ffb6f8d9aafb6aee89a8b8a4cd3592cbc2e7c57af6a21ac99249057062 |
| lib/mixed-zone-client.ts | 6e65a42050c6cbb8f3987e6b6aa1e061e9b02bcef506f18b0b4106ef2e151caf |
| components/member-overall-panel.tsx | 271dea4ffebbbdc128916d7f0c33e1e49975fb5c6709ad194e0941dfefe424e4 |
| lib/member-overall-client.ts | 1f59313a76804909ea7d699700dce84bfd63778e5b9d79a3ff728bbc246d45e6 |
| components/clubhouse.tsx | 6741a135c1745907cdef02a8ae993b6c73cf2818bb94599c3d62a7a836543cef |
| components/admin-console.tsx | 3ea19fc3676ee0f00945b0b425f6498eb5d643828cce0792f945533a7da9b85e |
| components/mixed-zone.css | 1eb45fecda025e7a62b3ab6fc9e48be9b1019c577065a4bc8dd665c5166315e8 |
| supabase/migrations/20261007144033_add_mixed_zone_ratings.sql | 82ba4111276e57566cb3616191fa74d3d8f772d2d0449c871141c5c8637d5716 |
