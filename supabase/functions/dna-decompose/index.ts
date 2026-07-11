// dna-decompose — the imported-draft SEMANTIC ASCENT as a DURABLE, self-chaining server run.
// Given a prose-bearing tree (epub import: locked scenes, empty plan rungs), infer the plan
// bottom-up. The run is server-owned (book_decompositions row = single source of truth): closing or
// refreshing the tab loses nothing; DecomposeButton is a Realtime projection of the row; stopRun
// sets status='cancelled' and the next link exits.
//
//   start:  POST { bookId }  (user JWT)  → dedupe/insert row → do the first link → { id }
//   chain:  POST { id, chain: true }  (x-chain secret, verify_jwt=false) → one link → reinvoke
//
// Links (each one invocation, well under the ~150s worker cap):
//   chapters — read up to BATCH chapters IN PARALLEL (independent: connector context is the previous
//              chapter's prose tail, not a digest), write beat rows + digest slots
//   top      — digests → seed logline / premise / pillar
//   acts     — digests → act boundaries; re-segment the spine (new acts, beats re-homed by chapter
//              range, the import's single flat act deleted)
//   entities — digests + opening sample → cast, relationships, locations, voice
//   systems  — digests → world facts, threads, games, tentpoles, meters + beat-level links; game twins
//   seal     — re-stamp provenance across the tree (plan was derived FROM the prose — declare in sync)
//
// Resilience: a timed-out chapter slot stays empty and is re-attempted on a later link (placeholder
// after 2 strikes — keeps chapter numbering aligned); a failed fold phase retries once before the
// run errors. Bounded via row.attempts so a poison unit can't loop the chain.
//
// Pure logic (chapter assembly, op builders, rails targets) lives in _shared/dna-decompose-core.ts,
// which the web test suite imports directly — no client/edge mirror to drift.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { callLLM, textFromLLM, type CallMeta } from "../_shared/llm.ts";
import { DIGEST_MODEL, getActiveModels } from "../_shared/model-config.ts";
import { extractJsonBlock } from "../_shared/json.ts";
import { serviceClient } from "../_shared/task.ts";
import { isChainCall, reinvoke } from "../_shared/self-chain.ts";
import dnaSchema from "../_shared/dna-schema.json" with { type: "json" };
import {
  byId, deepMergeContent, stampInput, stampProse,
  type DnaNode, type NodeContent, type NodeKind,
} from "../_shared/novel-dna.ts";
import {
  actOps, chaptersOf, entityOps, gameTwinOps, systemsOps, topOps,
  type ActsRead, type ChapterRead, type CoreOp, type EntitiesRead, type SystemsRead, type TopRead,
} from "../_shared/dna-decompose-core.ts";

const FN = "dna-decompose";
// Parallel chapter reads per link. They share ONE worker's CPU under the ~150s wall, so a fatter
// batch makes every call slower (more of the latency tail crosses the 140s timeout) and risks
// WORKER_RESOURCE_LIMIT for the whole link. Links are cheap (self-chain) — prefer more links.
// 6 → 3 after book 1234: 20/28 chapter reads double-timed-out under a 6-wide batch.
const BATCH = 3;
// A chapter that struck out twice gets this placeholder so numbering stays aligned. It is a
// FAILURE MARKER, not story data — digestMenu masks it so fold phases can't consume it as fact.
const FAILED_DIGEST = "(chapter read failed)";

interface RunRow {
  id: number; book_id: number; status: string; phase: string;
  done: number; total: number; digests: ({ title: string; digest: string } | null)[]; skipped: string[];
  attempts: Record<string, number>; // retry counts per chapter index / fold phase (bounded at 2)
}

// ── LLM plumbing (same rails as the original stateless steps) ────────────────────────────────────
const clamp = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
const oneOf = (v: unknown, opts: string[]): string | undefined =>
  typeof v === "string" && opts.includes(v) ? v : undefined;
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : undefined);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown, max: number): Record<string, unknown>[] =>
  (Array.isArray(v) ? v : []).slice(0, max).map(obj);
const guideFor = (...kinds: string[]): string =>
  dnaSchema.promptGuide.split("\n").filter((l) => kinds.some((k) => l.startsWith(`- ${k} `))).join("\n");
