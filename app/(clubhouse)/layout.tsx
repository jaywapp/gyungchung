import Clubhouse from "@/components/clubhouse";

/**
 * Every clubhouse section renders through this shared layout, so navigating
 * between them swaps only the leaf page. The Clubhouse tree — auth session,
 * loaded data, scroll position — is never unmounted. Children are handed to
 * Clubhouse so any future server content lands inside its <main> landmark.
 */
export default function ClubhouseLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <Clubhouse>{children}</Clubhouse>;
}
