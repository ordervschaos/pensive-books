// migrateToDna — Phase 3: lift a book's legacy stack (brief/foundations/spine/outline + pages' prose)
// into the Novel DNA tree (book_nodes). The PURE builder is testable; the thin wrapper loads + saves.
// See docs/novel-dna-spec.md §9. Idempotent at the call site (caller clears prior nodes first).
import { supabase } from "@/integrations/supabase/client";
import { saveNodes } from "@/features/dna/lib/bookNodes";
import {
  byId, newId, stampInput, stampProse, type Authoring, type DnaNode, type NodeContent, type NodeKind,
} from "@/features/dna/lib/novelDna";
import { briefIdea, type Brief } from "@/lib/brief";
import type { CastMember, Foundations, Relationship, Tentpole, WorldNode } from "@/lib/foundations";

export interface MigrationPage {
  id: number; page_index: number; page_type: string | null; title: string | null;
  content: unknown; metadata: { objective?: string; beat?: string; pov?: string } | null;
}
export interface MigrationInput {
  brief: Brief | null;
  foundations: Foundations | null;
  spine: { text?: string } | null;
  pages: MigrationPage[];
}

// TipTap doc → plain text (paragraphs separated by blank lines), dropping the leading title heading.
function extractProse(content: unknown): string {
  if (!content || typeof content !== "object") return typeof content === "string" ? content : "";
  const doc = content as { content?: Array<Record<string, unknown>> };
  if (!Array.isArray(doc.content)) return "";
  const blocks = doc.content[0]?.type === "heading" ? doc.content.slice(1) : doc.content;
  const walk = (n: Record<string, unknown>): string =>
    n.type === "text" ? String(n.text ?? "")
      : n.type === "hardBreak" ? "\n"
        : ((n.content as Array<Record<string, unknown>>) ?? []).map(walk).join("");
  return blocks.map(walk).join("\n\n").trim();
}
const words = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);
const accepted = (locked = false): Authoring => ({ source: "ai_then_user", locked, status: "accepted" });

