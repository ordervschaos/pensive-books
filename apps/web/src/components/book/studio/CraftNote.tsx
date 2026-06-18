// CraftNote — the author-editable craft tier (tier 2) for a revision layer, as a quiet disclosure under
// the step's content. The author's house style for THIS book, saved to books.craft_notes[layer]. The
// immutable system craft (distilled KB — e.g. story shapes for the spine) ALWAYS applies underneath;
// this only adds taste on top, so the reviser isn't "random and noob". Generic over layer so the same
// component drops into every step. Autosaves on blur, mirroring the step editors.
import { useEffect, useState } from "react";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { useToast } from "@/hooks/use-toast";
import { readCraftNote, saveCraftNote } from "@/lib/craftNotes";
import type { RevisionLayer } from "@/lib/revisionChat";

const PLACEHOLDER: Record<RevisionLayer, string> = {
  foundations: "House style for this book's foundations — e.g. 'the argument must cut against a comforting belief; no character without a wound that drives them.'",
  spine: "House style for this book's spine — e.g. 'aim for a Cinderella shape; the midpoint must be a betrayal, not a setback.'",
  outline: "House style for this book's outline — e.g. 'every chapter ends on a turn; no scene-setting chapter without a decision.'",
  beats: "House style for this book's beats — e.g. 'every beat names who wants what and what blocks it; no atmosphere-only beats.'",
};

export function CraftNote({ bookId, layer }: { bookId: number; layer: RevisionLayer }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let alive = true;
    void readCraftNote(bookId, layer)
      .then((t) => { if (alive) { setText(t); setLoaded(true); } })
      .catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [bookId, layer]);

  const save = async () => {
    if (!dirty) return;
    try {
      await saveCraftNote(bookId, layer, text);
      setDirty(false);
    } catch (e) {
      toast({ title: "Couldn't save craft notes", description: String((e as Error)?.message ?? e), variant: "destructive" });
    }
  };

  if (!loaded) return null;
  const has = !!text.trim();

  return (
    <div className="mt-8 border-t border-[hsl(var(--pv-border-soft))]/60 pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="pv-serif text-[12px] italic text-[hsl(var(--pv-text-faint))] transition-colors hover:text-[hsl(var(--pv-text))]"
      >
        {open ? "▾" : "▸"} Craft notes{has && !open ? " ·" : ""}{" "}
        <span className="not-italic opacity-60">— how the AI shapes this layer for this book</span>
      </button>
      {open && (
        <div className="mt-2 space-y-1">
          <AutoTextarea
            value={text}
            onChange={(e) => { setText(e.target.value); setDirty(true); }}
            onBlur={() => void save()}
            placeholder={PLACEHOLDER[layer]}
            className="pv-serif w-full rounded-md border border-[hsl(var(--pv-border-soft))]/60 bg-transparent px-3 py-2 text-[14px] leading-[1.6] focus-visible:ring-0"
          />
          <p className="pv-serif text-[11px] italic text-[hsl(var(--pv-text-faint))]">
            Built-in craft defaults always apply underneath. This adds your house style for this book.
          </p>
        </div>
      )}
    </div>
  );
}
