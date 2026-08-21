export const loadResources = [
  "events", "notices", "forms", "venues",
  "memberDirectory", "profiles", "fees", "guestFees", "attendance", "feedback", "submissions",
  "rolePermissions", "officerPermissions", "guestPlayers", "rankings", "momVotes", "momResults", "momLeaderboard",
] as const;

export type LoadResource = typeof loadResources[number];
export type LoadErrors = Partial<Record<LoadResource, boolean>>;

type QueryResult = { error: unknown | null };

/** Preserve every failed query so an empty array is never rendered as a successful empty state. */
export function getLoadErrors(results: Partial<Record<LoadResource, QueryResult>>): LoadErrors {
  return Object.fromEntries(Object.entries(results).map(([resource, result]) => [resource, Boolean(result?.error)]));
}
