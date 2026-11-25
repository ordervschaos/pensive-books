// manuscript-agent shared kernel: the run-row shape, the staged-change shape, and the page-text
// serializer every module (and the web client) agrees on.
//
// This agent works on the BOOK — books + pages — not the story DNA (that's book-agent over book_nodes).
// Pages are TipTap JSON; the model never sees JSON. It reads and writes a plain-text projection:
// the page's body as blocks separated by blank lines, `## ` headings, `- ` lists, `**bold**`/`*italic*`.
// The client re-derives the SAME projection from the live page (features/manuscript/lib/manuscriptText.ts,
// a byte-for-byte mirror of blockText below) and diffs it against the proposed text, so a change the
// agent stages here shows up as exactly the words it changed, never as serializer noise. Keep the two
// serializers identical.
import type { CanvasSnapshot } from "./canvas.ts";

// ── Row shapes ──
// Same feed vocabulary as the Studio thread (StepBubble-compatible), plus 'action' — a smart chat unit
// (e.g. a Publish button) the agent renders instead of doing something only the author may do.
interface Finding { ref: string; finding: string }
interface AgentStep {
  t: "user" | "note" | "read" | "ask" | "answer" | "plan" | "done" | "finding" | "action" | "applied" | "discarded" | "memory";
  label: string;
  options?: string[];
  findings?: Finding[];
  action?: "publish" | "open_page" | "open_studio";
  pageId?: number;
  canvas?: CanvasSnapshot; // user/answer: validated snapshot of what was open when sent
  change?: ManuscriptChange; // applied/discarded: the resolved change
  by?: "agent";              // discarded: withdrawn by the agent, not rejected by the author
}
interface Pending { tool_use_id: string; question: string; options?: string[]; preResults?: unknown[] }

// A reviewable change against the book. Flat list on book_agent_runs.proposals; each is accepted or
// rejected on its own (and page_edit additionally at block/word granularity, client-side).
//   page_edit   — body text before → after (+ optional new title). `before` is the live body at propose
//                 time; the client always diffs the LIVE page against `after`, so `before` is a record.
//   page_add    — a new page after `afterPageId` (null = first page).
//   page_delete — archive a page.
//   page_move   — move a page so it sits after `afterPageId` (null = first).
//   book_edit   — one of the book's text fields.
type ManuscriptChange =
  | { id: string; kind: "page_edit"; pageId: number; title?: string | null; before: string; after: string; note?: string }
  | { id: string; kind: "page_add"; afterPageId: number | null; pageType: "text" | "section"; title: string; text: string; note?: string }
  | { id: string; kind: "page_delete"; pageId: number; note?: string }
  | { id: string; kind: "page_move"; pageId: number; afterPageId: number | null; note?: string }
  | { id: string; kind: "book_edit"; field: "name" | "subtitle" | "author"; before: string; after: string; note?: string };

interface RunRow {
  id: number;
  book_id: number;
  created_by: string | null;
  kind: string; // 'manuscript'
  status: string;
  transcript: unknown[];
  steps: AgentStep[];
  pending: Pending | null;
  proposals: ManuscriptChange[] | null;
  context_model: string | null; // author-picked tier key; null = admin default
  turns: number;
  cancel_requested: boolean;
  title: string | null;
  memory: string[] | null; // standing author preferences for the book; survives "New chat"
}
const ROW_COLS = "id, book_id, created_by, kind, status, transcript, steps, pending, proposals, context_model, turns, cancel_requested, title, memory";

interface PageRow { id: number; page_index: number; page_type: string | null; title: string | null; content: unknown; archived: boolean | null }
interface BookRow { id: number; name: string | null; subtitle: string | null; author: string | null; is_public: boolean | null }

// ── Page text projection (MIRROR of apps/web/src/features/manuscript/lib/manuscriptText.ts) ──
// deno-lint-ignore no-explicit-any
type Node = { type?: string; text?: string; marks?: { type: string }[]; attrs?: Record<string, any>; content?: Node[] };

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

function blockText(n: Node): string {
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

/** The page's body blocks (everything after the title heading), as text. Empty blocks are dropped. */
function bodyBlocks(doc: unknown): string[] {
  const d = doc as Node | null;
  const nodes = Array.isArray(d?.content) ? d!.content! : [];
  const body = nodes.length && nodes[0].type === "heading" && Number(nodes[0].attrs?.level ?? 1) === 1 ? nodes.slice(1) : nodes;
  return body.map(blockText).map((t) => t.trim()).filter(Boolean);
}
const bodyText = (doc: unknown): string => bodyBlocks(doc).join("\n\n");
const wordCount = (text: string): number => (text.trim() ? text.trim().split(/\s+/).length : 0);

/** Short label for a page in feed lines and book state. */
const pageHandle = (p: { page_index: number; title: string | null }) => `p${p.page_index + 1} "${(p.title ?? "").trim() || "Untitled"}"`;

export { ROW_COLS, bodyBlocks, bodyText, pageHandle, wordCount };
export type { AgentStep, BookRow, Finding, ManuscriptChange, PageRow, Pending, RunRow };