/** Build the whole DNA tree from a legacy book. Pure — no DB. Returns nodes (unstamped order). */
export function buildDnaFromStack(bookId: number, input: MigrationInput): DnaNode[] {
  const { brief, foundations: f, spine, pages } = input;
  const nodes: DnaNode[] = [];
  const mk = (kind: NodeKind, level: number, parent_id: string | null, content: NodeContent, authoring: Authoring, position = 0): DnaNode => {
    const n: DnaNode = { id: newId(), book_id: bookId, parent_id, level, kind, position, content, authoring };
    nodes.push(n);
    return n;
  };

  // ── Ladder top: seed → premise → pillar ───────────────────────────────────
  const seed = mk("seed", 0, null, { logline: (briefIdea(brief) ?? "").trim() }, accepted());
  // genre/tone stay on the brief (the contract) — not duplicated onto the premise node.
  const premise = mk("premise", 1, seed.id, {
    shape: spine?.text?.trim() ? { setup: spine.text.trim() } : {},
  }, accepted(!!spine?.text));
  const pillar = mk("pillar", 2, premise.id, {
    controlling_idea: (f?.argument?.text ?? "").trim(), ending: (f?.ending?.text ?? "").trim(),
  }, accepted(!!(f?.argument?.pinned || f?.ending?.pinned)));

  // ── Entity branch off the pillar ───────────────────────────────────────────
  const roleMap = { protagonist: "protagonist", major: "ally", minor: "minor" } as const;
  const charByOldId = new Map<string, string>();   // cast.id → node id
  const charByName = new Map<string, string>();     // name (lower) → node id (legacy pov is a name)
  (f?.cast ?? []).forEach((c: CastMember, i) => {
    const node = mk("character", 2, pillar.id, {
      name: c.name, role: roleMap[c.role ?? "minor"] ?? "minor",
      want: c.want, wound: c.wound, lie: c.lie, idiolect: c.idiolect,
      // The visual descriptor + already-approved "design the look" portraits carry over so a migrated book
      // keeps its character art in picture mode (docs/picture-book-mode.md) — tag falls back to the longer
      // appearance when empty; portraits feed scene renders for likeness.
      tag: c.tag || c.appearance,
      ...(c.portraits?.length ? { portraits: c.portraits } : {}),
    }, accepted((c.pinned_fields?.length ?? 0) > 0), i);
    charByOldId.set(c.id, node.id);
    if (c.name) charByName.set(c.name.trim().toLowerCase(), node.id);
  });
  (f?.relationships ?? []).forEach((r: Relationship, i) => {
    mk("relationship", 2, pillar.id, { a: charByOldId.get(r.a), b: charByOldId.get(r.b), bond: r.bond }, accepted(!!r.pinned), 100 + i);
  });
  const tentpoleByPage = new Map<number, string>(); // placed_page_id → tentpole node id
  (f?.tentpoles ?? []).filter((t: Tentpole) => t.status !== "killed").forEach((t: Tentpole, i) => {
    const node = mk("tentpole", 2, pillar.id, { summary: t.text },
      { source: "ai_then_user", locked: t.status === "pinned", status: t.status === "pinned" ? "accepted" : "proposed" }, 200 + i);
    if (t.placed_page_id) tentpoleByPage.set(t.placed_page_id, node.id);
  });
  const world = f?.world as WorldNode | undefined;
  (world?.rules ?? []).forEach((rule, i) => mk("world_fact", 2, pillar.id, { rule }, accepted(!!world?.pinned), 300 + i));

  // ── Narrative spine: one act; one beat per chapter; a scene per text page ──
  const act = mk("act", 3, pillar.id, { title: "The Book" }, accepted(), 1000);
  let beat: DnaNode | null = null;
  let pendingChapterTitle: string | null = null;
  let beatPos = 0, scenePos = 0;
  const ordered = [...pages].sort((a, b) => a.page_index - b.page_index);
  for (const p of ordered) {
    if (p.page_type === "section") {
      beat = mk("beat", 4, act.id, { summary: (p.title ?? "").trim() }, accepted(), beatPos++);
      pendingChapterTitle = (p.title ?? "").trim() || "Chapter";
      scenePos = 0;
      continue;
    }
    if (!beat) { beat = mk("beat", 4, act.id, { summary: "Opening" }, accepted(), beatPos++); }
    const prose = extractProse(p.content);
    const povName = p.metadata?.pov?.trim().toLowerCase();
    const content: NodeContent = {
      goal: (p.metadata?.objective ?? "").trim(),
      ...(povName && charByName.has(povName) ? { pov: charByName.get(povName) } : {}),
      ...(tentpoleByPage.has(p.id) ? { realizes_tentpole: tentpoleByPage.get(p.id) } : {}),
      ...(pendingChapterTitle != null ? { chapter_start: { title: pendingChapterTitle } } : {}),
      ...(prose ? { prose: { text: prose, words: words(prose) } } : {}),
    };
    mk("scene", 5, beat.id, content, accepted(), scenePos++);
    pendingChapterTitle = null;
  }

  // Stamp provenance so day-one reads are not falsely stale (parents/refs already final here).
  const index = byId(nodes);
  return nodes.map((n) => {
    let out = stampInput(n, index);
    if (n.kind === "scene" && (n.content as { prose?: { text?: string } }).prose?.text) out = stampProse(out);
    return out;
  });
}

/** Load a book's legacy stack, build the DNA tree, and persist it. Clears any prior nodes first. */
export async function migrateBookToDna(bookId: number): Promise<{ count: number }> {
  const [{ data: book }, { data: pageData }] = await Promise.all([
    supabase.from("books").select("brief, foundations, spine").eq("id", bookId).maybeSingle(),
    supabase.from("pages").select("id, page_index, page_type, title, content, metadata").eq("book_id", bookId).eq("archived", false).order("page_index", { ascending: true }),
  ]);
  await supabase.from("book_nodes").delete().eq("book_id", bookId); // idempotent: rebuild from scratch
  const nodes = buildDnaFromStack(bookId, {
    brief: (book?.brief as Brief | null) ?? null,
    foundations: (book?.foundations as Foundations | null) ?? null,
    spine: (book?.spine as { text?: string } | null) ?? null,
    pages: (pageData as MigrationPage[] | null) ?? [],
  });
  await saveNodes(nodes);
  return { count: nodes.length };
}
