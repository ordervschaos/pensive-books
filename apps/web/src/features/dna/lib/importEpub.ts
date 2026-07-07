// importEpub — draft onboarding: an .epub becomes a new book whose DNA tree carries the prose.
// Layer A of the decomposition (mechanical, no LLM): parse → adapt to MigrationInput → reuse
// buildDnaFromStack → save + render. The top rungs (seed/premise/pillar) land empty — the
// semantic ascent that infers them is a later layer.
//
// Epistemic flip vs a generated book: here the PROSE is ground truth and the plan is scaffolding,
// so imported scene prose is stamped source:"user", locked:true — tree edits + re-render must
// never clobber the author's words.
import { supabase } from "@/integrations/supabase/client";
import { parseEpub, type ImportedDraft } from "@/lib/epubImport";
import { saveNodes } from "@/features/dna/lib/bookNodes";
import { buildDnaFromStack, type MigrationPage } from "@/features/dna/lib/migrateToDna";
import { reconcileDna } from "@/features/dna/lib/novelDnaRender";
import type { DnaNode } from "@/features/dna/lib/novelDna";

/** Adapt a parsed draft to migrateToDna's input: a section page per chapter, a text page per scene. */
export function draftToMigrationPages(draft: ImportedDraft): MigrationPage[] {
  const pages: MigrationPage[] = [];
  for (const ch of draft.chapters) {
    pages.push({ id: pages.length, page_index: pages.length, page_type: "section", title: ch.title, content: null, metadata: null });
    for (const scene of ch.scenes) {
      // content is a plain string — buildDnaFromStack's extractProse passes strings through.
      pages.push({ id: pages.length, page_index: pages.length, page_type: "text", title: ch.title, content: scene, metadata: null });
    }
  }
  return pages;
}

/** Imported prose is the author's: mark it user-authored and locked (hashes stay — they cover content, not authoring). */
export function lockImportedProse(nodes: DnaNode[]): DnaNode[] {
  return nodes.map((n) =>
    n.kind === "scene" && (n.content as { prose?: { text?: string } }).prose?.text
      ? { ...n, authoring: { ...n.authoring, source: "user" as const, locked: true } }
      : n,
  );
}

export interface EpubImportResult { bookId: number; title: string; chapters: number; scenes: number; words: number }

/** Whole onboarding flow: epub file → new books row → DNA tree → rendered pages. */
export async function importEpubAsBook(file: Blob | ArrayBuffer): Promise<EpubImportResult> {
  const draft = await parseEpub(file);
  if (!draft.chapters.some((c) => c.scenes.length)) throw new Error("No readable chapters found in this epub.");

  const { data: book, error } = await supabase
    .from("books")
    .insert({ name: draft.title, author: draft.author, is_public: false })
    .select()
    .single();
  if (error) throw error;
  const bookId = (book as { id: number }).id;

  const nodes = lockImportedProse(
    buildDnaFromStack(bookId, { brief: null, foundations: null, spine: null, pages: draftToMigrationPages(draft) }),
  );
  await saveNodes(nodes);
  await reconcileDna(bookId);

  const scenes = draft.chapters.reduce((a, c) => a + c.scenes.length, 0);
  const words = draft.chapters.reduce((a, c) => a + c.scenes.reduce((w, s) => w + s.split(/\s+/).filter(Boolean).length, 0), 0);
  return { bookId, title: draft.title, chapters: draft.chapters.length, scenes, words };
}
