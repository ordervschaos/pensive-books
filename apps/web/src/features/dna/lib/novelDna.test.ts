import { describe, expect, it } from "vitest";
import {
  analysisText, backlinkIndex, blastRadius, byId, cascade, causality, chapters, chooseProposal, editContent, emptyNode,
  enforcePromiseSchedule, inputHash, isProseStale, isRenderable, isStale, lock, pacing, promiseLedger,
  refsOf, renderBlockers, renderPages, scenesInOrder, stakesOf, stampInput, stampProse, topography,
  validate, meterSeries, meterShape, isSerialMeter, meterTarget, targetGap, observedSeries, observedGap,
  ledgerBefore, ledgerFull, lintConfigForBrief, DEFAULT_LINT_CONFIG, proseLints,
  obligationLedger, openObligations, debtSettled,
  type DnaNode, type NodeKind, type ThreadRef, type Obligation,
} from "@/features/dna/lib/novelDna";

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

describe("reading order + chapters", () => {
  it("scenesInOrder is the DFS leaf order of the spine, skipping entities", () => {
    const pillar = mk("pillar", { id: "p" });
    const m1 = mk("act", { id: "m1", parent_id: "p", position: 0 });
    const m2 = mk("act", { id: "m2", parent_id: "p", position: 1 });
    const b1 = mk("beat", { id: "b1", parent_id: "m1", position: 0 });
    const b2 = mk("beat", { id: "b2", parent_id: "m1", position: 1 });
    const b3 = mk("beat", { id: "b3", parent_id: "m2", position: 0 });
    const char = mk("character", { id: "c", parent_id: "p" }); // entity — must NOT appear
    const s = (id: string, p: string, pos: number) => mk("scene", { id, parent_id: p, position: pos });
    const nodes = [pillar, m1, m2, b1, b2, b3, char, s("s1", "b1", 0), s("s2", "b1", 1), s("s3", "b2", 0), s("s4", "b3", 0)];
    expect(scenesInOrder(nodes).map((n) => n.id)).toEqual(["s1", "s2", "s3", "s4"]);
  });

  it("chapters partition scenes by chapter_start, with an implicit opening", () => {
    const m = mk("act", { id: "m" });
    const s = (id: string, pos: number, cs?: unknown, words?: number) =>
      mk("scene", { id, parent_id: "m", position: pos, content: { chapter_start: cs ?? null, prose: { words } } });
    const nodes = [m, s("s1", 0, undefined, 100), s("s2", 1, undefined, 100), s("s3", 2, { title: "Two" }, 300), s("s4", 3, undefined, 60)];
    const chs = chapters(nodes);
    expect(chs.map((c) => c.title)).toEqual(["Opening", "Two"]);
    expect(chs[0].sceneIds).toEqual(["s1", "s2"]);
    expect(chs[1].sceneIds).toEqual(["s3", "s4"]);
    expect(chs[0].wordCount).toBe(200);
    expect(chs[1].estPages).toBe(Math.max(1, Math.ceil(360 / 280)));
  });
});

describe("render projection (chapter → section + text page)", () => {
  it("emits a section page and a text page (scenes' prose concatenated) per chapter", () => {
    const m = mk("act", { id: "m" });
    const b = mk("beat", { id: "b", parent_id: "m" });
    const s1 = mk("scene", { id: "s1", parent_id: "b", position: 0, content: { chapter_start: { title: "One" }, prose: { text: "Hello." } } });
    const s2 = mk("scene", { id: "s2", parent_id: "b", position: 1, content: { prose: { text: "World." } } });
    const s3 = mk("scene", { id: "s3", parent_id: "b", position: 2, content: { chapter_start: { title: "Two" }, prose: { text: "Again." } } });
    const out = renderPages([m, b, s1, s2, s3]);
    expect(out).toEqual([
      { nodeId: "ch:s1", kind: "section", title: "One", proseText: "" },
      { nodeId: "ch:s1:body", kind: "text", title: "One", proseText: "Hello.\n\nWorld." },
      { nodeId: "ch:s3", kind: "section", title: "Two", proseText: "" },
      { nodeId: "ch:s3:body", kind: "text", title: "Two", proseText: "Again." },
    ]);
  });
});

describe("staleness (derived from the input-set hash)", () => {
  it("a child goes stale when its parent's content changes, and stamping clears it", () => {
    const beat = mk("beat", { id: "b", content: { summary: "old" } });
    let scene = mk("scene", { id: "s", parent_id: "b", content: { goal: "g" } });
    scene = stampInput(scene, byId([beat, scene]));
    expect(isStale(scene, byId([beat, scene]))).toBe(false);

    const beat2 = editContent(beat, { summary: "NEW" });
    expect(isStale(scene, byId([beat2, scene]))).toBe(true); // parent moved
    const scene2 = stampInput(scene, byId([beat2, scene]));
    expect(isStale(scene2, byId([beat2, scene2]))).toBe(false); // re-stamped
  });

  it("a scene goes stale when a REFERENCED entity changes (not just its parent)", () => {
    const beat = mk("beat", { id: "b" });
    const char = mk("character", { id: "c", content: { lie: "I am unlovable" } });
    let scene = mk("scene", { id: "s", parent_id: "b", content: { pov: "c", goal: "g" } });
    expect(refsOf(scene)).toContain("c");
    scene = stampInput(scene, byId([beat, char, scene]));
    expect(isStale(scene, byId([beat, char, scene]))).toBe(false);

    const char2 = editContent(char, { lie: "I am too much" });
    expect(isStale(scene, byId([beat, char2, scene]))).toBe(true);
  });

  it("prose goes stale when the scene plan changes", () => {
    let scene = mk("scene", { id: "s", content: { goal: "win", prose: { text: "She walked in." } } });
    scene = stampProse(scene);
    expect(isProseStale(scene)).toBe(false);
    const scene2 = editContent(scene, { goal: "lose" });
    expect(isProseStale(scene2)).toBe(true);
  });

});

describe("backlinkIndex (the inverse of refsOf — inbound cross-references)", () => {
  it("maps each id to the nodes that reference it", () => {
    const hero = mk("character", { id: "c_hero" });
    const rel = mk("relationship", { id: "r1", content: { a: "c_hero", b: "c_foe" } });
    const scene = mk("scene", { id: "s1", content: { pov: "c_hero", present: ["c_hero"] } });
    const back = backlinkIndex([hero, rel, scene]);
    const onHero = (back.get("c_hero") ?? []).map((n) => n.id).sort();
    expect(onHero).toEqual(["r1", "s1"]); // both the relationship and the scene point at the hero
    expect(back.get("c_foe")?.map((n) => n.id)).toEqual(["r1"]);
    expect(back.has("s1")).toBe(false); // nothing references the scene
  });
});

describe("pure edits", () => {
  it("editContent promotes an empty slot to a user draft; an AI node becomes ai_then_user", () => {
    const empty = emptyNode(1, "pillar", 2, null);
    const edited = editContent(empty, { ending: "they part" });
    expect(edited.authoring.status).toBe("draft");
    expect(edited.authoring.source).toBe("user");

    const ai = mk("scene", { authoring: { source: "ai", locked: false, status: "accepted" } });
    expect(editContent(ai, { goal: "x" }).authoring.source).toBe("ai_then_user");
  });

  it("editContent deep-merges nested fields — a throughline edit can't clobber sibling shape fields", () => {
    const premise = mk("premise", { content: { shape: { name: "man in a hole", movements: ["m1", "m2"], ending_feel: "up" } } });
    const edited = editContent(premise, { shape: { name: "kishōtenketsu" } }); // patch only one nested key
    expect(edited.content.shape).toEqual({ name: "kishōtenketsu", movements: ["m1", "m2"], ending_feel: "up" });
  });

  it("deep-merge replaces arrays wholesale (DNA arrays are whole values, not appended)", () => {
    const n = mk("premise", { content: { genre: ["a", "b"], dramatic_question: "q" } });
    const edited = editContent(n, { genre: ["c"] });
    expect(edited.content.genre).toEqual(["c"]);          // replaced, not concatenated
    expect(edited.content.dramatic_question).toBe("q");   // sibling untouched
  });

  it("chooseProposal adopts the proposal content and accepts the node", () => {
    const n = mk("premise", { authoring: { source: "ai", locked: false, status: "proposed" }, proposals: [
      { id: "p1", content: { dramatic_question: "A?" } }, { id: "p2", content: { dramatic_question: "B?" } },
    ] });
    const picked = chooseProposal(n, "p2");
    expect(picked.content).toEqual({ dramatic_question: "B?" });
    expect(picked.chosen).toBe("p2");
    expect(picked.authoring.status).toBe("accepted");
    expect(picked.proposals).toBeUndefined();
  });
});

