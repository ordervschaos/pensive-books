import { describe, expect, it } from "vitest";
import { buildJourney, stageComplete } from "@/lib/dnaJourney";
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
      // no movements yet → Structure is the next move
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
    const base = [mk("movement"), mk("beat"), mk("scene", { goal: "g" })];
    expect(stageComplete(base).draft).toBe(false);
    const withProse = [mk("movement"), mk("beat"), mk("scene", { goal: "g", prose: { text: "Words." } })];
    expect(stageComplete(withProse).draft).toBe(true);
  });
});
