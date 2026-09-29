# 테마 라이트·다크 적용과 UX 즉시 항목 — 작업

모든 작업이 `app/globals.css` 한 파일을 함께 고치므로 병렬 위임 없이 리더 세션이 순서대로 처리한다.
같은 파일을 여러 에이전트가 동시에 고치면 병합 충돌 위험이 병렬화 이득보다 크다.

| ID | 작업 | owner | model | effort | depends_on | parallel_group | 상태 |
|---|---|---|---|---|---|---|---|
| T1 | Pretendard dynamic-subset 로드 | leader | opus | low | - | none | done |
| T2 | 한글 라벨 타이포(Pretendard 600, 자간 0), 숫자 tabular-nums | leader | opus | low | T1 | none | done |
| T3 | 참여 마감 판정·배지·버튼·문구·마감 카드 | leader | opus | low | - | none | done |
| T4 | 회원 카드 강퇴를 '⋯' 메뉴로 이동, 위험 색 | leader | opus | low | - | none | done |
| T5 | 장소 링크 브랜드 색, 페이지 제목 '의견' | leader | opus | low | - | none | done |
| T6 | 하드코딩 색 변수화, 라이트·다크 토큰, 그림자·강조선·반경 | leader | opus | high | T2 | none | done |
| T7 | 테마 전환(인라인 스크립트, `lib/theme.ts`, 마이페이지 스위치) | leader | opus | medium | T6 | none | done |
| T8 | 검증: lint·test·build, dev 서버 라이트·다크 × 데스크톱·390px | leader | opus | medium | T1–T7 | none | done |

## 후속 후보(이번 범위 밖)

- 비로그인 방문자용 테마 전환 위치(푸터 등)
- 타이포 스케일 6단계, 페이지 제목 56/32px, 제목 자간 -0.02em
- 랭킹 공동 순위 T1 표기, 회원 이니셜·포지션 색 아바타
- 홈 히어로 개편, 모바일 하단 탭 바, 회원 목록 재설계
- DB 상태가 `open`으로 남은 채 마감일이 지난 설문을 자동으로 `closed` 처리(결과 공개 조건과 연결됨)
