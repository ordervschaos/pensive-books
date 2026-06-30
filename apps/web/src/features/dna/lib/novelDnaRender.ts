// novelDnaRender — Phase 2: render the Novel DNA tree onto `pages` (the reader-facing projection).
//
// A chapter → a SECTION page (title) + a TEXT page (its scenes' prose, concatenated). The DNA tree is the
// source of truth; pages are produced here and nowhere else. Incremental (only changed rows write),
// non-destructive (archive, never hard-delete), idempotent (keyed on pages.metadata.node_id = "ch:…").
// Generalizes lib/outline.ts's reconcile one level up (chapter, not scene, is the page unit). Spec §8.
import { supabase } from "@/integrations/supabase/client";
import { buildDoc, buildImageDoc } from "@/lib/inlineMarkdown";
import { loadTree } from "@/features/dna/lib/bookNodes";
import { renderPages, type RenderedPage } from "@/features/dna/lib/novelDna";

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

  // Phase 0 — free the index namespace. The DNA owns the page list: archive (soft — prose is recoverable)
  // every live page it no longer produces. Doing this BEFORE renumbering is what prevents stale pages —
  // e.g. old chapter node_ids left behind after a DNA rebuild — from colliding on the partial unique index
  // (book_id, page_index) WHERE archived = false with the pages we're about to renumber into 0..N-1.
  for (const p of pages) {
    const nid = p.metadata?.node_id;
    if (!p.archived && !(nid && wanted.has(nid))) {
      const { error } = await supabase.from("pages").update({ archived: true }).eq("id", p.id);
      if (error) throw error;
      p.archived = true;
      result.archived += 1;
    }
  }

  // Phase 1 — get-or-create the page backing each desired node, and compute its final content.
  interface Target { page: PageRow; nodeId: string; title: string; pageType: string; content: unknown; index: number }
  const targets: Target[] = [];
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
    targets.push({ page, nodeId: d.nodeId, title: d.title, pageType, content, index: i });
  }

  // Phase 2 — park every page whose index must change into a temporary negative range. Negative indices
  // never collide with the live positive ones and stay unique among themselves, so the final assignment in
  // Phase 3 can never transiently put two live pages on the same index (reorders, rebuilds). Pages already
  // at their target index are left untouched — they are, by construction, the sole target for that index.
  let temp = -1;
  for (const t of targets) {
    if (!t.page.archived && t.page.page_index !== t.index) {
      const { error } = await supabase.from("pages").update({ page_index: temp }).eq("id", t.page.id);
      if (error) throw error;
      t.page.page_index = temp;
      temp -= 1;
    }
  }

  // Phase 3 — write each page's final index/content/title (skip rows already fully correct).
  for (const t of targets) {
    const p = t.page;
    const unchanged = !p.archived && p.page_index === t.index && p.title === t.title &&
      p.page_type === t.pageType && sig(p.title ?? "", p.page_type ?? "", p.page_index, p.content) === sig(t.title, t.pageType, t.index, t.content);
    if (!unchanged) {
      const { error } = await supabase.from("pages").update({
        title: t.title, page_type: t.pageType, archived: false, page_index: t.index, content: t.content,
        metadata: { ...(p.metadata ?? {}), node_id: t.nodeId },
      }).eq("id", p.id);
      if (error) throw error;
      result.updated += 1;
    }
  }
  return result;
}
