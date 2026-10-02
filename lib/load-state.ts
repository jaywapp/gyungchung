export const loadResources = [
  "events", "notices", "forms", "venues",
  "memberDirectory", "profiles", "fees", "guestFees", "attendance", "feedback", "feedbackFeed", "submissions",
  "rolePermissions", "officerPermissions", "guestPlayers", "rankings", "winners", "momVotes", "momResults", "momLeaderboard",
] as const;

export type LoadResource = typeof loadResources[number];
export type LoadErrors = Partial<Record<LoadResource, boolean>>;

export const publicLoadResources = ["events", "notices", "forms", "venues"] as const;
export const memberLoadResources = ["memberDirectory", "profiles", "fees", "guestFees", "attendance", "feedback", "feedbackFeed", "submissions", "rolePermissions", "officerPermissions", "guestPlayers", "winners", "momVotes", "momResults"] as const;
export type PublicLoadResource = typeof publicLoadResources[number];
export type MemberLoadResource = typeof memberLoadResources[number];
export type ClubhouseResource = PublicLoadResource | MemberLoadResource;

type QueryResult = { error: unknown | null };

/** Preserve every failed query so an empty array is never rendered as a successful empty state. */
export function getLoadErrors(results: Partial<Record<LoadResource, QueryResult>>): LoadErrors {
  return Object.fromEntries(Object.entries(results).map(([resource, result]) => [resource, Boolean(result?.error)]));
}
