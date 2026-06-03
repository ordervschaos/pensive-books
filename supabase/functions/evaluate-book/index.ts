// evaluate-book — "The editor's read".
//
// Runs a developmental fiction edit against the embedded rubric using Claude, and
// stores the result in book_evaluations. Long job (~30-90s), so it returns a
// `pending` row immediately and finishes in the background (EdgeRuntime.waitUntil):
//
//   client → POST { bookId }
//     → verify caller can edit the book
//     → INSERT book_evaluations row (status:'pending')   ← returned in ~1s
//     → background: fetch manuscript → Claude → UPDATE row (status:'done'|'error')
//     → client learns via Realtime on book_evaluations
//
// Needs the ANTHROPIC_API_KEY secret:  supabase secrets set ANTHROPIC_API_KEY=...
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { EDITOR_STANCE, FICTION_RUBRIC } from "./rubric.ts";
import { captureException, isBillingError } from "../_shared/sentry.ts";

const MODEL = "claude-opus-4-8";

// ── Map-reduce taxonomy ──────────────────────────────────────────────────────
// A 50+ page book needs a ~9k-token report; generating that in ONE call takes ~150s and collides
// with the Supabase worker wall-clock. We split the REPORT (not the book) across calls that each
// read the WHOLE manuscript — so no global judgment (arc, payoff, obligatory scenes) is ever made
// on a partial book — and each emits only a slice of the report (~2-3k tokens, ~50s). They run in
// parallel; a final verdict call synthesizes from their findings. See temp_editor_read_mapreduce.md.
const SECTION_TITLES: Record<string, string> = {
  character: "Character",
  plot: "Plot",
  pacing: "Pacing",
  dialogue: "Dialogue",
  prose: "Prose & Style",
  genre_contract: "Genre Contract",
  world_building: "World-Building",
  resonance: "Emotional & Thematic Resonance",
  mechanics: "Presentation & Mechanics",
};
// Three parallel groups. Each call reads the whole book but only writes these dimensions.
const GROUPS: { name: string; sections: string[] }[] = [
  { name: "story", sections: ["character", "plot", "pacing"] },
  { name: "craft", sections: ["dialogue", "prose"] },
  { name: "whole", sections: ["genre_contract", "world_building", "resonance", "mechanics"] },
];
// Final display order, regardless of which group produced each section.
const CANONICAL_ORDER = [
  "character", "plot", "pacing", "dialogue", "prose",
  "genre_contract", "world_building", "resonance", "mechanics",
];
// world_building is only meaningful for speculative/historical work; triage decides.
// brief.scope.band values that mean non-fiction (mirrors apps/web/src/lib/brief.ts).
const NONFICTION_BANDS = new Set(["essay", "guide", "nonfiction_book", "comprehensive"]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

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

    const { bookId } = await req.json().catch(() => ({}));
    if (!bookId) return json({ error: "bookId is required" }, 400);

    // Book + access check (owner or accepted collaborator).
    const { data: book, error: bookError } = await userClient
      .from("books")
      .select("id, name, subtitle, author, brief, owner_id")
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

    // Fiction only for now — refuse non-fiction by the brief's scope band.
    const band = (book.brief as Brief | null)?.scope?.band;
    if (band && NONFICTION_BANDS.has(band)) {
      return json({ error: "The non-fiction rubric isn't available yet." }, 400);
    }

    // Service-role client for writes + manuscript read (bypasses RLS; reliable in background).
    const service = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const { data: evalRow, error: insertError } = await service
      .from("book_evaluations")
      .insert({
        book_id: book.id,
        created_by: user.id,
        kind: "fiction",
        model: MODEL,
        status: "pending",
        brief_snapshot: book.brief ?? null,
      })
      .select()
      .single();
    if (insertError || !evalRow) return json({ error: "Could not start evaluation" }, 500);

    // Hand the slow work to the background; respond now with the pending row.
    const work = runEvaluation(service, apiKey, evalRow.id, book);
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work);

    return json({ status: "pending", evaluation: evalRow }, 202);
  } catch (e) {
    console.error("evaluate-book error:", e);
    return json({ error: "Internal server error" }, 500);
  }
});

interface Brief {
  scope?: { band?: string; word_target?: number };
  genre?: string;
  audience?: string;
  premise?: string;
  tone?: string[];
  success_criteria?: string;
}
interface BookRow {
  id: number;
  name: string;
  subtitle: string | null;
  author: string | null;
  brief: Brief | null;
}

