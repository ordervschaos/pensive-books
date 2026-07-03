import { describe, expect, it } from "vitest";
// The LOCK that keeps the edge twin behaviourally identical to the web engine (docs/agent-improvement-plan.md
// P1.1). We import BOTH copies and run them over the same fixtures: any drift in a lint rule, the objective
// text, causality, or the render predicate makes deep-equality fail here. The edge copy's only cross-runtime
// dependency is metaHash (via ./plan-provenance.ts, whose cyrb53 is identical to the browser's); its lone
// jsr: import is type-only, so esbuild erases it and vitest can load the module.
import * as web from "@/features/dna/lib/novelDna";
import * as edge from "../../../../../../supabase/functions/_shared/novel-dna.ts";
import * as webJ from "@/features/dna/lib/dnaJourney";
import * as edgeJ from "../../../../../../supabase/functions/_shared/dna-journey.ts";
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
  const hero = mk("character", { id: "ch1", parent_id: "pil", content: { name: "Mara", role: "protagonist", want: "to belong", need: "to stop running", wound: "abandoned as a child", lie: "places can't be trusted" } });
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
    seed, premise, pillar, voice, hero, thread, game, tent, meter, a1, a2, b1, b2, b3,
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

// A tiny book exercising every entityRegistryBlock kind (character/location/world_fact/thread/relationship),
// including a relationship that resolves BOTH ends to character names, and a game to prove games are excluded.
function registryBook(): DnaNode[] {
  const pillar = mk("pillar", { id: "pil", content: {} });
  const c1 = mk("character", { id: "ch1", parent_id: "pil", position: 0, content: { name: "Mara", role: "protagonist", want: "to belong" } });
  const c2 = mk("character", { id: "ch2", parent_id: "pil", position: 1, content: { name: "Okonkwo", role: "antagonist" } });
  const loc = mk("location", { id: "lc1", parent_id: "pil", position: 0, content: { name: "The Harbor", summary: "tar and old rope" } });
  const wf = mk("world_fact", { id: "wf1", parent_id: "pil", position: 0, content: { name: "the fold", rule: "the city rewrites itself nightly" } });
  const th = mk("thread", { id: "th1", parent_id: "pil", position: 0, content: { name: "the brass compass", promise: "it points at what she fears" } });
  const rel = mk("relationship", { id: "rel1", parent_id: "pil", position: 0, content: { a: "ch1", b: "ch2", bond: "wary rivals" } });
  const game = mk("game", { id: "gm1", parent_id: "pil", content: { name: "excluded from the registry" } });
  return [pillar, c1, c2, loc, wf, th, rel, game];
}

// A book where a location's palette is echoed VERBATIM in two scenes and paraphrased-away in a third — the
// exact harm facetEchoes/facetExposureBefore detect (docs/scene-ledger.md §2).
function exposureBook(): DnaNode[] {
  const loc = mk("location", { id: "ex_loc", content: { name: "The Harbor", smell: "tar and old rope and cold salt" } });
  const a1 = mk("act", { id: "ex_a1", position: 0, content: { title: "One" } });
  const b1 = mk("beat", { id: "ex_b1", parent_id: "ex_a1", position: 0, content: { summary: "at the water" } });
  const s1 = mk("scene", { id: "ex_s1", parent_id: "ex_b1", position: 0, content: { loc: "ex_loc", value_shift: vs("down"), prose: { text: "She breathed the tar and old rope and cold salt of the wharf.", words: 12 } } });
  const s2 = mk("scene", { id: "ex_s2", parent_id: "ex_b1", position: 1, content: { value_shift: vs("up"), prose: { text: "Inland now, she smelled only dust and dry grass.", words: 9 } } });
  const s3 = mk("scene", { id: "ex_s3", parent_id: "ex_b1", position: 2, content: { loc: "ex_loc", value_shift: vs("down"), prose: { text: "Back among the tar and old rope and cold salt, she wept.", words: 12 } } });
  return [loc, a1, b1, s1, s2, s3];
}

