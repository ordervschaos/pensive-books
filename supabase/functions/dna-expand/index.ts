// dna-expand — Phase 5: the "expand" verb for the Novel DNA tree. Generates a node's next rung as ONE
// authoritative version (NOT 2–3 proposals to choose among): the AI fills the structure, the author then
// edits / regenerates / locks. See docs/novel-dna-schema.md + novel-dna-spec.md §6.
//
//   client → POST { bookId, nodeId } → load node + ancestors + mandate → Claude → { children } | { prose }
//
// Locked ancestors are hard constraints; accepted siblings give local coherence. Scene → prose fills the
// scene's own text. The LLM host is chosen per-call in callLLM (the ai_provider switch); dev can also
// route this same fn through @/lib/localFn's local-serve override to ride the claude-local shim.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, json } from "../_shared/cors.ts";
import { callLLM, textFromLLM, type CallMeta } from "../_shared/llm.ts";
import { getRoleModels, getActiveProvider, DIGEST_MODEL } from "../_shared/model-config.ts";
import { extractJsonBlock } from "../_shared/json.ts";
// Shared craft KB — the ONE copy of the distilled story craft both write paths use (the agent's
// skill bodies embed the same consts), so engine and agent can't drift apart.
import { CAUSALITY_CRAFT, LOGLINE_CRAFT, POLARITY_CRAFT, PREMISE_CRAFT, PREMISE_JUDGE_CRITERIA, SCENE_DIRECTION_CRAFT } from "../_shared/craft-kb.ts";
// The shared engine's beat-native lints, run over the just-generated beat sheet so a silently-degraded sheet
// gets one bounded repair turn instead of shipping the damage (docs/agent-improvement-plan.md P2.1).
import { canonicalizeKey, entityRegistryBlock, ledgerAt, ledgerText, structureForBook, validate, type AuthoringStatus, type DnaNode, type NodeContent, type NodeKind, type SceneLedger } from "../_shared/novel-dna.ts";
import { type Brief, briefContext, mandateContext } from "../_shared/brief.ts";
import { isChainCall } from "../_shared/self-chain.ts";
import { serviceClient, userClient as createUserClient } from "../_shared/task.ts";

// The rolling continuity digest cached per scene node (authoring.prose_digest). Stores this page's DELTA, not
// the whole accumulator (P3/§3b): `line` = THIS page's one-line recap; `ledger`/`impressions` = the cumulative
// (bounded) state AS OF this page (the LLM fold merges these, so they can't be reconstructed from deltas).
// src_hash = this page's prose; prev_hash chains to the accumulator it was folded onto (so editing any earlier
// page invalidates the whole suffix). buildProseDigest folds the `line` deltas back into the full pages[] on
// READ — so storage is O(n) across the book instead of the old O(n²) full-accumulator-per-node.
// A ledger entry is now GROUNDED (docs/scene-ledger.md §1.4): `ref` = the DNA node id it concerns (a
// character/location/thread id from the entity registry, when the fold could resolve one), `name` + `note` =
// the free-text state as before. objects usually have no ref (fine). `ref` gives observed state a key that
// joins the plan side; `formatLedger` still renders `name — note`, so downstream prompt text is unchanged.
interface LedgerEntry { ref?: string; name: string; note?: string }
interface DigestLedger { characters?: LedgerEntry[]; objects?: LedgerEntry[]; locations?: LedgerEntry[]; timeline?: string; open_threads?: LedgerEntry[] }
// A reader's takeaway from the story so far: what actually LANDED, with a memory weight (1–5). Models the
// experiential read — not every fact, but the things a reader would carry forward and feel. Recurring or
// emotionally charged notes accumulate weight; the next page's writer sees the highest-weight ones so the
// prose stays loyal to what resonates, not just to what's literally true. See docs/true-agent.md.
interface DigestImpression { note: string; weight: number }
interface DigestAccum { pages: string[]; ledger: DigestLedger; impressions?: DigestImpression[] }
// `v` bumps when the accumulator shape or the digest model/prompt changes — an older `v` invalidates the
// whole cached chain (we re-fold rather than trust a digest built by a weaker model or an older schema).
// v3: per-page DELTA storage (`line` replaces the full `value` accumulator) — old v2 entries carry no `line`,
// so they MUST be re-folded, not mis-read as an empty delta.
// v4: GROUNDED ledger (docs/scene-ledger.md §1.4) — ledger entries went from bare strings to { ref, name, note }
// so observed state carries the node id it's about. The whole cached chain invalidates by design; the cold
// re-fold is budget-bounded (FOLD_BUDGET_MS) and self-heals across generations (the v2→v3 path).
const DIGEST_VERSION = 4;
// The fold runs synchronously on the worker (~150s wall-clock ceiling). A cold backfill of an existing
// many-page book would do N sequential folds and blow it. Cap the time spent folding per call: when the
// budget is hit we stop and return the partial digest (the prefix folded/cached so far). Because each fold
// is persisted immediately, the NEXT generation resumes from here, so the cache warms over a generation or
// two instead of the worker dying every time. New books built page-by-page only ever fold ONE page, so
// they never approach this. ~100s leaves headroom for the rest of `prepare` under the ceiling.
const FOLD_BUDGET_MS = 100_000;
interface DigestLink { v?: number; line: string; ledger: DigestLedger; impressions?: DigestImpression[]; src_hash: string; prev_hash: string }
interface Node { id: string; parent_id: string | null; kind: string; position?: number; content: Record<string, unknown>; authoring: { locked?: boolean; status?: string; prose_digest?: DigestLink } }
interface NodeTypeConfig { target: string; child_kind: string; child_level: number; parent_kind: string; role: string; count: string; schema_json: string; slots: SlotConfig }
interface SlotConfig { voice?: boolean; entities?: boolean; threads?: boolean; tentpoles?: boolean; worldRules?: boolean; games?: boolean; preconditions?: boolean; arc?: boolean; priorScenes?: boolean }

// [EXP:preconditions] — EXPERIMENT (removable). Decompose a game's win into typed preconditions; the beat
// sheet must ESTABLISH each `state` precondition before the resolving turn. Flip to false to disable; grep
// "[EXP:preconditions]" to remove. Must match novelDna.ts + eval-bridge.mjs.
const EXP_PRECONDITIONS = true;

const ENTITY_KINDS_SET = new Set(["character", "relationship", "tentpole", "world_fact", "location", "thread", "game", "voice_profile"]);
function scenesInOrder(allNodes: Node[]): Node[] {
  const out: Node[] = [];
  const childrenSorted = (pid: string | null) => allNodes.filter((n) => n.parent_id === pid).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const walk = (n: Node) => {
    if (n.kind === "scene") out.push(n);
    for (const c of childrenSorted(n.id)) if (!ENTITY_KINDS_SET.has(c.kind)) walk(c);
  };
  for (const root of allNodes.filter((n) => n.parent_id === null)) walk(root);
  return out;
}

// ── Prose context = digest v2 (validated in scripts/prose-context-experiment.mjs) ───────────────
// Instead of pasting the last N pages verbatim, prose generation gets a COMPACT digest of ALL prior
// pages — a rolling per-page recap + a continuity ledger + an anti-repeat blocklist — plus the single
// previous page verbatim, tagged voice-ONLY. The experiment found the verbatim previous page was the
// top source of accidental copying, so its phrases go INTO the blocklist and it carries an explicit
// anti-echo instruction. Net: fewer verbatim echoes + higher continuity/craft (judge), at ~⅓ the
// tokens of all-pages-verbatim. The summary call is built inline here; incremental per-page caching
// is the documented follow-up. Mirrored in scripts/eval-bridge.mjs (buildProductionDigest).
const STOP = new Set("the a an and or but of to in on at for with as is was were be been are it its his her their they he she you your we our i me my that this these those there then than so if when while into from over under up down out off not no yes".split(" "));
const proseWords = (t: string) => (t || "").toLowerCase().replace(/[^a-z0-9'\s]/g, " ").split(/\s+/).filter(Boolean);
function ngrams(text: string, n: number): string[] {
  const w = proseWords(text);
  const out: string[] = [];
  for (let i = 0; i + n <= w.length; i++) {
    const gram = w.slice(i, i + n);
    if (gram.every((g) => STOP.has(g))) continue;
    out.push(gram.join(" "));
  }
  return out;
}
// Distinctive multi-word phrases (≥3 content words) already used across the prior pages — fed as the
// anti-repeat blocklist. Deterministic; mirrors distinctivePhrases() in scripts/lib/prose-lints.mjs.
function distinctivePhrases(priorText: string, n = 5, limit = 80): string[] {
  const counts = new Map<string, number>();
  for (const g of ngrams(priorText, n)) counts.set(g, (counts.get(g) || 0) + 1);
  return [...counts.keys()].filter((g) => g.split(" ").filter((x) => !STOP.has(x)).length >= 3).slice(0, limit);
}
// Quoted dialogue lines from prior pages — 4-word dialogue like "Try to keep up" slips through the
// 5-gram phrase blocklist (too short to appear as a full n-gram). Extract them separately so the
// model never re-uses a memorable line verbatim across scenes.
function priorDialogue(priorText: string, limit = 30): string[] {
  const matches = priorText.match(/"[^"]{8,100}"/g) ?? [];
  return [...new Set(matches)].slice(0, limit);
}
const proseText = (s: Node) => String((s.content as { prose?: { text?: string } }).prose?.text ?? "");

// ── Scene seam (doc_1784059899060.md) — the continuity handshake to the immediately preceding scene. ──
// Kept DISTINCT from the digest's voice block on purpose: the old fused "previous page, voice-only, open in
// a different place/time/register" tag conflated "don't reuse the WORDS" with "don't continue the STORY",
// which produced dropped threads (a charged exit never paid off) and duplicated moments (two scenes
// re-telling one). This channel carries continuity; the digest's blocklist keeps carrying anti-echo.
// The `n` last non-empty paragraphs of a prose text — the scene's actual ending, i.e. where the story stands.
function lastParas(text: string, n: number): string {
  const paras = (text || "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return paras.slice(-n).join("\n\n");
}
// The exit handshake for a scene: its ACTUAL prose ending if drafted (what the reader just read), else its
// PLANNED sketch.exit (at sketch time the next scene's predecessor may not be prosed yet).
function sceneExitText(s: Node): string {
  const prose = proseText(s).trim();
  if (prose) return lastParas(prose, 2);
  return String((s.content as { sketch?: { exit?: string } }).sketch?.exit ?? "").trim();
}
// The instruction that tells the writer how THIS scene must join the moment above, keyed off the sketch's
// declared `link`. Absent link (no sketch yet / light path) → the safe default: never silently drop it.
function seamInstruction(link?: string): string {
  switch (link) {
    case "continuous": return "SEAM = CONTINUOUS: open in the same time and place, the very next moment after the exit above — no time-skip, no re-establishing shot; pick up the thread exactly where it was left.";
    case "cut": return "SEAM = CUT: you are moving to a new time and/or place. Land ONE line that acknowledges or pays off whatever the exit above left charged and open (a held breath, a closed door, an unspoken thing) before settling into the new scene — never leave it silently dropped.";
    case "same_moment_new_pov": return "SEAM = SAME MOMENT, NEW POV: re-enter the exact moment above from THIS scene's POV character. Do NOT re-stage or re-describe the action already shown on the page — begin inside their head and push the moment FORWARD (what it costs them, what they do next).";
    default: return "SEAM: carry the through-line. If the exit above left something charged and unresolved, continue it or explicitly acknowledge it; if you deliberately cut to a new time/place, bridge that open moment in a line first. Never silently drop it.";
  }
}

// Non-crypto FNV-1a (32-bit) — deterministic, synchronous; used only to chain/invalidate cached digests.
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}
// Render a grounded entry as `name — note` (the `ref` is metadata for the join, never shown to the writer).
const fmtEntry = (e: LedgerEntry): string => `${e.name}${e.note ? ` — ${e.note}` : ""}`;
function formatLedger(L: DigestLedger): string {
  return [
    L.characters?.length ? `Characters:\n${L.characters.map((c) => `  • ${fmtEntry(c)}`).join("\n")}` : "",
    L.objects?.length ? `Objects in play: ${L.objects.map(fmtEntry).join("; ")}` : "",
    L.locations?.length ? `Locations: ${L.locations.map(fmtEntry).join("; ")}` : "",
    L.timeline ? `Timeline: ${L.timeline}` : "",
    L.open_threads?.length ? `Open threads:\n${L.open_threads.map((t) => `  • ${fmtEntry(t)}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");
}
// Render the carried impressions as the reader's running memory — highest weight first, so the model (and
// the downstream prose writer) see what resonates most.
function formatImpressions(imps: DigestImpression[] | undefined): string {
  if (!imps?.length) return "";
  return [...imps].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0)).map((i) => `  • [${i.weight}] ${i.note}`).join("\n");
}
// Fold ONE page into the running digest: the model sees only the cumulative state (bounded) + this one
// page, NOT the whole book. It writes this page's recap line (appended in code), reconciles the ledger
// (carry forward, update statuses, close paid-off threads, advance the timeline), and maintains the
// reader's running IMPRESSIONS (what landed, with a memory weight). O(1)-per-page; replaces re-summarizing
// every prior page on every generation.
// Coerce the model's ledger channel into grounded { ref, name, note } entries. A `ref` is kept only when it
// resolves to a node id actually in the registry (unknown/garbled → dropped, entry kept — grounding degrades to
// today's behaviour, never below it). Tolerant of the model emitting a bare string (legacy shape → { name }).
function sanitizeEntries(raw: unknown, ids: Set<string>): LedgerEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: LedgerEntry[] = [];
  for (const e of raw) {
    if (typeof e === "string") { if (e.trim()) out.push({ name: e.trim() }); continue; }
    if (!e || typeof e !== "object") continue;
    const o = e as { ref?: unknown; name?: unknown; note?: unknown };
    const name = typeof o.name === "string" ? o.name.trim() : "";
    if (!name) continue;
    out.push({
      name,
      ...(typeof o.note === "string" && o.note.trim() ? { note: o.note.trim() } : {}),
      ...(typeof o.ref === "string" && ids.has(o.ref) ? { ref: o.ref } : {}),
    });
  }
  return out;
}

