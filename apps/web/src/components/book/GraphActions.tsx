import { useState } from "react";
import { Lock, Send } from "lucide-react";
import { useAdmin } from "@/hooks/use-admin";
import { ScaffoldGenerator } from "./ScaffoldGenerator";
import { WriteAllPages } from "./WriteAllPages";
import { WriteNextPage } from "./WriteNextPage";
import { StalePanel } from "./StalePanel";
import { AIActionRow } from "./AIActionRow";
import { BookEvaluationSection } from "./BookEvaluationSection";
import { AutoRevise } from "./AutoRevise";
import { ReviseWithAI, type RevisionPrefill } from "./ReviseWithAI";
import type { EditorJSON } from "@/types/editor";

interface ActionsPage {
  page_type?: "text" | "section";
  content?: EditorJSON | null;
  metadata?: { objective?: string } | null;
}

interface GraphActionsProps {
  bookId: number;
  /** Brief gates the first AI move (the outline is drawn from it). */
  briefSet: boolean;
  pages: ActionsPage[];
  isPublic: boolean;
  onEditBrief: () => void;
  onChanged: () => void;
  onPublish: () => void;
}

// Body text excluding the leading title heading — "written" means a page has real prose, not just a title.
function bodyText(content: unknown): string {
  if (!content || typeof content !== "object") return typeof content === "string" ? content : "";
  const doc = content as { content?: Array<Record<string, unknown>> };
  if (!Array.isArray(doc.content)) return "";
  const nodes = doc.content[0]?.type === "heading" ? doc.content.slice(1) : doc.content;
  const walk = (n: Record<string, unknown>): string =>
    n.type === "text" ? String(n.text ?? "") : ((n.content as Array<Record<string, unknown>>) ?? []).map(walk).join("");
  return nodes.map(walk).join("").trim();
}

/**
 * Book-level AI actions for the resolution-graph surface — every BookJourney capability that isn't a
 * single node: set the brief, generate the OUTLINE (the 1→N scaffold that fills the graph), write the
 * pages, re-sync drifted prose, get an editor's read, revise the book, and publish. Per-node work
 * (spine/objective/beat/prose) happens in the graph itself; this covers the whole-book moves. The
 * editor's-read → revise handoff (a report's "fix this" prefilling the reviser) is kept self-contained
 * here. The old linear BookJourney stays in the codebase for reference.
 */
export function GraphActions({ bookId, briefSet, pages, isPublic, onEditBrief, onChanged, onPublish }: GraphActionsProps) {
  const { isAdmin } = useAdmin();
  // The editor's-read → revise handoff: a report's "fix this" prefills the reviser, kept local.
  const [revisionPrefill, setRevisionPrefill] = useState<RevisionPrefill | null>(null);

  const counts = { objective: 0, written: 0 };
  for (const p of pages) {
    if (p.page_type === "section") continue;
    if (bodyText(p.content)) counts.written += 1;
    else if (p.metadata?.objective) counts.objective += 1;
  }
  const hasScaffold = counts.objective > 0 || counts.written > 0;
  const hasWritten = counts.written > 0;

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-[hsl(var(--pv-surface-2))]/40">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--pv-border-soft))] px-5 py-4">
        <span className="pv-eyebrow">Build actions</span>
        <span className="pv-serif text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">
          the AI is gated step by step — you can always write by hand
        </span>
      </div>

      <div className="space-y-5 px-5 py-5">
        {/* Brief — the one upstream gate. Lives in its own tab; surfaced here when unset. */}
        {!briefSet && (
          <div className="space-y-1">
            <p className="pv-serif text-[14px] text-foreground">Start with a brief.</p>
            <p className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))]">Tell the AI what the book is — the outline is drawn from it.</p>
            <button type="button" onClick={onEditBrief} className="pv-serif text-[14px] italic text-[hsl(var(--pv-text-muted))] hover:text-foreground">
              Set the brief →
            </button>
          </div>
        )}

        {/* Outline — the scaffold (spine → N objectives) that fills the graph. Append-only: once an
            outline exists, structure changes happen by editing pages / nodes, not a second scaffold. */}
        {briefSet && !hasScaffold && (
          <div className="space-y-2">
            <div>
              <p className="pv-serif text-[14px] text-foreground">Generate the outline.</p>
              <p className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))]">Propose the chapters and pages as objectives — review, then create. No prose yet.</p>
            </div>
            <ScaffoldGenerator bookId={bookId} onCreated={onChanged} />
          </div>
        )}

        {/* Write — render prose from the objectives. Incremental driver owns "all written" too. */}
        {hasScaffold && (
          <div className="space-y-3">
            <StalePanel bookId={bookId} onRerendered={onChanged} />
            <WriteNextPage bookId={bookId} writtenCount={counts.written} onWritten={onChanged} />
            {isAdmin && counts.objective > 0 && <WriteAllPages bookId={bookId} plannedCount={counts.objective} />}
          </div>
        )}

        {/* Editor's read — a structural critique of the draft. Available once there's prose; its
            "fix this" hands a prefill to the reviser below. */}
        {hasWritten && (
          <div className="space-y-2">
            <div>
              <p className="pv-serif text-[14px] text-foreground">Get an editor's read.</p>
              <p className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))]">A structural critique — verdict, strengths and issues, page by page.</p>
            </div>
            <BookEvaluationSection
              bookId={bookId}
              onRevise={(evaluation, instruction) => setRevisionPrefill({ evaluation, instruction })}
            />
            {/* The closed loop: read → auto-fix critical/major page issues → re-read, one pass. The
                manual read above stays the human gate; this is the accelerator. */}
            <AutoRevise bookId={bookId} onRevised={onChanged} />
          </div>
        )}

        {/* Revise with AI — re-plan the outline or rework the draft. Available once an outline exists. */}
        {hasScaffold && (
          <div className="space-y-2">
            <div>
              <p className="pv-serif text-[14px] text-foreground">Revise with AI.</p>
              <p className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))]">Re-plan the outline or rework the draft — describe the change and review a plan before it sticks.</p>
            </div>
            <ReviseWithAI
              bookId={bookId}
              prefill={revisionPrefill}
              onPrefillConsumed={() => setRevisionPrefill(null)}
              onApplied={onChanged}
            />
          </div>
        )}

        {/* Publish — available once there's prose. */}
        {hasWritten && (
          isPublic ? (
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
          )
        )}
      </div>
    </section>
  );
}
