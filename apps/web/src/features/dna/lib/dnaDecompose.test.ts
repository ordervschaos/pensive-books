// dnaDecompose tests — the pure half of the semantic ascent, run over a tree built by the actual
// import path (Layer A), so the two layers are tested against each other.
import { describe, it, expect } from "vitest";
import { chaptersOf, entityOps, systemsOps, topOps, type EntitiesRead, type SystemsRead } from "./dnaDecompose";
import { draftToMigrationPages, lockImportedProse } from "./importEpub";
import { buildDnaFromStack } from "./migrateToDna";
import type { ImportedDraft } from "@/lib/epubImport";

const draft: ImportedDraft = {
  title: "The Long Way",
  author: "Jane Q. Writer",
  chapters: [
    { title: "One: The Door", scenes: ["Mara found the door.", "By night it seemed ordinary."] },
    { title: "Two: The Key", scenes: ["The key arrived by post."] },
  ],
};
const tree = lockImportedProse(
  buildDnaFromStack(7, { brief: null, foundations: null, spine: null, pages: draftToMigrationPages(draft) }),
);

describe("chaptersOf", () => {
  it("yields prose-bearing beats in reading order with concatenated scene prose", () => {
    const chapters = chaptersOf(tree);
    expect(chapters.map((c) => c.title)).toEqual(["One: The Door", "Two: The Key"]);
    expect(chapters[0].text).toBe("Mara found the door.\n\nBy night it seemed ordinary.");
    const beatIds = new Set(tree.filter((n) => n.kind === "beat").map((n) => n.id));
    expect(chapters.every((c) => beatIds.has(c.beatId))).toBe(true);
  });
});

describe("topOps", () => {
  it("targets the existing seed/premise/pillar and drops empty rungs", () => {
    const ops = topOps(tree, {
      seed: { logline: "A woman finds a door that was not there." },
      premise: {},
      pillar: { controlling_idea: "Some doors deserve a witness." },
    });
    expect(ops).toHaveLength(2); // premise had no content
    const seed = tree.find((n) => n.kind === "seed")!;
    expect(ops[0]).toEqual({ op: "edit", id: seed.id, content: { logline: "A woman finds a door that was not there." } });
  });
});

describe("entityOps", () => {
  const read: EntitiesRead = {
    characters: [
      { name: "Mara", role: "protagonist", want: "to understand the door" },
      { name: "The Postman", role: "minor" },
      { name: "mara", role: "ally" }, // dup by case — dropped
    ],
    relationships: [
      { a: "Mara", b: "The Postman", bond: "wary courtesy" },
      { a: "Mara", b: "The Door", bond: "obsession" }, // The Door is not a character — skipped
    ],
    locations: [{ name: "The threshold", summary: "Where the door stands.", mood: "charged stillness" }],
    voice: { pov: "third-person-limited", tense: "past", style: "dry, precise, faintly wry" },
  };

  it("mints character ids, resolves relationship names to them, and skips unresolved refs", () => {
    const { ops, skipped } = entityOps(tree, read);
    const chars = ops.filter((o) => o.op === "add" && o.kind === "character");
    expect(chars).toHaveLength(2); // case-insensitive dedupe
    const rels = ops.filter((o) => o.op === "add" && o.kind === "relationship");
    expect(rels).toHaveLength(1);
    const rel = rels[0] as unknown as { content: { a: string; b: string } };
    const ids = new Set(chars.map((c) => (c as { id?: string }).id));
    expect(ids.has(rel.content.a)).toBe(true);
    expect(ids.has(rel.content.b)).toBe(true);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toContain("The Door");
  });

  it("adds locations and a voice profile onto the pillar", () => {
    const { ops } = entityOps(tree, read);
    const kinds = ops.filter((o) => o.op === "add").map((o) => (o as { kind: string }).kind);
    expect(kinds).toContain("location");
    expect(kinds).toContain("voice_profile");
    const pillar = tree.find((n) => n.kind === "pillar")!;
    expect(ops.every((o) => o.op !== "add" || (o as { parentId: string }).parentId === pillar.id)).toBe(true);
  });

  it("edits (not adds) the voice profile when one already exists", () => {
    const withVoice = [...tree, { ...tree[0], id: "n_voice1", kind: "voice_profile" as const, parent_id: tree.find((n) => n.kind === "pillar")!.id, level: 2, position: 0, content: { style: "old" } }];
    const { ops } = entityOps(withVoice, { voice: { style: "new style" } });
    expect(ops).toEqual([{ op: "edit", id: "n_voice1", content: { style: "new style" } }]);
  });
});

