import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  // Old provider redirects must not create a social-login session.
  return NextResponse.redirect(new URL("/?auth=phone-only", url.origin));
}
