// agent-focus — the book-agent's DECLARED focus: what we're working on right now (docs/agent-focus.md).
//
// The agent has always had a mode; it was derived (dna-journey stages), invisible, and unoverridable —
// expressed as scattered predicates inside threadSystem (`discovering`, `inInterview`, the three-state
// `injectObjective` rule). This module makes that mode a first-class, author-declarable object.
//
// ── THE TWO INVARIANTS (docs/agent-focus.md §2) ──────────────────────────────────────────────────────
// Focus may narrow WHAT IS OFFERED (tools, skills) and WHAT IS SALIENT (which ambient blocks, scoped
// how). It may NEVER narrow:
//   1. VISIBILITY — the whole tree ships every turn, always. This is precisely the scope-fence that
//      docs/agent-context-model.md deleted; do not rebuild it here under a new name.
//   2. WRITE PERMISSION — locks are the only immutability; the Apply/Discard review gate is the safety.
// The test that decides every future case: curation is ANCHORING iff the omitted thing is still
// REACHABLE. A narrowing the agent cannot name and cannot escape is a fence, whatever we call it.
//
// ── THE DEGRADATION RULE ─────────────────────────────────────────────────────────────────────────────
// `wide` is the IDENTITY element: no declared focus ⇒ mode `wide` ⇒ focusBlock() === "" and
// focusSkills() === [], so the assembled prompt is byte-identical to pre-focus behaviour. Locked by
// agent-focus.test.ts. Every new mode is additive; none may make `wide` do more or less.
import type { Brief } from "./brief.ts";
import { stageComplete, type StageKey } from "./dna-journey.ts";
import type { DnaNode, SceneContent } from "./novel-dna.ts";

export type FocusModeKey =
  | "wide"
  | "interview"
  | "logline"
  | "foundations"
  | "structure"
  | "scenes"
  | "draft-scene"
  | "consistency-audit";

/** How many nodes a mode operates ON. `required` modes are meaningless without one (you cannot "draft
 *  a scene" in the abstract); `none` modes act on something that isn't a node at all (the interview's
 *  artifact lives in brief.vision). See docs/agent-focus.md §3. */
export type TargetArity = "required" | "optional" | "none";

export interface FocusMode {
  key: FocusModeKey;
  label: string;
  /** One line, shown on the chip's tooltip and in the mode picker. */
  blurb: string;
  target: TargetArity;
  /** The journey stage this mode serves — used to SUGGEST a mode from the derived stage. null = it
   *  spans stages (wide, and cross-cutting tasks like a consistency audit). */
  stage: StageKey | null;
  /** Skill playbooks (agent-skills.ts names) this mode always wants injected, on top of whatever the
   *  ask's triggers match. Additive — never a replacement, so a missed trigger can't cost technique. */
  skills: string[];
  /** The completion predicate — what makes this focus DONE, so it self-clears instead of going stale
   *  (docs/agent-focus.md §6). Absent = the author exits it manually. */
  done?: (nodes: DnaNode[], target: string | null, brief: Brief | null) => boolean;
  /** Told to the model, so a narrowing always announces its own way out. */
  exitHint: string;
}

// ── done() helpers — small, pure, and shared with the journey twins' notion of "finished" ────────────

const visionCompiled = (brief: Brief | null): boolean => !!brief?.vision?.compiled_at;

const seedHasLogline = (nodes: DnaNode[]): boolean => {
  const seed = nodes.find((n) => n.kind === "seed");
  return !!seed && seed.authoring?.status === "accepted" &&
    !!String((seed.content as { logline?: string })?.logline ?? "").trim();
};

const sceneHasProse = (nodes: DnaNode[], target: string | null): boolean => {
  if (!target) return false;
  const n = nodes.find((x) => x.id === target);
  if (!n || n.kind !== "scene") return false;
  const prose = (n.content as SceneContent)?.prose;
  return !!String(prose?.text ?? "").trim();
};

