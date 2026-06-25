// autopilot — auto-build a whole book from the brief by walking the Novel DNA forward pass end to end.
//
// The pipeline is already one primitive: expandNode(book, node, target) (lib/dnaExpand). The order is
// already data: the journey stages (lib/dnaJourney) + the per-kind expand verbs. This module ties them
// into a self-driving loop: repeatedly ask "what's the next rung that still needs generating?" and run
// that one expand, until the draft is complete.
//
// CLIENT-DRIVEN (the loop runs in the browser) because expandNode is the ONLY place DNA generate+persist
// lives — so the loop reuses 100% of the generation logic and works through the dev bridge unchanged. A
// durable book_generations row (kind 'autopilot') mirrors the loop so it is refresh-safe and resumable:
// every expand persists to book_nodes immediately, so a closed tab loses nothing — the tree IS the
// progress, and the row records where the loop is + the milestone pause. Two modes:
//   • auto      — run straight through to the drafted book, never stopping.
//   • milestone — build one journey STAGE, then park (status 'ready') for the author to review/edit/lock
//                 before continuing. The 5 stages are the milestones.
// The book's OUTPUT mode (books.mode, docs/picture-book-mode.md) switches only the final rung: prose mode
// writes prose; picture mode illustrates each scene (caption + a durable image render). The loop's draft
// rung is "kicked" (caption written / prose written); in picture mode the images then finish in background.
import { supabase } from "@/integrations/supabase/client";
import { loadTree } from "@/lib/bookNodes";
import { expandNode, composeSceneIllustration, renderSceneIllustration } from "@/lib/dnaExpand";
import { childrenOf, scenesInOrder, type DnaNode, type NodeKind, type SceneContent } from "@/lib/novelDna";
import { buildJourney, DNA_STAGES, type StageKey } from "@/lib/dnaJourney";

export type AutopilotMode = "auto" | "milestone";
// The book's OUTPUT mode (docs/picture-book-mode.md) — orthogonal to AutopilotMode. It changes only the
// last rung: prose writes prose; picture illustrates each scene (caption + a durable image render).
export type BookMode = "prose" | "picture";

// Stage order, lowest resolution → highest (premise → foundations → structure → scenes → draft).
const STAGE_ORDER: StageKey[] = DNA_STAGES.map((s) => s.key);
const stageLabel = (k: StageKey) => DNA_STAGES.find((s) => s.key === k)?.label ?? k;

// The RICH recipe — the gold-standard forward pass (docs/novel-dna-flow.md §7). The optional branches
// (world, set-pieces, relationships, threads, games) run BEFORE the global beat sheet because the sheet
// reads them to schedule promises, play the games, and pace the whole book. `per` selects the node(s) the
// expand runs on; `childKind` is what it produces (so "already there" is detectable); `needsKind` is a
// sibling prerequisite (relationships need cast). Single-yield steps are marked `attempted` after they run
// so an optional step that legitimately yields nothing (e.g. a book with no set-pieces) doesn't loop.
interface RecipeStep {
  stepKey: string;            // unique id, also the `attempted` key
  stage: StageKey;
  target: string;             // the expandNode target verb
  label: string;              // human action label
  childKind: NodeKind;        // the kind this step produces
  per: "seed" | "premise" | "pillar" | "eachBeat" | "eachScene";
  needsKind?: NodeKind;       // sibling kind that must already exist
}

const RICH_RECIPE: RecipeStep[] = [
  { stepKey: "premise", stage: "premise", target: "premise", label: "generate premise", childKind: "premise", per: "seed" },
  { stepKey: "pillar", stage: "foundations", target: "pillar", label: "generate pillar", childKind: "pillar", per: "premise" },
  { stepKey: "cast", stage: "foundations", target: "cast", label: "generate cast", childKind: "character", per: "pillar" },
  { stepKey: "voice_profile", stage: "foundations", target: "voice_profile", label: "generate voice profile", childKind: "voice_profile", per: "pillar", needsKind: "character" },
  { stepKey: "world", stage: "foundations", target: "world", label: "generate world", childKind: "world_fact", per: "pillar" },
  { stepKey: "set-pieces", stage: "foundations", target: "set-pieces", label: "generate set-pieces", childKind: "tentpole", per: "pillar" },
  { stepKey: "relationships", stage: "foundations", target: "relationships", label: "generate relationships", childKind: "relationship", per: "pillar", needsKind: "character" },
  { stepKey: "movements", stage: "structure", target: "movements", label: "generate acts", childKind: "movement", per: "pillar" },
  { stepKey: "threads", stage: "structure", target: "threads", label: "generate threads", childKind: "thread", per: "pillar" },
  { stepKey: "games", stage: "structure", target: "games", label: "generate games", childKind: "game", per: "pillar" },
  { stepKey: "beatsheet", stage: "structure", target: "beatsheet", label: "generate beat sheet", childKind: "beat", per: "pillar" },
  { stepKey: "scenes", stage: "scenes", target: "scenes", label: "generate scenes", childKind: "scene", per: "eachBeat" },
  // The final rung is mode-dependent (see the eachScene branch): prose mode writes prose; picture mode
  // illustrates (caption + image). `target`/`label` here are the prose default; the walker overrides them.
  { stepKey: "prose", stage: "draft", target: "prose", label: "write prose", childKind: "scene", per: "eachScene" },
];

