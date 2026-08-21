export type MemberStatus = "pending" | "active" | "inactive";

export function requiresMemberApprovalConfirmation(currentStatus: MemberStatus | null | undefined, nextStatus: FormDataEntryValue | null) {
  return currentStatus === "pending" && nextStatus === "active";
}