const stageDone = (key: StageKey) => (nodes: DnaNode[]): boolean => stageComplete(nodes)[key] === true;

// ── The registry (policy-as-data — same idiom as agent-skills.ts / craft-kb.ts) ──────────────────────
// A new mode is ONE entry. Order here is the mode-picker order.

export const FOCUS_MODES: FocusMode[] = [
  {
    key: "wide",
    label: "Wide",
    blurb: "No particular focus — the whole book is fair game.",
    target: "none",
    stage: null,
    skills: [],
    exitHint: "",
  },
  {
    key: "interview",
    label: "Interview",
    blurb: "Draw the author's vision out in conversation and capture it.",
    target: "none",
    stage: "premise",
    skills: ["vision-interview"],
    done: (_nodes, _target, brief) => visionCompiled(brief),
    exitHint: "If the author wants to move on before the vision is complete, say so and offer to widen.",
  },
  {
    key: "logline",
    label: "Logline",
    blurb: "Shape the idea into a logline and a premise with a dramatic question.",
    target: "none",
    stage: "premise",
    skills: ["premise-craft", "options-craft"],
    done: (nodes) => seedHasLogline(nodes),
    exitHint: "If the author wants to work elsewhere, say so and offer to widen.",
  },
  {
    key: "foundations",
    label: "Foundations",
    blurb: "The pillar, cast, world, and voice the whole book stands on.",
    target: "optional",
    stage: "foundations",
    skills: ["character-craft", "world-craft"],
    done: stageDone("foundations"),
    exitHint: "If the author wants to work elsewhere, say so and offer to widen.",
  },
  {
    key: "structure",
    label: "Structure",
    blurb: "Acts, beats, and the causal spine between them.",
    target: "optional",
    stage: "structure",
    skills: ["structure-craft", "thread-craft"],
    done: stageDone("structure"),
    exitHint: "If the author wants to work elsewhere, say so and offer to widen.",
  },
  {
    key: "scenes",
    label: "Scenes",
    blurb: "Break beats into scenes that each turn a value.",
    target: "optional",
    stage: "scenes",
    skills: ["scene-plan-craft"],
    done: stageDone("scenes"),
    exitHint: "If the author wants to work elsewhere, say so and offer to widen.",
  },
  {
    key: "draft-scene",
    label: "Drafting a scene",
    blurb: "Sketch, render, and read back one scene.",
    target: "required",
    stage: "draft",
    skills: ["render-brief", "editorial-read"],
    done: (nodes, target) => sceneHasProse(nodes, target),
    exitHint: "If the author asks about anything outside this scene, answer it and offer to widen the focus.",
  },
  {
    key: "consistency-audit",
    label: "Consistency audit",
    blurb: "Hunt contradictions and dropped promises across the whole book.",
    // NOTE: deliberately NO target and NO narrowing of what is visible — an audit needs the WHOLE book.
    // This mode is the proof of the invariant: what a focus narrows is the MENU and the SALIENCE, never
    // the territory (docs/agent-focus.md §5).
    target: "optional",
    stage: null,
    skills: ["editorial-read"],
    exitHint: "The audit spans the whole book; say so and offer to widen if the author wants something else.",
  },
];

const BY_KEY = new Map(FOCUS_MODES.map((m) => [m.key, m]));

export const getFocusMode = (key: string | null | undefined): FocusMode =>
  BY_KEY.get((key ?? "") as FocusModeKey) ?? FOCUS_MODES[0];

/** The stored declaration, straight off the run row (all NULL = no declaration). */
export interface StoredFocus {
  mode: string | null;
  target: string | null;
  at: string | null;
}

export interface ResolvedFocus {
  mode: FocusMode;
  target: string | null;
  /** The author explicitly declared this (vs. the `wide` default). */
  declared: boolean;
  /** done() fired — the caller CLEARS the row and tells the author what completed (§6 "Complete"). */
  completed: boolean;
  /** The declared target no longer resolves (deleted node) — treated as no target, never as an error. */
  targetMissing: boolean;
}

