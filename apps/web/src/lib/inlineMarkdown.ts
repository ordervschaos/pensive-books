// Generated prose comes back as plain paragraphs with inline markdown emphasis
// (*italic*, _italic_, **bold**, __bold__). Inserting it as a bare text node renders the
// asterisks literally, so convert that inline markdown into TipTap text nodes with marks.
// Intentionally minimal — inline emphasis only, no block markdown (the generators return
// paragraph prose, not headings/lists).

interface InlineNode {
  type: "text";
  text: string;
  marks?: { type: string }[];
}

interface ParagraphNode {
  type: "paragraph";
  content?: InlineNode[];
}

// One paragraph's text → inline text nodes, applying bold/italic marks.
export function inlineMarkdownToNodes(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  // **bold** / __bold__  (group 1 = delimiter, 2 = inner)  OR  *italic* / _italic_ (3, 4)
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

// Prose blob → paragraph nodes (split on blank lines, collapse intra-paragraph whitespace).
export function proseToParagraphs(prose: string): ParagraphNode[] {
  return prose
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((p) => {
      const content = inlineMarkdownToNodes(p);
      return content.length ? { type: "paragraph" as const, content } : { type: "paragraph" as const };
    });
}

interface HeadingNode {
  type: "heading";
  attrs: { level: number };
  content: InlineNode[];
}
interface ImageNode {
  type: "image";
  attrs: { src: string };
}
interface DocNode {
  type: "doc";
  content: (HeadingNode | ParagraphNode | ImageNode)[];
}

// Build a page doc from generated/revised prose: a leading h1 title (the Title extension
// requires it) followed by the prose as paragraphs. Shared by the generation cascade
// (WriteAllPages) and the AI reviser (ReviseWithAI).
export function buildDoc(title: string | null, prose: string): DocNode {
  const heading: HeadingNode = {
    type: "heading",
    attrs: { level: 1 },
    content: title ? [{ type: "text", text: title }] : [],
  };
  return { type: "doc", content: [heading, ...proseToParagraphs(prose)] };
}

// Build a picture-book page doc: a leading (empty) h1 the Title extension requires, the scene illustration,
// then the caption as paragraphs. Used by the DNA reconcile for picture-mode image pages (one per scene).
export function buildImageDoc(imageUrl: string | null | undefined, caption: string): DocNode {
  const heading: HeadingNode = { type: "heading", attrs: { level: 1 }, content: [] };
  const content: (HeadingNode | ParagraphNode | ImageNode)[] = [heading];
  if (imageUrl) content.push({ type: "image", attrs: { src: imageUrl } });
  content.push(...proseToParagraphs(caption));
  return { type: "doc", content };
}
