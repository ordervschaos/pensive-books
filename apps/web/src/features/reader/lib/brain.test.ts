// brain tests — the fold is the backbone of the Reader Machine and it is pure, so it is the one
// part that can be pinned exactly. These lock the behaviours the timeline's meaning rests on:
// forgetting, retrospective importance, causality, and immersion ≠ knowledge.
import { describe, it, expect } from "vitest";
import {
  clusters, DECAY, diffBrains, diffIsEmpty, foldTo, immersion, importance, openQuestions, pull, step,
  emptyBrain, tracks, workingSet, type UnitDelta,
} from "./brain";

const meet = (i: number, id: string, name = id): UnitDelta =>
  ({ i, ops: [{ op: "entity", id, kind: "character", name }] });
const quiet = (i: number): UnitDelta => ({ i, ops: [] });

describe("activation decay — the reader forgets", () => {
  it("decays an untouched entity toward zero", () => {
    const deltas = [meet(0, "mira"), ...Array.from({ length: 20 }, (_, k) => quiet(k + 1))];
    const s = foldTo(deltas, 20);
    // 20 quiet units after a single spike of 1 ⇒ 0.93^20 ≈ 0.23
    expect(s.entities.mira.activation).toBeCloseTo(Math.pow(DECAY, 20), 3);
    expect(s.entities.mira.activation).toBeLessThan(0.3);
  });

  it("keeps the fact but drops it out of the working set", () => {
    const deltas = [
      { i: 0, ops: [{ op: "entity", id: "dagger", kind: "object", name: "dagger" } as const] },
      ...Array.from({ length: 40 }, (_, k) => quiet(k + 1)),
    ];
    const s = foldTo(deltas, 40);
    // Still known — the reader did not unlearn it…
    expect(s.entities.dagger).toBeDefined();
    // …but no longer in mind, which is exactly what makes a later payoff feel arbitrary.
    expect(workingSet(s)).toHaveLength(0);
  });

  it("a recall spikes harder than a mention", () => {
    const base = [meet(0, "mira"), ...Array.from({ length: 15 }, (_, k) => quiet(k + 1))];
    const mentioned = foldTo([...base, { i: 16, ops: [{ op: "touch", ids: ["mira"] }] }], 16);
    const recalled = foldTo([...base, { i: 16, ops: [{ op: "recall", id: "mira" }] }], 16);
    expect(recalled.entities.mira.activation).toBeGreaterThan(mentioned.entities.mira.activation);
    expect(recalled.entities.mira.recalls).toEqual([16]);
  });
});

describe("causality — a fold can only contain what was read", () => {
  it("ignores every delta after the requested unit", () => {
    const deltas = [meet(0, "mira"), meet(5, "violet"), meet(9, "xaden")];
    const at5 = foldTo(deltas, 5);
    expect(Object.keys(at5.entities).sort()).toEqual(["mira", "violet"]);
    expect(at5.entities.xaden).toBeUndefined();
  });

  it("scrubbing backwards is exact, not an undo", () => {
    const deltas = [meet(0, "mira"), meet(1, "violet"), meet(2, "xaden")];
    const forward = foldTo(deltas, 1);
    foldTo(deltas, 2);                       // go past…
    const back = foldTo(deltas, 1);          // …and return
    expect(back).toEqual(forward);
  });
});

