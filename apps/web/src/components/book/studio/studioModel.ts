// studioModel — the read-model behind the Build Studio (the AI-tools build surface).
//
// The studio is one two-pane workbench: a Navigator (the 9-step build ladder + the whole-book map)
// and a Stage (the open step's tool, or a page's resolution ladder). Both panes read from THIS model,
// so the sequence (steps) and the depth (per-page nodes) are one derived truth — not two products.
//
// Everything here is derived from real artifacts (books + pages), reusing buildMap (planGraph) for the
// per-node pip states and the JourneyStudio derived-state rules for step gating. The ONLY non-derivable
// input is `journey` (the author's approval ledger) plus the three existence flags that can't be cheaply
// read from `pages` (spine / voice / a completed editor's read), which the host supplies.
import { buildMap, type CellState, type MapModel, type MapPage } from "@/lib/planGraph";
import { foundationsComplete, type Foundations } from "@/lib/foundations";
import { lintBook, type BookLint, type LintThread } from "@/lib/lints";
import { type PageMeta } from "@/lib/planProvenance";
import type { EditorJSON } from "@/types/editor";

export type StepKey =
  | "brief" | "foundations" | "spine" | "outline" | "beats" | "draft"
  | "read" | "revise" | "publish";

/** The build ladder (pin-driven flow): Voice is absorbed into Foundations sub-step 5. */
export const BUILD_STEPS: StepKey[] = ["brief", "foundations", "spine", "outline", "beats", "draft"];
/** Post-draft actions — unlocked once prose exists; not strictly ordered. */
export const POST_STEPS: StepKey[] = ["read", "revise", "publish"];
export const ALL_STEPS: StepKey[] = [...BUILD_STEPS, ...POST_STEPS];

export type Journey = Partial<Record<"brief" | "foundations" | "spine" | "outline" | "beats" | "draft", string>>;

// A build step's lifecycle. `awaiting` = its artifact exists and it's ready for the deliberate
// "Approve & continue" sign-off; `active` = it's the current step but its artifact isn't there yet.
export type StepStatus = "locked" | "active" | "awaiting" | "done" | "available";

// The Navigator's step dot collapses the status into one of four glyphs.
export type DotState = "done" | "active" | "ready" | "locked";

export const STEP_LABEL: Record<StepKey, string> = {
  brief: "Brief", foundations: "Foundations", spine: "Spine", outline: "Outline", beats: "Beats",
  draft: "Draft", read: "Read", revise: "Revise", publish: "Publish",
};

export const STEP_CAPTION: Record<StepKey, string> = {
  brief: "Tell the AI what the book is — every step below is drawn from it.",
  foundations: "The bedrock decisions — argument, ending, cast, tentpole moments, voice. What you pin here, the AI must keep.",
  spine: "The one-paragraph throughline the whole book realizes.",
  outline: "The chapters and pages as objectives — review, edit, create. No prose yet.",
  beats: "Walk the book page by page — plan the beat for each, one at a time or in bulk — before any prose.",
  draft: "Render the prose from the approved beats, in the book's voice.",
  read: "A structural critique of the draft — then auto-fix the critical & major issues.",
  revise: "Re-plan the outline or rework the draft — describe the change and review before it sticks.",
  publish: "Make the book public on pensive.me.",
};

export interface StudioPageRow {
  id: number;
  title?: string | null;
  page_index?: number;
  content?: EditorJSON | null;
  page_type?: "text" | "section";
  metadata?: PageMeta | null;
}

// A movement = a section header and the text pages that follow it (the book map's accordion unit).
export interface Movement {
  /** Stable key for React + collapse state. */
  key: string;
  /** Roman numeral position (I, II, …); blank for an implicit lead group with no section header. */
  num: string;
  title: string;
  pages: MapPage[];
}

