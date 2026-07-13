// dnaExpand — Phase 5: the "expand" verb. Calls dna-expand (bridge in dev, edge in prod) and applies the
// result as ONE authoritative value (not proposals): child nodes get the generated content (source=ai,
// accepted); a scene gets its prose. The author then edits / regenerates / locks. See novel-dna-spec.md §6.
import { supabase } from "@/integrations/supabase/client";
import { BRIDGE, bridgeFetch } from "@/lib/bridge";
import { deleteNode, loadTree, saveNode, saveNodes } from "@/features/dna/lib/bookNodes";
import { byId, deepMergeContent, emptyNode, gameTwins, newId, PARENT_KIND, pillarOf, stampInput, stampProse, stampSketch, type BeatContent, type DnaNode, type GameContent, type MeterContent, type NodeContent, type NodeKind, type RenderBrief, type SceneContent, type SceneSketch, type TentpoleContent, type ThreadContent, type ThreadRef, type VoiceContent } from "@/features/dna/lib/novelDna";
import { stageGeneratedProposal, type AgentProposal } from "@/features/dna/lib/agentThread";
import type { NewSubtree, NodeOp } from "@/features/dna/lib/dnaChat";

/** A short, legible chapter title from a beat's summary (the working title; the author renames). */
function chapterTitleFromBeat(beat: DnaNode): string {
  const summary = (beat.content as BeatContent).summary?.trim() ?? "";
  if (!summary) return "Untitled";
  const firstClause = summary.split(/[—–.;:]/)[0].trim();
  const words = firstClause.split(/\s+/).slice(0, 7).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

interface BeatSheetEntry { act: number; content: BeatContent }
// Assembled by dna-expand's `prepare` mode and POSTed to /api/stream-prose verbatim. `provider` is the
// admin's ai_provider setting, resolved server-side — the proxy honours it rather than re-reading settings.
interface PreparedProse { system: string; userContent: string; model: string; max_tokens: number; provider?: string }
// A thread the beat sheet MINTED because none was pre-declared (docs/dna-structure-analysis.md Finding 1) —
// id assigned server-side so the beats reference it; the client persists it under the pillar.
interface MintedThread { id: string; content: NodeContent }
interface ExpandResult {
  childKind?: NodeKind; childLevel?: number; children?: NodeContent[]; prose?: string; logline?: string;
  beatsheet?: boolean; beats?: BeatSheetEntry[]; actIds?: string[]; threads?: MintedThread[]; prepared?: PreparedProse;
  needsRepair?: boolean; repairPrepared?: PreparedProse;
  // target 'contract' (W1: compile the brief) — genre tentpoles + seeded meters + register bounds.
  contract?: boolean; tentpoles?: { summary?: string }[]; meters?: MeterContent[]; voice_constraints?: string[];
  sketch?: SceneSketch; // target 'sketch' — the scene treatment (what/how), generated before prose
  // The ai_calls row that produced this result's content — from dna-expand's `meta.loggedCallId` (direct
  // targets) or the stream-prose proxy's logged row (prose/beatsheet). Stamped onto the committed node(s)
  // as `last_ai_call_id` for the tree's view-details panel. Absent for phase:"prepare"/needsRepair replies
  // (no content committed yet) and for the BRIDGE dev path (doesn't log to ai_calls).
  callId?: number | null;
}

// Browser-owned orchestration of the per-call retry. The dominant prod failure is a HUNG edge call:
// qwen tail-latency runs 10× its ~82s median and overruns the Supabase worker's ~150s wall-clock, so the
// worker is killed and supabase-js surfaces a contentless non-2xx. We don't wait for that — cap each
// attempt and retry, since a fresh call almost always lands back in the normal band. dna-expand returns
// content and the BROWSER persists (expandNode → saveNode), so the edge call writes no nodes and retrying
// it can't double-write. The user's `signal` (batch Stop) is a real cancel and is never retried.
// Sized ABOVE the Supabase worker's own ~150s wall-clock kill: the server self-bounds a stall (returns a
// 546 / dropped connection near 150s), so the browser timeout is only a backstop for the rare case where
// the worker hangs without closing. Set too low (e.g. 120s) it would abort — and discard — calls the server
// actually completes in the 116–140s band, which is strictly worse. Raise the SERVER ceiling (or move the
// digest out of the worker, TO-DO/dna-streaming-proxy.md) to make calls land comfortably under it.
const ATTEMPT_TIMEOUT_MS = 170_000;
const MAX_ATTEMPTS = 3;

// supabase-js FunctionsHttpError parks the actual `{ error }` body on `.context` (a Response) and only
// exposes the generic "Edge Function returned a non-2xx status code" as `.message`. Dig out the real text.
async function readInvokeError(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.text === "function") {
    try {
      const body = await ctx.clone().text();
      const parsed = JSON.parse(body) as { error?: string };
      if (parsed?.error) return parsed.error;
      if (body.trim()) return body.slice(0, 500);
    } catch { /* not JSON / already consumed — fall through to the generic message */ }
  }
  return String((error as Error)?.message ?? error);
}

