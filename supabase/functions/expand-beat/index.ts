// expand-beat — the objective→beat transform (one downward edge of the resolution ladder).
//
// A BEAT is a single paragraph that plans, in concrete order, what one page does to fulfil its
// objective — the middle resolution between the OBJECTIVE (what the page must achieve) and the PROSE
// (the words). This function drafts it from the page's objective, in the book's voice and continuity.
//
//   client → POST { bookId, pageId, objective }
//     → verify edit access → Claude (brief + spine + outline neighbours + objective) → { beat }
//
// Synchronous (a paragraph is quick), like generate-unit. The client writes metadata.beat and stamps
// the objective_beat edge hash (planProvenance.stampEdge) — this function only returns the text.
// Needs ANTHROPIC_API_KEY (shared with the other AI steps).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { callClaude } from "../_shared/claude.ts";

const MODEL = "claude-sonnet-4-6";

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

const SYSTEM = `You are a book architect writing a BEAT — a single paragraph that plans, in concrete order, what ONE page of the book does to fulfil its objective. A beat sits between the OBJECTIVE (what the page must achieve) and the PROSE (the actual words): it commits to the specific moves, turns, and images — the "how" — without writing the page itself.

Rules:
- Output ONE paragraph (3–6 sentences). No title, no heading, no preamble, no markdown, no meta commentary — just the beat.
- It is a PLAN, not prose: say what happens and in what order; do NOT write the page's actual sentences or dialogue.
- Fulfil the page's objective exactly. Honour the book's brief (genre, audience, tone, premise) and the book spine as the voice/throughline contract.
- Keep continuity: lead from what the preceding pages set up, don't repeat a neighbouring page's beat, and set up what follows.`;

function briefContext(brief: Brief | null): string {
  if (!brief) return "(no brief set — infer a sensible neutral voice)";
  const lines: string[] = [];
  if (brief.scope?.band) lines.push(`- Scope: ${brief.scope.band}${brief.scope.word_target ? ` (≈${brief.scope.word_target} words)` : ""}`);
  if (brief.genre) lines.push(`- Genre: ${brief.genre}`);
  if (brief.audience) lines.push(`- Audience: ${brief.audience}`);
  if (brief.premise) lines.push(`- Premise: ${brief.premise}`);
  if (brief.tone?.length) lines.push(`- Tone: ${brief.tone.join(", ")}`);
  if (brief.success_criteria) lines.push(`- Success looks like: ${brief.success_criteria}`);
  return lines.length ? lines.join("\n") : "(brief is empty — infer a sensible neutral voice)";
}

// A compact id-tagged outline so the beat reads in context; the target page is marked.
function outlineContext(
  pages: Array<{ id: number; page_type: string | null; title: string | null; metadata: { objective?: string } | null }>,
  targetId: number,
): string {
  return pages
    .map((p) => {
      const obj = p.metadata?.objective?.trim();
      const here = p.id === targetId ? "  ◀── THIS PAGE" : "";
      if (p.page_type === "section") return `# ${p.title || "(untitled section)"}${obj ? ` — ${obj}` : ""}`;
      return `- "${p.title || "(untitled)"}"${obj ? ` — ${obj}` : ""}${here}`;
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

    const { bookId, pageId, objective } = (await req.json().catch(() => ({}))) as {
      bookId?: number; pageId?: number; objective?: string;
    };
    if (!bookId || !pageId) return json({ error: "bookId and pageId are required" }, 400);
    const obj = (objective ?? "").trim();
    if (!obj) return json({ error: "An objective is required to write a beat" }, 400);

    const { data: book, error: bookError } = await userClient
      .from("books").select("id, name, owner_id, brief, spine").eq("id", bookId).single();
    if (bookError || !book) return json({ error: "Book not found" }, 404);

    const { data: access } = await userClient
      .from("book_access").select("id").eq("book_id", bookId).eq("user_id", user.id).eq("status", "accepted").maybeSingle();
    if (book.owner_id !== user.id && !access) return json({ error: "Access denied" }, 403);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const { data: pages } = await userClient
      .from("pages").select("id, page_type, title, metadata")
      .eq("book_id", bookId).eq("archived", false).order("page_index", { ascending: true });

    const spine = (book.spine as { text?: string } | null)?.text?.trim() || null;

    const data = await callClaude(apiKey, {
      model: MODEL,
      max_tokens: 1024,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{
        role: "user",
        content:
          `BOOK: ${book.name}\n\nBRIEF (the voice contract):\n${briefContext(book.brief as Brief | null)}` +
          (spine ? `\n\nBOOK SPINE (the throughline):\n${spine}` : "") +
          `\n\nOUTLINE (for continuity — the target page is marked):\n${outlineContext((pages as Array<{ id: number; page_type: string | null; title: string | null; metadata: { objective?: string } | null }>) ?? [], pageId)}` +
          `\n\nTHIS PAGE'S OBJECTIVE:\n${obj}\n\nWrite the beat for THIS PAGE. One paragraph, plan only.`,
      }],
    }, { fn: "expand-beat", bookId, userId: user.id });

    const beat = ((data.content ?? []) as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
    if (!beat) return json({ error: "Claude returned no beat." }, 502);

    return json({ beat });
  } catch (e) {
    console.error("expand-beat error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