const digestMenu = (digests: ({ title?: string; digest?: string } | null)[]): string =>
  digests.map((d, i) => {
    // Chapter numbering must stay aligned (systems reads reference chapters by number), so an
    // unread chapter keeps its line — but as an explicit gap, never as failure text posing as fact.
    const text = !d?.digest || d.digest === FAILED_DIGEST
      ? "(unread — no information about this chapter; do not infer anything from it)"
      : d.digest;
    return `Chapter ${i + 1}${d?.title ? ` "${d.title}"` : ""}:\n${text}`;
  }).join("\n\n");

// NOTE: `thinking`/`output_config` are DROPPED by llm.ts on the OpenAI-compatible tiers — effort is
// a no-op there, so latency control = model choice. Fold reads (whole-book extraction, big outputs)
// pass DIGEST_MODEL, the workhorse the incremental digest already proves fits the ~150s worker;
// chapter reads keep the high tier (per-chapter judgment quality, and 1.2k-token outputs fit).
async function ask(bookId: number, system: string, prompt: string, max_tokens: number, effort: "low" | "medium", timeoutMs = 140_000, modelOverride?: string): Promise<Record<string, unknown>> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const model = modelOverride ?? (await getActiveModels()).high;
  const meta: CallMeta = { fn: FN, bookId, taskTable: "book_decompositions", taskId: bookId };
  const data = await callLLM(apiKey, {
    model, max_tokens, thinking: { type: "adaptive" }, output_config: { effort },
    system: [{ type: "text", text: system }],
    messages: [{ role: "user", content: prompt }],
  }, meta, { signal: AbortSignal.timeout(timeoutMs) });
  return JSON.parse(extractJsonBlock(textFromLLM(data).trim())) as Record<string, unknown>;
}

// ── The four LLM reads (prompt + rails, unchanged from the stateless version) ────────────────────
async function chapterRead(bookId: number, bookLine: string, ch: { title: string; text: string }, position: number, total: number, prevTail?: string): Promise<ChapterRead> {
  const parsed = await ask(bookId,
    "You are a story analyst decomposing an EXISTING manuscript into its structural plan. The prose is " +
      "ground truth — describe what IS on the page, never what a better version would do.",
    `Novel: ${bookLine}. Chapter ${position} of ${total}${ch.title ? ` — "${ch.title}"` : ""}.\n\n` +
      (prevTail ? `END OF THE PREVIOUS CHAPTER (for judging how this one connects):\n…${prevTail}\n\n` : "") +
      `CHAPTER PROSE:\n${ch.text.slice(0, 60_000)}\n\n` +
      `Return ONLY this JSON (no fences):\n{\n` +
      `  "beat": {\n` +
      `    "summary": "<1-2 sentences: what happens as a story TURN (who acts, what changes)>",\n` +
      `    "connector": "<therefore|but — how this chapter follows from the previous one (causal = therefore, reversal = but). OMIT for chapter 1>",\n` +
      `    "polarity": "<up|down — does the protagonist's situation end better or worse than it began>"\n` +
      `  },\n` +
      `  "digest": "<3-5 sentences: events, reveals, relationship shifts, world rules established — enough to reconstruct the plot from digests alone>"\n}`,
    1_200, "low", 135_000); // the active tier runs ~115s/chapter — 110s was under it and timed out en masse
  const beat = obj(parsed.beat);
  return {
    beat: {
      summary: clamp(beat.summary, 600),
      connector: oneOf(beat.connector, ["therefore", "but"]),
      polarity: oneOf(beat.polarity, ["up", "down"]),
    },
    digest: clamp(parsed.digest, 1_500) ?? "",
  };
}

