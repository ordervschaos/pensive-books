import { describe, expect, it } from "vitest";
import { buildDnaFromStack, type MigrationInput } from "@/lib/migrateToDna";
import { chapters, renderPages, scenesInOrder, validate, type SceneContent } from "@/lib/novelDna";

const doc = (text: string) => ({ type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "T" }] }, { type: "paragraph", content: [{ type: "text", text }] }] });

const input: MigrationInput = {
  brief: { idea: "A salt clerk falls for a smuggler.", genre: "romance", tone: ["wry"] },
  foundations: {
    argument: { text: "Freedom is chosen, not granted.", pinned: true },
    ending: { text: "She burns the ledger.", pinned: true },
    cast: [{ id: "c1", name: "Mara", role: "protagonist", want: "escape", wound: "abandoned", lie: "I am a debt" }],
    tentpoles: [{ id: "t1", text: "The fireplace strip", source: "ai", status: "pinned", placed_page_id: 11 }],
  },
  spine: { text: "A woman bound by a ledger learns to choose." },
  pages: [
    { id: 10, page_index: 0, page_type: "section", title: "Chapter 1", content: null, metadata: null },
    { id: 11, page_index: 1, page_type: "text", title: "Arrival", content: doc("Rain hit the quay."), metadata: { objective: "Establish Mara", pov: "Mara" } },
    { id: 12, page_index: 2, page_type: "section", title: "Chapter 2", content: null, metadata: null },
    { id: 13, page_index: 3, page_type: "text", title: "The strip", content: doc("The fire cracked."), metadata: { objective: "Heat rises" } },
  ],
};

describe("buildDnaFromStack", () => {
  const nodes = buildDnaFromStack(1, input);
  const kinds = nodes.map((n) => n.kind);

  it("produces the full ladder + entity branch from the legacy stack", () => {
    expect(kinds).toContain("seed");
    expect(kinds).toContain("premise");
    expect(kinds).toContain("pillar");
    expect(kinds.filter((k) => k === "character")).toHaveLength(1);
    expect(kinds.filter((k) => k === "tentpole")).toHaveLength(1);
    expect(kinds.filter((k) => k === "movement")).toHaveLength(1);
    expect(kinds.filter((k) => k === "beat")).toHaveLength(2);   // one per chapter
    expect(kinds.filter((k) => k === "scene")).toHaveLength(2);
  });

  it("carries pins to locks (argument/ending pinned, tentpole pinned)", () => {
    expect(nodes.find((n) => n.kind === "pillar")!.authoring.locked).toBe(true);
    expect(nodes.find((n) => n.kind === "tentpole")!.authoring.locked).toBe(true);
  });

  it("scenes carry prose, chapter boundaries, and resolved references", () => {
    const scenes = scenesInOrder(nodes);
    expect(scenes).toHaveLength(2);
    const s1 = scenes[0].content as SceneContent;
    expect(s1.prose?.text).toBe("Rain hit the quay.");
    expect(s1.chapter_start?.title).toBe("Chapter 1");
    // pov resolved from the legacy name to the character node id
    const charId = nodes.find((n) => n.kind === "character")!.id;
    expect(s1.pov).toBe(charId);
    // tentpole placed on page 11 → realized by the first scene
    const tentId = nodes.find((n) => n.kind === "tentpole")!.id;
    expect(s1.realizes_tentpole).toBe(tentId);
  });

  it("renders back into 2 chapters with their prose, and has no dangling references", () => {
    const out = renderPages(nodes);
    expect(out.filter((p) => p.kind === "section").map((p) => p.title)).toEqual(["Chapter 1", "Chapter 2"]);
    expect(out.find((p) => p.kind === "text")!.proseText).toBe("Rain hit the quay.");
    expect(chapters(nodes)).toHaveLength(2);
    expect(validate(nodes).filter((i) => i.rule === "dangling_ref")).toHaveLength(0);
  });
});
