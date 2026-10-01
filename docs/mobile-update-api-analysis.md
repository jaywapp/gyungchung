# 모바일 업데이트 API 요구사항

로그인 전에는 검증된 Android 버전 정보만 공개한다. 비공개 본문/commit/PR/GitHub 주소는 공개하지 않는다. APK 다운로드는 Supabase 서버 getUser 검증과 auth_user_id로 연결된 회원 상태 확인을 매번 거친다. active/pending만 허용한다.

최근 20개 정식 릴리스의 완료 APK 중 최대 versionCode를 선택한다. checksums.sha256를 완료 표식으로 사용하며 update.json이 있으면 APK와 정확히 일치해야 한다. 기존 100016의 manifest 부재도 지원한다.

신규 서버 GITHUB_MOBILE_RELEASES_TOKEN은 Contents 읽기 권한이다. 기존 Issues 토큰 재사용, DB/기존 함수 변경, 자격증명 등록, 커밋/푸시/운영 배포는 범위 밖이다. 앱은 조회 실패에도 사용 가능하며 설치 전에 실제 checksum/동일 서명/증가하는 versionCode를 확인한다.
