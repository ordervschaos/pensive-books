// generate-unit — render prose from an objective, with book context (the "render(objective)
// → prose" step). Synchronous (a paragraph/page is quick), unlike evaluate-book's job.
//
//   client → POST { bookId, pageId, level, objective, ... }
//     → verify edit access
//     → buildUnitContext: book brief (voice) + objective MAP (the arc) + preceding PROSE
//     → Claude → { text }
//
// Context layers (see temp_ai_generation_phase_plan.md):
//   A. brief — the voice contract
//   B. objective map — every page's objective in order (always present, even pre-prose)
//   C. preceding prose — full text of the prior page(s), read from the DB so a sequential
//      cascade ("write all pages") feeds each freshly-written page forward automatically
// (Long-range rolling summary + provenance/reconcile are deferred.)
//
// Needs the ANTHROPIC_API_KEY secret (shared with evaluate-book / generate-scaffold).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const MODEL = "claude-opus-4-7";
const SUMMARY_MODEL = "claude-haiku-4-5-20251001"; // cheap/fast for the per-page "story so far"
const PRECEDING_PAGES = 2; // how many prior text pages of full prose to include for continuity

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface Brief {
  scope?: { band?: string; word_target?: number };
  genre?: string;
  audience?: string;
  premise?: string;
  tone?: string[];
  success_criteria?: string;
}

interface GenerateRequest {
  bookId: number;
  pageId: number;
  level: "paragraph" | "page";
  objective: string;        // the unit's objective (authoritative from the live editor)
  pageObjective?: string;   // parent page objective (paragraph-level context)
  precedingText?: string;   // prose before the unit within the page (paragraph level)
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

    const body = (await req.json().catch(() => ({}))) as Partial<GenerateRequest>;
    const { bookId, pageId, level, objective } = body;
    if (!bookId) return json({ error: "bookId is required" }, 400);
    if (level !== "paragraph" && level !== "page") return json({ error: "level must be 'paragraph' or 'page'" }, 400);
    if (!objective || !objective.trim()) return json({ error: "objective is required" }, 400);

    // Book + access check (owner or accepted collaborator — mirrors evaluate-book).
    const { data: book, error: bookError } = await userClient
      .from("books")
      .select("id, name, subtitle, author, brief, bible, owner_id")
      .eq("id", bookId)
      .single();
    if (bookError || !book) return json({ error: "Book not found" }, 404);

    const { data: access } = await userClient
      .from("book_access")
      .select("id")
      .eq("book_id", bookId)
      .eq("user_id", user.id)
      .eq("status", "accepted")
      .maybeSingle();
    if (book.owner_id !== user.id && !access) return json({ error: "Access denied" }, 403);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const ctx = await buildUnitContext(userClient, bookId, pageId ?? null, level);

    const text = await callClaude(apiKey, {
      brief: book.brief as Brief | null,
      bible: (book.bible as { text?: string } | null)?.text?.trim() || null,
      bookName: book.name,
      level,
      objective: objective.trim(),
      pageObjective: body.pageObjective?.trim() || null,
      precedingText: body.precedingText?.trim() || null,
      objectiveMap: ctx.objectiveMap,
      storySoFar: ctx.storySoFar,
      precedingProse: ctx.precedingProse,
      currentPageLabel: ctx.currentPageLabel,
    });

    // For a generated page, write a cheap one-paragraph summary into pages.metadata.summary
    // — the "story so far" that later pages read for long-range coherence. Best-effort:
    // a summary failure must not fail the generation. Done inline (a page render isn't
    // latency-critical and we want it persisted before the next cascade step).
    if (level === "page" && pageId) {
      try {
        const summary = await summarize(apiKey, text);
        if (summary) await persistSummary(userClient, pageId, summary);
      } catch (e) {
        console.error("generate-unit: summary step failed (non-fatal):", e);
      }
    }

