// BeatSheet — the whole-book beat sheet, one page at a time.
//
//   • Top: "fix N out-of-sync beats" button (when beat === "drift" pages exist).
//   • Middle: single-page view with prev/next navigation across all pages.
//   • Bottom: BeatChat conversational editor.
//
// Each page shows its objective + beat, both editable (autosave on blur). The per-page
// "regenerate" button starts a durable beat_candidates run (same as the cold-start flow).
// See docs/beat-sheet-revision.md.
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { saveBeat, saveObjective, transforms } from "@/lib/ladder";
import { useAIRun } from "@/hooks/useAIRun";
import { BeatChat } from "./BeatChat";
import type { StudioModel } from "./studioModel";
import type { MapPage } from "@/lib/planGraph";
import { ActionLink, Eyebrow, Panel } from "./studioUi";

export function BeatSheet({ bookId, model, onChanged, onSelectPage, beforeGen }: {
  bookId: number; model: StudioModel; onChanged: () => void;
  onSelectPage?: (pageId: number) => void; beforeGen: () => Promise<void>;
}) {
  const beatPages = model.textPages.filter((p) => p.objectiveText.trim());
  const driftPages = beatPages.filter((p) => p.beat === "drift");
  const [fixing, setFixing] = useState(false);

  const fixAllDrift = async () => {
    if (fixing || driftPages.length === 0) return;
    setFixing(true);
    try {
      for (const p of driftPages) {
        try {
          const newBeat = await transforms.objectiveToBeat(bookId, p.id, p.objectiveText);
          if (newBeat) await saveBeat(bookId, p.id, newBeat);
        } catch { /* skip failed page, continue */ }
      }
      onChanged();
    } finally {
      setFixing(false);
    }
  };

  return (
    <div>
      {driftPages.length > 0 && (
        <div className="mb-5">
          <ActionLink busy={fixing} icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void fixAllDrift()}>
            regenerate {driftPages.length} out-of-sync beat{driftPages.length === 1 ? "" : "s"} from updated objectives →
          </ActionLink>
        </div>
      )}

      <Sheet
        bookId={bookId} beatPages={beatPages} model={model}
        onChanged={onChanged} onSelectPage={onSelectPage} beforeGen={beforeGen}
      />

      <div className="mt-10 border-t border-[hsl(var(--pv-border-soft))]/60 pt-6">
        <BeatChat bookId={bookId} model={model} onChanged={onChanged} />
      </div>
    </div>
  );
}

// ── One beat at a time, prev/next across all pages ──────────────────────────────
function Sheet({ bookId, beatPages, model, onChanged, onSelectPage, beforeGen }: {
  bookId: number; beatPages: MapPage[]; model: StudioModel;
  onChanged: () => void; onSelectPage?: (pageId: number) => void; beforeGen: () => Promise<void>;
}) {
  const [cursor, setCursor] = useState(0);
  const safe = Math.min(cursor, Math.max(0, beatPages.length - 1));
  useEffect(() => { if (cursor !== safe) setCursor(safe); }, [safe, cursor]);

  const page = beatPages[safe];
  const movement = model.movements.find((m) => m.pages.some((p) => p.id === page?.id));

  if (!page) return null;

  return (
    <div className="mt-8 border-t border-[hsl(var(--pv-border-soft))]/60 pt-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <NavButton dir="prev" disabled={safe === 0} onClick={() => setCursor(safe - 1)} />
        <div className="min-w-0 text-center">
          {movement && (
            <div className="pv-mono text-[9px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-faint))]">
              {movement.num ? `${movement.num} · ` : ""}{movement.title}
            </div>
          )}
          <div className="pv-serif text-[12px] italic text-[hsl(var(--pv-text-muted))]">
            page {safe + 1} of {beatPages.length}
          </div>
        </div>
        <NavButton dir="next" disabled={safe === beatPages.length - 1} onClick={() => setCursor(safe + 1)} />
      </div>

      <PageRow
        key={page.id}
        bookId={bookId} page={page}
        onChanged={onChanged} onSelectPage={onSelectPage} beforeGen={beforeGen}
        onNext={safe < beatPages.length - 1 ? () => setCursor(safe + 1) : undefined}
        onPrev={safe > 0 ? () => setCursor(safe - 1) : undefined}
      />
    </div>
  );
}

function NavButton({ dir, disabled, onClick }: { dir: "prev" | "next"; disabled: boolean; onClick: () => void }) {
  const Icon = dir === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      title={dir === "prev" ? "Previous page" : "Next page"}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--pv-border-soft))] text-[hsl(var(--pv-text-muted))] transition-colors hover:border-[hsl(var(--pv-accent))]/50 hover:text-[hsl(var(--pv-accent))] disabled:opacity-30 disabled:hover:border-[hsl(var(--pv-border-soft))] disabled:hover:text-[hsl(var(--pv-text-muted))]">
      <Icon className="h-4 w-4" />
    </button>
  );
}

