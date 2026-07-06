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

// Vertical-fit fixture (doc_1783103754000_timeline_layer.md): every rung contradicts the rung above it — a
// 4-movement shape over 1 act (shape_unmapped), an "up" ending promise whose last scene lands down
// (ending_feel_mismatch), a "down" act value whose last beat lands up (act_value_undelivered), an "up" beat
// whose last scene lands down (beat_polarity_undelivered), and a scene reading 5 where its beat planned 1 on
// a 0–5 scale (scene_reading_departs).
function verticalBook(): DnaNode[] {
  const seed = mk("seed", { id: "vf_seed", content: { logline: "A keeper must hold the last lighthouse through the worst winter." } });
  const premise = mk("premise", { id: "vf_prem", parent_id: "vf_seed", content: { dramatic_question: "Can she keep the light lit?", shape: { name: "man in a hole", movements: ["comfort", "fall", "struggle", "rise"], ending_feel: "up" } } });
  const pillar = mk("pillar", { id: "vf_pil", parent_id: "vf_prem", content: { controlling_idea: "Keeping a light costs the keeper." } });
  const meter = mk("meter", { id: "vf_m1", parent_id: "vf_pil", content: { name: "dread", kind: "tension", scale: { min: 0, max: 5 } } });
  const a1 = mk("act", { id: "vf_a1", parent_id: "vf_pil", position: 0, content: { title: "Only act", goal: "endure", value: { name: "resolve", from: "steady", to: "guttering", polarity: "down" } } });
  const b1 = mk("beat", { id: "vf_b1", parent_id: "vf_a1", position: 0, content: { summary: "The storm rises and she rises with it.", polarity: "up", readings: [{ ref: "vf_m1", value: 1 }] } });
  const s1 = mk("scene", { id: "vf_s1", parent_id: "vf_b1", position: 0, content: { goal: "hold the light", value_shift: vs("down"), readings: [{ ref: "vf_m1", value: 5 }] } });
  return [seed, premise, pillar, meter, a1, b1, s1];
}

// Shape-read fixtures (doc_1783113903000_shape_read_spec.md): a premise promising 3 movements over 2 acts, with a
// PAID verdict written onto the premise. movement 0 scores 1/5 (fires, anchored to its worst beat), movement 1
// scores 4/5 (clears the floor), movement 2 has an EMPTY inferred mapping (uncarried → fit 0 → fires on the
// premise). The seal is what gates the lint: a fresh hash makes it fire; a wrong hash makes it stay silent.
function shapeBase(): DnaNode[] {
  const seed = mk("seed", { id: "sf_seed", content: { logline: "A courier must cross a country that forgets her at every border." } });
  const premise = mk("premise", { id: "sf_prem", parent_id: "sf_seed", content: { dramatic_question: "Can she be remembered?", shape: { name: "quest", movements: ["the leaving", "the trials", "the return"], ending_feel: "bittersweet" } } });
  const pillar = mk("pillar", { id: "sf_pil", parent_id: "sf_prem", content: { controlling_idea: "To be known you must be seen leaving." } });
  const a1 = mk("act", { id: "sf_a1", parent_id: "sf_pil", position: 0, content: { title: "Departure", goal: "get out the gate", turning_point: "the first border wipes her name" } });
  const a2 = mk("act", { id: "sf_a2", parent_id: "sf_pil", position: 1, content: { title: "The Road", goal: "reach the capital" } });
  const b1 = mk("beat", { id: "sf_b1", parent_id: "sf_a1", position: 0, content: { summary: "She slips the gate at dusk." } });
  const b2 = mk("beat", { id: "sf_b2", parent_id: "sf_a2", position: 0, content: { summary: "A checkpoint eats her papers." } });
  return [seed, premise, pillar, a1, a2, b1, b2];
}
function stampShapeFit(fresh: boolean): DnaNode[] {
  const nodes = shapeBase();
  const premise = nodes.find((n) => n.id === "sf_prem")!;
  const input = web.buildShapeReadInput(nodes)!;
  const observed_shape_fit = [
    { movement: 0, actIds: ["sf_a1"], fit: 1, worst: "sf_b1", note: "the leaving is stated, not dramatized" },
    { movement: 1, actIds: ["sf_a2"], fit: 4 },
    { movement: 2, actIds: [], fit: 0 }, // uncarried → the semantic complement of shape_unmapped
  ];
  premise.content = { ...premise.content, observed_shape_fit, observed_shape_hash: fresh ? web.shapeReadHash(input) : "stale-hash" };
  return nodes;
}

