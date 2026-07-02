import { describe, expect, it } from "vitest";
// The LOCK that keeps the edge twin behaviourally identical to the web engine (docs/agent-improvement-plan.md
// P1.1). We import BOTH copies and run them over the same fixtures: any drift in a lint rule, the objective
// text, causality, or the render predicate makes deep-equality fail here. The edge copy's only cross-runtime
// dependency is metaHash (via ./plan-provenance.ts, whose cyrb53 is identical to the browser's); its lone
// jsr: import is type-only, so esbuild erases it and vitest can load the module.
import * as web from "@/features/dna/lib/novelDna";
import * as edge from "../../../../../../supabase/functions/_shared/novel-dna.ts";
import type { DnaNode, NodeKind, BookSettings } from "@/features/dna/lib/novelDna";

let seq = 0;
const mk = (kind: NodeKind, over: Partial<DnaNode> & { content?: Record<string, unknown> } = {}): DnaNode => ({
  id: over.id ?? `n_${kind}_${seq++}`,
  book_id: 1,
  parent_id: over.parent_id ?? null,
  level: over.level ?? 0,
  kind,
  position: over.position ?? 0,
  content: over.content ?? {},
  authoring: { source: "user", locked: false, status: "accepted", ...(over.authoring ?? {}) },
  proposals: over.proposals,
  chosen: over.chosen,
});

const vs = (polarity: "up" | "down") => ({ value: "safety", from: "safe", to: "exposed", polarity });

// A reasonably rich, mostly-valid book: two acts, chained beats with needs/establishes, a setup→payoff
// thread, a game with a resolution, a placed tentpole, drafted + undrafted scenes.
function goodBook(): DnaNode[] {
  const seed = mk("seed", { id: "seed", content: { logline: "A cartographer must map a city that rewrites itself nightly." } });
  const premise = mk("premise", { id: "prem", parent_id: "seed", content: { genre: ["fantasy"], tone: ["eerie"], dramatic_question: "Can she anchor a place that refuses to stay?" } });
  const pillar = mk("pillar", { id: "pil", parent_id: "prem", content: { controlling_idea: "Belonging is built, not found.", ending: "She draws the first map that holds." } });
  const voice = mk("voice_profile", { id: "vp", parent_id: "pil", content: { pov: "third_limited", tense: "past", style: "lyrical" } });
  const thread = mk("thread", { id: "th1", parent_id: "pil", content: { name: "the brass compass", kind: "setup_payoff", promise: "the compass points at what she fears" } });
  const game = mk("game", { id: "gm1", parent_id: "pil", content: { name: "the survey wager", win_condition: "map ratified", lose_condition: "guild seizes the survey" } });
  const tent = mk("tentpole", { id: "tp1", parent_id: "pil", content: { summary: "the night the plaza folds inward" } });
  const meter = mk("meter", { id: "mt1", parent_id: "pil", content: { name: "dread", kind: "tension" } });
  const a1 = mk("act", { id: "a1", parent_id: "pil", position: 0, content: { title: "Arrival", goal: "orient", value: vs("down"), target_pct: 40 } });
  const a2 = mk("act", { id: "a2", parent_id: "pil", position: 1, content: { title: "Anchor", goal: "commit", value: vs("up"), target_pct: 100 } });
  const b1 = mk("beat", { id: "b1", parent_id: "a1", position: 0, content: { summary: "She arrives and the streets move.", polarity: "down", establishes: ["compass_found"], threads: [{ ref: "th1", role: "setup" }], readings: [{ ref: "mt1", value: 2 }] } });
  const b2 = mk("beat", { id: "b2", parent_id: "a1", position: 1, content: { summary: "She trusts the compass and it betrays her.", connector: "but", polarity: "down", needs: ["compass_found"], establishes: ["compass_distrusted"], plays: ["gm1"], readings: [{ ref: "mt1", value: 4 }] } });
  const b3 = mk("beat", { id: "b3", parent_id: "a2", position: 0, content: { summary: "She stops trusting tools and reads the city herself.", connector: "therefore", polarity: "up", needs: ["compass_distrusted"], establishes: ["reads_by_hand"], threads: [{ ref: "th1", role: "payoff" }], realizes: ["tp1"], resolves: [{ ref: "gm1", outcome: "won" }], readings: [{ ref: "mt1", value: 1 }] } });
  const s = (id: string, parent: string, pos: number, drafted: boolean, polarity: "up" | "down") =>
    mk("scene", { id, parent_id: parent, position: pos, content: { goal: "orient", value_shift: vs(polarity), pov: "Mara", ...(drafted ? { prose: { text: "The plaza breathed.", words: 3 } } : {}) } });
  return [
    seed, premise, pillar, voice, thread, game, tent, meter, a1, a2, b1, b2, b3,
    s("s1", "b1", 0, true, "down"), s("s2", "b2", 0, true, "down"), s("s3", "b3", 0, false, "up"),
  ];
}

