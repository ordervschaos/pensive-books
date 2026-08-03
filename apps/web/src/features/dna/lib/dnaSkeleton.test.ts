// P2 — the seeder + tombstones (doc_1785673597000.md §6, §9.2).
// The tree goes DENSE here: the structure template's shape stops being a read-only preview and becomes real
// `book_nodes` rows, so any rung can be filled at any time. Two invariants carry the whole design:
//   1. a minted slot must still read as EMPTY (template text lives in `authoring.scaffold`, never `content`)
//   2. deleting a slot is an authorial statement — never re-minted, never re-linted
import { describe, expect, it } from "vitest";
import { seedSkeleton, waiveSlot, waivedSlots } from "@/features/dna/lib/dnaSkeleton";
import { hasOwnContent, liveNodes, validate, type DnaNode, type NodeKind } from "@/features/dna/lib/novelDna";

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
});

/** A book at the moment the author sets a controlling idea — pillar only, nothing below. */
const fresh = (): DnaNode[] => [mk("pillar", { id: "pil", content: { controlling_idea: "Belonging is built.", structure: "weiland_3act" } })];

describe("seedSkeleton", () => {
  it("mints the template's 3 acts, 9 slotted beats, and the 2-character cast floor", () => {
    const seeded = seedSkeleton(fresh(), 1);
    const byKind = (k: string) => seeded.filter((n) => n.kind === k);
    expect(byKind("act")).toHaveLength(3);
    expect(byKind("beat")).toHaveLength(9);
    expect(byKind("character")).toHaveLength(2);
  });

  // THE load-bearing invariant. If a minted slot read as filled, the fill fold would be wrong on its very
  // first row and liveNodes would stop hiding anything.
  it("every minted node still reads as EMPTY — template text never touches content", () => {
    const seeded = seedSkeleton(fresh(), 1);
    for (const n of seeded) {
      expect(n.content).toEqual({});
      expect(hasOwnContent(n)).toBe(false);
    }
    expect(seeded.find((n) => n.authoring.scaffold?.slot === "hook")?.authoring.scaffold?.title).toBe("The Hook");
  });

  it("the whole seeded book vanishes from every read path (liveNodes strips it)", () => {
    const tree = [...fresh(), ...seedSkeleton(fresh(), 1)];
    expect(liveNodes(tree).map((n) => n.id)).toEqual(["pil"]);
  });

  it("parents beats under the act their slot belongs to", () => {
    const seeded = seedSkeleton(fresh(), 1);
    const acts = seeded.filter((n) => n.kind === "act").sort((a, b) => a.position - b.position);
    const slotAct = (slot: string) => seeded.find((n) => n.authoring.scaffold?.slot === slot)?.parent_id;
    expect(slotAct("hook")).toBe(acts[0].id);       // act 1
    expect(slotAct("midpoint")).toBe(acts[1].id);   // act 2
    expect(slotAct("climax")).toBe(acts[2].id);     // act 3
  });

  describe("idempotence — it is a one-shot seeder, not a reconciler", () => {
    it("re-running over an already-seeded book mints nothing", () => {
      const tree = [...fresh(), ...seedSkeleton(fresh(), 1)];
      expect(seedSkeleton(tree, 1)).toEqual([]);
    });

    it("leaves hand-authored work alone and fills only the genuine gaps", () => {
      const tree = [
        ...fresh(),
        mk("act", { id: "mine", parent_id: "pil", position: 0, content: { title: "My Opening", goal: "commit" } }),
        mk("character", { id: "mara", parent_id: "pil", content: { name: "Mara", role: "protagonist" } }),
      ];
      const seeded = seedSkeleton(tree, 1);
      expect(seeded.filter((n) => n.kind === "character")).toHaveLength(0); // cast floor stands down
      expect(seeded.filter((n) => n.kind === "act")).toHaveLength(2);       // acts 2 and 3 only
      expect(seeded.find((n) => n.id === "mine")).toBeUndefined();
    });

    it("does not re-mint a slot a real beat already claims", () => {
      const tree = [
        ...fresh(),
        mk("act", { id: "a1", parent_id: "pil", position: 0, content: { title: "Setup" } }),
        mk("beat", { id: "b1", parent_id: "a1", content: { summary: "she takes the commission", slot: "hook" } }),
      ];
      expect(seedSkeleton(tree, 1).some((n) => n.authoring.scaffold?.slot === "hook")).toBe(false);
    });
  });

  // REGRESSION. The seeder originally required a pillar, so on a brand-new book — a seed and nothing else,
  // the single most important case to scaffold — it returned [] and the Scaffold button never even rendered.
  describe("a book that is only a seed (the fresh-book case)", () => {
    const seedOnly = (): DnaNode[] => [mk("seed", { id: "s", content: { logline: "A cartographer maps a city that rewrites itself." } })];

    it("mints the ladder spine as well as everything below it", () => {
      const seeded = seedSkeleton(seedOnly(), 1);
      expect(seeded.filter((n) => n.kind === "premise")).toHaveLength(1);
      expect(seeded.filter((n) => n.kind === "pillar")).toHaveLength(1);
      expect(seeded.filter((n) => n.kind === "act")).toHaveLength(3);
      expect(seeded.filter((n) => n.kind === "beat")).toHaveLength(9);
    });

    it("hangs the whole skeleton off the minted spine (no orphans)", () => {
      const seeded = seedSkeleton(seedOnly(), 1);
      const ids = new Set([...seedOnly(), ...seeded].map((n) => n.id));
      for (const n of seeded) expect(ids.has(n.parent_id!)).toBe(true);
      const pillar = seeded.find((n) => n.kind === "pillar")!;
      const premise = seeded.find((n) => n.kind === "premise")!;
      expect(premise.parent_id).toBe("s");
      expect(pillar.parent_id).toBe(premise.id);
      expect(seeded.filter((n) => n.kind === "act").every((a) => a.parent_id === pillar.id)).toBe(true);
    });

    it("is still idempotent from that state", () => {
      const tree = [...seedOnly(), ...seedSkeleton(seedOnly(), 1)];
      expect(seedSkeleton(tree, 1)).toEqual([]);
    });

    it("reuses an existing premise rather than minting a second", () => {
      const tree = [...seedOnly(), mk("premise", { id: "pr", parent_id: "s", content: { dramatic_question: "Can she anchor it?" } })];
      const seeded = seedSkeleton(tree, 1);
      expect(seeded.filter((n) => n.kind === "premise")).toHaveLength(0);
      expect(seeded.find((n) => n.kind === "pillar")?.parent_id).toBe("pr");
    });
  });

  it("stays out of a book that opted out of structure", () => {
    const none = [mk("pillar", { id: "pil", content: { controlling_idea: "x", structure: "none" } })];
    expect(seedSkeleton(none, 1)).toEqual([]);
  });

  it("does nothing when there is no ladder at all to attach to", () => {
    expect(seedSkeleton([], 1)).toEqual([]);
    // Entities with no spine above them can't imply where a pillar goes either.
    expect(seedSkeleton([mk("character", { content: { name: "Mara" } })], 1)).toEqual([]);
  });
});

