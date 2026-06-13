// objectives-to-spine — the objectives→spine transform (an UPWARD/reverse edge; N→1).
//
// Reverse-outlining at the top: read the book's whole page-objective outline and abstract it into the
// SPINE — the 1–2 paragraph throughline. Used to pull a hand-shaped outline back up into the spine so
// the book-level statement reflects what the pages actually do.
//
//   client → POST { bookId } → verify edit access → Claude (brief + the outline) → { spine }
//
// Synchronous. The client writes books.spine = { text, brief_hash }. Needs ANTHROPIC_API_KEY.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { hasEditAccess } from "../_shared/access.ts";
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

const SYSTEM = `You are a book architect ABSTRACTING UP: given the book's full outline (its chapters and pages, each with its objective), write the BOOK SPINE — the throughline. In 1–2 short paragraphs, state what this book is fundamentally DOING across all these pages: its central objective/promise and the arc from beginning to end.

Rules:
- Output 1–2 short paragraphs. No title, no heading, no preamble, no markdown, no meta commentary — just the spine.
- It is the structural throughline that the pages collectively realize — NOT a blurb, NOT a chapter list, NOT a summary of each page. Name the central aim, the through-arc, and what changes by the end.
- Be faithful to what the outline actually does (this is reverse-outlining); the brief only frames the register.`;

function briefContext(brief: Brief | null): string {
  if (!brief) return "(no brief set)";
  const lines: string[] = [];
  if (brief.genre) lines.push(`- Genre: ${brief.genre}`);
  if (brief.audience) lines.push(`- Audience: ${brief.audience}`);
  if (brief.premise) lines.push(`- Premise: ${brief.premise}`);
  if (brief.tone?.length) lines.push(`- Tone: ${brief.tone.join(", ")}`);
  return lines.length ? lines.join("\n") : "(brief is empty)";
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

    if (!(await hasEditAccess(userClient, bookId, user.id, book.owner_id)))
      return json({ error: "Access denied" }, 403);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const { data: pages } = await userClient
      .from("pages").select("page_type, title, metadata")
      .eq("book_id", bookId).eq("archived", false).order("page_index", { ascending: true });
    const outline = (pages as Array<{ page_type: string | null; title: string | null; metadata: { objective?: string } | null }>) ?? [];
    if (!outline.some((p) => p.metadata?.objective?.trim())) {
      return json({ error: "The book has no page objectives to distill a spine from" }, 400);
    }

    const { high: model } = await getActiveModels();
    const data = await callClaude(apiKey, {
      model,
      max_tokens: 1024,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{
        role: "user",
        content:
          `BOOK: ${book.name}\n\nBRIEF (for register only):\n${briefContext(book.brief as Brief | null)}` +
          `\n\nTHE BOOK'S OUTLINE (chapters & pages with objectives) — abstract this up into the spine:\n${outlineContext(outline)}` +
          `\n\nWrite the book spine the outline realizes. 1–2 short paragraphs, the throughline only.`,
      }],
    }, { fn: "objectives-to-spine", bookId, userId: user.id });

    const spine = textFromClaude(data).trim();
    if (!spine) return json({ error: "Claude returned no spine." }, 502);

    return json({ spine });
  } catch (e) {
    console.error("objectives-to-spine error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