// §v4 (docs/agent-improvement-remaining.md): under concurrent worker-pool load (dna-decompose running
// alongside dna-expand), the SAME edge function returns a 546 WORKER_RESOURCE_LIMIT — pool contention, not a
// broken call. Detected on book 1229 (calls 7347/7352): a scene's prose had already streamed by the time a
// LATER call in the same turn hit 546, so discarding after the generic retry budget throws away real,
// paid-for generation. supabase-js's FunctionsHttpError parks the numeric status on `.context.status`; a
// plain fetch failure only has it in the message.
export function isWorkerResourceLimit(e: unknown): boolean {
  const status = (e as { context?: { status?: number } })?.context?.status;
  if (status === 546) return true;
  return /\b546\b|WORKER_RESOURCE_LIMIT/i.test(String((e as Error)?.message ?? e));
}

// dna-expand invoke with per-attempt timeout + retry. Body is whatever the edge fn expects (target,
// optionally prepare). Used for everything EXCEPT the long prose generation, which streams off-worker.
async function invokeWithRetry(body: Record<string, unknown>, signal?: AbortSignal): Promise<ExpandResult> {
  let lastErr: Error = new Error("dna-expand failed");
  let maxAttempts = MAX_ATTEMPTS;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    // Combine the caller's cancel signal with a per-attempt timeout. If the timeout fires, `signal` is
    // still un-aborted → we know it was a stall (not a user Stop) and retry.
    const timeout = AbortSignal.timeout(ATTEMPT_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const { data, error } = await supabase.functions.invoke("dna-expand", { body, signal: combined });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      return data as ExpandResult;
    } catch (e) {
      if (signal?.aborted) throw e; // real user cancel — propagate, never retry
      const timedOut = (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError";
      const overloaded = !timedOut && isWorkerResourceLimit(e);
      lastErr = new Error(timedOut
        ? `edge call timed out after ${ATTEMPT_TIMEOUT_MS / 1000}s (attempt ${attempt}/${maxAttempts})`
        : await readInvokeError(e));
      // Contention needs time to clear, not a fast re-hit of the same full pool — and it's worth one bonus
      // attempt beyond the generic budget precisely because a prior attempt in this turn may have already
      // streamed real prose upstream of this call.
      if (overloaded) maxAttempts = Math.max(maxAttempts, MAX_ATTEMPTS + 1);
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, overloaded ? 3000 * attempt : 1500));
    }
  }
  throw lastErr;
}

// Off-worker generation streams from the same-origin /api/stream-prose proxy (Vite middleware in dev, Vercel
// fn in prod): the long generation call runs OFF the Supabase worker, so its 80–140s wall-clock never hits the
// ~150s ceiling that was killing ~54% of prose calls (TO-DO/dna-streaming-proxy.md). Generic despite the route
// name — the proxy's wire shape (system/userContent/model/max_tokens → streamed text) doesn't care what the
// text IS, so the beat sheet's generation + repair calls reuse it too. The proxy holds the provider key and
// just pipes deltas; we accumulate them here. IDLE timeout (not total): a healthy stream emits tokens
// continuously, so "no bytes for STREAM_IDLE_MS" means a stall → abort + retry; a slow-but-flowing multi-minute
// generation is never wrongly cut. dna-expand assembles the prompt in `prepare` (prose) / `phase: "prepare"`
// (beatsheet) mode. `kind` only labels error messages (what's actually being streamed).
const STREAM_IDLE_MS = 45_000;

