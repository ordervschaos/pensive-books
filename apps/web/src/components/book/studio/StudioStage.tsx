// StudioStage — the studio's right column. Routes on the current selection: a page's resolution
// ladder (PageReview), or a build/post step's tool. Each step is dressed in the same editorial head +
// gate chrome so the nine steps read as one game-like progression. The per-step tool bodies wrap the
// existing, backend-wired leaf tools (the durable runs, the serial beat picker, the evaluator …) — the
// redesign reshapes the surface around them without re-deriving their logic.
import { Lock, Send } from "lucide-react";
import { AutoRevise } from "../AutoRevise";
import { AIActionRow } from "../AIActionRow";
import { BookBriefSection } from "../BookBriefSection";
import { BookEvaluationSection } from "../BookEvaluationSection";
import { ReviseWithAI, type RevisionPrefill } from "../ReviseWithAI";
import type { Brief } from "@/lib/brief";
import type { Foundations } from "@/lib/foundations";
import { STEP_CAPTION, STEP_LABEL, type StepKey, type StudioModel } from "./studioModel";
import { Gate, StageHead } from "./studioUi";
import { PageReview } from "./PageReview";
import { FoundationsStep } from "./steps/FoundationsStep";
import { VoiceStep } from "./steps/VoiceStep";
import { BeatsStep } from "./steps/BeatsStep";
import { SpineStep } from "./steps/SpineStep";
import { OutlineStep } from "./steps/OutlineStep";
import { DraftStep } from "./steps/DraftStep";
import type { Selection } from "./BuildStudio";

interface StageProps {
  model: StudioModel;
  bookId: number;
  selection: Selection;
  brief: Brief | null;
  foundations: Foundations | null;
  isPublic: boolean;
  revisionPrefill: RevisionPrefill | null;
  approving: StepKey | null;
  onApprove: (k: StepKey) => void;
  onChanged: () => void;
  onBriefChange: (brief: Brief) => void;
  onSpineStatus: (v: boolean) => void;
  onVoiceStatus: (v: boolean) => void;
  onReadStatus: (v: boolean) => void;
  onRevisePrefill: (p: RevisionPrefill | null) => void;
  onPublish: () => void;
  onSelectPage: (pageId: number) => void;
}

const EYEBROW: Record<string, string> = {
  done: "Approved", awaiting: "Ready to approve", active: "Focus · the next move",
  available: "Post-draft · unlocked", locked: "Locked",
};

export function StudioStage(props: StageProps) {
  const { model, selection } = props;

  const body = selection.kind === "page"
    ? <PageReview bookId={props.bookId} model={model} pageId={selection.pageId} onChanged={props.onChanged} onSelectPage={props.onSelectPage} />
    : <StepView {...props} stepKey={selection.step} />;

  const key = selection.kind === "page" ? `p${selection.pageId}` : `s${selection.step}`;

  return (
    <div className="overflow-y-auto px-10 pb-20 pt-10">
      <div key={key} className="mx-auto max-w-[700px] animate-in fade-in slide-in-from-bottom-1 duration-300">{body}</div>
    </div>
  );
}

function StepView(props: StageProps & { stepKey: StepKey }) {
  const { model, stepKey: k, bookId } = props;
  const status = model.statusOf(k);
  const approving = props.approving === k;

  if (status === "locked") {
    const reason =
      k === "revise" ? "Generate an outline first."
        : k === "read" || k === "publish" ? "Write some pages first."
          : "Clear the previous step to unlock.";
    return (
      <div className="opacity-70">
        <StageHead eyebrow={EYEBROW.locked} title={STEP_LABEL[k]} caption={STEP_CAPTION[k]} />
        <p className="pv-serif flex items-center gap-2 text-[14px] italic text-[hsl(var(--pv-text-faint))]">
          <Lock className="h-4 w-4" /> {reason}
        </p>
      </div>
    );
  }

  const gate = (label: string, hint: string) =>
    status === "awaiting" ? (
      <Gate label={label} enabled hint={hint} busy={approving} onClick={() => props.onApprove(k)} />
    ) : null;

  return (
    <div>
      <StageHead eyebrow={EYEBROW[status] ?? "Focus · the next move"} title={STEP_LABEL[k]} caption={STEP_CAPTION[k]} />

      {k === "brief" && (
        <>
          <BookBriefSection bookId={bookId} brief={props.brief} onBriefChange={props.onBriefChange} />
          {gate("Approve & continue", "a deliberate sign-off — one of six gates")}
        </>
      )}
      {k === "foundations" && (
        <>
          <FoundationsStep bookId={bookId} foundations={props.foundations ?? {}} onChanged={props.onChanged} onVoiceStatus={props.onVoiceStatus} />
          {gate("Approve the foundations & continue", "what you pinned, every step below must keep")}
        </>
      )}
      {k === "spine" && (
        <>
          <SpineStep bookId={bookId} newFlow={model.newFlow} foundations={props.foundations} onStatusChange={props.onSpineStatus} onChanged={props.onChanged} />
          {gate("Approve the spine & continue", "the outline is built to realize it")}
        </>
      )}
      {k === "outline" && (
        <>
          <OutlineStep bookId={bookId} model={model} onChanged={props.onChanged} onSelectPage={props.onSelectPage} />
          {gate("Approve the outline & continue", "re-plan from the Revise step anytime")}
        </>
      )}
      {k === "voice" && (
        <>
          <VoiceStep bookId={bookId} onStatusChange={props.onVoiceStatus} onChanged={props.onChanged} />
          {gate("Approve the voice & continue", "anchors every page the AI writes")}
        </>
      )}
      {k === "beats" && (
        <>
          <BeatsStep bookId={bookId} model={model} onChanged={props.onChanged} />
          {gate("Approve the beats & continue", "the author approves the plan, not each unit")}
        </>
      )}
      {k === "draft" && (
        <>
          <DraftStep bookId={bookId} model={model} onChanged={props.onChanged} onSelectPage={props.onSelectPage} />
          {gate("Approve — the draft is built", "read it through, then refine")}
        </>
      )}
      {k === "read" && (
        <div className="space-y-4">
          <BookEvaluationSection bookId={bookId} onStatusChange={props.onReadStatus} onRevise={(evaluation, instruction) => props.onRevisePrefill({ evaluation, instruction })} />
          <AutoRevise bookId={bookId} onRevised={props.onChanged} />
        </div>
      )}
      {k === "revise" && (
        <ReviseWithAI bookId={bookId} prefill={props.revisionPrefill} onPrefillConsumed={() => props.onRevisePrefill(null)} onApplied={props.onChanged} />
      )}
      {k === "publish" && (
        props.isPublic ? (
          <AIActionRow icon={<Lock className="h-4 w-4" />} title="Unpublish" description="Make it private and remove it from the public library — you'll confirm first." onClick={props.onPublish} />
        ) : (
          <AIActionRow icon={<Send className="h-4 w-4" />} title="Publish the book" description="Make it public on pensive.me — opens the publishing flow." onClick={props.onPublish} />
        )
      )}
    </div>
  );
}