/**
 * Resolve the stored declaration against the LIVE tree. Pure, so a retried chain link re-derives the
 * identical focus (the resume invariant).
 *
 * Degradation: nothing stored ⇒ `wide`, undeclared, no completion — the caller's prompt is unchanged.
 * A stored mode we don't recognise (rolled back a mode, or a hand-edited row) also falls back to
 * `wide` rather than throwing: an unreadable declaration must never brick the agent.
 */
export function resolveFocus(stored: StoredFocus | null, nodes: DnaNode[], brief: Brief | null): ResolvedFocus {
  const key = stored?.mode ?? null;
  if (!key || !BY_KEY.has(key as FocusModeKey) || key === "wide") {
    return { mode: FOCUS_MODES[0], target: null, declared: false, completed: false, targetMissing: false };
  }
  const mode = BY_KEY.get(key as FocusModeKey)!;
  // A `none`-arity mode ignores any target it was somehow handed (the interview has no node to act on).
  const wanted = mode.target === "none" ? null : (stored?.target ?? null);
  const exists = wanted ? nodes.some((n) => n.id === wanted) : false;
  const target = exists ? wanted : null;
  return {
    mode,
    target,
    declared: true,
    completed: mode.done ? mode.done(nodes, target, brief) : false,
    targetMissing: !!wanted && !exists,
  };
}

/** The mode the journey's derived stage SUGGESTS — the default chip the author can accept or override
 *  ("derived proposes, author disposes"). Never auto-applied; the caller offers it. */
export function suggestedMode(nodes: DnaNode[], brief: Brief | null): FocusModeKey {
  if (!visionCompiled(brief) && !brief?.vision?.skipped && !nodes.some((n) => n.kind !== "seed") && !seedHasLogline(nodes)) {
    return "interview";
  }
  if (!seedHasLogline(nodes)) return "logline";
  const done = stageComplete(nodes);
  if (!done.foundations) return "foundations";
  if (!done.structure) return "structure";
  if (!done.scenes) return "scenes";
  return "draft-scene";
}

/**
 * The `<focus_mode>` block for the volatile tail of the prompt.
 *
 * Framed as an ANCHOR, never an imperative: it states what the author declared they're working on and
 * — critically — that a different ask still wins. That framing is the same lesson `<current_objective>`
 * and `<story_analysis>` already paid for; a declared focus is STICKIER than a derived objective, so it
 * needs the disclaimer more, not less.
 *
 * Returns "" when undeclared, so an undeclared turn's prompt is byte-identical to pre-focus behaviour.
 */
export function focusBlock(resolved: ResolvedFocus, targetLabel?: string): string {
  if (!resolved.declared) return "";
  const { mode, target } = resolved;
  const lines = [
    `The author has set the focus to: ${mode.label} — ${mode.blurb}`,
    target ? `Target node: [${target}]${targetLabel ? ` “${targetLabel}”` : ""} — this is what the focus operates on.` : "",
    resolved.targetMissing ? "(The node this focus targeted no longer exists — say so and offer to re-target or widen.)" : "",
    "Lead with this unless the author's message asks for something else — a concrete ask ALWAYS wins over the focus.",
    mode.exitHint,
  ].filter(Boolean);
  return `<focus_mode note="what the author declared they're working on — an anchor for where to start, NOT a restriction. The whole book is still visible and every unlocked node is still editable.">\n${lines.join("\n")}\n</focus_mode>`;
}

/** Skill playbooks the declared mode always wants. Additive to the ask's trigger matches — a mode
 *  states the JOB, triggers still catch an ad-hoc ask inside it. Empty when undeclared. */
export function focusSkills(resolved: ResolvedFocus): string[] {
  return resolved.declared ? resolved.mode.skills : [];
}
