// P3 — ascent / induction (doc_1785673597000.md §4c). The six doors, as tests.
//
// The claim: a writer arrives holding ONE thing and the tool infers the rest UPWARD. Whichever rung they
// filled first, the `stub` state (empty rung with written material beneath) marks the parents that are now
// owed — so the door is detected, never asked. These tests are written as doors on purpose: they are the
// feature's spec, not incidental coverage.
import { describe, expect, it } from "vitest";
import { ascentEvidence, ascentPrompt, buildAscentAsk, hasAscent, owedRungs } from "../../../../../../supabase/functions/_shared/dna-ascend.ts";
import { topOps } from "../../../../../../supabase/functions/_shared/dna-decompose-core.ts";
import type { DnaNode, NodeKind } from "@/features/dna/lib/novelDna";

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

/** A scaffolded-but-unwritten book: the exact shape P2's seeder produces. */
const scaffold = (): DnaNode[] => [
  mk("seed", { id: "seed" }),
  mk("premise", { id: "prem", parent_id: "seed" }),
  mk("pillar", { id: "pil", parent_id: "prem" }),
  mk("act", { id: "a1", parent_id: "pil", position: 0 }),
  mk("beat", { id: "b1", parent_id: "a1", position: 0 }),
];

describe("the six doors — whichever rung is filled first, the parents above become owed", () => {
  const doors: [string, DnaNode][] = [
    ["character", mk("character", { id: "x", parent_id: "pil", content: { name: "Mara", role: "protagonist", wound: "abandoned as a child", lie: "places can't be trusted" } })],
    ["world", mk("world_fact", { id: "x", parent_id: "pil", content: { name: "the folding", rule: "the city rewrites itself nightly" } })],
    ["situation", mk("beat", { id: "x", parent_id: "a1", position: 1, content: { summary: "a town wakes to find itself sealed under a dome" } })],
    ["voice", mk("voice_profile", { id: "x", parent_id: "pil", content: { pov: "third_limited", tense: "past", style: "dry, close, unsentimental" } })],
  ];

  for (const [door, entry] of doors) {
    it(`${door}-first: every rung above the written material becomes owed`, () => {
      const owed = owedRungs([...scaffold(), entry]).map((n) => n.kind);
      // A beat sits one rung deeper than the entity registries, so the situation door owes its ACT too —
      // the chain is however long it needs to be, not a fixed three.
      expect(owed).toEqual(door === "situation" ? ["seed", "premise", "pillar", "act"] : ["seed", "premise", "pillar"]);
    });
  }

  // v1 writes back through dna-decompose's topOps, which resolves a rung by KIND — fine for the singletons,
  // wrong for acts (plural, positional). The ask is scoped to what can actually be applied; inducing an act
  // spine is its own pass. Recorded here so the gap is visible rather than silently dropped.
  it("scopes the ASK to the singleton rungs even when an act is genuinely owed", () => {
    const nodes = [...scaffold(), mk("beat", { parent_id: "a1", position: 1, content: { summary: "the town wakes sealed under a dome" } })];
    expect(owedRungs(nodes).map((n) => n.kind)).toContain("act");
    expect(buildAscentAsk(nodes)!.targets.map((t) => t.kind)).toEqual(["seed", "premise", "pillar"]);
  });

  it("orders the owed rungs coarsest-first — a premise induced before its pillar would be guessing", () => {
    const nodes = [...scaffold(), mk("character", { parent_id: "pil", content: { name: "Mara", wound: "abandoned" } })];
    expect(owedRungs(nodes).map((n) => n.kind)).toEqual(["seed", "premise", "pillar"]);
  });

  it("a book built top-down owes nothing — ascent stays out of the way", () => {
    const topDown = [
      mk("seed", { id: "seed", content: { logline: "A cartographer maps a city that rewrites itself." } }),
      mk("premise", { id: "prem", parent_id: "seed", content: { dramatic_question: "Can she anchor a place that refuses to stay?" } }),
      mk("pillar", { id: "pil", parent_id: "prem", content: { controlling_idea: "Belonging is built, not found." } }),
    ];
    expect(hasAscent(topDown)).toBe(false);
    expect(buildAscentAsk(topDown)).toBeNull();
  });

  it("an entirely empty scaffold owes nothing — a stub needs something written beneath it", () => {
    expect(hasAscent(scaffold())).toBe(false);
    expect(buildAscentAsk(scaffold())).toBeNull();
  });

  it("stops asking for a rung the author has since written, and still asks for the rest", () => {
    const nodes = scaffold().map((n) => n.id === "pil" ? { ...n, content: { controlling_idea: "Belonging is built." } } : n);
    nodes.push(mk("character", { parent_id: "pil", content: { name: "Mara", wound: "abandoned" } }));
    expect(owedRungs(nodes).map((n) => n.kind)).toEqual(["seed", "premise"]);
  });
});

