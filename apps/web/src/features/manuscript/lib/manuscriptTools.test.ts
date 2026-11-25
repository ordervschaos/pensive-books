import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { checkProse, findHits, matcher, replaceIn } from "../../../../../../supabase/functions/manuscript-agent/analysis";
import { groupSteps, workSummary } from "./chatGroups";
import { movedOrder, type ManuscriptStep } from "./manuscriptAgent";

const re = (q: string, mode: "phrase" | "word" | "regex" = "phrase", cs = false) => {
  const r = matcher(q, mode, cs);
  if (typeof r === "string") throw new Error(r);
  return r;
};

describe("matcher", () => {
  it("word mode skips names inside longer words, including non-ASCII", () => {
    expect(findHits("Ann met Anna and Ann’s dog. Anné waved.", re("Ann", "word", true), 5).count).toBe(2);
  });
  it("phrase mode escapes regex characters", () => {
    expect(findHits("Is it (really) so?", re("(really)"), 5).count).toBe(1);
  });
  it("returns a sentence for bad or empty-matching patterns", () => {
    expect(matcher("(", "regex")).toMatch(/invalid regex/);
    expect(matcher("a*", "regex")).toMatch(/empty text/);
    expect(matcher("  ")).toMatch(/required/);
  });
});

describe("replaceIn", () => {
  it("replaces literally outside regex mode ($ is not special)", () => {
    expect(replaceIn("Ann paid Ann", re("Ann", "word", true), "$1 Anya", "word")).toEqual({ after: "$1 Anya paid $1 Anya", count: 2 });
  });
  it("supports groups in regex mode", () => {
    expect(replaceIn("colour, flavour", re("(\\w+)our", "regex"), "$1or", "regex").after).toBe("color, flavor");
  });
});

describe("checkProse", () => {
  it("reports echoes, filter words and repeated openers as numbers", () => {
    const text = "She felt the cold. She saw the window. She heard the window rattle.\n\nIt was very quiet.";
    const out = checkProse(text);
    expect(out).toMatch(/words \d+ · sentences 4/);
    expect(out).toMatch(/echoes within 60 words: window×1/);
    expect(out).toMatch(/filter words: .*felt×1/);
    expect(out).toMatch(/hedges\/intensifiers: very×1/);
    expect(out).toMatch(/repeated openers: 1 run/);
  });
  it("handles an empty page", () => {
    expect(checkProse("")).toBe("empty page");
  });
});

describe("chat folding", () => {
  const steps: ManuscriptStep[] = [
    { t: "user", label: "check chapter 2" },
    { t: "read", label: "read the section p4 \"Two\" (5 pages)" },
    { t: "read", label: "searched “Ann” — 3 matches on 2 pages" },
    { t: "finding", label: "noted 2 things", findings: [{ ref: "p5", finding: "a" }, { ref: "p6", finding: "b" }] },
    { t: "read", label: "checked the prose on p5 \"Door\"" },
    { t: "note", label: "Here is what I found." },
    { t: "read", label: "read p9 \"End\"" },
  ];
  it("folds consecutive legwork into one group and keeps conversation visible", () => {
    const items = groupSteps(steps);
    expect(items.map((i) => i.kind)).toEqual(["step", "work", "step", "work"]);
    expect(items[1].kind === "work" && items[1].steps).toHaveLength(4);
  });
  it("summarises what the legwork was", () => {
    const items = groupSteps(steps);
    expect(items[1].kind === "work" && workSummary(items[1].steps)).toBe("read 5 pages · 1 search · checked prose · noted 2");
    expect(items[3].kind === "work" && workSummary(items[3].steps)).toBe("read 1 page");
  });
});

describe("movedOrder", () => {
  it("moves a page after another, or to the start", () => {
    expect(movedOrder([1, 2, 3, 4], 4, 1)).toEqual([1, 4, 2, 3]);
    expect(movedOrder([1, 2, 3, 4], 3, null)).toEqual([3, 1, 2, 4]);
    expect(movedOrder([1, 2, 3, 4], 1, 4)).toEqual([2, 3, 4, 1]);
  });
});
