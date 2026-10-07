import type { Profile } from "./types";
import { isMixedZoneActor, isMixedZoneScores, MixedZoneError, parseMixedZoneRows, type MixedZoneAccess } from "./mixed-zone";
import { overallAxes } from "./member-overall";

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export function getMixedZoneScope(owner: string | null | undefined, profile: Profile | null, epoch: number, ready: boolean): string {
  return ready && isMixedZoneActor(profile, owner ?? null) ? JSON.stringify([owner, profile!.id, epoch]) : "";
}
type MixedZoneClient = {
  scope: string; version: number; getScope: () => string;
  verifyAccess: () => Promise<boolean>;
  refreshWindow: () => Promise<void>;
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
  onChanged: () => void;
};
function rpcError(error: unknown, saving: boolean): MixedZoneError {
  const code = (error as { code?: string } | null)?.code;
  if (code === "42501") return new MixedZoneError("forbidden");
  if (code === "40001") return new MixedZoneError("conflict");
  if (code === "22023") return new MixedZoneError("invalid");
  return new MixedZoneError(saving ? "unknown" : "unavailable");
}
export function createMixedZoneAccess({ scope, version, getScope, verifyAccess, refreshWindow, rpc, onChanged }: MixedZoneClient): MixedZoneAccess {
  const isCurrent = () => Boolean(scope) && scope === getScope();
  const ensure = (current: () => boolean) => { if (!isCurrent() || !current()) throw new MixedZoneError("forbidden"); };
  const dispatch = async (name: string, args: Record<string, unknown>, current: () => boolean, saving: boolean) => {
    ensure(current);
    const verified = await verifyAccess();
    ensure(current);
    if (!verified) throw new MixedZoneError("forbidden");
    let result: { data: unknown; error: unknown };
    try { result = await rpc(name, args); } catch { ensure(current); throw new MixedZoneError(saving ? "unknown" : "unavailable"); }
    ensure(current);
    if (result.error) {
      if ((result.error as { code?: string }).code === "42501") { try { await verifyAccess(); } catch { /* The authoritative denial still applies when refresh fails. */ } ensure(current); }
      throw rpcError(result.error, saving);
    }
    return result.data;
  };
  return {
    scope, version, isCurrent, refreshWindow,
    read: async (eventId, current) => {
      if (!uuid.test(eventId)) throw new MixedZoneError("invalid");
      return parseMixedZoneRows(await dispatch("get_mixed_zone_entries", { p_event_id: eventId }, current, false), eventId);
    },
    save: async (eventId, memberId, scores, revision, current) => {
      if (!uuid.test(eventId) || !uuid.test(memberId) || !isMixedZoneScores(scores) || !Number.isSafeInteger(revision) || revision < 0) throw new MixedZoneError("invalid");
      const data = await dispatch("set_mixed_zone_entry", { p_event_id: eventId, p_member_id: memberId, p_scores: scores, p_expected_revision: revision }, current, true);
      const rows = parseMixedZoneRows(Array.isArray(data) ? data : [data], eventId);
      if (rows.length !== 1 || rows[0].member_id !== memberId || rows[0].revision !== revision + 1 || overallAxes.some(({ key }) => rows[0][key] !== scores[key])) throw new MixedZoneError("unknown");
      ensure(current); onChanged(); return rows[0];
    },
  };
}
