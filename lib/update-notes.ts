export type UpdateNote = {
  date: string;
  title: string;
  summary: string;
  changes: { kind: "added" | "improved"; text: string }[];
  pullRequests: number[];
};

export const updateNotes: UpdateNote[] = [
  {
    date: "2026-09-29",
    title: "제보를 클럽하우스에서 확인할 수 있습니다",
    summary: "의견을 남긴 뒤 처리 상황과 운영진 답변을 한곳에서 볼 수 있습니다.",
    changes: [
      { kind: "added", text: "활동 회원이 공개 제보의 처리 상태와 운영진 답변을 클럽하우스에서 확인할 수 있습니다." },
      { kind: "improved", text: "기존 제보도 새 목록에 이어서 보여주며, 비공개 제보와 작성자 정보는 공개하지 않습니다." },
    ],
    pullRequests: [162],
  },
  {
    date: "2026-09-29",
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
    date: "2026-09-09",
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
    date: "2026-08-22",
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
    date: "2026-08-21",
    title: "참여 기록을 이어서 볼 수 있습니다",
    summary: "투표와 설문을 작성하고 결과를 확인하는 흐름을 보완했습니다.",
    changes: [
      { kind: "added", text: "참여 폼을 작성하다 새로고침하거나 화면을 떠나도 초안을 복원할 수 있습니다. 비밀투표 답변은 저장하지 않습니다." },
      { kind: "added", text: "마감 후 결과 공개가 허용된 투표·설문은 문항별 집계 결과를 확인할 수 있습니다." },
    ],
    pullRequests: [124, 123],
  },
];
