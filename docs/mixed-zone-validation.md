# 믹스트존 통합 검증

2026-10-08 최종 검사·출시를 진행 중이다.

- 전체 웹 Node 회귀: JUnit에 377개 사례, failure 0, 기존 skip 1개. 루트 실행 exit 0.
- TypeScript·ESLint: 오류 0. 기존 회원 메뉴 useEffect 경고 2개 유지, 신규 SQL 검증 스크립트 경고는 제거했다.
- 실제 PostgreSQL 17.6: 통합 190개·pgTAP 112개 통과. 합성 데이터와 운영 데이터를 구분한다.
- 웹 production build: 21개 정적 페이지 생성 확인. 초기 dev 동시 실행으로 _not-found 빌드 오류가 발생했고, 해당 dev를 종료한 독립 빌드에서 정상 완료했다. 저장 이후 폼 초기화 문제를 수정한 최신 소스는 마지막 빌드·브라우저 확인 중이다.
- 브라우저 초회 서버 준비 전 연결 실패와 이전 대상 label 접근성/공유 .next 오류 결과는 .ux-review/mixed-zone/browser/result.json 및 verified-result.json에 원문 보존했다. 최신 결과는 final-result.json에 별도로 기록한다.
- 운영 DB 적용·독립 최종 리뷰·PR 병합·운영 READY/HTTP/오류 확인은 실제 완료 뒤 이 문서에 추가한다.

## 최종 기능·운영 DB 게이트 완료

최신 production build exit0·21개 정적 페이지, 브라우저 8시나리오·56확인·실패/JS오류/허용하지 않은 쓰기0을 확인했다. PNG 11장과 소스 해시를 직접 확인한 독립 리뷰는 SHIP이며 두 P2는 해결됐다. 모바일 전체 verify도 TypeScript·lint·719/719 통과, Android export 통과 및 독립 SHIP이다.

운영 DB 20261007153120_add_mixed_zone_ratings.sql 적용과 이력 확인 완료. 기존 수동 점수/감사 및 권한 digest·POTM/출석/일정 건수 동일, 새 평가0건. Synthetic 데이터를 운영에 작성하지 않았다. 마이그레이션 파일은 실제 운영 이력 버전에 이름만 맞추고 SQL bytes와 SHA를 보존했다. 웹 PR 병합·READY·HTTP·오류 로그, 앱 CI 서명 빌드·APK 발행 검증은 이어서 실제 관찰 결과로 남긴다.

## 웹 운영 배포 완료 · 2026-10-08

[PR #195](https://github.com/jaywapp/gyungchung/pull/195)를 정상 검사 뒤 병합했다. 운영 main은 6d5edd8b5c807173c9c3fea6162d694b2f48e6d2, 검증 브랜치와 병합본 tree는 모두 0c3243e7a0148e286489bd3d5ad6bf876e415511이다.

- URL: https://gyungchung.vercel.app
- Vercel production: dpl_5HaeiczEbneBMK44NHa7SzUPJZVH, READY, 병합 SHA 일치, Next.js 15.5.27, 빌드 37.37초.
- / · /members · /admin · /updates HTTP 200, 업데이트 화면의 믹스트존 안내 확인.
- 최근 30분 error/fatal 로그와 runtime errors 없음. 새 평가를 운영에 작성하지 않았다.
- 이 작업의 합성 PostgreSQL55440과 로컬 Next3141은 검사 뒤 종료했다. 증거 파일은 보존한다.

Android 동기화 [PR #18](https://github.com/jaywapp/gyungchung-mobile/pull/18)도 필수 검사 뒤 병합됐다. main8082a3a06c709f875f32487b39e8464f93823357 기준 [실행19번](https://github.com/jaywapp/gyungchung-mobile/actions/runs/37646242379)에서 APK를 빌드·검증한다. 실제 공개 APK·서명·manifest·업데이트 서버 확인 결과는 모바일 저장소의 android-0.1.6-verification.md와 상위 최종 배포 기록을 따른다. 이 문서의 웹 완료를 Android 실기기·공개 발행 완료의 대체 증거로 해석하지 않는다.
