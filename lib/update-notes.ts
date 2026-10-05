/**
 * Where a change came from: "feedback" when its PR closed an issue labelled
 * 제보, "request" for everything the team asked for directly.
 */
export type UpdateSource = "feedback" | "request";

export const updateSourceLabels: Record<UpdateSource, string> = {
  feedback: "제보",
  request: "직접 요청",
};

export type UpdateNote = {
  /** Stable list key; several notes can share a date. */
  id: string;
  date: string;
  source: UpdateSource;
  title: string;
  summary: string;
  changes: { kind: "added" | "improved"; text: string }[];
  pullRequests: number[];
};

export const updateNotes: UpdateNote[] = [
  {
    id: "2026-10-05-event-potm",
    date: "2026-10-05",
    source: "request",
    title: "일정 종료 후 Player of the Match를 투표로 뽑습니다",
    summary: "POTM 투표를 일정 종료 후 기본 3일 동안 진행하며 운영진이 종료 시간과 투표 기간을 설정할 수 있습니다.",
    changes: [
      { kind: "improved", text: "출석·지각한 활동 회원이 본인을 제외한 한 명에게 투표하며 마감 전까지 선택을 변경할 수 있습니다." },
      { kind: "added", text: "투표 대기·진행·마감과 현재·최종 결과를 구분하고 동률은 공동 순위로 표시합니다." },
    ],
    pullRequests: [],
  },
  {
    id: "2026-10-05-member-birthdays",
    date: "2026-10-05",
    source: "request",
    title: "구성원 생일과 회원 연락을 더 쉽게 확인할 수 있습니다",
    summary: "내 생일을 일정 달력에 표시하고 회원 카드에서 필요한 연락처를 확인해 전화 앱을 열 수 있습니다.",
    changes: [
      { kind: "added", text: "회원 카드의 전화걸기를 누르면 선택한 회원의 연락처를 확인하고 전화 앱에서 발신을 선택할 수 있습니다." },
      { kind: "added", text: "생일이 없는 회원에게 등록 경로를 안내하며 본인이 월·일을 수정하거나 삭제할 수 있습니다." },
      { kind: "added", text: "날짜를 선택하면 생일인 구성원을 확인할 수 있습니다. 출생연도와 나이는 공개하지 않으며 2월 29일 생일은 비윤년에 2월 28일로 표시됩니다." },
    ],
    pullRequests: [],
  },
  {
    id: "2026-10-05-profile-avatar",
    date: "2026-10-05",
    source: "request",
    title: "마이페이지에서 내 프로필 사진을 설정할 수 있습니다",
    summary: "사진을 등록·변경·삭제하면 회원 목록과 기존 회원 아바타에 반영됩니다.",
    changes: [
      { kind: "added", text: "내 사진은 본인만 변경할 수 있으며 로그인한 활동 회원에게 표시됩니다. 사진이 없으면 기존 이니셜을 보여 줍니다." },
      { kind: "added", text: "JPEG·PNG·WebP 사진을 선택하면 중앙 정사각형 사진으로 준비해 저장합니다." },
    ],
    pullRequests: [],
  },
  {
    id: "2026-10-05-officer-service-permissions",
    date: "2026-10-05",
    source: "request",
    title: "모든 운영진이 팀 운영 서비스를 이용할 수 있습니다",
    summary: "회장·부회장·총무에게 팀 운영 서비스 전체를 기본 허용하고, 시스템 관리자가 직책별 접근을 설정하도록 정비했습니다.",
    changes: [
      { kind: "improved", text: "시스템 관리자는 권한 관리에서 회비·회원·일정 등 서비스별로 직책의 접근을 허용하거나 제외할 수 있습니다." },
      { kind: "improved", text: "회원 관리 권한 없이도 출석과 팀 편성을 저장할 수 있으며, 운영진 일반정보 수정과 참여 종류별 관리 권한을 바로잡았습니다." },
      { kind: "improved", text: "운영진과 시스템 관리자 계정의 발급·초기화 및 관리자 지위 변경을 시스템 관리자에게 제한했습니다." },
    ],
    pullRequests: [],
  },
  {
    id: "2026-10-05-fee-save-permissions",
    date: "2026-10-05",
    source: "request",
    title: "회비 관리 권한으로 회비를 저장할 수 있습니다",
    summary: "회원 관리 권한이 없는 운영진도 회비를 등록하고 수정할 수 있도록 저장 오류를 해결했습니다.",
    changes: [
      { kind: "improved", text: "회비 관리에서 회원별 납부 유형과 표준 금액을 올바르게 적용하고, 참여비 회원을 월회비 일괄 등록 대상에서 제외합니다." },
    ],
    pullRequests: [],
  },
  {
    id: "2026-10-03-performance-improvements",
    date: "2026-10-03",
    source: "request",
    title: "저장 후 갱신과 기록 계산을 가볍게 했습니다",
    summary: "변경된 데이터 중심으로 화면을 갱신하고, 달력과 시즌 기록을 계산할 때 반복 작업을 줄였습니다.",
    changes: [
      { kind: "improved", text: "공지·출석·회비 등을 저장한 뒤 관련 데이터만 다시 불러옵니다. 계정과 권한 변경에는 전체 데이터를 확인합니다." },
      { kind: "improved", text: "랭킹과 운영 화면의 날짜·회원·출석 계산을 재사용하고, 일정 카드의 팀 명단 보기 링크에서도 화면 상태를 이어갑니다." },
      { kind: "improved", text: "Android 업데이트 정보를 처음 확인할 때 배포 파일 검증을 병렬로 처리합니다." },
    ],
    pullRequests: [],
  },
  {
    id: "2026-10-02-iphone-install-button",
    date: "2026-10-02",
    source: "request",
    title: "Android 다운로드 아래에서 iPhone 설치 안내를 열 수 있습니다",
    summary: "웰컴 페이지의 Android 다운로드 버튼 바로 아래에 iPhone 설치 안내 버튼을 추가했습니다.",
    changes: [
      { kind: "added", text: "상단과 하단의 iPhone 설치 안내 버튼으로 홈 화면 설치 방법을 바로 확인할 수 있습니다." },
    ],
    pullRequests: [184],
  },
  {
    id: "2026-10-02-iphone-home-screen-push",
    date: "2026-10-02",
    source: "request",
    title: "iPhone 홈 화면 앱에서 알림을 받을 수 있습니다",
    summary: "Safari에서 홈 화면에 추가한 뒤 기존 계정으로 로그인하고 마이페이지에서 알림을 켜세요. iOS 16.4 이상에서 이용할 수 있습니다.",
    changes: [
      { kind: "added", text: "웰컴 페이지에 iPhone 홈 화면 설치 안내를 추가했습니다." },
      { kind: "added", text: "마이페이지에서 이 기기의 알림을 켜고 끄며, 종류별 알림과 본인 대상 테스트 알림을 선택할 수 있습니다." },
      { kind: "improved", text: "홈 화면 앱이 닫혀 있어도 업무 알림을 받을 수 있고, 알림을 누르면 관련 화면으로 이동합니다." },
    ],
    pullRequests: [182],
  },
  {
    id: "2026-10-02-venue-presets",
    date: "2026-10-02",
    source: "request",
    title: "주변 풋살장을 더 쉽게 찾을 수 있습니다",
    summary: "일정 등록·수정에서 광주시·용인시·성남시의 구장을 이름·지역·주소로 검색해 선택할 수 있습니다.",
    changes: [
      { kind: "added", text: "경기 일정의 구장 선택 목록에서 구장명·지역·주소 검색을 지원합니다." },
      { kind: "improved", text: "검색 결과가 없어도 기존처럼 구장명과 주소를 직접 입력할 수 있습니다." },
    ],
    pullRequests: [],
  },
  {
    id: "2026-10-02-welcome-page",
    date: "2026-10-02",
    source: "request",
    title: "신규 회원을 위한 웰컴 페이지를 제공합니다",
    summary: "공개 웰컴 페이지에서 운영진, 필수 앱 설치·계정 안내를 확인할 수 있으며 운영진은 초안을 저장하고 게시할 수 있습니다.",
    changes: [
      { kind: "added", text: "로그인 없이 열 수 있는 /welcome에 운영진 소개와 Android 다운로드·계정 안내를 마련했습니다." },
      { kind: "added", text: "운영진 관리에서 안내 내용을 편집·미리보기·게시하고, iOS 배포 상태와 공식 링크를 관리할 수 있습니다." },
    ],
    pullRequests: [179],
  },
  {
    id: "2026-10-02-push-feedback-copy",
    date: "2026-10-02",
    source: "request",
    title: "알림 문구와 표시 내용을 개선했습니다",
    summary: "참석 인원, 일정 주소, 의견 답변과 처리 상태를 변경 내용에 맞게 알려 드립니다.",
    changes: [
      { kind: "improved", text: "참석 변경 알림에 변경 직후 참석 인원을 표시하고, 본인의 참석 변경 알림은 받지 않습니다." },
      { kind: "improved", text: "일정 주소 변경, 의견 답변과 처리 상태 변경, 운영진의 참석 여부 재알림을 구분해 표시합니다." },
      { kind: "improved", text: "앱을 열어 둔 상태에서도 시스템 알림과 같은 제목과 본문을 보여 줍니다." },
      { kind: "improved", text: "의견 작성 화면을 유지하면서 웹·앱 접수 경로를 자동 기록해 작업 시 참고할 수 있게 했습니다." },
    ],
    pullRequests: [],
  },
  {
    id: "2026-10-02-mobile-push-production",
    date: "2026-10-02",
    source: "request",
    title: "Android 앱의 업무 알림을 시작합니다",
    summary: "앱에서 알림 수신을 켠 회원에게 참석 변경, 일정 변경, 공지와 마감 안내를 설정에 맞춰 보냅니다.",
    changes: [
      { kind: "added", text: "새로 로그인하고 알림을 켠 기기도 수신 대상에 포함되며, 운영진이 정한 참석 변경 알림 범위를 따릅니다." },
      { kind: "improved", text: "운영 시작 이전에 쌓인 변경 알림과 이미 지난 안내는 한꺼번에 보내지 않습니다." },
    ],
    pullRequests: [177],
  },
  {
    id: "2026-10-01-mobile-push-notifications",
    date: "2026-10-01",
    source: "request",
    title: "모바일 알림을 종류별로 선택할 수 있도록 준비했습니다",
    summary: "참석 변경, 일정 변경, 공지와 마감 안내를 선택해 받을 수 있는 모바일 알림 연동을 준비했습니다. 실제 발송은 아직 시작하지 않았습니다.",
    changes: [
      { kind: "added", text: "전체 알림과 종류별 알림을 선택하고, 운영진이 참석 변경 알림의 수신 범위를 정할 수 있도록 준비했습니다." },
      { kind: "added", text: "운영진이 아직 참석 여부를 정하지 않은 회원에게 다시 알리고, 기록이 없는 미래 일정을 취소할 때 안내할 수 있도록 준비했습니다." },
    ],
    pullRequests: [],
  },
  {
    id: "2026-10-01-public-apk-release-channel",
    date: "2026-10-01",
    source: "request",
    title: "GitHub 계정 없이 Android 설치 파일을 받을 수 있습니다",
    summary: "공개 APK 배포 채널을 마련하고 앱의 버전 조회가 별도 GitHub 인증 없이 동작하도록 바꿨습니다.",
    changes: [
      { kind: "improved", text: "공유받은 공개 APK 링크에서 GitHub 계정 없이 Android 설치 파일을 받을 수 있습니다." },
      { kind: "improved", text: "앱의 최신 버전 정보는 공개 배포 채널에서 확인하며, 앱 안의 설치 파일 다운로드는 로그인한 연결 회원이 사용할 수 있습니다." },
    ],
    pullRequests: [175],
  },
  {
    id: "2026-10-01-mobile-update-api",
    date: "2026-10-01",
    source: "request",
    title: "Android 앱 업데이트를 확인할 수 있습니다",
    summary: "Android 앱의 새 버전을 확인하고 로그인한 회원이 앱 안에서 설치 파일을 받을 수 있도록 업데이트 연동을 준비했습니다.",
    changes: [
      { kind: "added", text: "로그인 전에도 최신 Android 버전을 확인할 수 있으며, 연결된 회원만 설치 파일을 다운로드할 수 있습니다." },
    ],
    pullRequests: [174],
  },
  {
    id: "2026-10-01-gcfc-icon",
    date: "2026-10-01",
    source: "request",
    title: "새 GCFC 아이콘으로 바꿨습니다",
    summary: "브라우저 탭과 홈 화면에 보이는 아이콘을 두 줄 GCFC 로고로 바꿨습니다.",
    changes: [
      { kind: "improved", text: "브라우저 탭, 홈 화면에 설치한 앱, iOS 홈 화면 아이콘이 남색 바탕에 GC와 FC를 두 줄로 쌓은 로고로 바뀌었습니다. F와 공 마침표는 라임색입니다." },
    ],
    pullRequests: [173],
  },
  {
    id: "2026-09-30-app-splash",
    date: "2026-09-30",
    source: "request",
    title: "홈 화면에 설치해 앱처럼 열 수 있습니다",
    summary: "휴대전화 홈 화면에 클럽하우스를 추가하면 GCFC 아이콘으로 바로 열리고, 시작할 때 짧은 모션이 나옵니다.",
    changes: [
      { kind: "added", text: "브라우저의 '홈 화면에 추가'로 클럽하우스를 설치할 수 있습니다. 아이콘은 남색 바탕의 GCFC 로고입니다." },
      { kind: "added", text: "설치한 앱을 처음 열면 공이 GCFC 글자를 차례로 띄우고 마침표 자리에 멈춘 뒤 앱이 열립니다. 이후에는 로고만 잠깐 보이고, 화면을 누르면 바로 넘어갑니다." },
      { kind: "improved", text: "움직임 줄이기 설정을 켠 기기에서는 모션 없이 로고만 잠깐 보여 줍니다." },
    ],
    pullRequests: [172],
  },
  {
    id: "2026-09-30-visitor-hero-motion",
    date: "2026-09-30",
    source: "request",
    title: "첫 화면의 슬로건이 공을 따라 나타납니다",
    summary: "로그인하지 않은 방문자의 첫 화면에서 코트가 그려지고, 공이 굴러가며 슬로건을 완성합니다.",
    changes: [
      { kind: "improved", text: "코트 라인이 그려진 뒤 공이 날아와 굴러가며 '우리의 풋살' 글자를 하나씩 띄우고, 마침표 자리에 멈춥니다." },
      { kind: "improved", text: "움직임 줄이기 설정을 켠 기기에서는 완성된 화면을 바로 보여 주고, 화면 밖이나 다른 탭에서는 멈춥니다." },
      { kind: "improved", text: "첫 화면 오른쪽 안내를 실제 정기 경기 요일인 일요일로 바로잡았습니다." },
    ],
    pullRequests: [169],
  },
  {
    id: "2026-09-30-match-console",
    date: "2026-09-30",
    source: "request",
    title: "홈에서 바로 다음 경기에 응답할 수 있습니다",
    summary: "메뉴를 왼쪽과 아래로 옮기고, 로그인하면 홈 첫 화면에서 참석 여부부터 정할 수 있게 바꿨습니다.",
    changes: [
      { kind: "improved", text: "로그인 회원의 홈 맨 위에 다음 경기 날짜, 참석·불참 버튼, 정원 칸과 참석자를 한데 모았습니다." },
      { kind: "added", text: "홈에서 최근 공지, 내 회비, 진행 중인 투표·설문, 시즌 득점·MVP 순위를 함께 볼 수 있습니다." },
      { kind: "improved", text: "넓은 화면에서는 왼쪽 메뉴, 휴대전화에서는 아래쪽 탭과 더보기 메뉴로 이동합니다. 주 메뉴는 홈·일정·회원·공지·랭킹 다섯 개입니다." },
      { kind: "improved", text: "회원 목록을 포지션으로 거를 수 있는 작은 카드로 바꾸고, 이름 두 글자와 포지션 색으로 회원을 구분합니다." },
      { kind: "added", text: "로그인하지 않아도 더보기 메뉴와 왼쪽 메뉴에서 화면 테마를 바꿀 수 있습니다." },
    ],
    pullRequests: [168],
  },
  {
    id: "2026-09-30-readability-pass",
    date: "2026-09-30",
    source: "request",
    title: "랭킹과 제보 목록을 더 빨리 훑어볼 수 있습니다",
    summary: "글자 크기 단계를 정리하고, 목록이 길어지는 화면을 짧게 접었습니다.",
    changes: [
      { kind: "improved", text: "공동 순위는 같은 배지에 'T1'처럼 표시하고, 연간 랭킹 세 부문을 넓은 화면에서 나란히 보여줍니다." },
      { kind: "improved", text: "제보 목록은 제목만 먼저 보이고 눌러서 펼치며, 10건씩 더 불러옵니다. 넓은 화면에서는 입력 폼이 스크롤을 따라옵니다." },
      { kind: "improved", text: "빈 회비 카드와 페어플레이어 섹션을 작은 안내로 바꾸고, 마이페이지 로그아웃 버튼을 보조 버튼 모양으로 바꿨습니다." },
      { kind: "improved", text: "글자 크기를 12·14·16·20·28·48px 단계로 정리하고, 페이지 왼쪽의 세로선을 없앴습니다." },
      { kind: "improved", text: "운영 관리 화면의 하위 탭을 밑줄형으로 바꾸고, 직책과 상태를 배지로 보여줍니다. 회비 화면은 제목·필터·등록을 한 줄에 모았습니다." },
    ],
    pullRequests: [166],
  },
  {
    id: "2026-09-30-ui-feedback",
    date: "2026-09-30",
    source: "request",
    title: "회비 기준과 제보 답변을 읽기 쉽게 정리했습니다",
    summary: "운영 화면에서 받은 의견을 반영해 정보가 한눈에 들어오도록 다듬었습니다.",
    changes: [
      { kind: "improved", text: "홈의 참석 인원 현황이 카드 너비에 맞춰 표시됩니다." },
      { kind: "improved", text: "회비 화면 설명을 줄이고, 관리자·일반회원·참여 회비 기준을 배지로 보여줍니다." },
      { kind: "improved", text: "제보 목록의 답변을 'AI 답변'으로 표시하고, 답변 속 링크는 본문 아래 배지로 따로 모았습니다." },
      { kind: "added", text: "업데이트 노트에 변경의 출처를 '제보'와 '직접 요청' 배지로 표시합니다." },
    ],
    pullRequests: [165],
  },
  {
    id: "2026-09-30-light-dark-theme",
    date: "2026-09-30",
    source: "request",
    title: "밝은 화면과 어두운 화면을 고를 수 있습니다",
    summary: "새 글꼴과 색 체계로 화면을 다듬고, 기기 설정에 맞춰 어두운 화면도 제공합니다.",
    changes: [
      { kind: "added", text: "마이페이지에서 라이트·다크·시스템 화면 테마를 고를 수 있으며, 선택은 이 브라우저에 저장됩니다." },
      { kind: "improved", text: "한글 글꼴을 Pretendard로 통일하고, 한글 라벨의 글자 간격이 벌어지지 않도록 했습니다." },
      { kind: "improved", text: "마감일이 지난 투표·설문은 '마감'으로 표시하고 참여 버튼을 숨깁니다." },
      { kind: "improved", text: "회원 카드의 강퇴 버튼을 ⋯ 메뉴 안으로 옮기고, 의견 페이지 제목을 메뉴와 같은 '의견'으로 맞췄습니다." },
    ],
    pullRequests: [164],
  },
  {
    id: "2026-09-29-in-app-feedback",
    date: "2026-09-29",
    source: "request",
    title: "제보를 클럽하우스에서 확인할 수 있습니다",
    summary: "의견을 남긴 뒤 처리 상황과 운영진 답변을 한곳에서 볼 수 있습니다.",
    changes: [
      { kind: "added", text: "활동 회원이 공개 제보의 처리 상태와 운영진 답변을 클럽하우스에서 확인할 수 있습니다." },
      { kind: "improved", text: "기존 제보도 새 목록에 이어서 보여주며, 비공개 제보와 작성자 정보는 공개하지 않습니다." },
    ],
    pullRequests: [162],
  },
  {
    id: "2026-09-29-weekly-schedule-awards",
    date: "2026-09-29",
    source: "feedback",
    title: "매주 만나는 일정, 쌓이는 시즌 기록",
    summary: "정기 일정부터 출석과 연말 랭킹까지 이어지도록 바꿨습니다.",
    changes: [
      { kind: "added", text: "매주 일요일 08:00~10:00 정기 일정을 앞으로 12주까지 자동으로 준비합니다." },
      { kind: "improved", text: "일정 달력에서 이번 주 일요일을 강조하고 다가오는 날짜를 먼저 보여줍니다." },
      { kind: "added", text: "운영진이 회원별 출석·지각·결석과 일정별 우승팀 회원 최대 5명을 기록할 수 있습니다." },
      { kind: "added", text: "활동 회원은 연도별 MVP·득점왕·출석왕 상위 5명과 페어플레이어 시상 안내를 볼 수 있습니다." },
    ],
    pullRequests: [161],
  },
  {
    id: "2026-09-09-login-usability",
    date: "2026-09-09",
    source: "request",
    title: "로그인과 화면 사용성을 다듬었습니다",
    summary: "회원이 다시 방문하거나 작은 화면에서 사용할 때 겪던 불편을 줄였습니다.",
    changes: [
      { kind: "improved", text: "전화번호와 비밀번호로 로그인하는 경로를 하나로 정리하고, 같은 브라우저에서는 로그인 상태를 이어갑니다." },
      { kind: "improved", text: "홈의 참석·회비 정보가 로딩 중이거나 조회에 실패했을 때 실제 상태를 알려줍니다." },
      { kind: "improved", text: "작은 휴대전화 화면의 제목과 여백, 운영 메뉴의 키보드 조작을 개선했습니다." },
    ],
    pullRequests: [154, 152],
  },
  {
    id: "2026-08-22-events-attendance",
    date: "2026-08-22",
    source: "request",
    title: "일정과 참석 확인이 쉬워졌습니다",
    summary: "운동 날짜와 참석 상태를 중심으로 일정 화면을 다시 정리했습니다.",
    changes: [
      { kind: "improved", text: "일정 목록과 상세 화면에서 날짜·장소·참석 상태를 더 쉽게 찾을 수 있습니다." },
      { kind: "improved", text: "참석 여부를 현재 상태에 맞게 변경하고, 출석 확인 현황을 한눈에 볼 수 있습니다." },
      { kind: "improved", text: "휴대전화에서 의견 입력란과 일정 상세 글씨를 읽고 입력하기 편하게 조정했습니다." },
    ],
    pullRequests: [148, 138, 137],
  },
  {
    id: "2026-08-21-participation-records",
    date: "2026-08-21",
    source: "request",
    title: "참여 기록을 이어서 볼 수 있습니다",
    summary: "투표와 설문을 작성하고 결과를 확인하는 흐름을 보완했습니다.",
    changes: [
      { kind: "added", text: "참여 폼을 작성하다 새로고침하거나 화면을 떠나도 초안을 복원할 수 있습니다. 비밀투표 답변은 저장하지 않습니다." },
      { kind: "added", text: "마감 후 결과 공개가 허용된 투표·설문은 문항별 집계 결과를 확인할 수 있습니다." },
    ],
    pullRequests: [124, 123],
  },
];