async function streamText(prepared: PreparedProse, signal?: AbortSignal, kind: string = "prose"): Promise<{ text: string; callId: number | null }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  let lastErr: Error = new Error("stream-prose failed");
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const idle = new AbortController();
    const combined = signal ? AbortSignal.any([signal, idle.signal]) : idle.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bump = () => { clearTimeout(timer); timer = setTimeout(() => idle.abort(), STREAM_IDLE_MS); };
    try {
      bump();
      const res = await fetch("/api/stream-prose", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(prepared),
        signal: combined,
      });
      if (!res.ok || !res.body) {
        const t = await res.text().catch(() => "");
        let msg = `stream-prose ${res.status}`;
        try { msg = (JSON.parse(t) as { error?: string }).error ?? msg; } catch { if (t.trim()) msg = t.slice(0, 300); }
        throw new Error(msg);
      }
      // The proxy echoes the ai_calls row it logged this generation under (set before any bytes stream) —
      // the link `expandNode`/`persistBeatSheet` stamp onto the node as `last_ai_call_id`.
      const callIdHeader = res.headers.get("x-ai-call-id");
      const callId = callIdHeader != null ? Number(callIdHeader) : null;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bump(); // ANY byte (prose OR a reasoning-phase heartbeat) resets the idle clock — that's what keeps
                // a reasoning model's long thinking phase from tripping the timeout.
        text += decoder.decode(value, { stream: true });
      }
      clearTimeout(timer);
      // Strip the proxy's NUL heartbeats (STREAM_HEARTBEAT, emitted during the model's reasoning phase) —
      // they kept the connection alive but are not real output. Strip BEFORE the empty-check so an
      // all-heartbeat (content-never-arrived / truncated) stream correctly reads as empty and retries.
      // eslint-disable-next-line no-control-regex
      const out = text.replace(/\u0000/g, "").trim();
      if (!out) throw new Error(`stream produced no ${kind}`);
      return { text: out, callId };
    } catch (e) {
      clearTimeout(timer);
      if (signal?.aborted) throw e; // real user cancel — never retry
      const stalled = (e as Error)?.name === "AbortError";
      lastErr = new Error(stalled ? `${kind} stream stalled (>${STREAM_IDLE_MS / 1000}s idle, attempt ${attempt}/${MAX_ATTEMPTS})` : (e as Error).message);
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastErr;
}

async function callExpand(bookId: number, nodeId: string, target: string, signal?: AbortSignal, brief?: RenderBrief): Promise<ExpandResult> {
  if (BRIDGE) {
    const r = await bridgeFetch(`/dna-expand`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookId, nodeId, target, brief }), signal });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    return d as ExpandResult;
  }
  // Prose: two hops — a fast `prepare` invoke (context + v2 digest + the agent's curated brief, under the
  // worker ceiling) then an off-worker stream of the long generation. Everything else: one invoke with retry.
  if (target === "prose") {
    const { prepared } = await invokeWithRetry({ bookId, nodeId, target, prepare: true, brief }, signal);
    if (!prepared) throw new Error("dna-expand prepare returned no payload");
    const { text: prose, callId } = await streamText(prepared, signal, "prose");
    return { prose, callId };
  }
  // Beat sheet: same off-worker shape as prose, extended with a second "finalize" hop — the sanitize/lint/
  // repair-decision logic stays server-side (cheap, DB-bound, already twin-tested via novelDna.ts), only the
  // up-to-two 8000-token generations leave the worker. See doc_1783354954000_beatsheet_streaming_proxy.md.
  if (target === "beatsheet") {
    const { prepared } = await invokeWithRetry({ bookId, nodeId, target, phase: "prepare", brief }, signal);
    if (!prepared) throw new Error("dna-expand prepare returned no payload");
    const { text: rawText, callId: rawCallId } = await streamText(prepared, signal, "beat sheet");
    let res = await invokeWithRetry({ bookId, nodeId, target, phase: "finalize", rawText }, signal);
    let callId = rawCallId;
    if (res.needsRepair) {
      if (!res.repairPrepared) throw new Error("dna-expand finalize flagged needsRepair with no repair payload");
      const { text: repairText, callId: repairCallId } = await streamText(res.repairPrepared, signal, "beat sheet repair");
      res = await invokeWithRetry({ bookId, nodeId, target, phase: "finalize", rawText, repairText }, signal);
      callId = repairCallId; // the accepted content came from the repair pass — attribute to that call
    }
    return { ...res, callId };
  }
  return invokeWithRetry({ bookId, nodeId, target, brief }, signal);
}

const wordCount = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);

/**
 * Expand a node toward `target`: generate prose (scene) or the next-rung children (one true set), persist.
 * `replaceIds` (regenerate) are deleted AFTER the new children land — so a regenerate swaps the unlocked
 * siblings without ever leaving the tree empty mid-flight; locked siblings are simply not passed in.
 */