describe("evidence", () => {
  const book = (): DnaNode[] => [
    ...scaffold(),
    mk("character", { parent_id: "pil", content: { name: "Mara", role: "protagonist", wound: "abandoned as a child", tag: "ignored" } }),
    mk("character", { parent_id: "pil", content: { name: "Enver", role: "antagonist", want: "order" } }),
    mk("world_fact", { parent_id: "pil", content: { name: "the folding", rule: "the city rewrites itself nightly" } }),
    mk("scene", { parent_id: "b1", content: { goal: "reach the plaza", conflict: "the street is gone", outcome: "she is late", prose: { text: "The ledger caught fast. ".repeat(400) } } }),
  ];

  it("gathers written descendants, grouped by kind", () => {
    const ev = ascentEvidence(book(), "seed");
    expect(ev).toContain("CHARACTER:");
    expect(ev).toContain("Mara");
    expect(ev).toContain("Enver");
    expect(ev).toContain("WORLD_FACT:");
  });

  it("never inlines prose — a scene contributes its PLAN, or thirty plan rows drown under one page", () => {
    const ev = ascentEvidence(book(), "seed");
    expect(ev).toContain("reach the plaza");
    expect(ev).not.toContain("The ledger caught fast");
  });

  it("skips unwritten nodes entirely, so the evidence is never padded with blanks", () => {
    expect(ascentEvidence(book(), "seed")).not.toContain("{}");
  });

  it("caps each kind so one bloated registry can't crowd out the others", () => {
    const many = [...scaffold(), ...Array.from({ length: 30 }, (_, i) => mk("character", { parent_id: "pil", content: { name: `C${i}` } }))];
    const lines = ascentEvidence(many, "seed").split("\n").filter((l) => l.startsWith("- "));
    expect(lines).toHaveLength(12);
  });
});

describe("the ask", () => {
  const charDoor = () => [...scaffold(), mk("character", { parent_id: "pil", content: { name: "Mara", wound: "abandoned as a child", lie: "places can't be trusted" } })];

  it("names every owed rung and carries the evidence", () => {
    const ask = buildAscentAsk(charDoor())!;
    expect(ask.targets.map((t) => t.kind)).toEqual(["seed", "premise", "pillar"]);
    expect(ask.evidence).toContain("Mara");
  });

  it("asks only for the rungs that are actually owed", () => {
    const ask = buildAscentAsk(charDoor())!;
    const p = ascentPrompt(ask);
    for (const key of ["logline", "dramatic_question", "controlling_idea"]) expect(p).toContain(key);

    // A written pillar drops out of the REQUEST but stays in the evidence — it is ground truth for
    // inducing the rungs above it, so assert on the output spec, not on the whole prompt.
    const pillarWritten = charDoor().map((n) => n.id === "pil" ? { ...n, content: { controlling_idea: "Belonging is built." } } : n);
    const p2 = ascentPrompt(buildAscentAsk(pillarWritten)!);
    expect(p2).not.toContain('"pillar":');
    expect(p2).toContain('"premise":');
    expect(p2).toContain("Belonging is built."); // still supplied as evidence
  });

  it("frames the task as induction over ground truth, not as free invention", () => {
    const p = ascentPrompt(buildAscentAsk(charDoor())!);
    expect(p).toContain("GROUND TRUTH");
    expect(p).toMatch(/INDUCTION/);
    expect(p).toContain("Mara"); // the evidence is in the prompt, not merely referenced
  });
});

// The answer applies through dna-decompose's EXISTING vocabulary — ascent adds no new write path, which is
// the point of generalizing that module rather than writing a parallel one.
describe("applying an induced answer", () => {
  it("edits the owed rungs in place via topOps", () => {
    const nodes = [...scaffold(), mk("character", { parent_id: "pil", content: { name: "Mara", wound: "abandoned" } })];
    const ops = topOps(nodes, {
      seed: { logline: "A cartographer must map a city that rewrites itself nightly." },
      premise: { dramatic_question: "Can she anchor a place that refuses to stay?" },
      pillar: { controlling_idea: "Belonging is built, not found." },
    });
    expect(ops.map((o) => o.op)).toEqual(["edit", "edit", "edit"]);
    expect(ops.map((o) => (o as { id: string }).id)).toEqual(["seed", "prem", "pil"]);
  });

  it("closes the loop: after applying, nothing is owed", () => {
    const nodes = [...scaffold(), mk("character", { parent_id: "pil", content: { name: "Mara", wound: "abandoned" } })];
    const answer = {
      seed: { logline: "A cartographer must map a city that rewrites itself." },
      premise: { dramatic_question: "Can she anchor a place that refuses to stay?" },
      pillar: { controlling_idea: "Belonging is built, not found." },
    };
    const byId = new Map(topOps(nodes, answer).map((o) => [(o as { id: string }).id, (o as { content: Record<string, unknown> }).content]));
    const applied = nodes.map((n) => byId.has(n.id) ? { ...n, content: byId.get(n.id)! } : n);
    expect(hasAscent(applied)).toBe(false);
  });
});
