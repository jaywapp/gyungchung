import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://gyungchung.vercel.app";
  return ["", "/members", "/fees", "/notices", "/events", "/rankings", "/feedback", "/participation"].map((path) => ({ url: `${baseUrl}${path}`, lastModified: new Date(), changeFrequency: "weekly" as const, priority: path ? 0.7 : 1 }));
}
