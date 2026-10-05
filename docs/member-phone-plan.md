# 회원 전화걸기 계획
작성일: 2026-10-05
사용자 추가 요청: 회원 메뉴에서 전화걸기를 제공한다. 기존 생일 작업과 함께 로컬 구현/검증만 수행하고 배포하지 않는다.

## 데이터와 권한
- public.get_member_phone(p_member_id uuid) RETURNS text는 invoker wrapper로 guarded private definer lookup을 호출한다. 함수는 stable/search_path=''이며 모든 기본EXECUTE를 회수하고 authenticated에만 허용한다.
- auth.uid()로 연결된 활동 회원, 초기 비밀번호 변경 완료, 비숨김 계정만 전화 조회 가능하다. 대상은 활동·비숨김 회원이며 전화번호가 없으면 NULL이다. target 인증 연결/초기비밀번호 여부는 연락처 존재와 별개다.
- profiles 전화번호와 기존 RLS·회원관리 권한을 변경하지 않는다. 전체 전화번호를 directory에 추가하지 않으며 회원의 전화 버튼을 눌렀을 때 선택한 회원 번호만 조회한다.
- 초기 18개 DB 요청을 유지한다. 전화번호 조회는 read-only이며 실제 회원에게 전화하지 않는다.

## 화면과 안전한 호출
- 기존 웹/모바일 회원 메뉴에 기존 아이콘·버튼 체계를 따른 전화걸기 액션을 제공한다.
- 전화번호를 +/숫자와 허용된 구분자에서 안전하게 정규화하고 tel: URL을 만든다. 빈값/유효하지 않은 번호·조회 실패·앱 열기 실패는 복구 가능한 안내를 표시한다.
- 요청 중 계정/권한/자격/인증 연결이 변경되면 늦은 응답으로 전화 앱을 열거나 번호/알림을 표시하지 않는다.
- 자동 전화 발신 없이 사용자의 버튼으로 전화 앱/다이얼러를 연다. OS의 전화 앱에서 발신을 결정한다.
- 운영 서비스·DB·push·PR·APK 발행을 보류한다. 합성 번호와 mocked opener만으로 검증한다.
- 앱 0.1.5는 아직 미발행이므로 생일과 전화걸기 노트를 함께 포함한다.

## 병렬 작업
| id | 산출물 | owner/model | effort | depends_on | parallel_group |
|---|---|---|---|---|---|
| PHONE-DB | 신규 CLI migration, SQL verifier/pgTAP | birthday_db_audit / gpt-6-astra | high | 계약 | implementation |
| PHONE-WEB | 회원 액션/owner guard/normalize/tests/update notes | birthday_web / gpt-6.1-sol | high | 계약 | implementation |
| PHONE-MOBILE | 회원 액션/Linking/guard/tests/notes, 생일 리뷰2개 수정 | birthday_mobile / gpt-6.1-sol | high | 계약 | implementation |
| VERIFY | 합성 실제 버튼→RPC→mock dialer, 오류/계정변경, 전체검사 | root | high | DB,WEB,MOBILE | verification |
| REVIEW | 생일 material2 verdict 및 전화 새 컨텍스트 검토 | reviewers / gpt-6-astra | high | VERIFY | review |
| LOCAL | 결과 문서·로컬 commit, 배포 보류 | root | high | REVIEW | finish |

## 생일 리뷰 수정
1. 네이티브 응답 유실은 결과 확인 불가와 생일 재조회로 안내, 확정 서버 거절과 구분. 실제 서버 반영 후 응답 유실 callback 테스트.
2. 네이티브 캘린더 생일 loading/error/unknown 안내와 회원 정보 재조회 액션, 확인된 미등록에만 등록 유도. 실제 Events 렌더/재조회 callback 테스트.
