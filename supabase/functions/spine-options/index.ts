// spine-options — generate wide alternative spines from the brief.
//
// The spine is the book's throughline (1–2 paragraphs). When the author wants to reconsider
// the direction, this returns 3 genuinely different takes — all faithful to the brief, but
// each pulling a different thread: a different central tension, arc shape, or thematic angle.
//
//   client → POST { bookId }
//     → verify edit access
//     → read brief + current spine
//     → Claude generates 3 wide-varying alternatives at temperature 1
//     → { options: string[] }
//
// Synchronous. Client saves the picked option via saveSpine (stamps brief_hash).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { hasEditAccess } from "../_shared/access.ts";
import { callClaude, textFromClaude, type CallMeta } from "../_shared/claude.ts";
import { getActiveModels } from "../_shared/model-config.ts";
import { parseJsonOptions } from "../_shared/json.ts";

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

const SYSTEM = `You are a book architect generating ALTERNATIVE SPINES from an author's brief.

A SPINE is the book's throughline: 1–2 short paragraphs stating what this book is fundamentally DOING — its central objective/promise and the arc from beginning to end. It is not a blurb or marketing copy. It names the central aim, the through-arc, and what changes by the end.

Generate exactly 3 ALTERNATIVES. Each must:
- Honor the brief (genre, audience, premise, tone, scope) as the non-negotiable contract
- Be GENUINELY DIFFERENT from each other — pull different threads from the premise, foreground different tensions, land on different emotional arcs
- Vary in register: one could be intimate and interior, one structural and external, one thematic/philosophical
- If a current spine is provided, vary away from it — don't paraphrase it

Output JSON ONLY (no prose, no fences):
{ "options": ["<1–2 paragraphs>", "<1–2 paragraphs>", "<1–2 paragraphs>"] }`;

function briefContext(brief: Brief | null): string {
  if (!brief) return "(no brief set)";
  const lines: string[] = [];
  if (brief.scope?.band) lines.push(`- Scope: ${brief.scope.band}${brief.scope.word_target ? ` (≈${brief.scope.word_target} words)` : ""}`);
  if (brief.genre) lines.push(`- Genre: ${brief.genre}`);
  if (brief.audience) lines.push(`- Audience: ${brief.audience}`);
  if (brief.premise) lines.push(`- Premise: ${brief.premise}`);
  if (brief.tone?.length) lines.push(`- Tone: ${brief.tone.join(", ")}`);
  if (brief.success_criteria) lines.push(`- Success looks like: ${brief.success_criteria}`);
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

    const { bookId } = (await req.json().catch(() => ({}))) as { bookId?: number };
    if (!bookId) return json({ error: "bookId is required" }, 400);

    const { data: book, error: bookError } = await userClient
      .from("books").select("id, name, brief, spine, owner_id").eq("id", bookId).single();
    if (bookError || !book) return json({ error: "Book not found" }, 404);

    if (!(await hasEditAccess(userClient, bookId, user.id, book.owner_id)))
      return json({ error: "Access denied" }, 403);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const brief = book.brief as Brief | null;
    const current = (book.spine as { text?: string } | null)?.text?.trim() || null;
    const { high: model } = await getActiveModels();
    const meta: CallMeta = { fn: "spine-options", bookId, userId: user.id };

    const userContent =
      `BOOK: ${book.name}\n\nBRIEF:\n${briefContext(brief)}` +
      (current ? `\n\nCURRENT SPINE (what's there now — vary away from it):\n${current}` : "\n\n(No spine set yet.)") +
      `\n\nGenerate 3 wide-varying alternative spines. JSON only.`;

    const data = await callClaude(apiKey, {
      model,
      max_tokens: 2048,
      temperature: 1,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userContent }],
    }, meta);

    const text = textFromClaude(data).trim();

    if (!text) return json({ error: "Claude returned no options." }, 502);

    let options: string[];
    try { options = parseJsonOptions(text); }
    catch (e) { return json({ error: `Could not parse options JSON: ${(e as Error).message}` }, 502); }

    if (options.length === 0) return json({ error: "Claude returned an empty options list." }, 502);
    return json({ options });
  } catch (e) {
    console.error("spine-options error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
