/**
 * Keep the pending draft independent from React so the retry and rollback
 * contract can be regression-tested without a browser runtime.
 */
export function updatePendingPermissionChanges(baseRows, pendingChanges, officerTitle, permission, enabled) {
  const existing = pendingChanges.find((change) => change.officer_title === officerTitle && change.permission === permission);
  const expectedEnabled = existing?.expected_enabled ?? baseRows.some((row) => row.officer_title === officerTitle && row.permission === permission);
  const nextChanges = pendingChanges.filter((change) => change.officer_title !== officerTitle || change.permission !== permission);

  if (enabled !== expectedEnabled) {
    nextChanges.push({ officer_title: officerTitle, permission, enabled, expected_enabled: expectedEnabled });
  }

  return nextChanges.sort((left, right) => `${left.officer_title}:${left.permission}`.localeCompare(`${right.officer_title}:${right.permission}`));
}

export async function applyPermissionBatch(supabase, changes) {
  if (changes.length === 0) throw Object.assign(new Error("Permission batch is empty"), { code: "EMPTY_PERMISSION_BATCH" });

  const { data, error } = await supabase.rpc("apply_officer_permission_batch", { permission_changes: changes });
  if (error) throw error;

  const result = Array.isArray(data) ? data[0] : data;
  if (result?.status !== "applied" || result?.applied_count !== changes.length) {
    throw Object.assign(new Error("Permission batch result was incomplete"), { code: "INCOMPLETE_PERMISSION_BATCH" });
  }

  return result;
}