describe("systemsOps", () => {
  // post-entities tree: the import fixture plus a cast the games can resolve players against
  const pillar = tree.find((n) => n.kind === "pillar")!;
  const cast = [
    { ...tree[0], id: "n_mara01", kind: "character" as const, parent_id: pillar.id, level: 2, position: 0, content: { name: "Mara" } },
    { ...tree[0], id: "n_post01", kind: "character" as const, parent_id: pillar.id, level: 2, position: 1, content: { name: "The Postman" } },
  ];
  const withCast = [...tree, ...cast];
  const beatIds = chaptersOf(tree).map((c) => c.beatId); // 2 chapters
  const read: SystemsRead = {
    world_facts: [{ name: "The Door", rule: "It knocks back." }],
    threads: [
      { name: "The key's origin", kind: "mystery", promise: "Who sent the key?", setup_chapter: 2, payoff_chapter: 9 }, // payoff out of range
    ],
    games: [{
      name: "Cross before it closes", players: ["Mara", "A Stranger"], win_condition: "She crosses",
      lose_condition: "The door claims her", governing_rules: ["The Door", "Unknown Rule"],
      outcome: "won", resolved_chapter: 2,
    }],
    tentpoles: [{ summary: "The door knocks back", realized_chapter: 1 }],
    meters: [{ name: "Dread", kind: "tension", poles: { low: "calm", high: "terror" }, scale: { min: 0, max: 10 } }],
  };
  const { ops, skipped } = systemsOps(withCast, read, beatIds);
  const adds = ops.filter((o) => o.op === "add") as { kind: string; id?: string; content: Record<string, unknown> }[];
  const edits = ops.filter((o) => o.op === "edit") as { id: string; content: Record<string, unknown> }[];

  it("adds every system kind onto the pillar with pre-minted ids", () => {
    expect(adds.map((a) => a.kind).sort()).toEqual(["game", "meter", "tentpole", "thread", "world_fact"]);
  });

  it("resolves game players and governing rules by name, dropping unresolved ones", () => {
    const game = adds.find((a) => a.kind === "game")!;
    expect(game.content.players).toEqual(["n_mara01"]); // "A Stranger" dropped
    const wfId = adds.find((a) => a.kind === "world_fact")!.id;
    expect(game.content.governing_rules).toEqual([wfId]); // "Unknown Rule" dropped
  });

  it("links systems onto beats by chapter number and reports out-of-range links", () => {
    const threadId = adds.find((a) => a.kind === "thread")!.id;
    const gameId = adds.find((a) => a.kind === "game")!.id;
    const tpId = adds.find((a) => a.kind === "tentpole")!.id;
    const ch1 = edits.find((e) => e.id === beatIds[0])!;
    const ch2 = edits.find((e) => e.id === beatIds[1])!;
    expect(ch1.content.realizes).toEqual([tpId]);
    expect(ch2.content.threads).toEqual([{ ref: threadId, role: "setup" }]);
    expect(ch2.content.resolves).toEqual([{ ref: gameId, outcome: "won" }]);
    expect(skipped.some((s) => s.includes("payoff") && s.includes("chapter 9"))).toBe(true);
  });

  it("does not link an unresolved game (no outcome) to any beat", () => {
    const { ops: ops2 } = systemsOps(withCast, { games: [{ name: "Open contest", win_condition: "w", lose_condition: "l", resolved_chapter: 1 }] }, beatIds);
    expect(ops2.filter((o) => o.op === "edit")).toHaveLength(0);
  });
});
