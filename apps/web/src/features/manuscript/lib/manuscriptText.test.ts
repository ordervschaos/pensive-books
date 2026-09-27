import { describe, expect, it } from "vitest";
import { bodyText, docFromBody, docTitle, parseBlock, splitBlocks } from "./manuscriptText";

const doc = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1, id: "t1" }, content: [{ type: "text", text: "The Door" }] },
    { type: "paragraph", content: [{ type: "text", text: "She " }, { type: "text", text: "never", marks: [{ type: "italic" }] }, { type: "text", text: " knocked." }] },
    { type: "paragraph" },
    { type: "heading", attrs: { level: 2, id: "h2" }, content: [{ type: "text", text: "Later" }] },
    { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] }, { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "two" }] }] }] },
    { type: "paragraph", content: [{ type: "text", text: "Bold ", }, { type: "text", text: "end", marks: [{ type: "bold" }] }, { type: "text", text: "." }] },
  ],
};

describe("projection", () => {
  it("projects body blocks after the title, dropping empties", () => {
    expect(docTitle(doc)).toBe("The Door");
    expect(bodyText(doc)).toBe("She *never* knocked.\n\n## Later\n\n- one\n- two\n\nBold **end**.");
  });
  it("splits normal-form blocks", () => {
    expect(splitBlocks("a\n\n\n b \n\nc")).toEqual(["a", "b", "c"]);
  });
});

describe("docFromBody", () => {
  it("reuses original nodes for unchanged blocks and rebuilds only the changed one", () => {
    const next = docFromBody(doc, "The Door", "She *never* knocked.\n\n## Later\n\n- one\n- two\n\nBold **start**.");
    expect(next.content![0]).toBe(doc.content[0]); // title node reused (id kept)
    expect(next.content![1]).toBe(doc.content[1]);
    expect(next.content![2]).toBe(doc.content[3]); // the h2 keeps its id attr
    expect(next.content![3]).toBe(doc.content[4]);
    expect(next.content![4]).not.toBe(doc.content[5]);
    expect(bodyText(next)).toBe("She *never* knocked.\n\n## Later\n\n- one\n- two\n\nBold **start**.");
  });
  it("retitles by building a fresh title heading", () => {
    const next = docFromBody(doc, "The Window", bodyText(doc));
    expect(docTitle(next)).toBe("The Window");
    expect(next.content![1]).toBe(doc.content[1]);
  });
  it("round-trips a new page with no original", () => {
    const next = docFromBody(null, "New", "First para.\n\n## Head\n\n1. a\n2. b\n\n> quoted\n\n---\n\n```js\nx()\n```");
    expect(bodyText(next)).toBe("First para.\n\n## Head\n\n1. a\n2. b\n\n> quoted\n\n---\n\n```js\nx()\n```");
  });
  it("never lets a body heading claim level 1", () => {
    expect(parseBlock("# Top").attrs?.level).toBe(2);
  });
  it("keeps hard breaks inside a paragraph", () => {
    const p = parseBlock("line one\nline two");
    expect(p.content?.map((n) => n.type)).toEqual(["text", "hardBreak", "text"]);
  });
});