async function runEvaluation(
  service: ReturnType<typeof createClient>,
  apiKey: string,
  evalId: number,
  book: BookRow
) {
  try {
    const { data: pages, error: pagesError } = await service
      .from("pages")
      .select("id, title, content, html_content, page_index, page_type")
      .eq("book_id", book.id)
      .eq("archived", false)
      .order("page_index", { ascending: true });
    if (pagesError) throw new Error(`fetch pages: ${pagesError.message}`);
    if (!pages || pages.length === 0) throw new Error("Book has no pages to evaluate.");

    const { manuscript, wordCount } = buildManuscript(book, pages);
    const result = await evaluateMapReduce(apiKey, book, manuscript);

    const { error: updateError } = await service
      .from("book_evaluations")
      .update({ status: "done", result, word_count: wordCount })
      .eq("id", evalId);
    if (updateError) throw new Error(`save result: ${updateError.message}`);
  } catch (e) {
    console.error(`evaluate-book run ${evalId} failed:`, e);
    const billing = isBillingError(e);
    await captureException(e, { function: "evaluate-book", book_id: String(book.id), billing: String(billing) });
    const userMsg = billing
      ? "AI credits exhausted — the team has been notified."
      : String((e as Error)?.message ?? e).slice(0, 1000);
    await service
      .from("book_evaluations")
      .update({ status: "error", error: userMsg })
      .eq("id", evalId);
  }
}

// ── Manuscript assembly ──────────────────────────────────────────────────────
function buildManuscript(book: BookRow, pages: PageRow[]) {
  const head = [
    `TITLE: ${book.name}${book.subtitle ? ` — ${book.subtitle}` : ""}`,
    book.author ? `AUTHOR: ${book.author}` : null,
    briefContext(book.brief),
    "",
    "MANUSCRIPT (each page is marked with its real id — cite issues using ONLY these ids):",
  ].filter(Boolean).join("\n");

  let wordCount = 0;
  const body = pages
    .map((p) => {
      const text = pageText(p);
      wordCount += countWords(text);
      const kind = p.page_type === "section" ? " (section divider)" : "";
      return `\n[id=${p.id} · #${p.page_index} · "${p.title ?? "Untitled"}"${kind}]\n${text}`;
    })
    .join("\n");

  return { manuscript: `${head}\n${body}`, wordCount };
}

function briefContext(brief: Brief | null): string | null {
  if (!brief) return null;
  const lines: string[] = ["AUTHOR'S BRIEF (the contract to judge against):"];
  const b = brief.scope?.band;
  const wt = brief.scope?.word_target;
  if (b || wt) lines.push(`- Scope: ${[b, wt ? `≈${wt.toLocaleString()} words` : null].filter(Boolean).join(" · ")}`);
  if (brief.genre) lines.push(`- Genre: ${brief.genre}`);
  if (brief.audience) lines.push(`- Audience: ${brief.audience}`);
  if (brief.premise) lines.push(`- Premise: ${brief.premise}`);
  if (brief.tone?.length) lines.push(`- Tone: ${brief.tone.join(", ")}`);
  if (brief.success_criteria) lines.push(`- Success looks like: ${brief.success_criteria}`);
  return lines.length > 1 ? lines.join("\n") : null;
}

interface PageRow {
  id: number;
  title: string | null;
  content: unknown;
  html_content: string | null;
  page_index: number;
  page_type: string | null;
}

// Tiptap JSON → plain text, with html_content as fallback.
function pageText(p: PageRow): string {
  const fromJson = tiptapToText(p.content).trim();
  if (fromJson) return fromJson;
  if (p.html_content) return p.html_content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return "";
}

function tiptapToText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === "text") return n.text ?? "";
  if (n.type === "hardBreak") return "\n";
  let out = "";
  for (const child of n.content ?? []) out += tiptapToText(child);
  if (["paragraph", "heading", "blockquote", "listItem", "codeBlock"].includes(n.type ?? "")) {
    out += "\n\n";
  }
  return out;
}

function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

// ── Map-reduce evaluation ────────────────────────────────────────────────────
interface Triage { genre_contract: string; premise: string; is_speculative: boolean }
interface Section {
  id: string; title: string; stance: string; assessment: string;
  strengths?: string[]; issues?: unknown[];
}