// Synopsis-read fixtures (W2): the same plan as shapeBase, with a PAID craft verdict written onto the PILLAR.
// boredom_risk scores 2 (fires, anchored to its worst beat), stakes_clarity scores 1 with an unknown worst
// (fires on the pillar), genre_feel scores exactly the floor (3 — silent), predictability scores 4 (silent).
// The seal gates it exactly like the shape read: a fresh hash fires, a wrong hash stays silent.
function stampCraft(fresh: boolean): DnaNode[] {
  const nodes = shapeBase();
  const pillar = nodes.find((n) => n.id === "sf_pil")!;
  const input = web.buildSynopsisReadInput(nodes)!;
  const observed_craft = [
    { axis: "boredom_risk", score: 2, worst: "sf_b2", note: "the road coasts between checkpoints" },
    { axis: "predictability", score: 4 },
    { axis: "genre_feel", score: 3, note: "quest furniture without quest wonder" },
    { axis: "stakes_clarity", score: 1, worst: "not_a_node" }, // unknown worst → anchors to the pillar
  ];
  pillar.content = { ...pillar.content, observed_craft, observed_craft_hash: fresh ? web.synopsisReadHash(input) : "stale-hash" };
  return nodes;
}

// W3 prose-lint fixture: planted MECHANICAL faults for the deterministic read layer — an adjacent verbatim
// echo (pp_s1→pp_s2 share one distinctive 5-gram), a flat-cadence scene (pp_s3: 8 five-word sentences, CV 0),
// a name-soup scene (pp_s4: 180 words dense with Mara/Okonkwo), and a 3-run of all-dialogue scenes
// (pp_s5..pp_s7). The narration run at the head also exercises the ≤10% dialogue extreme.
function proseBook(): DnaNode[] {
  const pillar = mk("pillar", { id: "pp_pil", content: {} });
  const c1 = mk("character", { id: "pp_c1", parent_id: "pp_pil", content: { name: "Mara Voss", role: "protagonist" } });
  const c2 = mk("character", { id: "pp_c2", parent_id: "pp_pil", content: { name: "Okonkwo", role: "ally" } });
  const a1 = mk("act", { id: "pp_a1", parent_id: "pp_pil", position: 0, content: { title: "One" } });
  const b1 = mk("beat", { id: "pp_b1", parent_id: "pp_a1", position: 0, content: { summary: "planted faults" } });
  const flat = "Mara walked to the door. Rain hammered on the glass. She counted every grey step. The lamp guttered in silence. Something moved behind the curtain. Her hands would not settle. The clock ticked past midnight. Nobody answered her second knock.";
  const soup = Array.from({ length: 12 }, () => "Mara watched Okonkwo pace. Mara told Okonkwo that Mara would carry the lantern north again.").join(" ");
  const sc = (id: string, pos: number, text: string) =>
    mk("scene", { id, parent_id: "pp_b1", position: pos, content: { goal: "g", value_shift: vs(pos % 2 ? "up" : "down"), prose: { text } } });
  return [pillar, c1, c2, a1, b1,
    sc("pp_s1", 0, "The copper weathervane spun over marshland."),
    sc("pp_s2", 1, "She remembered the copper weathervane spun over water."),
    sc("pp_s3", 2, flat),
    sc("pp_s4", 3, soup),
    sc("pp_s5", 4, '"Where is it?" she asked.\n"Gone," he said.'),
    sc("pp_s6", 5, '"You promised me," she said.\n"I lied," he said.'),
    sc("pp_s7", 6, '"Open the box," she said.\n"No," he said.'),
  ];
}

