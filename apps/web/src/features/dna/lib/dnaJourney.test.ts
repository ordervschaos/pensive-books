import { describe, expect, it } from "vitest";
import { buildJourney, dnaHealth, stageComplete, stageSubsteps } from "@/lib/dnaJourney";
import type { DnaNode, NodeKind } from "@/lib/novelDna";

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

  it("Seed blocks Premise — Premise is locked until the seed is an accepted logline", () => {
    // a draft (not accepted) seed: Seed is the NOW move, Premise stays blocked
    const draftSeed = byKey(stageSubsteps("premise", [mk("seed", { logline: "x" }, "draft")]));
    expect(draftSeed.seed.status).toBe("now");
    expect(draftSeed.premise.status).toBe("locked");
    // accepted seed unblocks Premise as the next move
    const okSeed = byKey(stageSubsteps("premise", [mk("seed", { logline: "x" })]));
    expect(okSeed.seed.status).toBe("done");
    expect(okSeed.premise.status).toBe("now");
  });

  it("Foundations: Cast blocks Relationships; world/set-pieces are optional branches", () => {
    const subs = byKey(stageSubsteps("foundations", [mk("premise"), mk("pillar")]));
    expect(subs.pillar.status).toBe("done");
    expect(subs.cast.status).toBe("now"); // required, prereq met, first incomplete
    expect(subs.relationship.status).toBe("locked"); // needs a cast
    expect(subs.world.optional).toBe(true);
    expect(subs.world.status).toBe("available"); // unlocked branch, not the "now"
    // add a character → cast done, relationships unlock (as an optional branch → available)
    const withCast = byKey(stageSubsteps("foundations", [mk("premise"), mk("pillar"), mk("character", { name: "Mara" })]));
    expect(withCast.cast.status).toBe("done");
    expect(withCast.cast.count).toBe(1);
    expect(withCast.relationship.status).toBe("available");
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