describe("blast radius", () => {
  it("counts the unlocked subtree, stopping cold at any lock", () => {
    const pillar = mk("pillar", { id: "p" });
    const m = mk("act", { id: "m", parent_id: "p" });
    const b1 = mk("beat", { id: "b1", parent_id: "m" });
    const b2 = mk("beat", { id: "b2", parent_id: "m", authoring: { source: "user", locked: true, status: "accepted" } });
    const s1 = mk("scene", { id: "s1", parent_id: "b1" });
    const s2 = mk("scene", { id: "s2", parent_id: "b2" }); // under a LOCKED beat → protected
    const nodes = [pillar, m, b1, b2, s1, s2];
    const { ids } = blastRadius("p", nodes);
    expect(ids.sort()).toEqual(["b1", "m", "s1"]); // b2 + its subtree excluded
  });

  it("includes scenes that reference a changed entity", () => {
    const c = mk("character", { id: "c" });
    const s1 = mk("scene", { id: "s1", content: { pov: "c" } });
    const s2 = mk("scene", { id: "s2", content: { pov: "other" } });
    expect(blastRadius("c", [c, s1, s2]).ids).toEqual(["s1"]);
  });
});

describe("validation", () => {
  it("flags flat scenes, missing beat connectors, unplaced pinned tentpoles, and dangling refs", () => {
    const m = mk("act", { id: "m" });
    const b1 = mk("beat", { id: "b1", parent_id: "m", position: 0, content: { summary: "open" } });
    const b2 = mk("beat", { id: "b2", parent_id: "m", position: 1, content: { summary: "next" } }); // no connector
    const flat = mk("scene", { id: "s1", parent_id: "b1", content: { goal: "g", outcome: "o" } }); // no value_shift
    const tent = mk("tentpole", { id: "t", authoring: { source: "user", locked: true, status: "accepted" } }); // unplaced
    const dangling = mk("scene", { id: "s2", parent_id: "b1", content: { pov: "ghost", value_shift: { value: "hope", from: "+", to: "-" } } });
    const rules = validate([m, b1, b2, flat, tent, dangling]).map((i) => i.rule);
    expect(rules).toContain("flat_scene");
    expect(rules).toContain("beat_connector");
    expect(rules).toContain("tentpole_unplaced");
    expect(rules).toContain("dangling_ref");
  });

  it("flags misparented entities, dangling parents, and duplicate singletons (the tree-shape faults)", () => {
    const seed = mk("seed", { id: "seed" });
    const premise = mk("premise", { id: "prem", parent_id: "seed" });
    const p1 = mk("pillar", { id: "p1", parent_id: "prem" });
    const p2 = mk("pillar", { id: "p2", parent_id: "prem" });                       // duplicate pillar
    const onPillar = mk("character", { id: "c1", parent_id: "p1", content: { name: "Finn" } });
    const onPremise = mk("character", { id: "c2", parent_id: "prem", content: { name: "Vane" } }); // the real bug
    const orphan = mk("world_fact", { id: "w", parent_id: "ghost", content: { name: "Sea" } });   // dangling parent
    const rules = validate([seed, premise, p1, p2, onPillar, onPremise, orphan]).map((i) => i.rule);
    expect(rules).toContain("misparented");        // character under premise, not pillar
    expect(rules).toContain("orphan");             // world_fact → missing parent
    expect(rules).toContain("duplicate_singleton"); // two pillars
  });

  it("a clean spine + entities on the pillar raise no structural faults", () => {
    const seed = mk("seed", { id: "seed" });
    const premise = mk("premise", { id: "prem", parent_id: "seed" });
    const pillar = mk("pillar", { id: "p", parent_id: "prem" });
    const ch = mk("character", { id: "c", parent_id: "p", content: { name: "Finn" } });
    const mv = mk("act", { id: "m", parent_id: "p" });
    const structural = new Set(["misparented", "orphan", "duplicate_singleton"]);
    expect(validate([seed, premise, pillar, ch, mv]).filter((i) => structural.has(i.rule))).toHaveLength(0);
  });

  it("a well-formed beat chain and placed tentpole produce no errors", () => {
    const m = mk("act", { id: "m" });
    const b1 = mk("beat", { id: "b1", parent_id: "m", position: 0, content: { summary: "a" } });
    const b2 = mk("beat", { id: "b2", parent_id: "m", position: 1, content: { summary: "b", connector: "therefore" } });
    const tent = mk("tentpole", { id: "t", authoring: { source: "user", locked: true, status: "accepted" } });
    const s = mk("scene", { id: "s", parent_id: "b1", content: { value_shift: { value: "trust", from: "-", to: "+" }, realizes_tentpole: "t", goal: "g" } });
    expect(validate([m, b1, b2, tent, s]).filter((i) => i.severity === "error")).toHaveLength(0);
  });
});

describe("dead-field + chronology + cold-reader lints", () => {
  const beat = () => mk("beat", { id: "b", content: { summary: "x" } });

  it("dead_arc: a lie-carrying character with no owned arc thread fires — only once beats exist", () => {
    const liar = mk("character", { id: "c", content: { name: "Mara", lie: "places can't be trusted" } });
    expect(validate([liar]).map((i) => i.rule)).not.toContain("dead_arc");            // no beats → early
    expect(validate([liar, beat()]).map((i) => i.rule)).toContain("dead_arc");        // planned, arc absent
    const arc = mk("thread", { id: "t", content: { name: "her lie", promise: "p", kind: "arc", owner: "c" } });
    expect(validate([liar, beat(), arc]).map((i) => i.rule)).not.toContain("dead_arc");
    const noLie = mk("character", { id: "c2", content: { name: "Okonkwo" } });
    expect(validate([noLie, beat()]).map((i) => i.rule)).not.toContain("dead_arc");   // nothing declared
  });

  it("static_relationship: a charged edge no scene advances fires — only once scenes exist", () => {
    const a = mk("character", { id: "ca", content: { name: "A" } }), b = mk("character", { id: "cb", content: { name: "B" } });
    const rel = mk("relationship", { id: "r", content: { a: "ca", b: "cb", bond: "rivals", charge: "unspoken debt" } });
    expect(validate([a, b, rel]).map((i) => i.rule)).not.toContain("static_relationship"); // no scenes → early
    const still = mk("scene", { id: "s", parent_id: "b0", content: { goal: "g", value_shift: { value: "v", from: "-", to: "+" } } });
    expect(validate([a, b, rel, beat(), still]).map((i) => i.rule)).toContain("static_relationship");
    const moving = mk("scene", { id: "s2", parent_id: "b0", content: { goal: "g", value_shift: { value: "v", from: "-", to: "+" }, advances: [{ ref: "r", how: "they clash" }] } });
    expect(validate([a, b, rel, beat(), moving]).map((i) => i.rule)).not.toContain("static_relationship");
  });

  it("unmarked_travel: same POV, new location, no time marker — a teleport; any marker silences it", () => {
    const sc = (id: string, pos: number, loc: string, time?: { when?: string; elapsed?: string }) =>
      mk("scene", { id, parent_id: "b", position: pos, content: { pov: "c1", loc, ...(time ? { time } : {}), goal: "g", value_shift: { value: "v", from: "-", to: "+" } } });
    const base = [mk("act", { id: "a" }), mk("beat", { id: "b", parent_id: "a", content: { summary: "x" } }),
      mk("character", { id: "c1", content: { name: "Mara" } }), mk("location", { id: "l1", content: { name: "Harbor" } }), mk("location", { id: "l2", content: { name: "Uplands" } })];
    const teleport = validate([...base, sc("s1", 0, "l1"), sc("s2", 1, "l2")]);
    expect(teleport.find((i) => i.rule === "unmarked_travel")?.nodeId).toBe("s2");
    expect(validate([...base, sc("s1", 0, "l1"), sc("s2", 1, "l2", { elapsed: "two days" })]).map((i) => i.rule)).not.toContain("unmarked_travel");
    expect(validate([...base, sc("s1", 0, "l1", { when: "dusk" }), sc("s2", 1, "l2", { when: "next morning" })]).map((i) => i.rule)).not.toContain("unmarked_travel");
    expect(validate([...base, sc("s1", 0, "l1"), sc("s2", 1, "l1")]).map((i) => i.rule)).not.toContain("unmarked_travel"); // same place
  });

  it("reader_confusion surfaces stored cold-reader flags as warns on the scene", () => {
    const s = mk("scene", { id: "s", content: { goal: "g", value_shift: { value: "v", from: "-", to: "+" }, confusion_flags: [{ kind: "who", note: "three unnamed speakers" }] } });
    const hit = validate([s]).find((i) => i.rule === "reader_confusion");
    expect(hit?.nodeId).toBe("s");
    expect(hit?.severity).toBe("warn");
    expect(hit?.message).toContain("who");
  });
});