// Owner decision 2026-08-02: deleting an empty slot is an authorial statement ("this book has no inciting
// incident"), not an accident. It must survive both the linter and the seeder, or the tool nags forever and
// re-mints what the author threw away.
describe("tombstones — a declined slot stays declined", () => {
  const declined = (): DnaNode[] => [
    mk("pillar", { id: "pil", content: { controlling_idea: "Belonging is built.", structure: "weiland_3act" },
      authoring: { source: "user", locked: false, status: "accepted", waived_slots: ["inciting_event"] } }),
  ];

  it("waiveSlot records the key on the pillar's authoring plane, not its content", () => {
    const pillar = waiveSlot(fresh(), "midpoint");
    expect(pillar?.authoring.waived_slots).toEqual(["midpoint"]);
    expect(pillar?.content).toEqual(fresh()[0].content); // story content untouched
    expect(waivedSlots([pillar!])).toEqual(new Set(["midpoint"]));
  });

  it("is a no-op when already waived, when the slot is blank, or when there's no pillar", () => {
    expect(waiveSlot(declined(), "inciting_event")).toBeNull();
    expect(waiveSlot(fresh(), "  ")).toBeNull();
    expect(waiveSlot([], "hook")).toBeNull();
  });

  it("the seeder never re-mints a declined slot", () => {
    const seeded = seedSkeleton(declined(), 1);
    expect(seeded.some((n) => n.authoring.scaffold?.slot === "inciting_event")).toBe(false);
    expect(seeded.filter((n) => n.kind === "beat")).toHaveLength(8); // the other 8 still arrive
  });

  it("the linter stops reporting it missing — and still reports the others", () => {
    // A fully slotted sheet minus the declined one: only its absence is in question.
    const SLOTS = ["hook", "inciting_event", "first_plot_point", "first_pinch_point", "midpoint", "second_pinch_point", "third_plot_point", "climax", "resolution"];
    const build = (waived: string[]) => {
      const pillar = mk("pillar", { id: "p", content: { controlling_idea: "x", structure: "weiland_3act" },
        authoring: { source: "user", locked: false, status: "accepted", waived_slots: waived } });
      const acts = [0, 1, 2].map((i) => mk("act", { id: `a${i}`, parent_id: "p", position: i, content: { title: `Act ${i + 1}` } }));
      const kept = SLOTS.filter((s) => s !== "inciting_event");
      const beats = kept.map((s, i) => mk("beat", { id: `b${i}`, parent_id: `a${Math.min(2, Math.floor(i / 3))}`, position: i, content: { summary: "turn", slot: s } }));
      return [pillar, ...acts, ...beats];
    };
    const missing = (nodes: DnaNode[]) => validate(nodes).filter((x) => x.rule === "slot_missing").map((x) => x.message);
    expect(missing(build([])).join(" ")).toContain("The Inciting Event");   // not waived → still nags
    expect(missing(build(["inciting_event"]))).toEqual([]);                  // waived → silent
  });
});
