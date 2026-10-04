"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AvatarUrlCache } from "@/lib/profile-avatar";

const AvatarUrls = createContext<Record<string, string>>({});
export const useAvatarUrl = (path?: string | null) => useContext(AvatarUrls)[path ?? ""];

export function MemberAvatarProvider({ client, cache, revision, paths, scope, isCurrent, children }: {
  client: SupabaseClient | null; cache: AvatarUrlCache; revision: number; paths: string[]; scope: string;
  isCurrent: () => boolean; children: React.ReactNode;
}) {
  const [result, setResult] = useState<{ scope: string; revision: number; urls: Record<string, string> }>({ scope: "", revision: -1, urls: {} });
  const pathKey = JSON.stringify([...new Set(paths)].sort());
  const stablePaths = useMemo<string[]>(() => JSON.parse(pathKey), [pathKey]);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (!client || !scope || revision !== cache.revision || document.visibilityState === "hidden") return;
      const urls = await cache.read(client, stablePaths, scope, isCurrent);
      if (active && revision === cache.revision && isCurrent()) setResult({ scope, revision, urls });
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [client, cache, revision, scope, stablePaths, isCurrent]);
  const urls = scope && result.scope === scope && result.revision === revision && revision === cache.revision && isCurrent() ? result.urls : {};
  return <AvatarUrls.Provider value={urls}>{children}</AvatarUrls.Provider>;
}