describe("lint config (genre-parameterized thresholds)", () => {
  it("derives presets from the brief's genre and defaults on unknown/absent genre", () => {
    expect(lintConfigForBrief(null)).toEqual(DEFAULT_LINT_CONFIG);
    expect(lintConfigForBrief({ genre: "cozy fantasy" })).toEqual(DEFAULT_LINT_CONFIG);
    expect(lintConfigForBrief({ genre: "psychological THRILLER" }).saggingRun).toBe(3);
    expect(lintConfigForBrief({ genre: ["Literary", "drama"] }).meterMinOsc).toBe(1);
  });

  it("a 3-scene same-polarity run sags for a thriller but not under the defaults", () => {
    const m = mk("act", { id: "m" });
    const b = mk("beat", { id: "b", parent_id: "m", content: { summary: "x" } });
    const sc = (id: string, pos: number) =>
      mk("scene", { id, parent_id: "b", position: pos, content: { goal: "g", value_shift: { value: "hope", from: "+", to: "-", polarity: "down" } } });
    const nodes = [m, b, sc("s1", 0), sc("s2", 1), sc("s3", 2)];
    expect(validate(nodes).map((i) => i.rule)).not.toContain("sagging_middle");
    expect(validate(nodes, lintConfigForBrief({ genre: "thriller" })).map((i) => i.rule)).toContain("sagging_middle");
  });
});

describe("render completeness", () => {
  const settings = { title: "Book", author: "Me", word_target: 50000 };
  it("blocks on missing settings and unwritten scenes; clears when all scenes have accepted prose", () => {
    const m = mk("act", { id: "m" });
    const b = mk("beat", { id: "b", parent_id: "m" });
    const planned = mk("scene", { id: "s", parent_id: "b", content: { goal: "g" } }); // no prose
    expect(renderBlockers([m, b, planned], settings)).toContain("1 scene(s) without accepted prose");
    expect(renderBlockers([m, b, planned], {})).toEqual(expect.arrayContaining(["no book title", "no author", "no word_target in the mandate"]));

    const written = mk("scene", { id: "s", parent_id: "b", content: { goal: "g", prose: { text: "Words on the page." } }, authoring: { source: "ai", locked: false, status: "accepted" } });
    expect(isRenderable([m, b, written], settings)).toBe(true);
  });
});

describe("inputHash determinism", () => {
  it("is stable across key order", () => {
    const a = mk("scene", { id: "s", parent_id: "p", content: { goal: "g", loc: "x" } });
    const p1 = mk("beat", { id: "p", content: { summary: "s", connector: "but" } });
    const p2 = mk("beat", { id: "p", content: { connector: "but", summary: "s" } }); // same data, reordered keys
    expect(inputHash(a, byId([p1, a]))).toBe(inputHash(a, byId([p2, a])));
  });
});

// ── The three analytic axes (schema §6) ────────────────────────────────────────
// A reusable spine: pillar → act → beat → scenes s1..s4 in reading order.
const spine = (sceneContent: Record<string, unknown>[], extra: DnaNode[] = []): DnaNode[] => {
  const m = mk("act", { id: "m", parent_id: "p", position: 0 });
  const b = mk("beat", { id: "b", parent_id: "m", position: 0 });
  const scenes = sceneContent.map((c, i) => mk("scene", { id: `s${i + 1}`, parent_id: "b", position: i, content: c }));
  return [m, b, ...scenes, ...extra];
};
const vs = (polarity: "up" | "down") => ({ value: "hope", from: "x", to: "y", polarity });

describe("promises axis (threads as a registry)", () => {
  it("a scene's thread refs are part of its input set (stale on the promise changing)", () => {
    const th = mk("thread", { id: "th", content: { promise: "the gun" } });
    let s = mk("scene", { id: "s", content: { threads: [{ ref: "th", role: "setup" }] } });
    expect(refsOf(s)).toContain("th");
    s = stampInput(s, byId([th, s]));
    const th2 = editContent(th, { promise: "the knife" });
    expect(isStale(s, byId([th2, s]))).toBe(true);
  });

  it("flags dangling, unearned, and misordered payoffs — and a clean setup→payoff passes", () => {
    const clean = mk("thread", { id: "tc", content: { promise: "p" } });          // setup s1 → payoff s3 ✓
    const dangling = mk("thread", { id: "td", content: { promise: "p" } });        // setup s2, never paid
    const unearned = mk("thread", { id: "tu", content: { promise: "p" } });        // payoff s4, no setup
    const misordered = mk("thread", { id: "tm", content: { promise: "p" } });      // payoff s1 before setup s2
    const nodes = spine(
      [
        { value_shift: vs("up"), threads: [{ ref: "tc", role: "setup" }, { ref: "tm", role: "payoff" }] }, // s1
        { value_shift: vs("up"), threads: [{ ref: "td", role: "setup" }, { ref: "tm", role: "setup" }] },  // s2
        { value_shift: vs("up"), threads: [{ ref: "tc", role: "payoff" }] },                               // s3
        { value_shift: vs("up"), threads: [{ ref: "tu", role: "payoff" }] },                               // s4
      ],
      [clean, dangling, unearned, misordered],
    );
    const rules = validate(nodes).map((i) => i.rule);
    expect(rules).toContain("dangling_promise");
    expect(rules).toContain("unearned_payoff");
    expect(rules).toContain("misordered_payoff");
    // the clean thread (tc) raised nothing on its own scenes
    expect(rules.filter((r) => r === "dangling_promise")).toHaveLength(1);
  });
});

describe("global beat-sheet guarantee (enforcePromiseSchedule)", () => {
  const t = (ref: string, role: ThreadRef["role"]): ThreadRef => ({ ref, role });
  it("drops payoffs with no prior setup, keeps ordered ones", () => {
    const beats = [
      { threads: [t("gun", "setup")] },                       // sets up gun
      { threads: [t("ghost", "payoff")] },                    // pays ghost — NEVER set up → dropped
      { threads: [t("gun", "payoff"), t("clock", "payoff")] }, // gun ok (set up), clock orphan → dropped
    ];
    const { items, dropped } = enforcePromiseSchedule(beats);
    expect(dropped).toBe(2);
    expect(items[1].threads).toEqual([]);                     // ghost payoff removed
    expect(items[2].threads).toEqual([t("gun", "payoff")]);   // clock removed, gun kept
  });

  it("allows a single item that both sets up and pays a thread", () => {
    const beats = [{ threads: [t("twist", "setup"), t("twist", "payoff")] }];
    expect(enforcePromiseSchedule(beats).dropped).toBe(0);
  });

  it("the cleaned schedule produces no unearned/misordered lints once realized on scenes", () => {
    // Realize the cleaned beat threads onto scenes and confirm the promise axis is clean.
    const raw = [{ threads: [t("a", "setup")] }, { threads: [t("b", "payoff")] }, { threads: [t("a", "payoff")] }];
    const { items } = enforcePromiseSchedule(raw);
    const m = mk("act", { id: "m" });
    const b = mk("beat", { id: "b", parent_id: "m" });
    const tA = mk("thread", { id: "a" }); const tB = mk("thread", { id: "b" });
    const scenes = items.map((it, i) => mk("scene", { id: `s${i}`, parent_id: "b", position: i, content: { value_shift: vs("up"), threads: it.threads } }));
    const rules = validate([m, b, tA, tB, ...scenes]).map((r) => r.rule);
    expect(rules).not.toContain("unearned_payoff");
    expect(rules).not.toContain("misordered_payoff");
  });
});

