// generate-voice — propose 3 candidate VOICE SAMPLES for a book (the prose-voice picker, gate 4).
//
// Style instructions don't produce a voice; an EXEMPLAR does. This drafts three short passages
// (~300–450 words) that each demonstrate a distinct, committed take on the book's voice — from the
// brief and spine. The author picks one; the client saves it to books.bible.voice_sample,
// and every prose render then carries it as a few-shot anchor in the cached stable prefix
// (generate-unit-core.stablePrefix). Few-shot voice anchoring is the single biggest lever against
// the "this reads like AI" tell.
//
//   client → POST { bookId }
//     → verify edit access
//     → INSERT book_generations { kind:'voice', status:'running' }   ← returned in ~1s
//     → background: Claude → UPDATE row { status:'ready', result:{ samples:[...] } }
//     → client watches book_generations via Realtime, shows the picker
//
// Needs the ANTHROPIC_API_KEY secret (shared with the other AI steps).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { runInBackground, serviceClient } from "../_shared/task.ts";
import { callClaude as callClaudeApi, type CallMeta } from "../_shared/claude.ts";
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

    const { data: access } = await userClient
      .from("book_access").select("id").eq("book_id", bookId).eq("user_id", user.id).eq("status", "accepted").maybeSingle();
    if (book.owner_id !== user.id && !access) return json({ error: "Access denied" }, 403);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const bookName = book.name as string;
    const brief = book.brief as Brief | null;
    const spine = (book.spine as { text?: string } | null)?.text?.trim() || null;

    const service = serviceClient();
    const { data: gen, error: insertError } = await service
      .from("book_generations")
      .insert({ book_id: bookId, created_by: user.id, kind: "voice", scope: "book", status: "running", input: {} })
      .select()
      .single();
    if (insertError || !gen) return json({ error: "Could not start voice samples" }, 500);

    runInBackground(service, "book_generations", gen.id, "generate-voice", async () => {
      const samples = await draftVoiceSamples(apiKey, bookName, brief, spine, { fn: "generate-voice", bookId, taskTable: "book_generations", taskId: gen.id, userId: user.id });
      return { status: "ready", result: { samples } };
    });

    return json({ status: "running", generation: gen }, 202);
  } catch (e) {
    console.error("generate-voice error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});

// ── Prompt ───────────────────────────────────────────────────────────────────
const SYSTEM = `You are a literary stylist. From a book's brief and spine, write THREE distinct candidate VOICE SAMPLES — short passages of finished prose that each commit to a different, specific take on how this book could sound. The author will pick one to anchor the whole book's voice.

Each sample:
- 300–450 words of actual PROSE from somewhere in the book (an opening, a charged moment) — not a description of the voice, the voice itself.
- A DISTINCT register from the other two (e.g. spare vs. lush; wry vs. earnest; close-third vs. first-person) so the choice is real.
- True to the genre, audience, and tone in the brief.
- Voice-forward: rhythm, diction, sentence shapes, restraint. Show range within a committed style.
- NO clichés or AI tells ("a testament to", "in a world where", "little did they know", "sent shivers down", "couldn't help but", tidy moral endings).

Output using XML tags ONLY (no other text), exactly:
<samples>
<sample>PASSAGE 1</sample>
<sample>PASSAGE 2</sample>
<sample>PASSAGE 3</sample>
</samples>`;

function briefContext(brief: Brief | null): string {
  if (!brief) return "(no brief set — infer a sensible literary voice from a neutral premise)";
  const lines: string[] = [];
  if (brief.scope?.band) lines.push(`- Scope: ${brief.scope.band}`);
  if (brief.genre) lines.push(`- Genre: ${brief.genre}`);
  if (brief.audience) lines.push(`- Audience: ${brief.audience}`);
  if (brief.premise) lines.push(`- Premise: ${brief.premise}`);
  if (brief.tone?.length) lines.push(`- Tone: ${brief.tone.join(", ")}`);
  return lines.length ? lines.join("\n") : "(brief is empty — infer a sensible literary voice)";
}

async function draftVoiceSamples(apiKey: string, bookName: string, brief: Brief | null, spine: string | null, meta: CallMeta): Promise<string[]> {
  const { high: model } = await getActiveModels();
  const data = await callClaudeApi(apiKey, {
    model,
    max_tokens: 4000,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{
      role: "user",
      content: `BOOK: ${bookName}` +
        (spine ? `\n\nSPINE (the throughline):\n${spine}` : "") +
        `\n\nBRIEF:\n${briefContext(brief)}` +
        `\n\nWrite the three voice samples. JSON only.`,
    }],
  }, meta);

  const text = (data.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("")
    .trim();
  if (!text) throw new Error("Claude returned no voice samples.");
  return parseSamples(text);
}

function parseSamples(text: string): string[] {
  // Primary: XML tag format — prose can contain quotes without escaping issues
  const xmlMatches = [...text.matchAll(/<sample>([\s\S]*?)<\/sample>/g)];
  if (xmlMatches.length > 0) {
    const samples = xmlMatches.map((m) => m[1].trim()).filter((s) => s.length > 0);
    if (samples.length > 0) return samples.slice(0, 3);
  }

  // Fallback: JSON (handles responses from before the prompt change)
  let raw = text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  else {
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first !== -1 && last > first) raw = raw.slice(first, last + 1);
  }
  try {
    const parsed = JSON.parse(raw) as { samples?: unknown };
    const samples = Array.isArray(parsed.samples)
      ? parsed.samples.map((s) => String(s ?? "").trim()).filter((s) => s.length > 0)
      : [];
    if (samples.length > 0) return samples.slice(0, 3);
  } catch (_e) {
    // fall through to final error
  }

  throw new Error("Could not parse voice samples from Claude response.");
}
