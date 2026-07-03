// DnaCharacterLook — the reference-portrait panel on a DNA character NodeCard in picture-book mode
// (docs/picture-book-mode.md). Lets the author pin an existing (legacy-migrated) portrait onto
// character.content.portraits — the likeness reference scene illustration feeds back in so the character
// stays consistent across scenes. Portrait generation is not available from the UI.
import { useEffect, useState } from "react";
import { X, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Eyebrow } from "@/components/book/shared/studioUi";
import { pinCharacterPortrait, unpinCharacterPortrait, legacyPortraitsFor } from "@/features/dna/lib/characterPortraits";
import { type CharacterContent, type DnaNode } from "@/features/dna/lib/novelDna";

export function DnaCharacterLook({ node, bookId, onChanged }: { node: DnaNode; bookId: number; onChanged: () => void }) {
  const { toast } = useToast();
  const [legacy, setLegacy] = useState<string[]>([]);
  const [busy, setBusy] = useState<"pin" | null>(null);
  const pinned = ((node.content as CharacterContent).portraits ?? []).filter(Boolean);

  // Already-migrated books: surface the portraits this character has in foundations.cast (by name) so the
  // author can reuse existing art without re-migrating. Re-checks when pins change.
  useEffect(() => {
    let live = true;
    void legacyPortraitsFor(bookId, node).then((urls) => { if (live) setLegacy(urls); }).catch(() => {});
    return () => { live = false; };
  }, [bookId, node]);

  const pin = async (url: string) => {
    setBusy("pin");
    try { await pinCharacterPortrait(node, url); setLegacy((l) => l.filter((u) => u !== url)); onChanged(); }
    catch (e) { toast({ title: "Couldn't pin", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
    finally { setBusy(null); }
  };
  const unpin = async (url: string) => {
    try { await unpinCharacterPortrait(node, url); onChanged(); }
    catch (e) { toast({ title: "Couldn't remove", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
  };

  return (
    <div className="mt-2.5 space-y-2 rounded-md border border-[hsl(var(--pv-border-soft))]/60 bg-[hsl(var(--pv-surface-2))]/30 px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <Eyebrow tone="muted">the look · reference portraits</Eyebrow>
        {pinned.length > 0 && <span className="pv-mono text-[9px] text-[hsl(var(--pv-text-faint))]">{pinned.length} pinned</span>}
      </div>

      {/* Pinned references — what scene renders feed in for likeness. */}
      {pinned.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {pinned.map((url) => (
            <div key={url} className="group relative">
              <img src={url} alt="reference portrait" className="h-16 w-16 rounded-md border border-[hsl(var(--pv-accent))]/40 object-cover" />
              <button onClick={() => unpin(url)} title="remove this reference"
                className="absolute -right-1.5 -top-1.5 hidden rounded-full bg-background p-0.5 text-[hsl(var(--pv-text-faint))] shadow-sm hover:text-destructive group-hover:block">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Reuse from the book — portraits this character already has in foundations.cast (pre-DNA). */}
      {legacy.length > 0 && (
        <div className="space-y-1">
          <span className="pv-mono text-[9px] uppercase tracking-[0.1em] text-[hsl(var(--pv-text-faint))]">from your book · pick to reuse →</span>
          <div className="flex flex-wrap gap-2">
            {legacy.map((url) => (
              <button key={url} onClick={() => pin(url)} disabled={busy === "pin"} title="reuse this existing portrait"
                className="group relative overflow-hidden rounded-md border border-[hsl(var(--pv-border-soft))] transition-opacity hover:opacity-90 disabled:opacity-50">
                <img src={url} alt="existing portrait" className="h-16 w-16 object-cover" />
                <span className="absolute inset-0 hidden items-center justify-center bg-[hsl(var(--pv-accent))]/30 group-hover:flex">
                  <Check className="h-4 w-4 text-white" />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {pinned.length === 0 && legacy.length === 0 && (
        <p className="pv-serif text-[12px] italic text-[hsl(var(--pv-text-faint))]">No reference portraits yet.</p>
      )}
    </div>
  );
}