describe("facts and questions", () => {
  it("re-asserting a key supersedes it", () => {
    const s = foldTo([
      { i: 0, ops: [{ op: "fact", key: "quadrant", value: "scribe" }] },
      { i: 1, ops: [{ op: "fact", key: "quadrant", value: "rider" }] },
    ], 1);
    expect(s.facts.quadrant.value).toBe("rider");
    expect(s.facts.quadrant.at).toBe(1);
  });

  it("answering closes a question and drops the pull", () => {
    const opened = foldTo([{ i: 0, ops: [{ op: "open", qid: "q1", text: "will she live?", kind: "threat", heat: 3 }] }], 0);
    expect(openQuestions(opened)).toHaveLength(1);
    expect(pull(opened)).toBeGreaterThan(0);

    const closed = foldTo([
      { i: 0, ops: [{ op: "open", qid: "q1", text: "will she live?", kind: "threat", heat: 3 }] },
      { i: 1, ops: [{ op: "answer", qid: "q1" }] },
    ], 1);
    expect(openQuestions(closed)).toHaveLength(0);
    expect(pull(closed)).toBe(0);
  });

  it("pull fades with age even while the question stays open", () => {
    const open = { i: 0, ops: [{ op: "open", qid: "q1", text: "?", kind: "mystery", heat: 3 } as const] };
    const early = foldTo([open, quiet(1)], 1);
    const late = foldTo([open, ...Array.from({ length: 120 }, (_, k) => quiet(k + 1))], 120);
    expect(openQuestions(late)).toHaveLength(1);           // still unanswered…
    expect(pull(late)).toBeLessThan(pull(early));          // …but no longer pulling as hard
  });
});

describe("importance is retrospective", () => {
  it("ranks the thing the story came back to above the one it merely introduced", () => {
    const deltas: UnitDelta[] = [
      meet(0, "mira"),
      meet(1, "extra"),
      ...Array.from({ length: 8 }, (_, k) => ({ i: k + 2, ops: [{ op: "touch" as const, ids: ["mira"] }] })),
    ];
    const s = foldTo(deltas, 9);
    expect(importance(s, "mira")).toBeGreaterThan(importance(s, "extra"));
  });

  it("is not knowable at the moment of introduction", () => {
    // Both entities look identical when introduced one unit apart…
    const early = foldTo([meet(0, "mira"), meet(1, "extra")], 1);
    expect(importance(early, "mira")).toBe(importance(early, "extra"));
  });
});

describe("immersion is not knowledge", () => {
  it("needs sensory detail, not just an introduction", () => {
    const known = foldTo([meet(0, "mira")], 0);
    expect(immersion(known.entities.mira)).toBe(0);

    const felt = foldTo([
      meet(0, "mira"),
      { i: 1, ops: [{ op: "sense", about: "mira", channel: "sight", detail: "brown eyes" }] },
      { i: 2, ops: [{ op: "sense", about: "mira", channel: "sound", detail: "flat voice" }] },
    ], 2);
    expect(immersion(felt.entities.mira)).toBeGreaterThan(0);
  });

  it("fades as the thing goes quiet, even though the details are still on record", () => {
    const base: UnitDelta[] = [
      meet(0, "mira"),
      { i: 1, ops: [{ op: "sense", about: "mira", channel: "sight", detail: "brown eyes" }] },
    ];
    const near = foldTo(base, 1);
    const far = foldTo([...base, ...Array.from({ length: 30 }, (_, k) => quiet(k + 2))], 31);
    expect(far.entities.mira.senses).toHaveLength(1);       // still on record…
    expect(immersion(far.entities.mira)).toBeLessThan(immersion(near.entities.mira));
  });
});

describe("grouping is derived from the relation graph", () => {
  it("clusters tied entities and ignores loose ones", () => {
    const s = foldTo([
      meet(0, "violet"), meet(1, "mira"), meet(2, "general"), meet(3, "stranger"),
      { i: 4, ops: [{ op: "relate", from: "violet", to: "mira", kind: "sister", valence: 2 }] },
      { i: 5, ops: [{ op: "relate", from: "mira", to: "general", kind: "mother", valence: -1 }] },
    ], 5);
    const groups = clusters(s);
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((m) => m.id).sort()).toEqual(["general", "mira", "violet"]);
  });
});

