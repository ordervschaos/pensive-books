// brief-to-spine — the brief→spine transform (the top, one-way edge of the resolution ladder).
//
// The BOOK SPINE is the throughline: in 1–2 short paragraphs, what this book is fundamentally doing —
// its central objective/promise and the arc from start to finish — derived from the brief. It is the
// book-level objective every page serves; distinct from the brief (genre/audience/tone constraints).
// brief→spine is DOWN-ONLY: AI drafts the spine from the brief, never the reverse.
//
//   client → POST { bookId } → verify edit access → Claude (brief + outline) → { spine }
//
// Synchronous, like objective-to-beat. The client writes books.spine = { text, brief_hash }.
// Needs ANTHROPIC_API_KEY.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { callClaude, textFromClaude } from "../_shared/claude.ts";
import { getActiveModels } from "../_shared/model-config.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

interface Brief {
  scope?: { band?: string; word_target?: number };
  genre?: string;
  audience?: string;
  premise?: string;
  tone?: string[];
  success_criteria?: string;
}

const SYSTEM = `You are a book architect writing the BOOK SPINE — the throughline of the whole book. In 1–2 short paragraphs, state what this book is fundamentally DOING: its central objective/promise and the arc from beginning to end. This is the book-level objective every page will serve.

Rules:
- Output 1–2 short paragraphs. No title, no heading, no preamble, no markdown, no meta commentary — just the spine.
- It is the structural throughline, NOT a blurb or marketing copy and NOT a chapter list. Name the central aim, the through-arc, and what changes by the end.
- Derive it from the brief (genre, audience, premise, tone). Honour them as the voice/intent contract.
- If an outline is given, stay consistent with it, but write the spine at the BOOK level — above any single page.`;

function briefContext(brief: Brief | null): string {
  if (!brief) return "(no brief set — infer a sensible neutral aim)";
  const lines: string[] = [];
  if (brief.scope?.band) lines.push(`- Scope: ${brief.scope.band}${brief.scope.word_target ? ` (≈${brief.scope.word_target} words)` : ""}`);
  if (brief.genre) lines.push(`- Genre: ${brief.genre}`);
  if (brief.audience) lines.push(`- Audience: ${brief.audience}`);
  if (brief.premise) lines.push(`- Premise: ${brief.premise}`);
  if (brief.tone?.length) lines.push(`- Tone: ${brief.tone.join(", ")}`);
  if (brief.success_criteria) lines.push(`- Success looks like: ${brief.success_criteria}`);
  return lines.length ? lines.join("\n") : "(brief is empty — infer a sensible neutral aim)";
}

function outlineContext(pages: Array<{ page_type: string | null; title: string | null; metadata: { objective?: string } | null }>): string {
  return pages
    .map((p) => {
      const obj = p.metadata?.objective?.trim();
      if (p.page_type === "section") return `# ${p.title || "(untitled section)"}${obj ? ` — ${obj}` : ""}`;
      return `- "${p.title || "(untitled)"}"${obj ? ` — ${obj}` : ""}`;
    })
    .join("\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const { bookId } = (await req.json().catch(() => ({}))) as { bookId?: number };
    if (!bookId) return json({ error: "bookId is required" }, 400);

    const { data: book, error: bookError } = await userClient
      .from("books").select("id, name, owner_id, brief").eq("id", bookId).single();
    if (bookError || !book) return json({ error: "Book not found" }, 404);

    const { data: access } = await userClient
      .from("book_access").select("id").eq("book_id", bookId).eq("user_id", user.id).eq("status", "accepted").maybeSingle();
    if (book.owner_id !== user.id && !access) return json({ error: "Access denied" }, 403);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const { data: pages } = await userClient
      .from("pages").select("page_type, title, metadata")
      .eq("book_id", bookId).eq("archived", false).order("page_index", { ascending: true });
    const outline = (pages as Array<{ page_type: string | null; title: string | null; metadata: { objective?: string } | null }>) ?? [];

    const { high: model } = await getActiveModels();
    const data = await callClaude(apiKey, {
      model,
      max_tokens: 1024,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{
        role: "user",
        content:
          `BOOK: ${book.name}\n\nBRIEF (the voice/intent contract):\n${briefContext(book.brief as Brief | null)}` +
          (outline.length ? `\n\nCURRENT OUTLINE (for consistency — write the spine ABOVE these):\n${outlineContext(outline)}` : "") +
          `\n\nWrite the book spine. 1–2 short paragraphs, the throughline only.`,
      }],
    }, { fn: "brief-to-spine", bookId, userId: user.id });

    const spine = textFromClaude(data).trim();
    if (!spine) return json({ error: "Claude returned no spine." }, 502);

    return json({ spine });
  } catch (e) {
    console.error("brief-to-spine error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