// Sketch/direction fixtures (doc_1783198900000_dna_scene_direction.md): a thread payoff shown in summary/far
// direction (promise_undramatized fires on sk_s2), and a LATER scene with no promise work of its own (sk_s3)
// repeating that same direction (direction_monotone fires on sk_s3, against the last SKETCHED scene in
// reading order — even across the beat boundary). sk_s1/sk_s4 are clean control scenes.
function sketchBook(): DnaNode[] {
  const pillar = mk("pillar", { id: "sk_pil", content: {} });
  const thread = mk("thread", { id: "sk_t1", parent_id: "sk_pil", content: { name: "the debt", promise: "she owes the guild" } });
  const a1 = mk("act", { id: "sk_a1", parent_id: "sk_pil", position: 0, content: { title: "One" } });
  const b1 = mk("beat", { id: "sk_b1", parent_id: "sk_a1", position: 0, content: { summary: "Setup.", polarity: "down" } });
  const b2 = mk("beat", { id: "sk_b2", parent_id: "sk_a1", position: 1, content: { summary: "Payoff.", polarity: "up" } });
  const s1 = mk("scene", { id: "sk_s1", parent_id: "sk_b1", position: 0, content: { goal: "meet the creditor", value_shift: vs("down"), sketch: { direction: { mode: "dialogue", distance: "close", tension: "suspense" } } } });
  const s2 = mk("scene", { id: "sk_s2", parent_id: "sk_b1", position: 1, content: { goal: "face the debt", value_shift: vs("down"), threads: [{ ref: "sk_t1", role: "payoff" }], sketch: { direction: { mode: "summary", distance: "far", tension: "mystery" } } } });
  const s3 = mk("scene", { id: "sk_s3", parent_id: "sk_b2", position: 0, content: { goal: "walk the long road home", value_shift: vs("up"), sketch: { direction: { mode: "summary", distance: "far", tension: "mystery" } } } });
  const s4 = mk("scene", { id: "sk_s4", parent_id: "sk_b2", position: 1, content: { goal: "settle the ledger", value_shift: vs("up"), sketch: { direction: { mode: "action", distance: "close", tension: "irony" } } } });
  return [pillar, thread, a1, b1, b2, s1, s2, s3, s4];
}

// A fully-drafted book whose only outstanding debt is one open thread — the promises ENDGAME (debt-based
// completion). Exercises obligationLedger/debtSettled and the objective's OPEN PROMISES block in both twins.
function endgameBook(): DnaNode[] {
  const seed = mk("seed", { id: "eg_seed", content: { logline: "A diver must raise a drowned bell." } });
  const premise = mk("premise", { id: "eg_prem", parent_id: "eg_seed", content: { dramatic_question: "Will the bell ring again?" } });
  const pillar = mk("pillar", { id: "eg_pil", parent_id: "eg_prem", content: { controlling_idea: "Salvage is grief work.", ending: "It rings." } });
  const hero = mk("character", { id: "eg_ch1", parent_id: "eg_pil", content: { name: "Ndidi", role: "protagonist" } });
  const thread = mk("thread", { id: "eg_th1", parent_id: "eg_pil", content: { name: "the sealed hatch", promise: "what's behind it surfaces" } });
  const a1 = mk("act", { id: "eg_a1", parent_id: "eg_pil", position: 0, content: { title: "Down", goal: "reach the wreck" } });
  const b1 = mk("beat", { id: "eg_b1", parent_id: "eg_a1", position: 0, content: { summary: "She finds the hatch." } });
  const s1 = mk("scene", { id: "eg_s1", parent_id: "eg_b1", position: 0, content: { goal: "open it", pov: "eg_ch1", value_shift: vs("down"), threads: [{ ref: "eg_th1", role: "setup" }], prose: { text: "The hatch held.", words: 3 } } });
  return [seed, premise, pillar, hero, thread, a1, b1, s1];
}