export interface StudioModel {
  /** Which build rail this book is on (old: spine→…→voice; new: foundations, voice absorbed). */
  buildSteps: StepKey[];
  /** True when the book carries a foundations value (the pin-driven flow's flag). */
  newFlow: boolean;
  /** New-flow plan lints (§5) — empty on the old rail. */
  lints: BookLint[];
  /** Pages a tentpole moment is placed on (◆ markers in the map/list). */
  tentpolePageIds: Set<number>;
  map: MapModel;
  /** All non-section pages, in reading order. */
  textPages: MapPage[];
  movements: Movement[];
  counts: { objective: number; written: number; beats: number };
  hasScaffold: boolean;
  hasWritten: boolean;
  beatsRemaining: number;
  proseRemaining: number;
  ready: Record<StepKey, boolean>;
  statusOf: (k: StepKey) => StepStatus;
  dotOf: (k: StepKey) => DotState;
  /** First build step that's active/awaiting, else the first useful post-draft action. */
  current: StepKey;
  sync: { pct: number; gaps: number };
  pageById: (id: number) => MapPage | undefined;
  /** Index of a text page within textPages (for prev/next), or -1. */
  textIndexOf: (id: number) => number;
}

const ROMAN: [number, string][] = [
  [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];
function roman(n: number): string {
  let out = ""; let v = n;
  for (const [d, s] of ROMAN) while (v >= d) { out += s; v -= d; }
  return out;
}

// Body text excluding the leading title heading — decides if a page has real prose.
function bodyText(content: unknown): string {
  if (!content || typeof content !== "object") return typeof content === "string" ? content : "";
  const doc = content as { content?: Array<Record<string, unknown>> };
  if (!Array.isArray(doc.content)) return "";
  const nodes = doc.content[0]?.type === "heading" ? doc.content.slice(1) : doc.content;
  const walk = (n: Record<string, unknown>): string =>
    n.type === "text" ? String(n.text ?? "") : ((n.content as Array<Record<string, unknown>>) ?? []).map(walk).join("");
  return nodes.map(walk).join("").trim();
}

export interface BuildStudioModelInput {
  briefSet: boolean;
  spineText: string | null | undefined;
  spineStale?: boolean;
  pages: StudioPageRow[];
  journey: Journey;
  hasRead: boolean;
  isPublic: boolean;
  foundations?: Foundations | null;
  threads?: LintThread[];
}

/** Derive the whole studio read-model. Pure — the host fetches, this computes. */
export function buildStudioModel(input: BuildStudioModelInput): StudioModel {
  const map = buildMap({
    briefFilled: input.briefSet,
    spineText: input.spineText,
    spineStale: input.spineStale,
    pages: input.pages.map((p) => ({
      id: p.id,
      title: p.title ?? null,
      pageType: p.page_type === "section" ? "section" : "text",
      metadata: p.metadata ?? null,
      proseText: bodyText(p.content),
    })),
  });

  const textPages = map.pages.filter((p) => p.pageType === "text");

  // Group into movements: a section row opens a new movement; text pages before any section sit in an
  // implicit lead group (blank numeral).
  const movements: Movement[] = [];
  let lead: Movement | null = null;
  let n = 0;
  for (const p of map.pages) {
    if (p.pageType === "section") {
      n += 1;
      movements.push({ key: `mv-${p.id}`, num: roman(n), title: p.title || "(untitled section)", pages: [] });
    } else {
      if (movements.length === 0) {
        if (!lead) { lead = { key: "mv-lead", num: "", title: "Pages", pages: [] }; movements.push(lead); }
        lead.pages.push(p);
      } else {
        movements[movements.length - 1].pages.push(p);
      }
    }
  }

  // Counts (JourneyStudio rules): objective = has objective, no prose; written = has prose body; beats =
  // has a beat. Section rows excluded.
  let objective = 0, written = 0, beats = 0;
  for (const p of textPages) {
    if (p.prose !== "gap") written += 1;
    else if (p.objective !== "gap") objective += 1;
    if (p.beat !== "gap") beats += 1;
  }
  const counts = { objective, written, beats };
  const hasScaffold = counts.objective > 0 || counts.written > 0;
  const hasWritten = counts.written > 0;
  const beatsRemaining = Math.max(0, counts.objective + counts.written - counts.beats);
  const proseRemaining = counts.objective;

  const newFlow = true;
  const buildSteps = BUILD_STEPS;

  const approved = (k: StepKey) => k in input.journey && !!input.journey[k as keyof Journey];
  const ready: Record<StepKey, boolean> = {
    brief: input.briefSet,
    foundations: foundationsComplete(input.foundations),
    spine: !!(input.spineText && input.spineText.trim()), outline: hasScaffold,
    beats: hasScaffold && beatsRemaining === 0 && counts.beats > 0,
    draft: hasWritten && proseRemaining === 0,
    read: false, revise: false, publish: false,
  };

  const statusOf = (k: StepKey): StepStatus => {
    if (buildSteps.includes(k)) {
      if (approved(k)) return "done";
      const idx = buildSteps.indexOf(k);
      const priorDone = idx === 0 || approved(buildSteps[idx - 1]);
      if (!priorDone) return "locked";
      return ready[k] ? "awaiting" : "active";
    }
    if (k === "read") return !hasWritten ? "locked" : input.hasRead ? "done" : "available";
    if (k === "revise") return hasScaffold ? "available" : "locked";
    if (k === "publish") return !hasWritten ? "locked" : input.isPublic ? "done" : "available";
    return "locked";
  };

  const dotOf = (k: StepKey): DotState => {
    const s = statusOf(k);
    if (s === "done") return "done";
    if (s === "locked") return "locked";
    if (s === "awaiting") return "ready";
    if (s === "available") return "ready";
    return "active"; // active
  };

  const current: StepKey = (() => {
    for (const k of buildSteps) { const s = statusOf(k); if (s === "active" || s === "awaiting") return k; }
    if (hasWritten && !input.hasRead) return "read";
    if (!input.isPublic && hasWritten) return "publish";
    return "draft";
  })();

  const lints = lintBook({
    pages: input.pages.filter((p) => p.page_type !== "section").map((p) => ({ id: p.id, title: p.title ?? null, metadata: p.metadata ?? null })),
    threads: input.threads ?? [],
    foundations: input.foundations ?? null,
  });
  const tentpolePageIds = new Set<number>(
    (input.foundations?.tentpoles ?? []).map((t) => t.placed_page_id).filter((id): id is number => id != null),
  );

  const { totals } = map;
  const pct = totals.cells ? Math.round((totals.filled / totals.cells) * 100) : 0;
  const gaps = lints.filter((l) => l.severity === "error").length;

  const byId = new Map(map.pages.map((p) => [p.id, p] as const));
  const textIds = textPages.map((p) => p.id);

  return {
    buildSteps, newFlow, lints, tentpolePageIds,
    map, textPages, movements, counts, hasScaffold, hasWritten, beatsRemaining, proseRemaining,
    ready, statusOf, dotOf, current,
    sync: { pct, gaps },
    pageById: (id) => byId.get(id),
    textIndexOf: (id) => textIds.indexOf(id),
  };
}

// ── Token bridge ─────────────────────────────────────────────────────────────
// The prototype authored its own palette (--paper / --accent / --ink / …). We render against the
// shipped Paper design-system tokens instead, so the studio re-themes with the rest of the app. These
// helpers keep the long hsl(var(--…)) strings in one place.
export const tone = {
  faint: "text-[hsl(var(--pv-text-faint))]",
  muted: "text-[hsl(var(--pv-text-muted))]",
  ink: "text-foreground",
  accent: "text-[hsl(var(--pv-accent))]",
  lineSoft: "border-[hsl(var(--pv-border-soft))]",
  line: "border-border",
  surface2: "bg-[hsl(var(--pv-surface-2))]",
  accentWash: "bg-[hsl(var(--pv-accent))]/[0.08]",
} as const;

export const STATE_LABEL: Record<CellState, string> = { gap: "empty", drift: "out of sync", synced: "in sync" };