async function foldDigest(model: string, prior: DigestAccum, pageText: string, registry: string, meta: CallMeta, signal?: AbortSignal): Promise<DigestAccum> {
  const first = !prior.pages.length;
  const ledgerSoFar = first ? "(this is the first page — no prior state)" : (formatLedger(prior.ledger) || "(no ledger yet)");
  const impressionsSoFar = first ? "(none yet)" : (formatImpressions(prior.impressions) || "(none yet)");
  const registryIds = new Set((registry.match(/n_[a-z0-9]+/gi) ?? []));
  const registryBlock = registry.trim()
    ? `\nENTITY REGISTRY — the canonical cast/places/rules/threads, with ids. When a ledger entry is ABOUT one of these, set its "ref" to that id; resolve names, titles, epithets, and pronouns to a registry entry rather than minting a parallel one. For an open_thread that realizes a planned thread, set "ref" to that thread's id:\n${registry.trim()}\n`
    : "";
  const dprompt = `You are maintaining a running CONTINUITY DIGEST of a novel-in-progress, one page at a time. You are given the STORY STATE so far (a cumulative continuity ledger + the reader's running impressions) and the NEXT page's prose. Read the page CLOSELY, then update the state to INCLUDE it. Output STRICT JSON only:
{
  "page": "<one tight line for THIS page: POV + location/time, the value-shift, the key facts ESTABLISHED, and the closing image>",
  "ledger": {
    "characters": [{ "ref": "<registry id if this is a known character, else omit>", "name": "<character name>", "note": "current status, where they are, what they want now" }],
    "objects": [{ "name": "<object/clue in play>", "note": "its state" }],
    "locations": [{ "ref": "<registry id if a known location, else omit>", "name": "<place>", "note": "what's there" }],
    "timeline": "<elapsed time / current point in the story>",
    "open_threads": [{ "ref": "<the planned thread's id if this realizes one, else omit>", "name": "<the promise>", "note": "its state — opened but not yet paid" }]
  },
  "impressions": [{ "note": "<a thing a reader actually TAKES AWAY and remembers from the story so far — an image, a feeling, a turn, a line that lands, a dawning realization>", "weight": <integer 1-5> }]
}
${registryBlock}
READING DISCIPLINE — get this right; downstream prose trusts this digest as authoritative:
- Record only what the page actually establishes. Resolve every reference — a name, label, title, number, role, epithet, or pronoun — to the entity it denotes, which is usually one already in play (often the POV character). A new way of REFERRING to someone or something is not a new someone or something. When it denotes a REGISTRY entity, use that entity's id as the entry's "ref".
- Do NOT mint a new character, object, location, or open thread out of a mere designation or form of address. Add an entity only when the prose genuinely introduces it; open a thread only when the prose genuinely opens a promise.
- Merge, never duplicate: if two references point to the same entity, they are one entry.

The ledger is CUMULATIVE state: carry forward everything still true, UPDATE what changed, CLOSE threads this page paid off, and ADVANCE the timeline.
The impressions are the reader's MEMORY of the read so far — not every fact, but what resonates. CARRY the prior impressions forward; RAISE the weight of any that this page reinforces or pays off (a recurring motif, a deepening dread, a promise kept); ADD what this page newly makes a reader feel or notice. Weight: 5 = central / emotionally charged / unforgettable; 1 = minor. Keep the list tight (≈8 strongest); drop the weakest if it grows past that. No prose, no preamble — JSON only.

CONTINUITY LEDGER SO FAR:
${ledgerSoFar}

READER'S IMPRESSIONS SO FAR (weight in brackets):
${impressionsSoFar}

THIS PAGE:
${pageText}`;
  const data = await callLLM({ model, max_tokens: 2500, messages: [{ role: "user", content: dprompt }] }, { ...meta, fn: "dna-expand-digest" }, { signal });
  const p = JSON.parse(extractJsonBlock(textFromLLM(data))) as { page?: string; ledger?: Record<string, unknown>; impressions?: DigestImpression[] };
  const impressions = Array.isArray(p.impressions)
    ? p.impressions.filter((i) => i && typeof i.note === "string" && i.note.trim()).map((i) => ({ note: i.note.trim(), weight: Math.max(1, Math.min(5, Math.round(Number(i.weight) || 1))) }))
    : prior.impressions;
  const ledger: DigestLedger = p.ledger
    ? {
        characters: sanitizeEntries(p.ledger.characters, registryIds),
        objects: sanitizeEntries(p.ledger.objects, registryIds),
        locations: sanitizeEntries(p.ledger.locations, registryIds),
        timeline: typeof p.ledger.timeline === "string" ? p.ledger.timeline : prior.ledger.timeline,
        open_threads: sanitizeEntries(p.ledger.open_threads, registryIds),
      }
    : prior.ledger;
  return { pages: [...prior.pages, (p.page ?? "").trim()].filter(Boolean), ledger, impressions };
}
async function buildProseDigest(model: string, allNodes: Node[], currentId: string, bookId: number, meta: CallMeta, signal?: AbortSignal): Promise<string> {
  const ordered = scenesInOrder(allNodes);
  const idx = ordered.findIndex((s) => s.id === currentId);
  if (idx <= 0) return "";
  const priorProsed = ordered.slice(0, idx).filter((s) => proseText(s).trim());
  if (!priorProsed.length) return "";
  const last = priorProsed[priorProsed.length - 1];
  const earlier = priorProsed.slice(0, -1);
  // Rolling fold: walk `earlier` in order, carrying the accumulator. A page's cached link is reused iff its
  // prose is unchanged (src_hash) AND the prefix that produced it is unchanged (prev_hash chains to the
  // accumulator). In steady state (appending the next page) every earlier page is already cached except the
  // one that just graduated from verbatim-`last` to `earlier`, so exactly ONE fold runs. Editing an earlier
  // page breaks the chain from that point and the suffix recomputes lazily. (Cold backfill — an existing
  // many-page book's first generation after this shipped — folds all earlier pages once; new books built
  // page-by-page never hit it, since each page only ever folds its single newest predecessor.)
  let accum: DigestAccum = { pages: [], ledger: {} };
  const sb = serviceClient();
  // The entity registry the fold grounds ledger entries against (Phase-1). Computed once for the whole book.
  const registry = entityRegistryBlock(allNodes as unknown as DnaNode[]);
  const startFold = Date.now();
  let truncated = false;
  for (const page of earlier) {
    const txt = proseText(page);
    const srcHash = fnv1a(txt);
    const prevHash = fnv1a(JSON.stringify(accum));
    const cached = page.authoring?.prose_digest;
    // Cache HIT: fold this page onto the running accumulator with NO model call — append its stored delta `line`
    // and adopt its cumulative ledger/impressions snapshot. (Delta storage keeps per-node cost O(1); the full
    // pages[] is reconstructed here in memory for the final digest.)
    if (cached && cached.v === DIGEST_VERSION && cached.src_hash === srcHash && cached.prev_hash === prevHash) {
      accum = { pages: [...accum.pages, cached.line].filter(Boolean), ledger: cached.ledger, impressions: cached.impressions };
      continue;
    }
    // Out of fold budget → stop and return the partial digest (covers the prefix folded/cached so far). The
    // fold is sequential (each depends on the prior accumulator) so we can't skip ahead — earliest-uncached
    // first. Each completed fold below is already persisted, so the next generation resumes from here.
    if (Date.now() - startFold > FOLD_BUDGET_MS) { truncated = true; break; }
    try {
      const next = await foldDigest(model, accum, txt, registry, meta, signal);
      const line = next.pages[next.pages.length - 1] ?? ""; // this page's delta = the line the fold just appended
      page.authoring = { ...page.authoring, prose_digest: { v: DIGEST_VERSION, line, ledger: next.ledger, impressions: next.impressions, src_hash: srcHash, prev_hash: prevHash } };
      // Persist THIS fold immediately — a worker death at the ~150s ceiling must not lose progress (the
      // old persist-at-end lost everything on death, so the cache never warmed and prose never recalculated).
      await sb.from("book_nodes").update({ authoring: page.authoring }).eq("id", page.id).eq("book_id", bookId);
      accum = next;
    } catch { /* degrade gracefully: skip this page's fold; blocklist + previous page still carry continuity */ }
  }
  if (truncated) console.warn(`dna-expand digest: fold budget hit for book ${bookId} — partial digest (${accum.pages.length}/${earlier.length} pages); cache warms on next generation`);
  const storySoFar = accum.pages.map((x, i) => `- Page ${i + 1}: ${x}`).join("\n");
  const ledger = formatLedger(accum.ledger);
  const impressions = formatImpressions(accum.impressions);
  // v2: blocklist covers ALL prior pages INCLUDING the previous one (its verbatim text was the top echo source).
  const allPriorText = priorProsed.map(proseText).join("\n");
  const blocklist = distinctivePhrases(allPriorText);
  const dialogue = priorDialogue(allPriorText);
  return [
    "PRECEDING CONTEXT — an efficient digest of the pages so far. Treat it as authoritative continuity; maintain the established voice and do NOT reuse any phrase or dialogue line listed below:",
    storySoFar && `<story_so_far>\n${storySoFar}\n</story_so_far>`,
    ledger && `<continuity_ledger>\n${ledger}\n</continuity_ledger>`,
    impressions && `<reader_impressions note="what has LANDED for the reader so far, strongest first (memory weight 1-5) — stay loyal to these; pay them off, deepen them, don't contradict what already resonates">\n${impressions}\n</reader_impressions>`,
    blocklist.length && `<avoid_repeating>\n${blocklist.map((p) => `- ${p}`).join("\n")}\n</avoid_repeating>`,
    dialogue.length && `<avoid_repeating_dialogue note="these exact lines have already been spoken — do NOT reuse them verbatim or near-verbatim in this scene">\n${dialogue.map((d) => `- ${d}`).join("\n")}\n</avoid_repeating_dialogue>`,
    `<previous_page note="VOICE + CADENCE reference — match the established narrative voice, rhythm, and diction. Do NOT reuse its exact phrasings, sentence shapes, or gestures (see avoid_repeating). This is NOT a cue to jump away from the story: how this scene joins the previous one is governed by the SEAM instruction above, not by this block.">\n${proseText(last)}\n</previous_page>`,
  ].filter(Boolean).join("\n\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const userClient = createUserClient(req.headers.get("Authorization") ?? "");
    // Trusted server-to-server call (the editor agent's render_scene_prose tool) carries the chain secret →
    // skip user auth and read via the service client. A logged-out client can't forge it. Otherwise: user auth.
    const trusted = isChainCall(req);
    let userId: string | null = null;
    if (!trusted) {
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) return json({ error: "Unauthorized" }, 401);
      userId = user.id;
    }
    const db = trusted ? serviceClient() : userClient;

    // `prepare` (prose only): build the full context — INCLUDING the v2 digest — but return the assembled
    // model request instead of calling the model. The browser then streams the long prose generation through
    // the stream-prose edge fn, so the 80–140s call never rides this worker's own wall-clock budget
    // (the timeout/546 failures). See TO-DO/dna-streaming-proxy.md. Digest + assembly stay here (fast, DB-bound).
    // `phase`/`rawText`/`repairText` (beatsheet only): the browser-streamed split (see the beatsheet branch
    // below) — "prepare" returns the assembled request, "finalize" does the parse/sanitize/lint/repair-decision
    // against the text the browser streamed off-worker. Independent of prose's `prepare` boolean.
    const { bookId, nodeId, target, light, prepare, phase, rawText, repairText, brief: renderBrief } = (await req.json().catch(() => ({}))) as { bookId?: number; nodeId?: string; target?: string; light?: boolean; prepare?: boolean; phase?: "prepare" | "finalize"; rawText?: string; repairText?: string; brief?: { focus?: string; mustHonor?: string[]; avoid?: string[] } };
    if (!bookId || !nodeId) return json({ error: "bookId and nodeId are required" }, 400);

    const { data: book } = await db.from("books").select("name, brief, foundations").eq("id", bookId).maybeSingle();
    const { data: nodeRows } = await db.from("book_nodes").select("id, parent_id, kind, position, content, authoring").eq("book_id", bookId);
    const nodes = (nodeRows as Node[] | null) ?? [];
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return json({ error: "Node not found" }, 404);

    const brief = book?.brief as Brief | null;
    const mandate = mandateContext(brief);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    // Ancestor chain (root → parent), locked ones flagged as hard constraints.
    const chain: Node[] = [];
    for (let p = node.parent_id; p; p = byId.get(p)?.parent_id ?? null) { const a = byId.get(p); if (a) chain.unshift(a); }
    // The cast/world registry hangs off the pillar (not the ancestor chain) — feed it in so generation
    // is character- and world-aware (scenes know who exists; relationships pair real characters by name).
    const pillar = node.kind === "pillar" ? node : chain.find((a) => a.kind === "pillar");
    const entities = pillar ? nodes.filter((n) => n.parent_id === pillar.id && (n.kind === "character" || n.kind === "world_fact" || n.kind === "relationship")) : [];
    const chars = entities.filter((e) => e.kind === "character");
    const cName = (e: Node) => String((e.content as { name?: string }).name ?? "").trim();
    const entityBlock = entities.length
      ? "CAST & WORLD (reference characters BY NAME):\n" +
        chars.map((c) => `- ${cName(c)} [${(c.content as { role?: string }).role ?? "?"}] ${JSON.stringify(c.content)}`).join("\n") +
        entities.filter((e) => e.kind === "world_fact").map((w) => `\n- WORLD: ${(w.content as { rule?: string }).rule ?? ""}`).join("")
      : "";
    // The promise registry + the arc — fed so beats/scenes anchor real threads (by name) and threads
    // generation can place payoffs across the whole act sequence (schema §4.5/§6).
    const threads = pillar ? nodes.filter((n) => n.parent_id === pillar.id && n.kind === "thread") : [];
    const tName = (e: Node) => String((e.content as { name?: string }).name ?? "").trim();
    const threadBlock = threads.length
      ? "THREADS — the promise registry (reference BY NAME):\n" +
        threads.map((t) => `- ${tName(t)}: ${(t.content as { promise?: string }).promise ?? ""} → ${(t.content as { payoff?: string }).payoff ?? ""}`).join("\n")
      : "";
    const acts = pillar ? nodes.filter((n) => n.parent_id === pillar.id && n.kind === "act").sort((a, b) => (a.position ?? 0) - (b.position ?? 0)) : [];
    const actBlock = acts.length
      ? "THE ARC (acts in order — place promises across these):\n" +
        // The value line grounds the "act's value shift is the MACRO trend" rule below — the model can't
        // oscillate within (or land) a trend it never sees.
        acts.map((m) => {
          const c = m.content as { title?: string; turning_point?: string; value?: { name?: string; from?: string; to?: string; polarity?: string } };
          const v = c.value && (c.value.name || c.value.from || c.value.to)
            ? ` | value ${c.value.name ?? ""}: ${c.value.from ?? "?"} → ${c.value.to ?? "?"}${c.value.polarity ? ` (lands ${c.value.polarity})` : ""}`
            : "";
          return `- [${c.title ?? ""}] turn: ${c.turning_point ?? ""}${v}`;
        }).join("\n")
      : "";
    // The tentpole registry — emotional/scene GUIDANCE the beat sheet must place (each pinned tentpole → a
    // beat that embodies its feel). Reference tentpoles BY NAME (like threads/games/world_facts) — the
    // `guidance` text is not a line to quote back, so identity can't ride on reproducing it verbatim.
    const tentpoles = pillar ? nodes.filter((n) => n.parent_id === pillar.id && n.kind === "tentpole" && (n.authoring?.locked || n.authoring?.status === "accepted")) : [];
    const tpName = (e: Node) => {
      const c = e.content as { name?: string; summary?: string };
      const n = String(c.name ?? "").trim();
      // legacy tentpoles authored before the `name` field existed: derive a short handle from the guidance
      // text so old data still resolves.
      return n || String(c.summary ?? "").trim().split(/\s+/).slice(0, 6).join(" ");
    };
    const tpGuidance = (e: Node) => String((e.content as { summary?: string }).summary ?? "").trim();
    const tentpoleBlock = tentpoles.length
      ? "TENTPOLES — emotional/scene guidance to honor (each is a feel or turn the story builds toward, not a line to quote; reference it BY NAME in \"realizes\"):\n" +
        tentpoles.map((t) => `- ${tpName(t)}: ${tpGuidance(t)}`).join("\n")
      : "";
    // The world RULES (name + mechanism) — so turning points (esp. the climax) can be GROUNDED in a rule.
    const worldFacts = pillar ? nodes.filter((n) => n.parent_id === pillar.id && n.kind === "world_fact") : [];
    const wfName = (e: Node) => String((e.content as { name?: string; rule?: string }).name ?? (e.content as { rule?: string }).rule ?? "").trim();
    const worldRulesBlock = worldFacts.length
      ? "WORLD RULES (the mechanisms a turning point can fire — reference BY NAME in grounds_in):\n" +
        worldFacts.map((w) => `- ${wfName(w)}: ${(w.content as { mechanism?: string; rule?: string }).mechanism ?? (w.content as { rule?: string }).rule ?? ""}`).join("\n")
      : "";
    // The LOCATIONS registry (name + persistent sensory palette) — so scenes reference real places BY NAME in
    // `loc` and the same place reads consistently across every scene set there (continuity; aim 1).
    const locations = pillar ? nodes.filter((n) => n.parent_id === pillar.id && n.kind === "location") : [];
    const locName = (e: Node) => String((e.content as { name?: string }).name ?? "").trim();
    const palette = (c: { sight?: string; sound?: string; smell?: string; texture?: string; mood?: string }) =>
      [c.sight && `sight: ${c.sight}`, c.sound && `sound: ${c.sound}`, c.smell && `smell: ${c.smell}`, c.texture && `texture: ${c.texture}`, c.mood && `mood: ${c.mood}`].filter(Boolean).join(" · ");
    const locationBlock = locations.length
      ? "LOCATIONS — places with a fixed sensory palette (reference BY NAME in loc; render the SAME palette every time):\n" +
        locations.map((l) => `- ${locName(l)}: ${palette(l.content as Record<string, string>) || "(no palette yet)"}`).join("\n")
      : "";
    // When THIS node is a scene, resolve its loc → the location's full palette so the prose grounds itself in
    // the established setting rather than re-inventing it. loc may be a node id (new) or free text (legacy).
    const sceneLoc = node.kind === "scene" ? (node.content as { loc?: string }).loc : undefined;
    const locNode = sceneLoc?.startsWith("n_") ? byId.get(sceneLoc) : undefined;
    const settingBlock = locNode && locNode.kind === "location"
      ? `SETTING (this scene happens here — honor its established palette, don't re-invent it):\n${locName(locNode)} — ${palette(locNode.content as Record<string, string>) || "(no palette yet)"}`
      : "";
    // The unified between-scenes view (docs/scene-ledger.md §3.2 consumer 1): ONE ledgerAt fold is the read
    // path for BOTH the entry-state block and the disclosure budget below — the generator now sees the same
    // deterministic snapshot the agent/verify loop do, instead of each surface assembling it ad hoc. Pure; the
    // `nodeId` not being a scene ⇒ null ⇒ both blocks empty (degradation: today's behaviour unchanged).
    const sceneLedger: SceneLedger | null = node.kind === "scene" ? ledgerAt(nodes as unknown as DnaNode[], nodeId) : null;
    const nameOf = (id: string) => String((byId.get(id)?.content as { name?: string })?.name ?? id);
    // ENTRY STATE — the plan-side state entering this scene the prose writer otherwise can't see: promises still
    // OPEN (reader pressure) + where each character was LAST seen (so the scene doesn't teleport someone or
    // forget an open loop). Rendered by the shared `ledgerText`, so the generator sees the SAME snapshot the
    // agent's tree digest does (docs/scene-ledger.md §3.2). Empty text → block dropped (degradation unchanged).
    const entryText = node.kind === "scene" ? ledgerText(nodes as unknown as DnaNode[], nodeId) : "";
    const entryStateBlock = entryText
      ? "ENTRY STATE (the deterministic story state ENTERING this scene — honor it; don't contradict where people are or forget an open promise):\n" + entryText
      : "";
    // The DISCLOSURE BUDGET (docs/scene-ledger.md §2.4), now read off the same ledgerAt fold: for the entities in
    // THIS scene (its location + POV + present cast), what has ALREADY been rendered — so the writer reveals
    // fresh facets, varies known ones in NEW words, and drops saturated ones, instead of blindly restating the
    // whole palette. Degradation rule: no exposure data → empty block → today's behaviour unchanged.
    const disclosureBlock = (() => {
      if (!sceneLedger?.exposure.length) return "";
      const sc = node.content as { loc?: string; pov?: string; present?: string[] };
      const refs = new Set([sc.loc, sc.pov, ...(sc.present ?? [])].filter((x): x is string => !!x && x.startsWith("n_")));
      const scoped = sceneLedger.exposure.filter((e) => refs.has(e.ref));
      if (!scoped.length) return "";
      const grouped = new Map<string, typeof scoped>();
      for (const e of scoped) (grouped.get(e.ref) ?? grouped.set(e.ref, []).get(e.ref)!).push(e);
      const lines = [...grouped].map(([ref, facets]) =>
        `  ${nameOf(ref)}:\n` + facets.map((f) => {
          const status = f.saturated
            ? `saturated (×${f.uses})${f.lastPhrasing ? ` — last "${f.lastPhrasing}"` : ""}: do NOT restate; an oblique echo at most, and only if the scene turns on it.`
            : `established ×${f.uses}${f.lastPhrasing ? ` ("${f.lastPhrasing}")` : ""}: fine to touch again, but in NEW words.`;
          return `    ${f.facet} — ${status}`;
        }).join("\n")
      );
      return "DISCLOSURE BUDGET (what's ALREADY been rendered for the entities in this scene — reveal what's fresh, vary what's known in NEW words, drop what's saturated; any facet NOT listed here is unrendered, so this is your chance to establish it):\n" + lines.join("\n");
    })();
    // The scene's REGISTER — how the book's ONE voice bends for THIS scene only. Keeps the signature constant
    // (still the voice profile above) but varies pace/distance/intensity so the read doesn't go monotone.
    const sceneRegister = node.kind === "scene" ? String((node.content as { register?: string }).register ?? "").trim() : "";
    const registerBlock = sceneRegister
      ? `THIS SCENE'S REGISTER (keep the voice profile's signature, but bend it toward this for THIS scene only — vary sentence length, pace, and narrative distance accordingly; do NOT carry it into the next scene): ${sceneRegister}`
      : "";
    // The voice profile — governs all prose. Injected into ctx so every generation step can reference it.
    const voiceProfileNode = pillar ? nodes.find((n) => n.parent_id === pillar.id && n.kind === "voice_profile") : null;
    const vp = voiceProfileNode?.content as { pov?: string; tense?: string; style?: string; constraints?: string[]; sample?: string } | undefined;
    const voiceBlock = vp
      ? "VOICE PROFILE (every word of prose must conform to this):\n" +
        [vp.pov ? `- POV: ${vp.pov}` : "", vp.tense ? `- Tense: ${vp.tense}` : "", vp.style ? `- Style: ${vp.style}` : ""].filter(Boolean).join("\n") +
        (vp.constraints?.length ? `\n- Rules:\n${vp.constraints.map((c) => `  • ${c}`).join("\n")}` : "") +
        (vp.sample ? `\n- Reference sample (match this voice exactly):\n${vp.sample}` : "")
      : "";
    // The GAMES (the contests + their win/lose poles) — so beats can PLAY them and a beat RESOLVES each.
    const games = pillar ? nodes.filter((n) => n.parent_id === pillar.id && n.kind === "game") : [];
    const gName = (e: Node) => String((e.content as { name?: string }).name ?? "").trim();
    const gamesBlock = games.length
      ? "GAMES (the contests — reference BY NAME in plays/resolves; WIN vs LOSE):\n" +
        games.map((g) => { const c = g.content as { win_condition?: string; lose_condition?: string }; return `- ${gName(g)}: WIN = ${c.win_condition ?? "?"} | LOSE = ${c.lose_condition ?? "?"}`; }).join("\n")
      : "";
    // [EXP:preconditions] the STATE preconditions each game's win spends — the beat sheet must establish each.
    const statePreconds = EXP_PRECONDITIONS
      ? games.flatMap((g) => ((g.content as { win_requires?: { type?: string; what?: string; key?: string }[] }).win_requires ?? [])
          .filter((r) => r.type === "state" && r.key).map((r) => ({ key: r.key as string, what: r.what ?? "", game: gName(g) })))
      : [];
    const precondBlock = statePreconds.length
      ? "STATE PRECONDITIONS (each must be ESTABLISHED by an earlier beat — list its key in that beat's `establishes` — BEFORE the beat that resolves its game):\n" +
        statePreconds.map((p) => `- ${p.key} (${p.game}): ${p.what}`).join("\n")
      : "";
    // PRIOR SCENES — structured continuity block for scene planning, mirroring what prose gen gets via the
    // digest: entry state (where the story stands NOW), polarity rhythm, used locations. Formatted with
    // instructive XML tags so the model understands HOW to use each piece, not just what's there.
    const beatsInOrder = acts.flatMap((m) =>
      nodes.filter((n) => n.parent_id === m.id && n.kind === "beat").sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    );
    const beatIdx = beatsInOrder.findIndex((b) => b.id === node.id);
    const priorBeats = beatIdx > 0 ? beatsInOrder.slice(0, beatIdx) : [];
    const resolveLoc = (loc?: string) => loc?.startsWith("n_") ? (byId.get(loc)?.content as { name?: string })?.name ?? loc : loc;
    const priorScenesBlock = (() => {
      // Rules always appear (they're injected only when priorScenes slot is active = scenes target).
      const rules = `SCENE RULES:
(1) Continue causally from the entry state — your first scene opens where the last planned scene left off. Do not reset.
(2) Every scene turns a value (no flat "and-then"). Set value_shift.polarity: up = ends better, down = ends worse.
(3) Vary polarity internally — the beat's closing polarity is where the LAST scene must land; dip/rise internally.
(4) Vary location — if prior scenes used a location, prefer a different place unless the drama demands it.
(5) Each scene = one attempt: a character wants something, meets a specific obstacle, gets it or doesn't.`;
      if (!priorBeats.length) return rules;
      // All prior scenes in order (beats that had scenes planned)
      const allPriorScenes = priorBeats.flatMap((b) =>
        nodes.filter((n) => n.parent_id === b.id && n.kind === "scene").sort((a, b2) => (a.position ?? 0) - (b2.position ?? 0))
          .map((s) => ({ beat: b, scene: s }))
      );
      if (!allPriorScenes.length) return "";
      // Beat-grouped scene map
      const beatLines = priorBeats.flatMap((b) => {
        const beatScenes = allPriorScenes.filter((x) => x.beat.id === b.id).map((x) => x.scene);
        if (!beatScenes.length) return [];
        const bSummary = String((b.content as { summary?: string }).summary ?? "").trim();
        const connector = String((b.content as { connector?: string }).connector ?? "").trim();
        return [
          `  Beat [${connector || "—"}]: "${bSummary}"`,
          ...beatScenes.map((s, i) => {
            const c = s.content as { loc?: string; goal?: string; conflict?: string; outcome?: string; value_shift?: { value?: string; from?: string; to?: string; polarity?: string } };
            const loc = resolveLoc(c.loc);
            const vs = c.value_shift ? `${c.value_shift.value ?? ""}: ${c.value_shift.from ?? ""} → ${c.value_shift.to ?? ""} (${c.value_shift.polarity ?? ""})` : "";
            return `    Scene ${i + 1}: loc=${loc ?? "?"} | goal=${c.goal ?? "?"} | outcome=${c.outcome ?? "?"}${vs ? ` | value=${vs}` : ""}`;
          }),
        ];
      });
      // Entry state — what the first new scene inherits from the last planned scene
      const { beat: lastBeat, scene: lastScene } = allPriorScenes[allPriorScenes.length - 1];
      const lc = lastScene.content as { loc?: string; outcome?: string; value_shift?: { polarity?: string } };
      const lastLoc = resolveLoc(lc.loc);
      const lastBeatSummary = String((lastBeat.content as { summary?: string }).summary ?? "").trim();
      // Polarity chain (↑/↓ per scene, left to right = story order)
      const polarityChain = allPriorScenes
        .map((x) => (x.scene.content as { value_shift?: { polarity?: string } }).value_shift?.polarity === "up" ? "↑" : "↓")
        .join(" ");
      // Distinct locations used
      const usedLocs = [...new Set(allPriorScenes.map((x) => resolveLoc((x.scene.content as { loc?: string }).loc)).filter(Boolean))];
      return [
        rules,
        `<scenes_so_far note="the scene plan as written — understand the story's current state and rhythm before placing new scenes">`,
        beatLines.join("\n"),
        `</scenes_so_far>`,
        `<entry_state note="where the story stands when your FIRST new scene opens — continue causally from here">`,
        `  Last scene ended: at ${lastLoc ?? "?"} — ${lc.outcome ?? "?"}`,
        `  Entering via beat: "${lastBeatSummary}"`,
        `  Polarity rhythm so far: ${polarityChain} → [your scenes must land this beat at its planned polarity]`,
        `  Locations already used: ${usedLocs.join(", ")} — vary if dramatically possible`,
        `</entry_state>`,
      ].join("\n");
    })();

    // §4c: prose RENDER on the prose model; every structural pass (logline, beat sheet, child JSON)
    // on the structure model. Both fall back to the base tier unless an admin set a per-role override, so with
    // none set this is identical to the old single-tier `high`. (The continuity digest keeps its own DIGEST_MODEL.)
    const roleModels = await getRoleModels();
    const isProseRender = target === "prose" || (!target && node.kind === "scene");
    const model = isProseRender ? roleModels.prose : roleModels.structure;
    const operation = target ?? (node.kind === "scene" ? "prose" : "children");
    const meta: CallMeta = { fn: "dna-expand", bookId, userId, nodeId, operation };
    // Prose → digest v2 (all-page continuity + anti-echo). The per-page fold runs on DIGEST_MODEL (qwen-plus,
    // a reasoning model) — NOT the cheap `low` model: the digest is read-comprehension that downstream prose
    // trusts as authoritative, so a weak model's misreadings poison every later page.
    // `light` skips the all-page continuity digest (a separate, slow Claude call) — used by the editor
    // agent's render_scene_prose so a single render fits inside one worker's wall-clock. Trades cross-scene
    // anti-repetition polish for speed; fine for a draft-to-check, not for the canonical book build.
    const prevProseBlock = light ? ""
      : (target === "prose" || target === "sketch" || (!target && node.kind === "scene"))
      ? await buildProseDigest(DIGEST_MODEL, nodes, nodeId, bookId, meta, req.signal)
      : "";
    // Beat neighbourhood — the sibling beats of the scene's parent beat, in act order.
    // Prose generation only sees its direct ancestor chain (parent beat + act + …), so it never
    // knows what specific facts (names, numbers, objects) are established in adjacent beats. That gap
    // causes contradictions: prose invents "Lot 7" while the next beat's plan says "Lot 27". Feeding
    // the full beat list of the parent act gives prose a view of the surrounding plan, so it
    // can honour the specifics those beats have already committed to.
    const beatNeighbourhoodBlock = (() => {
      if (node.kind !== "scene") return "";
      const parentBeat = node.parent_id ? byId.get(node.parent_id) : undefined;
      if (!parentBeat || parentBeat.kind !== "beat") return "";
      const actId = parentBeat.parent_id;
      if (!actId) return "";
      const siblingBeats = nodes
        .filter((n) => n.parent_id === actId && n.kind === "beat")
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      if (siblingBeats.length <= 1) return "";
      const lines = siblingBeats.map((b) => {
        const isCurrent = b.id === parentBeat.id;
        const summary = String((b.content as { summary?: string }).summary ?? "").trim();
        return `  ${isCurrent ? "▶ " : "  "}[beat pos=${b.position}${isCurrent ? " ← THIS SCENE'S BEAT" : ""}] ${summary}`;
      });
      return `BEAT PLAN — all beats in this act, in order (honour any specific facts, names, numbers, or objects established here):\n${lines.join("\n")}`;
    })();
    // Render targets (prose) get a SCOPED bible, not the whole book. A scene RENDERS one moment;
    // it doesn't schedule threads or place tentpoles across the arc — that breadth is the planning targets'
    // job. So instead of broadcasting every character/location/thread/rule (which both costs tokens AND
    // dilutes the signal with cast that isn't in the room), anchor on what THIS scene's plan + its parent
    // beat actually reference — the plan declares its own anchors ("anchors, not fences"). Floor: the leads
    // are always in, as insurance against the single-shot call's inability to re-fetch what the plan under-named.
    const renderTarget = target === "prose" || target === "sketch" || (!target && node.kind === "scene");
    // The seam handshake to the immediately preceding scene (doc_1784059899060.md). Carries WHERE the story
    // stands + how this scene must join it (from the sketch's `link`). Cheap (no model call), so it rides
    // even the `light` path — continuity is the whole point of the ask. Empty for scene 1 / non-render.
    const seamBlock = (() => {
      if (!renderTarget) return "";
      const orderedScenes = scenesInOrder(nodes);
      const myIdx = orderedScenes.findIndex((s) => s.id === nodeId);
      const prevScene = myIdx > 0 ? orderedScenes[myIdx - 1] : undefined;
      const prevExit = prevScene ? sceneExitText(prevScene) : "";
      if (!prevExit) return "";
      const link = (node.content as { sketch?: { link?: string } }).sketch?.link;
      return [
        "SEAM WITH THE PREVIOUS SCENE — where the story stands right now. The scene just before this one ended on the moment below. This scene must move the story FORWARD from here; never silently drop it or re-tell it.",
        `<previous_scene_exit>\n${prevExit}\n</previous_scene_exit>`,
        seamInstruction(link),
      ].join("\n\n");
    })();
    const proseScope = (() => {
      if (!renderTarget) return "";
      const parentBeatNode = node.parent_id ? byId.get(node.parent_id) : undefined;
      const anchorText = [JSON.stringify(node.content), parentBeatNode ? JSON.stringify(parentBeatNode.content) : ""].join(" ");
      const isLead = (c: Node) => /protagonist|deuteragonist/i.test(String((c.content as { role?: string }).role ?? ""));
      const nameHit = (c: Node) => cName(c).split(/\s+/).filter((w) => w.length >= 3)
        .some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(anchorText));
      const scopedChars = chars.filter((c) => isLead(c) || nameHit(c));
      const cast = scopedChars.length
        ? "CAST (characters in or bearing on THIS scene — reference BY NAME):\n" +
          scopedChars.map((c) => `- ${cName(c)} [${(c.content as { role?: string }).role ?? "?"}] ${JSON.stringify(c.content)}`).join("\n")
        : "";
      // Only the threads this beat carries and the world rules it grounds in — not the whole registry.
      const beatThreadRefs = new Set(((parentBeatNode?.content as { threads?: { ref?: string }[] })?.threads ?? []).map((t) => t.ref));
      const scopedThreads = threads.filter((t) => beatThreadRefs.has(t.id));
      const threadsBlk = scopedThreads.length
        ? "THREADS this scene carries (reference BY NAME):\n" +
          scopedThreads.map((t) => `- ${tName(t)}: ${(t.content as { promise?: string }).promise ?? ""} → ${(t.content as { payoff?: string }).payoff ?? ""}`).join("\n")
        : "";
      const beatGrounds = new Set(((parentBeatNode?.content as { grounds_in?: string[] })?.grounds_in ?? []).map(String));
      const scopedRules = worldFacts.filter((w) => beatGrounds.has(w.id));
      const rulesBlk = scopedRules.length
        ? "WORLD RULES in play this scene (reference BY NAME):\n" +
          scopedRules.map((w) => `- ${wfName(w)}: ${(w.content as { mechanism?: string; rule?: string }).mechanism ?? (w.content as { rule?: string }).rule ?? ""}`).join("\n")
        : "";
      return [cast, threadsBlk, rulesBlk].filter(Boolean).join("\n\n");
    })();
    // The agent's CURATED brief (docs/agent-capabilities.md) — verbatim, AUGMENTING the deterministic
    // context below, never replacing it. It's whatever the agent retrieved/was told (chat instructions,
    // grep/read results) and decided this pass must honor, so it's higher-signal than the computed context.
    // Any target may carry one — a beat sheet or scene break can be steered same as a prose render.
    const b = renderBrief ?? null;
    const briefBlock = b ? [
      "THE EDITOR'S BRIEF FOR THIS PAGE (curated by the agent — treat as the highest-priority guidance; it does NOT override the MANDATE or LOCKED facts):",
      b.focus ? `- FOCUS: ${b.focus}` : "",
      Array.isArray(b.mustHonor) && b.mustHonor.length ? `- MUST HONOR (continuity that has to land):\n${b.mustHonor.map((x) => `  · ${x}`).join("\n")}` : "",
      Array.isArray(b.avoid) && b.avoid.length ? `- AVOID (do not repeat or contradict):\n${b.avoid.map((x) => `  · ${x}`).join("\n")}` : "",
    ].filter(Boolean).join("\n") : "";
    // THE SKETCH (doc_1783196400000_dna_scene_sketch_layer.md): the accepted treatment for THIS page, injected
    // VERBATIM into the prose render — moves are the page's SPINE, direction is the render's HOW. Only a prose
    // render reads it (sketch generation itself doesn't — it's producing this, not consuming it).
    const sk = (target === "prose" || (!target && node.kind === "scene"))
      ? (node.content as { sketch?: { opening?: string; moves?: { what?: string; sense?: string }[]; exit?: string; direction?: { cut?: { in?: string; out?: string }; distance?: string; mode?: string; time?: string; tension?: string } } }).sketch
      : undefined;
    const sketchBlock = sk ? [
      "THE SCENE'S SKETCH (the accepted treatment for THIS page — follow its moves as the page's spine, in order; honor its direction):",
      sk.opening ? `- OPEN: ${sk.opening}` : "",
      Array.isArray(sk.moves) && sk.moves.length ? `- MOVES (in order):\n${sk.moves.map((m, i) => `  ${i + 1}. ${m.what}${m.sense ? ` (${m.sense})` : ""}`).join("\n")}` : "",
      sk.exit ? `- EXIT: ${sk.exit}` : "",
      sk.direction ? `- DIRECTION: ${[sk.direction.mode && `mode=${sk.direction.mode}`, sk.direction.distance && `distance=${sk.direction.distance}`, sk.direction.time && `time=${sk.direction.time}`, sk.direction.tension && `tension=${sk.direction.tension}`, sk.direction.cut?.in && `cut in: ${sk.direction.cut.in}`, sk.direction.cut?.out && `cut out: ${sk.direction.cut.out}`].filter(Boolean).join(", ")}` : "",
    ].filter(Boolean).join("\n") : "";

    const ctx = [
      `BOOK: ${book?.name ?? ""}`,
      `BRIEF (binding):\n${briefContext(brief, { scope: "full", success: true, vision: true, none: "(no brief)", empty: "(empty)" })}`,
      mandate ? `MANDATE — NON-NEGOTIABLE:\n${mandate}` : "",
      voiceBlock,
      "STORY SO FAR (the ladder above this node; LOCKED items are immutable):",
      ...chain.map((a) => `[${a.kind}${a.authoring?.locked ? " · LOCKED" : ""}] ${JSON.stringify(a.content)}`),
      // Render targets get the scene-scoped slice; planning targets get the whole arc (breadth is their job).
      ...(renderTarget
        ? [proseScope]
        : [entityBlock, locationBlock, threadBlock, tentpoleBlock, worldRulesBlock, gamesBlock, precondBlock /* [EXP:preconditions] */, actBlock]),
      beatNeighbourhoodBlock, // sibling beats — keeps prose from contradicting plan-layer facts
      entryStateBlock, // ledgerAt §3.2: open promises + character positions entering this scene (empty = unchanged)
      settingBlock, // this scene's resolved location palette (prose grounding)
      disclosureBlock, // progressive disclosure: which facets to reveal/vary/drop (Phase 2 — empty = today's behaviour)
      registerBlock, // this scene's voice modulation (anti-monotony) — bends the signature for this scene only
      sketchBlock, // the accepted treatment (moves + direction) for THIS page (empty for non-render / no-sketch calls)
      briefBlock, // the agent's curated, verbatim guidance for THIS page (empty for non-render / no-brief calls)
      seamBlock, // the continuity handshake to the previous scene (WHERE the story stands + how to join it)
      prevProseBlock,
      `THIS NODE [${node.kind}]: ${JSON.stringify(node.content)}`,
    ].filter(Boolean).join("\n\n");

    if (target === "logline") {
      // Seed → logline: forge the author's RAW idea (brief.idea) into a polished LOGLINE. A logline is NOT
      // the raw idea — it names protagonist · inciting incident · primary goal · main obstacle · stakes in
      // one or two sentences. This is the system's first refinement (docs/dna-studio-analysis.md §0/§1).
      const system = `You are a story editor. Turn the author's raw idea into ONE polished LOGLINE for the book — one or two sentences that make the story instantly legible and compelling. A logline sells the ENGINE of the story, not its meaning.

${LOGLINE_CRAFT}

Honor the MANDATE (genre/tone) and any LOCKED ancestors. Do NOT invent a title. Do NOT restate the raw idea verbatim — SHARPEN it into a real logline. Output the LOGLINE ONLY: one or two sentences, no preamble, no label, no quotes, no JSON.`;
      const data = await callLLM({ model, max_tokens: 400, system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: `${ctx}\n\nWrite the logline.` }] }, meta, { signal: req.signal });
      return json({ logline: textFromLLM(data).trim(), callId: meta.loggedCallId ?? null });
    }

    if (target === "premise") {
      const logline = String((node.content as { logline?: unknown })?.logline ?? "").trim();
      if (node.kind !== "seed") return json({ error: "'premise' expands from the seed/logline node" }, 400);
      if (!logline) return json({ error: "Generate or accept a logline before deriving the premise." }, 400);
      // Shape + question rules come from the shared craft KB (craft-kb.ts) — the SAME copy the
      // agent's premise-craft skill embeds, so the two write paths can't drift apart.
      const system = `You are a story architect. Given a BRIEF (the constant origin) and a LOGLINE (protagonist · inciting incident · goal · obstacle · stakes), derive a PREMISE consisting of a SHAPE and a DRAMATIC_QUESTION.

Produce:

${PREMISE_CRAFT}

Constraints:
- Stay inside the genre, tone, and heat level of the brief.
- Do not introduce characters, settings, or devices absent from the brief or logline.

Silent evaluation lint before you answer:
You are a ruthless development editor. Score this PSE against its BRIEF and LOGLINE. Do not be polite. A premise that would produce a readable but forgettable book should fail.
Score each criterion 0-5:
${PREMISE_JUDGE_CRITERIA.map((c, i) => `${i + 1}. ${c.label} — ${c.desc}`).join("\n")}
6. ORIGINALITY SURFACED — Does the brief's most distinctive element appear explicitly in the premise? Name that element first, then check.
7. BRIEF FIDELITY — Genre, tone, heat, and ending_feel all consistent with the brief? Flag any drift.
8. LOAD-BEARING RISK — Identify the single claim the premise asks the reader to accept that the story must earn on the page. State which movement carries it and whether the shape gives it enough room.
Revise internally until the verdict would be ACCEPT (>=32/40, no criterion below 3). Do not output the scores.

Output JSON ONLY, no prose, no fences:
{ "children": [ { "dramatic_question": "<DRAMATIC_QUESTION sentence>", "shape": { "name": "<2-4 word emotional trajectory>", "movements": ["<movement 1>", "<movement 2>", "<movement 3>", "..."], "ending_feel": "up|down|bittersweet|ambivalent" } } ] }`;
      const data = await callLLM({ model, max_tokens: 1800, system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: `BRIEF:\n${briefContext(brief, { scope: "full", success: true, vision: true, none: "(no brief)", empty: "(empty)" })}\n\nLOGLINE:\n${logline}\n\nDerive the premise. JSON only.` }] }, meta, { signal: req.signal });
      const parsed = JSON.parse(extractJsonBlock(textFromLLM(data)));
      const first = Array.isArray(parsed.children) ? parsed.children[0] : parsed;
      const shape = first?.shape ?? {};
      const movements = (Array.isArray(shape.movements) ? shape.movements : []).map((m: unknown) => String(m ?? "").trim()).filter(Boolean).slice(0, 5);
      const ending = ["up", "down", "bittersweet", "ambivalent"].includes(shape.ending_feel) ? shape.ending_feel : "bittersweet";
      const dramaticQuestion = String(first?.dramatic_question ?? first?.DRAMATIC_QUESTION ?? "").trim();
      if (!dramaticQuestion || movements.length < 3) return json({ error: "Premise generation returned an incomplete premise — try again." }, 502);
      return json({ childKind: "premise", childLevel: 1, children: [{
        dramatic_question: dramaticQuestion,
        shape: { name: String(shape.name ?? "").trim(), movements, ending_feel: ending },
      }], callId: meta.loggedCallId ?? null });
    }

    if (target === "sketch") {
      // Scene → sketch: the TREATMENT between the scene's plan and its prose (doc_1783196400000_dna_scene_
      // sketch_layer.md, doc_1783198900000_dna_scene_direction.md) — WHAT happens (a handful of moves) and
      // HOW it's shown (cut points, psychic distance, mode, time, tension). Cheap structured JSON, on-worker,
      // so the presentation choice is made BEFORE paying for the long prose stream. Reuses the exact same
      // scoped context prose gets (proseScope/beatNeighbourhoodBlock/entryStateBlock/settingBlock/
      // disclosureBlock/registerBlock/prevProseBlock/briefBlock — all already assembled into `ctx` above).
      if (node.kind !== "scene") return json({ error: "'sketch' only applies to a scene node" }, 400);
      const system = `You are a story editor writing ONE scene's TREATMENT — the low-resolution plan between its structural spec and its prose. Output JSON ONLY, no prose, no fences.

Two parts:
1. MOVES (3–7): what happens, in order — beats of ACTION, never dialogue lines or prose. Each move may optionally reference a thread id it works (from THREADS/ENTRY STATE above) and a sensory detail picked from the scene's location palette (SETTING above).
2. DIRECTION — how this page is SHOWN:
${SCENE_DIRECTION_CRAFT}

Rules:
- SEAM (continuity — the load-bearing rule): decide how this scene joins the one before it and set "link" accordingly, honoring <previous_scene_exit> above:
  · "continuous" — same time and place, the very next moment: "opening" picks up immediately from that exit, no time-skip.
  · "cut" — a new time/place: "opening" jumps, BUT its FIRST move must acknowledge or pay off whatever that exit left charged and open (a closed door, a held breath, an unspoken thing) — never silently drop it.
  · "same_moment_new_pov" — this scene re-enters the SAME moment from a different POV: moves must NOT re-stage the action already shown; go interior and push it forward.
  A charged, unresolved previous exit with a scene that neither continues nor bridges it is a continuity break — do not produce one. (First scene / no previous exit: choose "continuous" and ignore this rule.)
- If this scene PAYS OFF a thread, REALIZES a tentpole, or LANDS its beat's value turn (see ENTRY STATE / THIS NODE above for its threads/realizes_tentpole/value_shift), that moment must NOT be "summary" mode or "far" distance — a promise that's merely reported, not dramatized, is a promise the reader won't feel delivered.
- Vary mode/distance/tension from the immediately PRIOR sketched scene if you can see it (BEAT PLAN / entry state above) — adjacent scenes should not read the same way twice in a row.
- Never write actual dialogue lines or prose sentences — moves describe WHAT turns, not WHAT'S SAID.

Output JSON ONLY: {"link":"continuous|cut|same_moment_new_pov","opening":"...","moves":[{"what":"...","thread":"<thread id, optional>","sense":"<e.g. smell:tar, optional>"}],"exit":"...","direction":{"cut":{"in":"...","out":"..."},"distance":"far|mid|close|deep","mode":"dialogue|action|interior|description|summary","time":"real|compressed|stretched","tension":"suspense|mystery|irony"}}`;
      const data = await callLLM({ model, max_tokens: 1200, system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: `${ctx}\n\nWrite this scene's sketch. JSON only.` }] }, meta, { signal: req.signal });
      try {
        const parsed = JSON.parse(extractJsonBlock(textFromLLM(data)));
        return json({ sketch: parsed, callId: meta.loggedCallId ?? null });
      } catch {
        return json({ error: "Sketch generation returned unparsable JSON — try again." }, 502);
      }
    }

    if (target === "prose" || (!target && node.kind === "scene")) {
      // Scene → prose: fill the scene's own text. One true draft, in voice.
      const system = `You are a novelist writing the PROSE for one scene, from its plan. Write the scene fully — vivid, causal, in the book's voice — honoring the MANDATE (heat/tone/length) without laundering. Output the prose ONLY: no preamble, no headings, no JSON.

CONTINUITY — obey the SEAM instruction in the context: it tells you where the story stands (the previous scene's exit) and how this scene joins it. Move the story FORWARD from that point. Do NOT recap, re-narrate, or re-stage anything the previous scene already showed, and never leave a charged, open moment it ended on silently dropped.

VOICE — write ONLY the fiction, from inside the story: NEVER address or mention "the reader"/"you", and NEVER refer to "the book", "the story", "the scene", "the page", the author, or the writing itself. The plan's notes describe INTENT in craft terms (e.g. "the reader is told it reads as fury", "the book plants the wrong label") — those are directions TO YOU, not lines to reproduce. Dramatize that intent through concrete action, sensation, and subtext; never narrate it or break the fourth wall.

ANTI-REPETITION (critical): Never repeat any physical gesture, character reaction, sentence structure, or phrase within this scene — not even once. If a character smirks in paragraph 2, they cannot smirk (or twitch, or smile faintly) again. Each beat of the scene must be rendered with entirely fresh language. If you feel the urge to reuse a phrase or gesture, stop and invent a different one. This scene ends when the plan's goal/outcome is dramatized — do not loop, pad, or re-dramatize beats already written.

CRAFT VARIETY (anti-tic) — mined from finished drafts (docs/structure-miner.md): these default moves, each fine once, read machine-written when they become every scene's move. Hard budgets for THIS scene:
- CLOSURE: do NOT end by circling back to the scene's opening image/gesture/weather (a bookend) — end on a new image, a hard cut, a spoken line, or a decision instead.
- WEATHER: do not open OR close on weather/room-atmosphere by default; earn it or skip it.
- INTERIORITY: do not default to the POV decoding someone's micro-expression or physical tell; rotate channels — memory, bodily sensation, direct thought, a choice made and acted on.
- EM-DASHES: at most one per ~300 words; prefer commas, periods, or restructured sentences.
- CLIMAX CADENCE: do not automatically drop into staccato fragments at the emotional peak; vary how the peak is paced.
- NEGATION-DEFINITION: the "it wasn't X, it was Y" pattern at most once per scene.`;
      const userContent = `${ctx}\n\nWrite this scene's prose.`;
      // Browser-streamed path: hand back the assembled request; the client streams it via the stream-prose edge fn.
      // `provider` carries the admin's ai_provider setting to the proxy, which has no admin_settings read of
      // its own — this worker is the authority on both which model and which host runs the call.
      if (prepare) return json({ prepared: { system, userContent, model, max_tokens: 8000, provider: await getActiveProvider() } });
      const data = await callLLM({ model, max_tokens: 8000, system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userContent }] }, meta, { signal: req.signal });
      return json({ prose: textFromLLM(data).trim(), callId: meta.loggedCallId ?? null });
    }

    if (target === "beatsheet") {
      // GLOBAL beat-sheet pass (root fix): generate EVERY beat in one call with the whole arc + the thread
      // registry in view, so promises schedule setup→payoff in order and polarity is planned to oscillate.
      // Returns a flat, act-indexed list; the client persists it grouped under each act.
      //
      // Split into two stateless phases (todo/dna-streaming-proxy.md pattern, extended to a second target):
      // the LLM generation(s) run OFF this worker via the browser-driven stream-prose edge fn, so the beat
      // sheet's up-to-two sequential 8000-token calls never ride this worker's own wall-clock budget — the same
      // failure class that forced prose off-worker. "prepare" returns the assembled request; "finalize" does
      // the (cheap, deterministic) parse/sanitize/lint/repair-decision, re-deriving context on every call so
      // any phase can be retried alone without a stall in one dragging the others down with it.
      if (!acts.length) return json({ error: "generate the acts before the beat sheet" }, 400);

      // ── Context scoping for the beat rung (doc_1783355490398) ────────────────────────────────────────
      // The beat sheet SCHEDULES structure (causality, thread setup→payoff, polarity); it does NOT render
      // prose or place scenes in rooms. So it gets a PLANNING slice, not the whole bible: the arc + a slim
      // cast (name/role/want/lie — the only fields beats + arc-thread minting use) + the thread/tentpole/game/
      // rule registries that exist. Dropped vs the shared render ctx: LOCATIONS (beats carry no `loc` — sensory
      // palettes are a scene/prose concern) and the full-JSON cast dump (idiolect/wound/voice detail is
      // prose-rung noise). Same principle as proseScope on the render side: each rung sees the slice it consumes.
      // realLie also normalizes the "N/A" placeholder to empty, so a lie-less cast member (or a pre-story ghost)
      // is not fed as though it carried a real inner arc — and does not get a nonsensical arc thread minted below.
      const realLie = (c: Node) => { const l = String((c.content as { lie?: string }).lie ?? "").trim(); return l && !/^n\s*\/?\s*a$/i.test(l) ? l : ""; };
      const castDigest = chars.length
        ? "CAST (reference BY NAME):\n" + chars.map((c) => {
            const cc = c.content as { role?: string; want?: string };
            const lie = realLie(c);
            return `- ${cName(c)} [${cc.role ?? "?"}]${cc.want ? ` · wants: ${cc.want}` : ""}${lie ? ` · lie: ${lie}` : ""}`;
          }).join("\n")
        : "";
      // STRUCTURE TEMPLATE (structureForBook — pillar.structure, default weiland_3act, "none" opts out):
      // the plot-skeleton slots the sheet must deliver, each on exactly ONE beat marked with "slot". Craft
      // lines are guidance-by-name (like tentpoles) — a job description honored in the sheet's own words.
      const structure = structureForBook(nodes);
      // The template's acts carry a CUMULATIVE target_pct (Weiland: .25/.75/1) — turn it into per-act SPANS so
      // the model sizes each act to its share of the book. This is the fix for the starved-Act-2 failure: the
      // slot list alone never told the model Act 2 (Confrontation) is HALF the book, so it split beats evenly.
      const actSpans = structure
        ? structure.acts.map((a, i) => {
            const start = i === 0 ? 0 : structure!.acts[i - 1].target_pct;
            return { n: i + 1, title: a.title, purpose: a.purpose, start, end: a.target_pct, span: a.target_pct - start };
          })
        : [];
      const longestActSpan = actSpans.reduce((m, a) => Math.max(m, a.span), 0);
      const structureBlock = structure
        ? `STRUCTURE TEMPLATE — ${structure.label}. The sheet must deliver every SLOT below, each carried by EXACTLY ONE beat, in this order, landing near its stated % of the whole book (interstitial beats between slots are welcome). Mark the carrying beat with "slot": "<key>".\n` +
          `ACT PROPORTIONS — allocate beats so each act fills its SPAN of the book (an act's beat count ∝ its span; the longest act gets the most beats — never split beats evenly across acts):\n` +
          actSpans.map((a) => `- Act ${a.n} ${a.title} — ${Math.round(a.start * 100)}%→${Math.round(a.end * 100)}% (${Math.round(a.span * 100)}% of the book${a.span >= longestActSpan ? ", the LONGEST — most beats" : ""}): ${a.purpose}`).join("\n") + "\n" +
          `SLOTS:\n` +
          structure.slots.map((s) => `- ${s.key} (${s.label}, ~${Math.round(s.at * 100)}%, act ${s.act}${s.polarity ? `, ends ${s.polarity}` : ""}): ${s.craft}`).join("\n")
        : "";
      const beatCtx = [
        `BOOK: ${book?.name ?? ""}`,
        `BRIEF (binding):\n${briefContext(brief, { scope: "full", success: true, vision: true, none: "(no brief)", empty: "(empty)" })}`,
        mandate ? `MANDATE — NON-NEGOTIABLE:\n${mandate}` : "",
        "STORY SO FAR (the ladder above this node; LOCKED items are immutable):",
        ...chain.map((a) => `[${a.kind}${a.authoring?.locked ? " · LOCKED" : ""}] ${JSON.stringify(a.content)}`),
        castDigest,        // slim cast — NOT the full-JSON dump; NO locations
        threadBlock,       // pre-declared threads (empty when minting)
        tentpoleBlock,
        worldRulesBlock,
        gamesBlock,
        precondBlock,      // [EXP:preconditions]
        actBlock,          // THE ARC — the skeleton the beats interpolate
        structureBlock,    // the plot-skeleton slots (empty when structure = "none")
        briefBlock,        // the agent's curated guidance (empty when none)
        `THIS NODE [${node.kind}]: ${JSON.stringify(node.content)}`,
      ].filter(Boolean).join("\n\n");

      // Threads are DERIVED, not required (docs/dna-structure-analysis.md Finding 1): a thread's identity is its
      // setup→payoff schedule across beats, which only exists once the beat sheet does. When no registry was
      // pre-declared, the beat sheet MINTS one in the same pass (emit a `threads` array) and schedules it;
      // author-declared threads are honored as constraints when present. A thread is a materialized index over
      // beats, and indexes are built, not hand-authored.
      const mintThreads = !threads.length;
      const mintId = () => `n_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
      // Characters whose declared inner arc (lie → truth) exists as data: each gets an ARC thread minted in
      // the same pass, so the promise machinery (dangling_promise etc.) covers character arcs — a declared
      // lie that no beat ever schedules is otherwise invisible to the plan (the dead-field problem).
      const arcCast = mintThreads ? chars.filter((c) => realLie(c)) : [];
      const system = `You are a story architect writing the ENTIRE BOOK'S BEAT SHEET in ONE pass — every beat of every act at once, so you can see the whole sequence. Honor every LOCKED ancestor and the MANDATE verbatim. Rules:${mintThreads ? `
- FIRST design the THREAD REGISTRY: 3–6 open loops (a promise set up early, paid off later) this book runs on — mysteries, foreshadowed reveals, setup→payoff arcs. Give each a short NAME, a "promise" (what's opened), and a "payoff" (how it closes). Then schedule them across the beats below. Emit them in a top-level "threads" array.${arcCast.length ? `
- ALSO mint each of these characters' ARC thread (they carry a declared lie): ${arcCast.map((c) => cName(c)).join(", ")}. One per character — kind "arc", "character" = their name, promise = the LIE as it will be DRAMATIZED early (shown in action, not stated), payoff = the moment the TRUTH is accepted or fatally refused. Schedule each arc across the beats like any other thread (setup early, advance through the middle, pay off at that character's turn).` : ""}` : ""}
- ${structure ? "3 to 6" : "2 to 4"} beats per act${structure ? ", PROPORTIONAL to each act's span in ACT PROPORTIONS above — the longest act (~half the book) gets roughly double the beats of a short act; never split beats evenly" : ""}; each beat links to the prior with "therefore" or "but" (escalating causality).${structure ? `
- DELIVER the STRUCTURE TEMPLATE: every slot listed above lands on exactly ONE beat — mark that beat with "slot": "<key>" — in template order, positioned so the beat sits near the slot's stated % of the whole sheet. Honor each slot's craft in your own words (guidance, not a script line); a slot marked "ends down/up" fixes that beat's polarity. A slot named as a hard TURN (midpoint, plot points) must be a real external reversal on the page, never a quiet internal shift.` : ""}
- ${POLARITY_CRAFT}
- Schedule the THREADS across the whole book: every promise must be SET UP (role:setup) in an EARLIER beat before it is PAID OFF (role:payoff) in a LATER beat; use "advance" for beats that develop it in between. Reference threads BY NAME.
- ${CAUSALITY_CRAFT}${tentpoles.length ? `\n- HONOR every TENTPOLE: each names an emotional/scene quality the story must deliver (a feel, an image, a turn) — not a line to reproduce. Pick the ONE beat whose turn embodies it and reference the tentpole BY NAME in "realizes"; write the beat's summary in your own words. Every tentpole listed must appear on exactly one beat.` : ""}${worldFacts.length ? `\n- GROUND the turns in the WORLD RULES: when a beat's turning point's outcome OPERATES ON a rule's mechanism, list that rule in "grounds_in" (by name). The CLIMAX / final resolution beat MUST ground its win in an established rule — the victory has to be MECHANICALLY EARNED by a rule the reader already knows, never deus ex machina. Plant the rule's setup in an earlier beat too.` : ""}${games.length ? `\n- PLAY the GAMES: each beat that advances a contest lists it in "plays" (by name). Each game MUST be RESOLVED — exactly one beat lists it in "resolves" with its outcome (won|lost), and the CENTRAL game resolves at the CLIMAX. A game's resolving beat should also ground_in the rule its win/lose fires.` : ""}${statePreconds.length ? `\n- ESTABLISH every STATE PRECONDITION: each game's win SPENDS resources/states (listed above). For each, an EARLIER beat must establish it (list its key in that beat's "establishes") BEFORE the beat that resolves the game — you cannot spend a resource the story never acquired (no "she had enough all along"). Make the establishing a real turn.` : ""}
Output JSON ONLY: { ${mintThreads ? `"threads": [ { "name": "...", "promise": "...", "payoff": "...", "kind": "mystery"|"foreshadow"|"setup_payoff"|"arc"${arcCast.length ? `, "character": "<cast name — arc threads only>"` : ""} } ], ` : ""}"beats": [ { "act": <1..${acts.length}>, "summary": "...", "connector": "therefore"|"but", "polarity": "up"|"down"${structure ? `, "slot": "<structure slot key — ONLY on the one beat that carries it>"` : ""}, "threads": [ { "ref": "<thread name>", "role": "setup"|"advance"|"payoff" } ]${tentpoles.length ? `, "realizes": [ "<tentpole name>" ]` : ""}${worldFacts.length ? `, "grounds_in": [ "<world rule name>" ]` : ""}${games.length ? `, "plays": [ "<game name>" ], "resolves": [ { "ref": "<game name>", "outcome": "won|lost" } ]` : ""}, "needs": [ "<state key earned upstream>" ], "establishes": [ "<state key this beat produces>" ] } ] }`;
      // Browser-streamed path: hand back the assembled request; the client streams it via the stream-prose edge fn,
      // then calls back with phase "finalize" (mirrors the prose `prepare` split, todo/dna-streaming-proxy.md).
      if (phase === "prepare") {
        // 16000 not 8000: a REASONING model (deepseek-v4-pro) counts its thinking phase INSIDE max_tokens, so
        // 8000 left the beat-sheet JSON truncated mid-array (the silent degrade behind book 1237's unslotted
        // sheet). The sheet itself is bounded; the extra ceiling is headroom for the reasoning that precedes it.
        return json({ prepared: { system, userContent: `${beatCtx}\n\nWrite the whole beat sheet. JSON only.`, model, max_tokens: 16000, provider: await getActiveProvider() } });
      }
      if (phase !== "finalize") return json({ error: "beatsheet requires phase 'prepare' or 'finalize'" }, 400);
      if (!rawText) return json({ error: "finalize requires rawText" }, 400);

      const parsed = JSON.parse(extractJsonBlock(rawText));
      const rawBeats = Array.isArray(parsed.beats) ? parsed.beats : [];
      // When minting: turn the model's declared registry into real thread nodes (ids assigned HERE so beats can
      // reference them), returned to the client to persist under the pillar. Beats reference threads by NAME,
      // resolved below against the minted set — same as the pre-declared case. Derived ONLY from the primary
      // generation (rawText) — a repair pass never re-mints the registry.
      const THREAD_KINDS = new Set(["mystery", "foreshadow", "setup_payoff", "arc"]);
      // Arc threads carry the character they belong to on `owner` (the same about-node slot the game-resolution
      // twin uses) — resolved name→id here so the engine's arc lints can join thread↔character by id.
      const charNameToId = new Map(chars.map((c) => [cName(c).toLowerCase(), c.id]));
      const mintedThreads: { id: string; content: Record<string, unknown> }[] = mintThreads
        ? (Array.isArray(parsed.threads) ? parsed.threads as Record<string, unknown>[] : [])
            .map((t) => ({ name: String(t.name ?? "").trim(), promise: String(t.promise ?? "").trim(), payoff: String(t.payoff ?? "").trim(), kind: t.kind,
              owner: charNameToId.get(String(t.character ?? "").trim().toLowerCase()) }))
            .filter((t) => t.name && t.promise)
            .map((t) => ({ id: mintId(), content: { name: t.name, promise: t.promise, ...(t.payoff ? { payoff: t.payoff } : {}),
              kind: THREAD_KINDS.has(String(t.kind)) ? t.kind : "setup_payoff", ...(t.owner ? { owner: t.owner } : {}) } }))
        : [];
      // The name→id map the beat pass resolves thread refs against — the minted registry when minting, else the
      // pre-declared threads. `tName` reads the `name` field either way.
      const tNameToId = mintThreads
        ? new Map(mintedThreads.map((t) => [String(t.content.name ?? "").trim().toLowerCase(), t.id]))
        : new Map(threads.map((t) => [tName(t).toLowerCase(), t.id]));
      const tpNameToId = new Map(tentpoles.map((t) => [tpName(t).toLowerCase(), t.id]));
      const wfNameToId = new Map(worldFacts.map((w) => [wfName(w).toLowerCase(), w.id]));
      const gNameToId = new Map(games.map((g) => [gName(g).toLowerCase(), g.id]));
      const normKey = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, "_");
      const roles = new Set(["setup", "payoff", "advance"]);
      // Resolve refs, clamp act index, then ENFORCE setup→payoff order (drop orphan payoffs). Wrapped as a fn
      // so P2.1's repair path (below) can re-run it on a repaired sheet — fresh dedup sets per call.
      const slotKeys = new Set((structure?.slots ?? []).map((s) => s.key));
      const sanitize = (raw: Record<string, unknown>[]) => {
      const setUp = new Set<string>();
      const claimedTp = new Set<string>(); // a tentpole is realized by at most ONE beat (first claim wins)
      const resolvedG = new Set<string>(); // a game is resolved by at most ONE beat (first claim wins)
      const claimedSlot = new Set<string>(); // a structure slot is carried by at most ONE beat (first claim wins)
      return raw.map((b: Record<string, unknown>) => {
        const mi = Math.min(Math.max(parseInt(String(b.act ?? 1), 10) || 1, 1), acts.length) - 1;
        const refs = (Array.isArray(b.threads) ? b.threads as { ref?: string; role?: string }[] : [])
          .map((t) => ({ ref: tNameToId.get(String(t.ref ?? "").trim().toLowerCase()), role: t.role }))
          .filter((t): t is { ref: string; role: string } => !!t.ref && roles.has(String(t.role)));
        for (const t of refs) if (t.role === "setup") setUp.add(t.ref);
        const threadsKept = refs.filter((t) => t.role !== "payoff" || setUp.has(t.ref));
        const realizes = (Array.isArray(b.realizes) ? b.realizes as string[] : [])
          .map((s) => tpNameToId.get(String(s ?? "").trim().toLowerCase()))
          .filter((id): id is string => !!id && !claimedTp.has(id) && (claimedTp.add(id), true));
        const grounds = [...new Set((Array.isArray(b.grounds_in) ? b.grounds_in as string[] : [])
          .map((s) => wfNameToId.get(String(s ?? "").trim().toLowerCase()))
          .filter((id): id is string => !!id))];
        const plays = [...new Set((Array.isArray(b.plays) ? b.plays as string[] : [])
          .map((s) => gNameToId.get(String(s ?? "").trim().toLowerCase()))
          .filter((id): id is string => !!id))];
        const resolves = (Array.isArray(b.resolves) ? b.resolves as { ref?: string; outcome?: string }[] : [])
          .map((r) => ({ ref: gNameToId.get(String(r.ref ?? "").trim().toLowerCase()), outcome: r.outcome === "lost" ? "lost" : "won" }))
          .filter((r): r is { ref: string; outcome: string } => !!r.ref && !resolvedG.has(r.ref) && (resolvedG.add(r.ref), true));
        // CAUSALITY (core): general state keys this beat produces / depends on (open snake_case vocabulary).
        // The experiment's game-win preconditions are just a mandatory SUBSET of establishes — no filter here.
        const establishes = [...new Set((Array.isArray(b.establishes) ? b.establishes as string[] : []).map(normKey).filter(Boolean))];
        const needs = [...new Set((Array.isArray(b.needs) ? b.needs as string[] : []).map(normKey).filter(Boolean))];
        const content: Record<string, unknown> = { summary: b.summary, connector: b.connector, polarity: b.polarity === "down" ? "down" : "up", threads: threadsKept };
        // Structure slot: keep only template keys, one beat per slot (mirrors the tentpole first-claim rule).
        const slot = normKey(b.slot);
        if (slot && slotKeys.has(slot) && !claimedSlot.has(slot)) { claimedSlot.add(slot); content.slot = slot; }
        if (realizes.length) content.realizes = realizes;
        if (grounds.length) content.grounds_in = grounds;
        if (plays.length) content.plays = plays;
        if (resolves.length) content.resolves = resolves;
        if (establishes.length) content.establishes = establishes;
        if (needs.length) content.needs = needs;
        return { act: mi, content };
      });
      };
      let beats = sanitize(rawBeats);

      // ── Canonicalize the causal-state vocabulary (docs/agent-improvement-plan.md P3/§3c) ────────────────
      // `needs`/`establishes` are open snake_case keys, so a typo/plural (`redemption_fund` vs
      // `redemption_funds`) would split the DAG into two facts and make a real "therefore" look uncaused.
      // Pass 1: fold each beat's `establishes` into a canonical set (first-seen spelling wins). Pass 2: snap
      // every beat's `needs` onto that canonical set. Deterministic — the fix doesn't depend on the P2.1
      // repair model noticing. Scenes inherit these canonicalized keys via realizeScenesFromBeat.
      {
        const canon = new Set<string>();
        for (const b of beats) {
          const es = Array.isArray(b.content.establishes) ? b.content.establishes as string[] : [];
          const mapped = [...new Set(es.map((k) => { const c = canonicalizeKey(k, canon); canon.add(c); return c; }))];
          if (mapped.length) b.content.establishes = mapped; else delete b.content.establishes;
        }
        for (const b of beats) {
          const ns = Array.isArray(b.content.needs) ? b.content.needs as string[] : [];
          if (ns.length) b.content.needs = [...new Set(ns.map((k) => canonicalizeKey(k, canon)))];
        }
      }

      // ── Lint (docs/agent-improvement-plan.md P2.1) ──────────────────────────────────────────────────────
      // The sanitizer silently DROPS orphan payoffs / dup tentpole claims etc., each of which can leave a
      // hollow causal link the model was never told about — the opposite of validateOps' fail-closed write
      // gate. Run the shared engine's BEAT-NATIVE lints over the just-sanitized sheet. Only beat-stage rules:
      // the tree has no scenes yet, so scene/meter/tentpole-placement lints would false-positive or stay
      // silent — causality + game structure is what's actually decidable at this rung.
      const BEAT_LINT_RULES = new Set(["uncaused_therefore", "empty_but", "beat_connector", "illegal_resolution", "unresolved_game",
        // Structure-slot rules are beat-native too (plan plane, no scenes needed) — a sheet that skipped the
        // midpoint or parked the climax at 60% gets the same one bounded repair turn as a causality hole.
        "slot_missing", "slot_misplaced", "slot_misordered", "slot_duplicate", "slot_unknown"]);
      // Existing accepted tree, minus any prior beats/scenes (the sheet REPLACES all beats; scenes don't exist
      // yet) — the causal/game context the beat lints validate against.
      const otherNodes: DnaNode[] = nodes.filter((n) => n.kind !== "beat" && n.kind !== "scene").map((n) => ({
        id: n.id, book_id: bookId, parent_id: n.parent_id, level: 0, kind: n.kind as NodeKind, position: n.position ?? 0,
        // The pillar gets the RESOLVED structure key stamped on: structureLints activate on an explicit
        // declaration (fail-quiet for legacy trees), but THIS pass definitely asked for the template — a
        // sheet that ignored the slot instruction entirely must still flag slot_missing in the repair turn.
        content: (n.kind === "pillar" && structure ? { ...(n.content ?? {}), structure: structure.key } : (n.content ?? {})) as NodeContent,
        authoring: { source: "user", locked: n.authoring?.locked ?? false, status: (n.authoring?.status as AuthoringStatus) ?? "accepted" }, chosen: null,
      }));
      // Lint a candidate sheet: materialise it as beat nodes under their acts, validate the whole tree, keep
      // the beat-stage rules. Returns the issues + a human pointer per flagged beat so the repair prompt can
      // NAME what to fix. sanitize is a 1:1 order-preserving map, so candidate index i aligns with rawBeats[i].
      const lintBeats = (bs: { act: number; content: Record<string, unknown> }[]) => {
        const perAct = new Map<number, number>();
        const ptr = new Map<string, string>();
        const candBeats: DnaNode[] = bs.map((bt, i) => {
          const pos = perAct.get(bt.act) ?? 0; perAct.set(bt.act, pos + 1);
          ptr.set(`cand_${i}`, `Act ${bt.act + 1}, beat ${pos + 1} ("${String(bt.content.summary ?? "").slice(0, 60)}")`);
          return { id: `cand_${i}`, book_id: bookId, parent_id: acts[bt.act]?.id ?? null, level: 4, kind: "beat" as NodeKind,
            position: pos, content: bt.content as NodeContent, authoring: { source: "user", locked: false, status: "accepted" as AuthoringStatus }, chosen: null };
        });
        return { issues: validate([...otherNodes, ...candBeats]).filter((iss) => BEAT_LINT_RULES.has(iss.rule)), ptr };
      };

      const finish = () => json({ beatsheet: true, childKind: "beat", childLevel: 4, actIds: acts.map((m) => m.id), beats, ...(mintedThreads.length ? { threads: mintedThreads } : {}) });

      // First finalize call (no repairText yet): lint the primary sheet. Clean → done. Issues → hand back the
      // repair prompt for the client to stream (same one-bounded-repair-turn shape as before, just off-worker).
      if (repairText == null) {
        const { issues, ptr } = lintBeats(beats);
        if (!issues.length) return finish();
        const violations = issues.map((iss) => `- ${ptr.get(iss.nodeId ?? "") ?? iss.nodeId}: [${iss.rule}] ${iss.message}`).join("\n");
        // Compose fix instructions per the CLASS of rule that fired. The old prompt spoke ONLY of causality/game
        // repair (connector/needs/establishes/resolves) and forbade adding beats — so a sheet that skipped the
        // structure slots (the 1237 failure) was handed a repair turn that never told it how to fix slots, and
        // couldn't insert the beat a missing signpost needs. Branch the guidance, and relax the no-add rule for
        // slots only (a missing Midpoint/Pinch may be a real hole, not a mislabel).
        const hasSlotIssue = issues.some((iss) => iss.rule.startsWith("slot_"));
        const hasCausalIssue = issues.some((iss) => !iss.rule.startsWith("slot_"));
        const fixLines: string[] = [];
        if (hasCausalIssue) fixLines.push(`For causality/game flags: adjust the offending beats' connector / needs / establishes / resolves so each flagged link is earned (a "therefore" beat must "need" a state key an EARLIER beat "establishes"; a played game must be "resolved").`);
        if (hasSlotIssue) fixLines.push(`For structure-slot flags: honor the STRUCTURE TEMPLATE above — every listed slot is carried by EXACTLY ONE beat, marked "slot": "<key>", in template order, near its stated % of the whole sheet. For "slot_missing": add "slot" to the single existing beat that already does that job; if NO beat does it, INSERT a new beat that does (a missing Midpoint/Pinch is a real structural hole, not a label). For "slot_misordered"/"slot_misplaced": move the slot tag to the beat at the correct order/position (or reorder the beats) so the skeleton lands in template order and proportion. Never tag two beats with the same slot.`);
        const constraint = hasSlotIssue
          ? `Change only what these fixes require. You MAY add or reorder beats solely to deliver a missing/misordered structural slot; otherwise keep beats unchanged.`
          : `Keep every other beat unchanged; do not add or remove beats.`;
        const repairUser = `${beatCtx}\n\nYou produced this beat sheet:\n${JSON.stringify({ beats: rawBeats })}\n\nThe story engine flagged these STRUCTURAL problems in it:\n${violations}\n\nFix ONLY these problems.\n${fixLines.join("\n")}\n${constraint}\nRe-output the COMPLETE beat sheet as JSON in the SAME schema. JSON only.`;
        return json({ needsRepair: true, repairPrepared: { system, userContent: repairUser, model, max_tokens: 16000 } }); // reasoning headroom — see the prepare-phase note
      }

      // Second finalize call: a repair pass was streamed back. Accept it only if it doesn't INCREASE the
      // beat-lint count vs the original sanitized/canonicalized sheet — never ship a worse sheet. Best-effort:
      // any parse failure keeps the original (never worse).
      const originalIssueCount = lintBeats(beats).issues.length;
      try {
        const p = JSON.parse(extractJsonBlock(repairText));
        const rRaw = Array.isArray(p.beats) ? p.beats : [];
        if (rRaw.length) { const repaired = sanitize(rRaw); if (lintBeats(repaired).issues.length <= originalIssueCount) beats = repaired; }
      } catch { /* keep the original sanitized sheet — repair is best-effort */ }
      return finish();
    }

    if (target === "contract") {
      // COMPILE THE BRIEF (W1, docs build plan): a one-time derivation pass that turns the brief's
      // genre/audience/tone/content_type into machine-usable promises — genre-convention TENTPOLES (so
      // tentpole_unplaced becomes the genre-promise-broken lint), SEEDED METERS with target curves (so
      // target_drift/read_gap gain genre teeth), and audience REGISTER BOUNDS for voice_profile.constraints.
      // The client persists idempotently; existing entities are fed in so the model omits duplicates.
      if (!pillar) return json({ error: "accept the pillar before compiling the contract" }, 400);
      // ALL existing tentpoles here (the outer `tentpoles` filters to accepted/locked — a draft one still
      // covers its genre promise for dedupe purposes), plus meter names + current voice constraints.
      const allTentpoles = nodes.filter((n) => n.parent_id === pillar.id && n.kind === "tentpole");
      const meterNodes = nodes.filter((n) => n.parent_id === pillar.id && n.kind === "meter");
      const mName = (e: Node) => String((e.content as { name?: string }).name ?? "").trim();
      const existingBlock = [
        allTentpoles.length ? `Tentpoles already declared (do NOT re-emit a promise these cover):\n${allTentpoles.map((t) => `- ${tpName(t)}`).join("\n")}` : "",
        meterNodes.length ? `Meters already declared (do NOT re-emit these axes):\n${meterNodes.map((m) => `- ${mName(m)}`).join("\n")}` : "",
        vp?.constraints?.length ? `Voice constraints already set (do NOT repeat or contradict):\n${vp.constraints.map((c) => `- ${c}`).join("\n")}` : "",
      ].filter(Boolean).join("\n\n");
      const system = `You are a story architect COMPILING THE BRIEF into the book's derived contract — the concrete promises its genre, audience, tone, and content type make to the reader. Derive ONLY from the BRIEF, the MANDATE, and the VISION (the author's own captured intent — when the vision speaks, it OUTRANKS genre convention; the story-so-far is orientation, not a source of new plot); phrase everything for THIS book. Skip anything the existing registry already covers — empty arrays are fine. Three deliverables:
1. TENTPOLES — from TWO sources: the 3–6 OBLIGATORY scenes/moments this genre owes the reader (e.g. romance: the meet, the dark moment, the grand gesture; thriller: the reveal, the final confrontation), AND every concrete moment the vision's plot points promise — a vision promise is a tentpole even if the genre doesn't demand it; mark each tentpole's source: "genre" or "vision". Give each a short NAME (2-4 words, e.g. "the grand gesture") and a one-line GUIDANCE: the emotional/scene quality it must deliver for THIS book — a feel or turn, not a script line to quote back. For vision tentpoles keep the author's own framing.
2. METERS — the 2–5 numeric axes the brief AND vision jointly demand (a comedy brief → a comedy meter; the content type's heat → a heat meter; most genres → a tension meter; a vision built on secrets → a mystery meter). Each has poles (what low/high FEEL like on the page), a 0–100 scale, and a TARGET curve: 3–7 sparse keyframes { at: 0..1 position through the book, value: 0..100 } encoding the expected shape (e.g. thriller tension: a sawtooth rising to ~90 near the climax, then release; romance heat: slow build with a spike at the midpoint turn). Where the vision states a pacing intent ("slow burn", "one brutal midpoint scene", "keeps it light until the end"), shape that meter's keyframes to encode it.
3. VOICE_CONSTRAINTS — 2–5 short imperative register bounds for THIS audience: vocabulary ceiling/floor, content phrasing limits, sentence-complexity guidance (e.g. "YA: no graphic gore; keep slang timeless, not dated").
Output JSON ONLY: { "tentpoles": [ { "name": "...", "summary": "...", "source": "genre"|"vision" } ], "meters": [ { "name": "...", "kind": "comedy"|"heat"|"tension"|"mystery"|"violence"|"levity"|"affect"|"value"|"custom", "poles": { "low": "...", "high": "..." }, "scale": { "min": 0, "max": 100 }, "target": [ { "at": 0.0, "value": 10 } ] } ], "voice_constraints": [ "..." ] }`;
      const data = await callLLM({ model, max_tokens: 3000, output_config: { effort: "medium" }, system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: `${ctx}${existingBlock ? `\n\nEXISTING REGISTRY:\n${existingBlock}` : ""}\n\nCompile the brief's contract. JSON only.` }] }, meta, { signal: AbortSignal.any([req.signal, AbortSignal.timeout(140_000)]) });
      const parsed = JSON.parse(extractJsonBlock(textFromLLM(data)));
      const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
      const METER_KINDS = new Set(["value", "game_score", "affect", "relationship", "heat", "comedy", "tension", "mystery", "violence", "levity", "custom"]);
      const outTentpoles = (Array.isArray(parsed.tentpoles) ? parsed.tentpoles as Record<string, unknown>[] : [])
        .map((t) => {
          const summary = String(t?.summary ?? "").trim();
          const name = String(t?.name ?? "").trim() || summary.split(/\s+/).slice(0, 6).join(" ");
          // Provenance (docs/vision-to-structure.md D2): which contract source promised this moment.
          const source = t?.source === "vision" ? "vision" : "genre";
          return { name, summary, source };
        }).filter((t) => t.summary);
      const outMeters = (Array.isArray(parsed.meters) ? parsed.meters as Record<string, unknown>[] : [])
        .map((m) => {
          const scaleRaw = (m?.scale ?? {}) as { min?: unknown; max?: unknown };
          const min = Number.isFinite(Number(scaleRaw.min)) ? Number(scaleRaw.min) : 0;
          const max = Number.isFinite(Number(scaleRaw.max)) && Number(scaleRaw.max) > min ? Number(scaleRaw.max) : 100;
          const poles = (m?.poles ?? {}) as { low?: unknown; high?: unknown };
          const target = (Array.isArray(m?.target) ? m.target as { at?: unknown; value?: unknown }[] : [])
            .map((p) => ({ at: Number(p?.at), value: Number(p?.value) }))
            .filter((p) => Number.isFinite(p.at) && Number.isFinite(p.value))
            .map((p) => ({ at: clamp(p.at, 0, 1), value: clamp(p.value, min, max) }))
            .sort((a, b) => a.at - b.at);
          return {
            name: String(m?.name ?? "").trim(),
            kind: METER_KINDS.has(String(m?.kind)) ? String(m.kind) : "custom",
            poles: { low: String(poles.low ?? "").trim(), high: String(poles.high ?? "").trim() },
            scale: { min, max },
            ...(target.length ? { target } : {}),
          };
        }).filter((m) => m.name);
      const voice_constraints = (Array.isArray(parsed.voice_constraints) ? parsed.voice_constraints as unknown[] : [])
        .map((c) => String(c ?? "").trim()).filter(Boolean);
      return json({ contract: true, tentpoles: outTentpoles, meters: outMeters, voice_constraints, callId: meta.loggedCallId ?? null });
    }

    // Generic DNA target: load config from node_type_configs, rebuild ctx with slot-filtered blocks.
    const { data: config } = await db
      .from("node_type_configs")
      .select("target, child_kind, child_level, role, count, schema_json, slots")
      .eq("target", target ?? "")
      .maybeSingle() as { data: NodeTypeConfig | null };
    if (!config) return json({ error: `Unknown expand target "${target}"` }, 400);
    const slots = (config.slots ?? {}) as SlotConfig;
    const slottedCtx = [
      `BOOK: ${book?.name ?? ""}`,
      `BRIEF (binding):\n${briefContext(brief, { scope: "full", success: true, vision: true, none: "(no brief)", empty: "(empty)" })}`,
      mandate ? `MANDATE — NON-NEGOTIABLE:\n${mandate}` : "",
      slots.voice ? voiceBlock : "",
      "STORY SO FAR (the ladder above this node; LOCKED items are immutable):",
      ...chain.map((a) => `[${a.kind}${a.authoring?.locked ? " · LOCKED" : ""}] ${JSON.stringify(a.content)}`),
      slots.entities ? entityBlock : "",
      slots.entities ? locationBlock : "",
      slots.entities && settingBlock ? settingBlock : "",
      slots.threads ? threadBlock : "",
      slots.tentpoles ? tentpoleBlock : "",
      slots.worldRules ? worldRulesBlock : "",
      slots.games ? gamesBlock : "",
      slots.preconditions ? precondBlock : "", // [EXP:preconditions]
      slots.arc ? actBlock : "",
      slots.priorScenes ? priorScenesBlock : "",
      briefBlock, // the agent's curated, verbatim guidance for this pass (empty when no brief was given)
      `THIS NODE [${node.kind}]: ${JSON.stringify(node.content)}`,
    ].filter(Boolean).join("\n\n");
    const system = `You are a story architect expanding a ${node.kind} into ${config.role}. Generate ${config.count} ${config.child_kind}s as ONE authoritative structure — NOT alternatives to choose among. Honor every LOCKED ancestor and the MANDATE verbatim. Output JSON ONLY: { "children": [ ${config.schema_json} ] }`;
    const data = await callLLM({ model, max_tokens: 4000, system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `${slottedCtx}\n\nGenerate the ${config.child_kind}s. JSON only.` }] }, meta, { signal: req.signal });
    const parsed = JSON.parse(extractJsonBlock(textFromLLM(data)));
    let children = Array.isArray(parsed.children) ? parsed.children : [];
    if (config.child_kind === "relationship") {
      // Resolve a/b from character NAME → node id; drop any pairing that doesn't resolve to two real chars.
      const nameToId = new Map(chars.map((c) => [cName(c).toLowerCase(), c.id]));
      children = children
        .map((ch: Record<string, unknown>) => ({ ...ch, a: nameToId.get(String(ch.a ?? "").trim().toLowerCase()), b: nameToId.get(String(ch.b ?? "").trim().toLowerCase()) }))
        .filter((ch: { a?: string; b?: string }) => ch.a && ch.b && ch.a !== ch.b);
    }
    if (config.child_kind === "beat" || config.child_kind === "scene") {
      // Resolve each thread ref from thread NAME → node id; drop unresolved refs / bad roles.
      const tNameToId = new Map(threads.map((t) => [tName(t).toLowerCase(), t.id]));
      const roles = new Set(["setup", "payoff", "advance"]);
      children = children.map((ch: Record<string, unknown>) => {
        const raw = Array.isArray(ch.threads) ? (ch.threads as { ref?: string; role?: string }[]) : [];
        const resolved = raw
          .map((t) => ({ ref: tNameToId.get(String(t.ref ?? "").trim().toLowerCase()), role: t.role }))
          .filter((t) => t.ref && roles.has(String(t.role)));
        const { threads: _drop, ...rest } = ch;
        return resolved.length ? { ...rest, threads: resolved } : rest;
      });
    }
    if (config.child_kind === "game") {
      // Resolve players (char names→ids) + governing_rules (rule names→ids). couples.to references SIBLING
      // games being minted in this same batch — leave it as a NAME for the client to resolve post-mint.
      const cNameToId = new Map(chars.map((c) => [cName(c).toLowerCase(), c.id]));
      const wfNameToId = new Map(worldFacts.map((w) => [wfName(w).toLowerCase(), w.id]));
      const effects = new Set(["void", "raise", "lower", "enable"]);
      const whens = new Set(["won", "lost"]);
      children = children.map((ch: Record<string, unknown>) => ({
        ...ch,
        players: [...new Set((Array.isArray(ch.players) ? ch.players as string[] : []).map((p) => cNameToId.get(String(p ?? "").trim().toLowerCase())).filter(Boolean))],
        governing_rules: [...new Set((Array.isArray(ch.governing_rules) ? ch.governing_rules as string[] : []).map((r) => wfNameToId.get(String(r ?? "").trim().toLowerCase())).filter(Boolean))],
        couples: (Array.isArray(ch.couples) ? ch.couples as { to?: string; when?: string; effect?: string; note?: string }[] : [])
          .filter((k) => k.to && whens.has(String(k.when)) && effects.has(String(k.effect)))
          .map((k) => ({ to: String(k.to).trim(), when: k.when, effect: k.effect, note: k.note })), // `to` = game NAME, resolved client-side
        // [EXP:preconditions] keep typed win_requires; state preconditions need a key (else untrackable).
        ...(EXP_PRECONDITIONS ? { win_requires: (Array.isArray(ch.win_requires) ? ch.win_requires as { type?: string; what?: string; key?: string }[] : [])
          .filter((r) => (r.type === "rule" || r.type === "state") && r.what)
          .map((r) => ({ type: r.type, what: r.what, ...(r.type === "state" && r.key ? { key: String(r.key).trim().toLowerCase().replace(/\s+/g, "_") } : {}) })) } : {}),
      }));
    }
    return json({ childKind: config.child_kind, childLevel: config.child_level, children, callId: meta.loggedCallId ?? null });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