async function topRead(bookId: number, bookLine: string, digests: RunRow["digests"]): Promise<TopRead> {
  const parsed = await ask(bookId,
    "You are a story analyst who has read a whole manuscript (as chapter digests). Distill its top-level " +
      "plan. Describe the book that EXISTS, not an improved one.\n\nCONTENT FIELD SCHEMAS:\n" +
      guideFor("seed", "premise", "pillar"),
    `Novel: ${bookLine}.\n\nCHAPTER DIGESTS (reading order):\n${digestMenu(digests)}\n\n` +
      `Return ONLY this JSON (no fences):\n{\n` +
      `  "seed": { "logline": "<one sentence: protagonist + inciting incident + goal + obstacle + stakes>" },\n` +
      `  "premise": { "dramatic_question": "<the central question the book lives inside>", "shape": { "name": "<the story shape, free text>", "movements": ["<3-6 movement labels>"], "ending_feel": "<up|down|bittersweet|ambivalent>" } },\n` +
      `  "pillar": { "controlling_idea": "<the thesis the ending argues>", "ending": "<what concretely happens at the end>" }\n}`,
    2_500, "low", 140_000, DIGEST_MODEL);
  const premise = obj(parsed.premise);
  const shape = obj(premise.shape);
  const pillar = obj(parsed.pillar);
  return {
    seed: { logline: clamp(obj(parsed.seed).logline, 600) },
    premise: {
      dramatic_question: clamp(premise.dramatic_question, 600),
      shape: {
        name: clamp(shape.name, 120),
        movements: (Array.isArray(shape.movements) ? shape.movements : []).map((m) => clamp(m, 200)).filter((x): x is string => !!x).slice(0, 8),
        ending_feel: oneOf(shape.ending_feel, ["up", "down", "bittersweet", "ambivalent"]),
      },
    },
    pillar: { controlling_idea: clamp(pillar.controlling_idea, 800), ending: clamp(pillar.ending, 800) },
  };
}

async function entitiesRead(bookId: number, bookLine: string, digests: RunRow["digests"], sample: string): Promise<EntitiesRead> {
  // Two SMALLER calls in parallel instead of one whole-registry call: the single 5000-token read was
  // the fold most likely to cross the 140s ceiling (it killed book 1234's run twice). Parallel keeps
  // the link's wall time at max(cast, world), and each ask is roughly half the output budget.
  const menu = digestMenu(digests);
  const [castParsed, worldParsed] = await Promise.all([
    ask(bookId,
      "You are a story analyst extracting the CAST from a manuscript's chapter digests. Extract only " +
        "what the TEXT establishes — no invention. Relationships reference characters by exact NAME " +
        "from your own characters list.\n\nCONTENT FIELD SCHEMAS:\n" +
        guideFor("character", "relationship"),
      `Novel: ${bookLine}.\n\nCHAPTER DIGESTS (reading order):\n${menu}\n\n` +
        `Return ONLY this JSON (no fences):\n{\n` +
        `  "characters": [{ "name", "role", "want", "need", "wound", "tag" }],  // named cast that matters, max 12\n` +
        `  "relationships": [{ "a": "<character name>", "b": "<character name>", "bond", "charge" }]  // max 10\n}`,
      3_000, "low", 140_000, DIGEST_MODEL),
    ask(bookId,
      "You are a story analyst extracting the PLACES and NARRATIVE VOICE from a manuscript (chapter " +
        "digests + an opening prose sample). Extract only what the TEXT establishes — no invention.\n\n" +
        "CONTENT FIELD SCHEMAS:\n" + guideFor("location", "voice_profile"),
      `Novel: ${bookLine}.\n\nCHAPTER DIGESTS (reading order):\n${menu}\n\n` +
        (sample ? `OPENING PROSE SAMPLE (for voice):\n${sample}\n\n` : "") +
        `Return ONLY this JSON (no fences):\n{\n` +
        `  "locations": [{ "name", "summary", "mood", "sight", "sound", "smell" }],  // recurring places only, max 8; sensory fields only where the text gives them\n` +
        `  "voice": { "pov", "tense", "style", "constraints": [] }  // the prose voice observed in the sample\n}`,
      2_500, "low", 140_000, DIGEST_MODEL),
  ]);
  const parsed = { ...castParsed, ...worldParsed };
  const voice = obj(parsed.voice);
  return {
    characters: arr(parsed.characters, 12).map((c) => ({
      name: clamp(c.name, 80), role: clamp(c.role, 30), want: clamp(c.want, 400),
      need: clamp(c.need, 400), wound: clamp(c.wound, 400), tag: clamp(c.tag, 200),
    })).filter((c) => c.name),
    relationships: arr(parsed.relationships, 10).map((r) => ({
      a: clamp(r.a, 80), b: clamp(r.b, 80), bond: clamp(r.bond, 300), charge: clamp(r.charge, 300),
    })).filter((r) => r.a && r.b && r.bond),
    locations: arr(parsed.locations, 8).map((l) => ({
      name: clamp(l.name, 80), summary: clamp(l.summary, 400), mood: clamp(l.mood, 200),
      sight: clamp(l.sight, 200), sound: clamp(l.sound, 200), smell: clamp(l.smell, 200),
    })).filter((l) => l.name),
    voice: {
      pov: oneOf(voice.pov, ["first-person", "third-person-limited", "third-person-omniscient", "second-person"]),
      tense: oneOf(voice.tense, ["past", "present"]),
      style: clamp(voice.style, 600),
      constraints: (Array.isArray(voice.constraints) ? voice.constraints : []).map((c) => clamp(c, 200)).filter((x): x is string => !!x).slice(0, 8),
    },
  };
}

