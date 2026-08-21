import type { User } from "@supabase/supabase-js";
import type { Profile } from "@/lib/types";

export function getAccountState(user: User | null, profile: Profile | null) {
  if (!user) return "signed-out";
  return profile ? "member" : "unlinked";
}
