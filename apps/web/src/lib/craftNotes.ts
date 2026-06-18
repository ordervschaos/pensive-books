// craftNotes — read/write the per-book CRAFT NOTES (tier 2: the author-editable craft knowledge for
// each revision layer). Stored as books.craft_notes jsonb { layer: text }. The immutable tier-1 system
// craft lives in the edge lenses (e.g. supabase/functions/_shared/story-shapes.ts) and is NOT here —
// this is only the author's house style for this book, which the reviser stacks atop the system default.
import { supabase } from "@/integrations/supabase/client";
import type { RevisionLayer } from "./revisionChat";

type CraftNotes = Record<string, string>;

export async function readCraftNote(bookId: number, layer: RevisionLayer): Promise<string> {
  const { data, error } = await supabase.from("books").select("craft_notes").eq("id", bookId).maybeSingle();
  if (error) throw error;
  const notes = (data?.craft_notes as CraftNotes | null) ?? {};
  return typeof notes[layer] === "string" ? notes[layer] : "";
}

/** Merge one layer's note into books.craft_notes without dropping the others. Empty text clears it. */
export async function saveCraftNote(bookId: number, layer: RevisionLayer, text: string): Promise<void> {
  const { data, error: readErr } = await supabase.from("books").select("craft_notes").eq("id", bookId).maybeSingle();
  if (readErr) throw readErr;
  const notes: CraftNotes = { ...((data?.craft_notes as CraftNotes | null) ?? {}) };
  const t = text.trim();
  if (t) notes[layer] = t;
  else delete notes[layer];
  const { error } = await supabase.from("books").update({ craft_notes: notes }).eq("id", bookId);
  if (error) throw error;
}