async function actsRead(bookId: number, bookLine: string, digests: RunRow["digests"]): Promise<ActsRead> {
  const parsed = await ask(bookId,
    "You are a story analyst finding the ACT STRUCTURE of a manuscript (chapter digests). Acts are the " +
      "large dramatic movements — a boundary falls where the story's direction fundamentally shifts " +
      "(a reveal that reframes everything, a goal achieved/destroyed, a point of no return). Use the " +
      "shape the book actually has (2-5 acts), not a template. Reference chapters by NUMBER as listed.",
    `Novel: ${bookLine}.\n\nCHAPTER DIGESTS (reading order):\n${digestMenu(digests)}\n\n` +
      `Return ONLY this JSON (no fences):\n{\n` +
      `  "acts": [{\n` +
      `    "title": "<short act name>",\n` +
      `    "goal": "<what this movement accomplishes in the story>",\n` +
      `    "turning_point": "<the event that ENDS this act — the shift into the next>",\n` +
      `    "start_chapter": <n — the chapter this act begins on; act 1 starts at 1>\n` +
      `  }]\n}`,
    // Reasoning tokens count against max_tokens on the OpenRouter tier — 2k truncated the JSON
    // mid-boundary-deliberation ("Unexpected end of JSON input"). Budget generously; output is small.
    4_500, "low", 140_000, DIGEST_MODEL);
  return {
    acts: arr(parsed.acts, 6).map((a) => ({
      title: clamp(a.title, 80), goal: clamp(a.goal, 400), turning_point: clamp(a.turning_point, 400),
      start_chapter: num(a.start_chapter),
    })),
  };
}