describe("promise ledger + analysis text (the UI/chat surfacing)", () => {
  const t = (ref: string, role: ThreadRef["role"]): ThreadRef => ({ ref, role });
  const build = () => {
    const m = mk("act", { id: "m", content: { title: "Act I", target_pct: 0.25 } });
    const b = mk("beat", { id: "b", parent_id: "m" });
    const th1 = mk("thread", { id: "th1", content: { name: "the gun", promise: "a planted gun" } });
    const th2 = mk("thread", { id: "th2", content: { name: "the letter", promise: "an unsent letter" } });
    const s1 = mk("scene", { id: "s1", parent_id: "b", position: 0, content: { value_shift: vs("up"), threads: [t("th1", "setup"), t("th2", "setup")] } });
    const s2 = mk("scene", { id: "s2", parent_id: "b", position: 1, content: { value_shift: vs("down"), threads: [t("th1", "payoff")] } });
    return [m, b, th1, th2, s1, s2];
  };

  it("promiseLedger counts setups/payoffs per thread", () => {
    const ledger = promiseLedger(build());
    expect(ledger.find((r) => r.threadId === "th1")).toMatchObject({ setups: 1, payoffs: 1 });
    expect(ledger.find((r) => r.threadId === "th2")).toMatchObject({ setups: 1, payoffs: 0 }); // dangling
  });

  it("analysisText renders all three axes + flags dangling/pacing", () => {
    const text = analysisText(build(), { word_target: 80000 });
    expect(text).toContain("PACING");
    expect(text).toContain("PROMISES");
    expect(text).toContain("DANGLING");      // th2 set up, never paid
    expect(text).toContain("TOPOGRAPHY");
  });
});

describe("game pillar — the possibility space (single game is valid; coupling is optional)", () => {
  const wf = (id = "w1") => mk("world_fact", { id, content: { name: "debt-bondage", mechanism: "redemption → self-held" } });
  // The CORE case: one central game with both poles, played + resolved, grounded. A solid climax.
  const single = () => {
    const pillar = mk("pillar", { id: "p" });
    const game = mk("game", { id: "g", parent_id: "p", content: { name: "the contract", win_condition: "self-redemption → free", lose_condition: "delivered to the rival → owned", governing_rules: ["w1"] } });
    const m = mk("act", { id: "m", parent_id: "p" });
    const b1 = mk("beat", { id: "b1", parent_id: "m", position: 0, content: { plays: ["g"] } });
    const b2 = mk("beat", { id: "b2", parent_id: "m", position: 1, content: { connector: "therefore", plays: ["g"], resolves: [{ ref: "g", outcome: "won" }] } });
    return [pillar, wf(), game, m, b1, b2];
  };

  it("a single game with both poles, played and resolved, is CLEAN — no game lints", () => {
    const rules = validate(single()).map((i) => i.rule);
    expect(rules).not.toContain("halfopen_game");
    expect(rules).not.toContain("unresolved_game");
    expect(rules).not.toContain("ungrounded_game");
  });

  it("flags a half-open game (a win you can't lose) and a played-but-unresolved game", () => {
    const pillar = mk("pillar", { id: "p" });
    const halfopen = mk("game", { id: "g", parent_id: "p", content: { name: "g", win_condition: "win", governing_rules: ["w1"] } }); // no lose_condition
    const m = mk("act", { id: "m", parent_id: "p" });
    const b = mk("beat", { id: "b", parent_id: "m", content: { plays: ["g"] } }); // played, never resolved
    const rules = validate([pillar, wf(), halfopen, m, b]).map((i) => i.rule);
    expect(rules).toContain("halfopen_game");
    expect(rules).toContain("unresolved_game");
  });

  // Coupling: OPTIONAL richness for multi-game stories (the Mara market↔household example).
  it("coupling makes stakes computable — losing the market voids the household (cascade + stakesOf)", () => {
    const pillar = mk("pillar", { id: "p" });
    const both = { win_condition: "w", lose_condition: "l", governing_rules: ["w1"] };
    const market = mk("game", { id: "g_market", parent_id: "p", content: { name: "market", ...both, couples: [{ to: "g_household", when: "lost", effect: "void" }] } });
    const household = mk("game", { id: "g_household", parent_id: "p", content: { name: "household", ...both, couples: [{ to: "g_contract", when: "won", effect: "enable" }] } });
    const contract = mk("game", { id: "g_contract", parent_id: "p", content: { name: "contract", ...both } });
    const nodes = [pillar, wf(), market, household, contract];
    expect(cascade(nodes, "g_market", "lost").find((c) => c.gameId === "g_household")).toMatchObject({ effect: "void" });
    expect(stakesOf(nodes, "g_market")).toContain("g_household");
  });

  it("a coupling pointing at a missing game is a dangling ref", () => {
    const pillar = mk("pillar", { id: "p" });
    const g = mk("game", { id: "g1", parent_id: "p", content: { name: "g", win_condition: "w", lose_condition: "l", couples: [{ to: "g_ghost", when: "lost", effect: "void" }] } });
    expect(refsOf(g)).toContain("g_ghost");
    expect(validate([pillar, g]).map((i) => i.rule)).toContain("dangling_ref");
  });

  // [EXP:preconditions] — the unearned-resource lint.
  it("flags a win that spends an unestablished state precondition, and clears once an earlier beat establishes it", () => {
    const pillar = mk("pillar", { id: "p" });
    const wf = mk("world_fact", { id: "w1", content: { name: "redemption", mechanism: "pay → free" } });
    const game = mk("game", { id: "g", parent_id: "p", content: { name: "redemption", win_condition: "pay from fund", lose_condition: "stay owned", governing_rules: ["w1"], win_requires: [{ type: "rule", what: "redemption frees" }, { type: "state", what: "fund ≥ price", key: "fund_sufficient" }] } });
    const m = mk("act", { id: "m", parent_id: "p" });
    const b1 = mk("beat", { id: "b1", parent_id: "m", position: 0, content: { plays: ["g"] } });
    const b2 = mk("beat", { id: "b2", parent_id: "m", position: 1, content: { plays: ["g"], resolves: [{ ref: "g", outcome: "won" }] } });
    // resolving beat spends "fund_sufficient" but nothing established it → illegal_resolution
    expect(validate([pillar, wf, game, m, b1, b2]).map((i) => i.rule)).toContain("illegal_resolution");
    // establish it in an EARLIER beat → clean
    const b1ok = mk("beat", { id: "b1", parent_id: "m", position: 0, content: { plays: ["g"], establishes: ["fund_sufficient"] } });
    expect(validate([pillar, wf, game, m, b1ok, b2]).map((i) => i.rule)).not.toContain("illegal_resolution");
    // establishing it only AT/AFTER the resolving beat is still illegal (can't spend what's not yet acquired)
    const b2late = mk("beat", { id: "b2", parent_id: "m", position: 1, content: { plays: ["g"], establishes: ["fund_sufficient"], resolves: [{ ref: "g", outcome: "won" }] } });
    expect(validate([pillar, wf, game, m, b1, b2late]).map((i) => i.rule)).toContain("illegal_resolution");
  });
});

describe("climax grounding (the win must fire a world rule)", () => {
  const wf = (id: string) => mk("world_fact", { id, content: { name: "manumission", rule: "a slave may redeem themselves", mechanism: "pay full redemption → contract self-held" } });
  const scene = (id: string, pos: number, grounds?: string[]) => mk("scene", { id, parent_id: "b", position: pos, content: { value_shift: vs("up"), grounds_in: grounds } });

  it("flags an ungrounded resolution scene when the world has rules", () => {
    const m = mk("act", { id: "m" }); const b = mk("beat", { id: "b", parent_id: "m" });
    const nodes = [m, b, wf("w1"), scene("s1", 0, ["w1"]), scene("s2", 1)]; // last scene grounds in nothing
    expect(validate(nodes).map((i) => i.rule)).toContain("ungrounded_climax");
  });

  it("a grounded resolution passes, and editing the rule marks the scene stale", () => {
    const m = mk("act", { id: "m" }); const b = mk("beat", { id: "b", parent_id: "m" });
    const rule = wf("w1");
    let s = scene("s1", 0, ["w1"]);
    const nodes = [m, b, rule, s];
    expect(validate(nodes).map((i) => i.rule)).not.toContain("ungrounded_climax");
    expect(refsOf(s)).toContain("w1");
    s = stampInput(s, byId([rule, s]));
    const rule2 = editContent(rule, { mechanism: "redemption requires the holder's signature" });
    expect(isStale(s, byId([rule2, s]))).toBe(true); // grounding rule changed → scene stale
  });

  it("no grounding lint when the world has no rules", () => {
    const m = mk("act", { id: "m" }); const b = mk("beat", { id: "b", parent_id: "m" });
    expect(validate([m, b, scene("s1", 0)]).map((i) => i.rule)).not.toContain("ungrounded_climax");
  });
});

