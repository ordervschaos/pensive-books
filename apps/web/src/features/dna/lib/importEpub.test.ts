// importEpub tests — the pure half of draft onboarding: parsed draft → MigrationPages →
// buildDnaFromStack tree, with imported prose locked as the author's ground truth.
import { describe, it, expect } from "vitest";
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

describe("draftToMigrationPages", () => {
  it("emits a section page per chapter and a text page per scene, in reading order", () => {
    const pages = draftToMigrationPages(draft);
    expect(pages.map((p) => p.page_type)).toEqual(["section", "text", "text", "section", "text"]);
    expect(pages.map((p) => p.page_index)).toEqual([0, 1, 2, 3, 4]);
    expect(pages[1].content).toBe("Mara found the door.");
    expect(pages[3].title).toBe("Two: The Key");
  });
});

describe("buildDnaFromStack over an imported draft", () => {
  const nodes = lockImportedProse(
    buildDnaFromStack(7, { brief: null, foundations: null, spine: null, pages: draftToMigrationPages(draft) }),
  );

  it("builds the ladder: chapter → beat, scene page → prose-bearing scene", () => {
    const beats = nodes.filter((n) => n.kind === "beat");
    const scenes = nodes.filter((n) => n.kind === "scene");
    expect(beats.map((b) => (b.content as { summary?: string }).summary)).toEqual(["One: The Door", "Two: The Key"]);
    expect(scenes).toHaveLength(3);
    const prose = scenes.map((s) => (s.content as { prose?: { text?: string } }).prose?.text);
    expect(prose).toEqual(["Mara found the door.", "By night it seemed ordinary.", "The key arrived by post."]);
    // chapter_start lands on each chapter's first scene only
    const starts = scenes.filter((s) => (s.content as { chapter_start?: unknown }).chapter_start);
    expect(starts).toHaveLength(2);
  });

  it("locks imported prose as the author's ground truth (source user, locked)", () => {
    for (const s of nodes.filter((n) => n.kind === "scene")) {
      expect(s.authoring.locked).toBe(true);
      expect(s.authoring.source).toBe("user");
      expect(s.authoring.prose_src_hash).toBeTruthy(); // provenance stamped — not falsely stale
    }
  });

  it("leaves the top rungs present but unfilled for the semantic ascent", () => {
    const seed = nodes.find((n) => n.kind === "seed");
    expect(seed).toBeTruthy();
    expect((seed!.content as { logline?: string }).logline).toBe("");
  });
});
