import { useState, type ReactNode } from "react";
import { Lock, Check, BookOpen, Send } from "lucide-react";
import { ScaffoldGenerator } from "./ScaffoldGenerator";
import { WriteAllPages } from "./WriteAllPages";
import { WriteNextPage } from "./WriteNextPage";
import { AIActionRow } from "./AIActionRow";
import { useAdmin } from "@/hooks/use-admin";
import { BookEvaluationSection, type EvalResult } from "./BookEvaluationSection";
import { ReviseWithAI, type RevisionPrefill } from "./ReviseWithAI";
import type { EditorJSON } from "@/types/editor";

interface JourneyPage {
  page_type?: "text" | "section";
  content?: EditorJSON | null;
  metadata?: { objective?: string } | null;
}

interface BookJourneyProps {
  bookId: number;
  /** Brief gates the first AI move (scaffold); objectives are drawn from it. */
  briefSet: boolean;
  /** All book pages; the draft composition (blank/objective/written) is computed from text pages. */
  pages: JourneyPage[];
  /** Whether the book is already public — marks the final step done. */
  isPublic: boolean;
  onEditBrief: () => void;
  /** Called after scaffold creates pages, so the host can refresh. */
  onChanged: () => void;
  /** Opens the publishing dialog (lives in the host). */
  onPublish: () => void;
  /** Revise wiring, lifted from the host so the editor's-read → revise handoff still works. */
  revisionPrefill: RevisionPrefill | null;
  onRevisePrefill: (p: RevisionPrefill | null) => void;
  onRevisionApplied: () => void;
}

// Body text excluding the leading title heading — "written" means the same thing it does to the
// write-all cascade (a page has real prose, not just its title).
function bodyText(content: unknown): string {
  if (!content || typeof content !== "object")
    return typeof content === "string" ? content : "";
  const doc = content as { content?: Array<Record<string, unknown>> };
  if (!Array.isArray(doc.content)) return "";
  const nodes = doc.content[0]?.type === "heading" ? doc.content.slice(1) : doc.content;
  const walk = (n: Record<string, unknown>): string =>
    n.type === "text"
      ? String(n.text ?? "")
      : ((n.content as Array<Record<string, unknown>>) ?? []).map(walk).join("");
  return nodes.map(walk).join("").trim();
}

// blank → objective set → written, the three stages a page moves through.
const SEGMENTS = [
  { key: "blank", label: "blank", color: "transparent" },
  { key: "objective", label: "objective set", color: "#5b6db8" },
  { key: "written", label: "written", color: "hsl(var(--pv-accent))" },
] as const;

type StepStatus = "done" | "actionable" | "locked";

// One row of the vertical journey: a status node on the rail + a content column.
function StepRow({
  index,
  total,
  status,
  title,
  caption,
  children,
}: {
  index: number;
  total: number;
  status: StepStatus;
  title: string;
  caption: ReactNode;
  children?: ReactNode;
}) {
  const done = status === "done";
  const locked = status === "locked";
  return (
    <li className="relative flex gap-4 pb-7 last:pb-0">
      {/* Rail: the connecting line + the status node. */}
      {index < total - 1 && (
        <span
          aria-hidden
          className="absolute left-[15px] top-8 bottom-0 w-px bg-[hsl(var(--pv-border-soft))]"
        />
      )}
      <span
        className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums"
        style={
          done
            ? { background: "hsl(var(--pv-accent))", color: "white" }
            : locked
              ? { boxShadow: "inset 0 0 0 1.5px hsl(var(--pv-text-faint))", color: "hsl(var(--pv-text-faint))" }
              : { boxShadow: "inset 0 0 0 1.5px hsl(var(--pv-accent))", color: "hsl(var(--pv-accent))" }
        }
      >
        {done ? <Check className="h-4 w-4" /> : locked ? <Lock className="h-3.5 w-3.5" /> : index + 1}
      </span>

      <div className={`min-w-0 flex-1 pt-0.5 ${locked ? "opacity-60" : ""}`}>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h3 className="pv-serif text-[17px] leading-snug text-foreground">{title}</h3>
          {done && (
            <span className="pv-mono text-[10px] uppercase tracking-[0.1em] text-[hsl(var(--pv-accent))]">
              done
            </span>
          )}
        </div>
        <p className="pv-serif mt-0.5 text-[13.5px] italic leading-snug text-[hsl(var(--pv-text-faint))]">
          {caption}
        </p>
        {children && <div className="mt-3">{children}</div>}
      </div>
    </li>
  );
}

