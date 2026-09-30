# GCFC 아이콘·가로 로고 — 작업

| ID | 작업 | owner | model | effort | depends_on | parallel_group | 상태 |
|---|---|---|---|---|---|---|---|
| T1 | 서체 인스턴스 추출, 윤곽선 SVG 생성(아이콘, 가로 로고 2종) | leader | opus | medium | - | none | done |
| T2 | PNG 변환, 웹 아이콘 교체, `public/brand/` 추가, 앱 작업 폴더에 원본 전달 | leader | opus | low | T1 | none | done |
| T3 | 업데이트 노트, lint·tsc·test·build, 운영 경로 응답 확인 | leader | opus | low | T2 | none | done |
| T4 | push, PR, (사용자 병합 후) 운영 배포 확인 | leader | opus | low | T3 | none | todo |

작업이 순차 의존이라 병렬 위임은 하지 않았다.
