// manuscriptText — the page-text projection the manuscript agent reads and writes, and its inverse.
//
// Pages are TipTap JSON. The agent (and the diff view) work on a plain-text projection of the body:
// blocks separated by one blank line, `## ` headings, `- ` lists, `**bold**`/`*italic*`. The forward
// half (blockText/bodyText) is a BYTE-FOR-BYTE MIRROR of supabase/functions/manuscript-agent/shared.ts —
// the server derives a change's `before` from the same page the client re-projects, so any drift shows
// up as phantom diffs. Keep the two identical.
//
// The inverse (docFromBody) is FORMAT-PRESERVING: every body block whose text is unchanged is carried
// over as its ORIGINAL JSON node (marks, ids, attributes intact); only changed/new blocks are rebuilt
// from text. So accepting a one-word fix never flattens the rest of the page.
import { inlineMarkdownToNodes } from "@/lib/inlineMarkdown";
import type { EditorJSON } from "@/types/editor";

type Node = EditorJSON;

function inlineText(nodes: Node[] | undefined): string {
  let out = "";
  for (const n of nodes ?? []) {
    if (n.type === "text") {
      let t = n.text ?? "";
      const marks = new Set((n.marks ?? []).map((m) => m.type));
      if (marks.has("bold")) t = `**${t}**`;
      if (marks.has("italic")) t = `*${t}*`;
      out += t;
    } else if (n.type === "hardBreak") out += "\n";
    else if (n.content) out += inlineText(n.content);
  }
  return out;
}
const listItemText = (li: Node) => (li.content ?? []).map(blockText).join("\n");

export function blockText(n: Node): string {
  switch (n.type) {
    case "heading": {
      const lvl = Math.min(6, Math.max(1, Number(n.attrs?.level ?? 1)));
      return `${"#".repeat(lvl)} ${inlineText(n.content)}`;
    }
    case "paragraph": return inlineText(n.content);
    case "bulletList": return (n.content ?? []).map((li) => `- ${listItemText(li)}`).join("\n");
    case "orderedList": return (n.content ?? []).map((li, i) => `${i + 1}. ${listItemText(li)}`).join("\n");
    case "blockquote": return (n.content ?? []).map(blockText).join("\n").split("\n").map((l) => `> ${l}`).join("\n");
    case "codeBlock": return "```" + String(n.attrs?.language ?? "") + "\n" + inlineText(n.content) + "\n```";
    case "horizontalRule": return "---";
    case "image": return `![${String(n.attrs?.alt ?? "")}](${String(n.attrs?.src ?? "")})`;
    default: return inlineText(n.content) || (n.text ?? "");
  }
}

const isTitleNode = (n: Node | undefined) => !!n && n.type === "heading" && Number(n.attrs?.level ?? 1) === 1;

/** The body nodes: everything after the title heading (the Title extension guarantees it's first). */
function bodyNodes(doc: unknown): Node[] {
  const nodes = Array.isArray((doc as Node | null)?.content) ? ((doc as Node).content as Node[]) : [];
  return nodes.length && isTitleNode(nodes[0]) ? nodes.slice(1) : nodes;
}

/** The page's body blocks as text. Empty blocks are dropped. */
export function bodyBlocks(doc: unknown): string[] {
  return bodyNodes(doc).map(blockText).map((t) => t.trim()).filter(Boolean);
}
export const bodyText = (doc: unknown): string => bodyBlocks(doc).join("\n\n");

/** The plain title text (marks stripped) from the doc's title heading, or "". */
export function docTitle(doc: unknown): string {
  const nodes = Array.isArray((doc as Node | null)?.content) ? ((doc as Node).content as Node[]) : [];
  const plain = (ns: Node[] | undefined): string => (ns ?? []).map((n) => (n.type === "text" ? n.text ?? "" : plain(n.content))).join("");
  return nodes.length && isTitleNode(nodes[0]) ? plain(nodes[0].content).trim() : "";
}

export const wordCount = (text: string): number => (text.trim() ? text.trim().split(/\s+/).length : 0);

// ── Inverse: text → nodes ──
const inline = (text: string): Node[] => {
  const lines = text.split("\n");
  const out: Node[] = [];
  lines.forEach((line, i) => {
    if (i > 0) out.push({ type: "hardBreak" });
    out.push(...(inlineMarkdownToNodes(line) as Node[]));
  });
  return out;
};
const paragraph = (text: string): Node => {
  const content = inline(text);
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
};

/** Build a node for one text block the original page didn't already have. */
export function parseBlock(block: string): Node {
  const lines = block.split("\n");
  const single = lines.length === 1 ? lines[0] : null;
  if (single !== null) {
    const h = single.match(/^(#{1,6})\s+(.*)$/);
    // Body headings never reuse level 1 — that's the page title's level.
    if (h) return { type: "heading", attrs: { level: Math.max(2, h[1].length) }, content: inline(h[2]) };
    if (/^---+$/.test(single)) return { type: "horizontalRule" };
    const img = single.match(/^!\[(.*?)\]\((.*?)\)$/);
    if (img) return { type: "image", attrs: { src: img[2], alt: img[1] } };
  }
  const fence = block.match(/^```(\w*)\n([\s\S]*?)\n?```$/);
  if (fence) return { type: "codeBlock", attrs: { language: fence[1] || null }, content: fence[2] ? [{ type: "text", text: fence[2] }] : [] };
  if (lines.every((l) => /^- /.test(l))) {
    return { type: "bulletList", content: lines.map((l) => ({ type: "listItem", content: [paragraph(l.slice(2))] })) };
  }
  if (lines.every((l) => /^\d+\. /.test(l))) {
    return { type: "orderedList", content: lines.map((l) => ({ type: "listItem", content: [paragraph(l.replace(/^\d+\. /, ""))] })) };
  }
  if (lines.every((l) => /^> ?/.test(l))) {
    return { type: "blockquote", content: [paragraph(lines.map((l) => l.replace(/^> ?/, "")).join("\n"))] };
  }
  return paragraph(block);
}

/** Split a body text into its blocks (the projection's normal form). */
export const splitBlocks = (body: string): string[] =>
  body.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((b) => b.replace(/[ \t]+$/gm, "").trim()).filter(Boolean);

/**
 * A page doc for `title` + `body`, reusing every original node whose projection matches a body block
 * (so untouched blocks keep their formatting) and building only the rest from text.
 */
export function docFromBody(original: unknown, title: string, body: string): EditorJSON {
  const origNodes = Array.isArray((original as Node | null)?.content) ? ((original as Node).content as Node[]) : [];
  const origTitle = origNodes.length && isTitleNode(origNodes[0]) ? origNodes[0] : null;
  const titleNode: Node = origTitle && docTitle(original) === title.trim()
    ? origTitle
    : { type: "heading", attrs: { level: 1 }, content: title.trim() ? [{ type: "text", text: title.trim() }] : [] };
  // Pool the original body nodes by their projection; a block that still reads the same takes its
  // original node back (first unused match, so repeated identical paragraphs pair up in order).
  const pool = new Map<string, Node[]>();
  for (const n of bodyNodes(original)) {
    const key = blockText(n).trim();
    if (!key) continue;
    const q = pool.get(key) ?? [];
    q.push(n);
    pool.set(key, q);
  }
  const content: Node[] = [titleNode];
  for (const block of splitBlocks(body)) {
    const reuse = pool.get(block)?.shift();
    content.push(reuse ?? parseBlock(block));
  }
  return { type: "doc", content };
}
