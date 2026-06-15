// BeatSheet — whole-book beat sheet as a card carousel + edit modal.
//
//   • Top: "fix N out-of-sync beats" banner when drift pages exist.
//   • Middle: fixed-size beat cards, 3 visible at a time, navigated by arrows.
//   • Click a card: opens a modal with the full objective + beat editor and prev/next navigation.
//   • Bottom: BeatChat conversational editor.
//
// See docs/beat-sheet-revision.md.
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, RefreshCw, X } from "lucide-react";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { saveBeat, saveObjective, transforms } from "@/lib/ladder";
import { useAIRun } from "@/hooks/useAIRun";
import { BeatChat } from "./BeatChat";
import type { StudioModel } from "./studioModel";
import type { MapPage } from "@/lib/planGraph";
import { ActionLink, Eyebrow, Pip } from "./studioUi";

const VISIBLE = 3;

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

      <Carousel
        bookId={bookId} beatPages={beatPages} model={model}
        onChanged={onChanged} onSelectPage={onSelectPage} beforeGen={beforeGen}
      />

      <div className="mt-10 border-t border-[hsl(var(--pv-border-soft))]/60 pt-6">
        <BeatChat bookId={bookId} model={model} onChanged={onChanged} />
      </div>
    </div>
  );
}

// ── Card carousel ────────────────────────────────────────────────────────────
function Carousel({ bookId, beatPages, model, onChanged, onSelectPage, beforeGen }: {
  bookId: number; beatPages: MapPage[]; model: StudioModel;
  onChanged: () => void; onSelectPage?: (pageId: number) => void; beforeGen: () => Promise<void>;
}) {
  const [offset, setOffset] = useState(0);
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  const maxOffset = Math.max(0, beatPages.length - VISIBLE);
  const safe = Math.min(offset, maxOffset);
  useEffect(() => { if (offset !== safe) setOffset(safe); }, [safe, offset]);

  const visible = beatPages.slice(safe, safe + VISIBLE);

  if (beatPages.length === 0) return null;

  return (
    <div className="mt-8 border-t border-[hsl(var(--pv-border-soft))]/60 pt-6">
      <div className="flex items-stretch gap-2">
        <div className="flex items-center">
          <NavButton dir="prev" disabled={safe === 0} onClick={() => setOffset(safe - 1)} />
        </div>

        <div className="grid flex-1 gap-3" style={{ gridTemplateColumns: `repeat(${VISIBLE}, 1fr)` }}>
          {visible.map((page, i) => (
            <BeatCard
              key={page.id}
              page={page}
              pageNum={safe + i + 1}
              onClick={() => setOpenIdx(safe + i)}
            />
          ))}
          {/* Fill empty slots so layout stays stable */}
          {visible.length < VISIBLE && Array.from({ length: VISIBLE - visible.length }).map((_, i) => (
            <div key={`empty-${i}`} />
          ))}
        </div>

        <div className="flex items-center">
          <NavButton dir="next" disabled={safe >= maxOffset} onClick={() => setOffset(safe + 1)} />
        </div>
      </div>

      <div className="mt-2 text-center">
        <span className="pv-mono text-[9px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-faint))]">
          {safe + 1}–{Math.min(safe + VISIBLE, beatPages.length)} of {beatPages.length}
        </span>
      </div>

      {openIdx !== null && (
        <BeatModal
          bookId={bookId}
          beatPages={beatPages}
          initialIdx={openIdx}
          model={model}
          onChanged={onChanged}
          onSelectPage={onSelectPage}
          beforeGen={beforeGen}
          onClose={() => setOpenIdx(null)}
        />
      )}
    </div>
  );
}

function BeatCard({ page, pageNum, onClick }: { page: MapPage; pageNum: number; onClick: () => void }) {
  const outOfSync = page.beat === "drift";
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-40 flex-col overflow-hidden rounded-xl border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/40 px-4 py-3 text-left transition-colors hover:border-[hsl(var(--pv-accent))]/50 hover:bg-[hsl(var(--pv-surface-2))]/70"
    >
      {/* Header */}
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="pv-mono text-[9px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">
          p. {pageNum}
        </span>
        {outOfSync && <Pip state="drift" size={6} />}
      </div>

      {/* Title */}
      <div className="pv-serif mb-1.5 truncate text-[13px] font-medium leading-tight text-foreground group-hover:text-[hsl(var(--pv-accent))]">
        {page.title || "(untitled)"}
      </div>

      {/* Beat preview */}
      <div className="pv-serif line-clamp-3 flex-1 text-[11.5px] leading-[1.5] text-[hsl(var(--pv-text-muted))]">
        {page.beatText || <span className="italic text-[hsl(var(--pv-text-faint))]">(no beat yet)</span>}
      </div>

      {/* Read hint */}
      <div className="mt-1.5 text-right">
        <span className="pv-serif text-[10px] italic text-[hsl(var(--pv-text-faint))] opacity-0 transition-opacity group-hover:opacity-100">
          read →
        </span>
      </div>
    </button>
  );
}

