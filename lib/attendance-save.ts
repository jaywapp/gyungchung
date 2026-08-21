import type { Attendance } from "@/lib/types";

export type AttendanceCheckInStatus = Attendance["check_in_status"];

export type AttendanceSaveItem = {
  member_id: string;
  response_status: Attendance["status"];
  check_in_status: AttendanceCheckInStatus;
};

export type AttendanceSaveRpcResult = {
  result_member_id: string | null;
  succeeded: boolean;
  error_message: string | null;
};

export type AttendanceSaveFailure = {
  memberId: string;
  message: string;
};

export function buildAttendanceSaveItems(
  memberIds: string[],
  records: Attendance[],
  draftStatuses: Record<string, AttendanceCheckInStatus>,
  savedStatuses: Record<string, AttendanceCheckInStatus>,
  normalizationPendingIds: ReadonlySet<string>,
): AttendanceSaveItem[] {
  return memberIds.flatMap((memberId) => {
    const nextStatus = draftStatuses[memberId] ?? null;
    if (savedStatuses[memberId] === nextStatus && !normalizationPendingIds.has(memberId)) return [];
    const record = records.find((item) => item.member_id === memberId);
    return [{ member_id: memberId, response_status: record?.status ?? "undecided", check_in_status: nextStatus }];
  });
}

export function reconcileAttendanceSaveResults(
  requestedItems: AttendanceSaveItem[],
  rpcResults: AttendanceSaveRpcResult[],
) {
  const resultsByMember = new Map(rpcResults.filter((result) => result.result_member_id).map((result) => [result.result_member_id as string, result]));
  const succeededIds: string[] = [];
  const failures: AttendanceSaveFailure[] = [];

  requestedItems.forEach((item) => {
    const result = resultsByMember.get(item.member_id);
    if (result?.succeeded) succeededIds.push(item.member_id);
    else failures.push({ memberId: item.member_id, message: result?.error_message ?? "저장 결과를 확인하지 못했습니다." });
  });

  return { succeededIds, failures };
}

export function applyAttendanceSaveSuccesses(
  savedStatuses: Record<string, AttendanceCheckInStatus>,
  requestedItems: AttendanceSaveItem[],
  succeededIds: string[],
) {
  const next = { ...savedStatuses };
  const succeeded = new Set(succeededIds);
  requestedItems.forEach((item) => {
    if (succeeded.has(item.member_id)) next[item.member_id] = item.check_in_status;
  });
  return next;
}
