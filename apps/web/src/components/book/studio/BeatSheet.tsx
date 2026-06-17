// BeatSheet — whole-book beat sheet as an expandable accordion.
//
//   • Top: "discard all beats & prose, re-plan" (when passed), then drift-fix banner naming the pages.
//   • Body: full list of all beat pages, each expanding inline to the full objective + beat editor.
//
// The conversational beat editor (ReviseChat layer="beats") lives in the studio's right rail.
import { useEffect, useState } from "react";
import { Check, ChevronDown, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { saveBeat, saveObjective, transforms } from "@/lib/ladder";
import { useAIRun } from "@/hooks/useAIRun";
import type { StudioModel } from "./studioModel";
import type { MapPage } from "@/lib/planGraph";
import { ActionLink, Eyebrow, GenRow, Panel, Pip, SkeletonCard } from "./studioUi";

export function BeatSheet({ bookId, model, onChanged, onSelectPage, beforeGen, onDiscardAll, discarding }: {
  bookId: number; model: StudioModel; onChanged: () => void;
  onSelectPage?: (pageId: number) => void; beforeGen: () => Promise<void>;
  onDiscardAll?: () => void; discarding?: boolean;
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

  const driftNames = driftPages.slice(0, 3).map((p) => `"${p.title || "untitled"}"`).join(", ");
  const driftSuffix = driftPages.length > 3 ? ` and ${driftPages.length - 3} more` : "";

  return (
    <div>
      {onDiscardAll && (
        <div className="mb-4">
          <ActionLink tone="faint" busy={discarding} onClick={onDiscardAll}>
            discard all beats &amp; prose, re-plan →
          </ActionLink>
        </div>
      )}

      {driftPages.length > 0 && (
        <div className="mb-5">
          <ActionLink busy={fixing} icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void fixAllDrift()}>
            regenerate {driftPages.length} out-of-sync beat{driftPages.length === 1 ? "" : "s"} — {driftNames}{driftSuffix} from updated objectives →
          </ActionLink>
        </div>
      )}

      {beatPages.length > 0 && (
        <BeatList
          bookId={bookId} beatPages={beatPages}
          onChanged={onChanged} onSelectPage={onSelectPage} beforeGen={beforeGen}
        />
      )}
    </div>
  );
}

// ── Accordion list ────────────────────────────────────────────────────────────
function BeatList({ bookId, beatPages, onChanged, onSelectPage, beforeGen }: {
  bookId: number; beatPages: MapPage[];
  onChanged: () => void; onSelectPage?: (pageId: number) => void; beforeGen: () => Promise<void>;
}) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  return (
    <div className="mt-4 space-y-1.5 border-t border-[hsl(var(--pv-border-soft))]/60 pt-5">
      {beatPages.map((page, i) => (
        <BeatRow
          key={page.id}
          bookId={bookId}
          page={page}
          pageNum={i + 1}
          expanded={expandedId === page.id}
          onToggle={() => setExpandedId(expandedId === page.id ? null : page.id)}
          onChanged={onChanged}
          onSelectPage={onSelectPage}
          beforeGen={beforeGen}
        />
      ))}
    </div>
  );
}

function BeatRow({ bookId, page, pageNum, expanded, onToggle, onChanged, onSelectPage, beforeGen }: {
  bookId: number; page: MapPage; pageNum: number; expanded: boolean; onToggle: () => void;
  onChanged: () => void; onSelectPage?: (pageId: number) => void; beforeGen: () => Promise<void>;
}) {
  const outOfSync = page.beat === "drift";
  return (
    <div className={`rounded-xl border transition-colors ${
      expanded
        ? "border-[hsl(var(--pv-accent))]/30 bg-[hsl(var(--pv-surface-2))]/50"
        : "border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/20 hover:border-[hsl(var(--pv-accent))]/20 hover:bg-[hsl(var(--pv-surface-2))]/40"
    }`}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-3 px-4 py-3 text-left"
      >
        <span className="pv-mono mt-0.5 w-8 shrink-0 text-[9px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">
          p.{pageNum}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`pv-serif text-[13.5px] font-medium leading-snug ${expanded ? "text-[hsl(var(--pv-accent))]" : "text-foreground"}`}>
              {page.title || "(untitled)"}
            </span>
            {outOfSync && <Pip state="drift" size={6} />}
          </div>
          {!expanded && page.beatText && (
            <p className="pv-serif mt-0.5 truncate text-[11.5px] leading-[1.4] text-[hsl(var(--pv-text-faint))]">
              {page.beatText}
            </p>
          )}
        </div>
        <ChevronDown className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--pv-text-faint))] transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="border-t border-[hsl(var(--pv-border-soft))]/40 px-4 pb-5 pt-4">
          <PageRow
            bookId={bookId}
            page={page}
            onChanged={onChanged}
            onSelectPage={onSelectPage}
            beforeGen={beforeGen}
          />
        </div>
      )}
    </div>
  );
}

