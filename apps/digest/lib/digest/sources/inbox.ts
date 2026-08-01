import type { Adapter, InboxSection, Item, RunCtx } from "../types";
import { createServiceClient } from "@/lib/supabase/server";
import { stripHtml } from "../fetch";

// inbox — newsletters delivered to this digest's own address.
//
// Retrieval is a single DB read, because the retrieval already happened: the sender pushed. No fetch, no
// extraction, no model, and no source-quality judgement — the reader curated this list by subscribing to it.
//
// The identity trick worth noticing: an Item needs a `url` to take part in the dedupe layer, and mail has
// no url. A synthetic permalink (digest.pensive.me/inbox/<id>) gives it one that is stable, unique, and
// never fetched — so a newsletter that appears in two digests, or is re-read after a regenerate, behaves
// exactly like an article for every stage downstream.

const DEFAULT_DAYS = 2;

interface Row {
  id: number;
  sender: string | null;
  sender_name: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  received_at: string;
}

export const inboxAdapter: Adapter = async (section, ctx: RunCtx) => {
  const s = section as InboxSection;
  const days = s.days ?? DEFAULT_DAYS;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const { data, error } = await createServiceClient()
    .from("digest_inbox_messages")
    .select("id, sender, sender_name, subject, body_text, body_html, received_at")
    .eq("digest_id", ctx.digest.id)
    .gte("received_at", since)
    .order("received_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error(`inbox ${s.id}: read failed:`, error.message);
    return [];
  }

  const wanted = (s.senders ?? []).map((x) => x.toLowerCase().trim()).filter(Boolean);

  return ((data ?? []) as Row[])
    .filter((r) => {
      if (!wanted.length) return true;
      const from = `${r.sender ?? ""} ${r.sender_name ?? ""}`.toLowerCase();
      return wanted.some((w) => from.includes(w));
    })
    .map(
      (r): Item => ({
        title: r.subject ?? "(no subject)",
        // Mail IS the article — no extraction step, which is why this is the cheapest source in the app.
        text: (r.body_text || stripHtml(r.body_html ?? "")).slice(0, 12_000),
        url: `https://digest.pensive.me/inbox/${r.id}`,
        source: r.sender_name || r.sender || "inbox",
        published_at: r.received_at,
      }),
    )
    .filter((i) => i.text.trim().length > 120); // a two-line "thanks for subscribing" is not a newsletter
};
