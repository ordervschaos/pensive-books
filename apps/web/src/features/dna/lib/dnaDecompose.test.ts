// dnaDecompose tests — the pure half of the semantic ascent, run over a tree built by the actual
// import path (Layer A), so the two layers are tested against each other.
import { describe, it, expect } from "vitest";
import { chaptersOf, entityOps, topOps, type EntitiesRead } from "./dnaDecompose";
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
    world_facts: [{ name: "The Door", rule: "It knocks back." }],
    threads: [{ name: "The key's origin", kind: "mystery", promise: "Who sent the key?" }],
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

  it("adds world facts, threads, and a voice profile onto the pillar", () => {
    const { ops } = entityOps(tree, read);
    const kinds = ops.filter((o) => o.op === "add").map((o) => (o as { kind: string }).kind);
    expect(kinds).toContain("world_fact");
    expect(kinds).toContain("thread");
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
