import { MemberPhoneError, normalizeMemberPhone } from "./member-phone";

function escapeVCardText(value: string): string {
  return value.replace(/\r\n|\r|\n|\u2028|\u2029/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "")
    .replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
}

/** Fold by UTF-8 octets without splitting a code point. Continuation space counts. */
function foldVCardLine(line: string): string {
  const encoder = new TextEncoder();
  let folded = "";
  let octets = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (octets + size > 75) { folded += "\r\n "; octets = 1; }
    folded += character;
    octets += size;
  }
  return folded;
}

export function createMemberVCard(name: string, uri: string): string {
  if (!uri.startsWith("tel:") || normalizeMemberPhone(uri.slice(4)) !== uri) throw new MemberPhoneError("invalid", "연락처를 사용할 수 없습니다. 다시 불러와 주세요.");
  const fullName = escapeVCardText(name.trim()) || "회원";
  return ["BEGIN:VCARD", "VERSION:3.0", `N:${fullName};;;;`, `FN:${fullName}`, `TEL;TYPE=VOICE:${uri.slice(4)}`, "END:VCARD"].map(foldVCardLine).join("\r\n") + "\r\n";
}

export function memberContactFilename(name: string): string {
  const safeName = Array.from(name.replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/g, "").trim().replace(/^[. ]+|[. ]+$/g, "")).slice(0, 80).join("").replace(/[. ]+$/g, "");
  const stem = !safeName || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safeName) ? "member" : safeName;
  return `${stem}.vcf`;
}

/** Request a local import file from an explicit click; the user saves it in Contacts. */
export function downloadMemberContact(name: string, uri: string): () => void {
  const blob = new Blob([createMemberVCard(name, uri)], { type: "text/vcard;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let released = false;
  const cleanup = () => { if (released) return; released = true; clearTimeout(timer); URL.revokeObjectURL(url); };
  let link: HTMLAnchorElement | null = null;
  try {
    link = document.createElement("a");
    link.href = url;
    link.download = memberContactFilename(name);
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    timer = setTimeout(cleanup, 30_000);
    return cleanup;
  } catch (cause) {
    cleanup();
    throw cause;
  } finally {
    link?.remove();
  }
}
