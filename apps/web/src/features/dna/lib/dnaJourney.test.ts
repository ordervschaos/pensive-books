import { describe, expect, it } from "vitest";
import { buildJourney, currentObjective, dnaHealth, stageComplete, stageSubsteps } from "@/features/dna/lib/dnaJourney";
import type { DnaNode, NodeKind } from "@/features/dna/lib/novelDna";
import type { Brief } from "@/lib/brief";

let seq = 0;
const mk = (kind: NodeKind, content: Record<string, unknown> = {}, status: "empty" | "draft" | "accepted" = "accepted", parent_id: string | null = null): DnaNode => ({
  id: `n${seq++}`, book_id: 1, parent_id, level: 0, kind, position: 0, content,
  authoring: { source: "ai", locked: false, status },
});

describe("dna journey", () => {
  it("an empty tree puts Premise NOW and locks everything after it", () => {
    const { stages, nowIndex } = buildJourney([]);
    expect(nowIndex).toBe(0);
    expect(stages.map((s) => s.status)).toEqual(["now", "locked", "locked", "locked", "locked"]);
  });

  it("advances NOW to the first incomplete stage as content fills", () => {
    const nodes = [
      mk("seed", { logline: "A clerk falls for a smuggler." }),
      mk("premise", { dramatic_question: "Will she choose?" }),
      mk("pillar", { controlling_idea: "Freedom is chosen.", ending: "She burns it." }),
      mk("character", { name: "Mara", role: "protagonist" }),
      // no acts yet → Structure is the next move
    ];
    const done = stageComplete(nodes);
    expect(done.premise).toBe(true);
    expect(done.foundations).toBe(true);
    expect(done.structure).toBe(false);
    const { stages, nowIndex } = buildJourney(nodes);
    expect(stages[nowIndex].key).toBe("structure");
    expect(stages.map((s) => s.status)).toEqual(["done", "done", "now", "locked", "locked"]);
  });

  it("Draft is complete only when every scene has prose", () => {
    const base = [mk("act"), mk("beat"), mk("scene", { goal: "g" })];
    expect(stageComplete(base).draft).toBe(false);
    const withProse = [mk("act"), mk("beat"), mk("scene", { goal: "g", prose: { text: "Words." } })];
    expect(stageComplete(withProse).draft).toBe(true);
  });
});

