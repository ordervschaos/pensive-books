// distill-beat — the prose→beat transform (the first UPWARD/reverse edge of the resolution ladder).
//
// Reverse-outlining: read a page's PROSE and abstract it back into a BEAT — the one-paragraph plan
// the prose implements. Two uses: (1) backfill beats for books written before the beat layer existed;
// (2) "pull up" — after hand-rewriting prose, re-derive the beat so the plan reflects reality.
//
//   client → POST { bookId, pageId, proseText }
//     → verify edit access → Claude (brief + spine + objective + the prose) → { beat }
//
// Synchronous, like expand-beat. The client writes metadata.beat and reconciles BOTH neighbouring
// edges (objective_beat + beat_prose), since distilling-and-accepting declares the beat sits
// correctly between this objective and this prose. Needs ANTHROPIC_API_KEY.
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

const SYSTEM = `You are a book architect REVERSE-OUTLINING a page: given the page's finished PROSE, write the BEAT it implements — a single paragraph that states, in concrete order, what the page actually does (its moves, turns, and images). You are abstracting the prose UP into its plan, not editing or judging it.

Rules:
- Output ONE paragraph (3–6 sentences). No title, no heading, no preamble, no markdown, no meta commentary — just the beat.
- It is a PLAN that describes what the prose DOES, in order — not a summary of the plot and not the prose itself. Capture the structure (what happens first, then, the turn), not the wording.
- Be faithful to the prose as written (this is reverse-outlining); use the objective only to frame the level of abstraction, not to "correct" the prose.
- Stay in the register the brief and book spine imply.`;

function briefContext(brief: Brief | null): string {
  if (!brief) return "(no brief set)";
  const lines: string[] = [];
  if (brief.scope?.band) lines.push(`- Scope: ${brief.scope.band}`);
  if (brief.genre) lines.push(`- Genre: ${brief.genre}`);
  if (brief.audience) lines.push(`- Audience: ${brief.audience}`);
  if (brief.premise) lines.push(`- Premise: ${brief.premise}`);
  if (brief.tone?.length) lines.push(`- Tone: ${brief.tone.join(", ")}`);
  return lines.length ? lines.join("\n") : "(brief is empty)";
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

    const { bookId, pageId, proseText } = (await req.json().catch(() => ({}))) as {
      bookId?: number; pageId?: number; proseText?: string;
    };
    if (!bookId || !pageId) return json({ error: "bookId and pageId are required" }, 400);
    const prose = (proseText ?? "").trim();
    if (!prose) return json({ error: "The page has no prose to distill a beat from" }, 400);

    const { data: book, error: bookError } = await userClient
      .from("books").select("id, name, owner_id, brief, spine").eq("id", bookId).single();
    if (bookError || !book) return json({ error: "Book not found" }, 404);

    const { data: access } = await userClient
      .from("book_access").select("id").eq("book_id", bookId).eq("user_id", user.id).eq("status", "accepted").maybeSingle();
    if (book.owner_id !== user.id && !access) return json({ error: "Access denied" }, 403);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const { data: page } = await userClient
      .from("pages").select("title, metadata").eq("id", pageId).maybeSingle();
    const objective = ((page?.metadata as { objective?: string } | null)?.objective ?? "").trim();
    const spine = (book.spine as { text?: string } | null)?.text?.trim() || null;
    const title = (page as { title?: string } | null)?.title ?? null;

    const data = await callClaude(apiKey, {
      model: MODEL,
      max_tokens: 1024,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{
        role: "user",
        content:
          `BOOK: ${book.name}\n\nBRIEF:\n${briefContext(book.brief as Brief | null)}` +
          (spine ? `\n\nBOOK SPINE:\n${spine}` : "") +
          (objective ? `\n\nTHIS PAGE'S OBJECTIVE (for framing the abstraction level only):\n${objective}` : "") +
          `\n\nTHE PAGE'S PROSE${title ? ` ("${title}")` : ""} — reverse-outline this into its beat:\n"""\n${prose.slice(0, 12000)}\n"""\n\nWrite the beat this prose implements. One paragraph, plan only.`,
      }],
    }, { fn: "distill-beat", bookId, userId: user.id });

    const beat = ((data.content ?? []) as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
    if (!beat) return json({ error: "Claude returned no beat." }, 502);

    return json({ beat });
  } catch (e) {
    console.error("distill-beat error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