// ── Beat modal ───────────────────────────────────────────────────────────────
function BeatModal({ bookId, beatPages, initialIdx, model, onChanged, onSelectPage, beforeGen, onClose }: {
  bookId: number; beatPages: MapPage[]; initialIdx: number; model: StudioModel;
  onChanged: () => void; onSelectPage?: (pageId: number) => void; beforeGen: () => Promise<void>;
  onClose: () => void;
}) {
  const [cursor, setCursor] = useState(initialIdx);
  const safe = Math.min(cursor, Math.max(0, beatPages.length - 1));
  const page = beatPages[safe];
  const movement = model.movements.find((m) => m.pages.some((p) => p.id === page?.id));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowLeft" && safe > 0) { setCursor(safe - 1); return; }
      if (e.key === "ArrowRight" && safe < beatPages.length - 1) { setCursor(safe + 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [safe, beatPages.length, onClose]);

  if (!page) return null;

  const handleSelectPage = onSelectPage ? (pageId: number) => { onSelectPage(pageId); onClose(); } : undefined;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[hsl(var(--pv-border-soft))]/60 px-5 py-3">
          <div className="min-w-0">
            {movement && (
              <div className="pv-mono text-[9px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-faint))]">
                {movement.num ? `${movement.num} · ` : ""}{movement.title}
              </div>
            )}
            <div className="pv-serif text-[12px] italic text-[hsl(var(--pv-text-muted))]">
              page {safe + 1} of {beatPages.length}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <NavButton dir="prev" disabled={safe === 0} onClick={() => setCursor(safe - 1)} />
            <NavButton dir="next" disabled={safe === beatPages.length - 1} onClick={() => setCursor(safe + 1)} />
            <button
              type="button"
              onClick={onClose}
              className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-full text-[hsl(var(--pv-text-muted))] transition-colors hover:bg-[hsl(var(--pv-border-soft))]/60 hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Page content */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <PageRow
            key={page.id}
            bookId={bookId}
            page={page}
            onChanged={onChanged}
            onSelectPage={handleSelectPage}
            beforeGen={beforeGen}
          />
        </div>
      </div>
    </div>
  );
}

// ── Shared nav button ────────────────────────────────────────────────────────
function NavButton({ dir, disabled, onClick }: { dir: "prev" | "next"; disabled: boolean; onClick: () => void }) {
  const Icon = dir === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      title={dir === "prev" ? "Previous" : "Next"}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--pv-border-soft))] text-[hsl(var(--pv-text-muted))] transition-colors hover:border-[hsl(var(--pv-accent))]/50 hover:text-[hsl(var(--pv-accent))] disabled:opacity-30 disabled:hover:border-[hsl(var(--pv-border-soft))] disabled:hover:text-[hsl(var(--pv-text-muted))]">
      <Icon className="h-4 w-4" />
    </button>
  );
}

// ── Full page editor (used inside the modal) ─────────────────────────────────
function PageRow({ bookId, page, onChanged, onSelectPage, beforeGen }: {
  bookId: number; page: MapPage; onChanged: () => void;
  onSelectPage?: (pageId: number) => void; beforeGen: () => Promise<void>;
}) {
  const [obj, setObj] = useState(page.objectiveText);
  const [beat, setBeat] = useState(page.beatText);
  const [saving, setSaving] = useState(false);
  const [regen, setRegen] = useState(false);

  useEffect(() => { setObj(page.objectiveText); setBeat(page.beatText); }, [page.objectiveText, page.beatText]);

  const cand = useAIRun<{ options: string[] }>({ bookId, kind: "beat_candidates", targetPageId: page.id, enabled: regen });
  const newBeat = cand.run?.result?.options?.[0] ?? "";
  const status = cand.run?.status;
  const generating = regen && (status === "running" || status === "pending" || cand.starting);
  const sawRunning = useRef(false);
  const seatedRun = useRef<number | null>(null);

  useEffect(() => {
    if (!regen) return;
    if (status === "running" || status === "pending") sawRunning.current = true;
    if (status === "ready" && newBeat && sawRunning.current && cand.run && seatedRun.current !== cand.run.id) {
      seatedRun.current = cand.run.id;
      setBeat(newBeat);
      setRegen(false);
      sawRunning.current = false;
      void cand.accept(async () => {});
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
    <div>
      {/* Title */}
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="pv-serif text-[20px] leading-snug tracking-[-0.01em] text-foreground">
            {page.title || "(untitled page)"}
          </div>
          {outOfSync && (
            <span className="pv-mono mt-1 block text-[9px] uppercase tracking-[0.12em] text-amber-600">
              beat out of sync
            </span>
          )}
        </div>
        {saving && <Loader2 className="mt-1.5 h-3.5 w-3.5 shrink-0 animate-spin text-[hsl(var(--pv-text-faint))]" />}
      </div>

      {/* Objective */}
      <div>
        <Eyebrow className="block mb-2">Objective</Eyebrow>
        <AutoTextarea
          value={obj}
          onChange={(e) => setObj(e.target.value)}
          onBlur={() => void saveObj()}
          className="pv-serif w-full border-none bg-transparent px-0 text-[14px] leading-[1.6] text-[hsl(var(--pv-text-muted))] focus-visible:ring-0"
        />
      </div>

      <div className="my-5 border-t border-[hsl(var(--pv-border-soft))]/50" />

      {/* Beat */}
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
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
        <AutoTextarea
          value={beat}
          onChange={(e) => setBeat(e.target.value)}
          onBlur={() => void saveB()}
          placeholder="(no beat yet)"
          disabled={generating}
          className="pv-serif w-full border-none bg-transparent px-0 text-[15px] leading-[1.65] focus-visible:ring-0 disabled:opacity-50"
        />
      </div>

      {/* Open page link */}
      {onSelectPage && (
        <div className="mt-6 flex justify-end border-t border-[hsl(var(--pv-border-soft))]/40 pt-4">
          <button
            type="button"
            onClick={() => onSelectPage(page.id)}
            className="pv-serif text-[13px] italic text-[hsl(var(--pv-accent))]/70 hover:text-[hsl(var(--pv-accent))]"
          >
            open page →
          </button>
        </div>
      )}
    </div>
  );
}
