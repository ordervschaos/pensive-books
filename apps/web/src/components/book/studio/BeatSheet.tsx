// BeatSheet — whole-book beat sheet as an expandable accordion (manual editor).
//
//   • Top: "discard all beats & prose, re-plan" (when passed), then drift indicator if any pages
//     have beats out of sync with their objectives (visual only — author asks the chat to re-plan).
//   • Body: full list of all beat pages, each expanding inline to the full objective + beat editor.
//
// The conversational beat editor (ReviseChat layer="beats") lives in the studio's right rail.
// AI generation is NOT here — no per-page propose, no drift auto-fix. Ask the chat on the right.
import { useEffect, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { saveBeat, saveObjective } from "@/lib/ladder";
import type { StudioModel } from "./studioModel";
import type { MapPage } from "@/lib/planGraph";
import { ActionLink, Eyebrow, Panel, Pip } from "@/components/book/shared/studioUi";

export function BeatSheet({ bookId, model, onChanged, onSelectPage, onDiscardAll, discarding }: {
  bookId: number; model: StudioModel; onChanged: () => void;
  onSelectPage?: (pageId: number) => void;
  onDiscardAll?: () => void; discarding?: boolean;
}) {
  const beatPages = model.textPages.filter((p) => p.objectiveText.trim());
  const driftPages = beatPages.filter((p) => p.beat === "drift");

  // Drift is surfaced as a visual indicator only — the author asks the chat on the right to re-plan
  // any out-of-sync beats. No AI auto-fix here.
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
          <p className="pv-serif text-[13px] italic text-amber-600">
            {driftPages.length} beat{driftPages.length === 1 ? "" : "s"} out of sync — {driftNames}{driftSuffix}.{" "}
            Ask the editor on the right to re-plan them →
          </p>
        </div>
      )}

      {beatPages.length > 0 && (
        <BeatList
          bookId={bookId} beatPages={beatPages}
          onChanged={onChanged} onSelectPage={onSelectPage}
        />
      )}
    </div>
  );
}

// ── Accordion list ────────────────────────────────────────────────────────────
function BeatList({ bookId, beatPages, onChanged, onSelectPage }: {
  bookId: number; beatPages: MapPage[];
  onChanged: () => void; onSelectPage?: (pageId: number) => void;
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
        />
      ))}
    </div>
  );
}

function BeatRow({ bookId, page, pageNum, expanded, onToggle, onChanged, onSelectPage }: {
  bookId: number; page: MapPage; pageNum: number; expanded: boolean; onToggle: () => void;
  onChanged: () => void; onSelectPage?: (pageId: number) => void;
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
          />
        </div>
      )}
    </div>
  );
}

// ── Full page editor (used inside an expanded row) ────────────────────────────
// Manual editing only — no AI generation. Autosaves on blur. Drift pip is visible indicator only.
// To re-plan beats, use the editor chat on the right rail.
function PageRow({ bookId, page, onChanged, onSelectPage }: {
  bookId: number; page: MapPage; onChanged: () => void;
  onSelectPage?: (pageId: number) => void;
}) {
  const [obj, setObj] = useState(page.objectiveText);
  const [beat, setBeat] = useState(page.beatText);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setObj(page.objectiveText); setBeat(page.beatText); }, [page.objectiveText, page.beatText]);

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

      {/* Beat — type and edit directly; ask the chat on the right to generate or re-plan */}
      <div className="space-y-3">
        <Eyebrow className="block">Beat</Eyebrow>

        <Panel variant={beat.trim() ? "chosen" : "soft"} className="px-5 py-4">
          <AutoTextarea
            value={beat}
            onChange={(e) => setBeat(e.target.value)}
            onBlur={() => void saveB()}
            placeholder="What happens in this beat — or ask the editor on the right to plan it →"
            className="pv-serif w-full border-none bg-transparent px-0 text-[15px] leading-[1.65] focus-visible:ring-0 placeholder:text-[hsl(var(--pv-text-faint))]"
          />
        </Panel>
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
