# 전화번호 로그인 분석

orchestrator: Codex

## 요구사항
- 전화번호·비밀번호 로그인만 제공하고 이메일·카카오·Google 로그인 및 연결 UI를 제거한다.
- 로그인 이후 새로고침·재방문에서 세션을 유지한다. 명시적 로그아웃과 비밀번호 변경 후 재인증은 유지한다.
- 사용자는 이 프로젝트 작업을 승인했으며 추가 질문 없이 진행하도록 요청했다.

## 확인 내용
- Supabase 프로젝트 pamvwzgqkzgsygslmfqo(gyungchung)가 INACTIVE 상태다. 이 프로젝트의 복구가 실제 인증 검증에 선행한다.
- 설치된 @supabase/ssr 0.7.0은 이미 영속 쿠키·자동 토큰 갱신을 사용한다. JWT 만료를 무제한으로 늘리는 방식은 사용하지 않는다.
- 기존 Auth 계정의 전화번호 연결 여부는 집계만 조회한다. 계정 삭제, 비밀번호 일괄 변경 또는 소셜 identity 일괄 삭제는 수행하지 않는다.
- 기존 가입 프로비저닝·초기 비밀번호 변경 규칙과 DB 권한은 보존한다.
- 관리자 도구 OAuth consent는 소셜 로그인과 별개이므로 유지하되 그 화면의 로그인도 전화번호만 허용한다.
- 기존 디자인에서 불필요한 인증 수단 제거에 한정한 국소 수정이므로 주요 UX 콘셉트 3종 절차는 적용하지 않는다. impeccable·design-taste-frontend를 계속 적용한다.

## 참고
- https://supabase.com/docs/guides/auth/sessions
- https://supabase.com/docs/reference/javascript/auth-onauthstatechange
- Supabase changelog의 현재 인증 관련 변경과 설치 소스를 대조한다.

## 운영 확인 결과
- 프로젝트 복구 후 ACTIVE_HEALTHY, 인증 settings HTTP 200 및 phone 활성화 확인.
- 회원 연결 계정 23개: Auth 전화번호 없음 0, 미확인 0, 회원 정보와 불일치 0. 계정 삭제·비밀번호 재설정 없이 전환 가능.
- Production 공개 인증 URL/키가 비어 있어 기존 프로젝트의 publishable key로 복원했다. Development도 일치시켰다. 키 내용은 문서·출력·Git에 저장하지 않는다.
- 브라우저에서 공개 공지가 정상 조회되고 인증 초기화 오류가 사라진 것을 확인했다.
- 실제 회원 비밀번호는 조회하거나 변경하지 않았다. 세션 생성·재방문·갱신·로그아웃은 실제 SDK와 모의 인증 응답으로 검증한다.
- 서버에 기존 provider 설정/identity는 보존한다. 사이트에서는 해당 로그인 시작 경로가 없고 과거 callback도 세션을 교환하지 않는다.

운영·개발 NEXT_PUBLIC_SITE_URL도 실제 운영 주소로 복구했다. 프리뷰 설정은 CLI가 원격 브랜치를 요구하므로 브랜치 게시 후 등록한다.