// Orchestrator: triage (warms the manuscript cache) → 3 parallel dimension groups (read the warm
// cache) → verdict synthesized from their findings. Phases are sequential but the expensive middle
// runs in parallel, so wall-clock ≈ triage + slowest group + verdict (~120s), under the worker cap.
async function evaluateMapReduce(apiKey: string, book: BookRow, manuscript: string) {
  // Identical cached prefix for triage + every group → the manuscript is encoded & billed once,
  // then read from cache by the rest. EDITOR_STANCE+RUBRIC are stable across books (outer cache);
  // the manuscript is stable across this eval's calls (inner cache).
  const sharedSystem = [
    { type: "text", text: EDITOR_STANCE },
    { type: "text", text: FICTION_RUBRIC, cache_control: { type: "ephemeral" } },
    { type: "text", text: manuscript, cache_control: { type: "ephemeral" } },
  ];

  // Phase 1 — triage. Runs first (alone) so it WRITES the manuscript cache the parallel groups
  // then read; also fixes one genre contract they all judge against. Billing failures surface here.
  const triage = await runTriage(apiKey, sharedSystem);

  // Phase 2 — the three dimension groups, in parallel. Each reads the whole book (warm cache) and
  // emits only its slice of the report. allSettled so one bad group degrades to a partial report.
  const settled = await Promise.allSettled(
    GROUPS.map((g) => runGroup(apiKey, sharedSystem, g, triage))
  );
  const sections: Section[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") sections.push(...r.value);
    else await captureException(r.reason, { function: "evaluate-book", phase: "group" });
  }
  if (sections.length === 0) {
    // Re-throw a real rejection (keeps the billing tag) rather than a generic message.
    const firstErr = settled.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    throw firstErr?.reason instanceof Error ? firstErr.reason : new Error("All evaluation passes failed.");
  }

  // Drop World-Building unless the book is speculative/historical; order for display.
  const ordered = sections
    .filter((s) => CANONICAL_ORDER.includes(s.id) && (s.id !== "world_building" || triage.is_speculative))
    .sort((a, b) => CANONICAL_ORDER.indexOf(a.id) - CANONICAL_ORDER.indexOf(b.id));

  // Phase 3 — verdict from the findings (no manuscript needed). Non-fatal: groups already
  // succeeded, so a verdict hiccup falls back to a synthesized stub rather than losing the report.
  let verdict;
  try {
    verdict = await runVerdict(apiKey, book, ordered, triage);
  } catch (e) {
    await captureException(e, { function: "evaluate-book", phase: "verdict" });
    verdict = fallbackVerdict(ordered, triage);
  }

  return { verdict, sections: ordered };
}

async function runTriage(apiKey: string, system: unknown[]): Promise<Triage> {
  const text = await anthropicCall(apiKey, {
    system,
    user:
      `You have the full manuscript above. In one pass, identify the book's genre contract so the ` +
      `detailed evaluation can judge against it.\n\nOutput ONLY this JSON (no prose, no fences):\n` +
      `{ "genre_contract": "<the contract: category + what it promises the reader; if an author ` +
      `brief is given treat it as the contract, else infer and say you inferred it>", "premise": ` +
      `"<one-sentence premise>", "is_speculative": <true if speculative/historical (fantasy, SF, ` +
      `historical, magical realism) so World-Building applies, else false> }`,
    maxTokens: 1500,
    effort: "low",
    timeoutMs: 45_000,
  });
  const t = extractJSON(text) as Partial<Triage>;
  return {
    genre_contract: String(t.genre_contract ?? "unspecified"),
    premise: String(t.premise ?? ""),
    is_speculative: Boolean(t.is_speculative),
  };
}

async function runGroup(
  apiKey: string,
  system: unknown[],
  group: { name: string; sections: string[] },
  triage: Triage
): Promise<Section[]> {
  const ids = group.sections.filter((id) => id !== "world_building" || triage.is_speculative);
  const menu = ids.map((id) => `${id} ("${SECTION_TITLES[id]}")`).join(", ");
  const text = await anthropicCall(apiKey, {
    system,
    user:
      `You have read the full manuscript above. The genre contract (already identified) is: ` +
      `"${triage.genre_contract}". Judge against it.\n\n` +
      `Evaluate ONLY these dimensions, using the matching rubric sections: ${menu}.\n\n` +
      `Output ONLY this JSON (no prose, no fences):\n` +
      `{ "sections": [ { "id": "<one of: ${ids.join(" | ")}>", "title": "<human title>", ` +
      `"stance": "strong | solid | needs work", "assessment": "<the editor's read of this ` +
      `dimension, in prose>", "strengths": ["<evidence-backed positive>"], "issues": [ { ` +
      `"severity": "high | medium | low", "note": "<the problem>", "evidence": "<exact quote or ` +
      `specific moment>", "suggestion": "<concrete revision>", "page_ref": { "id": <real page id>, ` +
      `"title": "<page title>", "index": <page_index> } } ] } ] }\n\n` +
      `One object per dimension above. Every issue needs evidence and a suggestion. page_ref uses a ` +
      `REAL id= from the manuscript, or null for whole-book issues. Severity reflects reader impact.`,
    maxTokens: 12000,
    effort: "medium",
    timeoutMs: 105_000,
  });
  const parsed = extractJSON(text) as { sections?: Section[] };
  if (!Array.isArray(parsed.sections)) throw new Error(`group ${group.name}: no sections array`);
  // Trust only the ids this group owns; backfill the canonical title.
  return parsed.sections
    .filter((s) => s && ids.includes(s.id))
    .map((s) => ({ ...s, title: SECTION_TITLES[s.id] ?? s.title }));
}

