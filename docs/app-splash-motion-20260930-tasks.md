# 앱 스플래시 모션 — 작업

| ID | 작업 | owner | model | effort | depends_on | parallel_group | 상태 |
|---|---|---|---|---|---|---|---|
| T1 | `lib/splash-motion.ts`와 테스트 | leader | opus | medium | - | none | done |
| T2 | `components/app-splash.tsx`, 첫 페인트 스크립트, CSS, 레이아웃 연결 | leader | opus | high | T1 | none | done |
| T3 | 아이콘 PNG 생성, `app/manifest.ts`, Apple 메타데이터 | leader | opus | medium | - | none | done |
| T4 | 업데이트 노트, lint·tsc·test·build, 브라우저 확인(`?splash=preview`) | leader | opus | medium | T2, T3 | none | done |
| T5 | push, PR, (사용자 병합 후) 운영 배포 확인 | leader | opus | low | T4 | none | todo |

작업이 순차 의존이고 파일이 겹쳐 서브에이전트 병렬 위임은 하지 않았다.
