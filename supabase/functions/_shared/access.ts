// access.ts — the single book edit-access check shared by every AI edge function. A user may edit a
// book if they OWN it or hold an ACCEPTED book_access row. Centralized so the rule (and its "accepted"
// status filter) can't drift across the ~15 call sites that gate writes — promoted from the fuller
// `canEdit` that already existed in generate-book.
import { type SupabaseClient } from "jsr:@supabase/supabase-js@2";

// Pass `ownerId` when the book is already loaded (skips a query); omit it to have the owner fetched.
export async function hasEditAccess(
  client: SupabaseClient,
  bookId: number,
  userId: string,
  ownerId?: string | null,
): Promise<boolean> {
  if (ownerId && ownerId === userId) return true;
  if (!ownerId) {
    const { data: book } = await client.from("books").select("owner_id").eq("id", bookId).maybeSingle();
    if (book && (book as { owner_id: string }).owner_id === userId) return true;
  }
  const { data: access } = await client
    .from("book_access").select("id").eq("book_id", bookId).eq("user_id", userId).eq("status", "accepted").maybeSingle();
  return !!access;
}
