// forwardPass.ts — the client half of P1: sweep a chapter, one window at a time, carrying the brain.
//
// The loop IS the arrow of time. read-trace is stateless and only ever receives units 0..t plus the
// state folded from them, so a first-time reader's ignorance is a property of this loop rather than
// of a prompt instruction. Nothing here may ever pass a later window's text into an earlier call.
//
// Shape borrowed from lib/factLedger.ts's sequential ledger scan: the client owns the artifact and
// the fold, the server owns one judgement per call.
//
// TRANSPORT IS INJECTED (`call`), not imported. The browser passes an invokeFn-backed caller; the
// harness script passes a fetch-backed one. That keeps this module free of `@/` aliases and browser
// globals, so the sweep the page runs and the sweep the script runs are the same code — the same
// no-twin rule readerMachine.ts follows.
import { type ReaderUnit } from "./readerMachine";
import { emptyBrain, openQuestions, step, type BrainState, type Op, type UnitDelta } from "./brain";


// One window is a bounded prompt, not a fixed unit count: paragraphs vary from 1 to 140 words, so
// budgeting by WORDS keeps every call about the same size. ~900 words ≈ 1.2k tokens of passage,
// which leaves the 8k output budget entirely to the ops.
// Measured, not guessed: 12 units / 364 words produced 7.4k output tokens in 94s, and a 120s ceiling
// had already timed one call out. A Supabase worker dies around 150s, so the window has to keep the
// call comfortably under it — wall-clock is the binding constraint here, not the prompt budget.
const WINDOW_WORDS = 350;
const WINDOW_UNITS = 12;
// Carried state must stay bounded or the prompt grows with the book. For one chapter nothing is
// dropped; the caps matter when this is pointed at a whole novel.
const CARRY_ENTITIES = 90;
const CARRY_FACTS = 90;
const CARRY_QUESTIONS = 40;

export interface Window { from: number; to: number; units: ReaderUnit[] }

/**
 * REACTIVATION IS COMPUTED, NOT JUDGED. A `touch` op just says "something already known got
 * mentioned again" — which is a string match, so paying a model to notice it is both slower and
 * less reliable than doing it here. MDL again: the cheapest program that explains the data wins.
 *
 * This matters more than it looks. Activation decay is what makes the model forget, and forgetting
 * is what separates a plant from scenery — so the touch stream must be exhaustive, and only a
 * deterministic scan is. The model is left to judge what it alone can: meaning, want, and change.
 *
 * Entities already named by one of the unit's own ops are skipped — those ops touch on their own,
 * and counting them twice would inflate the mention count that importance is built from.
 */
export function autoTouch(text: string, state: BrainState, ops: Op[]): Op[] {
  if (!text) return ops;
  const named = new Set<string>();
  for (const op of ops) {
    if ("id" in op && typeof op.id === "string") named.add(op.id);
    if ("about" in op && typeof op.about === "string") named.add(op.about);
    if ("to" in op && typeof op.to === "string") named.add(op.to);
    if ("from" in op && typeof op.from === "string") named.add(op.from);
    if ("ids" in op && Array.isArray(op.ids)) op.ids.forEach((x) => named.add(x));
  }
  // Word-boundary, not substring: "Mira" must not fire on "miracle", and a false touch is worse than
  // a missed one here — it keeps something artificially alive and so hides the forgetting the whole
  // decay model exists to show.
  const hay = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  const hits = Object.values(state.entities)
    .filter((e) => {
      const name = e.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      return !named.has(e.id) && name.length >= 3 && hay.includes(` ${name} `);
    })
    .map((e) => e.id);
  return hits.length ? [...ops, { op: "touch", ids: hits } as Op] : ops;
}

/** Split units into word-budgeted windows. Pure — exported so the cost can be shown before spending. */
export function planWindows(units: ReaderUnit[]): Window[] {
  const out: Window[] = [];
  let cur: ReaderUnit[] = [];
  let words = 0;
  for (const u of units) {
    if (cur.length && (words + u.words > WINDOW_WORDS || cur.length >= WINDOW_UNITS)) {
      out.push({ from: cur[0].i, to: cur[cur.length - 1].i, units: cur });
      cur = []; words = 0;
    }
    cur.push(u); words += u.words;
  }
  if (cur.length) out.push({ from: cur[0].i, to: cur[cur.length - 1].i, units: cur });
  return out;
}

/**
 * The state handed to the next call. Deliberately LOSSY and deliberately not the whole brain:
 * activation, senses, and relations are the fold's business, and re-sending them would spend the
 * prompt on things the model does not need to name its ops. What it needs is the vocabulary —
 * which ids exist, what is true, what is still open, where we are.
 */
function carry(s: BrainState) {
  const byLive = Object.values(s.entities)
    .sort((a, b) => b.activation - a.activation || b.mentions - a.mentions)
    .slice(0, CARRY_ENTITIES);
  return {
    entities: byLive.map((e) => ({ id: e.id, kind: e.kind, name: e.name })),
    facts: Object.values(s.facts).slice(-CARRY_FACTS).map((f) => ({ key: f.key, value: f.value })),
    questions: openQuestions(s).slice(0, CARRY_QUESTIONS).map((q) => ({ qid: q.qid, text: q.text, kind: q.kind })),
    place: s.place,
    present: s.present,
  };
}