async function runVerdict(apiKey: string, book: BookRow, sections: Section[], triage: Triage) {
  // Feed only the digested findings (not the prose) so this call is small and fast.
  const lite = sections.map((s) => ({
    id: s.id,
    stance: s.stance,
    assessment: s.assessment,
    issues: (s.issues as { severity?: string; note?: string }[] | undefined)?.map((i) => ({
      severity: i.severity,
      note: i.note,
    })),
  }));
  const text = await anthropicCall(apiKey, {
    system: [{ type: "text", text: EDITOR_STANCE }],
    user:
      `You are writing the top-level verdict of an editor's read of "${book.name}". The per-dimension ` +
      `findings are already produced (genre contract: "${triage.genre_contract}"; premise: ` +
      `"${triage.premise}").\n\nFINDINGS:\n${JSON.stringify(lite)}\n\n` +
      `Synthesize the holistic verdict — weigh the dimensions against each other and pick the ` +
      `highest-leverage fixes. Output ONLY this JSON (no prose, no fences):\n` +
      `{ "genre_contract": "<the contract, refined>", "stance": "<short holistic label, e.g. ` +
      `'promising premise, early draft — structural revision before line polish'>", "letter": ` +
      `"<2-4 sentence editorial letter: what the book is, its core strength, its most urgent ` +
      `problem>", "priorities": ["<highest-leverage fix>", "<next>", "<next>"] }`,
    maxTokens: 3500,
    effort: "medium",
    timeoutMs: 55_000,
  });
  const v = extractJSON(text) as Record<string, unknown>;
  if (!v.letter && !Array.isArray(v.priorities)) throw new Error("verdict: missing letter/priorities");
  return {
    genre_contract: String(v.genre_contract ?? triage.genre_contract),
    stance: String(v.stance ?? ""),
    letter: String(v.letter ?? ""),
    priorities: Array.isArray(v.priorities) ? v.priorities.map(String) : [],
  };
}

// If the verdict call fails after the groups succeeded, build a usable stub from the sections so
// the author still gets the full section-by-section read instead of a hard failure.
function fallbackVerdict(sections: Section[], triage: Triage) {
  const worst = sections.some((s) => s.stance === "needs work")
    ? "needs work"
    : sections.some((s) => s.stance === "solid") ? "solid" : "strong";
  const priorities = sections
    .flatMap((s) => (s.issues as { severity?: string; note?: string }[] | undefined) ?? [])
    .filter((i) => i.severity === "high")
    .slice(0, 3)
    .map((i) => i.note ?? "")
    .filter(Boolean);
  return {
    genre_contract: triage.genre_contract,
    stance: `Overall: ${worst} — see the section notes below.`,
    letter: "The section-by-section read is below. (Automated top-level synthesis was unavailable for this run.)",
    priorities,
  };
}

// ── Anthropic plumbing ───────────────────────────────────────────────────────
async function anthropicCall(
  apiKey: string,
  opts: { system: unknown[]; user: string; maxTokens: number; effort: string; timeoutMs: number }
): Promise<string> {
  // AbortSignal so a hung/slow call rejects in time for the orchestrator's catch to record it —
  // never let a call outlive the Supabase worker silently (the old "stuck pending forever" bug).
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: AbortSignal.timeout(opts.timeoutMs),
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: opts.maxTokens,
      thinking: { type: "adaptive" }, // Opus 4.8: adaptive thinking; effort controls depth
      output_config: { effort: opts.effort }, // top-level field; budget_tokens is rejected here
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    let parsed: { error?: { message?: string } } = {};
    try { parsed = JSON.parse(body); } catch { /* ignore */ }
    const msg = parsed.error?.message ?? body;
    const err = new Error(`Claude API ${res.status}: ${msg.slice(0, 500)}`);
    if (parsed.error?.message?.toLowerCase().includes("credit balance")) (err as Error & { billing?: boolean }).billing = true;
    throw err;
  }

  const data = await res.json();
  const text = (data.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("")
    .trim();
  if (!text) throw new Error("Claude returned no text content.");
  return text;
}

// Defensive parse — strip fences / slice to the outermost object, then JSON.parse.
function extractJSON(text: string): unknown {
  let raw = text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  else {
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first !== -1 && last > first) raw = raw.slice(first, last + 1);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Could not parse model output as JSON: ${(e as Error).message}`);
  }
}
