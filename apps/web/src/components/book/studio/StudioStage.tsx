// StudioStage — the studio's right column. Routes on the current selection: a page's resolution
// ladder (PageReview), or a build/post step's tool. Each step is dressed in the same editorial head +
// gate chrome so the nine steps read as one game-like progression. The per-step tool bodies wrap the
// existing, backend-wired leaf tools (the durable runs, the serial beat picker, the evaluator …) — the
// redesign reshapes the surface around them without re-deriving their logic.
import { useState } from "react";
import { AlertTriangle, Lock, MessagesSquare, Send } from "lucide-react";
import { AIActionRow } from "../AIActionRow";
import { BookBriefSection } from "../BookBriefSection";
import { BookEvaluationSection, type CurrentRead } from "../BookEvaluationSection";
import type { Brief } from "@/lib/brief";
import type { Foundations } from "@/lib/foundations";
import { useSteer, type SteerStep } from "@/lib/steer";
import { STEP_CAPTION, STEP_LABEL, type StepKey, type StudioModel } from "./studioModel";
import { Gate, StageHead } from "./studioUi";
import { SteerField } from "./SteerField";
import { PageReview } from "./PageReview";
import { FoundationsStep } from "./steps/FoundationsStep";
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
  approving: StepKey | null;
  /** Bumped on every studio refresh — lets a Stage body re-read state an editor-rail apply changed. */
  editorEpoch: number;
  onApprove: (k: StepKey) => void;
  onChanged: () => void;
  onBriefChange: (brief: Brief) => void;
  onSpineStatus: (v: boolean) => void;
  onReadStatus: (v: boolean) => void;
  onSelectStep: (k: StepKey) => void;
  onPublish: () => void;
  onSelectPage: (pageId: number) => void;
}

const EYEBROW: Record<string, string> = {
  done: "Approved", awaiting: "Ready to approve", active: "Focus · the next move",
  available: "Post-draft · unlocked", locked: "Locked",
};

// Which steps carry an author "steer" (the guidance prompt shown on top, before generating), and the
// books.steers key each writes. Draft writes prose, so it shares the "prose" steer with PageReview.
const STEER_OF: Partial<Record<StepKey, SteerStep>> = {
  foundations: "foundations", spine: "spine", outline: "outline", beats: "beats", draft: "prose",
};
const STEER_PLACEHOLDER: Partial<Record<StepKey, string>> = {
  foundations: "e.g. literary, 1920s Cairo; morally grey protagonist; avoid chosen-one tropes",
  spine: "e.g. foreground the father–son rift; keep the midpoint a betrayal",
  outline: "e.g. tighter act two; open in media res; chapter-length sections",
  beats: "e.g. more subtext, less action; end every beat on an image",
  draft: "e.g. spare, sensory prose; short paragraphs; no exposition dumps",
};

export function StudioStage(props: StageProps) {
  const { model, selection } = props;

  const body = selection.kind === "page"
    ? <PageReview bookId={props.bookId} model={model} pageId={selection.pageId} onChanged={props.onChanged} onSelectPage={props.onSelectPage} />
    : <StepView {...props} stepKey={selection.step} />;

  const key = selection.kind === "page" ? `p${selection.pageId}` : `s${selection.step}`;

  // A page's ladder is something you READ — give it a booky reading column. The build/post steps carry
  // wider controls, so they keep the roomier measure.
  const width = selection.kind === "page" ? "max-w-[600px]" : "max-w-[700px]";

  return (
    <div className="h-full min-h-0 overflow-y-auto px-6 pb-16 pt-8">
      <div key={key} className={`mx-auto ${width} animate-in fade-in slide-in-from-bottom-1 duration-300`}>{body}</div>
    </div>
  );
}