// Scenes REALIZE their beat (root fix, novel-dna-flow.md §7): inherit the beat's planned polarity, thread
// anchors, set-piece placements, game moves, causal state and chaptering rather than re-inventing them
// locally — so the global plan stays authoritative. Mutates `scenes` in place. Shared by the COMMIT path
// (expandNode) and the PROPOSE path (generateExpansionOps) so a proposed scene set carries the SAME plan.
export function realizeScenesFromBeat(beatNode: DnaNode, scenes: SceneContent[], startPosition: number): void {
  const beat = beatNode.content as BeatContent;
  scenes.forEach((sc) => {
    if (beat.polarity && sc.value_shift && !sc.value_shift.polarity) sc.value_shift.polarity = beat.polarity;
  });
  // The beat's thread anchors land on its first (representative) scene — the beat's position in reading order
  // is what the promise axis checks; which inner scene realizes it is fine detail.
  if (scenes[0] && beat.threads?.length) scenes[0].threads = beat.threads as ThreadRef[];
  // The beat's tentpole placements distribute across its scenes (one set-piece per scene, in order).
  (Array.isArray(beat.realizes) ? beat.realizes : []).forEach((tpId, i) => { const s = scenes[i] ?? scenes[scenes.length - 1]; if (s) s.realizes_tentpole = tpId; });
  // World-rule grounding lands on the LAST scene (the scene that resolves the beat's turn — the win fires the rule).
  if (beat.grounds_in?.length && scenes.length) scenes[scenes.length - 1].grounds_in = beat.grounds_in;
  // Game moves: `plays` advances the contest (first scene); `resolves` decides it (last scene).
  if (beat.plays?.length && scenes[0]) scenes[0].plays = beat.plays;
  if (beat.resolves?.length && scenes.length) scenes[scenes.length - 1].resolves = beat.resolves;
  // CAUSALITY (novel-dna-flow.md §7): the beat's turn CONSUMES state at entry and PRODUCES state when it
  // lands — so `needs` (depended-on state) belongs on the FIRST scene (where the beat begins) and
  // `establishes` (produced state) on the LAST scene (where the turn RESOLVES — co-located with grounds_in /
  // resolves). Piling both on scene 0 (the old behaviour) told the opening scene to "produce everything" and
  // left the resolving scene's plan-conformance check (P2.2) expecting nothing it actually delivers. For a
  // single-scene beat first === last, so it keeps both (P3/§3d).
  if (beat.needs?.length && scenes[0]) scenes[0].needs = beat.needs;
  if (beat.establishes?.length && scenes.length) scenes[scenes.length - 1].establishes = beat.establishes;
  // Chaptering: a beat opens a chapter (the legible default; author can merge/rename later).
  if (startPosition === 0 && scenes[0] && !scenes[0].chapter_start) scenes[0].chapter_start = { title: chapterTitleFromBeat(beatNode) };
}

/** Ensure the book's root `seed` node exists — the agent can't create a parent-less root, so this is the
 *  ONE place that mints it (on first tree load). Idempotent: returns the existing seed if there is one.
 *  The logline is left empty — the author writes it (or asks the agent to draft one) once the brief is in
 *  place; it is never auto-derived from the brief's idea. Two callers can race this (e.g. the tree's own
 *  bootstrap firing twice under strict mode); `book_nodes_one_root_per_book` makes the loser's insert fail,
 *  and we re-read and hand back the winner's seed instead of erroring. */
export async function ensureSeed(bookId: number): Promise<DnaNode> {
  const nodes = await loadTree(bookId);
  const existing = nodes.find((n) => n.kind === "seed");
  if (existing) return existing;
  const seed = emptyNode(bookId, "seed", 0, null);
  try {
    await saveNode(seed);
    return seed;
  } catch (e) {
    if ((e as { code?: string })?.code === "23505") {
      const winner = (await loadTree(bookId)).find((n) => n.kind === "seed");
      if (winner) return winner;
    }
    throw e;
  }
}

