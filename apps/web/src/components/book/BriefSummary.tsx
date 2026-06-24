import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { BookBriefSection } from "@/components/book/BookBriefSection";
import { Brief, computeCompletion, scopeSummary } from "@/lib/brief";

interface BriefSummaryProps {
  bookId: number;
  brief: Brief | null;
  onBriefChange: (brief: Brief) => void;
}

/**
 * Compact, glanceable view of the creative brief — sits in the book header, under the title and
 * above the word-target meter. The "Brief" tab is gone; editing now happens in a dialog opened from
 * here (the same form the Studio's brief step uses, rendered bare).
 */
export function BriefSummary({ bookId, brief, onBriefChange }: BriefSummaryProps) {
  const [open, setOpen] = useState(false);
  const isSet = computeCompletion(brief) > 0;
  const scope = scopeSummary(brief?.scope);

  const meta: string[] = [];
  if (scope) meta.push(scope);
  if (brief?.genre) meta.push(brief.genre);
  if (brief?.tone?.length) meta.push(brief.tone.join(", "));

  return (
    <div className="mb-6 max-w-[600px]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="pv-eyebrow mb-1.5">Brief</div>
          {isSet ? (
            <>
              {brief?.premise && (
                <p className="pv-serif text-[15px] italic leading-snug text-foreground">
                  {brief.premise}
                </p>
              )}
              {meta.length > 0 && (
                <div className="pv-mono mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] uppercase tracking-[0.15em] text-[hsl(var(--pv-text-muted))]">
                  {meta.map((part, i) => (
                    <span key={part} className="inline-flex items-center gap-2">
                      {i > 0 && (
                        <span className="inline-block h-[3px] w-[3px] rounded-full bg-[hsl(var(--pv-text-faint))]" />
                      )}
                      {part}
                    </span>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="pv-serif text-[14px] italic leading-snug text-[hsl(var(--pv-text-muted))]">
              No brief yet — set your intentions to guide the writing and the Studio.
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => setOpen(true)}
          className="pv-serif inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-transparent px-3.5 py-1.5 text-[13px] text-[hsl(var(--pv-text-muted))] transition-colors hover:text-foreground"
        >
          {isSet ? (
            <>
              <Pencil className="h-3.5 w-3.5" />
              <span>Edit</span>
            </>
          ) : (
            <>
              <Plus className="h-3.5 w-3.5" />
              <span>Set brief</span>
            </>
          )}
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>Creative brief</DialogTitle>
            <DialogDescription>
              Optional scaffolding for you and any co-authors — never shown to readers.
            </DialogDescription>
          </DialogHeader>
          <BookBriefSection
            embedded
            bookId={bookId}
            brief={brief}
            onBriefChange={onBriefChange}
            onSaved={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