// A deliberately broken book: dangling ref, a flat scene (content but no value_shift), a missing beat
// connector, an orphan thread payoff (no setup), a therefore beat that needs an unestablished key.
function brokenBook(): DnaNode[] {
  const pillar = mk("pillar", { id: "pil", content: { controlling_idea: "" } });
  const a1 = mk("act", { id: "a1", parent_id: "pil", position: 0, content: { title: "One" } });
  const b1 = mk("beat", { id: "b1", parent_id: "a1", position: 0, content: { summary: "Opening.", polarity: "up" } });
  const b2 = mk("beat", { id: "b2", parent_id: "a1", position: 1, content: { summary: "No connector here.", polarity: "up", threads: [{ ref: "th_missing", role: "payoff" }] } });
  const b3 = mk("beat", { id: "b3", parent_id: "a1", position: 2, content: { summary: "Uncaused turn.", connector: "therefore", polarity: "up", needs: ["never_established"] } });
  const s1 = mk("scene", { id: "s1", parent_id: "b1", position: 0, content: { goal: "do a thing", outcome: "did it" } }); // flat: content, no value_shift
  const s2 = mk("scene", { id: "s2", parent_id: "b2", position: 0, content: { grounds_in: ["wf_missing"] } }); // dangling ref
  return [pillar, a1, b1, b2, b3, s1, s2];
}

const settings: BookSettings = { title: "The Folding City", author: "A. Nzal", word_target: 60000, mode: "prose" };
const j = (v: unknown) => JSON.stringify(v);

// Every pure derivation threadSystem will re-run at the edge. Compared web-vs-edge over each fixture.
const cases: [string, (m: typeof web, n: DnaNode[]) => unknown][] = [
  ["validate", (m, n) => m.validate(n)],
  ["structuralLints", (m, n) => m.structuralLints(n)],
  ["analysisText", (m, n) => m.analysisText(n, settings)],
  ["renderBlockers", (m, n) => m.renderBlockers(n, settings)],
  ["isRenderable", (m, n) => m.isRenderable(n, settings)],
  ["causality", (m, n) => m.causality(n)],
  ["promiseLedger", (m, n) => m.promiseLedger(n)],
  ["pacing", (m, n) => m.pacing(n)],
  ["topography", (m, n) => m.topography(n)],
  ["ledgerFull", (m, n) => m.ledgerFull(n)],
  ["scenesInOrder", (m, n) => m.scenesInOrder(n).map((x) => x.id)],
  ["beatsInOrder", (m, n) => m.beatsInOrder(n).map((x) => x.id)],
  ["chapters", (m, n) => m.chapters(n)],
];

describe("novel-dna edge twin ↔ web engine parity", () => {
  const fixtures: [string, DnaNode[]][] = [["goodBook", goodBook()], ["brokenBook", brokenBook()]];
  for (const [fxName, nodes] of fixtures) {
    for (const [fnName, fn] of cases) {
      it(`${fnName} agrees on ${fxName}`, () => {
        expect(j(fn(edge as unknown as typeof web, nodes))).toBe(j(fn(web, nodes)));
      });
    }
  }

  it("the broken fixture actually produces lints (guards against a no-op test)", () => {
    expect(web.validate(brokenBook()).length).toBeGreaterThan(0);
  });
});