export async function expandNode(
  bookId: number, node: DnaNode, target: string, opts: { startPosition?: number; replaceIds?: string[]; signal?: AbortSignal; brief?: RenderBrief } = {},
): Promise<{ added: number; text?: string }> {
  const { startPosition = 0, replaceIds = [], signal, brief } = opts;
  const res = await callExpand(bookId, node.id, target, signal, brief);

  if (target === "logline") {
    // Seed → logline: write the seed's OWN logline (a polished refinement of brief.idea), not a child node.
    const text = (res.logline ?? "").trim();
    if (!text) throw new Error("No logline was generated.");
    const updated: DnaNode = {
      ...node,
      content: deepMergeContent(node.content, { logline: text }),
      authoring: { ...node.authoring, source: node.authoring.source === "user" ? "ai_then_user" : "ai", status: "accepted" },
      last_ai_call_id: res.callId ?? null,
    };
    await saveNode(updated);
    return { added: 0, text };
  }

  if (target === "sketch") {
    // Scene → sketch: write the scene's OWN treatment (what/how this page renders), not a child node — the
    // same own-content pattern as logline. Stamped so an edit to the scene's spec (or the sketch itself)
    // correctly badges it stale (isSketchStale); prose_src_hash already covers the sketch for free since it
    // hashes the whole plan.
    const sketch = res.sketch;
    if (!sketch) throw new Error("No sketch was generated.");
    const updated: DnaNode = {
      ...node,
      content: deepMergeContent(node.content, { sketch }),
      authoring: { ...node.authoring, source: node.authoring.source === "user" ? "ai_then_user" : "ai", status: "accepted" },
      last_ai_call_id: res.callId ?? null,
    };
    await saveNode(stampSketch(updated));
    return { added: 0 };
  }

  if (target === "prose") {
    const text = (res.prose ?? "").trim();
    if (!text) throw new Error("No prose was generated.");
    const updated: DnaNode = {
      ...node,
      content: deepMergeContent(node.content, { prose: { text, words: wordCount(text) } }), // canonical DNA merge
      authoring: { ...node.authoring, source: node.authoring.source === "user" ? "ai_then_user" : "ai", status: "accepted" },
      last_ai_call_id: res.callId ?? null,
    };
    await saveNode(stampProse(updated));
    return { added: 0, text };
  }

  if (res.beatsheet) return persistBeatSheet(bookId, res);
  if (res.contract) return persistContract(bookId, res);

  const children = res.children ?? [];
  if (!children.length) throw new Error("No children were generated.");
  // INVARIANT (schema §4): any kind whose schema parent is the (singleton) pillar — every entity AND the
  // act rung — ALWAYS hangs off the real pillar, never whatever node triggered the expand. Drive this
  // off PARENT_KIND (the single source of truth for attachment) so a stray caller (wrong focused node) can't
  // orphan tentpoles / voice / cast / acts onto premise — where dna-expand's pillar-scoped filters
  // silently can't see them. Beats/scenes keep their focused parent (which act/beat is contextual).
  const wantsPillar = res.childKind && PARENT_KIND[res.childKind] === "pillar";
  const parentNode = wantsPillar && node.kind !== "pillar"
    ? (pillarOf(await loadTree(bookId)) ?? node)
    : node;
  const made: DnaNode[] = children.map((content, i) => ({
    id: newId(), book_id: bookId, parent_id: parentNode.id,
    level: res.childLevel ?? parentNode.level + 1, kind: (res.childKind ?? "scene") as NodeKind,
    position: startPosition + i, content,
    authoring: { source: "ai", locked: false, status: "accepted" },
    last_ai_call_id: res.callId ?? null,
  }));
  // Games: couples.to references a SIBLING game by NAME (the edge fn couldn't resolve it — ids are minted
  // here). Resolve name→id across the freshly-minted batch; drop couples to a game that didn't resolve.
  if (res.childKind === "game") {
    const nameToId = new Map(made.map((g) => [String((g.content as GameContent).name ?? "").trim().toLowerCase(), g.id]));
    for (const g of made) {
      const c = g.content as GameContent;
      if (Array.isArray(c.couples)) {
        c.couples = c.couples
          .map((k) => ({ ...k, to: nameToId.get(String(k.to ?? "").trim().toLowerCase()) ?? "" }))
          .filter((k) => k.to && k.to !== g.id); // resolved + not self-coupling
      }
    }
  }
  // Scenes REALIZE their beat (root fix): inherit the beat's plan rather than re-inventing it locally.
  if (res.childKind === "scene" && node.kind === "beat") {
    realizeScenesFromBeat(node, made.map((s) => s.content as SceneContent), startPosition);
  }
  // Stamp each against its inputs (parent + the new siblings) so they don't read as stale on arrival.
  const index = byId([parentNode, ...made]);
  await saveNodes(made.map((n) => stampInput(n, index)));
  for (const id of replaceIds) await deleteNode(id); // regenerate: drop the unlocked predecessors last
  // Game-twin invariant (Finding 2): a freshly generated game gets its score meter + resolution thread.
  if (res.childKind === "game") await reconcileGameTwins(bookId);
  return { added: made.length };
}

/**
 * Game-twin invariant (docs/dna-structure-analysis.md Finding 2): every game carries a `game_score` meter
 * (its plottable trajectory) and a resolution thread (the promise it pays off). Rather than ask the
 * author/agent to create and align all three by hand, DERIVE the two twins from the game. Idempotent — both
 * twins carry `owner = game.id`, so we mint only the ones missing; safe to call after any game-creating apply.
 * Returns how many twin nodes were minted (0 when everything's already in place). See gameTwins (pure).
 */
