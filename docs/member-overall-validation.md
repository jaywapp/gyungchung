# 회원 오버롤 웹 검증

작성일: 2026-10-07 · 기준 main 0edb7fc · codex/member-overall

최종 웹 테스트359개:358 pass, 기존1 skip, 실패0. TypeScript 및ESLint exit0(기존 회원메뉴effect경고2, 신규UI파일경고0). 최초통합에서능력치선택nullable타입과신규서비스수기대값을수정했다. 독립리뷰의두P2(팀점수대상변경캐시와능력치탭권한조회실패빈화면)는수정하고관련회귀4개를추가했다.

실제독립PostgreSQL17.6 SQL417 및pgTAP197통과. root도5권한별읽기전용smoke로API출력을실제클라이언트parser로확인했다. 일반회원42501, 회장/부회장/숨김QA관리자/일반role시스템관리자응답이검증됐다. SQL파일SHA256은8ea5ac7a31dbecb29197958996def842b2f0f227b0d6735272ddff470ee9944f. 독립클러스터55438정상종료,데이터보존. 실제운영회원점수입력은하지않았다.

원본 .ux-review/member-overall/source-evidence.json의15개소스해시와test/type/lint/build, DB원로그는보관하되커밋하지않는다. DB상세는member-overall-db-validation.md, 독립최종판정은member-overall-review.md를따른다.

운영 DB준비조회에서17.6/능력치테이블미존재를확인했다. 배포전advisor기준은보안WARN3 INFO1, 성능WARN1 INFO2이며ERROR없다. 로컬advisorCLI는TLS연결제약이있어운영MCP전후검사로보완한다. 실제운영변경은최종브라우저/ship검토후적용한다.

기준질문은응답이없어제안한6항목1~100정수/동일가중평균을작업기준으로선언했다. 사용자의기준승인으로간주하지않으며웹점검피드백에따라조정할수있다. 앱은동기화요청까지보존한다.

## 최종 브라우저·리뷰 및 운영 DB

포커스 보완 후 최종 테스트 362개 중 361 pass/1 skip, 타입·lint exit0, 생산 빌드 21페이지를 확인했다. 초기 16시나리오에서 제품 포커스 2건과 fixture 재열기 절차 2건을 구분하고, 해당 4시나리오만 한 번 확인했다. 최종 204개 고유 확인, 페이지 오류·외부 요청·금지 쓰기 0이며 원본 실패 기록을 보존했다. 초기186/확인92 중 중복을 제거한 결과다. 독립 판정은 ship이며 P2 세 건을 해결했고 남은 P1/P2는 없다.

운영 17.6에 같은 SQL을 적용했다. Supabase 이력 20261007080520에 맞춰 로컬 파일을 supabase/migrations/20261007080520_add_member_overalls.sql로 옮겼다. SQL 바이트와 검증 해시는 동일하다. RLS 활성, authenticated 직접 테이블 조회 없음, anon RPC 거절, public invoker와 세 직책 신규 권한을 확인했다. 능력치 rows0이며 실제 회원 점수는 입력하지 않았다. 운영 advisor 새 알림 0, 기존 보안 WARN3/INFO1·성능 WARN1/INFO2를 유지한다(ERROR0).
