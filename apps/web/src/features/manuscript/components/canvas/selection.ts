// What the canvas is showing: the book's own fields, a live page, or a staged new page (a phantom).
export type Selection = { kind: "book" } | { kind: "page"; pageId: number } | { kind: "add"; changeId: string };
