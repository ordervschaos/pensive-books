import { Sparkles, Check, Loader2, Circle } from "lucide-react";
import { UIFrame } from "../UIFrame";

// The pipeline: a brief is set, a scaffold of objective-bearing pages is drafted,
// then prose is written for every page with live progress (Writing X/Y).
// Mirrors ScaffoldGenerator.tsx + WriteAllPages.tsx + the brief intake.
const PAGES: Array<
  | { type: "section"; title: string }
  | { type: "text"; title: string; objective: string; status: "done" | "writing" | "todo" }
> = [
  { type: "section", title: "Part One · The Strait" },
  { type: "text", title: "The Lighthouse Keeper", objective: "Establish Mara's isolation", status: "done" },
  { type: "text", title: "Salvage", objective: "Mara finds the journal", status: "done" },
  { type: "text", title: "Across the Water", objective: "Reveal the rival keeper", status: "writing" },
  { type: "text", title: "The Wreck Remembered", objective: "The journal's first secret", status: "todo" },
];

const CHIPS = ["Literary mystery", "~24 pages", "Measured pace"];

function StatusIcon({ status }: { status: "done" | "writing" | "todo" }) {
  if (status === "done")
    return <Check className="h-3.5 w-3.5 text-[hsl(var(--pv-accent))]" />;
  if (status === "writing")
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-foreground" />;
  return <Circle className="h-3 w-3 text-[hsl(var(--pv-text-faint))]" />;
}

export function GenerateMock() {
  return (
    <UIFrame crumb="New book · generate">
      {/* The brief the author set */}
      <div className="rounded-lg border border-border bg-background px-4 py-3">
        <div className="pv-mono mb-1 text-[10px] uppercase tracking-[0.15em] text-[hsl(var(--pv-text-faint))]">
          Your brief
        </div>
        <p className="pv-serif text-[13.5px] leading-snug text-foreground">
          A quiet literary mystery set in a remote lighthouse — a keeper, a
          wrecked ship, a journal that shouldn&apos;t exist.
        </p>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {CHIPS.map((c) => (
            <span
              key={c}
              className="pv-mono rounded-full border border-border px-2 py-0.5 text-[9.5px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-muted))]"
            >
              {c}
            </span>
          ))}
        </div>
      </div>

      {/* The scaffold filling in, page by page */}
      <div className="mt-3 rounded-lg border border-border bg-background px-4 py-3">
        <div className="mb-2.5 flex items-center gap-1.5">
          <Sparkles className="h-3 w-3 text-[hsl(var(--pv-text-faint))]" />
          <span className="pv-mono text-[10px] uppercase tracking-[0.15em] text-[hsl(var(--pv-text-faint))]">
            Writing all pages from objectives
          </span>
        </div>

        <div className="space-y-1">
          {PAGES.map((p, i) =>
            p.type === "section" ? (
              <div
                key={i}
                className="pv-serif pt-2 text-[13.5px] font-semibold text-foreground first:pt-0"
              >
                {p.title}
              </div>
            ) : (
              <div key={i} className="flex items-start gap-2.5 py-0.5 pl-2">
                <span className="mt-[3px] flex-none">
                  <StatusIcon status={p.status} />
                </span>
                <div className="min-w-0">
                  <div
                    className={`pv-serif text-[13.5px] leading-tight ${
                      p.status === "todo"
                        ? "text-[hsl(var(--pv-text-muted))]"
                        : "text-foreground"
                    }`}
                  >
                    {p.title}
                    {p.status === "writing" && (
                      <span className="pv-serif ml-2 text-[11.5px] italic text-[hsl(var(--pv-text-muted))]">
                        writing…
                      </span>
                    )}
                  </div>
                  <div className="pv-serif text-[12px] italic leading-snug text-[hsl(var(--pv-text-faint))]">
                    ◎ {p.objective}
                  </div>
                </div>
              </div>
            ),
          )}
        </div>

        {/* Live book-wide progress */}
        <div className="mt-3 border-t border-border pt-2.5">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="pv-serif text-[12.5px] italic text-[hsl(var(--pv-text-muted))]">
              Writing the book
            </span>
            <span className="pv-mono text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">
              12 / 24 pages
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[hsl(var(--pv-surface-2))]">
            <div
              className="h-full rounded-full bg-[hsl(var(--pv-accent))]"
              style={{ width: "50%" }}
            />
          </div>
        </div>
      </div>
    </UIFrame>
  );
}
