// dnaExpand — Phase 5: the "expand" verb. Calls dna-expand (bridge in dev, edge in prod) and applies the
// result as ONE authoritative value (not proposals): child nodes get the generated content (source=ai,
// accepted); a scene gets its prose. The author then edits / regenerates / locks. See novel-dna-spec.md §6.
import { supabase } from "@/integrations/supabase/client";
import { BRIDGE, bridgeFetch } from "@/lib/bridge";
import { deleteNode, loadTree, saveNode, saveNodes } from "@/features/dna/lib/bookNodes";
import { composeSceneImage, renderNodeSceneImage, type ComposedSceneImage } from "@/features/dna/lib/nodeSceneImages";
import { ensurePortraitFor } from "@/features/dna/lib/characterPortraits";
import { byId, deepMergeContent, newId, PARENT_KIND, pillarOf, presentCharacters, stampIllus, stampInput, stampProse, type BeatContent, type DnaNode, type GameContent, type NodeContent, type NodeKind, type RenderBrief, type SceneContent, type ThreadRef } from "@/features/dna/lib/novelDna";
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
interface PreparedProse { system: string; userContent: string; model: string; max_tokens: number }
interface ExpandResult {
  childKind?: NodeKind; childLevel?: number; children?: NodeContent[]; prose?: string; caption?: string; logline?: string;
  beatsheet?: boolean; beats?: BeatSheetEntry[]; actIds?: string[]; prepared?: PreparedProse;
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

// dna-expand invoke with per-attempt timeout + retry. Body is whatever the edge fn expects (target,
// optionally prepare). Used for everything EXCEPT the long prose generation, which streams off-worker.
async function invokeWithRetry(body: Record<string, unknown>, signal?: AbortSignal): Promise<ExpandResult> {
  let lastErr: Error = new Error("dna-expand failed");
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
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
      lastErr = new Error(timedOut
        ? `edge call timed out after ${ATTEMPT_TIMEOUT_MS / 1000}s (attempt ${attempt}/${MAX_ATTEMPTS})`
        : await readInvokeError(e));
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 1500)); // brief backoff before retry
    }
  }
  throw lastErr;
}

// Prose streams from the same-origin /api/stream-prose proxy (Vite middleware in dev, Vercel fn in prod):
// the long qwen generation runs OFF the Supabase worker, so its 80–140s wall-clock never hits the ~150s
// ceiling that was killing ~54% of calls (TO-DO/dna-streaming-proxy.md). The proxy holds the OpenRouter key
// and just pipes deltas; we accumulate them here. IDLE timeout (not total): a healthy stream emits tokens
// continuously, so "no bytes for STREAM_IDLE_MS" means a stall → abort + retry; a slow-but-flowing 3-minute
// generation is never wrongly cut. dna-expand assembled the prompt (incl. the v2 digest) in `prepare` mode.
const STREAM_IDLE_MS = 45_000;

async function streamProse(prepared: PreparedProse, signal?: AbortSignal): Promise<string> {
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
      // they kept the connection alive but are not prose. Strip BEFORE the empty-check so an all-heartbeat
      // (content-never-arrived / truncated) stream correctly reads as "no prose" and retries.
      // eslint-disable-next-line no-control-regex
      const prose = text.replace(/\u0000/g, "").trim();
      if (!prose) throw new Error("stream produced no prose");
      return prose;
    } catch (e) {
      clearTimeout(timer);
      if (signal?.aborted) throw e; // real user cancel — never retry
      const stalled = (e as Error)?.name === "AbortError";
      lastErr = new Error(stalled ? `prose stream stalled (>${STREAM_IDLE_MS / 1000}s idle, attempt ${attempt}/${MAX_ATTEMPTS})` : (e as Error).message);
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
    const prose = await streamProse(prepared, signal);
    return { prose };
  }
  return invokeWithRetry({ bookId, nodeId, target }, signal);
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
  // CAUSALITY: the beat's produced/depended state lands on its first scene (the move that earns/spends it).
  if (beat.establishes?.length && scenes[0]) scenes[0].establishes = beat.establishes;
  if (beat.needs?.length && scenes[0]) scenes[0].needs = beat.needs;
  // Chaptering: a beat opens a chapter (the legible default; author can merge/rename later).
  if (startPosition === 0 && scenes[0] && !scenes[0].chapter_start) scenes[0].chapter_start = { title: chapterTitleFromBeat(beatNode) };
}

export async function expandNode(
  bookId: number, node: DnaNode, target: string, opts: { startPosition?: number; replaceIds?: string[]; signal?: AbortSignal; brief?: RenderBrief } = {},
): Promise<{ added: number }> {
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
    };
    await saveNode(updated);
    return { added: 0 };
  }

  if (target === "prose") {
    const text = (res.prose ?? "").trim();
    if (!text) throw new Error("No prose was generated.");
    const updated: DnaNode = {
      ...node,
      content: deepMergeContent(node.content, { prose: { text, words: wordCount(text) } }), // canonical DNA merge
      authoring: { ...node.authoring, source: node.authoring.source === "user" ? "ai_then_user" : "ai", status: "accepted" },
    };
    await saveNode(stampProse(updated));
    return { added: 0 };
  }

  if (res.beatsheet) return persistBeatSheet(bookId, res);

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
  return { added: made.length };
}

// Re-export so callers don't need a second lib import.
export type { ComposedSceneImage };

/**
 * Phase 1 of the two-phase illustrate flow: write the page CAPTION synchronously, stamp illus_src_hash
 * against the current plan, ensure every present character has a reference portrait, then COMPOSE (but do
 * NOT render) the scene image prompt. The caller shows the returned ComposedSceneImage to the author for
 * editing, then calls renderSceneIllustration.
 *
 * Caption is page text (prose-adjacent, generated by dna-expand); only the IMAGE prompt gets the preview
 * gate. Stamping at caption time records what the illustration is made from — plan changes → stale (isIllusStale).
 */
