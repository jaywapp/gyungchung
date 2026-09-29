export type ResponseLink = { url: string; label: string };

const URL_PATTERN = /https?:\/\/[^\s<>()[\]]+[^\s<>()[\].,;:!?'"’”)]/g;
const MARKDOWN_LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
/**
 * A caption written right before a URL: at most 20 characters, ending in a
 * colon, and starting at a line, sentence or list-separator boundary — so
 * ordinary prose that merely precedes a link is never mistaken for one.
 */
const URL_CAPTION = /(^|\n|[.!?。]\s+|[·|,]\s*)([^\s:：·|,.!?][^:：\n·|,.!?]{0,19}?)\s*[:：]\s*$/;
const SEPARATOR_TAIL = /\s*[·|,]\s*$/;
const SEPARATOR_HEAD = /^\s*[·|,]\s*/;

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

const isGithubThread = (url: string) => /^https:\/\/github\.com\/[^/]+\/[^/]+\/(issues|pull)\/\d+/.test(url);

/**
 * Splits a stored answer into readable prose and the links it cites. The
 * stored text is never changed; this only decides how it renders.
 * - Markdown links keep their words in the prose.
 * - Bare URLs leave the prose, together with a short "caption:" right before
 *   them and the "·" / "|" / "," that chained them to a neighbouring link.
 * - A non-GitHub link uses its caption as the badge text when it has one.
 */
export function splitResponseLinks(text: string): { body: string; links: ResponseLink[] } {
  const links: ResponseLink[] = [];
  const keep = (url: string, caption?: string) => {
    if (links.some((link) => link.url === url)) return;
    links.push({ url, label: caption && !isGithubThread(url) ? caption : labelResponseLink(url) });
  };
  const withoutMarkdown = text.replace(MARKDOWN_LINK, (_match, words: string, url: string) => { keep(url); return words; });

  let prose = "";
  let cursor = 0;
  let afterUrl = false;
  for (const match of withoutMarkdown.matchAll(URL_PATTERN)) {
    let before = withoutMarkdown.slice(cursor, match.index);
    if (afterUrl) before = before.replace(SEPARATOR_HEAD, "");
    const caption = before.match(URL_CAPTION);
    if (caption) before = before.slice(0, before.length - caption[0].length + caption[1].length);
    before = before.replace(SEPARATOR_TAIL, "");
    prose += before;
    keep(match[0], caption?.[2].trim());
    cursor = match.index + match[0].length;
    afterUrl = true;
  }
  let rest = withoutMarkdown.slice(cursor);
  if (afterUrl) rest = rest.replace(SEPARATOR_HEAD, "");
  prose += rest;

  const body = prose
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
  return { body, links };
}