// The GENRE promise (the CONTRACT obligation kind): two meters with a compiled `target` curve — one carried
// to the last beat within band (closed), one touched only early and left behind (open). No thread/game/
// tentpole noise, so the fixture isolates this one axis for both the ledger and debtSettled/currentObjective.
function contractBook(): DnaNode[] {
  const seed = mk("seed", { id: "ct_seed", content: { logline: "A courier must cross a burning province before the letter dies with her." } });
  const premise = mk("premise", { id: "ct_prem", parent_id: "ct_seed", content: { dramatic_question: "Does the letter arrive?" } });
  const pillar = mk("pillar", { id: "ct_pil", parent_id: "ct_prem", content: { controlling_idea: "A promise outruns a war.", ending: "It arrives, unread." } });
  const hero = mk("character", { id: "ct_ch1", parent_id: "ct_pil", content: { name: "Osa", role: "protagonist" } });
  // Carried all the way to the last beat, close to the target curve throughout — CLOSED.
  const kept = mk("meter", { id: "ct_m_kept", parent_id: "ct_pil", content: { name: "dread", kind: "tension", scale: { min: 0, max: 10 }, target: [{ at: 0, value: 0 }, { at: 1, value: 10 }] } });
  // Touched only at the first beat, then abandoned — never reaches the last beat — OPEN.
  const dropped = mk("meter", { id: "ct_m_dropped", parent_id: "ct_pil", content: { name: "heat", kind: "heat", scale: { min: 0, max: 10 }, target: [{ at: 0, value: 0 }, { at: 1, value: 10 }] } });
  const a1 = mk("act", { id: "ct_a1", parent_id: "ct_pil", position: 0, content: { title: "The Road" } });
  const b1 = mk("beat", { id: "ct_b1", parent_id: "ct_a1", position: 0, content: { summary: "She sets out.", readings: [{ ref: "ct_m_kept", value: 0 }, { ref: "ct_m_dropped", value: 0 }] } });
  const b2 = mk("beat", { id: "ct_b2", parent_id: "ct_a1", position: 1, content: { summary: "Mid-crossing.", readings: [{ ref: "ct_m_kept", value: 5 }] } });
  const b3 = mk("beat", { id: "ct_b3", parent_id: "ct_a1", position: 2, content: { summary: "She reaches the gate.", readings: [{ ref: "ct_m_kept", value: 10 }] } });
  return [seed, premise, pillar, hero, kept, dropped, a1, b1, b2, b3];
}

const settings: BookSettings = { title: "The Folding City", author: "A. Nzal", word_target: 60000 };
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
  // The obligation ledger (debt-based completion): the driver's endgame will read this at the edge too.
  ["obligationLedger", (m, n) => m.obligationLedger(n)],
  ["debtSettled", (m, n) => m.debtSettled(n)],
  ["pacing", (m, n) => m.pacing(n)],
  ["topography", (m, n) => m.topography(n)],
  ["ledgerFull", (m, n) => m.ledgerFull(n)],
  ["entityRegistryBlock", (m, n) => m.entityRegistryBlock(n)],
  ["facetEchoes", (m, n) => m.facetEchoes(n)],
  ["facetExposureBefore", (m, n) => m.facetExposureBefore(n, "ex_s3")],
  ["ledgerAt", (m, n) => m.ledgerAt(n, "la_s4")],
  ["ledgerText", (m, n) => m.ledgerText(n, "la_s3")],
  ["traceDiff", (m, n) => m.traceDiff(n)],
  ["scenesInOrder", (m, n) => m.scenesInOrder(n).map((x) => x.id)],
  ["beatsInOrder", (m, n) => m.beatsInOrder(n).map((x) => x.id)],
  ["chapters", (m, n) => m.chapters(n)],
  // §3c canonicalization is pure string work (ignores the nodes arg) — lock the twin to the web engine.
  ["canonicalizeKey", (m) => ["redemption_funds", "redemtion_fund", "door_open", "won"].map((k) => m.canonicalizeKey(k, ["redemption_fund", "door_open", "win"]))],
  // Lint config: the genre presets AND validate under a non-default config must agree twin-to-twin.
  ["lintConfigForBrief", (m) => [m.lintConfigForBrief(null), m.lintConfigForBrief({ genre: "psychological thriller" }), m.lintConfigForBrief({ genre: ["Literary", "drama"] })]],
  ["validate+tautConfig", (m, n) => m.validate(n, m.lintConfigForBrief({ genre: "thriller" }))],
  // The synopsis read's assembler + seal (W2) — the craft_flag lint recomputes both, so they must agree.
  ["buildSynopsisReadInput", (m, n) => m.buildSynopsisReadInput(n)],
  ["synopsisReadHash", (m, n) => { const i = m.buildSynopsisReadInput(n); return i ? m.synopsisReadHash(i) : null; }],
  // W3: the deterministic prose linter — the twins must reach identical mechanical verdicts.
  ["proseLints", (m, n) => m.proseLints(n, m.DEFAULT_LINT_CONFIG)],
];

