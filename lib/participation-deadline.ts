import type { ParticipationForm } from "@/lib/types";

/**
 * A form stops taking answers at `ends_at` even while its stored status is
 * still "open" (the submit RPC enforces the same deadline), so the card has to
 * read both before it offers a way in.
 */
export function isParticipationClosed(form: Pick<ParticipationForm, "status" | "ends_at">, now = Date.now()) {
  if (form.status === "closed") return true;
  return form.ends_at ? new Date(form.ends_at).getTime() <= now : false;
}

/** Past deadlines say "마감됨" once; the relative suffix is only for deadlines still ahead. */
export function formatDeadline(value: string, now = Date.now()) {
  const deadline = new Date(value);
  const stamp = `${deadline.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", weekday: "short" })} ${deadline.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
  const remaining = deadline.getTime() - now;
  if (remaining <= 0) return `${stamp} 마감됨`;
  const remainingDays = Math.ceil(remaining / 86_400_000);
  return `${stamp} 마감 · ${remainingDays <= 1 && deadline.toDateString() === new Date(now).toDateString() ? "오늘 마감" : `D-${remainingDays}`}`;
}
