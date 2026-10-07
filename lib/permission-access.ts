import type { Event, GuestFee, OfficerPermission, Profile, RolePermission } from "./types";
import type { ClubhouseResource } from "./load-state";

export type VerifiedAccess = Set<string> & { isCurrent: () => boolean; profiles: readonly Profile[] };
export type AccessVerifier = () => Promise<VerifiedAccess | null>;

export const operationalPermissions = [
  "members.manage", "ratings.manage", "fees.manage", "notices.manage", "events.manage", "feedback.manage",
  "elections.manage", "polls.manage", "surveys.manage", "welcome.manage",
] as const;

export function getEffectivePermissions(profile: Profile | null, officerRows: OfficerPermission[], roleRows: RolePermission[]) {
  if (!profile || profile.status !== "active" || profile.must_change_password) return new Set<string>();
  if (profile.is_system_admin) return new Set<string>(["roles.manage", ...operationalPermissions, ...roleRows.filter((row) => row.role === "admin" && row.permission !== "officers.manage").map((row) => row.permission)]);
  if (profile.role !== "manager" || !profile.officer_title) return new Set<string>();
  return new Set(officerRows.filter((row) => row.officer_title === profile.officer_title && operationalPermissions.some((permission) => permission === row.permission)).map((row) => row.permission));
}

export function canManageMemberAccount(permissions: Set<string>, target: Pick<Profile, "role" | "is_system_admin">) {
  return permissions.has("roles.manage") || (permissions.has("members.manage") && target.role === "member" && !target.is_system_admin);
}

export function getManagementPermission(section: string, formKind?: unknown) {
  if (["events", "attendance", "teams", "guests", "venues"].includes(section)) return "events.manage";
  if (section === "forms") return formKind === "election" ? "elections.manage" : formKind === "poll" ? "polls.manage" : formKind === "survey" ? "surveys.manage" : null;
  if (section === "permissions") return "roles.manage";
  return operationalPermissions.find((permission) => permission === `${section}.manage`) ?? null;
}

export function canManageSection(permissions: Set<string>, section: string, formKind?: unknown) {
  if (section === "forms" && formKind === undefined) return ["elections.manage", "polls.manage", "surveys.manage"].some((permission) => permissions.has(permission));
  const permission = getManagementPermission(section, formKind);
  return permission !== null && permissions.has(permission);
}

export function isPermissionError(error: unknown) {
  const value = (error ?? {}) as { code?: string; message?: string };
  return value.code === "42501" || value.code === "PGRST116" || /row.level security|permission denied|access is required|not authorized/i.test(value.message ?? "");
}

export function getMemberMutationPayload(fields: Record<string, unknown>, canManageRoles: boolean, isNew: boolean) {
  if (canManageRoles) return fields;
  const ordinary = Object.fromEntries(Object.entries(fields).filter(([key]) => !["role", "officer_title", "fee_plan", "is_system_admin", "auth_user_id"].includes(key)));
  return isNew ? { ...ordinary, role: "member", officer_title: null, fee_plan: "monthly", is_system_admin: false } : ordinary;
}

export function canEditManagedRecord(permissions: Set<string>, section: string, row?: Record<string, unknown>) {
  return canManageSection(permissions, section, row?.kind)
    && (section !== "members" || !row?.is_system_admin || permissions.has("roles.manage"));
}

export function getRevokedManagementResources(previous: Set<string>, next: Set<string>): ClubhouseResource[] {
  const affected: Record<string, ClubhouseResource[]> = {
    "roles.manage": ["profiles", "memberDirectory"],
    "members.manage": ["profiles", "memberDirectory"],
    "fees.manage": ["fees", "guestFees", "memberDirectory"],
    "events.manage": ["guestPlayers"],
    "feedback.manage": ["feedback"],
    "elections.manage": ["forms"], "polls.manage": ["forms"], "surveys.manage": ["forms"],
  };
  return [...new Set([...previous].filter((permission) => !next.has(permission)).flatMap((permission) => affected[permission] ?? []))];
}

export function resolveGuestFeeNames(fees: GuestFee[], events: Event[]): GuestFee[] {
  const names = new Map(events.flatMap((event) => (event.event_guest_players ?? []).map((guest) => [`${event.id}:${guest.guest_player_id}`, guest.guest_name] as const)));
  return fees.map((fee) => {
    const name = fee.guest_players?.name ?? names.get(`${fee.event_id}:${fee.guest_player_id}`);
    return name ? { ...fee, guest_players: { name } } : fee;
  });
}