// ── Full page editor (used inside an expanded row) ────────────────────────────
function PageRow({ bookId, page, onChanged, onSelectPage, beforeGen }: {
  bookId: number; page: MapPage; onChanged: () => void;
  onSelectPage?: (pageId: number) => void; beforeGen: () => Promise<void>;
}) {
  const [obj, setObj] = useState(page.objectiveText);
  const [beat, setBeat] = useState(page.beatText);
  const [saving, setSaving] = useState(false);
  const [steerVal, setSteerVal] = useState("");
  const localSteer = { value: steerVal, setValue: setSteerVal, save: async () => {}, loaded: true };

  useEffect(() => { setObj(page.objectiveText); setBeat(page.beatText); }, [page.objectiveText, page.beatText]);

  const cand = useAIRun<{ options: string[] }>({ bookId, kind: "beat_candidates", targetPageId: page.id });
  const proposal = cand.run?.status === "ready" ? (cand.run.result?.options?.[0] ?? "") : "";
  const generating = cand.run?.status === "running" || cand.run?.status === "pending" || cand.starting;

  const proposeBeat = async () => {
    if (!obj.trim()) return;
    await beforeGen();
    void cand.start({ pageId: page.id, objective: obj.trim(), ...(steerVal.trim() ? { prompt: steerVal.trim() } : {}) });
  };

  const acceptProposal = async () => {
    if (!proposal) return;
    const text = proposal;
    setBeat(text);
    void cand.accept(async () => { await saveBeat(bookId, page.id, text); onChanged(); });
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
          <div className="pv-serif text-[18px] leading-snug tracking-[-0.01em] text-foreground">
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
      <div className="space-y-3">
        <Eyebrow className="block">Beat</Eyebrow>

        {beat.trim() && (
          <Panel variant="chosen" className="px-5 py-4">
            <AutoTextarea
              value={beat}
              onChange={(e) => setBeat(e.target.value)}
              onBlur={() => void saveB()}
              disabled={generating}
              className="pv-serif w-full border-none bg-transparent px-0 text-[15px] leading-[1.65] focus-visible:ring-0 disabled:opacity-50"
            />
          </Panel>
        )}

        {generating && <SkeletonCard />}

        {!generating && proposal && (
          <div className="rounded-2xl border border-border bg-[hsl(var(--pv-surface-2))]/40 px-5 py-4">
            <Eyebrow className="block mb-2">Proposed</Eyebrow>
            <p className="pv-serif text-[15px] leading-[1.65] text-foreground">{proposal}</p>
            <div className="mt-3 flex items-center gap-4">
              <button type="button" onClick={() => void acceptProposal()}
                className="pv-serif inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-[13.5px] text-primary-foreground">
                <Check className="h-3.5 w-3.5" /> Use this beat
              </button>
              <button type="button" onClick={() => void cand.reject()}
                className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))] hover:text-foreground">
                dismiss
              </button>
            </div>
          </div>
        )}

        {!generating && !proposal && (
          <GenRow
            steer={localSteer}
            label={beat.trim() ? "propose more" : "draft this beat"}
            icon={<Sparkles className="h-3.5 w-3.5" />}
            onFire={() => void proposeBeat()}
          />
        )}
      </div>

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
