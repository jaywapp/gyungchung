import type { MetadataRoute } from "next";
import { SPLASH_BACKGROUND } from "@/lib/splash-motion";

/** Installable web app. The background matches the launch splash so the OS splash hands over without a colour jump. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "경충FC 클럽하우스",
    short_name: "경충FC",
    description: "경충FC 회원, 회비, 공지와 주말 풋살 일정을 한곳에서 확인하세요.",
    lang: "ko",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: SPLASH_BACKGROUND,
    theme_color: SPLASH_BACKGROUND,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
