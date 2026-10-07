import type { Profile } from "./types";
import type { AccessVerifier } from "./permission-access";
import { isOverallScores, MemberOverallError, parseMemberOverallRows, type OverallAccess } from "./member-overall";

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export function getMemberOverallScope(owner: string | null | undefined, profile: Profile | null, permissions: Set<string>, epoch: number, ready: boolean): string {
  if (!ready || !owner || !profile || profile.auth_user_id !== owner || profile.status !== "active" || profile.must_change_password || !permissions.has("ratings.manage")) return "";
  if (!profile.is_system_admin && (profile.role !== "manager" || !profile.officer_title)) return "";
  return JSON.stringify([owner, profile.id, epoch]);
}

type OverallClient = {
  scope: string;
  version: number;
  getScope: () => string;
  verifyAccess: AccessVerifier;
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
  onChanged: () => void;
};

function rpcError(error: unknown, saving: boolean): MemberOverallError {
  const code = (error as { code?: string } | null)?.code;
  if (code === "42501") return new MemberOverallError("forbidden");
  if (code === "40001") return new MemberOverallError("conflict");
  if (code === "22023") return new MemberOverallError("invalid");
  return new MemberOverallError(saving ? "unknown" : "unavailable");
}

/** Keep privileged data bound to the verified actor, including after an await. */
export function createMemberOverallAccess({ scope, version, getScope, verifyAccess, rpc, onChanged }: OverallClient): OverallAccess {
  const isCurrent = () => Boolean(scope) && scope === getScope();
  const ensureCurrent = (current: () => boolean) => {
    if (!isCurrent() || !current()) throw new MemberOverallError("forbidden");
  };
  const verify = async (current: () => boolean) => {
    ensureCurrent(current);
    const fresh = await verifyAccess();
    ensureCurrent(current);
    if (!fresh) throw new MemberOverallError("unavailable", "현재 권한을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    if (!fresh.isCurrent() || !fresh.has("ratings.manage")) throw new MemberOverallError("forbidden");
    return fresh;
  };
  const dispatch = async (name: string, args: Record<string, unknown>, current: () => boolean, saving: boolean) => {
    const fresh = await verify(current);
    ensureCurrent(current);
    if (!fresh.isCurrent()) throw new MemberOverallError("forbidden");
    let result: { data: unknown; error: unknown };
    try { result = await rpc(name, args); }
    catch { ensureCurrent(current); throw new MemberOverallError(saving ? "unknown" : "unavailable"); }
    ensureCurrent(current);
    if (!fresh.isCurrent()) throw new MemberOverallError("forbidden");
    if (result.error) {
      if ((result.error as { code?: string }).code === "42501") await verifyAccess();
      ensureCurrent(current);
      throw rpcError(result.error, saving);
    }
    return result.data;
  };
  return {
    scope, version, isCurrent,
    read: async (ids, current) => {
      const memberIds = [...new Set(ids)];
      if (memberIds.length > 300 || memberIds.some((id) => !uuid.test(id))) throw new MemberOverallError("invalid", "대상 회원 정보를 확인하지 못했습니다. 화면을 다시 열어 주세요.");
      ensureCurrent(current);
      if (!memberIds.length) return [];
      const data = await dispatch("get_member_overalls", { p_member_ids: memberIds }, current, false);
      ensureCurrent(current);
      return parseMemberOverallRows(data, memberIds);
    },
    save: async (id, scores, expectedRevision, current) => {
      if (!uuid.test(id) || !isOverallScores(scores) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new MemberOverallError("invalid");
      const data = await dispatch("set_member_overall", { p_member_id: id, p_scores: scores, p_expected_revision: expectedRevision }, current, true);
      ensureCurrent(current);
      const rows = parseMemberOverallRows(Array.isArray(data) ? data : [data], [id]);
      if (rows.length !== 1 || rows[0].revision !== expectedRevision + 1) throw new MemberOverallError("unknown");
      onChanged();
      return rows[0];
    },
  };
}
