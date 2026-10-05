# 일정별 Player of the Match 작업
작성일: 2026-10-05
사용자 지시에 따라 모든 검사·빌드·리뷰 실행·commit·배포는 일괄 단계로 보류한다.

| id | 작업 | owner | model | effort | depends_on | parallel_group | 상태 |
|---|---|---|---|---|---|---|---|
| POTM-PLAN | 기존 계약 조사·종료기준·공유계약 | root | gpt-6-astra | high | - | planning | 공유 계약 기록 |
| POTM-DB | 신규 CLI migration·guard·결과/누적·SQL 검증 코드 | birthday_db_audit | gpt-6-astra | high | POTM-PLAN | implementation | 소스 준비, 검증 보류 |
| POTM-WEB | 이벤트 편집·기간·투표/결과·검증 코드·업데이트 노트 | birthday_web | gpt-6.1-sol | high | POTM-PLAN | implementation | 소스·검증 코드 준비, 일괄 검증 대기 |
| POTM-MOBILE | 이벤트 편집·기간·투표/결과·검증 코드·0.1.5 노트 | birthday_mobile | gpt-6.1-sol | high | POTM-PLAN | implementation | 소스·검증 코드 준비, 일괄 검증 대기 |
| POTM-BATCH | 시작/종료/마감 경계·동률·취소 우회·현재 콜백·DB·전체빌드 | root | gpt-6-astra | high | POTM-DB,POTM-WEB,POTM-MOBILE,사용자 일괄 지시 | validation | 보류 |
| POTM-REVIEW | 실제 화면 및 권한·경계 독립 리뷰 | reviewer | gpt-6-astra | high | POTM-BATCH | review | 보류 |

파일 소유: DB 담당은 web supabase/migrations·supabase/tests·scripts에만 편집. 웹 담당은 web lib·components·app만 편집. 모바일 담당은 mobile src·tests·release만 편집. root는 docs와 교차 통합을 담당한다. 동일 파일을 병렬로 수정하지 않는다.

검증 코드 수용 기준: 종료 직전/정각, 72시간 직전/정각, 변경·DELETE·이벤트 이동 우회, 설정 권한 회수, 초기비번·숨김·비활동, 후보 출석·selfvote, 동률/무표/지난 일정, 반복 종료 이동, 열린 화면 중 마감, 익명/구형 데이터, 생일·전화 회귀와 18개 초기 요청. 작성한 검증 코드는 지금 실행하지 않는다.