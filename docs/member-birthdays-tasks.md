# 구성원 생일 작업/검증
작성일: 2026-10-05

## 작업과 검증
| id | 목표/산출물 | owner/model | effort | depends_on | parallel_group |
|---|---|---|---|---|---|
| DB | migration, SQL fixture, isolated verifier | birthday_db_audit / gpt-6-astra | high | 계약 | implementation |
| WEB | 프로필 병합/저장, 달력 표시/등록 안내, 테스트, update notes | birthday_web / gpt-6.1-sol | high | 계약 | implementation |
| MOBILE | provider/계정/달력, 실제 저장 콜백 테스트, 0.1.5 update notes | birthday_mobile / gpt-6.1-sol | high | 계약 | implementation |
| VERIFY | 통합 확인/화면 확인/기존 권한 회귀 | root | high | DB,WEB,MOBILE | verification |
| REVIEW | 새 컨텍스트의 구현/화면 최종 검토 | fresh reviewer / gpt-6-astra | high | VERIFY | review |
| LOCAL | 리뷰 후 로컬 커밋과 결과 보고 | root | high | REVIEW | finish |

필수 검증: 날짜 유효성/윤년/월·연 경계/같은 날짜 여러 회원/일정 없는 생일, 미등록 대 조회실패 구별, 비활동·초기비번·숨김·비로그인 차단, 본인 수정과 CAS 충돌/삭제 ABA, 계정 전환 후 결과 폐기, 기존 회원/회비/사진/18개 초기 요청 유지. 전체 테스트·타입·lint·빌드/export와 기존 스타일 데스크톱/모바일 화면 확인.

사용자 제약(2026-10-05): 배포 보류. 운영 DB 적용·push·PR 병합·APK 발행 없이 로컬 구현과 검증까지만 수행한다.

## 2026-10-05 일괄 배포 게이트 갱신
사용자의 “배포해” 지시로 이전 검사·배포 보류가 해제됐다. 최신 모바일 테스트 563개, 웹 테스트 315개(기존 skip 1개), 타입·lint·빌드/export 및 합성 웹 브라우저 49개 검사가 통과했다. 생일 최초 두 P2와 웹 POTM 마감 집계 P2는 수정·회귀 확인 후 독립 최종 리뷰에서 resolved, disposition ship으로 판정했다. 최신 판정은 docs/batch-release-review.md를 따른다. DB 세 변경은 검증 원본과 같은 SHA로 운영에 적용하고 읽기 전용 smoke를 통과했다. PR 병합 및 서명 APK/운영 웹 결과는 별도 최종 배포 기록으로 확인한다.