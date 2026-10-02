export interface WelcomeStep { title: string; body: string }
export interface WelcomeOfficer { id: string; name: string; role: string; bio: string }
export interface WelcomeContent {
  schemaVersion: 1;
  title: string;
  introduction: string;
  accountSteps: WelcomeStep[];
  officers: WelcomeOfficer[];
  android: { enabled: boolean; installSteps: WelcomeStep[] };
  ios: { status: "preparing" | "testflight" | "released" | "hidden"; message: string; url: string };
}
export interface WelcomeDraft {
  id: boolean;
  content: WelcomeContent;
  revision: number;
  published_revision: number | null;
  updated_at: string;
  updated_by: string | null;
}
export interface WelcomePublication {
  id: boolean;
  content: WelcomeContent;
  revision: number;
  published_at: string;
}
export type WelcomePageState = "published" | "unpublished" | "error";
export const ANDROID_DOWNLOAD_URL = "https://github.com/jaywapp/gyungchung-releases/releases/latest/download/gyungchung-latest.apk";
export const DEFAULT_WELCOME_CONTENT: WelcomeContent = {
  schemaVersion: 1,
  title: "경충FC에 오신 것을\n환영합니다",
  introduction: "운영진을 확인하고 앱을 설치해 함께 시작하세요.",
  accountSteps: [
    { title: "운영진에게 등록 요청", body: "이름과 전화번호를 알려 계정 등록을 요청하세요." },
    { title: "전화번호로 로그인", body: "안내받은 전화번호와 초기 비밀번호로 로그인하세요." },
    { title: "새 비밀번호 설정", body: "첫 로그인 후 본인만 아는 비밀번호로 변경하세요." },
  ],
  officers: [],
  android: { enabled: true, installSteps: [
    { title: "설치 파일 받기", body: "Android 다운로드를 눌러 APK 파일을 받으세요." },
    { title: "설치 허용", body: "파일을 열고 Android 안내에 따라 이 출처의 앱 설치를 허용하세요." },
    { title: "앱 열기", body: "설치가 끝나면 경충FC 앱을 여세요. 다운로드가 막히면 외부 브라우저에서 이 페이지를 열어 주세요." },
  ] },
  ios: { status: "preparing", message: "iOS 앱은 준비 중입니다. 웹에서 같은 계정으로 이용할 수 있습니다.", url: "" },
};

/** This exact ASCII URL policy is also enforced by the database. */
export function isApprovedIosUrl(value: string) {
  if (/[^\x21-\x7e]/.test(value)) return false;
  return /^https:\/\/(apps\.apple\.com|testflight\.apple\.com)\/[A-Za-z0-9_~!$&()*+,;=:@%.-][A-Za-z0-9/_~!$&()*+,;=:@%.-]*([?][A-Za-z0-9/_~!$&()*+,;=:@%?.-]*)?(#[A-Za-z0-9/_~!$&()*+,;=:@%?.-]*)?$/.test(value);
}
export function isPublicAndroidUrl(value: string) {
  try {
    const url = new URL(value);
    return value === url.href && url.protocol === "https:" && !url.username && !url.password && !url.port && !url.search && !url.hash &&
      url.hostname === "github.com" && /^\/jaywapp\/gyungchung-releases\/releases\/download\/[^/]+\/[^/]+\.apk$/.test(url.pathname);
  } catch { return false; }
}

/** Draft validation also runs in PostgreSQL; publish adds completeness checks. */
export function validateWelcomeContent(content: WelcomeContent, publish = false): string[] {
  if (!isWelcomeContent(content)) return ["콘텐츠 형식이 잘못되었습니다. 새로 불러온 뒤 다시 시도해 주세요."];
  const errors: string[] = [];
  const text = (value: unknown, label: string, max: number, required = false) => {
    if (typeof value !== "string" || value.length > max || (required && !value.trim())) errors.push(`${label}을 확인해 주세요${required ? " (필수)" : ""}. 최대 ${max}자입니다.`);
  };
  text(content.title, "환영 제목", 160, publish);
  text(content.introduction, "소개 문구", 1000, publish);
  const steps = (items: WelcomeStep[], label: string) => {
    items.forEach((item, index) => { text(item.title, `${label} ${index + 1} 제목`, 160, publish); text(item.body, `${label} ${index + 1} 설명`, 2000, publish); });
  };
  steps(content.accountSteps, "계정 안내");
  steps(content.android.installSteps, "설치 안내");
  const ids = new Set<string>();
  content.officers.forEach((officer) => {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(officer.id) || /[^a-zA-Z0-9_-]/.test(officer.id) || ids.has(officer.id) || ["staff", "download", "account-guide"].includes(officer.id) || officer.id.startsWith("welcome-")) errors.push("운영진의 항목 ID가 잘못되었거나 중복되었습니다.");
    ids.add(officer.id);
    text(officer.name, "운영진 이름", 100, publish); text(officer.role, "운영진 직책", 100, publish); text(officer.bio, "운영진 소개", 2000);
  });
  if (!["preparing", "testflight", "released", "hidden"].includes(content.ios.status)) errors.push("iOS 배포 상태를 확인해 주세요.");
  text(content.ios.message, "iOS 안내", 1000);
  text(content.ios.url, "iOS 링크", 2000);
  if (content.ios.url && !isApprovedIosUrl(content.ios.url)) errors.push("iOS 링크는 공식 App Store 또는 TestFlight HTTPS 주소여야 합니다.");
  if (publish && ["testflight", "released"].includes(content.ios.status) && !isApprovedIosUrl(content.ios.url)) errors.push("활성 iOS 배포에는 공식 HTTPS 링크가 필요합니다.");
  if (new TextEncoder().encode(JSON.stringify(content)).length > 500000) errors.push("콘텐츠가 너무 큽니다. 전체 500KB 이내로 입력해 주세요.");
  return [...new Set(errors)];
}

/** Parse external JSON without accepting private or unexpected fields. */
export function isWelcomeContent(value: unknown): value is WelcomeContent {
  const object = (item: unknown, keys: string[]): item is Record<string, unknown> => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    return Object.keys(item).length === keys.length && keys.every((key) => Object.hasOwn(item, key));
  };
  const list = (item: unknown, limit: number, check: (entry: unknown) => boolean) => Array.isArray(item) && item.length <= limit && item.every(check);
  const step = (item: unknown) => object(item, ["title", "body"]) && typeof item.title === "string" && typeof item.body === "string";
  const officer = (item: unknown) => object(item, ["id", "name", "role", "bio"]) && [item.id, item.name, item.role, item.bio].every((entry) => typeof entry === "string");
  if (!object(value, ["schemaVersion", "title", "introduction", "accountSteps", "officers", "android", "ios"])) return false;
  return value.schemaVersion === 1 && typeof value.title === "string" && typeof value.introduction === "string" && list(value.accountSteps, 10, step) &&
    list(value.officers, 30, officer) && object(value.android, ["enabled", "installSteps"]) && typeof value.android.enabled === "boolean" && list(value.android.installSteps, 10, step) &&
    object(value.ios, ["status", "message", "url"]) && [value.ios.status, value.ios.message, value.ios.url].every((entry) => typeof entry === "string");
}
