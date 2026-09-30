# 경충FC 모바일 앱 설계

- 최초 작성: 2026-09-25
- 갱신일: 2026-09-30
- 상태: 최신 웹 디자인을 기준으로 한 모바일 전환 제안
- 코드 기준: `e0769ae`
- 선행 문서: [분석](mobile-app-analysis.md)

## 저장소와 공유 경계

웹을 루트에 두고 `mobile/`에 Expo/React Native 앱을 추가한다. iOS와 Android 화면은 한 모바일 소스에서 제공한다. 웹 화면 컴포넌트는 플랫폼별 UI로 유지하며, 중복이 확인된 로직과 디자인 토큰을 단계적으로 공용화한다.

```text
gyungchung/
├─ app/                         # existing Next.js web
├─ components/                  # existing web UI
├─ lib/                         # existing web logic and adapters
├─ mobile/
│  ├─ app/                      # Expo Router tabs, stacks, auth
│  ├─ src/
│  │  ├─ features/              # home, events, members, rankings
│  │  ├─ services/              # Supabase queries and session lifecycle
│  │  ├─ storage/               # device storage adapters
│  │  ├─ theme/                 # native tokens and typography
│  │  └─ ui/                    # native controls and state views
│  ├─ assets/                   # licensed native font and brand assets
│  ├─ app.config.ts
│  ├─ eas.json
│  └─ package.json
├─ packages/
│  ├─ domain/                   # optional pure TypeScript logic
│  └─ design-tokens/            # optional semantic token values
├─ supabase/                    # shared backend and migrations
├─ docs/
├─ package.json                 # npm workspaces
└─ package-lock.json            # single lockfile
```

공용 패키지는 필요가 확인된 뒤 만든다. `domain` 후보는 `event-capacity`, `event-date`, `rsvp`, `member-directory`, `season-rankings`, `fee-rules`, `participation-deadline`·검증 로직이다. `account-state`는 Supabase `User` 타입 의존성을 검토한다. `theme`의 모드 해석은 공유할 수 있지만 브라우저 초기화 스크립트는 웹에 둔다. `hero-motion`의 순수 계산은 선택적으로 공유하고 DOM 측정·관찰자·애니메이션 구현은 분리한다.