// A muted one-line stand-in shown in a locked step's body, naming what unlocks it.
function LockedNote({ reason }: { reason: string }) {
  return (
    <p className="pv-serif flex items-center gap-2 text-[13px] italic text-[hsl(var(--pv-text-faint))]">
      <Lock className="h-3.5 w-3.5" /> {reason}
    </p>
  );
}

/**
 * The book's AI journey, as a single guided staircase: created → brief → scaffold → write →
 * editor's read → revise → publish. Each step computes its own status from real state and
 * hard-locks its AI action until prerequisites are met — but only the AI is gated; manual
 * page writing (in the Manuscript tab) is never blocked.
 *
 * Dependency chain: brief → scaffold → write-all. Written prose then independently unlocks
 * the editor's read, revise, and publish (none of those three depend on each other).
 */
export function BookJourney({
  bookId,
  briefSet,
  pages,
  isPublic,
  onEditBrief,
  onChanged,
  onPublish,
  revisionPrefill,
  onRevisePrefill,
  onRevisionApplied,
}: BookJourneyProps) {
  const { isAdmin } = useAdmin();
  const [hasRead, setHasRead] = useState(false);

  const counts = { blank: 0, objective: 0, written: 0 };
  for (const p of pages) {
    if (p.page_type === "section") continue;
    if (bodyText(p.content)) counts.written += 1;
    else if (p.metadata?.objective) counts.objective += 1;
    else counts.blank += 1;
  }
  const hasScaffold = counts.objective > 0 || counts.written > 0;
  const hasWritten = counts.written > 0;
  const allWritten = hasWritten && counts.objective === 0;

  const TOTAL = 7;

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-[hsl(var(--pv-surface-2))]/40">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--pv-border-soft))] px-5 py-4">
        <span className="pv-eyebrow">Build with AI · the journey</span>
        <span className="pv-serif text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">
          the AI is gated step by step — you can always write by hand
        </span>
      </div>

      <ol className="px-5 py-6">
        {/* 1 — Book created. Trivially complete; you're standing on it. */}
        <StepRow
          index={0}
          total={TOTAL}
          status="done"
          title="Create the book"
          caption="The book exists — title, cover and metadata live on the Edit page."
        />

        {/* 2 — Set a brief. The one upstream gate for AI planning. */}
        <StepRow
          index={1}
          total={TOTAL}
          status={briefSet ? "done" : "actionable"}
          title="Set a brief"
          caption={
            briefSet
              ? "Your brief is set — objectives are drawn from it."
              : "Tell the AI what the book is. Objectives are drawn from this."
          }
        >
          <button
            type="button"
            onClick={onEditBrief}
            className="pv-serif text-[14px] italic text-[hsl(var(--pv-text-muted))] hover:text-foreground"
          >
            {briefSet ? "Edit the brief →" : "Set the brief →"}
          </button>
        </StepRow>

        {/* 3 — Generate outline (+ review, which is built into the generator's dialog). */}
        <StepRow
          index={2}
          total={TOTAL}
          status={!briefSet ? "locked" : hasScaffold ? "done" : "actionable"}
          title="Generate the outline"
          caption="Propose the chapters and pages as objectives — review the plan, then create. No prose yet."
        >
          {!briefSet ? (
            <LockedNote reason="Set your brief first." />
          ) : (
            <div className="space-y-3">
              {/* The draft's composition — kept here, where structure is born. */}
              {hasScaffold && (
                <div>
                  <div className="flex h-2.5 gap-1">
                    {SEGMENTS.filter((s) => counts[s.key] > 0).map((s) => (
                      <div
                        key={s.key}
                        className="min-w-[12px] rounded-full"
                        style={{
                          flex: counts[s.key],
                          background: s.key === "blank" ? undefined : s.color,
                          boxShadow: s.key === "blank" ? "inset 0 0 0 1.5px hsl(var(--pv-text-faint))" : undefined,
                        }}
                        title={`${counts[s.key]} ${s.label}`}
                      />
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                    {SEGMENTS.map((s) => (
                      <span key={s.key} className="pv-serif inline-flex items-center gap-1.5 text-[12.5px] text-[hsl(var(--pv-text-muted))]">
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{
                            background: s.key === "blank" ? "transparent" : s.color,
                            border: s.key === "blank" ? "1.5px dashed hsl(var(--pv-text-faint))" : undefined,
                          }}
                        />
                        <b className="font-semibold text-foreground tabular-nums">{counts[s.key]}</b> {s.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {/* Generating is append-only — it ADDS pages. Once an outline exists, the generator
                  retires so a second click can't stack a duplicate outline (stray pages). Changing
                  the structure now goes through editing pages or Revise (step 6). */}
              {!hasScaffold ? (
                <ScaffoldGenerator bookId={bookId} onCreated={onChanged} />
              ) : (
                <p className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))]">
                  Your outline is in place. Edit or remove pages in the Manuscript tab, or use “Revise” below to restructure with AI.
                </p>
              )}
            </div>
          )}
        </StepRow>

        {/* 4 — Write the pages. The default is incremental (WriteNextPage): write one page, read it,
            write the next — an attended loop that can't run away. The book-wide cascade
            (WriteAllPages) is the unbounded accelerator, gated to admins; non-admins don't see it. */}
        <StepRow
          index={3}
          total={TOTAL}
          status={!hasScaffold ? "locked" : allWritten ? "done" : "actionable"}
          title="Write the pages"
          caption="Render prose from each objective, one page at a time — read and revise as you go."
        >
          {!hasScaffold ? (
            <LockedNote reason="Generate an outline first." />
          ) : (
            <div className="space-y-3">
              {/* Incremental driver owns every state here (incl. "all written"), so it stays mounted
                  through the final page and keeps its read-after-write affordance. */}
              <WriteNextPage bookId={bookId} writtenCount={counts.written} onWritten={onChanged} />
              {isAdmin && counts.objective > 0 && <WriteAllPages bookId={bookId} plannedCount={counts.objective} />}
              <p className="pv-serif text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">
                You can also write or edit any page by hand in the Manuscript tab.
              </p>
            </div>
          )}
        </StepRow>

        {/* 5 — Editor's read. Locked until there's prose to read. */}
        <StepRow
          index={4}
          total={TOTAL}
          status={!hasWritten ? "locked" : hasRead ? "done" : "actionable"}
          title="Get an editor's read"
          caption="A structural critique of the draft — verdict, strengths and issues, page by page."
        >
          {!hasWritten ? (
            <LockedNote reason="Write some pages first." />
          ) : (
            <BookEvaluationSection
              bookId={bookId}
              onStatusChange={setHasRead}
              onRevise={(evaluation, instruction) => onRevisePrefill({ evaluation, instruction })}
            />
          )}
        </StepRow>

        {/* 6 — Revise. Locked until there's prose, but a read is NOT required first. */}
        <StepRow
          index={5}
          total={TOTAL}
          status={!hasWritten ? "locked" : "actionable"}
          title="Revise with AI"
          caption="Restructure or rework the draft — the AI proposes a plan you review before it sticks. A read isn't required."
        >
          {!hasWritten ? (
            <LockedNote reason="Write some pages first." />
          ) : (
            <ReviseWithAI
              bookId={bookId}
              prefill={revisionPrefill}
              onPrefillConsumed={() => onRevisePrefill(null)}
              onApplied={onRevisionApplied}
            />
          )}
        </StepRow>

        {/* 7 — Publish. Locked until there's prose; nothing beyond that is required. */}
        <StepRow
          index={6}
          total={TOTAL}
          status={!hasWritten ? "locked" : isPublic ? "done" : "actionable"}
          title="Publish"
          caption={
            isPublic
              ? "This book is public on pensive.me."
              : "Make the book public on pensive.me. A read or revision isn't required."
          }
        >
          {!hasWritten ? (
            <LockedNote reason="Write some pages first." />
          ) : isPublic ? (
            <AIActionRow
              icon={<Lock className="h-4 w-4" />}
              title="Unpublish"
              description="Make it private and remove it from the public library — you'll confirm first."
              onClick={onPublish}
            />
          ) : (
            <AIActionRow
              icon={<Send className="h-4 w-4" />}
              title="Publish the book"
              description="Make it public on pensive.me — opens the publishing flow."
              onClick={onPublish}
            />
          )}
        </StepRow>
      </ol>
    </section>
  );
}