describe("pacing axis (target_pct vs derived position)", () => {
  it("derives each act's turn-position from cumulative words and flags drift past tolerance", () => {
    const m = mk("act", { id: "m", parent_id: "p", position: 0, content: { target_pct: 0.25 } });
    const b = mk("beat", { id: "b", parent_id: "m" });
    // this single act contains all scenes → its turn lands at 100%, far from a 25% target
    const s1 = mk("scene", { id: "s1", parent_id: "b", position: 0, content: { value_shift: vs("up"), prose: { words: 500 } } });
    const s2 = mk("scene", { id: "s2", parent_id: "b", position: 1, content: { value_shift: vs("down"), prose: { words: 500 } } });
    const pts = pacing([m, b, s1, s2]);
    expect(pts[0].actualPct).toBeCloseTo(1.0);
    expect(pts[0].driftPct).toBeCloseTo(0.75);
    expect(validate([m, b, s1, s2]).map((i) => i.rule)).toContain("pacing_drift");
  });

  it("no drift lint when target_pct is unset", () => {
    const m = mk("act", { id: "m", parent_id: "p" });
    const b = mk("beat", { id: "b", parent_id: "m" });
    const s = mk("scene", { id: "s", parent_id: "b", content: { value_shift: vs("up") } });
    expect(validate([m, b, s]).map((i) => i.rule)).not.toContain("pacing_drift");
  });
});

describe("emotional-topography axis (value_shift polarity)", () => {
  it("returns polarity in reading order and flags a sagging run of same-polarity scenes", () => {
    const nodes = spine([vs("up"), vs("up"), vs("up"), vs("up")].map((v) => ({ value_shift: v })));
    expect(topography(nodes).map((t) => t.polarity)).toEqual(["up", "up", "up", "up"]);
    expect(validate(nodes).map((i) => i.rule)).toContain("sagging_middle");
  });

  it("an oscillating sequence does not sag", () => {
    const nodes = spine([vs("up"), vs("down"), vs("up"), vs("down")].map((v) => ({ value_shift: v })));
    expect(validate(nodes).map((i) => i.rule)).not.toContain("sagging_middle");
  });
});

describe("causality axis (why — the causal spine)", () => {
  // a act with N beats carrying causal metadata (needs/establishes/connector/polarity)
  const beatSpine = (beats: Record<string, unknown>[]): DnaNode[] => {
    const m = mk("act", { id: "m", parent_id: "p", position: 0 });
    const bs = beats.map((c, i) => mk("beat", { id: `b${i}`, parent_id: "m", position: i, content: c }));
    return [m, ...bs];
  };

  it("a 'therefore' whose need is established upstream is caused (no lint)", () => {
    const nodes = beatSpine([
      { polarity: "up", establishes: ["ledger_settled"] },
      { connector: "therefore", polarity: "down", needs: ["ledger_settled"] },
    ]);
    const c = causality(nodes);
    expect(c[1].unmet).toEqual([]);
    expect(validate(nodes).map((i) => i.rule)).not.toContain("uncaused_therefore");
  });

  it("flags a 'therefore' whose need no earlier beat establishes (hollow link)", () => {
    const nodes = beatSpine([
      { polarity: "up" },
      { connector: "therefore", polarity: "down", needs: ["peculium_known"] },
    ]);
    expect(causality(nodes)[1].unmet).toEqual(["peculium_known"]);
    expect(validate(nodes).map((i) => i.rule)).toContain("uncaused_therefore");
  });

  it("a beat cannot satisfy its own need (establishes is checked after needs)", () => {
    const nodes = beatSpine([
      { polarity: "up" },
      { connector: "therefore", polarity: "down", needs: ["x"], establishes: ["x"] },
    ]);
    expect(validate(nodes).map((i) => i.rule)).toContain("uncaused_therefore");
  });

  it("flags an empty 'but' that neither reverses charge nor consumes a state", () => {
    const nodes = beatSpine([
      { polarity: "up" },
      { connector: "but", polarity: "up" }, // same polarity, no needs → turns nothing
    ]);
    expect(validate(nodes).map((i) => i.rule)).toContain("empty_but");
  });

  it("the opening beat is exempt — therefore/but are antecedent-relative (no prior to link to)", () => {
    const nodes = beatSpine([
      { connector: "but", polarity: "down" }, // beat 0: no prior beat, no needs — must NOT lint
      { connector: "therefore", polarity: "up", needs: ["x"] },
    ]);
    expect(validate(nodes).map((i) => i.rule)).not.toContain("empty_but");
  });

  it("a 'but' that reverses the charge is not empty", () => {
    const nodes = beatSpine([
      { polarity: "up" },
      { connector: "but", polarity: "down" },
    ]);
    expect(validate(nodes).map((i) => i.rule)).not.toContain("empty_but");
  });

  it("a 'but' that consumes an established state is not empty even without a reversal", () => {
    const nodes = beatSpine([
      { polarity: "up", establishes: ["rumor"] },
      { connector: "but", polarity: "up", needs: ["rumor"] },
    ]);
    expect(validate(nodes).map((i) => i.rule)).not.toContain("empty_but");
  });
});


