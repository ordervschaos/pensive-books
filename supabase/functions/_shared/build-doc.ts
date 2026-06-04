// build-doc — Deno port of apps/web/src/lib/inlineMarkdown.ts's buildDoc.
//
// Generated prose comes back as plain paragraphs with inline markdown emphasis (*italic*,
// **bold**). The page body is TipTap JSON, so we convert that prose into a doc: a leading h1 title
// (the Title extension requires it) + the prose as paragraphs with inline marks. Kept byte-faithful
// to the client helper so a server-written page is identical to a client-written one.

interface InlineNode { type: "text"; text: string; marks?: { type: string }[] }
interface ParagraphNode { type: "paragraph"; content?: InlineNode[] }
interface HeadingNode { type: "heading"; attrs: { level: number }; content: InlineNode[] }
export interface DocNode { type: "doc"; content: (HeadingNode | ParagraphNode)[] }

function inlineMarkdownToNodes(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  const re = /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push({ type: "text", text: text.slice(last, m.index) });
    if (m[1]) nodes.push({ type: "text", text: m[2], marks: [{ type: "bold" }] });
    else nodes.push({ type: "text", text: m[4], marks: [{ type: "italic" }] });
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push({ type: "text", text: text.slice(last) });
  return nodes.filter((n) => n.text.length > 0);
}

function proseToParagraphs(prose: string): ParagraphNode[] {
  return prose
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((p) => {
      const content = inlineMarkdownToNodes(p);
      return content.length ? { type: "paragraph" as const, content } : { type: "paragraph" as const };
    });
}

export function buildDoc(title: string | null, prose: string): DocNode {
  const heading: HeadingNode = {
    type: "heading",
    attrs: { level: 1 },
    content: title ? [{ type: "text", text: title }] : [],
  };
  return { type: "doc", content: [heading, ...proseToParagraphs(prose)] };
}
