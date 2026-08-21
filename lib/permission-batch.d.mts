import type { OfficerPermission, OfficerTitle } from "@/lib/types";

export interface PendingPermissionChange {
  officer_title: OfficerTitle;
  permission: string;
  enabled: boolean;
  expected_enabled: boolean;
}

export interface PermissionBatchResult {
  status: "applied";
  applied_count: number;
}

interface PermissionBatchClient {
  rpc(name: "apply_officer_permission_batch", args: { permission_changes: PendingPermissionChange[] }): PromiseLike<{
    data: PermissionBatchResult | PermissionBatchResult[] | null;
    error: unknown;
  }>;
}

export function updatePendingPermissionChanges(
  baseRows: OfficerPermission[],
  pendingChanges: PendingPermissionChange[],
  officerTitle: OfficerTitle,
  permission: string,
  enabled: boolean,
): PendingPermissionChange[];

export function applyPermissionBatch(
  supabase: PermissionBatchClient,
  changes: PendingPermissionChange[],
): Promise<PermissionBatchResult>;