describe("meters axis (docs/novel-dna-meters.md)", () => {
  // A small spine: pillar → one act → N beats, each carrying a reading on meter "cm" (comedy).
  const spine = (values: (number | null)[]) => {
    const pillar = mk("pillar", { id: "p" });
    const mv = mk("act", { id: "mv", parent_id: "p", position: 0 });
    const beats = values.map((v, i) =>
      mk("beat", { id: `b${i}`, parent_id: "mv", position: i, content: v == null ? {} : { readings: [{ ref: "cm", value: v }] } }));
    return [pillar, mv, ...beats];
  };
  const meter = (over: Record<string, unknown> = {}) => mk("meter", { id: "cm", parent_id: "p", content: { name: "comedy", kind: "comedy", ...over } });

  it("meterSeries plots the readings over the beat spine, carry-forward filling gaps", () => {
    const nodes = [meter(), ...spine([10, null, 40, null])];
    expect(meterSeries(nodes, "cm").map((p) => p.value)).toEqual([10, 10, 40, 40]); // gaps HOLD, not 0
  });

  it("a leading gap before the first reading is null (nothing to hold yet)", () => {
    const nodes = [meter(), ...spine([null, 30, 30])];
    expect(meterSeries(nodes, "cm").map((p) => p.value)).toEqual([null, 30, 30]);
  });

  it("meterShape reports range, oscillations, longest flat run, terminal value", () => {
    const s1 = meterShape(meterSeries([meter(), ...spine([10, 50, 20, 20, 20, 60])], "cm"));
    expect(s1.range).toBe(50);        // 60 - 10
    expect(s1.oscillations).toBe(2);  // up→down, down→up
    expect(s1.flatRun).toBe(3);       // 20,20,20
    expect(s1.last).toBe(60);
  });

  it("isSerialMeter is true only once ≥2 readings exist", () => {
    expect(isSerialMeter([meter(), ...spine([10])], "cm")).toBe(false);
    expect(isSerialMeter([meter(), ...spine([10, 20])], "cm")).toBe(true);
  });

  it("flat_meter fires on a long flat run; clean when the meter moves", () => {
    const flat = validate([meter(), ...spine([20, 20, 20, 20])]);
    expect(flat.some((i) => i.rule === "flat_meter")).toBe(true);
    const moving = validate([meter(), ...spine([20, 40, 20, 50])]);
    expect(moving.some((i) => i.rule === "flat_meter")).toBe(false);
  });

  it("no_oscillation fires on a monotone climb (≥4 readings, never reverses)", () => {
    const mono = validate([meter(), ...spine([10, 20, 30, 40])]);
    expect(mono.some((i) => i.rule === "no_oscillation")).toBe(true);
  });

  it("no_jeopardy fires on a game_score that never nears its losing pole", () => {
    const safe = validate([meter({ kind: "game_score", scale: { min: 0, max: 100 } }), ...spine([80, 90, 70, 95])]);
    expect(safe.some((i) => i.rule === "no_jeopardy")).toBe(true);
    const risky = validate([meter({ kind: "game_score", scale: { min: 0, max: 100 } }), ...spine([80, 10, 70, 95])]);
    expect(risky.some((i) => i.rule === "no_jeopardy")).toBe(false);
  });

  it("a meter with no readings yet is silent (early, not wrong)", () => {
    const issues = validate([meter(), ...spine([null, null])]);
    expect(issues.some((i) => i.rule.startsWith("flat") || i.rule.startsWith("no_"))).toBe(false);
  });

  it("refsOf surfaces a beat's reading refs and a meter's owner (so dangling_ref + staleness see them)", () => {
    const beat = mk("beat", { id: "b", content: { readings: [{ ref: "cm", value: 5 }] } });
    expect(refsOf(beat)).toContain("cm");
    const owned = mk("meter", { id: "m", content: { name: "hope", owner: "char1" } });
    expect(refsOf(owned)).toContain("char1");
  });

  // ── target curve (the INTENT layer) + plan-vs-intent diff (Diff A) ──
  it("meterTarget linearly interpolates the sparse target keyframes across the beat spine", () => {
    // 5 beats sit at fractions 0, .25, .5, .75, 1; a 0→100 ramp samples to 0,25,50,75,100.
    const nodes = [meter({ target: [{ at: 0, value: 0 }, { at: 1, value: 100 }] }), ...spine([0, 0, 0, 0, 0])];
    expect(meterTarget(nodes, "cm").map((p) => p.value)).toEqual([0, 25, 50, 75, 100]);
  });

  it("meterTarget clamps flat beyond the first/last keyframe (a single keyframe = a constant target)", () => {
    const nodes = [meter({ target: [{ at: 0.5, value: 60 }] }), ...spine([0, 0, 0])];
    expect(meterTarget(nodes, "cm").map((p) => p.value)).toEqual([60, 60, 60]);
  });

  it("meterTarget is null at every beat when the meter has no target (nothing to aim at)", () => {
    const nodes = [meter(), ...spine([10, 20, 30])];
    expect(meterTarget(nodes, "cm").every((p) => p.value === null)).toBe(true);
  });

  it("targetGap diffs the plan (readings) against the intent (target curve), flagging the worst beat", () => {
    const target = [{ at: 0, value: 0 }, { at: 1, value: 100 }]; // → 0,25,50,75,100
    const onPlan = [meter({ target }), ...spine([0, 25, 50, 75, 100])];
    expect(targetGap(onPlan, "cm").maxAbs).toBe(0);
    const drift = [meter({ target }), ...spine([0, 25, 50, 75, 40])]; // last beat lands at 40, wants 100
    const gap = targetGap(drift, "cm");
    expect(gap.maxAbs).toBe(60);
    expect(gap.worstBeatId).toBe("b4");
  });

  it("target_drift fires when the plan strays beyond the band of scale; silent on-target / no target / no readings", () => {
    const target = [{ at: 0, value: 0 }, { at: 1, value: 100 }];
    const scale = { min: 0, max: 100 }; // band = 20% → 20
    const drift = validate([meter({ scale, target }), ...spine([0, 25, 50, 75, 40])]);
    expect(drift.some((i) => i.rule === "target_drift")).toBe(true);
    const onTarget = validate([meter({ scale, target }), ...spine([0, 25, 50, 75, 100])]);
    expect(onTarget.some((i) => i.rule === "target_drift")).toBe(false);
    const noTarget = validate([meter({ scale }), ...spine([0, 25, 50, 75, 40])]);
    expect(noTarget.some((i) => i.rule === "target_drift")).toBe(false);
    const noReadings = validate([meter({ scale, target }), ...spine([null, null, null, null, null])]);
    expect(noReadings.some((i) => i.rule === "target_drift")).toBe(false);
  });

  // ── observed trace (the editor's read) + observed-vs-plan diff (Diff B) ──
  // A spine carrying BOTH planned readings and observed readings on "cm" per beat.
  const dualSpine = (planned: (number | null)[], observed: (number | null)[]) => {
    const pillar = mk("pillar", { id: "p" });
    const mv = mk("act", { id: "mv", parent_id: "p", position: 0 });
    const beats = planned.map((v, i) => {
      const content: Record<string, unknown> = {};
      if (v != null) content.readings = [{ ref: "cm", value: v }];
      if (observed[i] != null) content.observed_readings = [{ ref: "cm", value: observed[i] }];
      return mk("beat", { id: `b${i}`, parent_id: "mv", position: i, content });
    });
    return [pillar, mv, ...beats];
  };

  it("observedSeries reads the observed_readings channel (carry-forward), independent of the plan", () => {
    const nodes = dualSpine([10, 20, 30], [5, null, 25]);
    expect(observedSeries(nodes, "cm").map((p) => p.value)).toEqual([5, 5, 25]); // gap holds
    expect(meterSeries(nodes, "cm").map((p) => p.value)).toEqual([10, 20, 30]);  // plan untouched
  });

  it("observedGap diffs observed − planned over beats where both exist, flagging the worst beat", () => {
    const gap = observedGap(dualSpine([10, 20, 30], [10, 20, 5]), "cm"); // beat 3: prose 5 vs plan 30
    expect(gap.maxAbs).toBe(25);
    expect(gap.worstBeatId).toBe("b2");
    expect(gap.perBeat[2].delta).toBe(-25); // under-delivers
  });

  it("read_gap fires when the prose departs from the plan beyond the band; silent on-plan / before a read", () => {
    const scale = { min: 0, max: 100 }; // band = 20
    const off = validate([meter({ scale }), ...dualSpine([50, 60, 70], [50, 60, 20])]);
    expect(off.some((i) => i.rule === "read_gap")).toBe(true);
    const onPlan = validate([meter({ scale }), ...dualSpine([50, 60, 70], [50, 60, 70])]);
    expect(onPlan.some((i) => i.rule === "read_gap")).toBe(false);
    const noRead = validate([meter({ scale }), ...spine([50, 60, 70])]); // no observed_readings yet
    expect(noRead.some((i) => i.rule === "read_gap")).toBe(false);
  });
});

