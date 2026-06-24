// DnaCharacterLook — the "design the look" panel on a DNA character NodeCard in picture-book mode
// (docs/picture-book-mode.md). Renders portrait VARIANTS from the character node, lets the author pin the
// good one(s) onto character.content.portraits — the likeness references scene illustration feeds back in
// so the character stays consistent across scenes. Variants are ephemeral (local) until pinned.
import { useEffect, useState } from "react";
import { Sparkles, X, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ActionLink, Eyebrow, RunningInline } from "@/components/book/studio/studioUi";
import { renderDnaPortraitVariants, pinCharacterPortrait, unpinCharacterPortrait, legacyPortraitsFor } from "@/lib/characterPortraits";
import { type CharacterContent, type DnaNode } from "@/lib/novelDna";

export function DnaCharacterLook({ node, bookId, onChanged }: { node: DnaNode; bookId: number; onChanged: () => void }) {
  const { toast } = useToast();
  const [variants, setVariants] = useState<string[]>([]);
  const [legacy, setLegacy] = useState<string[]>([]);
  const [busy, setBusy] = useState<"render" | "pin" | null>(null);
  const pinned = ((node.content as CharacterContent).portraits ?? []).filter(Boolean);
  const named = !!(node.content as CharacterContent).name?.trim();

  // Already-migrated books: surface the portraits this character has in foundations.cast (by name) so the
  // author can reuse existing "design the look" art without re-migrating. Re-checks when pins change.
  useEffect(() => {
    let live = true;
    void legacyPortraitsFor(bookId, node).then((urls) => { if (live) setLegacy(urls); }).catch(() => {});
    return () => { live = false; };
  }, [bookId, node]);

  const render = async () => {
    setBusy("render");
    try { setVariants(await renderDnaPortraitVariants(bookId, node.id, { count: 3 })); }
    catch (e) { toast({ title: "Couldn't design the look", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
    finally { setBusy(null); }
  };
  const pin = async (url: string) => {
    setBusy("pin");
    try { await pinCharacterPortrait(node, url); setVariants((v) => v.filter((u) => u !== url)); setLegacy((l) => l.filter((u) => u !== url)); onChanged(); }
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

      {/* Fresh variants — click one to pin it as a reference. */}
      {variants.length > 0 && (
        <div className="space-y-1">
          <span className="pv-mono text-[9px] uppercase tracking-[0.1em] text-[hsl(var(--pv-text-faint))]">pick to pin →</span>
          <div className="flex flex-wrap gap-2">
            {variants.map((url) => (
              <button key={url} onClick={() => pin(url)} disabled={busy === "pin"} title="pin as a reference portrait"
                className="group relative overflow-hidden rounded-md border border-[hsl(var(--pv-border-soft))] transition-opacity hover:opacity-90 disabled:opacity-50">
                <img src={url} alt="portrait variant" className="h-16 w-16 object-cover" />
                <span className="absolute inset-0 hidden items-center justify-center bg-[hsl(var(--pv-accent))]/30 group-hover:flex">
                  <Check className="h-4 w-4 text-white" />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {busy === "render"
        ? <RunningInline label="designing the look…" />
        : <ActionLink icon={<Sparkles className="h-3.5 w-3.5" />} onClick={render} title={named ? undefined : "name the character first"}
            tone="faint">{pinned.length || variants.length ? "design more" : "design the look"}</ActionLink>}
    </div>
  );
}