describe("novel-dna edge twin ↔ web engine parity", () => {
  const fixtures: [string, DnaNode[]][] = [["goodBook", goodBook()], ["brokenBook", brokenBook()], ["registryBook", registryBook()], ["exposureBook", exposureBook()], ["ledgerAtBook", ledgerAtBook()], ["verticalBook", verticalBook()], ["shapeFitFresh", stampShapeFit(true)], ["shapeFitStale", stampShapeFit(false)], ["craftFresh", stampCraft(true)], ["craftStale", stampCraft(false)], ["proseBook", proseBook()], ["sketchBook", sketchBook()], ["endgameBook", endgameBook()], ["contractBook", contractBook()]];
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

  it("the prose fixture trips all four prose rules (guards against a no-op fixture)", () => {
    const rules = web.proseLints(proseBook(), web.DEFAULT_LINT_CONFIG).map((i) => i.rule);
    for (const r of ["prose_echo", "monotone_rhythm", "name_soup", "dialogue_flatline"]) expect(rules).toContain(r);
  });
});

// Vertical fit (the timeline layer): each finer rung must refine, not contradict, the rung above it.
describe("vertical-fit lints", () => {
  const RULES = ["shape_unmapped", "ending_feel_mismatch", "act_value_undelivered", "beat_polarity_undelivered", "scene_reading_departs"];

  it("flags every rung of the deliberately contradictory book", () => {
    const rules = web.validate(verticalBook()).map((i) => i.rule);
    for (const r of RULES) expect(rules).toContain(r);
  });

  it("anchors each lint to the node that can fix it", () => {
    const issues = web.validate(verticalBook());
    expect(issues.find((i) => i.rule === "shape_unmapped")?.nodeId).toBe("vf_prem");
    expect(issues.find((i) => i.rule === "ending_feel_mismatch")?.nodeId).toBe("vf_s1");
    expect(issues.find((i) => i.rule === "act_value_undelivered")?.nodeId).toBe("vf_b1");
    expect(issues.find((i) => i.rule === "beat_polarity_undelivered")?.nodeId).toBe("vf_s1");
    expect(issues.find((i) => i.rule === "scene_reading_departs")?.nodeId).toBe("vf_s1");
  });

  it("stays silent on the coherent book (missing levels are early, not wrong)", () => {
    const rules = web.validate(goodBook()).map((i) => i.rule);
    for (const r of RULES) expect(rules).not.toContain(r);
  });
});

// Sketch/direction lints (doc_1783198900000_dna_scene_direction.md): the scene TREATMENT layer between plan
// and prose. Fires only once a scene has a sketch.
describe("sketch/direction lints", () => {
  it("flags a thread payoff shown in summary/far direction (promise present but not dramatized)", () => {
    const issues = web.validate(sketchBook()).filter((i) => i.rule === "promise_undramatized");
    expect(issues.map((i) => i.nodeId)).toEqual(["sk_s2"]);
  });

  it("flags a later scene repeating the same direction as the prior sketched scene", () => {
    const issues = web.validate(sketchBook()).filter((i) => i.rule === "direction_monotone");
    expect(issues.map((i) => i.nodeId)).toEqual(["sk_s3"]);
  });

  it("stays silent on scenes without a sketch yet (early, not wrong)", () => {
    const rules = web.validate(goodBook()).map((i) => i.rule);
    expect(rules).not.toContain("promise_undramatized");
    expect(rules).not.toContain("direction_monotone");
  });
});

// The shape read (doc_1783113903000_shape_read_spec.md): the paid semantic verdict, gated by the staleness seal.
describe("the shape read (movement_unfit)", () => {
  it("fires on a FRESH low-fit verdict, anchored to the worst node (empty mapping counts as fit 0)", () => {
    const issues = web.validate(stampShapeFit(true)).filter((i) => i.rule === "movement_unfit");
    // movement 0 (fit 1, worst = its beat) + movement 2 (uncarried → 0, anchored to the premise) fire; movement 1 (fit 4) clears the floor.
    expect(issues.map((i) => i.nodeId).sort()).toEqual(["sf_b1", "sf_prem"]);
    expect(issues.find((i) => i.nodeId === "sf_b1")?.message).toContain('movement 1 "the leaving" scores 1/5');
    expect(issues.find((i) => i.nodeId === "sf_prem")?.message).toContain('movement 3 "the return" scores 0/5');
  });

  it("stays SILENT on a STALE verdict (the seal no longer matches the tree)", () => {
    const rules = web.validate(stampShapeFit(false)).map((i) => i.rule);
    expect(rules).not.toContain("movement_unfit");
  });
});

