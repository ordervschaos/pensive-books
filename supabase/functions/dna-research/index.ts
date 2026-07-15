// dna-research — the PRECOMPUTE research pass (option B). Given a book + a craft question ("how do great
// vampire stories open?"), it runs ONE web_search-backed Claude call, distills the results to a few usable
// constraints (see _shared/research.ts), and stores them on books.craft_notes under a topic key. Generation
// then reads craft_notes as an anchor (see book-agent/context.ts) — so the research lands OUT of the hot
// path, is author-editable, and is inspectable before it shapes prose.
//
//   client → POST { bookId, question, topic?, context? }
//          → one Claude+web_search call → merge into books.craft_notes → { topic, notes, sources }
//
// Stateless like the read-* fns: the browser owns when to run it and what to do with the result. Writing to
// craft_notes rides the existing books row + its Realtime stream — no new table.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, json } from "../_shared/cors.ts";
import { userClient as createUserClient } from "../_shared/task.ts";
import { researchCraft, renderResearch } from "../_shared/research.ts";

const MAX_QUESTION = 500;
const MAX_CONTEXT = 4000;

// A stable, human-readable key for the craft_notes map: lowercased, non-alphanumerics → '-', capped. Two
// calls on the same question overwrite the same key (research is refreshable, not append-only).
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "note";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const userClient = createUserClient(req.headers.get("Authorization") ?? "");
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { bookId, question, topic, context } = (await req.json().catch(() => ({}))) as {
      bookId?: number; question?: string; topic?: string; context?: string;
    };
    if (!bookId || !question?.trim()) {
      return json({ error: "bookId and a non-empty question are required" }, 400);
    }

    // Access check + current notes in one read (RLS scopes it to the owner).
    const { data: book } = await userClient.from("books").select("id, name, craft_notes").eq("id", bookId).maybeSingle();
    if (!book) return json({ error: "Book not found or access denied" }, 403);
    const b = book as { name?: string; craft_notes?: Record<string, string> | null };

    const q = question.trim().slice(0, MAX_QUESTION);
    const key = (topic?.trim() && slugify(topic)) || slugify(q);

    const result = await researchCraft(
      { question: q, context: (context ?? "").trim().slice(0, MAX_CONTEXT) || undefined },
      { fn: "dna-research", bookId, operation: "research", taskTable: "books", taskId: null, userId: user.id },
      { signal: AbortSignal.timeout(120_000) },
    );

    const note = renderResearch(result);
    const notes = { ...((b.craft_notes ?? {}) as Record<string, string>), [key]: note };
    const { error } = await userClient.from("books").update({ craft_notes: notes }).eq("id", bookId);
    if (error) return json({ error: `Couldn't save the note: ${error.message}` }, 500);

    return json({ topic: key, notes: note, sources: result.sources });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