function PageRow({ bookId, page, onChanged, onSelectPage, beforeGen, onNext, onPrev }: {
  bookId: number; page: MapPage; onChanged: () => void;
  onSelectPage?: (pageId: number) => void; beforeGen: () => Promise<void>;
  onNext?: () => void; onPrev?: () => void;
}) {
  const [obj, setObj] = useState(page.objectiveText);
  const [beat, setBeat] = useState(page.beatText);
  const [saving, setSaving] = useState(false);
  const [regen, setRegen] = useState(false);

  useEffect(() => { setObj(page.objectiveText); setBeat(page.beatText); }, [page.objectiveText, page.beatText]);

  // Durable single-beat regeneration — subscribes only while regen is active.
  const cand = useAIRun<{ options: string[] }>({ bookId, kind: "beat_candidates", targetPageId: page.id, enabled: regen });
  const newBeat = cand.run?.result?.options?.[0] ?? "";
  const status = cand.run?.status;
  const generating = regen && (status === "running" || status === "pending" || cand.starting);
  const sawRunning = useRef(false);
  const seatedRun = useRef<number | null>(null);

  // Seat a fresh result (watched go running → ready) into the editable field, unsaved.
  useEffect(() => {
    if (!regen) return;
    if (status === "running" || status === "pending") sawRunning.current = true;
    if (status === "ready" && newBeat && sawRunning.current && cand.run && seatedRun.current !== cand.run.id) {
      seatedRun.current = cand.run.id;
      setBeat(newBeat);
      setRegen(false);
      sawRunning.current = false;
      void cand.accept(async () => {}); // mark applied so it can't resurface
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, newBeat]);

  const doRegen = async () => {
    if (generating || !obj.trim()) return;
    try { await beforeGen(); sawRunning.current = false; setRegen(true); void cand.start({ pageId: page.id, objective: obj.trim() }); }
    catch { setRegen(false); }
  };

  const saveObj = async () => {
    const t = obj.trim();
    if (t === page.objectiveText.trim()) return;
    setSaving(true);
    try { await saveObjective(bookId, page.id, t); onChanged(); } finally { setSaving(false); }
  };
  const saveB = async () => {
    const t = beat.trim();
    if (t === page.beatText.trim()) return;
    setSaving(true);
    try { await saveBeat(bookId, page.id, t); onChanged(); } finally { setSaving(false); }
  };

  const outOfSync = page.beat === "drift";

  return (
    <Panel variant="soft" className="px-5 py-4">
      {/* Title row */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <button type="button" onClick={() => onSelectPage?.(page.id)}
          className="pv-serif truncate text-left text-[17px] tracking-[-0.01em] text-foreground hover:text-[hsl(var(--pv-accent))]">
          {page.title || "(untitled page)"}
        </button>
        <div className="flex shrink-0 items-center gap-2.5">
          {outOfSync && (
            <span className="pv-mono text-[9px] uppercase tracking-[0.12em] text-amber-600">beat out of sync</span>
          )}
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-[hsl(var(--pv-text-faint))]" />}
        </div>
      </div>

      {/* Objective */}
      <label className="block">
        <Eyebrow className="block">Objective</Eyebrow>
        <AutoTextarea value={obj} onChange={(e) => setObj(e.target.value)} onBlur={() => void saveObj()}
          className="pv-serif mt-1.5 border-none bg-transparent px-0 text-[14px] leading-[1.55] text-[hsl(var(--pv-text-muted))] focus-visible:ring-0" />
      </label>

      {/* Beat */}
      <label className="mt-3 block">
        <div className="flex items-center justify-between gap-2">
          <Eyebrow>Beat</Eyebrow>
          {generating ? (
            <span className="inline-flex items-center gap-1.5 pv-serif text-[11.5px] italic text-[hsl(var(--pv-text-faint))]">
              <Loader2 className="h-3 w-3 animate-spin" /> regenerating…
            </span>
          ) : (
            <ActionLink tone="faint" icon={<RefreshCw className="h-3 w-3" />} onClick={() => void doRegen()}>
              regenerate
            </ActionLink>
          )}
        </div>
        <AutoTextarea value={beat} onChange={(e) => setBeat(e.target.value)} onBlur={() => void saveB()}
          placeholder="(no beat yet)" disabled={generating}
          className="pv-serif mt-1.5 border-none bg-transparent px-0 text-[15px] leading-[1.6] focus-visible:ring-0 disabled:opacity-50" />
      </label>

      {/* Footer nav */}
      <div className="mt-4 flex items-center gap-5 border-t border-[hsl(var(--pv-border-soft))]/40 pt-3">
        {onPrev && (
          <button type="button" onClick={onPrev}
            className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-muted))] hover:text-foreground">
            ← prev
          </button>
        )}
        {onNext && (
          <button type="button" onClick={onNext}
            className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-muted))] hover:text-foreground">
            next →
          </button>
        )}
        {onSelectPage && (
          <button type="button" onClick={() => onSelectPage(page.id)}
            className="pv-serif ml-auto text-[13px] italic text-[hsl(var(--pv-accent))]/70 hover:text-[hsl(var(--pv-accent))]">
            open page →
          </button>
        )}
      </div>
    </Panel>
  );
}