describe("stageSubsteps", () => {
  const byKey = (subs: ReturnType<typeof stageSubsteps>) => Object.fromEntries(subs.map((s) => [s.key, s]));
  // A brief whose discovery interview is finished — the gate that lets the seed become the now-step.
  const compiled: Brief = { vision: { characters: "a clerk", compiled_at: "2026-07-13T00:00:00.000Z" } };

  it("Seed blocks Premise — Premise is locked until the seed is an accepted logline", () => {
    // a draft (not accepted) seed, interview already done: Seed is the NOW move, Premise stays blocked
    const draftSeed = byKey(stageSubsteps("premise", [mk("seed", { logline: "x" }, "draft")], compiled));
    expect(draftSeed.seed.status).toBe("now");
    expect(draftSeed.premise.status).toBe("locked");
    // accepted seed unblocks Premise as the next move
    const okSeed = byKey(stageSubsteps("premise", [mk("seed", { logline: "x" })], compiled));
    expect(okSeed.seed.status).toBe("done");
    expect(okSeed.premise.status).toBe("now");
  });

  // The discovery regime: the premise stage opens with an INTERVIEW whose artifact lives in the brief
  // (brief.vision), not the tree — so an author is asked about the book in their head before anything is
  // generated for them. Its gate is compiled_at (or an explicit skip); a book already past the seed is
  // grandfathered done so no existing book regresses into an interview it never had.
  it("Interview is the first rung on a fresh book, and it blocks the Seed", () => {
    const subs = byKey(stageSubsteps("premise", [], null));
    expect(subs.interview.status).toBe("now");
    expect(subs.seed.status).toBe("locked");
  });

  it("a compiled (or skipped) vision advances the now-step to the Seed", () => {
    expect(byKey(stageSubsteps("premise", [], compiled)).seed.status).toBe("now");
    expect(byKey(stageSubsteps("premise", [], { vision: { skipped: true } })).seed.status).toBe("now");
    expect(byKey(stageSubsteps("premise", [], compiled)).interview.status).toBe("done");
  });

  it("grandfathers an existing book: an accepted seed marks the interview done with no vision at all", () => {
    const subs = byKey(stageSubsteps("premise", [mk("seed", { logline: "x" })], null));
    expect(subs.interview.status).toBe("done");
    expect(subs.premise.status).toBe("now");
  });

  it("grandfathers a book that was BUILT without an accepted seed — any non-seed node means it's not fresh", () => {
    // The regression this guards: a drafted book whose seed was never accepted was being sent back to the
    // interview. A fresh book is minted with the seed node alone, so anything else = already building.
    const subs = byKey(stageSubsteps("premise", [mk("seed", { logline: "x" }, "draft"), mk("scene", { goal: "g" })], null));
    expect(subs.interview.status).toBe("done");
    expect(subs.seed.status).toBe("now");
  });

  it("the objective on a fresh book is the interview — and says not to generate story content yet", () => {
    expect(currentObjective([], { brief: null })).toContain("INTERVIEW the author");
    expect(currentObjective([], { brief: compiled })).toContain("logline options");
  });

  it("Foundations: Cast blocks Relationships; world/set-pieces are optional branches", () => {
    const subs = byKey(stageSubsteps("foundations", [mk("premise", { dramatic_question: "q?" }), mk("pillar", { controlling_idea: "idea" })]));
    expect(subs.pillar.status).toBe("done");
    expect(subs.cast.status).toBe("now"); // required, prereq met, first incomplete
    expect(subs.relationship.status).toBe("locked"); // needs a cast
    expect(subs.world.optional).toBe(true);
    expect(subs.world.status).toBe("available"); // unlocked branch, not the "now"
    // add a character → cast done, relationships unlock (as an optional branch → available)
    const withCast = byKey(stageSubsteps("foundations", [mk("premise", { dramatic_question: "q?" }), mk("pillar", { controlling_idea: "idea" }), mk("character", { name: "Mara" })]));
    expect(withCast.cast.status).toBe("done");
    expect(withCast.cast.count).toBe(1);
    expect(withCast.relationship.status).toBe("available");
  });

  it("an accepted-but-empty pillar does NOT count as done — Foundations can't be skipped just because the flag was flipped", () => {
    // The regression this guards: a pillar option can get committed (authoring.status=accepted) while its
    // controlling_idea is still blank (a malformed generated option, or a placeholder promoted too soon). If
    // "accepted" alone gated completion, the guided journey would silently advance past an empty pillar
    // straight into Cast/Acts, orphaning the very thing the author still needs to fill.
    const nodes = [mk("seed", { logline: "x" }), mk("premise", { dramatic_question: "q?" }), mk("pillar", { controlling_idea: "" }), mk("character", { name: "Mara" })];
    expect(stageComplete(nodes).foundations).toBe(false);
    const subs = byKey(stageSubsteps("foundations", nodes));
    expect(subs.pillar.status).not.toBe("done");
    const obj = currentObjective(nodes);
    expect(obj).toContain("Foundations — Pillar");
    expect(obj).not.toContain("Cast");
  });

  it("Contract is an optional branch — never the NOW step, never a stage gate", () => {
    const base = [mk("premise", { dramatic_question: "q?" }), mk("pillar", { controlling_idea: "idea" })];
    const subs = byKey(stageSubsteps("foundations", base));
    expect(subs.contract.optional).toBe(true);
    expect(subs.contract.status).toBe("available"); // unlocked by the accepted pillar, but never "now"
    expect(subs.cast.status).toBe("now"); // the serial path is untouched by the contract branch
    // Foundations completes on pillar + cast alone — no contract artifact required.
    expect(stageComplete([...base, mk("character", { name: "Mara" })]).foundations).toBe(true);
    // done-gate: a meter carrying a target curve (the artifact only the derivation pass seeds)…
    const compiled = byKey(stageSubsteps("foundations", [...base, mk("meter", { name: "tension", target: [{ at: 0.9, value: 90 }] })]));
    expect(compiled.contract.status).toBe("done");
    // …while a target-less meter (e.g. a game-score twin) does NOT read as compiled.
    const bare = byKey(stageSubsteps("foundations", [...base, mk("meter", { name: "score" })]));
    expect(bare.contract.status).toBe("available");
  });

  it("dnaHealth: empty tree is 0 complete; a misparented entity dents strength and surfaces in issues", () => {
    expect(dnaHealth([]).completeness).toBe(0);
    // seed→premise→pillar, one character correctly on the pillar, one wrongly on the premise (the real bug).
    const seed = mk("seed", { logline: "x" }, "accepted");
    const premise = mk("premise", { dramatic_question: "q?" }, "accepted", seed.id);
    const pillar = mk("pillar", { controlling_idea: "idea" }, "accepted", premise.id);
    const onPillar = mk("character", { name: "Finn" }, "accepted", pillar.id);
    const onPremise = mk("character", { name: "Vane" }, "accepted", premise.id); // the fault
    const h = dnaHealth([seed, premise, pillar, onPillar, onPremise]);
    expect(h.strength).toBeLessThan(1);
    expect(h.issues.some((i) => i.rule === "misparented")).toBe(true);
  });

  it("Draft prose reports a drafted/total tally", () => {
    const subs = byKey(stageSubsteps("draft", [
      mk("scene", { prose: { text: "written" } }),
      mk("scene", { goal: "g" }),
    ]));
    expect(subs.prose.count).toBe(1);
    expect(subs.prose.total).toBe(2);
    expect(subs.prose.status).toBe("now"); // not all drafted yet
  });
});

