// THE GOLDEN TEST for the dense-tree migration (doc_1785673597000.md §5a).
//
// The claim it defends, in one line: **materializing placeholder nodes must not change one byte of what the
// model sees.** The book_nodes tree is going dense — every slot the structure template knows about becomes a
// real row with `content: {}` so the author can start from any door (character-first, world-first,
// situation-first). That converts absence from a SHAPE (no row) into a VALUE (a row that says nothing), and
// absence-as-value FAILS OPEN: every `xs.length ? render : ""` guard in the bible would flip true on
// placeholders and start emitting `- [?] {}`.
//
// So each case here builds the SAME book twice — once sparse (today's tree), once dense (tomorrow's, with
// placeholders added) — and demands identical output. This catches every block, including ones added later,
// which per-block filtering never would.
//
// Note the direction of the guarantee: this tests the RENDERERS against a live-filtered list. The line that
// does the filtering is `const live = liveNodes(nodes)` in dna-expand/index.ts — the caller. Both halves are
// needed; this file owns the half that can drift silently.
import { describe, expect, it } from "vitest";
import * as ctx from "../../../../../../supabase/functions/_shared/dna-context.ts";
import { liveNodes } from "@/features/dna/lib/novelDna";

type N = ctx.CtxNode;
const n = (kind: string, id: string, parent_id: string | null, content: Record<string, unknown> = {}, position = 0): N =>
  ({ id, parent_id, kind, position, content, authoring: { locked: false, status: "accepted" } });

// A small but real book: pillar + cast + world + location + thread + game + a 3-act arc.
function sparseBook(): N[] {
  return [
    n("pillar", "pil", null, { controlling_idea: "Belonging is built, not found." }),
    n("character", "ch1", "pil", { name: "Mara", role: "protagonist", want: "to belong", wound: "abandoned" }),
    n("character", "ch2", "pil", { name: "Enver", role: "antagonist", want: "order" }),
    n("world_fact", "wf1", "pil", { name: "the folding", rule: "the city rewrites itself nightly", mechanism: "survey stakes hold a street in place until dawn" }),
    n("location", "lc1", "pil", { name: "the plaza", sight: "wet slate", sound: "gulls" }),
    n("thread", "th1", "pil", { name: "the brass compass", promise: "it points at what she fears", payoff: "it points at herself" }),
    n("game", "gm1", "pil", { name: "the survey wager", win_condition: "map ratified", lose_condition: "guild seizes the survey", win_requires: [{ type: "state", key: "guild_charter", what: "the charter is in her hands" }] }),
    n("tentpole", "tp1", "pil", { name: "the plaza folds", summary: "the night the plaza folds inward" }),
    n("act", "a1", "pil", { title: "Setup", turning_point: "she takes the commission", value: { name: "safety", from: "safe", to: "exposed", polarity: "down" } }, 0),
    n("act", "a2", "pil", { title: "Confrontation", turning_point: "the plaza folds" }, 1),
    n("act", "a3", "pil", { title: "Resolution", turning_point: "she draws the map that holds" }, 2),
  ];
}

/** The same book after materialization: the placeholders the seeder would mint. */
function denseBook(): N[] {
  return [
    ...sparseBook(),
    n("character", "ch_ghost1", "pil", {}),                 // an unfilled cast slot
    n("character", "ch_ghost2", "pil", { name: "", role: "" }), // …and one that was opened then cleared
    n("world_fact", "wf_ghost", "pil", {}),
    n("location", "lc_ghost", "pil", {}),
    n("thread", "th_ghost", "pil", {}),
    n("game", "gm_ghost", "pil", {}),
    n("tentpole", "tp_ghost", "pil", {}),
  ];
}

// What the caller (dna-expand/index.ts) does: registries read the LIVE view, the arc reads raw.
const registries = (nodes: N[]) => {
  const live = liveNodes(nodes);
  const of = (k: string) => live.filter((x) => x.parent_id === "pil" && x.kind === k);
  const entities = live.filter((x) => x.parent_id === "pil" && (x.kind === "character" || x.kind === "world_fact" || x.kind === "relationship"));
  return {
    cast: ctx.castBlock(entities),
    threads: ctx.threadBlock(of("thread")),
    tentpoles: ctx.tentpoleBlock(of("tentpole")),
    worldRules: ctx.worldRulesBlock(of("world_fact")),
    locations: ctx.locationBlock(of("location")),
    games: ctx.gamesBlock(of("game")),
    preconds: ctx.precondBlock(ctx.statePreconditions(of("game"))),
  };
};