// A book that exercises every SceneLedger field: a thread opened→held→paid across three scenes, a meter with a
// carry-forward gap, a position change, a saturated facet, and a superseding observed fact (docs/scene-ledger.md §3).
const LA_SMELL = "tar and old rope and cold salt";
function ledgerAtBook(): DnaNode[] {
  const pillar = mk("pillar", { id: "la_pil", content: {} });
  const ch1 = mk("character", { id: "la_c1", parent_id: "la_pil", content: { name: "Mara", role: "protagonist" } });
  const ch2 = mk("character", { id: "la_c2", parent_id: "la_pil", content: { name: "Okonkwo", role: "ally" } });
  const loc1 = mk("location", { id: "la_l1", parent_id: "la_pil", content: { name: "The Harbor", smell: LA_SMELL } });
  const loc2 = mk("location", { id: "la_l2", parent_id: "la_pil", content: { name: "The Uplands" } });
  const thread = mk("thread", { id: "la_t1", parent_id: "la_pil", content: { name: "the compass", promise: "it points at fear" } });
  const rel = mk("relationship", { id: "la_r1", parent_id: "la_pil", content: { a: "la_c1", b: "la_c2", bond: "wary" } });
  const meter = mk("meter", { id: "la_m1", parent_id: "la_pil", content: { name: "dread", kind: "tension" } });
  const a1 = mk("act", { id: "la_a1", parent_id: "la_pil", position: 0, content: { title: "One" } });
  const b1 = mk("beat", { id: "la_b1", parent_id: "la_a1", position: 0, content: { summary: "at the water" } });
  const s1 = mk("scene", { id: "la_s1", parent_id: "la_b1", position: 0, content: {
    loc: "la_l1", pov: "la_c1", present: ["la_c1", "la_c2"], value_shift: vs("down"),
    threads: [{ ref: "la_t1", role: "setup" }], advances: [{ ref: "la_r1", how: "they meet at the water" }],
    readings: [{ ref: "la_m1", value: 2 }], establishes: ["compass_found"],
    observed_establishes: [{ key: "mara_loc", value: "harbor", entity: "la_c1" }],
    prose: { text: `She breathed the ${LA_SMELL} of the wharf.`, words: 11 } } });
  const s2 = mk("scene", { id: "la_s2", parent_id: "la_b1", position: 1, content: {
    loc: "la_l1", pov: "la_c1", present: ["la_c1"], value_shift: vs("up"), establishes: ["rope_frays"],
    observed_establishes: [{ key: "mara_loc", value: "still at the harbor", entity: "la_c1" }], // supersedes s1
    prose: { text: `Again the ${LA_SMELL} closed over her.`, words: 9 } } });
  const s3 = mk("scene", { id: "la_s3", parent_id: "la_b1", position: 2, content: {
    loc: "la_l2", pov: "la_c1", present: ["la_c1"], value_shift: vs("down"),
    threads: [{ ref: "la_t1", role: "payoff" }], readings: [{ ref: "la_m1", value: 5 }],
    prose: { text: `Even inland the ${LA_SMELL} clung to her coat.`, words: 10 } } }); // 3rd echo → saturated
  const s4 = mk("scene", { id: "la_s4", parent_id: "la_b1", position: 3, content: { value_shift: vs("up"), goal: "the query scene" } });
  return [pillar, ch1, ch2, loc1, loc2, thread, rel, meter, a1, b1, s1, s2, s3, s4];
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
  ["entityRegistryBlock", (m, n) => m.entityRegistryBlock(n)],
  ["facetEchoes", (m, n) => m.facetEchoes(n)],
  ["facetExposureBefore", (m, n) => m.facetExposureBefore(n, "ex_s3")],
  ["ledgerAt", (m, n) => m.ledgerAt(n, "la_s4")],
  ["scenesInOrder", (m, n) => m.scenesInOrder(n).map((x) => x.id)],
  ["beatsInOrder", (m, n) => m.beatsInOrder(n).map((x) => x.id)],
  ["chapters", (m, n) => m.chapters(n)],
  // §3c canonicalization is pure string work (ignores the nodes arg) — lock the twin to the web engine.
  ["canonicalizeKey", (m) => ["redemption_funds", "redemtion_fund", "door_open", "won"].map((k) => m.canonicalizeKey(k, ["redemption_fund", "door_open", "win"]))],
];

