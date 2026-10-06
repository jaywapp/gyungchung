# 회원 카드 동작 메뉴 설계
작성일: 2026-10-06 · mode: Operate · 기존 Match Console 유지

카드의 내용과 작은 더보기 표시를 하나의 접근성 있는 선택 대상으로 만든다. 중첩 버튼을 피하고 터치/키보드 포커스를 지원한다. 선택한 회원의 최신 정보를 메뉴에 표시하고 전화걸기·연락처 저장을 제공한다. 웹의 상세 정보와 운영진의 수정·강퇴는 같은 진입점에서 보존한다. 모바일은 기존 Sheet와 안전 영역/뒤로가기 동작을 재사용한다.

연락처는 메뉴 진입 시 자동 조회하지 않고 해당 동작 선택 후 RPC를 호출한다. 비활동·숨김·초기 비밀번호·계정 generation 검증은 기존 phone 계약을 유지한다. 메뉴/계정 generation과 현재 대상 상태를 검증해 stale 결과를 폐기하며 닫으면 준비된 연락처를 제거한다. 웹은 비동기 조회 후 명시적 사용자 클릭에서 전화 앱을 열거나 vCard를 내려받는다.

웹 연락처 저장: UTF-8 vCard 3.0에 회원 이름과 검증된 전화번호만 기록한다. CRLF·구분자·파일명 제어문자를 처리해 주입을 방지한다. Blob URL과 일회성 링크는 정리한다. 주소록 최종 저장은 사용자의 가져오기 동작으로 진행한다.

모바일: Expo57에 맞는 expo-contacts 57.0.6을 정확히 고정하고 Contact.presentCreateForm을 사용하는 어댑터로 OS 연락처 작성 화면을 연다. 이전 API presentFormAsync는 SDK57에서 runtime throw가 있어 사용하지 않는다. 명시적인 저장·취소 결과와 결과 미확정을 구분하며 주소록 읽기나 무조건 저장 성공 알림은 하지 않는다. 설치된 패키지의 Android/iOS 소스를 확인해 양 플랫폼의 form 계약과 권한 요구를 기록한다. 필요하지 않은 주소록 READ/WRITE 권한은 선언/요청하지 않도록 구성한다.

공식 근거: https://docs.expo.dev/versions/latest/sdk/contacts/ · https://developer.android.com/identity/providers/contacts-provider/modify-data

검증은 이번에는 소스·diff의 정적 검토에 한정한다. UI 렌더·접근성·전화 앱·주소록 폼/취소·vCard 가져오기·계정 ABA 테스트를 준비하고 실행은 다음 일괄 검증으로 남긴다. APK/iOS 빌드와 운영 배포는 하지 않는다.

## 설치 패키지 소스 대조
SDK57과 일치하는 expo-contacts57.0.6의 Android presentCreateForm은 ACTION_INSERT/RESULT_OK bool을 사용하고 권한 확인 없이 연락처 앱에 위임한다. iOS presentAddForm은 CNContactViewController를 제시하지만 FormDelegate의 onViewDisappeared는 resolve() 값을 전달하지 않는다. 문서의 Promise<boolean>만 믿고 iOS 저장/취소를 확정하지 않으며 반환값이 불명확하면 중립 안내한다. 설치된 Contacts package는 Expo의 legacy auto-plugin 경로로 적용되므로 plugin을 명시하고 iOS 저장 목적 안내 문구를 유지한다. Android READ_CONTACTS/WRITE_CONTACTS는 blockedPermissions로 제외한다. iOS 실행·권한/생명주기·실제 주소록 결과는 다음 일괄 검증에서 확인한다.

## 관리 권한 및 업데이트 안내 연동
연락처 사용 자격과 기존 members.manage 관리 자격을 분리한다. 활동 상태의 숨김 QA 관리자 등 기존 관리 계정은 기존 수정/강퇴 메뉴를 유지하며 전화/저장은 기존 strict actor를 만족해야 한다. 메뉴/관리의 actor generation은 별도로 고정해 effect 전 변경과 ABA도 무효화한다.

모바일 AppShell에 memberActionsOpen을 연결하여 카드 메뉴·회원 편집·전화/OS 연락처 동작이 진행 중이면 새 버전 popup을 보류한다. 새 버전 상태는 그대로 대기시키고 메뉴와 작업이 끝나면 다시 노출한다. 평상시 회원 목록에서는 기존 새 버전 안내를 유지한다. 관련 회귀 소스만 준비하며 실행은 보류한다.

## 웹 우선 검증·배포
후속 사용자 지시에 따라 현재 웹 기능은 전체 검사·생산 빌드·합성 브라우저 확인 후 PR을 통해 먼저 배포한다. 모바일 소스의 준비 상태와 네이티브 확인 보류는 유지하며, 앱 동기화는 사용자 요청 이후 별도 진행한다.
