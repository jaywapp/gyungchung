# 오버롤 기본 그래프·0점 입력 검증

사용자 요청대로 기본 표시 상태를 그래프로 통일하고 능력치 수정 버튼 뒤에서만 입력하도록 바꿨다. 성공한 미평가 조회에는 6개 항목·오버롤을 0으로 표시하지만 저장 행을 만들지 않는다.

## 확인한 동작

- 기본 미평가 그래프와 수치 0, 입력 없음·쓰기 없음. 수정 후 0 초기값, 미평가 취소 후 표시 복원.
- 빈 입력을 0으로 보완한 혼합 점수와 전체 0점을 저장하고 저장 후·재진입 시 표시 상태 유지. 저장된 0행은 미평가 안내가 없다.
- 기존 양수 점수의 기본 그래프·수정·취소·저장, 관리자 회원 능력치 탭의 같은 흐름.
- 세 운영진 직책·일반 회원 역할인 시스템 관리자·능력치 권한만 있는 운영진 허용. 일반 회원·권한 제외 운영진은 패널과 점수 조회 없음.
- 로딩·503 오류는 0점으로 오인하지 않는다. 재시도·Escape·포커스 복원, 늦은 대상/권한/실제 계정 ABA 응답 방어 유지.
- 저장된 0점은 팀 평균에 포함하고 실제 미평가는 제외한다. 합성 A팀 평균 45.0, 평가 2명/전체 4명 확인.

## 실행 결과

- 관련 실제 컴포넌트·클라이언트 검사 33개 통과.
- 전체 웹 검사 364개 중 363개 통과·기존 skip 1개·실패 없음.
- TypeScript 통과, 전체 lint 오류 0·기존 회원 디렉터리 hooks 경고 2개 유지.
- Next.js 프로덕션 빌드 정적 페이지 21/21 완료.
- 실제 PostgreSQL 17.6 격리 검증 SQL460·pgTAP208, 합668 통과. 별도 DB 검증 문서와 원본 로그 확인.
- 합성 Auth/REST Chromium 데스크톱1440×1050·모바일390×844, 한 번의 batch에서 18시나리오·434검사 통과. 페이지 오류·예상 밖 외부 요청·금지된 공개 쓰기 없음.
- 실제 스크린샷32개 보존. 루트가 desktop-zero-display와 mobile-zero-edit를 직접 확인했으며 독립 리뷰에 모든 이미지 제공.
- 브라우저 대상 source13개 전후 동일. 루트가 구현·DB8파일 SHA256 별도 보존. 저장 helper 본문은 하한 비교 한 곳과 오류 문구 두 곳만 바뀐 것을 독립 비교했고, 이전 본문 MD5는 운영 catalog과 일치했다.

## 산출물과 한계

로컬 증거는 .ux-review/member-overall-zero/의 targeted-test.log, test.log, type.log, lint.log, build.log, source-evidence.json, helper-evidence.json과 browser/result.json·verify.mjs·fixture.mjs·32개 PNG다.

기존 브라우저 kernel 접근 제한에 따른 동일 세션의 headless Chromium 대체 경로를 사용했다. 합성 계정·데이터만 사용했고 운영 회원의 점수를 조회하거나 입력하지 않았다. 두 viewport는 실제 모바일 기기·모든 브라우저·전체 WCAG 적합성을 보증하지 않는다.

DB 최초 pgTAP 실행에서 테스트 파일 생성의 dollar-quote 치환 오류를 발견해 해당 인용만 고치고 새 합성 DB에서 재실행했다. 최초 로그도 보존했다. 제품 migration SQL의 해시는 바뀌지 않았다.

공식 [Supabase changelog](https://supabase.com/changelog), [함수 가이드](https://supabase.com/docs/guides/database/functions), [PostgreSQL ALTER TABLE](https://www.postgresql.org/docs/17/sql-altertable.html)를 확인했다. 마이그레이션은 원본 private 테이블의 점수 CHECK와 기존 helper의 하한만 확장하며 공개 접근·권한·기존 점수 변경을 포함하지 않는다.

운영 DB 마이그레이션·이력·전후 catalog/데이터 digest·advisor와 PR/웹 배포는 다음 릴리스 단계에서 별도 확인한다. 앱 변경은 없다.