export async function reconcileGameTwins(bookId: number): Promise<number> {
  const tree = await loadTree(bookId);
  const games = tree.filter((n) => n.kind === "game");
  if (!games.length) return 0;
  const pillar = pillarOf(tree);
  if (!pillar) return 0;
  const meters = tree.filter((n) => n.kind === "meter");
  const threads = tree.filter((n) => n.kind === "thread");
  const hasMeter = (gid: string) => meters.some((m) => (m.content as MeterContent).owner === gid && (m.content as MeterContent).kind === "game_score");
  const hasThread = (gid: string) => threads.some((t) => (t.content as ThreadContent).owner === gid);
  let mPos = meters.filter((m) => m.parent_id === pillar.id).length;
  let tPos = threads.filter((t) => t.parent_id === pillar.id).length;
  const made: DnaNode[] = [];
  for (const game of games) {
    const twins = gameTwins(game);
    if (!hasMeter(game.id)) made.push({ id: newId(), book_id: bookId, parent_id: pillar.id, level: 2, kind: "meter", position: mPos++, content: twins.meter as NodeContent, authoring: { source: "ai", locked: false, status: "accepted" } });
    if (!hasThread(game.id)) made.push({ id: newId(), book_id: bookId, parent_id: pillar.id, level: 2, kind: "thread", position: tPos++, content: twins.thread as NodeContent, authoring: { source: "ai", locked: false, status: "accepted" } });
  }
  if (!made.length) return 0;
  const index = byId([...tree, ...made]);
  await saveNodes(made.map((n) => stampInput(n, index)));
  return made.length;
}

/**
 * Persist the GLOBAL beat sheet (root fix): a flat, act-indexed beat list (thread refs already resolved
 * to ids and the setup→payoff schedule already enforced server-side). Beats are grouped under their act;
 * existing UNLOCKED beats under those acts are replaced (cascade drops their scenes). See §7 of the flow.
 */
async function persistBeatSheet(bookId: number, res: ExpandResult): Promise<{ added: number }> {
  const actIds = res.actIds ?? [];
  const entries = res.beats ?? [];
  if (!actIds.length || !entries.length) throw new Error("Empty beat sheet.");
  const tree = await loadTree(bookId);
  const acts = actIds.map((id) => tree.find((n) => n.id === id)).filter(Boolean) as DnaNode[];
  const oldBeats = tree.filter((n) => n.kind === "beat" && actIds.includes(n.parent_id ?? "") && !n.authoring.locked);

  // Threads the beat sheet MINTED (Finding 1) land under the pillar FIRST, keeping their server ids so the
  // beats' thread refs resolve. Nothing to reconcile when the author pre-declared them (res.threads absent).
  const minted = res.threads ?? [];
  if (minted.length) {
    const pillar = pillarOf(tree);
    if (pillar) {
      const base = tree.filter((n) => n.kind === "thread" && n.parent_id === pillar.id).length;
      const threadNodes: DnaNode[] = minted.map((t, i) => ({
        id: t.id, book_id: bookId, parent_id: pillar.id, level: 2, kind: "thread" as NodeKind, position: base + i,
        content: t.content, authoring: { source: "ai", locked: false, status: "accepted" }, last_ai_call_id: res.callId ?? null,
      }));
      const tIndex = byId([pillar, ...threadNodes]);
      await saveNodes(threadNodes.map((n) => stampInput(n, tIndex)));
    }
  }

  const posByAct: Record<string, number> = {};
  const made: DnaNode[] = entries.map((e) => {
    const parent_id = actIds[e.act] ?? actIds[0];
    const position = (posByAct[parent_id] = (posByAct[parent_id] ?? 0) + 1) - 1;
    return { id: newId(), book_id: bookId, parent_id, level: res.childLevel ?? 4, kind: "beat" as NodeKind, position, content: e.content as NodeContent, authoring: { source: "ai" as const, locked: false, status: "accepted" as const }, last_ai_call_id: res.callId ?? null };
  });
  // Stamp against each beat's act parent so they don't read stale on arrival.
  const index = byId([...acts, ...made]);
  await saveNodes(made.map((n) => stampInput(n, index)));
  for (const b of oldBeats) await deleteNode(b.id); // replace last — cascade removes their scenes
  return { added: made.length };
}

