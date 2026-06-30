// objective-options — generate wide alternative objectives for one outline slot.
//
// The author has a page whose objective they want to reconsider. This returns 3 genuinely
// different alternatives grounded in the prefix (objectives set before this page) and the spine.
// The author picks one — or discards and keeps what's there.
//
// Two modes:
//   COMMITTED — { bookId, pageId } → prefix built from the real pages table.
//   DRAFT     — { bookId, scaffold, pageIndex } → prefix built from the in-memory scaffold draft
//               (pre-commit, in the ScaffoldGenerator review — those pages have no DB id yet).
//
// Synchronous (short output). Client saves via saveObjective (committed) or patches the draft
// page in place (draft); a committed save marks the beat stale.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { type Brief, briefContext } from "../_shared/brief.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { hasEditAccess } from "../_shared/access.ts";
import { callLLM, textFromLLM, type CallMeta } from "../_shared/llm.ts";
import { getActiveModels } from "../_shared/model-config.ts";
import { parseJsonOptions } from "../_shared/json.ts";


interface PageLite {
  id: number;
  page_index: number;
  page_type: string | null;
  title: string | null;
  metadata: { objective?: string } | null;
}

// A draft (pre-commit) scaffold page from the ScaffoldGenerator review.
interface DraftPage { pageType: "section" | "text"; title?: string; objective?: string }

const SYSTEM = `You are a book architect generating ALTERNATIVE OBJECTIVES for one outline slot.

An OBJECTIVE is 1–2 sentences stating what a page must achieve — its job in the story, not what happens beat-by-beat. The objective is the contract the beat and prose will fulfill.

You will be given the committed objectives for all pages before this slot as the story-so-far context. Use them as the causal foundation — something has to happen here that follows from where the story has arrived.

Generate exactly 3 ALTERNATIVES. Each must:
- Connect causally to the committed prefix (follow "therefore" or "but" from what came before)
- Honor the spine's throughline
- Be GENUINELY DIFFERENT from each other — different angle, direction, or emotional register
- Vary in ambition across the set: one quieter interior move, one larger external turn, one unexpected diagonal

Each option is a clean OBJECTIVE — 1–2 sentences of what the page must achieve. Do NOT label it with the technique ("Unexpected diagonal:", "Plant the mother:", etc.), do NOT add meta-commentary or stage directions, do NOT mention the reader. Just the objective itself.

Output JSON ONLY (no prose, no fences):
{ "options": ["<option 1>", "<option 2>", "<option 3>"] }`;


// Generic shape both sources normalize to, so the prefix prompt is built once.
interface SlotLite { pageType: string | null; title?: string | null; objective?: string }

// Build the story-so-far prefix from the slots BEFORE targetIdx, plus the target's own current
// objective + title. Works for committed pages and the in-memory draft alike.
function prefixContext(slots: SlotLite[], targetIdx: number): { prefix: string; current: string; title: string } {
  const target = slots[targetIdx];
  const prefixLines: string[] = [];
  for (let i = 0; i < targetIdx; i++) {
    const p = slots[i];
    if (p.pageType === "section") {
      prefixLines.push(`# ${p.title || "(untitled section)"}`);
    } else {
      const obj = p.objective?.trim();
      prefixLines.push(`- "${p.title || "(untitled)"}" — ${obj || "(no objective yet)"}`);
    }
  }
  return {
    prefix: prefixLines.join("\n") || "(this is the first page — no preceding objectives)",
    current: target?.objective?.trim() || "",
    title: target?.title?.trim() || "(untitled)",
  };
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

    const { bookId, pageId, scaffold, pageIndex } = (await req.json().catch(() => ({}))) as {
      bookId?: number; pageId?: number; scaffold?: { pages?: DraftPage[] }; pageIndex?: number;
    };
    if (!bookId) return json({ error: "bookId is required" }, 400);
    const draftMode = Array.isArray(scaffold?.pages) && typeof pageIndex === "number";
    if (!draftMode && !pageId) return json({ error: "pageId, or scaffold+pageIndex, are required" }, 400);

    const { data: book, error: bookError } = await userClient
      .from("books").select("id, name, brief, spine, owner_id").eq("id", bookId).single();
    if (bookError || !book) return json({ error: "Book not found" }, 404);

    if (!(await hasEditAccess(userClient, bookId, user.id, book.owner_id)))
      return json({ error: "Access denied" }, 403);

    // Normalize both sources to SlotLite + a target index, then build the prefix the same way.
    let slots: SlotLite[];
    let targetIdx: number;
    if (draftMode) {
      slots = (scaffold!.pages ?? []).map((p) => ({ pageType: p.pageType, title: p.title, objective: p.objective }));
      targetIdx = pageIndex!;
      if (targetIdx < 0 || targetIdx >= slots.length) return json({ error: "pageIndex out of range" }, 400);
    } else {
      const { data: pages } = await userClient.from("pages").select("id, page_index, page_type, title, metadata")
        .eq("book_id", bookId).eq("archived", false).order("page_index", { ascending: true });
      const list = (pages as PageLite[] | null) ?? [];
      targetIdx = list.findIndex((p) => p.id === pageId);
      if (targetIdx === -1) return json({ error: "Page not found in this book" }, 404);
      slots = list.map((p) => ({ pageType: p.page_type, title: p.title, objective: p.metadata?.objective }));
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const brief = book.brief as Brief | null;
    const spine = (book.spine as { text?: string } | null)?.text?.trim() || null;
    const { prefix, current, title } = prefixContext(slots, targetIdx);
    const { high: model } = await getActiveModels();
    const meta: CallMeta = { fn: "objective-options", bookId, userId: user.id };

    const userContent =
      `BOOK: ${book.name}\n\nBRIEF:\n${briefContext(brief)}` +
      (spine ? `\n\nBOOK SPINE (the throughline — alternatives must serve it):\n${spine}` : "") +
      `\n\nOBJECTIVES SO FAR (story-so-far — use as causal foundation):\n${prefix}` +
      `\n\nTHIS SLOT: "${title}"` +
      (current ? `\n\nCURRENT OBJECTIVE (what's there now — vary away from it):\n${current}` : "\n\n(No objective set yet for this slot.)") +
      `\n\nGenerate 3 wide-varying alternatives for this slot. JSON only.`;

    const data = await callLLM(apiKey, {
      model,
      max_tokens: 1024,
      temperature: 1,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userContent }],
    }, meta);

    const text = textFromLLM(data).trim();

    if (!text) return json({ error: "Claude returned no options." }, 502);

    let options: string[];
    try { options = parseJsonOptions(text); }
    catch (e) { return json({ error: `Could not parse options JSON: ${(e as Error).message}` }, 502); }

    if (options.length === 0) return json({ error: "Claude returned an empty options list." }, 502);
    return json({ options });
  } catch (e) {
    console.error("objective-options error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
