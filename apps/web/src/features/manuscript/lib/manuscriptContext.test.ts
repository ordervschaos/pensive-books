import { describe, expect, it } from "vitest";
import { canvasContext, canvasSnapshot, parseCanvas } from "../../../../../../supabase/functions/manuscript-agent/canvas";
import { readCanvas } from "../../../../../../supabase/functions/manuscript-agent/exec-tools";
import { compactTranscript, latestAuthorAsk, withBookState, withCacheBreakpoints } from "../../../../../../supabase/functions/manuscript-agent/transcript";

const pages = [{ id: 42, page_index: 2, title: "The Door" }];
const changes = [{ id: "new-1", kind: "page_add", title: "Arrival" }];

describe("canvas context", () => {
  it.each([null, [], "page", {}, { kind: "page", pageId: "42" }, { kind: "page", pageId: -1 }, { kind: "page", pageId: 1.5 }, { kind: "page", pageId: Infinity }, { kind: "add", changeId: "" }])("drops malformed input: %j", (input) => {
    expect(parseCanvas(input)).toBeNull();
  });

  it("keeps only the target id and the book's own label", () => {
    expect(canvasSnapshot({ kind: "page", pageId: 42, label: "Forged title", bookId: 999 }, pages, changes))
      .toEqual({ target: { kind: "page", pageId: 42 }, label: "p3 · The Door" });
    expect(canvasSnapshot({ kind: "page", pageId: 999 }, pages, changes)).toBeNull();
  });

  it("distinguishes book details and proposed pages; a resolved proposal no longer opens", () => {
    expect(canvasSnapshot({ kind: "book" }, pages, changes)?.label).toBe("Book details");
    const preview = canvasSnapshot({ kind: "add", changeId: "new-1" }, pages, changes);
    expect(preview?.label).toBe("New page · Arrival");
    expect(canvasContext(preview)).toContain("not yet part of the manuscript");
    expect(canvasSnapshot({ kind: "add", changeId: "new-1" }, pages, [])).toBeNull();
    expect(canvasSnapshot({ kind: "add", changeId: "edit-1" }, pages, [{ id: "edit-1", kind: "page_edit" }])).toBeNull();
  });

  it("queries a page only inside the authorized book and excludes archived pages", async () => {
    const rows = [
      { ...pages[0], book_id: 1, archived: false },
      { id: 43, page_index: 3, title: "Other book's private title", book_id: 2, archived: false },
      { id: 44, page_index: 4, title: "Deleted", book_id: 1, archived: true },
    ];
    const service = { from: () => {
      const filters: [string, unknown][] = [];
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
        maybeSingle: async () => ({ data: rows.find((row) => filters.every(([k, v]) => row[k] === v)) ?? null, error: null }),
      };
      return query;
    } } as unknown as Parameters<typeof readCanvas>[0];
    expect(await readCanvas(service, 1, { kind: "page", pageId: 42, label: "Fake" }, [])).toEqual({ target: { kind: "page", pageId: 42 }, label: "p3 · The Door" });
    expect(await readCanvas(service, 1, { kind: "page", pageId: 43 }, [])).toBeNull();
    expect(await readCanvas(service, 1, { kind: "page", pageId: 44 }, [])).toBeNull();
  });

  it("replays the send-time context while keeping it out of the standing task echo", () => {
    const snapshot = canvasSnapshot({ kind: "page", pageId: 42 }, pages, changes)!;
    const context = canvasContext(snapshot);
    const transcript = [{ role: "user", content: [{ type: "text", text: "Tighten this page" }, { type: "text", text: context }] }];
    pages[0] = { ...pages[0], title: "A new title" };
    expect(snapshot.label).toBe("p3 · The Door");
    expect(latestAuthorAsk(transcript)).toBe("Tighten this page");
    expect(compactTranscript(transcript)).toEqual(transcript);
    const request = withBookState(withCacheBreakpoints(transcript), "<book>live</book>", latestAuthorAsk(transcript));
    expect(JSON.stringify(request)).toContain("p3 · The Door");
    expect(transcript[0].content).toHaveLength(2); // request-time state never changes the stored snapshot
    expect(latestAuthorAsk([{ role: "user", content: [{ type: "text", text: "An older client, without canvas" }] }])).toBe("An older client, without canvas");
  });
});