describe("continuity ledger (the prefix-sum story-so-far)", () => {
  const scn = (id: string, pos: number, facts?: { key: string; value: string }[], over: Record<string, unknown> = {}) =>
    mk("scene", { id, parent_id: "b", position: pos, content: { ...(facts ? { observed_establishes: facts } : {}), ...over } });
  const ledgerSpine = (...scenes: DnaNode[]) => {
    const pillar = mk("pillar", { id: "p" });
    const mv = mk("act", { id: "mv", parent_id: "p", position: 0 });
    const b = mk("beat", { id: "b", parent_id: "mv", position: 0 });
    return [pillar, mv, b, ...scenes];
  };

  it("ledgerBefore folds facts from PRIOR scenes only, last-write-wins (supersede)", () => {
    const nodes = ledgerSpine(
      scn("s1", 0, [{ key: "mara", value: "lot 7" }]),
      scn("s2", 1, [{ key: "door", value: "locked" }]),
      scn("s3", 2, [{ key: "door", value: "unlocked" }]), // supersedes "locked" — but only for scenes after s3
    );
    const before3 = ledgerBefore(nodes, "s3");
    expect(before3.find((f) => f.key === "mara")?.value).toBe("lot 7");
    expect(before3.find((f) => f.key === "door")?.value).toBe("locked"); // s3 isn't folded into its OWN "before"
    expect(ledgerBefore(nodes, "s2").map((f) => f.key)).toEqual(["mara"]); // door not set yet
    expect(ledgerBefore(nodes, "s1")).toEqual([]); // opening scene inherits nothing
  });

  it("ledgerFull is the whole-book canon, last-write-wins, tagged with the asserting scene", () => {
    const nodes = ledgerSpine(
      scn("s1", 0, [{ key: "mara", value: "lot 7" }]),
      scn("s2", 1, [{ key: "door", value: "locked" }]),
      scn("s3", 2, [{ key: "door", value: "unlocked" }]),
    );
    const full = ledgerFull(nodes);
    expect(full.find((f) => f.key === "door")?.value).toBe("unlocked");
    expect(full.find((f) => f.key === "door")?.sceneId).toBe("s3");
  });

  it("continuity_break lint surfaces stored contradiction flags as errors", () => {
    const nodes = ledgerSpine(
      scn("s1", 0, [{ key: "mara", value: "lot 7" }]),
      scn("s2", 1, undefined, { continuity_flags: [{ key: "mara", was: "lot 7", now: "lot 9" }] }),
    );
    const breaks = validate(nodes).filter((i) => i.rule === "continuity_break");
    expect(breaks).toHaveLength(1);
    expect(breaks[0].severity).toBe("error");
    expect(breaks[0].nodeId).toBe("s2");
  });

  it("ledger output fields don't stale a scene's prose (output, not plan input)", () => {
    let s = mk("scene", { id: "s", parent_id: "b", position: 0, content: { goal: "g", prose: { text: "the words on the page" } } });
    s = stampProse(s);
    const withFacts = { ...s, content: { ...s.content, observed_establishes: [{ key: "mara", value: "lot 7" }], continuity_flags: [{ key: "x", was: "a", now: "b" }] } };
    expect(isProseStale(withFacts)).toBe(false);
  });

  it("a meter read on a beat (observed_readings) does not stale the scenes under it", () => {
    const pillar = mk("pillar", { id: "p" });
    const mv = mk("act", { id: "mv", parent_id: "p", position: 0 });
    const b = mk("beat", { id: "b", parent_id: "mv", position: 0, content: { summary: "x" } });
    let s = mk("scene", { id: "s", parent_id: "b", position: 0, content: { goal: "g" } });
    s = stampInput(s, byId([pillar, mv, b, s]));
    const b2 = { ...b, content: { ...b.content, observed_readings: [{ ref: "cm", value: 5 }] } };
    expect(isStale(s, byId([pillar, mv, b2, s]))).toBe(false); // the beat's OUTPUT field is stripped from the child's input hash
  });
});

describe("prose lints (deterministic read layer)", () => {
  const spine = (...scenes: DnaNode[]): DnaNode[] => {
    const m = mk("act", { id: "pm" });
    const b = mk("beat", { id: "pb", parent_id: "pm", content: { summary: "x" } });
    return [m, b, ...scenes];
  };
  const scn = (id: string, pos: number, prose?: string, over: Record<string, unknown> = {}) =>
    mk("scene", { id, parent_id: "pb", position: pos, content: {
      value_shift: { value: "hope", from: "-", to: "+", polarity: pos % 2 ? "up" : "down" },
      ...(prose !== undefined ? { prose: { text: prose } } : {}), ...over } });
  const rulesOf = (nodes: DnaNode[], cfg = DEFAULT_LINT_CONFIG) => proseLints(nodes, cfg).map((i) => i.rule);

  // Reusable planted faults.
  const ECHO_A = "The copper weathervane spun over marshland."; // shares exactly ONE distinctive 5-gram…
  const ECHO_B = "She remembered the copper weathervane spun over water."; // …("the copper weathervane spun over")
  const FLAT_8 = "Mara walked to the door. Rain hammered on the glass. She counted every grey step. The lamp guttered in silence. Something moved behind the curtain. Her hands would not settle. The clock ticked past midnight. Nobody answered her second knock."; // 8 sentences × 5 words → CV 0
  const SOUP_PAIR = "Mara watched Okonkwo pace. Mara told Okonkwo that Mara would carry the lantern north again."; // 15 words, 5 name hits
  const DLG_1 = '"Where is it?" she asked.\n"Gone," he said.';
  const DLG_2 = '"You promised me," she said.\n"I lied," he said.';
  const DLG_3 = '"Open the box," she said.\n"No," he said.';

  it("a prose-less book produces no prose lints at all (skip-empty = early, not wrong)", () => {
    expect(proseLints(spine(scn("u1", 0), scn("u2", 1), scn("u3", 2)), DEFAULT_LINT_CONFIG)).toEqual([]);
  });

  it("prose_echo: one distinctive 5-gram shared with the PREVIOUS scene flags the later scene", () => {
    const hits = proseLints(spine(scn("e1", 0, ECHO_A), scn("e2", 1, ECHO_B)), DEFAULT_LINT_CONFIG).filter((i) => i.rule === "prose_echo");
    expect(hits).toHaveLength(1);
    expect(hits[0].nodeId).toBe("e2");
    expect(hits[0].message).toContain('"the copper weathervane spun over"');
    expect(hits[0].message).toContain("from scene 1");
  });

  it("prose_echo: the same single echo two scenes apart stays under the distant floor (≥2)", () => {
    const nodes = spine(scn("e1", 0, ECHO_A), scn("e2", 1, "Nothing here resembles anything elsewhere tonight."), scn("e3", 2, ECHO_B));
    expect(rulesOf(nodes)).not.toContain("prose_echo");
  });

  it("prose_echo: a phrase from the scene's own location palette is exempt (facet echo is deliberate craft)", () => {
    const loc = mk("location", { id: "ploc", content: { name: "The Marsh", sight: "the copper weathervane spun over" } });
    const nodes = [loc, ...spine(scn("e1", 0, ECHO_A, { loc: "ploc" }), scn("e2", 1, ECHO_B, { loc: "ploc" }))];
    expect(rulesOf(nodes)).not.toContain("prose_echo");
  });

  it("monotone_rhythm: 8 equal-length sentences fire, with CV and mean in the message", () => {
    const hits = proseLints(spine(scn("r1", 0, FLAT_8)), DEFAULT_LINT_CONFIG).filter((i) => i.rule === "monotone_rhythm");
    expect(hits).toHaveLength(1);
    expect(hits[0].nodeId).toBe("r1");
    expect(hits[0].message).toContain("CV 0.00");
    expect(hits[0].message).toContain("mean 5.0");
  });

  it("monotone_rhythm: the same flat cadence under rhythmMinSentences stays silent", () => {
    const seven = FLAT_8.split(". ").slice(0, 7).join(". ") + "."; // 7 sentences < the 8 floor
    expect(rulesOf(spine(scn("r1", 0, seven)))).not.toContain("monotone_rhythm");
  });

  it("name_soup: dense first-name mentions over a ≥150-word scene fire and name the worst offender", () => {
    const c1 = mk("character", { id: "pc1", content: { name: "Mara Voss" } });
    const c2 = mk("character", { id: "pc2", content: { name: "Okonkwo" } });
    const soup = Array.from({ length: 12 }, () => SOUP_PAIR).join(" "); // 180 words, 60 name hits → 33.3/100
    const hits = proseLints([c1, c2, ...spine(scn("n1", 0, soup))], DEFAULT_LINT_CONFIG).filter((i) => i.rule === "name_soup");
    expect(hits).toHaveLength(1);
    expect(hits[0].nodeId).toBe("n1");
    expect(hits[0].message).toContain('"Mara" leads');
  });

  it("name_soup: the same density under 150 words stays silent (too short to judge)", () => {
    const c1 = mk("character", { id: "pc1", content: { name: "Mara Voss" } });
    const c2 = mk("character", { id: "pc2", content: { name: "Okonkwo" } });
    const short = Array.from({ length: 9 }, () => SOUP_PAIR).join(" "); // 135 words — same density, under the floor
    expect(rulesOf([c1, c2, ...spine(scn("n1", 0, short))])).not.toContain("name_soup");
  });

  it("dialogue_flatline: three all-dialogue scenes in a row flag the FIRST scene of the run", () => {
    const hits = proseLints(spine(scn("d1", 0, DLG_1), scn("d2", 1, DLG_2), scn("d3", 2, DLG_3)), DEFAULT_LINT_CONFIG).filter((i) => i.rule === "dialogue_flatline");
    expect(hits).toHaveLength(1);
    expect(hits[0].nodeId).toBe("d1");
    expect(hits[0].message).toContain("3 scenes in a row");
    expect(hits[0].message).toContain("≥90% dialogue");
  });

  it("dialogue_flatline: a narration scene breaks the run (no 3-run of either extreme)", () => {
    const nodes = spine(scn("d1", 0, DLG_1), scn("d2", 1, "She crossed the yard without a word to anyone there."), scn("d3", 2, DLG_3));
    expect(rulesOf(nodes)).not.toContain("dialogue_flatline");
  });

  it("config override flips an outcome: dialogueRunLen 3→5 silences a 3-run", () => {
    const nodes = spine(scn("d1", 0, DLG_1), scn("d2", 1, DLG_2), scn("d3", 2, DLG_3));
    expect(rulesOf(nodes)).toContain("dialogue_flatline");
    expect(rulesOf(nodes, { ...DEFAULT_LINT_CONFIG, dialogueRunLen: 5 })).not.toContain("dialogue_flatline");
  });

  it("validate() carries the prose lints (wired into the every-read pass)", () => {
    const rules = validate(spine(scn("e1", 0, ECHO_A), scn("e2", 1, ECHO_B))).map((i) => i.rule);
    expect(rules).toContain("prose_echo");
  });
});

