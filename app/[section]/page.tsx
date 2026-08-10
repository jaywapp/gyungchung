import { notFound } from "next/navigation";
import Clubhouse from "@/components/clubhouse";

const sections = new Set(["members", "fees", "notices", "events", "rankings", "feedback", "participation", "admin"]);

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!sections.has(section)) notFound();
  return <Clubhouse />;
}
