# 성능 개선 검증 기록

작성일: 2026-10-03. 최신 main `e6c9e5cb`에서 분리한 `codex/performance-improvements` 브랜치에서 검증한다. 원래 작업 디렉토리와 모바일의 기존 iOS 준비 브랜치는 변경하지 않는다.

## 조회와 화면

- 비로그인 첫 방문의 공개 4개, 로그인 시 공개 4개·회원 14개로 이루어진 데이터 18개 선행 조회 정책을 유지한다. 데스크톱·모바일 브라우저에서 데이터 18개와 별도 알림 설정 1개 초기 조회를 확인했다.
- 웹 출석 저장 14→1, 회비 저장 14→2, 일정 수정 18→3, 공지 저장 4→1개로 갱신 범위를 줄였다. 회원·권한 변경과 일정 삭제는 전체 갱신을 유지한다.
- 같은 owner/resource 읽기는 공유하고, 저장으로 무효화된 진행 중 읽기는 후속 최신 읽기를 수행한다. 계정 변경·언마운트는 취소 및 epoch 검사로 이전 응답을 버린다.
- 실제 Chromium 1440×1100, 390×844에서 모의 백엔드 로그인, 일반 일정 이동과 EventCard(일정 카드)의 **팀 명단 보기** NextLink 이동을 실행했다. 각 이동의 추가 데이터 query 0, 추가 document 요청 0, 오류 0, overflow 0이다. 운영 데이터 쓰기는 수행하지 않았다.
- 초기 로딩과 좁은 배경 갱신의 경합, RSVP 저장과 늦은 조회, 계정 전환의 이전 데이터 잔존을 독립 검토하고 High/Medium 사항을 모두 해결했다. 초기 전체 조회만 skeleton을 해제하고, 진행 중 RSVP overlay와 리소스별 version/owner/epoch를 유지한다.
- 실제 auth callback과 MemberHome 렌더 회귀에서 계정 변경 시 회원/공개 배열 17개·이전 owner dialog 4개 및 프로필/RSVP refs를 즉시 비우는 것을 확인했다. 연결되지 않은 계정·승인 대기 계정으로 전환해도 이전 회원 이름이 렌더되지 않으며 동일 owner TOKEN_REFRESHED는 로딩된 행·편집 상태를 보존한다.

## 계산

Windows Node 22.19, 실제 기존/변경 함수의 동일 입력 출력 `deepEqual`, 워밍업 2회·측정 7회 중앙값이다. 동시에 로컬 검사가 실행돼 편차가 있으며 운영 지연이나 실기기 수치가 아니다.

| 데이터 | 랭킹 전→후 | 출석 집계 전→후 |
|---|---:|---:|
| 일정 200·출석 3,000·회원 60 | 12.941→1.367ms | 5.627→0.250ms |
| 일정 1,000·출석 15,000·회원 60 | 69.719→4.377ms | 71.418→0.419ms |

## 업데이트 메타데이터

릴리스 검증 worker를 3개로 제한하고 checksum/manifest를 병렬 조회한다. 순간 small asset 읽기는 최대 6개, 총 요청량은 유지한다. 최대 20개 전체 검증과 최대 versionCode 선택, URL·hash·size·manifest·중복 코드 검사, 15초 deadline, 120초/600초 cache TTL, singleflight 및 download 인증·전송 계약을 보존한다. 실패 시 형제 읽기를 중단하고 정리까지 pending을 유지한다.

요청마다 모의 20ms 지연과 302 asset redirect를 적용한 3회 중앙값이다. cold는 클라이언트 3개가 동시에 요청했다. Windows timer 비용을 포함하며 운영 RTT가 아니다.

| 릴리스 | cold 전→후 | refresh 전→후 | upstream 요청 |
|---|---:|---:|---:|
| 6개 | 765→153ms | 763→152ms | 25→25 |
| 20개 | 2,473→460ms | 2,486→458ms | 81→81 |

warm cache의 추가 upstream 요청은 0이며, 동시 cold listing은 1회다. CDN 헤더·TTL과 다운로드 Range 계약은 변경하지 않는다.

## 완료 조건과 운영 반영

- 구현·회귀 테스트·브라우저 검증·독립 검토는 완료했다. 전체 테스트 223개 중 222개 통과, 기존 fixture 검사 1개 skip. 최종 웹 타입 검사·린트·production build도 모두 통과했다.
- 외부 PR·main 병합과 Vercel main Git 연동 운영 배포는 진행 예정이다. Supabase `mobile-updates` 별도 배포·운영 검증도 진행 예정이다. 기존 entrypoint와 `verify_jwt=false`, 함수 내부 회원 다운로드 인증을 유지한다.
- Edge Function 롤백은 기준 commit `e6c9e5cb`의 `mobile-updates/index.ts`와 `_shared/mobile-updates.ts`를 같은 함수에 재배포한다.
- 반영 전 운영 기준: Vercel `dpl_5LcvaTbBi2iwvDiQQGpkym3NCiJx`, main `e6c9e5cb`; Supabase `mobile-updates` version 5, ACTIVE, `verify_jwt=false`.
- 모바일 APK 최종 크기·서명·설치·visitor smoke·출시 상태는 모바일 저장소의 docs/performance-improvements-validation.md를 따른다.
- 후속 대상: 운영 RTT·기기 CPU/프레임·payload 계측 후 최초 로딩 경계, 목록 가상화, 푸시·설문 SQL 동시성, ABI별 APK, 이어받기.
