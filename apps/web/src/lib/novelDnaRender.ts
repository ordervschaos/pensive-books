// novelDnaRender — Phase 2: render the Novel DNA tree onto `pages` (the reader-facing projection).
//
// A chapter → a SECTION page (title) + a TEXT page (its scenes' prose, concatenated). The DNA tree is the
// source of truth; pages are produced here and nowhere else. Incremental (only changed rows write),
// non-destructive (archive, never hard-delete), idempotent (keyed on pages.metadata.node_id = "ch:…").
// Generalizes lib/outline.ts's reconcile one level up (chapter, not scene, is the page unit). Spec §8.
import { supabase } from "@/integrations/supabase/client";
import { buildDoc, buildImageDoc } from "@/lib/inlineMarkdown";
import { loadTree } from "@/lib/bookNodes";
import { renderPages, type RenderedPage } from "@/lib/novelDna";

export interface DnaRenderResult { created: number; updated: number; archived: number; pages: number }

interface PageRow {
  id: number;
  page_index: number;
  page_type: string | null;
  title: string | null;
  content: unknown;
  archived: boolean | null;
  metadata: { node_id?: string } | null;
}

const sig = (title: string, type: string, idx: number, content: unknown): string =>
  JSON.stringify([title, type, idx, content]);

/** Render a book's DNA tree to its pages. The DNA owns the whole page list for a DNA-native book. */
export async function reconcileDna(bookId: number): Promise<DnaRenderResult> {
  const nodes = await loadTree(bookId);
  const { data: book } = await supabase.from("books").select("mode").eq("id", bookId).maybeSingle();
  const mode = (book as { mode?: "prose" | "picture" } | null)?.mode === "picture" ? "picture" : "prose";
  const desired: RenderedPage[] = renderPages(nodes, mode);

  const { data: pageData } = await supabase
    .from("pages").select("id, page_index, page_type, title, content, archived, metadata").eq("book_id", bookId);
  const pages = (pageData as PageRow[] | null) ?? [];
  const byNode = new Map<string, PageRow>();
  for (const p of pages) {
    const nid = p.metadata?.node_id;
    if (nid && !byNode.has(nid)) byNode.set(nid, p);
  }

  const result: DnaRenderResult = { created: 0, updated: 0, archived: 0, pages: desired.length };
  const wanted = new Set(desired.map((d) => d.nodeId));

  for (let i = 0; i < desired.length; i++) {
    const d = desired[i];
    // section: heading only · text: heading + prose · image (picture mode): heading + illustration + caption.
    // Image pages persist as page_type "text" (their doc just happens to lead with an image) — no new page
    // type, so the reader/marketing render and word-count filters are untouched.
    const content = d.kind === "image" ? buildImageDoc(d.imageUrl, d.proseText || d.caption || "") : buildDoc(d.title, d.proseText);
    const pageType = d.kind === "section" ? "section" : "text";
    let page = byNode.get(d.nodeId);
    if (!page) {
      const { data: created, error } = await supabase.rpc("create_next_page", { p_book_id: bookId }).select().single();
      if (error) throw error;
      page = { ...(created as PageRow), metadata: {} };
      result.created += 1;
    }
    const unchanged = !page.archived && page.page_index === i && page.title === d.title &&
      page.page_type === pageType && sig(page.title ?? "", page.page_type ?? "", page.page_index, page.content) === sig(d.title, pageType, i, content);
    if (!unchanged) {
      const { error } = await supabase.from("pages").update({
        title: d.title, page_type: pageType, archived: false, page_index: i, content,
        metadata: { ...(page.metadata ?? {}), node_id: d.nodeId },
      }).eq("id", page.id);
      if (error) throw error;
      result.updated += 1;
    }
  }

  // The DNA owns the page list: archive any live page it no longer produces (soft — prose is recoverable).
  for (const p of pages) {
    const nid = p.metadata?.node_id;
    if (!p.archived && !(nid && wanted.has(nid))) {
      await supabase.from("pages").update({ archived: true }).eq("id", p.id);
      result.archived += 1;
    }
  }
  return result;
}