/**
 * Recompute every `touch` op from scratch. Touches are the one op class the model does not emit, so
 * they can be regenerated at any time from the units alone — which means a trace captured under an
 * older matcher can be brought in line with the current one without paying for the sweep again.
 * Pure, free, and idempotent.
 */
export function rebuildTouches(units: ReaderUnit[], deltas: UnitDelta[]): UnitDelta[] {
  const byIndex = new Map(units.map((u) => [u.i, u]));
  const state = emptyBrain();
  return deltas.map((d) => {
    const judged = d.ops.filter((o) => o.op !== "touch");
    const withTouch: UnitDelta = { ...d, ops: autoTouch(byIndex.get(d.i)?.text ?? "", state, judged) };
    step(state, withTouch);
    return withTouch;
  });
}

export interface ForwardProgress {
  window: number;
  windows: number;
  unitsDone: number;
  unitsTotal: number;
}

export interface ForwardResult {
  deltas: UnitDelta[];
  /** Windows that failed after their retry. Their units fold as no-ops, so time still advances. */
  failed: { from: number; to: number; error: string }[];
}

/** What one read-trace call needs and returns. The only thing that differs browser vs script. */
export type TraceCall = (
  body: { units: { i: number; text: string }[]; state: ReturnType<typeof carry>; position: { from: number; total: number } },
  signal?: AbortSignal,
) => Promise<{ deltas?: UnitDelta[] } | null>;

/**
 * Run the forward pass over one chapter's units. Sequential BY NECESSITY — window n+1's prompt
 * contains the state folded from window n, so this cannot be parallelised without breaking the
 * causality the whole pass exists to model.
 */
export async function runForwardPass(
  units: ReaderUnit[],
  call: TraceCall,
  opts: {
    onProgress?: (p: ForwardProgress) => void;
    onDeltas?: (d: UnitDelta[]) => void;
    signal?: AbortSignal;
    /**
     * RESUME. Deltas already collected for the leading units of this same chapter. Because the brain
     * is event-sourced, resuming costs nothing extra: fold them and the reader is exactly where they
     * were, so windows already paid for are never re-run. A sweep is ~30 sequential model calls over
     * half an hour, which is long enough that losing it to one interruption is unacceptable.
     */
    resumeFrom?: UnitDelta[];
  } = {},
): Promise<ForwardResult> {
  const state = emptyBrain();
  const deltas: UnitDelta[] = [];
  const failed: ForwardResult["failed"] = [];

  // RESUME = TRUNCATE TO THE FIRST GAP. A unit only counts as read if it was actually read; filler
  // from a failed window is explicitly not, or a resumed run would inherit the hole it was started
  // to fix. And resume must stop at the FIRST unread unit rather than replaying past it: the sweep
  // is sequential, so folding the tail before re-reading the middle would apply every intervening
  // unit's decay to a brain that hasn't met the middle yet. Work after a gap is discarded and
  // re-run — wasteful, but the alternative is a state that was never actually reachable.
  const prior = opts.resumeFrom ?? [];
  const firstGap = prior.find((d) => d.failed)?.i ?? Infinity;
  const done = new Set<number>();
  for (const d of prior) {
    if (d.i >= firstGap) break;
    step(state, d);
    deltas.push(d);
    done.add(d.i);
  }

  // Plan over the WHOLE chapter, then skip fully-read windows — planning over the remainder would
  // re-cut the boundaries and produce windows that don't line up with what was already read.
  const windows = planWindows(units).filter((w) => !w.units.every((u) => done.has(u.i)));

  for (let w = 0; w < windows.length; w++) {
    if (opts.signal?.aborted) break;
    const win = windows[w];
    const body = {
      units: win.units.map((u) => ({ i: u.i, text: u.text })),
      state: carry(state),
      position: { from: win.from, total: units.length },
    };

    let got: UnitDelta[] | null = null;
    let lastErr = "";
    // One retry: a dropped JSON parse on a long structural call is common enough to be worth a
    // second attempt and cheap enough not to matter. More than one and a poison window stalls the run.
    for (let attempt = 0; attempt < 2 && !got; attempt++) {
      try {
        const data = await call(body, opts.signal);
        if (Array.isArray(data?.deltas)) got = data.deltas;
        else lastErr = "no deltas returned";
      } catch (e) {
        lastErr = String((e as Error)?.message ?? e);
      }
    }

    if (!got) {
      failed.push({ from: win.from, to: win.to, error: lastErr || "no deltas returned" });
      // A failed window still ADVANCES TIME: its units fold as empty deltas so attention decays over
      // them. Skipping them entirely would leave the reader implausibly sharp across the gap. They
      // are MARKED, so nothing downstream mistakes an unread stretch for a quiet one.
      got = win.units.map((u) => ({ i: u.i, ops: [] as Op[], failed: true as const }));
    }

    // Fold in reading order, adding the computed reactivations. autoTouch reads the state as it
    // stands BEFORE this unit — which is exactly what a re-mention means: something already known.
    const byIndex = new Map(win.units.map((u) => [u.i, u]));
    for (const d of got) {
      const withTouch: UnitDelta = { ...d, ops: autoTouch(byIndex.get(d.i)?.text ?? "", state, d.ops) };
      step(state, withTouch);
      deltas.push(withTouch);
    }
    opts.onDeltas?.(deltas.slice());
    opts.onProgress?.({ window: w + 1, windows: windows.length, unitsDone: deltas.length, unitsTotal: units.length });
    if (opts.signal?.aborted) break;
  }

  return { deltas, failed };
}
