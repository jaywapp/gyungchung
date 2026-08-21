export type MomVoteMemberStatus = "active" | "inactive" | "pending" | null;
export type MomVoteCheckInStatus = "present" | "late" | "absent" | null;

type MomVoteEligibilityInput = {
  isAuthenticated: boolean;
  memberStatus: MomVoteMemberStatus;
  isPast: boolean;
  checkInStatus: MomVoteCheckInStatus;
};

export type MomVoteEligibility = {
  canVote: boolean;
  reason: string | null;
  action: "login" | null;
};

export function getMomVoteEligibility({ isAuthenticated, memberStatus, isPast, checkInStatus }: MomVoteEligibilityInput): MomVoteEligibility {
  if (!isAuthenticated) {
    return { canVote: false, reason: "MOM 투표는 로그인 후 참여할 수 있습니다.", action: "login" };
  }
  if (memberStatus !== "active") {
    return { canVote: false, reason: "MOM 투표는 활동 회원만 참여할 수 있습니다. 회원 상태가 잘못됐다면 운영진에게 문의해 주세요.", action: null };
  }
  if (!isPast) {
    return { canVote: false, reason: "MOM 투표는 일정이 시작된 후 참여할 수 있습니다.", action: null };
  }
  if (checkInStatus === "absent") {
    return { canVote: false, reason: "결석으로 기록되어 MOM 투표에 참여할 수 없습니다. 기록이 잘못됐다면 운영진에게 문의해 주세요.", action: null };
  }
  if (checkInStatus !== "present" && checkInStatus !== "late") {
    return { canVote: false, reason: "출석이 아직 기록되지 않았습니다. 운영진에게 출석 체크를 요청해 주세요.", action: null };
  }
  return { canVote: true, reason: null, action: null };
}

type MomVoteCandidateInput = {
  candidateProfileId: string;
  candidateStatus: MomVoteMemberStatus;
  voterProfileId: string | null;
  checkInStatus: MomVoteCheckInStatus;
};

export function isMomVoteCandidate({ candidateProfileId, candidateStatus, voterProfileId, checkInStatus }: MomVoteCandidateInput) {
  return candidateProfileId !== voterProfileId
    && candidateStatus === "active"
    && (checkInStatus === "present" || checkInStatus === "late");
}
