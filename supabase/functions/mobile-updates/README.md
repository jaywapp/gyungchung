# 모바일 업데이트 API

GET /functions/v1/mobile-updates는 로그인 없이 검증된 Android 최신 버전 정보를 반환합니다. GET /functions/v1/mobile-updates?versionCode=N&download=1는 회원 JWT와 연결된 active/pending 회원 확인 후 APK 바이트를 스트리밍합니다. inactive 및 미연결 계정은 403, 잘못된 인증은 401입니다. 실패 시 앱은 기존 버전을 계속 사용해야 합니다.

## 서버 설정과 배포

- 신규 서버 환경변수 GITHUB_MOBILE_RELEASES_TOKEN: jaywapp/gyungchung-mobile 비공개 저장소의 Contents 읽기 권한만 부여한 토큰입니다. Issues 토큰을 재사용하지 않습니다.
- 서버 자동 환경변수 SUPABASE_URL 및 SUPABASE_SECRET_KEY 또는 SUPABASE_SERVICE_ROLE_KEY를 사용합니다. APK 인증은 auth.getUser(token) 서버 확인과 profiles.auth_user_id/status 조회를 수행합니다.
- 공개 조회를 허용하기 위해 verify_jwt=false로 배포합니다. APK 경로는 함수 본문에서 별도 인증합니다. [공식 인증 헤더 안내](https://supabase.com/docs/guides/functions/auth-headers)를 확인했습니다.
- 배포 entrypoint는 supabase/functions/mobile-updates/index.ts이며 supabase/functions/_shared/mobile-updates.ts를 함께 포함해야 합니다.
- 이 변경에서는 자격증명 등록, DB 변경, 운영 배포를 수행하지 않았습니다. 신규 GitHub 토큰이 없으면 503 not_configured입니다.

## 릴리스 계약

최근 20개 릴리스에서 draft/prerelease를 제외하고 gyungchung-X.Y.Z-android-N.apk 패턴과 uploaded 상태, 양의 Android versionCode 및 250MiB 이하 크기를 검증합니다. checksums.sha256 파일을 마지막에 업로드해야 완료된 릴리스로 인정합니다. checksum의 해당 APK 항목과 GitHub sha256 digest가 있으면 반드시 일치해야 합니다. digest가 없는 기존 100016 릴리스도 checksum으로 검증합니다. SHA-256 문자열은 소문자 64자리입니다.

선택적 update.json의 schemaVersion/platform/applicationId/versionName/versionCode/assetName/sha256/sizeBytes는 APK와 정확히 일치해야 합니다. notes는 공개용 일반 문장만 담으며 8개/각 240자 이내입니다. URL, 제어문자, GitHub 링크·토큰 패턴·40자리 커밋 해시·PR 참조는 거절합니다. GitHub 원본 release body는 사용하지 않습니다. 자유 문장의 개인정보/비공개 내용을 자동 판별할 수 없으므로 manifest에는 검토된 사용자 안내만 넣어야 합니다.

latest 표시나 게시 시각 대신 가장 큰 versionCode를 선택합니다. 동일 코드의 여러 APK는 안전하게 거절합니다. 불완전한 릴리스는 건너뛰고 손상된 릴리스만 있으면 502를 반환합니다. 다운로드는 최근 검증된 버전에 한하며 임의 repo/URL/token 입력을 받지 않습니다.

## 제한과 앱 검증

메타데이터는 프로세스별 120초 캐시 및 동시 요청 병합을 사용합니다. HTTP 공개 응답도 no-store이며 다운로드는 private, no-store입니다. 메타데이터 전체 요청은 15초, releases JSON은 1MiB, checksum/manifest는 각 16KiB 이하입니다. APK 전체 요청은 120초로 제한하고 소비 취소를 upstream에 전달합니다. 느린 연결에서는 재시도가 필요할 수 있습니다.

토큰은 api.github.com에만 전달합니다. HTTP 302의 HTTPS release-assets.githubusercontent.com만 허용하고 리다이렉트에는 헤더를 전달하지 않습니다. GitHub asset 응답은 200/302를 지원합니다. 프록시는 전체 APK를 메모리에 적재하지 않고 크기를 확인하며 스트리밍합니다. 앱은 설치 전 받은 APK의 실제 SHA-256과 패키지 applicationId, 현재 앱과 동일한 서명, 증가하는 versionCode를 검증해야 합니다. 설치는 Android 사용자 승인 절차를 거칩니다. 타 서명이나 낮은 versionCode를 서버 프록시만으로 설치 가능하게 만들 수 없습니다.

## 검증

node --experimental-default-type=module --test supabase/functions/tests/mobile-updates.test.ts

주입된 fetch/Auth 계약으로 공개 정보 제한, 버전 선택, checksum/manifest 일치, 업로드 완료, cache/auth 분리, redirect 토큰 차단, 스트림 취소/크기 오류, 시간 제한 및 안전한 오류를 검증합니다. 실제 운영 GitHub/Supabase 연동과 배포 확인은 리더의 후속 단계입니다.

