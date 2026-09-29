export type ResponseLink = { url: string; label: string };

const URL_PATTERN = /https?:\/\/[^\s<>()[\]]+[^\s<>()[\].,;:!?'"’”)]/g;
const MARKDOWN_LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

/** GitHub issue/PR URLs read as "GitHub Issue #12"; anything else shows its host and path. */
export function labelResponseLink(url: string): string {
  try {
    const { hostname, pathname } = new URL(url);
    const github = hostname === "github.com" ? pathname.match(/^\/[^/]+\/[^/]+\/(issues|pull)\/(\d+)/) : null;
    if (github) return `GitHub ${github[1] === "pull" ? "PR" : "Issue"} #${github[2]}`;
    const path = pathname === "/" ? "" : pathname.replace(/\/$/, "");
    const label = hostname.replace(/^www\./, "") + path;
    return label.length > 40 ? `${label.slice(0, 39)}…` : label;
  } catch {
    return url;
  }
}

/**
 * Splits a stored answer into readable prose and the links it cites. The
 * stored text is never changed; this only decides how it renders. Markdown
 * links keep their words in the prose, bare URLs leave the prose entirely,
 * along with a label or bracket left dangling around them.
 */
export function splitResponseLinks(text: string): { body: string; links: ResponseLink[] } {
  const urls: string[] = [];
  const keep = (url: string) => { if (!urls.includes(url)) urls.push(url); };
  const withoutMarkdown = text.replace(MARKDOWN_LINK, (_match, words: string, url: string) => { keep(url); return words; });
  const withoutUrls = withoutMarkdown.replace(URL_PATTERN, (url) => { keep(url); return ""; });
  const body = withoutUrls
    .split("\n")
    .map((line) => line
      .replace(/\(\s*\)|\[\s*\]|<\s*>/g, "")
      .replace(/[\t ]+([.,;:!?])/g, "$1")
      .replace(/[\t ]{2,}/g, " ")
      .replace(/\s*[:：]\s*$/, "")
      .trimEnd())
    .filter((line, index, lines) => line.trim() !== "" || (index > 0 && lines[index - 1].trim() !== ""))
    .join("\n")
    .trim();
  return { body, links: urls.map((url) => ({ url, label: labelResponseLink(url) })) };
}
