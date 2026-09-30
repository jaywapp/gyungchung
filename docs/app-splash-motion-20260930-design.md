# 앱 스플래시 모션 — 설계

## 구조

| 파일 | 역할 |
|---|---|
| `lib/splash-motion.ts` | 타이밍 상수, 워드마크 배치, 공 궤적 샘플, 글자 등장 시점, 재생 모드 판단. DOM 없음(Expo 재사용) |
| `components/app-splash.tsx` | 오버레이 마크업과 Web Animations API 재생 |
| `app/layout.tsx` | 워드마크 서체, 오버레이 배치, 첫 페인트 전 스크립트, Apple 웹앱 메타데이터 |
| `app/manifest.ts` | 웹앱 manifest |
| `public/icons/*.png`, `app/apple-icon.png` | 홈 화면 아이콘(192, 512, maskable 512)과 iOS 아이콘(180) |

## 재생 모드 결정

첫 페인트 전 인라인 스크립트(`splashInitScript`)가 `html[data-splash]`를 정한다. 오버레이는 서버 렌더 마크업이고 CSS로 이 속성이 있을 때만 보인다. 그래서 앱 화면이 먼저 보였다가 가려지는 깜빡임이 없다.

- 설치 실행(`display-mode: standalone` 또는 iOS `navigator.standalone`)이거나 주소에 `splash=preview`가 있을 때만 켠다.
- 같은 세션에서 이미 재생했으면(`sessionStorage`) 켜지 않는다.
- `localStorage`에 재생 기록이 없고 움직임 줄이기가 꺼져 있으면 `full`, 아니면 `short`다. `preview`는 항상 `full`이다.
- 저장소 접근이 막히면 `short`로 처리한다.
- 인라인 스크립트는 4초 뒤 속성을 지우는 안전장치도 건다. 컴포넌트가 재생을 맡으면 이 타이머를 해제한다(느린 로딩에서 모션 중간에 끊기지 않게).

## 모션 (full, 약 1.8초)

- 0ms: 남색 바탕, 하프라인과 센터서클, 페널티 마크. 설치 앱의 운영체제 스플래시(남색 배경과 아이콘)에서 이어진다.
- 150ms: 페널티 마크에서 공을 차 올린다(로브 480ms).
- 630ms: 공이 워드마크 왼쪽에 착지하고 기준선 아래를 굴러간다(420ms). 공이 지나간 글자가 떠오르고, 워드마크 뒤 코트 선은 가려진다.
- 1050ms: 공이 튀어 올라 마침표 자리에 멈춘다(220ms). 이어 문구가 자간을 벌리며 나온다.
- 1530ms: 오버레이가 280ms 동안 사라진다.

`short`는 모든 애니메이션을 완료 상태로 두고 400ms 뒤 사라진다. 탭하면 두 모드 모두 즉시 사라진다.

## 서체와 색

- 워드마크: Archivo 이탤릭, `wdth` 125, 굵기 900. `next/font`로 별도 인스턴스(`--font-wordmark`)를 두고 미리 불러오지 않는다.
- 색: 바탕 `#0b1f33`(두 테마 공통, manifest `background_color`와 같음), 글자 흰색, F와 공은 `--highlight`의 라이트 값 `#b8f27c`. 오버레이는 테마와 무관하게 같은 모습이다.

## Expo 재사용

`lib/splash-motion.ts`는 순수 함수만 둔다. Expo에서는 `expo-splash-screen`으로 네이티브 스플래시를 붙잡은 뒤, 같은 함수로 좌표를 계산해 `react-native-reanimated`와 `react-native-svg`로 그린다.
