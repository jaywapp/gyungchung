# 경충FC 웰컴 페이지 실행 계획

기획 문서와 시안 요청서를 먼저 준비하고, 시안 비교·선택을 거쳐 데이터와 화면을 구현한다. 이 표는 후속 작업의 순서를 정의하며, 사용자에게서 받은 현재 요청은 문서 작성까지다.

- 작성일: 2026-10-02
- orchestrator: Codex
- 현재 브랜치: codex/welcome-page-planning-20261002
- 기준: [요구사항](welcome-page-analysis.md), [설계안](welcome-page-design.md), [시안 요청서](welcome-page-design-request.md)
- status: verified는 명시한 검증까지 완료, planned는 미착수, blocked는 기록한 선행 조건 미충족, in_progress는 진행 중을 뜻한다.
- model과 effort는 실행 시 사용할 Codex 제안값이며 사용량·일정 확약이 아니다.

## 작업 순서

| ID | 작업과 산출물 | owner | model | effort | depends_on | parallel_group | verification | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| W00 | 세 저장소 조사, 요구사항·설계·작업·시안 요청 문서 | Codex | gpt-6.1-sol | high | 없음 | planning | 사실·상대 링크·상호 일치·변경 범위 검토 | verified |
| W01 | 동일 콘텐츠의 공개 시안 3종, 관리 공통안, 비교 문서 | Codex | gpt-6.1-sol | high | W00, 시안 제작 요청 | concepts | 모바일·PC·상태·접근성, 브랜드 일치 | planned |
| W02 | 사용자 선택·피드백과 미정 콘텐츠·권한 기록 | Codex | gpt-6.1-sol | medium | W01, 사용자 선택 | decision | 분석·설계·작업 문서에 같은 결정 반영 | blocked |
| W03 | 초안·게시본·권한·트랜잭션·검사 설계와 구현 | Codex | gpt-6.1-sol | high | W02 | backend | 직접 API/RLS 허용·거절, 원자성·동시 수정 | planned |
| W04 | 공개 앱 정보의 동일 릴리스 다운로드 주소 연결 | Codex | gpt-6.1-sol | high | W02 | release_contract | 버전·URL 일치, 구버전 앱 호환, 실패 처리 | planned |
| W05 | /welcome 공개 페이지 | Codex | gpt-6.1-sol | high | W03, W04 | ui | 비로그인 열람, 회칙·앱 링크, 반응형 | planned |
| W06 | 기존 관리 메뉴와 편집·미리보기·게시 화면 | Codex | gpt-6.1-sol | high | W03 | ui | 저장·게시 분리, 충돌·권한 상실·이탈 | planned |
| W07 | 실제 회칙·소개·확인된 링크 입력 준비 | Codex | gpt-6.1-sol | medium | W02, 운영진 자료 | content | 예시 자료 제거, 공개 항목 확인 | planned |
| W08 | 통합 QA와 제품 변경 안내 | Codex | gpt-6.1-sol | high | W05, W06, W07 | integration | 권한·게시·모바일·테마·기존 앱 회귀, lint·타입·빌드 | planned |
| W09 | 승인 범위 내 변경 반영과 운영 확인 | Codex | gpt-6.1-sol | high | W08, 반영 범위 확인 | delivery | DB 적용 순서, 배포 상태, 실제 /welcome 및 다운로드 응답 | planned |

W02의 차단 조건은 아직 제시·선택하지 않은 시안이다. 기획 문서가 승인되었다고 디자인 선택이나 운영 콘텐츠가 확정된 것으로 처리하지 않는다.

## 병렬 작업과 공유 경계

W00에서 리더는 요구사항·설계·작업 문서, 별도 Codex 담당은 시안 요청서 한 파일을 작성한다. 문서 간 계약은 리더가 통합 검토한다.

W03과 W04는 대상 파일과 데이터 계약을 확정한 뒤 별도 Codex 담당이 병렬 진행할 수 있다. W05와 W06도 합의된 컴포넌트·데이터 인터페이스를 기준으로 병렬 진행한다. 공통 타입·전역 CSS·권한 정의·마이그레이션과 Git 상태 변경은 한 담당자가 순차 반영해 충돌을 피한다.

콘텐츠 자료 정리는 화면 구현과 병렬로 가능하다. 실제 공개 게시·DB 반영·배포는 통합 검증 이후 순차 진행한다. 각 후속 작업은 당시의 사용자 요청 범위와 저장소 지침을 적용한다.

## 검증 기록

| 구분 | 확인 내용 | 결과 |
| --- | --- | --- |
| 저장소 구조 | 웹·모바일·공개 배포 저장소 책임과 서버 관리 원본 | 확인 |
| Android 배포 | build.10, 0.1.0 / 200010, 85,611,780 bytes, CI 실행 10 성공 | 조사 시점 확인 |
| 익명 접근 | 최신 update.json GET 200, APK HEAD 200 | 확인, APK 설치 검증은 미실시 |
| 문서 검토 | 문서 4개·내부 링크 22개·인코딩·공백·인덱스, 독립 교차 검토와 보완 2건 | 통과 |
| 저장소 검사 | npm ci로 잠금 파일 일치, npm run build의 컴파일·lint·타입 검사·21개 정적 경로 생성 | 통과 |
| 시안·제품 | 시안 생성, 제품 UI·DB·API 변경, 운영 배포 | 이 문서 작성 단계에서 미실시 |

문서 검증 완료 후 W00와 해당 검증 기록만 갱신한다. 미래 작업의 완료 상태를 미리 표시하지 않는다.