루트 npm workspaces와 잠금 파일을 유지한다. 현재 웹의 Next.js 15.5.23·React 19.2.8과 착수 시점 Expo 지원 버전의 호환성을 먼저 확인하고 앱 내부의 React·네이티브 모듈 중복을 점검한다. 웹 `tsconfig.json`과 ESLint에서 `mobile/`을 분리하며, 공용 패키지는 의도적으로 검사한다. EAS는 `mobile/`에서 실행하되 저장소 루트의 workspace와 잠금 파일을 포함해야 한다. 생성 네이티브 디렉터리의 관리 방식은 CNG 사용 여부와 직접 수정 필요성을 기준으로 정한다. [Expo 모노레포 문서](https://docs.expo.dev/guides/monorepos/)

## 화면 구조

| 목적지 | 현재 웹 기준 | 모바일 동작 제안 |
| --- | --- | --- |
| 홈 | 매치 콘솔 + 네 모듈 | 다음 경기 참석 응답 우선, 상세·명단·각 모듈 목적지로 이동 |
| 일정 | 달력, 이번 주 일요일 강조, 예정/지난 일정과 상세 | 날짜 선택과 상세 스택. 정원·명단·지도·응답 상태 유지 |
| 회원 | 포지션 필터와 작은 카드 | 필터·개수·정렬 유지. 화면 폭과 글자 확대에 따라 2열 또는 1열 |
| 랭킹 | 연도별 MVP·득점왕·출석왕, 페어플레이어 안내 | 작은 화면용 카드/목록으로 집계 기준과 공동 순위 표시 |
| 더보기 | 공지·회비·참여·의견·관리·계정·테마·업데이트·유튜브 | 출시 범위와 권한에 맞는 항목만 표시. 스택 또는 시트로 이동 |

상단 바에는 브랜드와 계정 진입을 둔다. 하단 탭은 홈·일정·회원·랭킹·더보기로 맞추고, 탭의 목록 위치와 상세 화면 뒤로가기를 보존한다. Android 시스템 뒤로가기, iOS 뒤로가기 제스처, 키보드와 safe area를 포함한다. 일정 웹 링크의 `YYYYMMDD` 형식은 [날짜 로직](../lib/event-date.ts)을 참고하여 앱 딥링크에 연결한다. 딥링크는 로그인이 필요하면 인증 후 원래 목적지로 복귀하도록 설계한다.

## 홈과 주요 정보의 동작 계약

- 매치 콘솔: 날짜·요일·시작 시각·구장·D-day, 참석/불참/취소, 회원·용병·남은 자리 또는 초과 인원, 명단 진입을 제공한다. 정원이 없으면 정원 막대를 생략한다.
- 참석 저장: 현재 응답을 즉시 표시하고 중복 저장을 막는다. 실패하면 이전 상태로 복구하며, 일정 시작·정원 초과·활동 제한은 기존 규칙과 같은 안내를 사용한다.
- 홈 모듈: 공지 최근 3건, 본인 회비 요약, 마감 전 진행 중 참여 항목, 시즌 득점·MVP 상위 3행을 기준으로 한다. 해당 기능이 출시되지 않으면 관련 모듈도 제외한다.
- 시즌 랭킹: `buildSeasonRankings`의 상위 5행·공동 순위와 테스트 계정 제외 규칙을 유지한다. 현재 MVP는 우승 회원 기록 집계이며, 일정별 MOM 투표와 별도 기능이다.
- 회원 카드: 이니셜, 포지션·직책·본인 표시와 가입 연도를 유지한다. 미지정 포지션은 무관 필터에 포함하되 '미정'으로 표시한다.
- 회비: 일반 회원은 본인 조회 범위, 운영자는 부여된 권한 범위만 접근한다. 금액·납부 상태와 회비 기준 배지를 제공하고 결제 기능은 별도 승인 대상으로 둔다.
- 참여: 마감 후 제출 차단, 제출한 응답 조회, 허용된 결과 공개와 초안 복원을 유지한다. 선거·비밀투표를 포함하면 비밀 답변의 기기 저장 금지와 조회 제한을 별도 검증한다.
- 모든 화면: 로딩·빈 데이터·오류와 재시도·정상 상태를 구분한다. 오프라인 저장은 성공으로 표시하지 않고 재연결 후 서버 상태를 확인한다.

## 디자인 시스템의 네이티브 전환

현재 [CSS](../app/globals.css)의 의미별 토큰을 디자인 기준으로 사용한다. 웹 CSS 자체를 React Native에 적용하지 않는다.

| 토큰/형태 | 라이트 | 다크 |
| --- | --- | --- |
| 배경 / 카드 | `#F6F7F4` / `#FFFFFF` | `#0B1622` / `#13212F` |
| 제목 / 본문 / 보조 | `#0E1A26` / `#3F4B57` / `#647180` | `#E6EDF3` / `#B4C2CF` / `#8FA1B3` |
| 브랜드 / 참석 강조 | `#157A43` / `#B8F27C` | `#B8F27C` / `#B8F27C` |
| 구분선 | `#E3E6E1` | `#22324A` |
| 카드 / 대화상자 / 버튼 반경 | 16 / 20 / 12 | 같은 값 |

본문은 Pretendard, 숫자·영문 강조는 Archivo의 역할을 유지한다. 웹의 WOFF2 동적 서브셋과 `next/font`는 모바일에서 재사용할 수 없으므로 라이선스를 확인한 TTF/OTF 자산을 준비한다. 12·14·16·20·28·48 크기 단계는 기본 참고값으로 두고 시스템 글자 확대에서 잘림 여부를 검증한다.

테마는 라이트·다크·시스템 세 가지다. 기기별 선호를 저장하고 시스템 모드에서 OS 변경을 구독한다. 웹 `localStorage`와 모바일 저장소는 자동 동기화하지 않는다. 밝기 전환, 상태 배지, FW/MF/DF/GK/무관 색을 검증하고 색 외에 텍스트로 상태를 설명한다. 최소 44pt(iOS)/48dp(Android) 터치 영역, 스크린리더 이름, 글자 확대, 움직임 줄이기를 수용 기준으로 둔다.

방문자 홈의 모션은 네이티브 구현 여부를 D07에서 정한다. 포함하면 웹과 같은 브랜드·최종 정지 화면을 사용하고, 움직임 줄이기 및 백그라운드 정지를 지원한다. 로그인 회원은 매치 콘솔로 진입한다.

## 인증·권한·데이터

모바일 전용 Supabase 클라이언트와 기기 세션 저장소를 사용한다. 앱 활성/비활성 전환의 토큰 갱신, 만료·회수·로그아웃 시 캐시 초기화를 설계한다. 비밀번호를 별도 보관하지 않으며, SDK의 세션 저장 방식과 OS 보호 저장소의 호환성을 기술 검증에서 확인한다. 공개 가능한 프로젝트 URL·publishable/anon 키만 사용하고 서버 비밀은 포함하지 않는다. [Supabase 모바일 안내](https://supabase.com/docs/guides/getting-started/quickstarts/expo-react-native)

로그인 성공 후 프로필 연결, `pending`·`inactive`·`active`, `must_change_password`, 역할·직책별 권한을 확인한다. 초기 비밀번호 변경이 필요한 계정은 변경 흐름을 먼저 완료한다. 회원 목록은 기존 `get_member_directory`의 계약을 유지하고, 역할 이름만으로 운영 권한을 추정하지 않는다. 읽기·쓰기는 기존 RLS와 RPC 권한 검사를 사용한다.

정기 일정은 서버에서 생성된 것을 조회한다. 서울 시간 기준의 날짜·마감·연도 집계를 양 OS에서 동일하게 표시한다. 모바일 데이터 서비스는 화면별 조회 범위·페이지·캐시·저장 후 갱신 범위를 명시하고 초기 응답 시간·요청 수·전송량을 측정한다. 웹의 일괄 로딩 유지 결정은 [ADR](adr/0001-clubhouse-client-data-loading.md)을 따르고, 모바일 변경을 이유로 웹 로딩을 재작성하지 않는다. 공통 DB 변경이 필요하면 기존 웹 및 설치된 이전 앱 버전과의 호환을 검증한다.

## 의견 기능과 Apple 심사

현재 의견은 비공개 원본 `feedback`, 활동 회원용 `feedback_feed`, 별도 동의한 시스템 제보의 GitHub 공개 채널로 나뉜다. 모바일도 공개 대상·미리보기·동의를 유지하고 GitHub 실패 시 원본 접수 상태를 구분한다. 답변 링크는 검증된 외부 URL로 열고 'AI 답변' 표시를 유지한다. 현재 10건씩 표시는 화면 렌더링 제한이며, 서버 페이지네이션으로 오해하지 않는다.

회원 공개 의견을 포함하면 필터링, 신고·처리, 유해 이용자 차단, 지원 연락처를 설계·검증한다. 현재 UI에서 전용 신고·차단 흐름을 확인하지 못했으므로 공개 의견 출시의 선행 작업이다. 개인정보 정책 URL을 메타데이터와 앱에 연결하고, 계정 생성 지원 시 앱 내 계정 삭제를 반영한다. 운영자 발급만 제공하더라도 삭제 요청·보관 절차를 정의한다. [Apple 지침 1.2·5.1.1](https://developer.apple.com/app-store/review/guidelines/)

심사용으로 가상 회원·일정·회비·랭킹·참여 데이터를 갖춘 별도 환경을 권장한다. 배포 빌드의 명시된 시연 계정/모드에서 같은 기능을 체험하게 하고, 환경 전환 방식을 심사 메모에 설명한다. 실제 회원의 숨김 표식만으로 격리를 대체하지 않는다. 검토용 계정 정보는 저장소에 넣지 않고 App Store Connect의 지정 필드로 제공한다.

## 빌드·팀 배포

| 프로필 | 목적 |
| --- | --- |
| development | 개발 클라이언트와 기기 디버깅 |
| preview | Android 팀 테스트 APK와 iOS TestFlight 시험용 빌드. iOS는 스토어 제출 가능한 배포 설정 사용 |
| production | Android 배포 APK와 iOS App Store 제출 빌드. 고정 앱 ID·서명 및 버전 관리 |

Android preview/production은 `android.buildType: "apk"` 등 APK 생성 설정을 명시한다. 같은 서명 키와 앱 ID, 증가하는 `versionCode`를 유지하고 키 보관 책임자를 지정한다. 회원 다운로드 페이지에는 버전·체크섬·설치·업데이트 안내를 제공한다. 직접 배포도 [개발자 인증 요건](https://developer.android.com/developer-verification)의 영향을 받을 수 있으므로 대상 국가와 출시 시점의 적용 조건을 확인한다. [Expo APK 안내](https://docs.expo.dev/build-reference/apk/)

iOS는 TestFlight 검증 → 완성된 버전 App Review 제출(미등록 배포 의도 명시) → 미등록 배포 요청 → 앱 심사 및 요청 승인 확인 → 링크 배포 순서로 진행한다. 링크 보유자는 다운로드할 수 있으므로 이용은 회원 인증으로 제한한다. [Apple 미등록 배포 안내](https://developer.apple.com/support/unlisted-app-distribution/)

Windows 개발 환경에서는 iOS 클라우드 빌드와 실기기 테스트 수단을 준비하고, 네이티브 문제의 Mac/Xcode 디버깅 경로를 D08에서 정한다. 업데이트 노트에는 현재 설치 앱의 버전과 해당 앱에 적용된 변경만 명확하게 안내한다.

## 수용 기준

1. workspace 추가 후 웹 lint·typecheck·test·production build와 두 OS 앱 빌드가 성공한다.
2. 로그인 → 초기 비밀번호 변경(필요 시) → 매치 콘솔 응답 → 일정 상세 → 앱 재시작 후 세션 복원을 실기기에서 확인한다.
3. 다섯 탭·더보기·딥링크·뒤로가기와 각 모듈의 목적지가 출시 범위에 맞게 동작한다.
4. 라이트·다크·시스템, 글자 확대·스크린리더·움직임 줄이기, 빈 데이터·오류·오프라인을 확인한다.
5. 미연결·대기·비활동·권한 없는 계정과 심사용 데이터 격리를 서버 조회·변경까지 검증한다.
6. 포함된 공개 의견의 관리 기능, 개인정보·지원 안내 및 심사 자료를 갖춘다.
7. APK 신규 설치·업데이트, TestFlight 실기기 시험, 미등록 앱 승인·설치 및 운영 담당 인계를 완료한다.

관련 문서: [분석](mobile-app-analysis.md) · [작업 계획](mobile-app-tasks.md)