export interface AutopilotProgress {
  mode: AutopilotMode;
  gate: number;            // highest stage INDEX the loop may build through (milestone pauses past it)
  stage: StageKey;         // the stage currently in focus
  phase: string;           // human label for the current action / state
  milestone?: StageKey | null; // set while paused: the stage just completed, awaiting approval
  attempted: string[];     // single-yield step keys already run (don't repeat a zero-yield optional)
  failedNodes: string[];   // node ids whose expand failed (skip them)
}

export interface AutopilotAction {
  node: DnaNode;
  target: string;
  stage: StageKey;
  stepKey: string;
  label: string;
  singleton: boolean;      // pillar/seed/premise-level (mark attempted) vs per-node (scenes/prose)
}

const accepted = (n?: DnaNode) => n?.authoring.status === "accepted";
const hasProse = (n: DnaNode) => !!((n.content as SceneContent).prose?.text ?? "").trim();
// Picture-mode "draft kicked": a CAPTION exists. composeSceneIllustration writes the caption synchronously
// then renderSceneIllustration kicks the durable image render (image_url pins later over Realtime), so
// caption — not image_url — is the loop's completion signal; keying on image_url re-illustrates every tick.
const hasCaption = (n: DnaNode) => !!((n.content as SceneContent).caption?.text ?? "").trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mk(step: RecipeStep, node: DnaNode, label: string, singleton: boolean, target = step.target): AutopilotAction {
  return { node, target, stage: step.stage, stepKey: step.stepKey, label, singleton };
}

/**
 * The next rung to generate, or null when the book is fully drafted. Pure: derived from the tree (same
 * spirit as buildJourney). `attempted` guards single-yield optional steps; `failed` skips poison nodes.
 * `mode` switches only the final rung (prose vs illustrate), per docs/picture-book-mode.md.
 */
export function nextAutopilotAction(nodes: DnaNode[], attempted: Set<string>, failed: Set<string>, mode: BookMode = "prose"): AutopilotAction | null {
  const of = (k: NodeKind) => nodes.filter((n) => n.kind === k);
  const seed = of("seed")[0], premise = of("premise")[0], pillar = of("pillar")[0];

  for (const step of RICH_RECIPE) {
    if (step.per === "seed") {
      if (seed && accepted(seed) && !premise && !attempted.has(step.stepKey)) return mk(step, seed, step.label, true);
      continue;
    }
    if (step.per === "premise") {
      if (premise && accepted(premise) && !pillar && !attempted.has(step.stepKey)) return mk(step, premise, step.label, true);
      continue;
    }
    if (step.per === "pillar") {
      if (!pillar || !accepted(pillar) || attempted.has(step.stepKey)) continue;
      if (step.needsKind && of(step.needsKind).length === 0) continue;
      if (step.target === "beatsheet" && of("movement").length === 0) continue; // sheet needs the acts
      if (of(step.childKind).length === 0) return mk(step, pillar, step.label, true);
      continue;
    }
    if (step.per === "eachBeat") {
      const beats = nodes.filter((n) => n.kind === "beat");
      const pending = beats.filter((b) => !childrenOf(nodes, b.id).some((c) => c.kind === "scene") && !failed.has(b.id));
      if (pending.length) {
        const total = beats.length, done = total - pending.length;
        return mk(step, pending[0], `generate scenes · beat ${done + 1}/${total}`, false);
      }
      continue;
    }
    if (step.per === "eachScene") {
      // Mode switch: prose mode writes prose (done = prose text); picture mode illustrates (done = caption).
      const picture = mode === "picture";
      const isDrafted = picture ? hasCaption : hasProse;
      const scenes = scenesInOrder(nodes);
      const pending = scenes.filter((s) => !isDrafted(s) && !failed.has(s.id));
      if (pending.length) {
        const total = scenes.length, done = total - pending.length;
        const verb = picture ? "illustrate scene" : "write prose";
        return mk(step, pending[0], `${verb} ${done + 1}/${total}`, false, picture ? "illustrate" : "prose");
      }
      continue;
    }
  }
  return null; // fully drafted
}

async function patch(id: number, fields: Record<string, unknown>): Promise<void> {
  await supabase.from("book_generations").update(fields).eq("id", id);
}

async function readBookMode(bookId: number): Promise<BookMode> {
  const { data } = await supabase.from("books").select("mode").eq("id", bookId).maybeSingle();
  return (data?.mode as BookMode) === "picture" ? "picture" : "prose";
}

