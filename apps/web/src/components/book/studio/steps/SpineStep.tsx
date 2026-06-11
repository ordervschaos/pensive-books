// SpineStep — the Spine step's Stage body: the book's one-paragraph throughline, derived from the
// brief. Every AI op here is now a DURABLE run (useAIRun → ai-run): generating/re-drafting the spine,
// generating wide alternatives, and revising survive navigation and refresh. A loud hero when there's
// no spine yet; the editable paragraph (autosaved on blur) once there is one. The Stage owns the gate.
import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAIRun } from "@/hooks/useAIRun";
import { DurableOptions } from "../../DurableOptions";
import { DurableReviser } from "../../DurableReviser";
import { readNode, saveSpine } from "@/lib/ladder";
import { Hero } from "../studioUi";

export function SpineStep({ bookId, onStatusChange, onChanged }: { bookId: number; onStatusChange: (v: boolean) => void; onChanged: () => void }) {
  const { toast } = useToast();
  const [spine, setSpine] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const appliedRef = useRef<number | null>(null);

  // Durable spine generation (single-candidate → auto-applies on ready).
  const gen = useAIRun<{ text: string }>({ bookId, kind: "spine", targetKey: "book" });
  // Keep the spinner through the ready→applied window so the auto-apply doesn't flash the hero.
  const generating = gen.run?.status === "running" || gen.run?.status === "pending" || gen.starting
    || (gen.run?.status === "ready" && !!gen.run.result?.text);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const text = await readNode(bookId, "spine");
      if (!alive) return;
      setSpine(text); setLoaded(true); onStatusChange(!!text.trim());
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  // Auto-apply a completed generation: save the spine, reflect it, mark the run applied (so it won't
  // re-fire). appliedRef guards against a double apply while the 'applied' write is in flight.
  useEffect(() => {
    const r = gen.run;
    if (r?.status === "ready" && r.result?.text && appliedRef.current !== r.id) {
      appliedRef.current = r.id;
      void gen.accept(async (res) => {
        await saveSpine(bookId, res.text);
        setSpine(res.text); setDirty(false); onStatusChange(!!res.text.trim()); onChanged();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gen.run?.id, gen.run?.status]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try { await saveSpine(bookId, spine.trim()); setDirty(false); onStatusChange(!!spine.trim()); onChanged(); }
    catch (e) { toast({ title: "Couldn't save the spine", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
    finally { setSaving(false); }
  };

  if (!loaded) return null;

  if (generating) {
    return (
      <div className="flex items-center gap-4">
        <p className="pv-serif inline-flex items-center gap-2 text-[14px] italic text-[hsl(var(--pv-text-muted))]"><Loader2 className="h-4 w-4 animate-spin" /> Drafting the spine…</p>
        <button type="button" onClick={() => void gen.cancel()} className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))] hover:text-foreground">cancel</button>
      </div>
    );
  }

  if (!spine.trim()) {
    return (
      <Hero icon={<Sparkles className="h-5 w-5" />} title="Draft the spine from the brief"
        sub="One paragraph that names the throughline — what the book is really about. The outline is built to realize it."
        onClick={() => void gen.start({})} />
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-[hsl(var(--pv-surface-2))]/50 px-6 py-5">
      <Textarea
        value={spine}
        onChange={(e) => { setSpine(e.target.value); setDirty(true); }}
        onBlur={() => dirty && void save()}
        rows={8}
        className="pv-serif border-none bg-transparent px-0 text-[16px] leading-[1.65] focus-visible:ring-0"
      />
      <div className="mt-3.5 flex items-center gap-5 border-t border-[hsl(var(--pv-border-soft))] pt-3.5 text-[13.5px]">
        <button type="button" onClick={() => void gen.start({})} className="inline-flex items-center gap-1.5 italic text-[hsl(var(--pv-accent))] hover:opacity-75">
          <RefreshCw className="h-3.5 w-3.5" /> re-draft from the brief
        </button>
        <div className="ml-auto flex items-center gap-4">
          {dirty && (
            <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-1.5 italic text-[hsl(var(--pv-text-muted))] hover:text-foreground">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} save edits
            </button>
          )}
          <DurableReviser
            bookId={bookId}
            layer="spine"
            targetKey="revise:spine"
            current={spine.trim()}
            onApply={async (proposed) => { await saveSpine(bookId, proposed); setSpine(proposed); setDirty(false); onStatusChange(!!proposed.trim()); onChanged(); }}
          />
          <DurableOptions
            bookId={bookId}
            kind="spine_options"
            targetKey="book"
            getParams={() => ({})}
            onApply={async (proposed) => { await saveSpine(bookId, proposed); setSpine(proposed); setDirty(false); onStatusChange(!!proposed.trim()); onChanged(); }}
          />
        </div>
      </div>
    </div>
  );
}