// ── The compiled brief CONTRACT (W1) ─────────────────────────────────────────
// Skip-if-present derivation shared by BOTH contract exits: which of the engine's tentpoles/meters are
// genuinely NEW against the tree (case-insensitive summary/name match) plus the voice-constraint merge
// (dedupe, existing entries preserved in order). Pure — the exits decide how to land it.
export function contractDelta(tree: DnaNode[], res: Pick<ExpandResult, "tentpoles" | "meters" | "voice_constraints">): {
  tentpoles: string[]; meters: MeterContent[];
  voice?: { node?: DnaNode; merged: string[] }; // node undefined = no voice_profile exists yet
} {
  const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
  const haveTp = new Set(tree.filter((n) => n.kind === "tentpole").map((n) => norm((n.content as TentpoleContent).summary)));
  const haveM = new Set(tree.filter((n) => n.kind === "meter").map((n) => norm((n.content as MeterContent).name)));
  const tentpoles: string[] = [];
  for (const t of res.tentpoles ?? []) {
    const summary = String(t?.summary ?? "").trim();
    if (summary && !haveTp.has(norm(summary))) { haveTp.add(norm(summary)); tentpoles.push(summary); }
  }
  const meters: MeterContent[] = [];
  for (const m of res.meters ?? []) {
    const name = String(m?.name ?? "").trim();
    if (name && !haveM.has(norm(name))) { haveM.add(norm(name)); meters.push({ ...m, name }); }
  }
  const incoming = (res.voice_constraints ?? []).map((c) => String(c ?? "").trim()).filter(Boolean);
  let voice: { node?: DnaNode; merged: string[] } | undefined;
  if (incoming.length) {
    const vp = tree.find((n) => n.kind === "voice_profile");
    const current = Array.isArray((vp?.content as VoiceContent | undefined)?.constraints) ? (vp!.content as VoiceContent).constraints! : [];
    const have = new Set(current.map(norm));
    const news = incoming.filter((c) => !have.has(norm(c)) && (have.add(norm(c)), true));
    if (news.length) voice = { node: vp, merged: [...current, ...news] };
  }
  return { tentpoles, meters, voice };
}

/** Persist the compiled brief contract: tentpole/meter nodes under the pillar + register bounds merged into
 *  the voice profile. Idempotent — contractDelta skips everything already in the tree, so a re-run lands
 *  nothing new. When no voice_profile exists, a DRAFT one is created carrying ONLY the constraints: the
 *  tree-wide validate() emits no missing_field for its empty required `style` (that rule fires only at the
 *  validateOps add boundary + the completeness score), the prompt-side voiceBlock reads the node regardless
 *  of status, and `draft` keeps it visibly unfinished until the voice step fills the style. */
export async function persistContract(bookId: number, res: ExpandResult): Promise<{ added: number }> {
  const tree = await loadTree(bookId);
  const pillar = pillarOf(tree);
  if (!pillar) throw new Error("No pillar yet — accept the pillar before compiling the contract.");
  const delta = contractDelta(tree, res);
  let tpPos = tree.filter((n) => n.kind === "tentpole" && n.parent_id === pillar.id).length;
  let mPos = tree.filter((n) => n.kind === "meter" && n.parent_id === pillar.id).length;
  const mk = (kind: NodeKind, position: number, content: NodeContent): DnaNode =>
    ({ id: newId(), book_id: bookId, parent_id: pillar.id, level: 2, kind, position, content, authoring: { source: "ai", locked: false, status: "accepted" }, last_ai_call_id: res.callId ?? null });
  const made: DnaNode[] = [
    ...delta.tentpoles.map((summary) => mk("tentpole", tpPos++, { summary })),
    ...delta.meters.map((content) => mk("meter", mPos++, content as NodeContent)),
  ];
  if (made.length) {
    const index = byId([pillar, ...made]);
    await saveNodes(made.map((n) => stampInput(n, index)));
  }
  if (delta.voice) {
    if (delta.voice.node) {
      const vp = delta.voice.node;
      // Additive merge on a taste field — authoring untouched (the profile stays whose-ever it was).
      await saveNode({ ...vp, content: { ...vp.content, constraints: delta.voice.merged } });
    } else {
      const node: DnaNode = { ...mk("voice_profile", 0, { constraints: delta.voice.merged }), authoring: { source: "ai", locked: false, status: "draft" } };
      await saveNode(stampInput(node, byId([pillar, node])));
    }
  }
  return { added: made.length + (delta.voice ? 1 : 0) };
}

// ── The PROPOSE path — generate, but don't commit ────────────────────────────
// expandNode commits the engine's output as authoritative, accepted nodes. generateExpansionOps runs the
// SAME engine (callExpand) but converts the result into reviewable node OPS instead of saving — so a
// post-pillar "✦ generate" can ride the agent thread's review channel (phantoms in the tree, apply/discard
// in the rail) exactly like the chat agent's propose_node_ops. Engine quality + proposal review.
const GEN_LABEL: Partial<Record<NodeKind, string>> = {
  character: "cast", world_fact: "world", relationship: "relationships", tentpole: "set-pieces",
  game: "games", thread: "threads", voice_profile: "voice", act: "acts", scene: "scenes", location: "locations",
};

/** Generate via the dna-expand engine and return the result as reviewable ops (no writes). One network call
 *  plus the SAME local enrichment the commit path applies (scene→beat realization). */
