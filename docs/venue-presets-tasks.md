# 주변 풋살장 프리셋 작업 계획

| 작업 | owner | model | effort | depends_on | parallel_group | 상태 |
|---|---|---|---|---|---|---|
| 기존 웹·앱·DB 흐름 조사 | venue_existing_flows | gpt-6-sol | medium | 없음 | research | 완료 |
| 아이엠그라운드 공개 목록 조사 | venue_iamground_research | gpt-6-sol | medium | 없음 | research | 완료 |
| 공공 시설·운영자 출처 보완 조사 | venue_public_research | gpt-6-sol | medium | 없음 | research | 완료 |
| 정제·중복·별칭·코트 검증 | root | parent | high | 공개 조사 | data | 완료 |
| DB 스키마·시드·로컬 역할 검사 | root | parent | high | 정제 | database | 완료 |
| 웹·앱 일정 구장 검색 | venue_existing_flows | gpt-6-sol | medium | 기존 흐름 조사 | interface | 완료 |
| 코드·출처·권한 검토 | root | parent | high | 구현 | review | 완료, 화면 검사 한계 기록 |
| DB 적용 | root | parent | high | 검사 | release | 완료 |
| 웹 배포·Android 빌드 및 공개 확인 | root | parent | high | DB 적용 | release | PR 병합 후 확인 |

## 검증 기록

- 운영 DB 기존 구장: 1개. RLS 활성, 공개 읽기 및 일정 관리 권한 쓰기 확인.
- 운영 DB **97개**: 광주시 14, 용인시 60, 성남시 23. 출처·확인 날짜 97개 모두 저장. 기존 한 행 재사용으로 신규 행은 96개다.
- Supabase 이력: `20261002023253_venue_preset_provenance`, `20261002023304_seed_regional_futsal_venues`. 로컬 파일 버전도 일치한다.
- 기존 세븐의 UUID·이름·주소·메모·생성자·생성일 유지. 기존 일정 15개의 ID·장소·주소 해시와 정기 일정 설정 해시가 적용 전후 일치했다.
- PGlite SQL 검사 **30개** 통과: 재적용 ID 유지, 수동 편집 보존, 이벤트 불변, 모호한 별칭 실패, 따옴표 처리, 좌표·출처 제약, anon 읽기, 회원 쓰기 차단, 운영진 직접 입력 허용.
- 운영 DB anon 역할로 97개 읽기 확인. 보안 advisor 기존 4개와 `cache_key`를 비교했으며 새 항목은 없다. 기존 알림·함수·Auth 항목은 이 작업 범위 밖이다.
- 웹 테스트 173개·린트·운영 빌드, 앱 `npm run verify` 통과.
- 검색만으로 dirty가 생기던 문제를 수정하고 저장 중 잠금과 긴 장소 텍스트 줄바꿈을 보완했다.
- in-app Browser 런타임의 `helper_sandbox_lock_failed` 오류로 실제 밝음·다크 화면과 운영자 실기기 저장은 미검증이다. 코드 검사를 화면 검증으로 간주하지 않는다. Android CI 설치·읽기 smoke 결과는 릴리즈 이후 별도로 확인한다.
- 범위·15개 보류 후보·중복·완전성 한계는 [자료 설명](../data/venue-presets/README.md)에 기록했다. 배포 최종 SHA·빌드·검증 증거는 실행 결과 보고로 남긴다.