describe("obligation ledger (the debt view) + the completion predicate", () => {
  // One spine, every debt kind exercised. Scenes s0..s3 in reading order under two beats.
  const spine = () => {
    const pillar = mk("pillar", { id: "p" });
    const act = mk("act", { id: "a", parent_id: "p", position: 0 });
    const b1 = mk("beat", { id: "b1", parent_id: "a", position: 0, content: { establishes: ["key_earned"], plays: ["gm_open"] } });
    const b2 = mk("beat", { id: "b2", parent_id: "a", position: 1, content: { needs: ["key_earned", "key_unmet"], plays: ["gm_closed"], resolves: [{ ref: "gm_closed", outcome: "won" }] } });
    return { pillar, act, b1, b2 };
  };
  const scene = (id: string, parent: string, pos: number, content: Record<string, unknown> = {}) =>
    mk("scene", { id, parent_id: parent, position: pos, content });
  const row = (rows: Obligation[], id: string) => rows.find((o) => o.id === id);

  const book = (): DnaNode[] => {
    const { pillar, act, b1, b2 } = spine();
    return [pillar, act, b1, b2,
      // threads: paid / held open / never planted / waived-unplanted
      mk("thread", { id: "th_paid", parent_id: "p", content: { name: "paid", promise: "answered" } }),
      mk("thread", { id: "th_open", parent_id: "p", content: { name: "held", promise: "still owed" } }),
      mk("thread", { id: "th_reg", parent_id: "p", content: { name: "registry-only" } }),
      mk("thread", { id: "th_waived", parent_id: "p", content: { name: "sequel hook", waived: true } }),
      // a proposed (not accepted) thread must create NO row
      mk("thread", { id: "th_proposed", parent_id: "p", authoring: { source: "ai", locked: false, status: "proposed" } }),
      mk("game", { id: "gm_open", parent_id: "p", content: { name: "open contest", stake: "everything" } }),
      mk("game", { id: "gm_closed", parent_id: "p", content: { name: "decided contest" } }),
      mk("game", { id: "gm_reg", parent_id: "p", content: { name: "never played" } }),
      mk("tentpole", { id: "tp_placed", parent_id: "p", content: { summary: "the plaza folds" } }),
      mk("tentpole", { id: "tp_unplaced", parent_id: "p", content: { summary: "the flood" } }),
      mk("character", { id: "ch_met", parent_id: "p", content: { name: "Mara" } }),
      mk("character", { id: "ch_unmet", parent_id: "p", content: { name: "Ghost" } }),
      mk("location", { id: "lc_seen", parent_id: "p", content: { name: "Harbor" } }),
      scene("s0", "b1", 0, { threads: [{ ref: "th_paid", role: "setup" }, { ref: "th_open", role: "setup" }], pov: "ch_met", loc: "lc_seen" }),
      scene("s1", "b1", 1, { threads: [{ ref: "th_paid", role: "advance" }, { ref: "th_open", role: "advance" }], present: ["ch_met"] }),
      scene("s2", "b2", 0, { threads: [{ ref: "th_paid", role: "payoff" }], realizes_tentpole: "tp_placed" }),
    ];
  };

  it("threads: setup opens, payoff closes, advance counts as progress; registry-only stays unopened", () => {
    const rows = obligationLedger(book());
    expect(row(rows, "thread:th_paid")).toMatchObject({ state: "closed", openedAt: 0, closedAt: 2, touches: 1 });
    expect(row(rows, "thread:th_open")).toMatchObject({ state: "open", openedAt: 0, closedAt: null, touches: 1 });
    expect(row(rows, "thread:th_reg")).toMatchObject({ state: "unopened", openedAt: null });
    expect(row(rows, "thread:th_waived")?.state).toBe("waived");
    expect(row(rows, "thread:th_proposed")).toBeUndefined();
  });

  it("a payoff with no prior setup settles nothing (the unearned payoff stays unopened)", () => {
    const { pillar, act, b1 } = spine();
    const nodes = [pillar, act, b1,
      mk("thread", { id: "th_unearned", parent_id: "p", content: { name: "unearned" } }),
      scene("s0", "b1", 0, { threads: [{ ref: "th_unearned", role: "payoff" }] })];
    expect(row(obligationLedger(nodes), "thread:th_unearned")?.state).toBe("unopened");
  });

  it("games: plays opens, resolves closes; an accepted game never on the spine stays unopened", () => {
    const rows = obligationLedger(book());
    expect(row(rows, "game:gm_open")).toMatchObject({ state: "open", openedAt: 0, closedAt: null, touches: 1 });
    expect(row(rows, "game:gm_closed")).toMatchObject({ state: "closed", openedAt: 1, closedAt: 1 });
    expect(row(rows, "game:gm_reg")).toMatchObject({ state: "unopened", touches: 0 });
    expect(row(rows, "game:gm_open")?.promise).toBe("everything");
  });

  it("state keys: closed when deposited upstream of the spend, open when unmet (deposit precedes spend)", () => {
    const rows = obligationLedger(book());
    expect(row(rows, "state_key:key_earned")).toMatchObject({ state: "closed", openedAt: 1, closedAt: 0, touches: 1 });
    expect(row(rows, "state_key:key_unmet")).toMatchObject({ state: "open", closedAt: null });
  });

  it("tentpoles + entity intros: paid on first appearance, owed while the page never shows them", () => {
    const rows = obligationLedger(book());
    expect(row(rows, "tentpole:tp_placed")).toMatchObject({ state: "closed", closedAt: 2 });
    expect(row(rows, "tentpole:tp_unplaced")?.state).toBe("unopened");
    expect(row(rows, "entity_intro:ch_met")).toMatchObject({ state: "closed", closedAt: 0, touches: 2 }); // pov s0 + present s1
    expect(row(rows, "entity_intro:ch_unmet")?.state).toBe("unopened");
    expect(row(rows, "entity_intro:lc_seen")).toMatchObject({ state: "closed", touches: 1 });
  });

  it("openObligations lists exactly the outstanding debt; debtSettled is the quiescence gate", () => {
    const nodes = book();
    const open = openObligations(nodes).map((o) => o.id).sort();
    expect(open).toEqual(["entity_intro:ch_unmet", "game:gm_open", "game:gm_reg", "state_key:key_unmet", "tentpole:tp_unplaced", "thread:th_open", "thread:th_reg"]);
    expect(debtSettled(nodes)).toBe(false);
  });

  it("debtSettled flips true once every promise is paid or waived", () => {
    const { pillar, act, b1 } = spine();
    const nodes = [pillar, act, b1,
      mk("thread", { id: "th", parent_id: "p", content: { name: "t" } }),
      mk("thread", { id: "th_carry", parent_id: "p", content: { name: "hook", waived: true } }),
      scene("s0", "b1", 0, { threads: [{ ref: "th", role: "setup" }] }),
      scene("s1", "b1", 1, { threads: [{ ref: "th", role: "payoff" }] })];
    expect(debtSettled(nodes)).toBe(true);
    expect(obligationLedger(nodes).map((o) => o.state).sort()).toEqual(["closed", "waived"]);
  });

  it("an empty tree carries no debt (vacuously settled — nothing was ever promised)", () => {
    expect(obligationLedger([])).toEqual([]);
    expect(debtSettled([])).toBe(true);
  });
});