async function systemsRead(bookId: number, bookLine: string, digests: RunRow["digests"]): Promise<SystemsRead> {
  const parsed = await ask(bookId,
    "You are a story analyst extracting the STORY SYSTEMS from a manuscript (chapter digests). Extract " +
      "only what the TEXT establishes — no invention. Reference chapters by their NUMBER as listed. " +
      "Games reference players by character NAME and governing rules by world-fact NAME from your own " +
      "lists. Do NOT create a thread for a game's outcome (games auto-carry a resolution thread) and do " +
      "NOT create game_score meters (auto-derived).\n\nCONTENT FIELD SCHEMAS:\n" +
      guideFor("world_fact", "thread", "game", "tentpole", "meter"),
    `Novel: ${bookLine}.\n\nCHAPTER DIGESTS (reading order):\n${digestMenu(digests)}\n\n` +
      `Return ONLY this JSON (no fences):\n{\n` +
      `  "world_facts": [{ "name", "rule", "mechanism", "category" }],  // rules the story world runs on, max 14; [] for mundane settings\n` +
      `  "threads": [{ "name", "kind", "promise", "payoff", "setup_chapter": <n>, "payoff_chapter": <n or omit if unpaid> }],  // promises to the reader (mystery|foreshadow|setup_payoff|arc), max 10\n` +
      `  "games": [{ "name", "players": ["<character name>"], "win_condition", "lose_condition", "stake", "governing_rules": ["<world fact name>"], "outcome": "<won|lost, omit if undecided>", "resolved_chapter": <n> }],  // explicit contests with win/lose conditions, max 6; [] if none\n` +
      `  "tentpoles": [{ "name", "summary", "realized_chapter": <n> }],  // the big emotional/scene beats the book builds to — name = short handle, summary = the guidance (feel/turn), max 8\n` +
      `  "meters": [{ "name", "kind", "poles": { "low", "high" }, "scale": { "min": 0, "max": 10 } }]  // 1-4 numeric axes this book visibly runs on (tension|heat|comedy|affect|relationship|value|custom)\n}`,
    6_000, "low", 140_000, DIGEST_MODEL);
  return {
    world_facts: arr(parsed.world_facts, 14).map((w) => ({
      name: clamp(w.name, 80), rule: clamp(w.rule, 400), mechanism: clamp(w.mechanism, 400), category: clamp(w.category, 60),
    })).filter((w) => w.name && w.rule),
    threads: arr(parsed.threads, 10).map((t) => ({
      name: clamp(t.name, 80), kind: oneOf(t.kind, ["mystery", "foreshadow", "setup_payoff", "arc"]),
      promise: clamp(t.promise, 400), payoff: clamp(t.payoff, 400),
      setup_chapter: num(t.setup_chapter), payoff_chapter: num(t.payoff_chapter),
    })).filter((t) => t.name && t.promise),
    games: arr(parsed.games, 6).map((g) => ({
      name: clamp(g.name, 80),
      players: (Array.isArray(g.players) ? g.players : []).map((p) => clamp(p, 80)).filter((x): x is string => !!x).slice(0, 6),
      win_condition: clamp(g.win_condition, 300), lose_condition: clamp(g.lose_condition, 300), stake: clamp(g.stake, 300),
      governing_rules: (Array.isArray(g.governing_rules) ? g.governing_rules : []).map((r) => clamp(r, 80)).filter((x): x is string => !!x).slice(0, 6),
      outcome: oneOf(g.outcome, ["won", "lost"]), resolved_chapter: num(g.resolved_chapter),
    })).filter((g) => g.name && g.win_condition && g.lose_condition),
    tentpoles: arr(parsed.tentpoles, 8).map((t) => ({
      name: clamp(t.name, 80), summary: clamp(t.summary, 300), realized_chapter: num(t.realized_chapter),
    })).filter((t) => t.summary),
    meters: arr(parsed.meters, 4).map((m) => {
      const poles = obj(m.poles), scale = obj(m.scale);
      return {
        name: clamp(m.name, 60),
        kind: oneOf(m.kind, ["value", "affect", "relationship", "heat", "comedy", "tension", "custom"]),
        poles: { low: clamp(poles.low, 200), high: clamp(poles.high, 200) },
        scale: { min: num(scale.min) ?? 0, max: num(scale.max) ?? 10 },
      };
    }).filter((m) => m.name),
  };
}

// ── Server-side apply (fail-closed on the shapes CoreOp allows) ───────────────────────────────────
const LEVEL: Record<string, number> = {
  seed: 0, premise: 1, pillar: 2, character: 2, relationship: 2, tentpole: 2, world_fact: 2,
  location: 2, thread: 2, game: 2, meter: 2, voice_profile: 2, act: 3, beat: 4, scene: 5,
};

/** Apply CoreOps in place: locked nodes are never edited; adds get stamped and appended to `tree`;
 *  moves re-home a node (act re-segmentation); deletes run AFTER all upserts so re-homed children
 *  are already off the doomed parent when the FK cascade fires. One batched upsert. */