// The synopsis read (W2): the shift-left craft verdict on the PLAN, gated by the same staleness-seal idea.
describe("the synopsis read (craft_flag)", () => {
  it("fires per FRESH sub-floor axis, anchored to the worst beat (unknown worst falls back to the pillar)", () => {
    const issues = web.validate(stampCraft(true)).filter((i) => i.rule === "craft_flag");
    expect(issues.map((i) => i.nodeId).sort()).toEqual(["sf_b2", "sf_pil"]);
    expect(issues.find((i) => i.nodeId === "sf_b2")?.message).toBe("the synopsis read scores boredom_risk 2/5 — the road coasts between checkpoints");
    expect(issues.find((i) => i.nodeId === "sf_pil")?.message).toBe("the synopsis read scores stakes_clarity 1/5");
  });

  it("does not fire at or above the floor (genre_feel 3 and predictability 4 stay silent)", () => {
    const messages = web.validate(stampCraft(true)).filter((i) => i.rule === "craft_flag").map((i) => i.message);
    expect(messages.some((m) => m.includes("genre_feel"))).toBe(false);
    expect(messages.some((m) => m.includes("predictability"))).toBe(false);
  });

  it("stays SILENT on a STALE verdict (the seal no longer matches the tree)", () => {
    const rules = web.validate(stampCraft(false)).map((i) => i.rule);
    expect(rules).not.toContain("craft_flag");
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

  it("ledgerText renders the held-open promise + positions as shared prompt text", () => {
    const t = web.ledgerText(ledgerAtBook(), "la_s3");
    expect(t).toContain('"the compass" (held 2 scenes');
    expect(t).toContain("Mara — last at The Harbor");
  });

  it("traceDiff joins planned advances/payoffs against observed facts by entity id", () => {
    const gaps = web.traceDiff(ledgerAtBook());
    // s1 plans to advance the Mara↔Okonkwo relationship, but its observed fact is tagged to Mara, not the rel.
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ axis: "relationship", ref: "la_r1", index: 0 });
    // s3's planned payoff is NOT flagged — s3 carries no observed_establishes (not read yet).
    expect(gaps.find((g) => g.axis === "thread")).toBeUndefined();
  });
});

// The guided-flow objective (dna-journey twin) is what threadSystem re-derives live each chain link (P1.2);
// lock it to the web dnaJourney.
describe("dna-journey edge twin ↔ web dnaJourney parity", () => {
  const fixtures: [string, DnaNode[]][] = [["goodBook", goodBook()], ["brokenBook", brokenBook()], ["registryBook", registryBook()], ["exposureBook", exposureBook()], ["ledgerAtBook", ledgerAtBook()], ["endgameBook", endgameBook()]];
  for (const [fxName, nodes] of fixtures) {
    it(`currentObjective agrees on ${fxName}`, () => {
      const opts = { bookSlug: "42" };
      expect(edgeJ.currentObjective(nodes, opts)).toBe(webJ.currentObjective(nodes, opts));
    });
    it(`buildJourney agrees on ${fxName}`, () => {
      expect(j(edgeJ.buildJourney(nodes))).toBe(j(webJ.buildJourney(nodes)));
    });
    it(`nextDraftTarget agrees on ${fxName}`, () => {
      expect(j(edgeJ.nextDraftTarget(nodes))).toBe(j(webJ.nextDraftTarget(nodes)));
    });
  }

  it("goodBook's objective reaches the draft stage and names a target scene", () => {
    // goodBook has scenes with an undrafted one, so the live objective should point at a TARGET NODE — the
    // exact behaviour P1.2 keeps fresh mid-run.
    expect(webJ.currentObjective(goodBook())).toContain("TARGET NODE:");
  });

  it("endgameBook's objective reaches the promises endgame and names the open debt", () => {
    // Fully drafted but one thread unpaid: the DEBT gate (not the scene count) holds the book open, and the
    // objective lists the promise so the agent settles it deliberately.
    const obj = webJ.currentObjective(endgameBook());
    expect(obj).toContain("OPEN PROMISES");
    expect(obj).toContain("the sealed hatch");
    expect(obj).not.toContain("fully drafted");
  });
});