describe("currentObjective", () => {
  it("an empty tree points at the interview step with its recipe — the seed comes after it", () => {
    const obj = currentObjective([]);
    expect(obj).toContain("Step 1/5 · Idea");
    expect(obj).toContain("INTERVIEW the author");
    expect(obj).toContain("don't work ahead"); // the focus anchor
    // …and once the interview is done (or skipped), the same empty tree points at the seed.
    expect(currentObjective([], { brief: { vision: { skipped: true } } })).toContain("logline options");
  });

  it("advances to the now step as the tree fills", () => {
    const obj = currentObjective([
      mk("seed", { logline: "A clerk falls for a smuggler." }),
      mk("premise", { dramatic_question: "Will she choose?" }),
      mk("pillar", { controlling_idea: "Freedom is chosen.", ending: "She burns it." }),
      // pillar accepted but no cast → Foundations / Cast is the now step
    ]);
    expect(obj).toContain("Foundations — Cast");
    expect(obj).toContain("want / need / wound / lie");
  });

  it("a fully drafted book yields the render/publish hand-off, never an op", () => {
    // The cast member appears on the page (pov) — an accepted character the reader never meets is an OPEN
    // obligation now, and would hold the book in the promises endgame instead of the hand-off.
    const mara = mk("character", { name: "Mara", role: "protagonist" });
    const obj = currentObjective([
      mk("seed", { logline: "x" }),
      mk("premise", { dramatic_question: "q?" }),
      mk("pillar", { controlling_idea: "idea", ending: "end" }),
      mara,
      mk("act", { goal: "g" }),
      mk("beat", { summary: "b" }),
      mk("scene", { goal: "g", pov: mara.id, prose: { text: "Words." } }),
    ], { bookSlug: "my-book" });
    expect(obj).toContain("fully drafted");
    expect(obj).toContain("CANNOT render or publish");
    expect(obj).toContain("/books/my-book");
  });
});

describe("the promises endgame (debt-based completion)", () => {
  // A book that has walked the whole ladder — every scene prosed — but owes one promise: a thread set up on
  // the page and never paid. The old count-based gate would call this finished; the debt gate holds it.
  const drafted = () => {
    const mara = mk("character", { name: "Mara", role: "protagonist" });
    const th = mk("thread", { name: "the sealed hatch", promise: "what's behind it surfaces" });
    const nodes = [
      mk("seed", { logline: "x" }),
      mk("premise", { dramatic_question: "q?" }),
      mk("pillar", { controlling_idea: "idea", ending: "end" }),
      mara, th,
      mk("act", { goal: "g" }),
      mk("beat", { summary: "b" }),
      mk("scene", { goal: "g", pov: mara.id, threads: [{ ref: th.id, role: "setup" }], prose: { text: "The hatch held." } }),
    ];
    return { nodes, th };
  };

  it("holds the Draft stage open while a promise is owed, and settles when it's waived", () => {
    const { nodes, th } = drafted();
    expect(stageComplete(nodes).draft).toBe(false);
    th.content = { ...th.content, waived: true }; // the author's carry-over gesture (sequel hook)
    expect(stageComplete(nodes).draft).toBe(true);
  });

  it("substeps: prose done, Promises becomes the NOW step with a settled/total tally", () => {
    const { nodes } = drafted();
    const subs = Object.fromEntries(stageSubsteps("draft", nodes).map((s) => [s.key, s]));
    expect(subs.prose.status).toBe("done");
    expect(subs.promises.status).toBe("now");
    expect(subs.promises.total).toBe(2);  // the thread + the character intro
    expect(subs.promises.count).toBe(1);  // Mara appeared (pov); the thread is still owed
  });

  it("the endgame objective names each open promise and teaches pay-or-waive", () => {
    const { nodes } = drafted();
    const obj = currentObjective(nodes);
    expect(obj).toContain("Prose — Promises");
    expect(obj).toContain("OPEN PROMISES (1 to settle");
    expect(obj).toContain('[thread] "the sealed hatch" — what\'s behind it surfaces (open)');
    expect(obj).toContain("WAIVE it");
    expect(obj).not.toContain("fully drafted"); // the hand-off must wait for the ledger
  });

  it("annotates reader pressure: a promise left untouched shows how long it has been quiet", () => {
    const { nodes } = drafted();
    // A second prosed scene after the setup: the thread now sits quiet for 1 turn, and the line says so.
    nodes.push(mk("scene", { goal: "g2", prose: { text: "More words." } }));
    const obj = currentObjective(nodes);
    expect(obj).toContain("(open · quiet 1 turns)");
  });
});