async function applyOps(service: SupabaseClient, bookId: number, tree: DnaNode[], ops: CoreOp[]): Promise<number> {
  const index = byId(tree);
  const rows: DnaNode[] = [];
  const deletes: string[] = [];
  const posByParent = new Map<string, number>();
  const nextPos = (pid: string): number => {
    const cur = posByParent.get(pid) ?? tree.filter((n) => n.parent_id === pid).reduce((m, n) => Math.max(m, n.position + 1), 0);
    posByParent.set(pid, cur + 1);
    return cur;
  };
  for (const op of ops) {
    if (op.op === "edit") {
      const n = index.get(op.id);
      if (!n || n.authoring.locked) continue; // fail-closed: the imported prose stays untouchable
      const merged: DnaNode = {
        ...n,
        content: deepMergeContent(n.content, op.content),
        authoring: { ...n.authoring, source: n.authoring.source === "user" ? "ai_then_user" : n.authoring.source, status: "accepted" },
      };
      index.set(n.id, merged);
      tree[tree.indexOf(n)] = merged;
      rows.push(merged);
    } else if (op.op === "move") {
      const n = index.get(op.id);
      if (!n) continue;
      const moved: DnaNode = { ...n, parent_id: op.parentId, position: op.position };
      index.set(n.id, moved);
      tree[tree.indexOf(n)] = moved;
      rows.push(moved);
    } else if (op.op === "delete") {
      const n = index.get(op.id);
      if (!n || n.authoring.locked) continue;
      deletes.push(op.id);
      const at = tree.indexOf(n);
      if (at >= 0) tree.splice(at, 1);
      index.delete(op.id);
    } else {
      const node: DnaNode = {
        id: op.id, book_id: bookId, parent_id: op.parentId, level: LEVEL[op.kind] ?? 2, kind: op.kind as NodeKind,
        position: nextPos(op.parentId), content: op.content, authoring: { source: "ai", locked: false, status: "accepted" },
      };
      const stamped = stampInput(node, byId([...tree, node]));
      tree.push(stamped);
      index.set(stamped.id, stamped);
      rows.push(stamped);
    }
  }
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await service.from("book_nodes").upsert(rows.slice(i, i + 200).map((n) => ({
      id: n.id, book_id: n.book_id, parent_id: n.parent_id, level: n.level, kind: n.kind,
      position: n.position, content: n.content, authoring: n.authoring,
      proposals: n.proposals ?? null, chosen: n.chosen ?? null,
    })));
    if (error) throw new Error(`apply: ${error.message}`);
  }
  if (deletes.length) {
    const { error } = await service.from("book_nodes").delete().in("id", deletes);
    if (error) throw new Error(`apply delete: ${error.message}`);
  }
  return rows.length + deletes.length;
}

// ── The chain link ────────────────────────────────────────────────────────────────────────────────
async function loadRun(service: SupabaseClient, id: number): Promise<RunRow | null> {
  const { data } = await service.from("book_decompositions").select("*").eq("id", id).maybeSingle();
  return (data as RunRow | null) ?? null;
}
async function patchRun(service: SupabaseClient, id: number, patch: Record<string, unknown>): Promise<void> {
  const { error } = await service.from("book_decompositions").update(patch).eq("id", id);
  if (error) throw new Error(`run row: ${error.message}`);
}
async function loadTree(service: SupabaseClient, bookId: number): Promise<DnaNode[]> {
  const { data, error } = await service.from("book_nodes").select("*").eq("book_id", bookId).order("position");
  if (error) throw new Error(`tree: ${error.message}`);
  return (data as DnaNode[] | null) ?? [];
}