export async function generateExpansionOps(bookId: number, node: DnaNode, target: string, brief?: RenderBrief, signal?: AbortSignal): Promise<{ ops: NodeOp[]; summary: string; callId?: number | null }> {
  const res = await callExpand(bookId, node.id, target, signal, brief);
  const callId = res.callId ?? null;

  if (target === "logline") {
    const text = (res.logline ?? "").trim();
    if (!text) throw new Error("No logline was generated.");
    return { ops: [{ op: "edit", id: node.id, content: { logline: text } }], summary: "Refine the logline", callId };
  }
  if (target === "prose") {
    const text = (res.prose ?? "").trim();
    if (!text) throw new Error("No prose was generated.");
    return { ops: [{ op: "edit", id: node.id, content: { prose: { text, words: wordCount(text) } } }], summary: `Write prose (${wordCount(text)}w)`, callId };
  }
  if (res.contract) {
    const tree = await loadTree(bookId);
    const delta = contractDelta(tree, res);
    const ops: NodeOp[] = [
      // parentId = the triggering node (the pillar); applyNodeOps re-homes pillar-parented kinds anyway.
      ...delta.tentpoles.map((summary): NodeOp => ({ op: "add", kind: "tentpole", parentId: node.id, content: { summary } })),
      ...delta.meters.map((content): NodeOp => ({ op: "add", kind: "meter", parentId: node.id, content: content as NodeContent })),
    ];
    // Register bounds ride an EDIT of the existing voice profile (a patch, so validateOps passes it). With
    // NO voice_profile in the tree they're dropped on THIS exit: an `add` op can't carry an empty required
    // `style` past the fail-closed boundary — the commit exit (persistContract) creates the draft carrier.
    if (delta.voice?.node) ops.push({ op: "edit", id: delta.voice.node.id, content: { constraints: delta.voice.merged } });
    if (!ops.length) throw new Error("The brief's contract is already compiled — nothing new to derive.");
    const parts = [
      delta.tentpoles.length ? `${delta.tentpoles.length} tentpoles` : "",
      delta.meters.length ? `${delta.meters.length} meters` : "",
      delta.voice?.node ? "register bounds" : "",
    ].filter(Boolean);
    return { ops, summary: `Compile the brief's contract (${parts.join(", ")})`, callId };
  }
  if (res.beatsheet) {
    const actIds = res.actIds ?? [];
    const entries = res.beats ?? [];
    if (!actIds.length || !entries.length) throw new Error("Empty beat sheet.");
    // Threads the beat sheet MINTED (Finding 1) become `add` ops carrying their server id (op.id), so the
    // same-batch beats' thread refs resolve at apply. Parent = the pillar node (this expand's target);
    // applyNodeOps re-homes thread → pillar anyway, so any pillar-side id is fine.
    const threadOps: NodeOp[] = (res.threads ?? []).map((t) => ({ op: "add", kind: "thread", parentId: node.id, content: t.content, id: t.id }));
    // One replace_children per act — mirrors persistBeatSheet's replace semantics, so the review shows a
    // real before→after (the unlocked beats it removes + the new set) and a regenerate never duplicates beats.
    const byAct = new Map<string, NewSubtree[]>();
    for (const e of entries) {
      const pid = actIds[e.act] ?? actIds[0];
      (byAct.get(pid) ?? byAct.set(pid, []).get(pid)!).push({ content: e.content as NodeContent });
    }
    const beatOps: NodeOp[] = [...byAct].map(([parentId, children]) => ({ op: "replace_children", parentId, childKind: "beat", children }));
    const threadNote = threadOps.length ? ` + ${threadOps.length} threads` : "";
    return { ops: [...threadOps, ...beatOps], summary: `Generate beat sheet (${entries.length} beats${threadNote})`, callId };
  }

  const children = res.children ?? [];
  if (!children.length) throw new Error("No children were generated.");
  const childKind = (res.childKind ?? "scene") as NodeKind;
  // Scenes inherit their beat's plan before being proposed (parity with the commit path).
  if (childKind === "scene" && node.kind === "beat") realizeScenesFromBeat(node, children as SceneContent[], 0);
  // parentId = the triggering node; applyNodeOps re-homes pillar-parented kinds (entities + acts) onto
  // the pillar at apply, so the named parent only matters for the contextual rungs (scene→beat).
  const ops: NodeOp[] = children.map((content) => ({ op: "add", kind: childKind, parentId: node.id, content }));
  return { ops, summary: `Generate ${GEN_LABEL[childKind] ?? childKind} (${children.length})`, callId };
}

/** Generate via the engine and STAGE the result as a proposal on the book's agent thread (review in the rail). */
export async function proposeGeneration(bookId: number, node: DnaNode, target: string): Promise<void> {
  const { ops, summary } = await generateExpansionOps(bookId, node, target);
  const proposal: AgentProposal = { id: newId(), layer: "dna", summary, ops };
  await stageGeneratedProposal(bookId, proposal);
}
