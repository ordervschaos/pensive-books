import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { bookId, pageIndex } = body;

    if (typeof bookId !== "number" || typeof pageIndex !== "number") {
      return NextResponse.json({ error: "Invalid bookId or pageIndex" }, { status: 400 });
    }

    const supabase = createClient();
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const timestamp = new Date().toISOString();

    const { data: userData } = await supabase
      .from("user_data")
      .select("bookmarked_pages")
      .eq("user_id", session.user.id)
      .maybeSingle();

    const existingBookmarks =
      (userData?.bookmarked_pages as Record<string, unknown>) || {};

    const { error: upsertError } = await supabase
      .from("user_data")
      .upsert(
        {
          user_id: session.user.id,
          bookmarked_pages: {
            ...existingBookmarks,
            [bookId]: { pageIndex, timestamp },
          },
        },
        { onConflict: "user_id" },
      );

    if (upsertError) {
      console.error("[bookmark] upsert failed:", upsertError);
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[bookmark] unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