/** One unit of work: advance the run by one link, persist, and (unless finished) chain the next. */
async function processLink(id: number): Promise<void> {
  const service = serviceClient();
  const run = await loadRun(service, id);
  if (!run || run.status !== "running") return; // finished / cancelled / vanished — chain ends here

  try {
    const { data: book } = await service.from("books").select("name, author").eq("id", run.book_id).maybeSingle();
    const bookLine = `"${book?.name ?? "Untitled"}"${book?.author ? ` by ${book.author}` : ""}`;
    const tree = await loadTree(service, run.book_id);
    const chapters = chaptersOf(tree);
    const skipped: string[] = [...(run.skipped ?? [])];
    const attempts: Record<string, number> = { ...(run.attempts ?? {}) };

    // A fold phase that throws gets ONE retry (fresh link) before the run errors.
    const foldPhase = async (work: () => Promise<void>): Promise<void> => {
      try {
        await work();
      } catch (e) {
        const n = (attempts[run.phase] ?? 0) + 1;
        if (n >= 2) throw e;
        console.warn(`${FN} run ${id} phase ${run.phase} attempt ${n} failed, retrying:`, e);
        await patchRun(service, id, { attempts: { ...attempts, [run.phase]: n } });
      }
    };

    if (run.phase === "chapters") {
      const digests = [...(run.digests ?? [])];
      digests.length = chapters.length;
      const missing = chapters.map((_, i) => i).filter((i) => !digests[i]);
      const batch = missing.slice(0, BATCH);
      if (batch.length) {
        const ops: CoreOp[] = [];
        await Promise.all(batch.map(async (i) => {
          const ch = chapters[i];
          try {
            const read = await chapterRead(run.book_id, bookLine, ch, i + 1, chapters.length,
              i > 0 ? chapters[i - 1].text.slice(-1500) : undefined);
            digests[i] = { title: ch.title, digest: read.digest };
            const patch = Object.fromEntries(Object.entries(read.beat ?? {}).filter(([, v]) => v != null && v !== "")) as NodeContent;
            if (Object.keys(patch).length) ops.push({ op: "edit", id: ch.beatId, content: patch });
          } catch (e) {
            // Timed-out/flaky chapter: leave the slot EMPTY (a later link re-attempts it); only after
            // 2 strikes take a placeholder so numbering stays aligned and the chain can't loop forever.
            const n = (attempts[String(i)] ?? 0) + 1;
            attempts[String(i)] = n;
            if (n >= 2) {
              digests[i] = { title: ch.title, digest: FAILED_DIGEST };
              skipped.push(`chapter ${i + 1} "${ch.title.slice(0, 60)}": ${String((e as Error)?.message ?? e).slice(0, 120)}`);
            }
          }
        }));
        await applyOps(service, run.book_id, tree, ops);
        let done = digests.filter(Boolean).length;
        let finished = done >= chapters.length;
        // Placeholder rescue: before the fold phases consume the digests, spend ONE more pass on the
        // chapters that struck out — a burst of timeouts (worker contention) often clears within the
        // minutes the rest of the phase took. Each rescued slot gets exactly one more strike; the
        // `rescue` key bounds the whole thing to a single extra round so a poison book can't loop.
        if (finished && !attempts.rescue) {
          const failed = digests.flatMap((d, i) => (d?.digest === FAILED_DIGEST ? [i] : []));
          if (failed.length) {
            for (const i of failed) { digests[i] = null; attempts[String(i)] = 1; }
            // Drop the rescued chapters' stale failure notes — a rescue that succeeds must not still
            // report a timeout; one that fails again re-adds its note in the catch above.
            for (let s = skipped.length - 1; s >= 0; s--) {
              if (failed.some((i) => skipped[s].startsWith(`chapter ${i + 1} "`))) skipped.splice(s, 1);
            }
            attempts.rescue = 1;
            done = digests.filter(Boolean).length;
            finished = false;
          }
        }
        if (finished) {
          const unread = digests.filter((d) => d?.digest === FAILED_DIGEST).length;
          if (unread) skipped.unshift(`partial: ${unread} of ${chapters.length} chapters unread — the plan is derived without them`);
        }
        await patchRun(service, id, { digests, done, total: chapters.length, skipped, attempts, ...(finished ? { phase: "top" } : {}) });
      } else {
        await patchRun(service, id, { phase: "top", total: chapters.length });
      }
    } else if (run.phase === "top") {
      await foldPhase(async () => {
        const top = await topRead(run.book_id, bookLine, run.digests);
        await applyOps(service, run.book_id, tree, topOps(tree, top));
        await patchRun(service, id, { phase: "acts" });
      });
    } else if (run.phase === "acts") {
      await foldPhase(async () => {
        const read = await actsRead(run.book_id, bookLine, run.digests);
        const { ops, skipped: sk } = actOps(tree, read, chapters.map((c) => c.beatId));
        await applyOps(service, run.book_id, tree, ops);
        await patchRun(service, id, { phase: "entities", skipped: [...skipped, ...sk] });
      });
    } else if (run.phase === "entities") {
      await foldPhase(async () => {
        const read = await entitiesRead(run.book_id, bookLine, run.digests, chapters[0]?.text.slice(0, 3000) ?? "");
        const { ops, skipped: sk } = entityOps(tree, read);
        await applyOps(service, run.book_id, tree, ops);
        await patchRun(service, id, { phase: "systems", skipped: [...skipped, ...sk] });
      });
    } else if (run.phase === "systems") {
      await foldPhase(async () => {
        const read = await systemsRead(run.book_id, bookLine, run.digests);
        const { ops, skipped: sk } = systemsOps(tree, read, chapters.map((c) => c.beatId));
        await applyOps(service, run.book_id, tree, ops);
        await applyOps(service, run.book_id, tree, gameTwinOps(tree)); // twin invariant, same as generated games
        await patchRun(service, id, { phase: "seal", skipped: [...skipped, ...sk] });
      });
    } else if (run.phase === "seal") {
      // The plan was derived FROM the prose — stamp the tree so nothing reads falsely stale.
      const index = byId(tree);
      const stamped = tree.map((n) => {
        let out = stampInput(n, index);
        if (n.kind === "scene" && (n.content as { prose?: { text?: string } }).prose?.text) out = stampProse(out);
        return out;
      });
      for (let i = 0; i < stamped.length; i += 200) {
        const { error } = await service.from("book_nodes").upsert(stamped.slice(i, i + 200).map((n) => ({
          id: n.id, book_id: n.book_id, parent_id: n.parent_id, level: n.level, kind: n.kind,
          position: n.position, content: n.content, authoring: n.authoring,
          proposals: n.proposals ?? null, chosen: n.chosen ?? null,
        })));
        if (error) throw new Error(`seal: ${error.message}`);
      }
      await patchRun(service, id, { status: "done" });
      return; // terminal — no next link
    }

    // Re-read status before chaining: stopRun may have cancelled us while this link worked.
    const cur = await loadRun(service, id);
    if (cur?.status === "running") await reinvoke(FN, { id });
  } catch (e) {
    console.error(`${FN} run ${id} failed:`, e);
    await patchRun(service, id, { status: "error", error: String((e as Error)?.message ?? e).slice(0, 1000) }).catch(() => {});
  }
}

