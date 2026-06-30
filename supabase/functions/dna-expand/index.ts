// dna-expand — Phase 5: the "expand" verb for the Novel DNA tree. Generates a node's next rung as ONE
// authoritative version (NOT 2–3 proposals to choose among): the AI fills the structure, the author then
// edits / regenerates / locks. See docs/novel-dna-schema.md + novel-dna-spec.md §6.
//
//   client → POST { bookId, nodeId } → load node + ancestors + mandate → Claude → { children } | { prose }
//
// Locked ancestors are hard constraints; accepted siblings give local coherence. Scene → prose fills the
// scene's own text. Needs ANTHROPIC_API_KEY. The bridge (scripts/eval-bridge.mjs) mirrors this for dev.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { callClaude, textFromClaude, type CallMeta } from "../_shared/claude.ts";
import { getActiveModels, DIGEST_MODEL } from "../_shared/model-config.ts";
import { extractJsonBlock } from "../_shared/json.ts";
import { type Brief, briefContext, mandateContext } from "../_shared/brief.ts";
import { isChainCall } from "../_shared/self-chain.ts";
import { serviceClient } from "../_shared/task.ts";

// The rolling continuity digest cached per scene node (authoring.prose_digest). `value` = the accumulator
// covering all prosed pages UP TO AND INCLUDING this one; src_hash = this page's prose; prev_hash chains to
// the accumulator it was folded onto (so editing any earlier page invalidates the whole suffix).
interface DigestLedger { characters?: string[]; objects?: string[]; locations?: string[]; timeline?: string; open_threads?: string[] }
// A reader's takeaway from the story so far: what actually LANDED, with a memory weight (1–5). Models the
// experiential read — not every fact, but the things a reader would carry forward and feel. Recurring or
// emotionally charged notes accumulate weight; the next page's writer sees the highest-weight ones so the
// prose stays loyal to what resonates, not just to what's literally true. See docs/true-agent.md.
interface DigestImpression { note: string; weight: number }
interface DigestAccum { pages: string[]; ledger: DigestLedger; impressions?: DigestImpression[] }
// `v` bumps when the accumulator shape or the digest model/prompt changes — an older `v` invalidates the
// whole cached chain (we re-fold rather than trust a digest built by a weaker model or an older schema).
const DIGEST_VERSION = 2;
// The fold runs synchronously on the worker (~150s wall-clock ceiling). A cold backfill of an existing
// many-page book would do N sequential folds and blow it. Cap the time spent folding per call: when the
// budget is hit we stop and return the partial digest (the prefix folded/cached so far). Because each fold
// is persisted immediately, the NEXT generation resumes from here, so the cache warms over a generation or
// two instead of the worker dying every time. New books built page-by-page only ever fold ONE page, so
// they never approach this. ~100s leaves headroom for the rest of `prepare` under the ceiling.
const FOLD_BUDGET_MS = 100_000;
interface DigestLink { v?: number; value: DigestAccum; src_hash: string; prev_hash: string }
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

