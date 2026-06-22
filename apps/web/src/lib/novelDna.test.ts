import { describe, expect, it } from "vitest";
import {
  blastRadius, byId, chapters, chooseProposal, editContent, emptyNode, enforcePromiseSchedule, inputHash,
  isProseStale, isRenderable, isStale, lock, pacing, refsOf, renderBlockers, renderPages, scenesInOrder,
  stampInput, stampProse, topography, validate, type DnaNode, type NodeKind, type ThreadRef,
} from "@/lib/novelDna";

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
    const m1 = mk("movement", { id: "m1", parent_id: "p", position: 0 });
    const m2 = mk("movement", { id: "m2", parent_id: "p", position: 1 });
    const b1 = mk("beat", { id: "b1", parent_id: "m1", position: 0 });
    const b2 = mk("beat", { id: "b2", parent_id: "m1", position: 1 });
    const b3 = mk("beat", { id: "b3", parent_id: "m2", position: 0 });
    const char = mk("character", { id: "c", parent_id: "p" }); // entity — must NOT appear
    const s = (id: string, p: string, pos: number) => mk("scene", { id, parent_id: p, position: pos });
    const nodes = [pillar, m1, m2, b1, b2, b3, char, s("s1", "b1", 0), s("s2", "b1", 1), s("s3", "b2", 0), s("s4", "b3", 0)];
    expect(scenesInOrder(nodes).map((n) => n.id)).toEqual(["s1", "s2", "s3", "s4"]);
  });

  it("chapters partition scenes by chapter_start, with an implicit opening", () => {
    const m = mk("movement", { id: "m" });
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
    const m = mk("movement", { id: "m" });
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

describe("pure edits", () => {
  it("editContent promotes an empty slot to a user draft; an AI node becomes ai_then_user", () => {
    const empty = emptyNode(1, "pillar", 2, null);
    const edited = editContent(empty, { ending: "they part" });
    expect(edited.authoring.status).toBe("draft");
    expect(edited.authoring.source).toBe("user");

    const ai = mk("scene", { authoring: { source: "ai", locked: false, status: "accepted" } });
    expect(editContent(ai, { goal: "x" }).authoring.source).toBe("ai_then_user");
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
    const m = mk("movement", { id: "m", parent_id: "p" });
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
    const m = mk("movement", { id: "m" });
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

  it("a well-formed beat chain and placed tentpole produce no errors", () => {
    const m = mk("movement", { id: "m" });
    const b1 = mk("beat", { id: "b1", parent_id: "m", position: 0, content: { summary: "a" } });
    const b2 = mk("beat", { id: "b2", parent_id: "m", position: 1, content: { summary: "b", connector: "therefore" } });
    const tent = mk("tentpole", { id: "t", authoring: { source: "user", locked: true, status: "accepted" } });
    const s = mk("scene", { id: "s", parent_id: "b1", content: { value_shift: { value: "trust", from: "-", to: "+" }, realizes_tentpole: "t", goal: "g" } });
    expect(validate([m, b1, b2, tent, s]).filter((i) => i.severity === "error")).toHaveLength(0);
  });
});

describe("render completeness", () => {
  const settings = { title: "Book", author: "Me", word_target: 50000 };
  it("blocks on missing settings and unwritten scenes; clears when all scenes have accepted prose", () => {
    const m = mk("movement", { id: "m" });
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
// A reusable spine: pillar → movement → beat → scenes s1..s4 in reading order.
const spine = (sceneContent: Record<string, unknown>[], extra: DnaNode[] = []): DnaNode[] => {
  const m = mk("movement", { id: "m", parent_id: "p", position: 0 });
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
    const m = mk("movement", { id: "m" });
    const b = mk("beat", { id: "b", parent_id: "m" });
    const tA = mk("thread", { id: "a" }); const tB = mk("thread", { id: "b" });
    const scenes = items.map((it, i) => mk("scene", { id: `s${i}`, parent_id: "b", position: i, content: { value_shift: vs("up"), threads: it.threads } }));
    const rules = validate([m, b, tA, tB, ...scenes]).map((r) => r.rule);
    expect(rules).not.toContain("unearned_payoff");
    expect(rules).not.toContain("misordered_payoff");
  });
});

describe("pacing axis (target_pct vs derived position)", () => {
  it("derives each movement's turn-position from cumulative words and flags drift past tolerance", () => {
    const m = mk("movement", { id: "m", parent_id: "p", position: 0, content: { target_pct: 0.25 } });
    const b = mk("beat", { id: "b", parent_id: "m" });
    // this single movement contains all scenes → its turn lands at 100%, far from a 25% target
    const s1 = mk("scene", { id: "s1", parent_id: "b", position: 0, content: { value_shift: vs("up"), prose: { words: 500 } } });
    const s2 = mk("scene", { id: "s2", parent_id: "b", position: 1, content: { value_shift: vs("down"), prose: { words: 500 } } });
    const pts = pacing([m, b, s1, s2]);
    expect(pts[0].actualPct).toBeCloseTo(1.0);
    expect(pts[0].driftPct).toBeCloseTo(0.75);
    expect(validate([m, b, s1, s2]).map((i) => i.rule)).toContain("pacing_drift");
  });

  it("no drift lint when target_pct is unset", () => {
    const m = mk("movement", { id: "m", parent_id: "p" });
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
