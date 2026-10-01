# 모바일 업데이트 API 설계

공개 GET은 schemaVersion/platform/applicationId/versionName/versionCode/assetName/sha256/sizeBytes/notes/publishedAt만 반환한다. 버전 코드 순으로 선택하며 latest 표시는 사용하지 않는다. notes는 검토된 공개 update.json의 제한된 일반 텍스트만 사용하고 manifest 부재 시 고정 안내를 반환한다. raw release.body는 사용하지 않는다.

다운로드 GET은 download=1 및 versionCode만 허용한다. auth.getUser(token) 및 profiles.auth_user_id/status를 확인한 뒤 고정 저장소의 검증된 asset ID로 요청한다. 토큰은 api.github.com에만 전송하고 HTTPS release-assets.githubusercontent.com에는 전달하지 않는다.

메타데이터는 120초 캐시/동시 요청 병합, 전체 15초 제한, JSON 1MiB 및 작은 파일 16KiB 한도다. 다운로드는 매번 인증하고 전체 120초 제한 및 소비/요청 취소를 전달하며 APK를 스트리밍한다.

공개 요청이므로 verify_jwt=false가 필요하며 다운로드는 본문에서 인증한다. 공식 [인증 헤더 문서](https://supabase.com/docs/guides/functions/auth-headers)와 [getUser 문서](https://supabase.com/docs/reference/javascript/auth-getuser)를 확인했다. 2026-10-01 공식 변경 기록에서 해당 방식에 영향을 주는 breaking change는 확인되지 않았다. 배포는 리더가 수행한다.
