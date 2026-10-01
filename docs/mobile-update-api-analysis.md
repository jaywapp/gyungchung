# 모바일 업데이트 API 요구사항

APK 공개 배포 채널은 `jaywapp/gyungchung-releases`로 고정한다. 소스 저장소 `jaywapp/gyungchung-mobile`은 비공개로 유지하며 서버는 소스 저장소의 릴리스를 조회하지 않는다. 공개 APK 직접 링크는 GitHub 계정 없이 최초 설치 파일을 받을 때 사용한다.

로그인 전에는 검증된 Android 버전 정보만 공개한다. 릴리스 본문, commit/PR 정보와 GitHub 주소는 메타데이터 JSON에 포함하지 않는다. 앱 안의 APK 다운로드는 기존 Supabase `getUser` 검증과 `auth_user_id`로 연결된 회원 상태 확인을 매번 거치며 `active`/`pending`만 허용한다. API의 익명 다운로드는 401을 유지한다.

최근 20개 정식 릴리스의 완료 APK 중 최대 `versionCode`를 선택한다. `checksums.sha256`를 완료 표식으로 사용하며 `update.json`이 있으면 APK와 정확히 일치해야 한다. 기존 manifest 부재 호환도 유지한다. APK 바이트, 네이티브 URL과 JSON 계약은 이번 변경 대상이 아니다.

서버의 `GITHUB_MOBILE_RELEASES_TOKEN`은 선택 사항이다. 미등록/빈 값에서는 Authorization 헤더 없이 공개 GitHub API를 호출한다. 필요하면 공개 배포 저장소 Contents 읽기 전용 토큰을 추가할 수 있으며 기존 Issues 토큰을 재사용하지 않는다. 토큰 등록, 외부 게시, 운영 배포는 리더가 수행한다. DB와 다른 함수 변경은 범위 밖이다.

GitHub 익명 API는 원본 IP별 시간당 60회 제한이 있다. REST API는 릴리스 목록을 한 번 조회하는 데만 사용하고, checksum/manifest/APK는 고정 공개 저장소의 검증된 browser_download_url로 받는다. 선택 토큰도 목록 조회에만 전송한다. 무토큰 성공 결과는 함수 인스턴스에서 10분, 토큰이 있으면 기존 120초 동안 캐시한다. 앱은 조회 실패에도 사용 가능하며 설치 전 실제 checksum/동일 서명/증가하는 versionCode를 확인한다. 공개 직접 APK 링크는 서버 메타데이터 조회와 별도 경로다.
