import { useMemo, useState, type ReactNode } from "react";
import { Lock, Check, Send } from "lucide-react";
import { ScaffoldGenerator } from "./ScaffoldGenerator";
import { VoiceGenerator } from "./VoiceGenerator";
import { SpineGenerator } from "./SpineGenerator";
import { SerialBeats } from "./SerialBeats";
import { DraftProse } from "./DraftProse";
import { AutoRevise } from "./AutoRevise";
import { AIActionRow } from "./AIActionRow";
import { BookBriefSection } from "./BookBriefSection";
import { BookEvaluationSection } from "./BookEvaluationSection";
import { ReviseWithAI, type RevisionPrefill } from "./ReviseWithAI";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { Brief } from "@/lib/brief";
import type { EditorJSON } from "@/types/editor";

interface StudioPage {
  page_type?: "text" | "section";
  content?: EditorJSON | null;
  metadata?: { objective?: string; beat?: string } | null;
}

type StepKey = "brief" | "spine" | "outline" | "voice" | "beats" | "draft" | "read" | "revise" | "publish";
type Journey = Partial<Record<"brief" | "spine" | "outline" | "voice" | "beats" | "draft", string>>;

interface JourneyStudioProps {
  bookId: number;
  briefSet: boolean;
  brief: Brief | null;
  pages: StudioPage[];
  journey: Journey;
  isPublic: boolean;
  onBriefChange: (brief: Brief) => void;
  onChanged: () => void;
  onPublish: () => void;
}

function bodyText(content: unknown): string {
  if (!content || typeof content !== "object") return typeof content === "string" ? content : "";
  const doc = content as { content?: Array<Record<string, unknown>> };
  if (!Array.isArray(doc.content)) return "";
  const nodes = doc.content[0]?.type === "heading" ? doc.content.slice(1) : doc.content;
  const walk = (n: Record<string, unknown>): string =>
    n.type === "text" ? String(n.text ?? "") : ((n.content as Array<Record<string, unknown>>) ?? []).map(walk).join("");
  return nodes.map(walk).join("").trim();
}

type StepState = "locked" | "active" | "awaiting" | "done" | "available";

const BUILD: StepKey[] = ["brief", "spine", "outline", "voice", "beats", "draft"];
const LABELS: Record<StepKey, string> = {
  brief: "Brief", spine: "Spine", outline: "Outline", voice: "Voice",
  beats: "Beats", draft: "Draft", read: "Read", revise: "Revise", publish: "Publish",
};
const ALL: StepKey[] = [...BUILD, "read", "revise", "publish"];

/**
 * The build studio: a pinned step rail over the resolution graph. The rail is always present in the
 * AI-tools tab — every step's status is derived from real data (+ books.journey approvals), the
 * current step is lit with its next action, and selecting any unlocked step opens its tool INLINE
 * (no tab-jump). The gated build ladder (brief→…→draft) needs an "Approve & continue" to advance;
 * read/revise/publish unlock once there's prose. Subsumes the old GraphActions; the graph below is
 * the granular per-node workspace.
 */
