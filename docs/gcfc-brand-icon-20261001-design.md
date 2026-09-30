# GCFC 아이콘·가로 로고 — 설계

## 생성 방식

`gyungchung-mobile/.work/tasks/app-icon-20261001/final/brandgen.py`가 원본 SVG를 만든다.

1. Google Fonts의 Archivo 가변 서체에서 정적 인스턴스를 뽑는다.
   - 워드마크: 이탤릭, `wdth` 125, `wght` 900
   - 문구: 정자, `wdth` 100, `wght` 900
2. 스플래시(`lib/splash-motion.ts`)와 같은 비율로 글자를 배치한다.
   - GC와 FC 사이 간격 0.16em
   - 공 반지름 0.11em, 마지막 C와 공 사이 0.12em
3. 글자를 윤곽선 path로 그린다.

PNG는 이 SVG를 브라우저 캔버스로 그려 만든다.

## 자산

| 파일 | 크기 | 쓰임 |
|---|---|---|
| `app/icon.png` | 512 | 브라우저 탭 파비콘 |
| `app/apple-icon.png` | 180 | iOS 홈 화면 |
| `public/icons/icon-192.png`, `icon-512.png` | 192, 512 | 웹앱 manifest `any` |
| `public/icons/icon-maskable-512.png` | 512 | 웹앱 manifest `maskable`. 워드마크를 0.8배로 줄여 안전 영역 안에 둔다 |
| `public/brand/gcfc-logo-horizontal-dark.svg`, `.png` | 가변, 840px | 어두운 배경용 가로 로고. 흰 글자, 라임 F·공, 흰색 62% 문구 |
| `public/brand/gcfc-logo-horizontal-light.svg`, `.png` | 가변, 840px | 밝은 배경용 가로 로고. 남색 글자, 녹색 `#157a43` F·공, `#647180` 문구 |

배경은 투명이다(아이콘 제외).
