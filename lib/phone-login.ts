/** Accept Korean mobile numbers only; never reinterpret an email as a phone number. */
export function createPhoneLoginCredentials(value: string, password: string) {
  const compact = value.trim().replace(/[\s()-]/g, "");
  const local = compact.startsWith("+82") ? `0${compact.slice(3)}` : compact.startsWith("82") ? `0${compact.slice(2)}` : compact;
  if (!/^01[016789][0-9]{7,8}$/.test(local)) return null;
  return { phone: `+82${local.slice(1)}`, password: password === "1234" ? "gyungchung-1234" : password };
}

export function getPhoneLoginError(error: { code?: string }) {
  if (error.code?.includes("rate_limit")) return "요청이 많습니다. 잠시 후 다시 시도해 주세요.";
  if (error.code === "phone_not_confirmed") return "전화번호 계정 등록을 운영진에게 확인해 주세요.";
  return "전화번호와 비밀번호를 확인해 주세요. 비밀번호를 잊었다면 운영진에게 초기화를 요청해 주세요.";
}