    return json({ text });
  } catch (e) {
    console.error("generate-unit error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});

// ── Context assembly ─────────────────────────────────────────────────────────
interface PageLite {
  id: number;
  page_index: number;
  page_type: string | null;
  title: string | null;
  metadata: { objective?: string; summary?: string } | null;
}

async function buildUnitContext(
  client: SupabaseClient,
  bookId: number,
  pageId: number | null,
  level: "paragraph" | "page"
): Promise<{ objectiveMap: string; storySoFar: string | null; precedingProse: string | null; currentPageLabel: string | null }> {
  // B. The objective map — lightweight (no content), the whole arc in order.
  const { data: pages } = await client
    .from("pages")
    .select("id, page_index, page_type, title, metadata")
    .eq("book_id", bookId)
    .eq("archived", false)
    .order("page_index", { ascending: true });

  const list = (pages as PageLite[] | null) ?? [];
  const current = pageId != null ? list.find((p) => p.id === pageId) ?? null : null;

  const objectiveMap = list
    .map((p) => {
      const obj = p.metadata?.objective?.trim();
      const here = current && p.id === current.id ? "  ← you are here" : "";
      if (p.page_type === "section") return `\n# ${p.title || "(untitled section)"}${obj ? ` — ${obj}` : ""}${here}`;
      return `- "${p.title || "(untitled)"}"${obj ? ` — ${obj}` : ""}${here}`;
    })
    .join("\n");

  const currentPageLabel = current ? `"${current.title || "(untitled)"}"` : null;

  // C. Preceding prose — full text of the prior text pages, read fresh from the DB so a
  // sequential cascade picks up pages written moments earlier. Page level only; paragraph
  // level uses the client-supplied precedingText (prose earlier within the same page).
  let precedingProse: string | null = null;
  let storySoFar: string | null = null;
  if (level === "page" && current) {
    const priorText = list.filter((p) => p.page_type === "text" && p.page_index < current.page_index);

    // D. Story so far — summaries of pages BEFORE the full-prose window, so a long book
    // stays coherent without resending all prior prose. (Summaries are written after each
    // page is generated; see persistSummary.)
    const summarized = priorText.slice(0, Math.max(0, priorText.length - PRECEDING_PAGES));
    const soFar = summarized
      .map((p) => p.metadata?.summary?.trim())
      .filter((s): s is string => !!s);
    storySoFar = soFar.length ? soFar.join("\n") : null;

    const priorIds = priorText.slice(-PRECEDING_PAGES).map((p) => p.id);
    if (priorIds.length) {
      const { data: priorPages } = await client
        .from("pages")
        .select("id, page_index, title, content")
        .in("id", priorIds)
        .order("page_index", { ascending: true });
      const chunks = ((priorPages as Array<{ title: string | null; content: unknown }> | null) ?? [])
        .map((p) => {
          const t = tiptapToText(p.content).trim();
          return t ? `### ${p.title || "(untitled)"}\n${t}` : "";
        })
        .filter(Boolean);
      precedingProse = chunks.length ? chunks.join("\n\n") : null;
    }
  }

  return { objectiveMap, storySoFar, precedingProse, currentPageLabel };
}

function tiptapToText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === "text") return n.text ?? "";
  if (n.type === "hardBreak") return "\n";
  let out = "";
  for (const child of n.content ?? []) out += tiptapToText(child);
  if (["paragraph", "heading", "blockquote", "listItem", "codeBlock"].includes(n.type ?? "")) out += "\n\n";
  return out;
}

// ── Prompt assembly ──────────────────────────────────────────────────────────
const SYSTEM = `You are a skilled prose writer helping an author render their book.
The author works in OBJECTIVES: a short statement of what a unit of the book must achieve.
Your job is to write the prose that achieves the given objective, in the book's voice and
consistent with the rest of the book.

Rules:
- Write ONLY the prose. No preamble, no headings, no markdown fences, no meta commentary.
- Honor the book's brief — genre, audience, tone, premise — as the voice contract.
- Stay consistent with the outline and the preceding prose: continue naturally, keep names,
  facts, and tone consistent, and don't repeat what's already been written.
- Serve the objective precisely; do not wander beyond what it asks.
- Match the requested length: a single paragraph means ONE paragraph.`;

function briefContext(brief: Brief | null): string {
  if (!brief) return "(no brief set — infer a sensible neutral voice)";
  const lines: string[] = [];
  if (brief.scope?.band) lines.push(`- Scope: ${brief.scope.band}`);
  if (brief.genre) lines.push(`- Genre: ${brief.genre}`);
  if (brief.audience) lines.push(`- Audience: ${brief.audience}`);
  if (brief.premise) lines.push(`- Premise: ${brief.premise}`);
  if (brief.tone?.length) lines.push(`- Tone: ${brief.tone.join(", ")}`);
  if (brief.success_criteria) lines.push(`- Success looks like: ${brief.success_criteria}`);
  return lines.length ? lines.join("\n") : "(brief is empty — infer a sensible neutral voice)";
}

