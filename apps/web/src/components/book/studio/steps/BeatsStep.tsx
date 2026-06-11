// BeatsStep — the Beats step's Stage body: the serial, human-pick beat flow (handoff §5) reshaped as
// the prototype's page-by-page take-picker. Same wiring as SerialBeats — walk the objective-bearing
// pages in order, draft three un-judged takes for the current page (grounded on the beat just
// approved, so structural drift can't compound), author picks/edits one, save, advance. A beat-rail
// gives the whole book at a glance; the Stage owns the head + approve gate.
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Loader2, RefreshCw } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { transforms, saveBeat } from "@/lib/ladder";
import type { MapPage } from "@/lib/planGraph";
import type { StudioModel } from "../studioModel";
import { DoneStrip } from "../studioUi";

export function BeatsStep({ bookId, model, onChanged, onSelectPage }: { bookId: number; model: StudioModel; onChanged: () => void; onSelectPage: (pageId: number) => void }) {
  const { toast } = useToast();
  // The beat decisions: text pages that carry an objective, in reading order.
  const beatPages = model.textPages.filter((p) => p.objectiveText.trim());
  const doneCount = beatPages.filter((p) => p.beat !== "gap").length;
  const total = beatPages.length;
  const allDone = total > 0 && doneCount === total;

  const firstGap = beatPages.findIndex((p) => p.beat === "gap");
  const [cursor, setCursor] = useState(firstGap === -1 ? 0 : firstGap);
  const [takes, setTakes] = useState<string[]>([]);
  const [takesForId, setTakesForId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [pick, setPick] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const reqRef = useRef(0);

  const page: MapPage | undefined = beatPages[cursor];

  const draftTakes = useCallback(async (p: MapPage) => {
    const req = ++reqRef.current;
    setLoading(true); setTakes([]); setTakesForId(null); setPick(null);
    try {
      const got = await transforms.beatCandidates(bookId, p.id, p.objectiveText.trim(), 3);
      if (req !== reqRef.current) return;
      setTakes(got); setTakesForId(p.id); setDraft(got[0] ?? ""); setPick(got.length ? 0 : null);
    } catch (e) {
      if (req !== reqRef.current) return;
      toast({ title: "Couldn't draft the takes", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally { if (req === reqRef.current) setLoading(false); }
  }, [bookId, toast]);

  // Landing on a page: seat its saved beat for review, or auto-draft three takes if it has none.
  useEffect(() => {
    if (!page) return;
    if (page.beat !== "gap") {
      reqRef.current++; setTakes([]); setTakesForId(null); setPick(null); setDraft(page.beatText); setLoading(false);
    } else if (takesForId !== page.id) {
      void draftTakes(page);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.id]);

  if (total === 0) {
    return <p className="pv-serif text-[14px] italic text-[hsl(var(--pv-text-faint))]">No pages with an objective yet — generate the outline first.</p>;
  }

  if (allDone) {
    return (
      <DoneStrip icon={<Check className="h-5 w-5" />} title="Every beat chosen">
        All {total} pages have a beat you picked. <button type="button" onClick={() => setCursor(0)} className="italic text-[hsl(var(--pv-accent))] hover:opacity-75">review them →</button>
      </DoneStrip>
    );
  }
  if (!page) return null;

  const committed = page.beat !== "gap";
  const advance = () => {
    const rest = beatPages.slice(cursor + 1).findIndex((p) => p.beat === "gap");
    setCursor(rest === -1 ? cursor + 1 : cursor + 1 + rest);
  };
  const commit = async () => {
    const text = draft.trim();
    if (!text || saving) { if (!text) toast({ title: "Pick or write a beat first", variant: "destructive" }); return; }
    setSaving(true);
    try {
      await saveBeat(bookId, page.id, text);
      toast({ title: "Beat set", description: `“${page.title || "page"}” — ${doneCount + 1} of ${total}.` });
      setTakes([]); setTakesForId(null);
      onChanged();
      advance();
    } catch (e) {
      toast({ title: "Couldn't save the beat", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally { setSaving(false); }
  };
  const movement = model.movements.find((m) => m.pages.some((p) => p.id === page.id));

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-3">
        <BeatRail pages={beatPages} cursor={cursor} onJump={setCursor} />
        <span className="shrink-0 pv-serif text-[13px] italic text-[hsl(var(--pv-text-muted))]">beat {cursor + 1} of {total} · {doneCount} done</span>
      </div>

      <div className="flex items-baseline gap-3">
        <span className="pv-mono text-[9.5px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-faint))]">{movement?.num ? `${movement.num} · ` : ""}{movement?.title ?? "Pages"}</span>
        <span className="ml-auto pv-serif text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">page {cursor + 1}</span>
      </div>
      <h2 className="pv-serif mb-4 mt-1 text-[28px] leading-[1.15] tracking-[-0.01em] text-foreground">{page.title || "(untitled page)"}</h2>

      <div className="rounded-2xl border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/40 px-5 py-4">
        <div className="pv-mono text-[10px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-faint))]">Objective · the contract</div>
        <p className="pv-serif mt-2 text-[15.5px] leading-[1.6] text-[hsl(var(--pv-text-muted))]">{page.objectiveText}</p>
      </div>

      {loading ? (
        <p className="pv-serif mt-5 inline-flex items-center gap-2 text-[14px] italic text-[hsl(var(--pv-text-muted))]">
          <Loader2 className="h-4 w-4 animate-spin" /> Drafting three takes…
        </p>
      ) : committed ? (
        <div className="mt-5">
          <div className="pv-mono mb-3 text-[10px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-faint))]">Chosen beat</div>
          <div className="rounded-2xl border border-[hsl(var(--pv-accent))]/45 bg-[hsl(var(--pv-surface-2))]/60 px-5 py-4">
            <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft.trim() && void saveBeat(bookId, page.id, draft.trim()).then(onChanged)} rows={6}
              className="pv-serif border-none bg-transparent px-0 text-[15.5px] leading-[1.6] focus-visible:ring-0" />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-5">
            <button type="button" onClick={() => void draftTakes(page)} className="pv-serif inline-flex items-center gap-1.5 text-[13.5px] italic text-[hsl(var(--pv-accent))] hover:opacity-75">
              <RefreshCw className="h-3.5 w-3.5" /> re-pick this beat
            </button>
            <div className="ml-auto flex gap-5">
              {cursor > 0 && <button type="button" onClick={() => setCursor(cursor - 1)} className="pv-serif text-[13.5px] italic text-[hsl(var(--pv-text-muted))] hover:text-foreground">← prev</button>}
              {cursor < total - 1 && <button type="button" onClick={() => setCursor(cursor + 1)} className="pv-serif text-[13.5px] italic text-[hsl(var(--pv-text-muted))] hover:text-foreground">next →</button>}
            </div>
          </div>
        </div>
      ) : takes.length > 0 ? (
        <div className="mt-5">
          <div className="pv-mono mb-3 text-[10px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-faint))]">Three takes — pick one to keep &amp; edit</div>
          <div className="space-y-3">
            {takes.map((t, i) => {
              const selected = pick === i;
              return (
                <div key={i} onClick={selected ? undefined : () => { setPick(i); setDraft(t); }}
                  className={`rounded-2xl border px-5 py-4 transition-colors ${selected ? "border-[hsl(var(--pv-accent))]/45 bg-[hsl(var(--pv-surface-2))]/60" : "cursor-pointer border-border hover:border-foreground/30"}`}>
                  <div className="mb-2 flex items-center gap-3">
                    <span className="pv-mono text-[10px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-faint))]">Take {i + 1}</span>
                    {selected ? <span className="pv-mono ml-auto text-[9px] uppercase tracking-[0.12em] text-[hsl(var(--pv-accent))]">chosen · editing</span>
                      : <span className="ml-auto pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))]">pick this</span>}
                  </div>
                  {selected
                    ? <Textarea value={draft} onClick={(e) => e.stopPropagation()} onChange={(e) => setDraft(e.target.value)} rows={6} className="pv-serif border-none bg-transparent px-0 text-[15.5px] leading-[1.6] focus-visible:ring-0" />
                    : <p className="pv-serif line-clamp-3 text-[15px] leading-[1.6] text-[hsl(var(--pv-text-muted))]">{t}</p>}
                </div>
              );
            })}
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <button type="button" onClick={() => void commit()} disabled={saving || pick === null}
              className="pv-serif inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[14.5px] text-primary-foreground disabled:opacity-40">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Use this beat &amp; continue
            </button>
            <button type="button" onClick={() => void draftTakes(page)} className="pv-serif inline-flex items-center gap-1.5 text-[13.5px] text-[hsl(var(--pv-text-muted))] hover:text-foreground">
              <RefreshCw className="h-3.5 w-3.5" /> Redraft three takes
            </button>
            {cursor > 0 && <button type="button" onClick={() => setCursor(cursor - 1)} className="pv-serif text-[13.5px] italic text-[hsl(var(--pv-text-muted))] hover:text-foreground"><ArrowLeft className="mr-1 inline h-3.5 w-3.5" />back</button>}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BeatRail({ pages, cursor, onJump }: { pages: MapPage[]; cursor: number; onJump: (i: number) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {pages.map((p, i) => {
        const done = p.beat !== "gap";
        const cur = i === cursor;
        return (
          <button
            key={p.id}
            type="button"
            title={`Beat ${i + 1} — ${p.title ?? ""}`}
            onClick={() => onJump(i)}
            className={`h-2 w-5 rounded-full border transition-transform hover:-translate-y-px ${
              done ? "border-[hsl(var(--pv-accent))] bg-[hsl(var(--pv-accent))]"
                : cur ? "border-[hsl(var(--pv-accent))] bg-[hsl(var(--pv-surface-2))] ring-2 ring-[hsl(var(--pv-accent))]/20"
                  : "border-[hsl(var(--pv-text-faint))]/50 bg-transparent"
            }`}
          />
        );
      })}
    </div>
  );
}