describe("novel-dna edge twin ↔ web engine parity", () => {
  const fixtures: [string, DnaNode[]][] = [["goodBook", goodBook()], ["brokenBook", brokenBook()], ["registryBook", registryBook()], ["exposureBook", exposureBook()], ["ledgerAtBook", ledgerAtBook()]];
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

// Facet exposure behaviour (docs/scene-ledger.md §2) — the deterministic verbatim-echo floor.
describe("facet exposure (Phase 2 floor)", () => {
  it("facetEchoes finds the planted verbatim palette echo and ignores the unrelated scene", () => {
    const uses = web.facetEchoes(exposureBook()).filter((u) => u.ref === "ex_loc" && u.facet === "smell");
    expect(uses.map((u) => u.sceneId).sort()).toEqual(["ex_s1", "ex_s3"]);
    expect(uses.find((u) => u.sceneId === "ex_s2")).toBeUndefined();
    expect(uses[0].echo).toContain("tar and old rope");
  });

  it("facetExposureBefore counts only prior scenes and derives saturation from the count", () => {
    const nodes = exposureBook();
    // Entering ex_s3, the smell facet has been echoed once (ex_s1) — established, not yet saturated.
    const before3 = web.facetExposureBefore(nodes, "ex_s3").find((e) => e.ref === "ex_loc" && e.facet === "smell");
    expect(before3).toMatchObject({ uses: 1, saturated: false });
    expect(before3?.lastPhrasing).toContain("tar and old rope");
    // A facet reaches saturation once uses ≥ FACET_SATURATION.
    expect(web.FACET_SATURATION).toBeGreaterThanOrEqual(2);
  });
});

// ledgerAt — the unified between-scenes view (docs/scene-ledger.md §3). Every field exercised.
describe("ledgerAt (Phase 3)", () => {
  it("folds every axis of state entering a scene", () => {
    const nodes = ledgerAtBook();
    const L = web.ledgerAt(nodes, "la_s4"); // prior = s1, s2, s3
    expect(L.index).toBe(3);
    // Causality: keys established upstream, in reading order.
    expect(L.causality.established).toEqual(["compass_found", "rope_frays"]);
    // Thread FSM: opened at s1, paid at s3.
    expect(L.threads.find((t) => t.ref === "la_t1")).toMatchObject({ state: "paid", openedAt: 0, lastTouch: 2, scenesSinceTouch: 1 });
    // Relationship: one move, its last "how".
    expect(L.relations.find((r) => r.ref === "la_r1")).toMatchObject({ moves: 1, lastHow: "they meet at the water", lastAt: 0 });
    // Meter carry-forward across the s2 gap: last reading (s3 = 5) wins.
    expect(L.meters.find((m) => m.ref === "la_m1")?.value).toBe(5);
    // Positions: Mara moved to the uplands (s3); Okonkwo last seen at the harbor (s1).
    expect(L.positions.find((p) => p.ref === "la_c1")).toMatchObject({ loc: "la_l2", lastSeenAt: 2 });
    expect(L.positions.find((p) => p.ref === "la_c2")).toMatchObject({ loc: "la_l1", lastSeenAt: 0 });
    // Facet saturation: the harbor smell was echoed in all three prior scenes.
    expect(L.exposure.find((e) => e.ref === "la_l1" && e.facet === "smell")).toMatchObject({ uses: 3, saturated: true });
    // Observed fact superseded: s2's value wins over s1's, carrying its entity ref.
    expect(L.facts.find((f) => f.key === "mara_loc")).toMatchObject({ value: "still at the harbor", entity: "la_c1" });
  });

  it("represents a held-open thread mid-book (open + scenesSinceTouch > 0)", () => {
    const L = web.ledgerAt(ledgerAtBook(), "la_s3"); // prior = s1, s2 — set up but not yet paid
    expect(L.threads.find((t) => t.ref === "la_t1")).toMatchObject({ state: "open", openedAt: 0, scenesSinceTouch: 2 });
  });
});

// The guided-flow objective (dna-journey twin) is what threadSystem re-derives live each chain link (P1.2);
// lock it to the web dnaJourney over prose + picture mode.
describe("dna-journey edge twin ↔ web dnaJourney parity", () => {
  const fixtures: [string, DnaNode[]][] = [["goodBook", goodBook()], ["brokenBook", brokenBook()], ["registryBook", registryBook()], ["exposureBook", exposureBook()], ["ledgerAtBook", ledgerAtBook()]];
  for (const [fxName, nodes] of fixtures) {
    for (const mode of ["prose", "picture"] as const) {
      it(`currentObjective agrees on ${fxName} (${mode})`, () => {
        const opts = { mode, bookSlug: "42" };
        expect(edgeJ.currentObjective(nodes, opts)).toBe(webJ.currentObjective(nodes, opts));
      });
      it(`buildJourney agrees on ${fxName} (${mode})`, () => {
        expect(j(edgeJ.buildJourney(nodes, mode))).toBe(j(webJ.buildJourney(nodes, mode)));
      });
      it(`nextDraftTarget agrees on ${fxName} (${mode})`, () => {
        expect(j(edgeJ.nextDraftTarget(nodes, mode))).toBe(j(webJ.nextDraftTarget(nodes, mode)));
      });
    }
  }

  it("goodBook's objective reaches the draft stage and names a target scene", () => {
    // goodBook has scenes with an undrafted one, so the live objective should point at a TARGET NODE — the
    // exact behaviour P1.2 keeps fresh mid-run.
    expect(webJ.currentObjective(goodBook(), { mode: "prose" })).toContain("TARGET NODE:");
  });
});
