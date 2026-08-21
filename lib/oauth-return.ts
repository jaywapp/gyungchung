const returnPaths = new Set([
  "/",
  "/admin",
  "/events",
  "/feedback",
  "/fees",
  "/members",
  "/notices",
  "/participation",
  "/rankings",
]);

export type OAuthResult = "error" | "linked" | "login";

function isAllowedReturnPath(pathname: string) {
  return returnPaths.has(pathname) || /^\/events\/\d{8}$/.test(pathname);
}

/**
 * Keep a member on an allowed Clubhouse route and preserve its useful URL
 * context. `auth` is deliberately replaced so a stale result never survives
 * a later sign-in attempt.
 */
export function buildOAuthReturnPath(pathname: string, search: string, hash: string, result: OAuthResult) {
  const safePathname = isAllowedReturnPath(pathname) ? pathname : "/";
  const searchParams = new URLSearchParams(search);
  searchParams.set("auth", result);
  const query = searchParams.toString();
  return `${safePathname}${query ? `?${query}` : ""}${hash}`;
}

/** Reject absolute, protocol-relative, and unrecognised internal callback destinations. */
export function getSafeOAuthReturnUrl(next: string | null, origin: string) {
  const fallback = new URL("/", origin);
  if (!next?.startsWith("/") || next.startsWith("//")) return fallback;

  const target = new URL(next, origin);
  if (target.origin !== origin || !isAllowedReturnPath(target.pathname)) return fallback;
  return target;
}