function buildPrevProseBlock(allNodes: Node[], currentId: string): string {
  const ordered = scenesInOrder(allNodes);
  const idx = ordered.findIndex((s) => s.id === currentId);
  if (idx <= 0) return "";
  const prev = ordered.slice(Math.max(0, idx - 3), idx)
    .filter((s) => String((s.content as { prose?: { text?: string } }).prose?.text ?? "").trim());
  if (!prev.length) return "";
  return "PRECEDING PAGES (maintain continuity of voice, cadence, and character — do NOT repeat phrases, images, or sentence patterns used here):\n" +
    prev.map((s, i) => `--- Page ${idx - prev.length + i + 1} ---\n${(s.content as { prose?: { text?: string } }).prose!.text}`).join("\n\n");
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

// Non-crypto FNV-1a (32-bit) — deterministic, synchronous; used only to chain/invalidate cached digests.
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}
function formatLedger(L: DigestLedger): string {
  return [
    L.characters?.length ? `Characters:\n${L.characters.map((c) => `  • ${c}`).join("\n")}` : "",
    L.objects?.length ? `Objects in play: ${L.objects.join("; ")}` : "",
    L.locations?.length ? `Locations: ${L.locations.join("; ")}` : "",
    L.timeline ? `Timeline: ${L.timeline}` : "",
    L.open_threads?.length ? `Open threads:\n${L.open_threads.map((t) => `  • ${t}`).join("\n")}` : "",
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
async function foldDigest(apiKey: string, model: string, prior: DigestAccum, pageText: string, meta: CallMeta): Promise<DigestAccum> {
  const first = !prior.pages.length;
  const ledgerSoFar = first ? "(this is the first page — no prior state)" : (formatLedger(prior.ledger) || "(no ledger yet)");
  const impressionsSoFar = first ? "(none yet)" : (formatImpressions(prior.impressions) || "(none yet)");
  const dprompt = `You are maintaining a running CONTINUITY DIGEST of a novel-in-progress, one page at a time. You are given the STORY STATE so far (a cumulative continuity ledger + the reader's running impressions) and the NEXT page's prose. Read the page CLOSELY, then update the state to INCLUDE it. Output STRICT JSON only:
{
  "page": "<one tight line for THIS page: POV + location/time, the value-shift, the key facts ESTABLISHED, and the closing image>",
  "ledger": {
    "characters": ["<name — current status, where they are, what they want now>"],
    "objects": ["<object/clue in play — its state>"],
    "locations": ["<place — what's there>"],
    "timeline": "<elapsed time / current point in the story>",
    "open_threads": ["<promise opened but not yet paid — its state>"]
  },
  "impressions": [{ "note": "<a thing a reader actually TAKES AWAY and remembers from the story so far — an image, a feeling, a turn, a line that lands, a dawning realization>", "weight": <integer 1-5> }]
}

READING DISCIPLINE — get this right; downstream prose trusts this digest as authoritative:
- A label, title, number, or form of address (e.g. "Lot Seven", "the prisoner", "girl", "your highness") usually REFERS TO an existing character — most often the POV character — it is NOT automatically a new person. Before adding anyone to "characters" or a meeting/thread to "open_threads", decide WHO the label points to from the prose. Do not invent a character or a thread from a designation. (If the POV character is being auctioned and the guards call her "Lot Seven," then she IS Lot Seven — there is no separate person and no "upcoming meeting with Lot Seven.")
- Resolve pronouns and epithets to the character they denote; merge, never duplicate.

The ledger is CUMULATIVE state: carry forward everything still true, UPDATE what changed, CLOSE threads this page paid off, and ADVANCE the timeline.
The impressions are the reader's MEMORY of the read so far — not every fact, but what resonates. CARRY the prior impressions forward; RAISE the weight of any that this page reinforces or pays off (a recurring motif, a deepening dread, a promise kept); ADD what this page newly makes a reader feel or notice. Weight: 5 = central / emotionally charged / unforgettable; 1 = minor. Keep the list tight (≈8 strongest); drop the weakest if it grows past that. No prose, no preamble — JSON only.

CONTINUITY LEDGER SO FAR:
${ledgerSoFar}

READER'S IMPRESSIONS SO FAR (weight in brackets):
${impressionsSoFar}

THIS PAGE:
${pageText}`;
  const data = await callClaude(apiKey, { model, max_tokens: 2500, messages: [{ role: "user", content: dprompt }] }, { ...meta, fn: "dna-expand-digest" });
  const p = JSON.parse(extractJsonBlock(textFromClaude(data))) as { page?: string; ledger?: DigestLedger; impressions?: DigestImpression[] };
  const impressions = Array.isArray(p.impressions)
    ? p.impressions.filter((i) => i && typeof i.note === "string" && i.note.trim()).map((i) => ({ note: i.note.trim(), weight: Math.max(1, Math.min(5, Math.round(Number(i.weight) || 1))) }))
    : prior.impressions;
  return { pages: [...prior.pages, (p.page ?? "").trim()].filter(Boolean), ledger: p.ledger ?? prior.ledger, impressions };
}
async function buildProseDigest(apiKey: string, model: string, allNodes: Node[], currentId: string, bookId: number, meta: CallMeta): Promise<string> {
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
  const startFold = Date.now();
  let truncated = false;
  for (const page of earlier) {
    const txt = proseText(page);
    const srcHash = fnv1a(txt);
    const prevHash = fnv1a(JSON.stringify(accum));
    const cached = page.authoring?.prose_digest;
    if (cached && cached.v === DIGEST_VERSION && cached.src_hash === srcHash && cached.prev_hash === prevHash) { accum = cached.value; continue; }
    // Out of fold budget → stop and return the partial digest (covers the prefix folded/cached so far). The
    // fold is sequential (each depends on the prior accumulator) so we can't skip ahead — earliest-uncached
    // first. Each completed fold below is already persisted, so the next generation resumes from here.
    if (Date.now() - startFold > FOLD_BUDGET_MS) { truncated = true; break; }
    try {
      accum = await foldDigest(apiKey, model, accum, txt, meta);
      page.authoring = { ...page.authoring, prose_digest: { v: DIGEST_VERSION, value: accum, src_hash: srcHash, prev_hash: prevHash } };
      // Persist THIS fold immediately — a worker death at the ~150s ceiling must not lose progress (the
      // old persist-at-end lost everything on death, so the cache never warmed and prose never recalculated).
      await sb.from("book_nodes").update({ authoring: page.authoring }).eq("id", page.id).eq("book_id", bookId);
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
    `<previous_page note="for voice + cadence ONLY — do NOT copy or echo its opening image, its closing image, its character gestures, or any of its phrases; this new scene must open in a DIFFERENT place, time, or emotional register than where this page opens or closes">\n${proseText(last)}\n</previous_page>`,
  ].filter(Boolean).join("\n\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const userClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } });
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
    // the same-origin /api/stream-prose proxy, so the 80–140s call never rides this worker's ~150s wall-clock
    // (the timeout/546 failures). See TO-DO/dna-streaming-proxy.md. Digest + assembly stay here (fast, DB-bound).
    const { bookId, nodeId, target, light, prepare } = (await req.json().catch(() => ({}))) as { bookId?: number; nodeId?: string; target?: string; light?: boolean; prepare?: boolean };
    if (!bookId || !nodeId) return json({ error: "bookId and nodeId are required" }, 400);
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

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
        acts.map((m) => `- [${(m.content as { title?: string }).title ?? ""}] turn: ${(m.content as { turning_point?: string }).turning_point ?? ""}`).join("\n")
      : "";
    // The tentpole registry — set-pieces the beat sheet must place (each pinned tentpole → a beat).
    const tentpoles = pillar ? nodes.filter((n) => n.parent_id === pillar.id && n.kind === "tentpole" && (n.authoring?.locked || n.authoring?.status === "accepted")) : [];
    const tpName = (e: Node) => String((e.content as { summary?: string }).summary ?? "").trim();
    const tentpoleBlock = tentpoles.length
      ? "TENTPOLES — set-pieces you MUST place (assign each to the beat that delivers it, BY its summary):\n" +
        tentpoles.map((t) => `- ${tpName(t)}`).join("\n")
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

    const { high: model } = await getActiveModels();
    const meta: CallMeta = { fn: "dna-expand", bookId, userId };
    // Prose → digest v2 (all-page continuity + anti-echo). The per-page fold runs on DIGEST_MODEL (qwen-plus,
    // a reasoning model) — NOT the cheap `low` model: the digest is read-comprehension that downstream prose
    // trusts as authoritative, so a weak model's misreadings poison every later page. Caption (picture mode)
    // keeps the short last-3-verbatim window; everything else needs no prose context.
    // `light` skips the all-page continuity digest (a separate, slow Claude call) — used by the editor
    // agent's render_scene_prose so a single render fits inside one worker's wall-clock. Trades cross-scene
    // anti-repetition polish for speed; fine for a draft-to-check, not for the canonical book build.
    const prevProseBlock = light ? ""
      : (target === "prose" || (!target && node.kind === "scene"))
      ? await buildProseDigest(apiKey, DIGEST_MODEL, nodes, nodeId, bookId, meta)
      : target === "caption"
        ? buildPrevProseBlock(nodes, nodeId)
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
    const ctx = [
      `BOOK: ${book?.name ?? ""}`,
      `BRIEF (binding):\n${briefContext(brief, { scope: "full", success: true, none: "(no brief)", empty: "(empty)" })}`,
      mandate ? `MANDATE — NON-NEGOTIABLE:\n${mandate}` : "",
      voiceBlock,
      "STORY SO FAR (the ladder above this node; LOCKED items are immutable):",
      ...chain.map((a) => `[${a.kind}${a.authoring?.locked ? " · LOCKED" : ""}] ${JSON.stringify(a.content)}`),
      entityBlock,
      locationBlock,
      threadBlock,
      tentpoleBlock,
      worldRulesBlock,
      gamesBlock,
      precondBlock, // [EXP:preconditions]
      actBlock,
      beatNeighbourhoodBlock, // sibling beats — keeps prose from contradicting plan-layer facts
      settingBlock, // this scene's resolved location palette (prose grounding)
      registerBlock, // this scene's voice modulation (anti-monotony) — bends the signature for this scene only
      prevProseBlock,
      `THIS NODE [${node.kind}]: ${JSON.stringify(node.content)}`,
    ].filter(Boolean).join("\n\n");

    if (target === "logline") {
      // Seed → logline: forge the author's RAW idea (brief.idea) into a polished LOGLINE. A logline is NOT
      // the raw idea — it names protagonist · inciting incident · primary goal · main obstacle · stakes in
      // one or two sentences. This is the system's first refinement (docs/dna-studio-analysis.md §0/§1).
      const system = `You are a story editor. Turn the author's raw idea into ONE polished LOGLINE for the book — one or two sentences that make the story instantly legible and compelling.

A logline names FIVE things, concretely and specifically (no generic placeholders):
- the PROTAGONIST (who they are, with the defining trait that matters),
- the INCITING INCIDENT (the event that upends their world),
- their PRIMARY GOAL (what they must now do),
- the MAIN OBSTACLE / antagonist (what stands in the way),
- the STAKES (what is lost if they fail).

Honor the MANDATE (genre/tone) and any LOCKED ancestors. Do NOT invent a title. Do NOT restate the raw idea verbatim — SHARPEN it into a real logline. Output the LOGLINE ONLY: one or two sentences, no preamble, no label, no quotes, no JSON.`;
      const data = await callClaude(apiKey, { model, max_tokens: 400, system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: `${ctx}\n\nWrite the logline.` }] }, meta);
      return json({ logline: textFromClaude(data).trim() });
    }

    if (target === "prose" || (!target && node.kind === "scene")) {
      // Scene → prose: fill the scene's own text. One true draft, in voice.
      const system = `You are a novelist writing the PROSE for one scene, from its plan. Write the scene fully — vivid, causal, in the book's voice — honoring the MANDATE (heat/tone/length) without laundering. Output the prose ONLY: no preamble, no headings, no JSON.

VOICE — write ONLY the fiction, from inside the story: NEVER address or mention "the reader"/"you", and NEVER refer to "the book", "the story", "the scene", "the page", the author, or the writing itself. The plan's notes describe INTENT in craft terms (e.g. "the reader is told it reads as fury", "the book plants the wrong label") — those are directions TO YOU, not lines to reproduce. Dramatize that intent through concrete action, sensation, and subtext; never narrate it or break the fourth wall.

ANTI-REPETITION (critical): Never repeat any physical gesture, character reaction, sentence structure, or phrase within this scene — not even once. If a character smirks in paragraph 2, they cannot smirk (or twitch, or smile faintly) again. Each beat of the scene must be rendered with entirely fresh language. If you feel the urge to reuse a phrase or gesture, stop and invent a different one. This scene ends when the plan's goal/outcome is dramatized — do not loop, pad, or re-dramatize beats already written.`;
      const userContent = `${ctx}\n\nWrite this scene's prose.`;
      // Browser-streamed path: hand back the assembled request; the client streams it via /api/stream-prose.
      if (prepare) return json({ prepared: { system, userContent, model, max_tokens: 8000 } });
      const data = await callClaude(apiKey, { model, max_tokens: 8000, system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userContent }] }, meta);
      return json({ prose: textFromClaude(data).trim() });
    }

    if (target === "caption") {
      // Picture mode (docs/picture-book-mode.md): the page TEXT that sits under the scene's illustration —
      // a short caption, NOT full prose. The image carries the moment; the caption carries the voice.
      const system = `You are writing the CAPTION for ONE illustrated page of a picture book, from the scene's plan. The picture carries the moment — your job is the few words beneath it that carry the book's VOICE and move the story one beat. Honor the MANDATE (tone/reading age). Output the caption text ONLY: no preamble, no headings, no quotes, no JSON.

RULES:
- 1 to 3 sentences. Tight, rhythmic, read-aloud-able. Often one is enough.
- Tell what the picture cannot: the turn, the feeling, the line of dialogue — never just label what's already visible ("A boy stands in a hall").
- Write ONLY from inside the story: NEVER address or mention "the reader"/"you", and NEVER refer to "the book", "the story", "the scene", "the page", "the picture/image", the author, or the writing itself. The plan's notes are directions TO YOU, not lines to reproduce.`;
      const data = await callClaude(apiKey, { model, max_tokens: 400, system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: `${ctx}\n\nWrite this page's caption.` }] }, meta);
      return json({ caption: textFromClaude(data).trim() });
    }

    if (target === "beatsheet") {
      // GLOBAL beat-sheet pass (root fix): generate EVERY beat in one call with the whole arc + the thread
      // registry in view, so promises schedule setup→payoff in order and polarity is planned to oscillate.
      // Returns a flat, act-indexed list; the client persists it grouped under each act.
      if (!acts.length) return json({ error: "generate the acts before the beat sheet" }, 400);
      if (!threads.length) return json({ error: "generate the threads before the beat sheet" }, 400);
      const system = `You are a story architect writing the ENTIRE BOOK'S BEAT SHEET in ONE pass — every beat of every act at once, so you can see the whole sequence. Honor every LOCKED ancestor and the MANDATE verbatim. Rules:
- 2 to 4 beats per act; each beat links to the prior with "therefore" or "but" (escalating causality).
- Set each beat's PLANNED polarity (up = ends better, down = ends worse). The act's value shift is the MACRO trend; you MUST still OSCILLATE within it — never more than ~3 beats of the same polarity in a row. Place deliberate relief/hope-spots inside down-acts and setbacks inside up-acts.
- Schedule the THREADS across the whole book: every promise must be SET UP (role:setup) in an EARLIER beat before it is PAID OFF (role:payoff) in a LATER beat; use "advance" for beats that develop it in between. Reference threads BY NAME.
- CAUSE every turn: give each beat "needs" (state keys it DEPENDS ON, each one EARNED by an EARLIER beat — never an ambient world/premise given) and "establishes" (state keys it PRODUCES). Keys are short snake_case handles (e.g. "ledger_settled", "rival_humiliated", "peculium_revealed"). Every "therefore" beat MUST "need" at least one state an earlier beat "establishes" — that upstream dependency is what makes the turn CAUSED, not "and then". A "but" beat must either reverse the polarity or block/consume an established state.${tentpoles.length ? `\n- PLACE every TENTPOLE: assign each set-piece to the ONE beat that delivers it, in "realizes" (by its summary). Every tentpole listed must appear on exactly one beat.` : ""}${worldFacts.length ? `\n- GROUND the turns in the WORLD RULES: when a beat's turning point's outcome OPERATES ON a rule's mechanism, list that rule in "grounds_in" (by name). The CLIMAX / final resolution beat MUST ground its win in an established rule — the victory has to be MECHANICALLY EARNED by a rule the reader already knows, never deus ex machina. Plant the rule's setup in an earlier beat too.` : ""}${games.length ? `\n- PLAY the GAMES: each beat that advances a contest lists it in "plays" (by name). Each game MUST be RESOLVED — exactly one beat lists it in "resolves" with its outcome (won|lost), and the CENTRAL game resolves at the CLIMAX. A game's resolving beat should also ground_in the rule its win/lose fires.` : ""}${statePreconds.length ? `\n- ESTABLISH every STATE PRECONDITION: each game's win SPENDS resources/states (listed above). For each, an EARLIER beat must establish it (list its key in that beat's "establishes") BEFORE the beat that resolves the game — you cannot spend a resource the story never acquired (no "she had enough all along"). Make the establishing a real turn.` : ""}
Output JSON ONLY: { "beats": [ { "act": <1..${acts.length}>, "summary": "...", "connector": "therefore"|"but", "polarity": "up"|"down", "threads": [ { "ref": "<thread name>", "role": "setup"|"advance"|"payoff" } ]${tentpoles.length ? `, "realizes": [ "<tentpole summary>" ]` : ""}${worldFacts.length ? `, "grounds_in": [ "<world rule name>" ]` : ""}${games.length ? `, "plays": [ "<game name>" ], "resolves": [ { "ref": "<game name>", "outcome": "won|lost" } ]` : ""}, "needs": [ "<state key earned upstream>" ], "establishes": [ "<state key this beat produces>" ] } ] }`;
      const data = await callClaude(apiKey, { model, max_tokens: 8000, system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: `${ctx}\n\nWrite the whole beat sheet. JSON only.` }] }, meta);
      const parsed = JSON.parse(extractJsonBlock(textFromClaude(data)));
      const rawBeats = Array.isArray(parsed.beats) ? parsed.beats : [];
      const tNameToId = new Map(threads.map((t) => [tName(t).toLowerCase(), t.id]));
      const tpNameToId = new Map(tentpoles.map((t) => [tpName(t).toLowerCase(), t.id]));
      const wfNameToId = new Map(worldFacts.map((w) => [wfName(w).toLowerCase(), w.id]));
      const gNameToId = new Map(games.map((g) => [gName(g).toLowerCase(), g.id]));
      const normKey = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, "_");
      const roles = new Set(["setup", "payoff", "advance"]);
      // Resolve refs, clamp act index, then ENFORCE setup→payoff order (drop orphan payoffs).
      const setUp = new Set<string>();
      const claimedTp = new Set<string>(); // a tentpole is realized by at most ONE beat (first claim wins)
      const resolvedG = new Set<string>(); // a game is resolved by at most ONE beat (first claim wins)
      const beats = rawBeats.map((b: Record<string, unknown>) => {
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
        if (realizes.length) content.realizes = realizes;
        if (grounds.length) content.grounds_in = grounds;
        if (plays.length) content.plays = plays;
        if (resolves.length) content.resolves = resolves;
        if (establishes.length) content.establishes = establishes;
        if (needs.length) content.needs = needs;
        return { act: mi, content };
      });
      return json({ beatsheet: true, childKind: "beat", childLevel: 4, actIds: acts.map((m) => m.id), beats });
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
      `BRIEF (binding):\n${briefContext(brief, { scope: "full", success: true, none: "(no brief)", empty: "(empty)" })}`,
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
      `THIS NODE [${node.kind}]: ${JSON.stringify(node.content)}`,
    ].filter(Boolean).join("\n\n");
    const system = `You are a story architect expanding a ${node.kind} into ${config.role}. Generate ${config.count} ${config.child_kind}s as ONE authoritative structure — NOT alternatives to choose among. Honor every LOCKED ancestor and the MANDATE verbatim. Output JSON ONLY: { "children": [ ${config.schema_json} ] }`;
    const data = await callClaude(apiKey, { model, max_tokens: 4000, system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `${slottedCtx}\n\nGenerate the ${config.child_kind}s. JSON only.` }] }, meta);
    const parsed = JSON.parse(extractJsonBlock(textFromClaude(data)));
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
    return json({ childKind: config.child_kind, childLevel: config.child_level, children });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
