export type ToastKind = "success" | "error";
export type ToastHandler = (message: string, kind?: ToastKind) => void;

type ErrorLike = { code?: string | null; message?: string | null };

export function toErrorMessage(error: unknown): string {
  console.error(error);
  const value = (error ?? {}) as ErrorLike;
  const code = value.code ?? "";
  const message = value.message?.toLowerCase() ?? "";

  if (code === "42501" || message.includes("row-level security") || message.includes("permission denied")) return "이 작업을 수행할 권한이 없습니다.";
  if (code === "23505" || message.includes("duplicate")) return "이미 등록된 내용입니다.";
  if (code === "23503" || message.includes("foreign key")) return "연결된 정보가 있어 처리할 수 없습니다.";
  if (message.includes("failed to fetch") || message.includes("network")) return "서버에 연결하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.";
  return "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}
