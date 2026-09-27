import { describe, expect, it } from "vitest";
import { countUnits, decideAll, diffBody, resolve, wordSegments } from "./manuscriptDiff";

describe("wordSegments", () => {
  it("groups contiguous changes into hunks and joins them across whitespace", () => {
    const segs = wordSegments("the quick brown fox", "the slow red fox");
    expect(segs).toEqual([
      { type: "eq", text: "the " },
      { type: "hunk", id: 0, del: "quick brown", ins: "slow red" },
      { type: "eq", text: " fox" },
    ]);
  });
  it("numbers separate hunks", () => {
    const segs = wordSegments("a b c d e", "A b c D e");
    expect(segs.filter((s) => s.type === "hunk").map((s) => (s as { id: number }).id)).toEqual([0, 1]);
  });
});

describe("diffBody", () => {
  it("pairs a changed paragraph as modified and keeps unrelated ones as deleted/inserted", () => {
    const d = diffBody("Alpha beta gamma.\n\nSecond para here.\n\nThird.", "Alpha beta delta.\n\nCompletely different text about nothing.\n\nThird.");
    expect(d.map((b) => b.type)).toEqual(["modified", "deleted", "inserted", "equal"]);
  });
  it("counts units", () => {
    const d = diffBody("one two\n\nkeep\n\ngone", "one three\n\nkeep\n\nnew stuff entirely unrelated");
    expect(countUnits(d)).toBe(3); // 1 hunk + deleted + inserted
  });
});

describe("resolve", () => {
  const before = "The cat sat.\n\nOld para.\n\nUnchanged.";
  const after = "The dog sat.\n\nUnchanged.\n\nNew para.";
  it("with no decisions leaves both sides as they were", () => {
    const d = diffBody(before, after);
    expect(resolve(d, [])).toEqual({ before, after });
  });
  it("accepting one word hunk moves the page toward the proposal and leaves the rest staged", () => {
    const d = diffBody(before, after);
    const r = resolve(d, [{ block: 0, hunk: 0, verdict: "accept" }]);
    expect(r.before).toBe("The dog sat.\n\nOld para.\n\nUnchanged.");
    expect(r.after).toBe(after);
  });
  it("rejecting a deleted block restores it in the proposal", () => {
    const d = diffBody(before, after);
    const r = resolve(d, [{ block: 1, verdict: "reject" }]);
    expect(r.before).toBe(before);
    expect(r.after).toBe("The dog sat.\n\nOld para.\n\nUnchanged.\n\nNew para.");
  });
  it("accepting everything converges before onto after", () => {
    const d = diffBody(before, after);
    const r = resolve(d, decideAll(d, "accept"));
    expect(r.before).toBe(after);
    expect(r.after).toBe(after);
  });
  it("rejecting everything converges after onto before", () => {
    const d = diffBody(before, after);
    const r = resolve(d, decideAll(d, "reject"));
    expect(r.before).toBe(before);
    expect(r.after).toBe(before);
  });
  it("a hunk decision overrides a block decision for that hunk", () => {
    const d = diffBody("a b c d e", "A b c D e");
    const r = resolve(d, [{ block: 0, verdict: "accept" }, { block: 0, hunk: 1, verdict: "reject" }]);
    expect(r.before).toBe("A b c d e");
    expect(r.after).toBe("A b c d e");
  });
});
