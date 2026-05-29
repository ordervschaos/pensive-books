import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

// Called server-to-server by a Supabase DB trigger (pg_net) when a book's
// public state changes — publish, unpublish, or visibility toggle. It purges
// the data cache tagged in lib/public-books.ts so the change shows immediately
// instead of waiting out the hourly revalidate window.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const secret = process.env.REVALIDATE_SECRET;

  // Fail closed: if no secret is configured, the endpoint is inert.
  if (!secret) {
    return NextResponse.json(
      { error: "Revalidation is not configured" },
      { status: 503 },
    );
  }

  if (request.headers.get("x-revalidate-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let bookId: unknown;
  try {
    ({ bookId } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Listings (library, landing, profile book lists) always need refreshing,
  // since publish/unpublish/visibility changes whether the book appears at all.
  revalidateTag("published-books");

  // Refresh the specific book's detail page + all of its reader pages.
  const hasBookId = typeof bookId === "number" && Number.isFinite(bookId);
  if (hasBookId) {
    revalidateTag(`book-${bookId}`);
  }

  return NextResponse.json({
    revalidated: true,
    bookId: hasBookId ? bookId : null,
  });
}
