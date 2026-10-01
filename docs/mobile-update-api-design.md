# 모바일 업데이트 API 설계

공개 GET은 `schemaVersion/platform/applicationId/versionName/versionCode/assetName/sha256/sizeBytes/notes/publishedAt`만 반환한다. 버전 코드 순으로 선택하며 latest 표시는 사용하지 않는다. notes는 검토된 공개 `update.json`의 제한된 일반 텍스트만 사용하고 manifest 부재 시 고정 안내를 반환한다. raw `release.body`는 사용하지 않는다.

REST 업스트림은 `https://api.github.com/repos/jaywapp/gyungchung-releases/releases?per_page=20` 목록 요청 한 번으로 고정한다. 선택 토큰은 이 요청에만 붙인다. 클라이언트가 저장소나 asset 주소를 지정하는 입력은 허용하지 않는다. checksum/manifest/APK는 릴리스 자산의 `browser_download_url`을 검증한 뒤 `https://github.com/jaywapp/gyungchung-releases/releases/download/<single-tag>/<expected-filename>`로 받는다. 다른 저장소/호스트, 인증정보, 명시적 포트, 쿼리, fragment, 태그의 추가 경로/인코딩된 슬래시·역슬래시, 예상과 다른 파일명을 거절한다. `ValidatedRelease`에는 검증된 APK asset URL을 저장한다. github.com 자산 요청과 HTTPS exact `release-assets.githubusercontent.com` 리다이렉트에는 인증 헤더를 전달하지 않으며 기존 본문 한도와 수동 리다이렉트 검증을 유지한다.

메타데이터 성공 캐시는 무토큰 600초, 토큰 설정 시 120초이며 동시 요청을 병합한다. 새 릴리스 정보는 살아 있는 함수 인스턴스에서 최대 10분 또는 2분 늦게 반영될 수 있다. 캐시는 인스턴스별 메모리이므로 여러 인스턴스/콜드 스타트가 GitHub 익명 원본 IP별 시간당 60회 한도를 공유할 수 있다. 20개 완료 릴리스의 checksum/manifest를 모두 검증해도 REST API 호출은 목록 1회이며 자산은 GitHub 공개 다운로드 경로를 사용한다. 정상 성공 캐시가 유지되는 인스턴스당 REST 호출은 시간당 최대 약 6회다. 여러 인스턴스/콜드 스타트와 실패 재시도는 여전히 같은 IP 한도를 공유하므로 캐시가 전체 한도 준수를 보장하지는 않는다. 한도 초과 등 upstream 실패는 안전한 502를 반환하고 기존 즉시 재시도 계약을 유지한다. 운영 트래픽이 늘면 공개 배포 저장소 Contents 읽기 전용 토큰을 선택적으로 설정한다. [GitHub API 한도 문서](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)를 확인했다.

다운로드 GET은 `download=1` 및 `versionCode`만 허용한다. `auth.getUser(token)` 및 `profiles.auth_user_id/status`를 확인한 뒤 고정 공개 저장소의 검증된 APK browser URL로 요청한다. 익명 401, 미연결/비활성 회원 403과 active/pending 허용을 유지한다. 공개 배포 저장소의 APK 직접 링크는 최초 설치에 사용하며 이 함수의 회원 인증 경계와 독립적이다.

메타데이터는 전체 15초 제한, JSON 1MiB 및 작은 파일 16KiB 한도다. 다운로드는 매번 인증하고 전체 120초 제한 및 소비/요청 취소를 전달하며 APK를 스트리밍한다. APK 250MiB 한도, checksum/manifest/digest 일치와 스트림 길이 검증을 유지한다.

공개 요청이므로 기존 `verify_jwt=false`를 유지하고 다운로드는 함수 본문에서 인증한다. 공식 [환경변수 문서](https://supabase.com/docs/guides/functions/secrets), [인증 헤더 문서](https://supabase.com/docs/guides/functions/auth-headers)와 [getUser 문서](https://supabase.com/docs/reference/javascript/auth-getuser)를 기준으로 기존 계약을 보존한다. 2026-10-01 [공식 변경 기록](https://supabase.com/changelog)에서 이번 고정 업스트림/선택 토큰 변경에 영향을 주는 breaking change를 확인하지 못했다.

배포 검토 대상은 `supabase/functions/_shared/mobile-updates.ts`와 `supabase/functions/mobile-updates/index.ts` 두 파일이다. 리더가 공개 릴리스 게시 후 실제 공개 GitHub 업스트림과 운영 메타데이터를 확인한다. 회원 QA는 실제 active/pending 계정의 앱 다운로드·checksum·동일 서명 설치·설치 후 재확인이 남는다. 테스트의 가짜 JWT/업스트림 성공으로 실제 회원 또는 Android 설치 QA가 완료되었다고 판단하지 않는다.
