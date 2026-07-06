import { describe, expect, it, vi } from "vitest";

// In-memory supabase: capture book_nodes updates so writeConfusionFlags' targeted patches are assertable
// without a network. Only the surface confusionRead's module graph touches at test time is stubbed.
vi.mock("@/integrations/supabase/client", () => {
  const updates: { id: string; content: Record<string, unknown> }[] = [];
  return {
    __updates: updates,
    supabase: {
      from: () => ({
        update: (row: { content: Record<string, unknown> }) => ({
          eq: async (_col: string, id: string) => { updates.push({ id, content: row.content }); return { error: null }; },
        }),
      }),
    },
  };
});
import * as supabaseClient from "@/integrations/supabase/client";
import { buildConfusionReadInput, judgedSceneIds, writeConfusionFlags, type SceneConfusionFlag } from "@/features/dna/lib/confusionRead";
import type { Authoring, DnaNode, NodeContent, NodeKind, SceneContent } from "@/features/dna/lib/novelDna";

const updates = (supabaseClient as unknown as { __updates: { id: string; content: Record<string, unknown> }[] }).__updates;

let pos = 0;
const mk = (kind: NodeKind, id: string, parent_id: string | null, content: NodeContent = {}, authoring?: Authoring): DnaNode => ({
  id, book_id: 1, parent_id, level: 0, kind, position: pos++, content,
  authoring: authoring ?? { source: "ai", locked: false, status: "accepted" },
});
const sceneContent = (over: Partial<SceneContent> = {}): NodeContent => ({ ...over } as NodeContent);
const withDigest = (line: string): Authoring =>
  ({ source: "ai", locked: false, status: "accepted", prose_digest: { line } }) as Authoring;

/** act → beat → 4 scenes: s1+s2 open the book (chapter 1, s1 has a chapter_start), s3 starts chapter 2,
 *  s4 starts chapter 3 but has NO prose (its chapter must be skipped from the payload). */
const tree = (): DnaNode[] => {
  pos = 0;
  return [
    mk("act", "a1", null),
    mk("beat", "b1", "a1"),
    mk("scene", "s1", "b1", sceneContent({ chapter_start: { title: "One" }, prose: { text: "Mara reaches the harbor at dusk." } }), withDigest("Mara arrives at the harbor.")),
    mk("scene", "s2", "b1", sceneContent({ prose: { text: "She bargains with the harbormaster." } })), // no digest line → fallback only if chapter-opening
    mk("scene", "s3", "b1", sceneContent({ chapter_start: { title: "Two" }, prose: { text: "At dawn the ledger is missing." } }), withDigest("The ledger vanishes at dawn.")),
    mk("scene", "s4", "b1", sceneContent({ chapter_start: { title: "Three" } })), // prose-less chapter
  ];
};

describe("buildConfusionReadInput — the reader-horizon assembly", () => {
  it("groups scenes into chapters, skips prose-less chapters, and keeps reading order", () => {
    const input = buildConfusionReadInput(tree());
    expect(input.chapters.map((c) => c.chapterIndex)).toEqual([0, 1]); // chapter 3 (s4) has no prose → skipped
    expect(input.chapters[0].scenes.map((s) => s.sceneId)).toEqual(["s1", "s2"]);
    expect(input.chapters[1].scenes.map((s) => s.sceneId)).toEqual(["s3"]);
  });

  it("gives the opening chapter an empty recap and later chapters the prior scenes' digest lines", () => {
    const input = buildConfusionReadInput(tree());
    expect(input.chapters[0].priorContext).toBe("");
    // Chapter 2's reader knows chapter 1: s1's cached digest line (s2 has none and isn't a chapter opening).
    expect(input.chapters[1].priorContext).toContain("Mara arrives at the harbor.");
    expect(input.chapters[1].priorContext).not.toContain("harbormaster");
  });

  it("falls back to the chapter opening's first chars (marked truncated) when no digest line is cached", () => {
    const nodes = tree().map((n) => (n.id === "s1" ? { ...n, authoring: { source: "ai", locked: false, status: "accepted" } as Authoring } : n));
    const input = buildConfusionReadInput(nodes);
    expect(input.chapters[1].priorContext).toContain("Mara reaches the harbor at dusk.");
    expect(input.chapters[1].priorContext).toContain("truncated recap");
  });

  it("caps per-scene prose at 6000 chars", () => {
    const long = "x".repeat(9000);
    const nodes = tree().map((n) => (n.id === "s2" ? { ...n, content: sceneContent({ prose: { text: long } }) } : n));
    const input = buildConfusionReadInput(nodes);
    expect(input.chapters[0].scenes[1].prose.length).toBe(6000);
  });

  it("judgedSceneIds maps a truncated run back to exactly the chapters the fn consumed", () => {
    const input = buildConfusionReadInput(tree());
    expect(judgedSceneIds(input, 1)).toEqual(["s1", "s2"]);
    expect(judgedSceneIds(input, 2)).toEqual(["s1", "s2", "s3"]);
  });
});

describe("writeConfusionFlags — grouping + clearing semantics", () => {
  it("groups flags by scene into ONE targeted patch and leaves the rest of content intact", async () => {
    updates.length = 0;
    const nodes = tree();
    const flags: SceneConfusionFlag[] = [
      { sceneId: "s1", kind: "who", note: 'who is "the harbormaster"?' },
      { sceneId: "s1", kind: "why", note: "why dusk matters is unclear" },
    ];
    await writeConfusionFlags(nodes, flags, ["s1", "s2", "s3"]);
    expect(updates).toHaveLength(1); // s2/s3 were judged clean and had no prior flags → untouched
    expect(updates[0].id).toBe("s1");
    expect(updates[0].content.confusion_flags).toEqual([
      { kind: "who", note: 'who is "the harbormaster"?' },
      { kind: "why", note: "why dusk matters is unclear" },
    ]);
    expect((updates[0].content as SceneContent).chapter_start).toEqual({ title: "One" }); // content merged, not replaced
  });

  it("clears a judged scene's stale flags when the re-run finds it fixed, but never touches unjudged scenes", async () => {
    updates.length = 0;
    const stale = [{ kind: "where", note: "old flag" }];
    const nodes = tree().map((n) =>
      n.id === "s1" || n.id === "s3" ? { ...n, content: { ...n.content, confusion_flags: stale } } : n);
    await writeConfusionFlags(nodes, [], ["s1", "s2"]); // truncated run: chapter 2 (s3) never judged
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe("s1");
    expect(updates[0].content.confusion_flags).toEqual([]); // judged clean → cleared
    // s3 got no update — its stale flag survives until a run actually reaches it.
  });

  it("ignores flags for ids that aren't scenes in the tree", async () => {
    updates.length = 0;
    await writeConfusionFlags(tree(), [{ sceneId: "b1", kind: "who", note: "n" }], ["b1", "nope"]);
    expect(updates).toHaveLength(0);
  });
});
