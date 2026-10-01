# 모바일 업데이트 API 작업

| 작업 | owner | model | effort | depends_on | parallel_group | 상태 |
|---|---|---|---|---|---|---|
| 공개 배포 채널·선택 토큰 계약 문서 | public_release_api | gpt-6.1-sol (sonnet 역할) | medium | 리더의 공개 저장소 방향 | api | 완료 |
| 고정 공개 업스트림·조건부 인증·캐시 | public_release_api | gpt-6.1-sol (sonnet 역할) | high | 계약 | api | 완료 |
| 무토큰·토큰·인증 경계 회귀 검증 | public_release_api | gpt-6.1-sol (sonnet 역할) | high | 구현 | api | 완료 |
| 공개 자산 URL 검증·REST 목록 1회 | public_release_api | gpt-6.1-sol (sonnet 역할) | high | 한도 재검토 | api | 완료 |
| test/lint/production build | public_release_api | gpt-6.1-sol (sonnet 역할) | medium | 최종 구현 | api | 완료 |
| 공개 릴리스 게시·업스트림/운영 확인 | root | 리더 세션 | high | 코드 검토·공개 릴리스 | release | 리더 진행 |
| 실제 회원·Android 설치 QA | root | 리더 세션 | high | 운영 배포·실제 테스트 기기 | qa | 대기 |

서버 작업자는 지정된 함수/테스트, 이 분석·설계·작업 문서, `lib/update-notes.ts`만 수정한다. 커밋·푸시·PR·배포·시크릿 등록은 리더가 수행한다. APK 바이트와 네이티브 계약은 변경하지 않는다. 공개 저장소의 첫 릴리스 게시 전에는 실제 업스트림 검증 결과를 미실행으로 기록한다.

## 공개 자산 URL 전환 전 검증 기록

- `npm test`: Node 22.19.0에서 146/146 통과. 무토큰 metadata 200, outbound Authorization 없음, 선택 토큰 유지, 고정 공개 저장소, 600초/120초 캐시, 익명 다운로드 401 및 기존 검증·취소·인증 회귀를 확인했다.
- `npm run lint`: 통과(exit 0).
- `npm run build`: 통과(exit 0), 최적화 컴파일·타입/린트·21개 정적 페이지 생성 완료.
- `git diff --check`: 통과. 지정된 7개 파일만 변경했다.
- 번들 Node 24는 기존 테스트 스크립트의 `--experimental-default-type=module` 옵션을 지원하지 않아 설치된 Node 22로 실행했다. 의존성 설치나 테스트 스크립트 변경은 하지 않았다.
- 2026-10-01 첫 공개 릴리스 게시 후 로컬 handler가 실제 공개 GitHub 업스트림을 무토큰 조회해 metadata 200을 반환했다. `versionCode=100017`, `assetName=gyungchung-0.1.0-android-100017.apk`, `sizeBytes=84008501`, SHA-256 `49b80b864321e96a2e29a7a877f9ff7f26f93ca5fa412acf7d9e93842ad483b3`을 확인했다. 전환 전 구현에서 GitHub API 3회와 asset CDN 리다이렉트 2회 모두 Authorization 헤더를 보내지 않았고 익명 API 다운로드는 업스트림 요청 없이 401이었다.
- 첫 프로브는 예제의 1.0.0 파일명을 잘못 가정한 마지막 assertion이 실패했으며 실제 0.1.0 파일명으로 바로잡은 프로브가 통과했다. 함수 구현의 변경은 필요하지 않았다.
- 서버 작업자는 운영 배포·실제 회원/Android 설치 QA를 수행하지 않았다. 실제 active/pending 회원의 앱 다운로드·checksum·동일 서명 설치·설치 후 재확인은 남아 있다.


## 공개 자산 URL 전환 후 최종 검증

- `npm test`: 148/148 통과(exit 0). 기존 146개 회귀와 20개 완성 릴리스에서 REST 목록 1회만 호출하는 검증, 자산 URL 방어를 통과했다.
- `npm run lint`, `npm run build`, `git diff --check`: 통과(exit 0). 프로덕션 빌드는 타입·린트 및 21개 정적 페이지 생성을 완료했다.
- 실제 공개 업스트림 무토큰 프로브: metadata 200, versionCode 100017, `gyungchung-0.1.0-android-100017.apk`, 84,008,501바이트, SHA-256 `49b80b864321e96a2e29a7a877f9ff7f26f93ca5fa412acf7d9e93842ad483b3` 일치. REST 목록 1회, github.com 공개 자산 2회, CDN 2회 모두 Authorization 헤더 없이 요청했다. 익명 API 다운로드는 업스트림 요청 없이 401이었다.
- 선택 토큰은 고정 공개 저장소 REST 목록 요청에만 전송하며 github.com 자산·CDN에 전달하지 않는 것을 주입 테스트로 확인했다. 자산 URL의 다른 저장소/호스트, 인증정보, 명시적 포트(443 포함), 쿼리/fragment, 추가 태그 경로, 인코딩된 슬래시/역슬래시, 예상과 다른 파일명을 거절했다.
- 지정된 기존 7개 파일만 변경했고 DB·의존성 설치·APK 바이트·네이티브 URL/JSON/JWT 계약 변경은 없다. 운영 배포와 실제 회원/Android 설치 QA는 리더가 수행한다.
