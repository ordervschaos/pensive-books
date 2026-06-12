// sequel — createSequel() and the canon packet (docs/pinned_method.md §8).
//
// Canon is to a sequel what a pin is to a draft: settled fact generation must honor and never
// contradict. The packet is computed HERE, once, from whatever the parent actually has (old-flow
// parents lack foundations, delta-less parents lack final_state — every field optional), written
// to books.canon and read-only after. The edge mirror of the type + the prompt renderer live in
// supabase/functions/_shared/canon-core.ts — keep the two in sync.
import { supabase } from "@/integrations/supabase/client";
import { foldStateIn, type CharacterState, type DeltaType, type PageMeta } from "@/lib/planProvenance";
import { type CastMember, type Foundations, type SpineNode } from "@/lib/foundations";
import { type Brief } from "@/lib/brief";

export interface CanonThread { name: string; description?: string | null }

export interface CanonPacket {
  parent_book_id: number;
  parent_title: string;
  summary?: string;                 // parent spine text — the throughline as actually built
  ending?: string;                  // how book 1 landed (parent foundations.ending.text)
  final_state?: Record<DeltaType, Record<string, string>>; // fold of ALL parent pages
  character_states?: CharacterState[]; // last ledger snapshot from the parent's final prose page
  cast?: CastMember[];              // parent cast as book 1 left them
  resolved_threads?: CanonThread[]; // paid promises — never re-opened as if unpaid
  carried_threads?: CanonThread[];  // open at parent end — the sequel's hooks
}

interface ParentPage {
  page_index: number;
  page_type: string | null;
  metadata: PageMeta | null;
}

const hasState = (s: Record<DeltaType, Record<string, string>>) =>
  Object.values(s).some((rec) => Object.keys(rec).length > 0);

/**
 * Create a sequel to `parentBookId`: compute the canon packet, insert the new book (new rail,
 * voice carried pinned, brief prefilled with the parent's genre/audience/tone), and copy the
 * parent's open threads in as 'carryover' hooks. Returns the new book's id.
 */
export async function createSequel(parentBookId: number): Promise<number> {
  const [{ data: parent, error: parentErr }, { data: pageRows }, { data: threadRows }] = await Promise.all([
    supabase.from("books").select("id, name, author, brief, spine, foundations").eq("id", parentBookId).single(),
    supabase.from("pages").select("page_index, page_type, metadata")
      .eq("book_id", parentBookId).eq("archived", false).order("page_index", { ascending: true }),
    supabase.from("book_threads").select("name, description, status").eq("book_id", parentBookId),
  ]);
  if (parentErr || !parent) throw parentErr ?? new Error("Book not found");

  const pages = (pageRows as ParentPage[] | null) ?? [];
  const threads = (threadRows as Array<{ name: string; description: string | null; status: string }> | null) ?? [];
  const f = (parent.foundations as Foundations | null) ?? null;
  const spine = (parent.spine as SpineNode | null) ?? null;

  // ── The canon packet ──────────────────────────────────────────────────────
  const finalState = foldStateIn(pages.map((p) => p.metadata ?? {}));
  const lastLedger = pages
    .filter((p) => (p.metadata?.character_states?.length ?? 0) > 0)
    .at(-1)?.metadata?.character_states;
  const toCanonThread = (t: { name: string; description: string | null }): CanonThread =>
    ({ name: t.name, ...(t.description ? { description: t.description } : {}) });
  const resolved = threads.filter((t) => t.status === "closed").map(toCanonThread);
  // 'planned' threads were never planted in the parent — they carry nothing.
  const carried = threads.filter((t) => t.status === "open").map(toCanonThread);

  const canon: CanonPacket = {
    parent_book_id: parent.id as number,
    parent_title: parent.name as string,
    ...(spine?.text?.trim() ? { summary: spine.text.trim() } : {}),
    ...(f?.ending?.text?.trim() ? { ending: f.ending.text.trim() } : {}),
    ...(hasState(finalState) ? { final_state: finalState } : {}),
    ...(lastLedger?.length ? { character_states: lastLedger } : {}),
    ...(f?.cast?.length ? { cast: f.cast } : {}),
    ...(resolved.length ? { resolved_threads: resolved } : {}),
    ...(carried.length ? { carried_threads: carried } : {}),
  };

  // ── Seed the sequel ───────────────────────────────────────────────────────
  // Voice continuity is the default: the exemplar the author chose in book 1 is carried, pinned.
  // (Unpin/regenerate in the Voice sub-step is the escape hatch.) {} still flips the new rail on.
  const foundations: Foundations = f?.voice_exemplar?.text?.trim()
    ? { voice_exemplar: { text: f.voice_exemplar.text, pinned: true, author_edited_at: new Date().toISOString() } }
    : {};

  const parentBrief = (parent.brief as Brief | null) ?? null;
  const brief: Brief | null = parentBrief
    ? {
        ...(parentBrief.genre ? { genre: parentBrief.genre } : {}),
        ...(parentBrief.audience ? { audience: parentBrief.audience } : {}),
        ...(parentBrief.tone?.length ? { tone: parentBrief.tone } : {}),
      }
    : null;

  const { data: created, error: insertErr } = await supabase
    .from("books")
    .insert({
      name: `Sequel to ${parent.name}`,
      author: (parent.author as string | null) ?? null,
      is_public: false,
      parent_book_id: parent.id,
      canon,
      foundations,
      ...(brief && Object.keys(brief).length ? { brief } : {}),
    })
    .select("id")
    .single();
  if (insertErr || !created) throw insertErr ?? new Error("Could not create the sequel");

  if (carried.length) {
    const { error: threadErr } = await supabase.from("book_threads").insert(
      carried.map((t) => ({
        book_id: created.id,
        name: t.name,
        description: t.description ?? null,
        status: "planned",
        source: "carryover",
      })),
    );
    if (threadErr) throw threadErr;
  }

  return created.id as number;
}