describe("diffBrains — what just happened", () => {
  it("reports what LANDED, not what the ops asserted", () => {
    const deltas: UnitDelta[] = [
      { i: 0, ops: [{ op: "fact", key: "quadrant", value: "scribe" }] },
      // Re-asserts an identical fact: the op fires, but nothing about the reader changes.
      { i: 1, ops: [{ op: "fact", key: "quadrant", value: "scribe" }] },
    ];
    const d = diffBrains(foldTo(deltas, 0), foldTo(deltas, 1));
    expect(d.learned).toHaveLength(0);
    expect(d.revised).toHaveLength(0);
    expect(diffIsEmpty(d)).toBe(true);
  });

  it("catches a revision as was → now", () => {
    const deltas: UnitDelta[] = [
      { i: 0, ops: [{ op: "fact", key: "quadrant", value: "scribe" }] },
      { i: 1, ops: [{ op: "fact", key: "quadrant", value: "rider" }] },
    ];
    const d = diffBrains(foldTo(deltas, 0), foldTo(deltas, 1));
    expect(d.revised).toEqual([{ key: "quadrant", was: "scribe", now: "rider" }]);
  });

  it("sees a bare touch haul something back into mind", () => {
    const deltas: UnitDelta[] = [
      meet(0, "mira"),
      ...Array.from({ length: 25 }, (_, k) => quiet(k + 1)),
      { i: 26, ops: [{ op: "touch", ids: ["mira"] }] },
    ];
    const d = diffBrains(foldTo(deltas, 25), foldTo(deltas, 26));
    expect(d.woke.map((w) => w.entity.id)).toEqual(["mira"]);
    expect(diffIsEmpty(d)).toBe(false);
  });

  it("reports forgetting — an entity slipping out of the working set", () => {
    // Find the frame where mira's activation crosses back under the 0.15 floor.
    const deltas: UnitDelta[] = [meet(0, "mira"), ...Array.from({ length: 40 }, (_, k) => quiet(k + 1))];
    const faded = Array.from({ length: 40 }, (_, k) => diffBrains(foldTo(deltas, k), foldTo(deltas, k + 1)))
      .filter((d) => d.faded.length > 0);
    expect(faded).toHaveLength(1);
    expect(faded[0].faded[0].id).toBe("mira");
  });

  it("separates opening a question from closing one", () => {
    const open = { i: 0, ops: [{ op: "open", qid: "q1", text: "?", kind: "mystery", heat: 2 } as const] };
    const close = { i: 1, ops: [{ op: "answer", qid: "q1" } as const] };
    const a = diffBrains(foldTo([open], -1), foldTo([open], 0));
    expect(a.wondered.map((q) => q.qid)).toEqual(["q1"]);
    const b = diffBrains(foldTo([open, close], 0), foldTo([open, close], 1));
    expect(b.resolved.map((q) => q.qid)).toEqual(["q1"]);
    expect(b.wondered).toHaveLength(0);
  });

  it("reports a move and who came on stage", () => {
    const deltas: UnitDelta[] = [
      { i: 0, ops: [{ op: "entity", id: "hall", kind: "place", name: "the hall" }] },
      meet(1, "mira"),
      { i: 2, ops: [{ op: "move", to: "hall" }, { op: "present", ids: ["mira"] }] },
    ];
    const d = diffBrains(foldTo(deltas, 1), foldTo(deltas, 2));
    expect(d.moved?.to?.id).toBe("hall");
    expect(d.entered.map((e) => e.id)).toEqual(["mira"]);
  });
});

describe("tracks", () => {
  it("emits one row per delta, in reading order", () => {
    const deltas = [meet(0, "a"), quiet(1), meet(2, "b")];
    const t = tracks(deltas);
    expect(t.map((r) => r.i)).toEqual([0, 1, 2]);
    expect(t[2].known).toBe(2);
  });

  it("does not mutate a caller's state object", () => {
    const s = emptyBrain();
    step(s, meet(0, "a"));
    const before = JSON.stringify(s);
    tracks([meet(0, "a"), meet(1, "b")]);
    expect(JSON.stringify(s)).toBe(before);
  });
});