const arcOf = (nodes: N[]) => ctx.actBlock(nodes.filter((x) => x.parent_id === "pil" && x.kind === "act").sort((a, b) => (a.position ?? 0) - (b.position ?? 0)));

describe("golden: a dense tree renders the same bible as a sparse one", () => {
  it("every registry block is byte-identical", () => {
    expect(registries(denseBook())).toEqual(registries(sparseBook()));
  });

  it("the arc is byte-identical when every act is written", () => {
    expect(arcOf(denseBook())).toBe(arcOf(sparseBook()));
  });

  // The failure this whole exercise exists to prevent.
  it("no block ever emits an empty-object row or a nameless bullet", () => {
    const reg = Object.values(registries(denseBook())).join("\n");
    expect(reg + "\n" + arcOf(denseBook())).not.toContain("{}");
    // Registry bullets are `- <name> …`, so a bullet that jumps straight to punctuation lost its name.
    // (Scoped to the registries on purpose: the ARC's own format is legitimately `- [Title] turn: …`.)
    expect(reg).not.toMatch(/^- +\[/m);  // "- [role] …" — cast entry with a blank name
    expect(reg).not.toMatch(/^- *: /m);  // "- : promise" — nameless thread/game/world entry
  });

  // Guards against the test passing because the fixtures are trivially equal.
  it("the dense fixture really does add placeholders (no-op guard)", () => {
    expect(denseBook().length).toBeGreaterThan(sparseBook().length);
    expect(liveNodes(denseBook()).length).toBe(sparseBook().length);
    expect(registries(sparseBook()).cast).toContain("Mara");
  });
});

// HUNGER — the second channel (§5a-bis). The registries omit placeholders; this states the same emptiness
// once, in its own voice, so "omitted" can never be read as "finished". Aggregated counts, never ids.
describe("hunger block", () => {
  const fillsOf = (rows: { id: string; kind: string; empty: boolean }[]) =>
    new Map(rows.map((r) => [r.id, { state: r.empty ? "empty" : "filled" }]));
  const rows = [
    { id: "a1", kind: "act", empty: true }, { id: "a2", kind: "act", empty: false },
    { id: "b1", kind: "beat", empty: true }, { id: "b2", kind: "beat", empty: true },
    { id: "c1", kind: "character", empty: true },
  ];

  it("counts empties by kind and says the book does not end here", () => {
    const out = ctx.hungerBlock(rows, fillsOf(rows));
    expect(out).toContain("1 act");
    expect(out).toContain("2 beats");
    expect(out).toContain("1 character");
    expect(out).toMatch(/does NOT end/);
  });

  it("orders by the ladder, not by insertion or count", () => {
    const out = ctx.hungerBlock(rows, fillsOf(rows));
    expect(out.indexOf("1 act")).toBeLessThan(out.indexOf("2 beats"));
    expect(out.indexOf("2 beats")).toBeLessThan(out.indexOf("1 character"));
  });

  it("names no ids — it is orientation, not a work order the generator should start filling", () => {
    expect(ctx.hungerBlock(rows, fillsOf(rows))).not.toMatch(/\b(a1|b1|c1)\b/);
  });

  it("is silent when nothing is empty, so a sparse book's prompt is unchanged", () => {
    const written = rows.map((r) => ({ ...r, empty: false }));
    expect(ctx.hungerBlock(written, fillsOf(written))).toBe("");
  });
});

// The THIRD consumer class: the agent. Generation prompts hide placeholders and the arc marks them, but the
// agent's tree digest must still SHOW them — they are its work queue and it fills a slot by targeting its id.
// So the digest collapses rather than filters.
describe("agent tree digest collapses empty subtrees", () => {
  type R = ctx.DigestRow & { content: Record<string, unknown> };
  const r = (id: string, parent_id: string | null, kind: string, level: number, content: Record<string, unknown> = {}): R =>
    ({ id, parent_id, kind, level, content });

  // 1 written act, 1 empty act carrying 3 empty beats, and 3 empty beats under the written act.
  const book = (): R[] => [
    r("pil", null, "pillar", 0, { controlling_idea: "Belonging is built." }),
    r("a1", "pil", "act", 1, { title: "Setup" }),
    r("b1", "a1", "beat", 2, { summary: "she takes the commission" }),
    r("b2", "a1", "beat", 2), r("b3", "a1", "beat", 2), r("b4", "a1", "beat", 2),
    r("a2", "pil", "act", 1),
    r("b5", "a2", "beat", 2), r("b6", "a2", "beat", 2), r("b7", "a2", "beat", 2),
  ];

  const fills = (rows: R[]) => {
    const m = new Map<string, { state: string }>();
    for (const x of rows) m.set(x.id, { state: liveNodes(rows).some((l) => l.id === x.id) ? (Object.keys(x.content).length ? "filled" : "stub") : "empty" });
    return m;
  };
  const beatNo = new Map(book().filter((x) => x.kind === "beat").map((x, i) => [x.id, i + 1]));
  const digest = (rows: R[]) => ctx.treeDigestLines(rows, fills(rows), (x) => `[${x.id}] ${x.kind}: ${JSON.stringify(x.content)}`, (x) => beatNo.get(x.id));

  it("folds a run of empty siblings into ONE line, keeping every id", () => {
    const out = digest(book()).join("\n");
    expect(out).toContain("[b2, b3, b4]");
    expect(out).toContain("×3");
    expect(out).not.toContain('[b2] beat: {}');
  });

  it("drops the descendants of an empty act — the parent already says the whole subtree is blank", () => {
    const out = digest(book()).join("\n");
    expect(out).toContain("[a2]");
    for (const id of ["b5", "b6", "b7"]) expect(out).not.toContain(`[${id}]`);
  });

  it("never serializes a blank content object", () => {
    expect(digest(book()).join("\n")).not.toContain("{}");
  });

  it("keeps UI-consistent numbering — the empty run reports beats 2–4, not 1–3", () => {
    expect(digest(book()).find((l) => l.includes("[b2, b3, b4]"))).toContain("2–4");
  });

  it("is a no-op on a tree with nothing empty", () => {
    const written = book().map((x) => ({ ...x, content: { title: x.id } }));
    expect(digest(written)).toHaveLength(written.length);
  });
});

// The other half of §5a: entity registries drop empties, but the ARC keeps them and MARKS them, because acts
// are a sibling sequence where silence is not neutral. This is the start-anywhere case working.
describe("the arc keeps unwritten acts, marked", () => {
  const startedInTheMiddle = (): N[] => [
    n("pillar", "pil", null, { controlling_idea: "Belonging is built." }),
    n("act", "a1", "pil", {}, 0),
    n("act", "a2", "pil", { title: "Confrontation", turning_point: "the plaza folds" }, 1),
    n("act", "a3", "pil", {}, 2),
  ];

  it("announces the gaps rather than dropping them — the model must not read a one-act book", () => {
    const arc = arcOf(startedInTheMiddle());
    expect(arc).toContain("Confrontation");
    expect(arc).toContain("[act 1] — NOT YET WRITTEN");
    expect(arc).toContain("[act 3] — NOT YET WRITTEN");
    expect(arc).not.toContain("{}");
  });

  it("keeps the written act in its true position (2nd of 3), not renumbered to 1st", () => {
    const lines = arcOf(startedInTheMiddle()).split("\n").slice(1);
    expect(lines[1]).toContain("Confrontation");
    expect(lines).toHaveLength(3);
  });

  it("stays silent on a wholly unplanned arc — same as the sparse tree's empty string", () => {
    const blank = [n("pillar", "pil", null, {}), n("act", "a1", "pil", {}, 0), n("act", "a2", "pil", {}, 1)];
    expect(arcOf(blank)).toBe("");
  });
});
