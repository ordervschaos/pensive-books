// SpineStep — the Spine step's Stage body: the book's one-paragraph throughline, derived from the
// brief. Same wiring as SpineGenerator (transforms.briefToSpine → saveSpine; hand-edits persist via
// saveSpine), reshaped into the prototype's calm editable field with a re-draft affordance. A loud
// hero when there's no spine yet; the editable paragraph once there is one. The Stage owns the gate.
import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { NodeOptions, NodeReviser } from "../../ladder-ui";
import { readNode, saveSpine, transforms } from "@/lib/ladder";
import { Hero } from "../studioUi";

export function SpineStep({ bookId, onStatusChange, onChanged }: { bookId: number; onStatusChange: (v: boolean) => void; onChanged: () => void }) {
  const { toast } = useToast();
  const [spine, setSpine] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [working, setWorking] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showRevise, setShowRevise] = useState(false);

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

  const generate = async () => {
    if (working) return;
    setWorking(true);
    try {
      const text = await transforms.briefToSpine(bookId);
      await saveSpine(bookId, text);
      setSpine(text); setDirty(false); onStatusChange(!!text.trim()); onChanged();
    } catch (e) {
      toast({ title: "Couldn't draft the spine", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally { setWorking(false); }
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try { await saveSpine(bookId, spine.trim()); setDirty(false); onStatusChange(!!spine.trim()); onChanged(); }
    catch (e) { toast({ title: "Couldn't save the spine", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
    finally { setSaving(false); }
  };

  if (!loaded) return null;

  if (working) {
    return <p className="pv-serif inline-flex items-center gap-2 text-[14px] italic text-[hsl(var(--pv-text-muted))]"><Loader2 className="h-4 w-4 animate-spin" /> Drafting the spine…</p>;
  }

  if (!spine.trim()) {
    return (
      <Hero icon={<Sparkles className="h-5 w-5" />} title="Draft the spine from the brief"
        sub="One paragraph that names the throughline — what the book is really about. The outline is built to realize it."
        onClick={generate} />
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
        <button type="button" onClick={generate} disabled={working} className="inline-flex items-center gap-1.5 italic text-[hsl(var(--pv-accent))] hover:opacity-75 disabled:opacity-50">
          <RefreshCw className="h-3.5 w-3.5" /> re-draft from the brief
        </button>
        <div className="ml-auto flex items-center gap-4">
          {dirty && (
            <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-1.5 italic text-[hsl(var(--pv-text-muted))] hover:text-foreground">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} save edits
            </button>
          )}
          {!showRevise && (
            <>
              <button type="button" onClick={() => setShowRevise(true)} className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-muted))] hover:text-[hsl(var(--pv-accent))] transition-colors">
                revise →
              </button>
              <NodeOptions
                busy={working || saving}
                onGenerate={() => transforms.spineOptions(bookId)}
                onAccept={async (proposed) => {
                  await saveSpine(bookId, proposed);
                  setSpine(proposed);
                  setDirty(false);
                  onStatusChange(!!proposed.trim());
                  onChanged();
                }}
              />
            </>
          )}
        </div>
      </div>
      {showRevise && (
        <div className="mt-4 border-t border-[hsl(var(--pv-border-soft))] pt-4">
          <p className="pv-serif mb-2 text-[13px] italic text-[hsl(var(--pv-text-muted))]">Revise with a prompt.</p>
          <NodeReviser
            inline
            current={spine.trim()}
            busy={working}
            onRevise={async (instr) => {
              try {
                return await transforms.reviseNode(bookId, "spine", spine.trim(), instr);
              } catch (e) {
                toast({ title: "Couldn't revise the spine", description: String((e as Error)?.message ?? e), variant: "destructive" });
                throw e;
              }
            }}
            onAccept={async (proposed) => {
              await saveSpine(bookId, proposed);
              setSpine(proposed);
              setDirty(false);
              setShowRevise(false);
              onStatusChange(!!proposed.trim());
              onChanged();
            }}
            onCancel={() => setShowRevise(false)}
          />
        </div>
      )}
    </div>
  );
}