export async function composeSceneIllustration(bookId: number, node: DnaNode): Promise<ComposedSceneImage> {
  if (node.kind !== "scene") throw new Error("composeSceneIllustration expects a scene node");

  // Write the caption + stamp (the plan-only hash; image_url arrives later via render).
  const res = await callExpand(bookId, node.id, "caption");
  const text = (res.caption ?? "").trim();
  if (!text) throw new Error("No caption was generated.");
  const updated: DnaNode = {
    ...node,
    content: deepMergeContent(node.content, { caption: { text, words: wordCount(text) } }),
    authoring: { ...node.authoring, source: node.authoring.source === "user" ? "ai_then_user" : "ai", status: "accepted" },
  };
  await saveNode(stampIllus(updated));

  // CONSISTENCY ANCHOR: ensure every present character has a reference portrait before the scene render.
  // Read the live tree so a bulk "illustrate all" loop reuses a portrait minted earlier in the run.
  const tree = await loadTree(bookId);
  const freshScene = tree.find((n) => n.id === node.id) ?? node;
  for (const character of presentCharacters(freshScene, tree)) await ensurePortraitFor(bookId, character);

  // Compose the image prompt (synchronous, no render, no row inserted).
  const artNote = (node.content as SceneContent).art_note?.trim() || undefined;
  return composeSceneImage(bookId, node.id, { instruction: artNote });
}

/**
 * Phase 2 of the two-phase illustrate flow: render the (possibly author-edited) ComposedSceneImage and
 * pin the chosen image onto the scene node (content.image_url → render reads this). Durable: the insert
 * returns immediately; the image lands over Realtime when ready.
 */
export async function renderSceneIllustration(bookId: number, nodeId: string, c: ComposedSceneImage): Promise<void> {
  await renderNodeSceneImage(bookId, nodeId, { prompt: c.prompt, refImages: c.refImages, model: c.model, pin: true });
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

  const posByAct: Record<string, number> = {};
  const made: DnaNode[] = entries.map((e) => {
    const parent_id = actIds[e.act] ?? actIds[0];
    const position = (posByAct[parent_id] = (posByAct[parent_id] ?? 0) + 1) - 1;
    return { id: newId(), book_id: bookId, parent_id, level: res.childLevel ?? 4, kind: "beat" as NodeKind, position, content: e.content as NodeContent, authoring: { source: "ai" as const, locked: false, status: "accepted" as const } };
  });
  // Stamp against each beat's act parent so they don't read stale on arrival.
  const index = byId([...acts, ...made]);
  await saveNodes(made.map((n) => stampInput(n, index)));
  for (const b of oldBeats) await deleteNode(b.id); // replace last — cascade removes their scenes
  return { added: made.length };
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
export async function generateExpansionOps(bookId: number, node: DnaNode, target: string): Promise<{ ops: NodeOp[]; summary: string }> {
  const res = await callExpand(bookId, node.id, target);

  if (target === "logline") {
    const text = (res.logline ?? "").trim();
    if (!text) throw new Error("No logline was generated.");
    return { ops: [{ op: "edit", id: node.id, content: { logline: text } }], summary: "Refine the logline" };
  }
  if (target === "prose") {
    const text = (res.prose ?? "").trim();
    if (!text) throw new Error("No prose was generated.");
    return { ops: [{ op: "edit", id: node.id, content: { prose: { text, words: wordCount(text) } } }], summary: `Write prose (${wordCount(text)}w)` };
  }
  if (res.beatsheet) {
    const actIds = res.actIds ?? [];
    const entries = res.beats ?? [];
    if (!actIds.length || !entries.length) throw new Error("Empty beat sheet.");
    // One replace_children per act — mirrors persistBeatSheet's replace semantics, so the review shows a
    // real before→after (the unlocked beats it removes + the new set) and a regenerate never duplicates beats.
    const byAct = new Map<string, NewSubtree[]>();
    for (const e of entries) {
      const pid = actIds[e.act] ?? actIds[0];
      (byAct.get(pid) ?? byAct.set(pid, []).get(pid)!).push({ content: e.content as NodeContent });
    }
    const ops: NodeOp[] = [...byAct].map(([parentId, children]) => ({ op: "replace_children", parentId, childKind: "beat", children }));
    return { ops, summary: `Generate beat sheet (${entries.length} beats)` };
  }

  const children = res.children ?? [];
  if (!children.length) throw new Error("No children were generated.");
  const childKind = (res.childKind ?? "scene") as NodeKind;
  // Scenes inherit their beat's plan before being proposed (parity with the commit path).
  if (childKind === "scene" && node.kind === "beat") realizeScenesFromBeat(node, children as SceneContent[], 0);
  // parentId = the triggering node; applyNodeOps re-homes pillar-parented kinds (entities + acts) onto
  // the pillar at apply, so the named parent only matters for the contextual rungs (scene→beat).
  const ops: NodeOp[] = children.map((content) => ({ op: "add", kind: childKind, parentId: node.id, content }));
  return { ops, summary: `Generate ${GEN_LABEL[childKind] ?? childKind} (${children.length})` };
}

/** Generate via the engine and STAGE the result as a proposal on the book's agent thread (review in the rail). */
export async function proposeGeneration(bookId: number, node: DnaNode, target: string): Promise<void> {
  const { ops, summary } = await generateExpansionOps(bookId, node, target);
  const proposal: AgentProposal = { id: newId(), layer: "dna", summary, ops };
  await stageGeneratedProposal(bookId, proposal);
}