interface PromptArgs {
  brief: Brief | null;
  bible: string | null;
  bookName: string;
  level: "paragraph" | "page";
  objective: string;
  pageObjective: string | null;
  precedingText: string | null;
  objectiveMap: string;
  storySoFar: string | null;
  precedingProse: string | null;
  currentPageLabel: string | null;
}

// The stable, per-book prefix (brief + outline) — cached so a cascade of many page
// renders reuses it cheaply. Does not include the moving parts (which page, preceding prose).
function stablePrefix(args: PromptArgs): string {
  return [
    `BOOK: ${args.bookName}`,
    `\nBRIEF (the voice contract):\n${briefContext(args.brief)}`,
    args.bible ? `\nBOOK BIBLE (established facts — characters, world, style; stay strictly consistent):\n${args.bible}` : "",
    args.objectiveMap ? `\nOUTLINE (the book's pages and their objectives, in order):\n${args.objectiveMap}` : "",
  ].filter(Boolean).join("\n");
}

// The variable part — what changes per unit.
function variablePart(args: PromptArgs): string {
  const parts: string[] = [];
  if (args.storySoFar) {
    parts.push(`STORY SO FAR (summaries of earlier pages, for continuity):\n${args.storySoFar}`);
  }
  if (args.precedingProse) {
    parts.push(`PRECEDING PROSE (the pages just before this one — continue from here, don't repeat):\n"""\n${args.precedingProse}\n"""`);
  }
  if (args.level === "paragraph") {
    if (args.pageObjective) parts.push(`This paragraph sits on a page whose objective is: ${args.pageObjective}`);
    if (args.precedingText) parts.push(`The prose immediately before this paragraph (continue naturally):\n"""\n${args.precedingText}\n"""`);
    parts.push(`\nWrite ONE paragraph that achieves this objective:\n${args.objective}`);
  } else {
    const where = args.currentPageLabel ? ` for the page ${args.currentPageLabel}` : "";
    parts.push(`\nWrite the prose${where} that achieves this objective (multiple paragraphs as needed):\n${args.objective}`);
  }
  return parts.join("\n\n");
}

// ── Claude call ──────────────────────────────────────────────────────────────
async function callClaude(apiKey: string, args: PromptArgs): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: args.level === "page" ? 4000 : 600,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: [
            // Stable per-book prefix → cached, so a "write all pages" cascade is cheap.
            { type: "text", text: stablePrefix(args), cache_control: { type: "ephemeral" } },
            { type: "text", text: variablePart(args) },
          ],
        },
      ],
    }),
  });

  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 500)}`);

  const data = await res.json();
  const text = (data.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("")
    .trim();
  if (!text) throw new Error("Claude returned no text content.");
  return text;
}

// ── Summary (layer D) ────────────────────────────────────────────────────────
// One cheap Haiku call to compress a page's prose into a couple of sentences of plot/
// state — what later pages need for continuity without resending full prose.
async function summarize(apiKey: string, prose: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: SUMMARY_MODEL,
      max_tokens: 250,
      system: [{
        type: "text",
        text: "Summarize this page of a book in 1-2 sentences: what happens and any new facts (characters, places, changes in state) a later page would need to stay consistent. Plain text only, no preamble.",
        cache_control: { type: "ephemeral" },
      }],
      messages: [{ role: "user", content: prose.slice(0, 12000) }],
    }),
  });
  if (!res.ok) throw new Error(`summary API ${res.status}`);
  const data = await res.json();
  return (data.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("")
    .trim();
}

// Merge the summary into pages.metadata (preserving objective). Uses the caller's client
// (RLS-allowed since they can edit the book).
async function persistSummary(client: SupabaseClient, pageId: number, summary: string) {
  const { data } = await client.from("pages").select("metadata").eq("id", pageId).maybeSingle();
  const metadata = { ...((data?.metadata as Record<string, unknown> | null) ?? {}), summary };
  await client.from("pages").update({ metadata }).eq("id", pageId);
}