function StepView(props: StageProps & { stepKey: StepKey }) {
  const { model, stepKey: k, bookId } = props;
  const status = model.statusOf(k);
  const approving = props.approving === k;
  // The current editor's read (result + identity), surfaced by BookEvaluationSection. Gates the
  // "Address the notes" zone and feeds the agent — which uses the result to launch and the createdAt
  // to supersede a run built on a read a re-run replaced.
  const [currentRead, setCurrentRead] = useState<CurrentRead | null>(null);

  // The step's author steer, rendered on top (below the head). Disabled (no fetch) for steps that
  // don't generate; `steer.save` is handed to the step as `beforeGen`, called right before each run.
  const steerStep = STEER_OF[k];
  const steer = useSteer(bookId, steerStep ?? "spine", !!steerStep);

  if (status === "locked") {
    const reason =
      k === "read" || k === "publish" ? "Write some pages first."
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

  // Done, but an upstream root (brief / foundations / spine) has changed since this step was approved.
  // Not a block — a flag: revise the content here to match, then re-approve (which re-stamps & clears).
  const stale = model.staleOf(k);

  const gate = (label: string, hint: string) => {
    if (status === "awaiting")
      return <Gate label={label} enabled hint={hint} busy={approving} onClick={() => props.onApprove(k)} />;
    if (stale)
      return (
        <Gate
          label={label.replace(/^Approve/, "Re-approve")}
          enabled
          hint="re-confirm now that you've worked in the change from above"
          busy={approving}
          onClick={() => props.onApprove(k)}
        />
      );
    return null;
  };

  return (
    <div>
      <StageHead eyebrow={stale ? "Out of sync · review" : EYEBROW[status] ?? "Focus · the next move"} title={STEP_LABEL[k]} caption={STEP_CAPTION[k]} />

      {stale && (
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/[0.06] px-5 py-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
          <p className="pv-serif text-[14px] leading-relaxed text-[hsl(var(--pv-text-muted))]">
            <b className="font-medium not-italic text-foreground">Something upstream changed since you approved this.</b>{" "}
            Revise the content below to match, then re-approve. Nothing's blocked — this is just where your attention is needed next.
          </p>
        </div>
      )}

      {/* Outline and draft keep the persistent steer at the top (no inline bundle yet). */}
      {steerStep && k !== "foundations" && k !== "spine" && k !== "beats" && (
        <div className="mb-5"><SteerField steer={steer} placeholder={STEER_PLACEHOLDER[k]} /></div>
      )}

      {k === "brief" && (
        <>
          <BookBriefSection bookId={bookId} brief={props.brief} onBriefChange={props.onBriefChange} />
          {gate("Approve the brief & continue", "a deliberate sign-off — one of six gates")}
        </>
      )}
      {k === "foundations" && (
        <>
          <FoundationsStep bookId={bookId} foundations={props.foundations ?? {}} beforeGen={steer.save} onChanged={props.onChanged} />
          {gate("Approve the foundations & continue", "what you pinned, every step below must keep")}
        </>
      )}
      {k === "spine" && (
        <>
          <SpineStep bookId={bookId} foundations={props.foundations} steer={steer} beforeGen={steer.save} reloadKey={props.editorEpoch} onStatusChange={props.onSpineStatus} onChanged={props.onChanged} />
          {gate("Approve the spine & continue", "the outline is built to realize it")}
        </>
      )}
      {k === "outline" && (
        <>
          <OutlineStep bookId={bookId} model={model} beforeGen={steer.save} onChanged={props.onChanged} onSelectPage={props.onSelectPage} />
          {gate("Approve the outline & continue", "re-plan from the outline tools anytime")}
        </>
      )}
      {k === "beats" && (
        <>
          <BeatsStep bookId={bookId} model={model} steer={steer} beforeGen={steer.save} onChanged={props.onChanged} onSelectPage={props.onSelectPage} />
          {gate("Approve the beats & continue", "the author approves the plan, not each unit")}
        </>
      )}
      {k === "draft" && (
        <>
          <DraftStep bookId={bookId} model={model} beforeGen={steer.save} onChanged={props.onChanged} onSelectPage={props.onSelectPage} onSelectStep={props.onSelectStep} />
          {gate("Approve — the draft is built", "read it through, then refine")}
        </>
      )}
      {k === "read" && (
        <div className="space-y-5">
          <BookEvaluationSection
            bookId={bookId}
            onStatusChange={props.onReadStatus}
            onCurrentRead={setCurrentRead}
          />
          {/* Acting on the read now happens in ONE place — the Draft step's prose editor (the rail).
              Hand it the whole read; it reads the pages, asks about the judgment calls, and proposes a
              revision it builds into your drafts. (Replaces the retired standalone Revise step.) */}
          {currentRead && (
            <AIActionRow
              icon={<MessagesSquare className="h-4 w-4" />}
              title="Work these notes in the prose editor"
              description="Opens the Draft step's prose editor and hands it this read — it reads the pages, asks you about the judgment calls, then proposes a revision."
              onClick={() => props.onSelectStep("draft")}
            />
          )}
        </div>
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