export function JourneyStudio({ bookId, briefSet, brief, pages, journey, isPublic, onBriefChange, onChanged, onPublish }: JourneyStudioProps) {
  const { toast } = useToast();
  const [approving, setApproving] = useState<StepKey | null>(null);
  const [selected, setSelected] = useState<StepKey | null>(null);
  const [hasSpine, setHasSpine] = useState(false);
  const [hasVoice, setHasVoice] = useState(false);
  const [hasRead, setHasRead] = useState(false);
  const [revisionPrefill, setRevisionPrefill] = useState<RevisionPrefill | null>(null);

  const counts = useMemo(() => {
    let objective = 0, written = 0, beats = 0;
    for (const p of pages) {
      if (p.page_type === "section") continue;
      if (bodyText(p.content)) written += 1;
      else if (p.metadata?.objective) objective += 1;
      if ((p.metadata?.beat ?? "").trim()) beats += 1;
    }
    return { objective, written, beats };
  }, [pages]);
  const hasScaffold = counts.objective > 0 || counts.written > 0;
  const hasWritten = counts.written > 0;
  const beatsRemaining = Math.max(0, counts.objective + counts.written - counts.beats);
  const proseRemaining = counts.objective;

  const approved = (k: StepKey) => k in journey && !!journey[k as keyof Journey];
  const ready: Record<string, boolean> = {
    brief: briefSet, spine: hasSpine, outline: hasScaffold, voice: hasVoice,
    beats: hasScaffold && beatsRemaining === 0 && counts.beats > 0,
    draft: hasWritten && proseRemaining === 0,
  };

  function stateOf(k: StepKey): StepState {
    if (BUILD.includes(k)) {
      if (approved(k)) return "done";
      const idx = BUILD.indexOf(k);
      const priorDone = idx === 0 || approved(BUILD[idx - 1]);
      if (!priorDone) return "locked";
      return ready[k] ? "awaiting" : "active";
    }
    // Post-draft actions: unlocked once there's prose (revise also once an outline exists).
    if (k === "read") return !hasWritten ? "locked" : hasRead ? "done" : "available";
    if (k === "revise") return hasScaffold ? "available" : "locked";
    if (k === "publish") return !hasWritten ? "locked" : isPublic ? "done" : "available";
    return "locked";
  }

  // The current step = first build step not yet done (with prereqs met), else first available action.
  const current: StepKey = useMemo(() => {
    for (const k of BUILD) { const s = stateOf(k); if (s === "active" || s === "awaiting") return k; }
    if (hasWritten && !hasRead) return "read";
    if (!isPublic && hasWritten) return "publish";
    return "draft";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journey, counts.objective, counts.written, counts.beats, hasSpine, hasVoice, hasRead, isPublic, briefSet]);

  const open = selected ?? current;

  const approve = async (k: StepKey) => {
    if (approving) return;
    setApproving(k);
    try {
      const { data } = await supabase.from("books").select("journey").eq("id", bookId).maybeSingle();
      const next = { ...((data?.journey as Journey | null) ?? {}), [k]: new Date().toISOString() };
      const { error } = await supabase.from("books").update({ journey: next }).eq("id", bookId);
      if (error) throw error;
      // Advance the open panel to the next step so the flow keeps moving.
      const idx = BUILD.indexOf(k);
      setSelected(idx >= 0 && idx < BUILD.length - 1 ? BUILD[idx + 1] : "read");
      onChanged();
    } catch (e) {
      toast({ title: "Couldn't save your approval", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setApproving(null);
    }
  };

  const nextLabel: Record<StepKey, string> = {
    brief: "set the brief", spine: "find the spine", outline: "generate the outline",
    voice: "pick the voice", beats: "plan the beats", draft: "write the draft",
    read: "get an editor's read", revise: "revise with AI", publish: "publish the book",
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-[hsl(var(--pv-surface-2))]/40">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--pv-border-soft))] px-5 py-4">
        <span className="pv-eyebrow">Build with AI</span>
        <span className="pv-serif text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">
          {stateOf(current) === "awaiting" ? "ready to approve" : <>▸ next: {nextLabel[current]}</>}
        </span>
      </div>

      {/* The rail — every step as a chip; click any unlocked one to open its tool below. */}
      <div className="flex flex-wrap gap-1.5 px-5 pt-4 pb-1">
        {ALL.map((k, i) => (
          <Chip key={k} n={i + 1} label={LABELS[k]} state={stateOf(k)} selected={open === k} onClick={() => setSelected(k)} />
        ))}
      </div>

      {/* The open step's tool, inline. */}
      <div className="px-5 pb-5 pt-3">
        <StepPanel
          stepKey={open}
          state={stateOf(open)}
          bookId={bookId}
          brief={brief}
          briefSet={briefSet}
          counts={counts}
          beatsRemaining={beatsRemaining}
          proseRemaining={proseRemaining}
          hasScaffold={hasScaffold}
          isPublic={isPublic}
          revisionPrefill={revisionPrefill}
          onBriefChange={onBriefChange}
          onChanged={onChanged}
          onSpineStatus={setHasSpine}
          onVoiceStatus={setHasVoice}
          onReadStatus={setHasRead}
          onRevisePrefill={setRevisionPrefill}
          onPublish={onPublish}
          approve={approve}
          approving={approving === open}
        />
      </div>
    </section>
  );
}

function Chip({ n, label, state, selected, onClick }: { n: number; label: string; state: StepState; selected: boolean; onClick: () => void }) {
  const locked = state === "locked";
  const done = state === "done";
  const awaiting = state === "awaiting";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={locked}
      aria-current={selected}
      className={[
        "pv-serif inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] transition-colors",
        selected ? "border-[hsl(var(--pv-accent))] bg-[hsl(var(--pv-accent))]/10 text-foreground"
          : locked ? "border-[hsl(var(--pv-border-soft))] text-[hsl(var(--pv-text-faint))] opacity-60"
          : "border-border text-[hsl(var(--pv-text-muted))] hover:text-foreground hover:border-[hsl(var(--pv-text-faint))]",
      ].join(" ")}
    >
      <span className="inline-flex h-4 w-4 items-center justify-center">
        {done ? <Check className="h-3.5 w-3.5 text-[hsl(var(--pv-accent))]" />
          : locked ? <Lock className="h-3 w-3" />
          : <span className="tabular-nums text-[11px]">{n}</span>}
      </span>
      {label}
      {awaiting && <span className="h-[6px] w-[6px] rounded-full bg-[#5b6db8]" title="ready to approve" />}
    </button>
  );
}

interface PanelProps {
  stepKey: StepKey;
  state: StepState;
  bookId: number;
  brief: Brief | null;
  briefSet: boolean;
  counts: { objective: number; written: number; beats: number };
  beatsRemaining: number;
  proseRemaining: number;
  hasScaffold: boolean;
  isPublic: boolean;
  revisionPrefill: RevisionPrefill | null;
  onBriefChange: (brief: Brief) => void;
  onChanged: () => void;
  onSpineStatus: (v: boolean) => void;
  onVoiceStatus: (v: boolean) => void;
  onReadStatus: (v: boolean) => void;
  onRevisePrefill: (p: RevisionPrefill | null) => void;
  onPublish: () => void;
  approve: (k: StepKey) => void;
  approving: boolean;
}

const CAPTIONS: Record<StepKey, string> = {
  brief: "Tell the AI what the book is — every step below is drawn from it.",
  spine: "The one-paragraph throughline the whole book realizes.",
  outline: "The chapters and pages as objectives — review, edit, create. No prose yet.",
  voice: "Pick how the book sounds — it anchors every page the AI writes.",
  beats: "Walk the book page by page — pick from three takes for each beat — before any prose.",
  draft: "Render the prose from the approved beats, in the book's voice.",
  read: "A structural critique of the draft — then auto-fix the critical & major issues.",
  revise: "Re-plan the outline or rework the draft — describe the change and review before it sticks.",
  publish: "Make the book public on pensive.me.",
};

function StepPanel(p: PanelProps) {
  const { stepKey: k, state } = p;
  if (state === "locked") {
    return (
      <LockedBody reason={
        k === "spine" || k === "outline" || k === "voice" || k === "beats" || k === "draft"
          ? "Clear the previous step to unlock."
          : k === "revise" ? "Generate an outline first." : "Write some pages first."
      } title={LABELS[k]} caption={CAPTIONS[k]} />
    );
  }

  const approveBtn = (label: string) =>
    state === "awaiting" ? (
      <Button size="sm" onClick={() => p.approve(k)} disabled={p.approving}>
        <Check className="mr-2 h-4 w-4" /> {p.approving ? "Saving…" : label}
      </Button>
    ) : null;

  return (
    <div className="space-y-3">
      <div>
        <h3 className="pv-serif text-[17px] leading-snug text-foreground">{LABELS[k]}</h3>
        <p className="pv-serif mt-0.5 text-[13.5px] italic leading-snug text-[hsl(var(--pv-text-faint))]">{CAPTIONS[k]}</p>
      </div>

      {k === "brief" && (
        <>
          <BookBriefSection bookId={p.bookId} brief={p.brief} onBriefChange={p.onBriefChange} />
          {approveBtn("Approve & continue")}
        </>
      )}
      {k === "spine" && (
        <>
          <SpineGenerator bookId={p.bookId} onStatusChange={p.onSpineStatus} onChanged={p.onChanged} />
          {approveBtn("Approve the spine & continue")}
        </>
      )}
      {k === "outline" && (
        <>
          {p.hasScaffold
            ? <p className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))]">Outline in place — {p.counts.objective + p.counts.written} pages. Edit pages in the graph below or the Manuscript tab.</p>
            : <ScaffoldGenerator bookId={p.bookId} onCreated={p.onChanged} />}
          {approveBtn("Approve the outline & continue")}
        </>
      )}
      {k === "voice" && (
        <>
          <VoiceGenerator bookId={p.bookId} onStatusChange={p.onVoiceStatus} onChosen={p.onChanged} />
          {approveBtn("Approve the voice & continue")}
        </>
      )}
      {k === "beats" && (
        <>
          <SerialBeats bookId={p.bookId} onChanged={p.onChanged} />
          {approveBtn("Approve the beats & continue")}
        </>
      )}
      {k === "draft" && (
        <>
          <DraftProse bookId={p.bookId} remaining={p.proseRemaining} onChanged={p.onChanged} />
          {approveBtn("Done — mark the draft built")}
        </>
      )}
      {k === "read" && (
        <div className="space-y-3">
          <BookEvaluationSection bookId={p.bookId} onStatusChange={p.onReadStatus} onRevise={(evaluation, instruction) => p.onRevisePrefill({ evaluation, instruction })} />
          <AutoRevise bookId={p.bookId} onRevised={p.onChanged} />
        </div>
      )}
      {k === "revise" && (
        <ReviseWithAI bookId={p.bookId} prefill={p.revisionPrefill} onPrefillConsumed={() => p.onRevisePrefill(null)} onApplied={p.onChanged} />
      )}
      {k === "publish" && (
        p.isPublic ? (
          <AIActionRow icon={<Lock className="h-4 w-4" />} title="Unpublish" description="Make it private and remove it from the public library — you'll confirm first." onClick={p.onPublish} />
        ) : (
          <AIActionRow icon={<Send className="h-4 w-4" />} title="Publish the book" description="Make it public on pensive.me — opens the publishing flow." onClick={p.onPublish} />
        )
      )}
    </div>
  );
}

function LockedBody({ title, caption, reason }: { title: string; caption: string; reason: string }) {
  return (
    <div className="space-y-2 opacity-70">
      <div>
        <h3 className="pv-serif text-[17px] leading-snug text-foreground">{title}</h3>
        <p className="pv-serif mt-0.5 text-[13.5px] italic leading-snug text-[hsl(var(--pv-text-faint))]">{caption}</p>
      </div>
      <p className="pv-serif flex items-center gap-2 text-[13px] italic text-[hsl(var(--pv-text-faint))]">
        <Lock className="h-3.5 w-3.5" /> {reason}
      </p>
    </div>
  );
}