// ── HTTP surface ──────────────────────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    // Continue link — trusted via the chain secret; runs ONE unit in this worker.
    if (isChainCall(req) && typeof body.id === "number") {
      await processLink(body.id);
      return json({ ok: true });
    }

    // Kick-off — user-authenticated.
    const userClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);
    const bookId = body.bookId as number | undefined;
    if (!bookId) return json({ error: "bookId is required" }, 400);
    const { data: book } = await userClient.from("books").select("id").eq("id", bookId).maybeSingle();
    if (!book) return json({ error: "Book not found or access denied" }, 403);

    const service = serviceClient();
    // Dedupe: one running ascent per book — a second click just re-attaches to the live row.
    const { data: active } = await service.from("book_decompositions")
      .select("id").eq("book_id", bookId).eq("status", "running")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (active) return json({ id: (active as { id: number }).id, existing: true });

    // Revive: if the latest run ERRORED, resume it from its phase (its digests are paid for) rather
    // than starting over. Attempts reset — the click is the author's "try again" signal.
    const { data: latest } = await service.from("book_decompositions")
      .select("id, status").eq("book_id", bookId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if ((latest as { status?: string } | null)?.status === "error") {
      // ATOMIC claim (update … eq status 'error', returning): two racing revives must not both start
      // a chain — concurrent chains double-apply fold phases (the book-1234 duplicate-cast bug).
      const rid = (latest as { id: number }).id;
      const { data: claimed } = await service.from("book_decompositions")
        .update({ status: "running", error: null, attempts: {} })
        .eq("id", rid).eq("status", "error").select("id");
      if (claimed?.length) EdgeRuntime.waitUntil(processLink(rid));
      return json({ id: rid, resumed: !!claimed?.length, existing: !claimed?.length });
    }

    const tree = await loadTree(service, bookId);
    const total = chaptersOf(tree).length;
    if (!total) return json({ error: "No prose-bearing chapters to decompose." }, 400);

    const { data: row, error } = await service.from("book_decompositions")
      .insert({ book_id: bookId, created_by: user.id, status: "running", phase: "chapters", total })
      .select("id").single();
    if (error) throw error;
    const id = (row as { id: number }).id;
    // First link runs in this worker's background; every later link is a fresh chained invocation.
    EdgeRuntime.waitUntil(processLink(id));
    return json({ id });
  } catch (e) {
    console.error(`${FN} error:`, e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