// Run one rung with a small transient retry (LLM/image calls flake) before giving up. The 'illustrate'
// target is the picture-mode scene path (caption + durable image render); in autopilot (unattended) we
// skip the human preview gate by running compose→render directly without stopping to show the prompt.
async function runAction(bookId: number, a: AutopilotAction): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < 2; i++) {
    try {
      if (a.target === "illustrate") {
        const composed = await composeSceneIllustration(bookId, a.node);
        await renderSceneIllustration(bookId, a.node.id, composed);
      } else {
        await expandNode(bookId, a.node, a.target, {});
      }
      return;
    } catch (e) { lastErr = e; if (i === 0) await sleep(900); }
  }
  throw lastErr;
}

/** Insert the durable row and return its id. `mode` fixes the gate: auto never pauses; milestone pauses
 *  after each stage, starting from the journey's current (first incomplete) stage. */
export async function startAutopilot(bookId: number, mode: AutopilotMode): Promise<number> {
  const [tree, bookMode] = await Promise.all([loadTree(bookId), readBookMode(bookId)]);
  const gate = mode === "auto" ? STAGE_ORDER.length - 1 : buildJourney(tree, bookMode).nowIndex;
  const progress: AutopilotProgress = {
    mode, gate, stage: STAGE_ORDER[Math.min(gate, STAGE_ORDER.length - 1)], phase: "Starting…",
    milestone: null, attempted: [], failedNodes: [],
  };
  const { data, error } = await supabase
    .from("book_generations")
    .insert({ book_id: bookId, kind: "autopilot", scope: "book", status: "running", input: { mode }, progress })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not start auto-build.");
  return data.id as number;
}

/**
 * Drive the loop until it parks (milestone), finishes (done), fails (error) or is stopped (cancelled).
 * Idempotent + resumable: it reads its state from the row, so calling it again after a closed tab just
 * resumes from the current tree. `isCancelled` lets the owning component stop it in-tab immediately; a
 * cross-tab Stop is caught by the per-iteration status re-read.
 */
export async function runAutopilot(bookId: number, genId: number, isCancelled: () => boolean): Promise<void> {
  const { data: row } = await supabase.from("book_generations").select("progress").eq("id", genId).maybeSingle();
  if (!row) return;
  const prog = row.progress as AutopilotProgress;
  const mode = prog.mode;
  const gate = prog.gate;
  const bookMode = await readBookMode(bookId); // read fresh so a mid-build prose↔picture toggle is honored
  const attempted = new Set(prog.attempted ?? []);
  const failed = new Set(prog.failedNodes ?? []);
  let consecutiveFails = 0;

  const persist = (status: string, phase: string, stage: StageKey, milestone: StageKey | null) =>
    patch(genId, { status, progress: { mode, gate, stage, phase, milestone, attempted: [...attempted], failedNodes: [...failed] } });

  for (;;) {
    if (isCancelled()) return;
    // Cross-tab / cooperative stop: bail if someone drove the row terminal while we looped.
    const { data: cur } = await supabase.from("book_generations").select("status").eq("id", genId).maybeSingle();
    if (!cur || !["running"].includes(cur.status as string)) return;

    const tree = await loadTree(bookId);
    const action = nextAutopilotAction(tree, attempted, failed, bookMode);
    if (!action) { await persist("done", "Done", STAGE_ORDER[STAGE_ORDER.length - 1], null); return; }

    const stageIdx = STAGE_ORDER.indexOf(action.stage);
    if (mode === "milestone" && stageIdx > gate) {
      const completed = STAGE_ORDER[gate]; // everything through the gate is built — park for review
      await persist("ready", `Review ${stageLabel(completed)}`, completed, completed);
      return;
    }

    await persist("running", action.label, action.stage, null);
    try {
      await runAction(bookId, action);
      consecutiveFails = 0;
    } catch (e) {
      consecutiveFails++;
      if (!action.singleton) failed.add(action.node.id); // skip a poison scene/beat, keep going
      console.error(`autopilot: "${action.label}" failed:`, e);
      if (consecutiveFails >= 5) {
        await persist("error", "Stopped after repeated failures — check AI credits, then resume.", action.stage, null);
        return;
      }
    }
    if (action.singleton) attempted.add(action.stepKey); // ran once (yield or not) — don't repeat
  }
}

/** Approve the parked milestone and continue into the next stage (bumps the gate past the paused stage). */
export async function continueAutopilot(bookId: number, genId: number, isCancelled: () => boolean): Promise<void> {
  const { data: row } = await supabase.from("book_generations").select("progress").eq("id", genId).maybeSingle();
  if (!row) return;
  const prog = row.progress as AutopilotProgress;
  const gate = Math.min((prog.gate ?? 0) + 1, STAGE_ORDER.length - 1);
  await patch(genId, { status: "running", progress: { ...prog, gate, milestone: null, phase: "Resuming…" } });
  await runAutopilot(bookId, genId, isCancelled);
}

/** Resume a 'running' row that lost its driver (the tab was closed mid-stage). Picks up from the tree. */
export async function resumeAutopilot(bookId: number, genId: number, isCancelled: () => boolean): Promise<void> {
  await patch(genId, { status: "running" });
  await runAutopilot(bookId, genId, isCancelled);
}
