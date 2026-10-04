import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "./types";

export const AVATAR_BUCKET = "profile-avatars";
export const AVATAR_MAX_BYTES = 1024 * 1024;
const AVATAR_INPUT_BYTES = 10 * AVATAR_MAX_BYTES;
const avatarPathPattern = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/i;

export function getAvatarAccessScope(owner: string | null, profile: Profile | null, permissions: Iterable<string>): string {
  return owner && profile?.auth_user_id === owner && profile.status === "active" && !profile.must_change_password
    ? JSON.stringify([owner, profile.id, [...permissions].sort()]) : "";
}

export function validateAvatarInput(file: Blob) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new AvatarRequestError("image", "JPEG, PNG, WebP 사진을 선택해 주세요.");
  if (!file.size || file.size > AVATAR_INPUT_BYTES) throw new AvatarRequestError("image", "10MB 이하의 사진을 선택해 주세요.");
}

export async function compressProfileAvatar(file: Blob): Promise<Blob> {
  validateAvatarInput(file);
  let source: ImageBitmap;
  try { source = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch { throw new AvatarRequestError("image", "사진을 읽지 못했습니다. 다른 사진을 선택해 주세요."); }
  try {
    const side = Math.min(source.width, source.height);
    if (!side) throw new AvatarRequestError("image", "사진을 읽지 못했습니다. 다른 사진을 선택해 주세요.");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = Math.min(side, 512);
    const context = canvas.getContext("2d");
    if (!context) throw new AvatarRequestError("image", "사진을 준비하지 못했습니다. 브라우저를 새로 열고 다시 시도해 주세요.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, (source.width - side) / 2, (source.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.88, 0.72, 0.5]) {
      const encoded = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (encoded?.size && encoded.size <= AVATAR_MAX_BYTES && encoded.type === "image/jpeg") return encoded;
    }
    throw new AvatarRequestError("image", "사진 용량을 줄이지 못했습니다. 다른 사진을 선택해 주세요.");
  } finally { source.close(); }
}

export class AvatarRequestError extends Error {
  constructor(public code: string, message: string, public cleanupFailed = false) { super(message); }
}

export async function saveProfileAvatar(client: SupabaseClient, options: {
  owner: string; expectedPath: string | null; file: Blob | null; isCurrent: () => boolean;
  compress?: typeof compressProfileAvatar;
}) {
  const { owner, expectedPath, file, isCurrent } = options;
  const checkOwner = () => { if (!isCurrent()) throw new AvatarRequestError("stale", "계정 상태가 변경되었습니다. 다시 로그인해 주세요."); };
  const storage = client.storage.from(AVATAR_BUCKET);
  let uploadedPath: string | null = null;
  let committed = false;
  let cleanupAllowed = true;
  try {
    checkOwner();
    let nextPath: string | null = null;
    if (file) {
      const jpeg = await (options.compress ?? compressProfileAvatar)(file);
      checkOwner();
      if (jpeg.type !== "image/jpeg" || !jpeg.size || jpeg.size > AVATAR_MAX_BYTES) throw new AvatarRequestError("image", "사진을 준비하지 못했습니다. 다른 사진을 선택해 주세요.");
      nextPath = `${owner}/${crypto.randomUUID()}.jpg`;
      const { error } = await storage.upload(nextPath, jpeg, { contentType: "image/jpeg", upsert: false });
      if (error) throw new AvatarRequestError("upload", "사진을 올리지 못했습니다. 연결을 확인하고 다시 시도해 주세요.");
      uploadedPath = nextPath;
      checkOwner();
    }
    checkOwner();
    let result: { data: unknown; error: { code?: string } | null };
    try { result = await client.rpc("set_profile_avatar", { next_avatar_path: nextPath, expected_avatar_path: expectedPath }); }
    catch { result = { data: null, error: {} }; }
    if (result.error) {
      checkOwner();
      if (!result.error.code || !/^[0-9A-Z]{5}$/.test(result.error.code)) {
        // A lost response can follow a committed write. Do not delete its image.
        cleanupAllowed = false;
        try {
          const current = await client.from("profiles").select("avatar_path").eq("auth_user_id", owner).maybeSingle();
          checkOwner();
          if (!current.error && current.data) {
            cleanupAllowed = true;
            if (current.data.avatar_path === nextPath) result = { data: nextPath, error: null };
          }
        } catch { checkOwner(); }
      }
      if (result.error) throw new AvatarRequestError(result.error.code ?? "unknown", result.error.code === "40001"
        ? "다른 곳에서 사진이 변경되었습니다. 최신 사진을 확인하고 다시 시도해 주세요."
        : cleanupAllowed ? "사진을 저장하지 못했습니다. 연결과 계정 상태를 확인하고 다시 시도해 주세요."
          : "사진 저장 상태를 확인하지 못했습니다. 연결을 확인한 뒤 새로고침해 주세요.");
    }
    // A successful RPC owns the new object even if the client identity changed meanwhile.
    committed = true;
    checkOwner();
    if (result.data !== nextPath) throw new AvatarRequestError("save", "사진 저장 결과를 확인하지 못했습니다. 새로고침해 주세요.");
    let cleanupFailed = false;
    if (expectedPath && expectedPath !== nextPath && expectedPath.startsWith(`${owner}/`) && avatarPathPattern.test(expectedPath)) {
      try { const result = await storage.remove([expectedPath]); cleanupFailed = Boolean(result.error); }
      catch { cleanupFailed = true; }
      checkOwner();
    }
    return { path: nextPath, cleanupFailed };
  } catch (cause) {
    const error = cause instanceof AvatarRequestError ? cause : new AvatarRequestError("save", "사진을 처리하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.");
    // Never send a previous owner's cleanup request using a new session.
    if (uploadedPath && !committed && cleanupAllowed && isCurrent()) {
      try { const result = await storage.remove([uploadedPath]); error.cleanupFailed = Boolean(result.error); }
      catch { error.cleanupFailed = true; }
    }
    throw error;
  }
}

/** Private URLs live only in memory and expire before their 300-second signature. */
export class AvatarUrlCache {
  private scope = "";
  private epoch = 0;
  private entries = new Map<string, { url: string; expires: number }>();
  private pending = new Map<string, Promise<void>>();
  constructor(private now = () => Date.now()) {}
  get revision() { return this.epoch; }
  clear() { this.scope = ""; this.epoch += 1; this.entries.clear(); this.pending.clear(); }
  setScope(scope: string) { if (scope !== this.scope) { this.clear(); this.scope = scope; } }
  async read(client: SupabaseClient, paths: readonly string[], scope: string, isCurrent: () => boolean): Promise<Record<string, string>> {
    if (!scope || !isCurrent()) return {};
    this.setScope(scope);
    const epoch = this.epoch;
    const unique = [...new Set(paths.filter((path) => avatarPathPattern.test(path)))].sort();
    const missing = unique.filter((path) => (this.entries.get(path)?.expires ?? 0) <= this.now());
    if (missing.length) {
      const key = JSON.stringify(missing);
      let pending = this.pending.get(key);
      if (!pending) {
        const started = this.now();
        pending = (async () => {
          try {
            const { data, error } = await client.storage.from(AVATAR_BUCKET).createSignedUrls(missing, 300);
            if (error || epoch !== this.epoch || !isCurrent()) return;
            for (const item of data ?? []) if (item.path && item.signedUrl && !item.error && missing.includes(item.path)) {
              this.entries.set(item.path, { url: item.signedUrl, expires: started + 240_000 });
            }
          } catch { /* Image reads fall back to initials. */ }
        })();
        this.pending.set(key, pending);
        void pending.finally(() => { if (this.pending.get(key) === pending) this.pending.delete(key); });
      }
      await pending;
    }
    if (epoch !== this.epoch || !isCurrent()) return {};
    return Object.fromEntries(unique.flatMap((path) => {
      const item = this.entries.get(path);
      return item && item.expires > this.now() ? [[path, item.url]] : [];
    }));
  }
}
