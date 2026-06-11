// objective-options — generate wide alternative objectives for one outline slot.
//
// The author has a page whose objective they want to reconsider. This returns 3 genuinely
// different alternatives grounded in the committed prefix (objectives already set before this
// page) and the spine. The author picks one — or discards and keeps what's there.
//
//   client → POST { bookId, pageId }
//     → verify edit access
//     → read spine + brief + all pages in order
//     → build prefix (objectives before this slot) + current objective
//     → Claude generates 3 wide-varying alternatives
//     → { options: string[] }
//
// Synchronous (short output). Client saves via saveObjective on pick, which marks the beat stale.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { callClaude, type CallMeta } from "../_shared/claude.ts";
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

interface PageLite {
  id: number;
  page_index: number;
  page_type: string | null;
  title: string | null;
  metadata: { objective?: string } | null;
}

const SYSTEM = `You are a book architect generating ALTERNATIVE OBJECTIVES for one outline slot.

An OBJECTIVE is 1–2 sentences stating what a page must achieve — its job in the story, not what happens beat-by-beat. The objective is the contract the beat and prose will fulfill.

You will be given the committed objectives for all pages before this slot as the story-so-far context. Use them as the causal foundation — something has to happen here that follows from where the story has arrived.

Generate exactly 3 ALTERNATIVES. Each must:
- Connect causally to the committed prefix (follow "therefore" or "but" from what came before)
- Honor the spine's throughline
- Be GENUINELY DIFFERENT from each other — different angle, direction, or emotional register
- Vary in ambition: one quieter interior move, one larger external turn, one unexpected diagonal

Output JSON ONLY (no prose, no fences):
{ "options": ["<option 1>", "<option 2>", "<option 3>"] }`;

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

function prefixContext(pages: PageLite[], targetId: number): { prefix: string; current: string; title: string } {
  const targetIdx = pages.findIndex((p) => p.id === targetId);
  const target = pages[targetIdx];

  const prefixLines: string[] = [];
  for (let i = 0; i < targetIdx; i++) {
    const p = pages[i];
    if (p.page_type === "section") {
      prefixLines.push(`# ${p.title || "(untitled section)"}`);
    } else {
      const obj = p.metadata?.objective?.trim();
      if (obj) prefixLines.push(`- "${p.title || "(untitled)"}" — ${obj}`);
      else prefixLines.push(`- "${p.title || "(untitled)"}" — (no objective yet)`);
    }
  }

  return {
    prefix: prefixLines.join("\n") || "(this is the first page — no preceding objectives)",
    current: target?.metadata?.objective?.trim() || "",
    title: target?.title?.trim() || "(untitled)",
  };
}

function parseOptions(text: string): string[] {
  let raw = text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  else {
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first !== -1 && last > first) raw = raw.slice(first, last + 1);
  }
  const parsed = JSON.parse(raw);
  const arr: unknown[] = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.options) ? parsed.options : []);
  return arr.map((s) => String(s).trim()).filter(Boolean);
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

    const { bookId, pageId } = (await req.json().catch(() => ({}))) as { bookId?: number; pageId?: number };
    if (!bookId || !pageId) return json({ error: "bookId and pageId are required" }, 400);

    const [{ data: book, error: bookError }, { data: pages }] = await Promise.all([
      userClient.from("books").select("id, name, brief, spine, owner_id").eq("id", bookId).single(),
      userClient.from("pages").select("id, page_index, page_type, title, metadata")
        .eq("book_id", bookId).eq("archived", false).order("page_index", { ascending: true }),
    ]);
    if (bookError || !book) return json({ error: "Book not found" }, 404);

    const { data: access } = await userClient
      .from("book_access").select("id").eq("book_id", bookId).eq("user_id", user.id).eq("status", "accepted").maybeSingle();
    if (book.owner_id !== user.id && !access) return json({ error: "Access denied" }, 403);

    const list = (pages as PageLite[] | null) ?? [];
    if (!list.find((p) => p.id === pageId)) return json({ error: "Page not found in this book" }, 404);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const brief = book.brief as Brief | null;
    const spine = (book.spine as { text?: string } | null)?.text?.trim() || null;
    const { prefix, current, title } = prefixContext(list, pageId);
    const { high: model } = await getActiveModels();
    const meta: CallMeta = { fn: "objective-options", bookId, userId: user.id };

    const userContent =
      `BOOK: ${book.name}\n\nBRIEF:\n${briefContext(brief)}` +
      (spine ? `\n\nBOOK SPINE (the throughline — alternatives must serve it):\n${spine}` : "") +
      `\n\nCOMMITTED OBJECTIVES (story-so-far — use as causal foundation):\n${prefix}` +
      `\n\nTHIS SLOT: "${title}"` +
      (current ? `\n\nCURRENT OBJECTIVE (what's there now — vary away from it):\n${current}` : "\n\n(No objective set yet for this slot.)") +
      `\n\nGenerate 3 wide-varying alternatives for this slot. JSON only.`;

    const data = await callClaude(apiKey, {
      model,
      max_tokens: 1024,
      temperature: 1,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userContent }],
    }, meta);

    const text = ((data.content ?? []) as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();

    if (!text) return json({ error: "Claude returned no options." }, 502);

    let options: string[];
    try { options = parseOptions(text); }
    catch (e) { return json({ error: `Could not parse options JSON: ${(e as Error).message}` }, 502); }

    if (options.length === 0) return json({ error: "Claude returned an empty options list." }, 502);
    return json({ options });
  } catch (e) {
    console.error("objective-options error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
