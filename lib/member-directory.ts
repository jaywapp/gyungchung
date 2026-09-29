import type { Profile } from "@/lib/types";

/** Filter keys: the four playing positions plus one bucket for "any" and unset. */
export type PositionKey = "FW" | "MF" | "DF" | "GK" | "ANY";

export const positionKeys: PositionKey[] = ["FW", "MF", "DF", "GK", "ANY"];

export const positionLabels: Record<PositionKey, string> = {
  FW: "FW",
  MF: "MF",
  DF: "DF",
  GK: "GK",
  ANY: "무관",
};

type DirectoryProfile = Pick<Profile, "name" | "position" | "role" | "officer_title" | "is_system_admin">;

/** A member with no recorded position shares the "any" bucket and its dashed avatar. */
export function positionOf(profile: Pick<Profile, "position">): PositionKey {
  return profile.position && profile.position !== "ANY" ? profile.position : "ANY";
}

/** The chip says 미정 rather than 무관 when the member simply has no position yet. */
export function positionChipLabel(profile: Pick<Profile, "position">): string {
  return profile.position ? positionLabels[positionOf(profile)] : "미정";
}

/** Two Hangul syllables read as a name at avatar size; the family name is dropped. */
export function nameInitials(name: string): string {
  const trimmed = name.trim();
  return trimmed.length <= 2 ? trimmed : trimmed.slice(-2);
}

const officerRank: Record<string, number> = { president: 0, vice_president: 1, treasurer: 2 };

/** Officers lead in title order, then managers and system admins, then everyone by name. */
export function directoryRank(profile: DirectoryProfile): number {
  if (profile.role === "manager" && profile.officer_title) return officerRank[profile.officer_title] ?? 3;
  if (profile.role === "manager") return 3;
  if (profile.is_system_admin) return 4;
  return 5;
}

export function sortDirectory<T extends DirectoryProfile>(profiles: T[]): T[] {
  return [...profiles].sort((a, b) => directoryRank(a) - directoryRank(b) || a.name.localeCompare(b.name, "ko"));
}

export function countByPosition(profiles: Pick<Profile, "position">[]): Record<PositionKey | "ALL", number> {
  const counts = { ALL: profiles.length, FW: 0, MF: 0, DF: 0, GK: 0, ANY: 0 };
  profiles.forEach((profile) => { counts[positionOf(profile)] += 1; });
  return counts;
}
