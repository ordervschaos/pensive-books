import { Lock, Check, Wand2 } from "lucide-react";
import { ScaffoldGenerator } from "./ScaffoldGenerator";
import { WriteAllPages } from "./WriteAllPages";
import { AIActionRow } from "./AIActionRow";
import type { EditorJSON } from "@/types/editor";

interface BuildPage {
  page_type?: "text" | "section";
  content?: EditorJSON | null;
  metadata?: { objective?: string } | null;
}

interface BuildWithAIProps {
  bookId: number;
  /** Whether the brief is set — AI planning is gated on it (objectives are drawn from the brief). */
  briefSet: boolean;
  /** All book pages; the distribution bar is computed from the text pages. */
  pages: BuildPage[];
  onEditBrief: () => void;
  /** Called after scaffold creates pages, so the host can refresh. */
  onChanged: () => void;
  /**
   * Route a structural change into "Revise with AI". Once a book has prose, scaffolding
   * (append-only) no longer fits — restructuring is a diff against existing pages, which is
   * exactly what the revise architect plans (add / cut / merge / retarget, reviewed first).
   */
  onReviseStructure: () => void;
}

// Body text excluding the leading title heading — mirrors WriteAllPages, so "written"
// here means the same thing it does to the write-all cascade (a page has real prose,
// not just its title).
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

// blank → objective set → written, the three real stages a page moves through.
// A page cannot jump from blank to written: it acquires an objective first, then prose.
const SEGMENTS = [
  { key: "blank", label: "blank", sub: "no objective", color: "transparent" },
  { key: "objective", label: "objective set", sub: "ready to write", color: "#5b6db8" },
  { key: "written", label: "written", sub: "has prose", color: "hsl(var(--pv-accent))" },
] as const;

export function BuildWithAI({ bookId, briefSet, pages, onEditBrief, onChanged, onReviseStructure }: BuildWithAIProps) {
  const counts = { blank: 0, objective: 0, written: 0 };
  for (const p of pages) {
    if (p.page_type === "section") continue;
    if (bodyText(p.content)) counts.written += 1;
    else if (p.metadata?.objective) counts.objective += 1;
    else counts.blank += 1;
  }

  // The book's regime decides which moves are offered:
  //  - hasWritten → renovation: structural change goes through the revise architect (a diff
  //    against existing pages); the append-only scaffold is retired.
  //  - !hasWritten → construction: scaffold the objective tree from the brief.
  // Write-all bridges them: it renders prose for any page that already has an objective.
  const hasWritten = counts.written > 0;
  const hasObjectives = counts.objective > 0;

  return (
    <section className="mt-8 overflow-hidden rounded-2xl border border-border bg-[hsl(var(--pv-surface-2))]/40">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--pv-border-soft))] px-5 py-4">
        <span className="pv-eyebrow">Build with AI</span>
        {briefSet ? (
          <button
            type="button"
            onClick={onEditBrief}
            className="pv-mono inline-flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.1em] text-[hsl(var(--pv-accent))] hover:opacity-80"
          >
            <Check className="h-3 w-3" /> from your brief · edit
          </button>
        ) : (
          <button
            type="button"
            onClick={onEditBrief}
            className="pv-mono inline-flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.1em] text-[hsl(var(--pv-text-faint))] hover:text-[hsl(var(--pv-text-muted))]"
          >
            <Lock className="h-3 w-3" /> set your brief to unlock
          </button>
        )}
      </div>

      <div className="px-5 py-5">
        {/* Where the book stands — a left-to-right progression bar (blank → written). */}
        <div className="flex h-3 gap-1">
          {SEGMENTS.filter((s) => counts[s.key] > 0).map((s) => (
            <div
              key={s.key}
              className="min-w-[14px] rounded-full"
              style={{
                flex: counts[s.key],
                background: s.key === "blank" ? undefined : s.color,
                boxShadow: s.key === "blank" ? "inset 0 0 0 1.5px hsl(var(--pv-text-faint))" : undefined,
              }}
              title={`${counts[s.key]} ${s.label}`}
            />
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
          {SEGMENTS.map((s) => (
            <span key={s.key} className="pv-serif inline-flex items-center gap-2 text-[14px] text-[hsl(var(--pv-text-muted))]">
              <span
                className="inline-block h-[9px] w-[9px] rounded-full"
                style={{
                  background: s.key === "blank" ? "transparent" : s.color,
                  border: s.key === "blank" ? "1.5px dashed hsl(var(--pv-text-faint))" : undefined,
                }}
              />
              <b className="pv-serif font-semibold text-foreground tabular-nums">{counts[s.key]}</b>
              {s.label}
              <em className="not-italic text-[hsl(var(--pv-text-faint))]">· {s.sub}</em>
            </span>
          ))}
        </div>

        {/* The two moves — each spelled out as the transition it performs.
            You review every plan before it sticks (both flows confirm first). */}
        <p className="pv-eyebrow mt-6">
          Move pages forward ·{" "}
          <span className="pv-serif text-[13px] normal-case not-italic tracking-normal text-[hsl(var(--pv-text-faint))]">
            you review every plan before it sticks
          </span>
        </p>
        <div className="mt-3 space-y-3">
          {briefSet ? (
            <>
              {/* Renovation first: once there's prose, structural change is a reviewed diff. */}
              {hasWritten && (
                <AIActionRow
                  icon={<Wand2 className="h-4 w-4" />}
                  title="Revise the structure"
                  description="Add, cut, merge or reorder chapters — the AI proposes a plan you review first."
                  onClick={onReviseStructure}
                />
              )}
              {/* Bridge: render prose for any page that already has an objective. */}
              {hasObjectives && <WriteAllPages bookId={bookId} plannedCount={counts.objective} />}
              {/* Construction: scaffold from the brief — only while nothing is written yet. */}
              {!hasWritten && <ScaffoldGenerator bookId={bookId} onCreated={onChanged} />}
            </>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-transparent p-5">
              <div className="space-y-1">
                <div className="pv-serif flex items-center gap-2 text-[15px] text-[hsl(var(--pv-text-muted))]">
                  <Lock className="h-4 w-4" /> Plan from your brief
                </div>
                <p className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))]">
                  Set your brief first — objectives are drawn from it.
                </p>
              </div>
              <button
                type="button"
                onClick={onEditBrief}
                className="pv-serif text-[14px] italic text-[hsl(var(--pv-text-muted))] hover:text-foreground"
              >
                Set the brief →
              </button>
            </div>
          )}
        </div>
        {briefSet && hasObjectives && (
          <p className="pv-serif mt-4 text-[13px] italic text-[hsl(var(--pv-text-faint))]">
            Blank pages are skipped by “Write” until they have an objective.
          </p>
        )}
      </div>
    </section>
  );
}
