import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { computeCompletion, type Brief } from "@/lib/brief";
import { buildMap, type CellState, type MapModel, type RawPage } from "@/lib/planGraph";
import type { PageMeta } from "@/lib/planProvenance";

interface ResolutionMapProps {
  bookId: number;
  /** Bump to refetch (e.g. after an edit elsewhere on the page). */
  refreshKey?: number;
}

/**
 * The Resolution Map (read-only, Step 1). A completeness chart of the book's resolution ladder —
 * brief → spine → page objective → beat → prose — showing, per layer, where content is missing (gap)
 * or out of sync with the layer above (drift). The book is "done" only when the whole grid is green.
 *
 * Read-only for now: it visualizes the model the transforms will later fill in. It self-fetches the
 * layers so it stays decoupled from the host's page list (mirrors StalePanel).
 */
export function ResolutionMap({ bookId, refreshKey }: ResolutionMapProps) {
  const [model, setModel] = useState<MapModel | null>(null);

  const load = useCallback(async () => {
    const [{ data: book }, { data: pages }] = await Promise.all([
      supabase.from("books").select("brief, spine").eq("id", bookId).maybeSingle(),
      supabase.from("pages").select("id, title, page_type, content, metadata")
        .eq("book_id", bookId).eq("archived", false).order("page_index", { ascending: true }),
    ]);
    const briefFilled = computeCompletion((book?.brief as Brief | null) ?? null) > 0;
    const spineText = (book?.spine as { text?: string } | null)?.text ?? null;
    const raw: RawPage[] = ((pages as Array<{ id: number; title: string | null; page_type: "text" | "section"; content: unknown; metadata: PageMeta | null }>) ?? [])
      .map((p) => ({ id: p.id, title: p.title, pageType: p.page_type === "section" ? "section" : "text", metadata: p.metadata, proseText: bodyText(p.content) }));
    setModel(buildMap({ briefFilled, spineText, pages: raw }));
  }, [bookId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  if (!model) return null;

  const { totals } = model;
  const summary = model.complete
    ? "Every layer is filled and in sync."
    : [totals.gaps ? `${totals.gaps} gap${totals.gaps === 1 ? "" : "s"}` : "", totals.drift ? `${totals.drift} out of sync` : ""]
        .filter(Boolean).join(" · ");
  const pct = totals.cells ? Math.round((totals.filled - totals.drift) / totals.cells * 100) : 0;

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-[hsl(var(--pv-surface-2))]/40">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--pv-border-soft))] px-5 py-4">
        <span className="pv-eyebrow">Resolution map · completeness</span>
        <span className="pv-serif text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">
          {pct}% in sync — {summary}
        </span>
      </div>

      <div className="px-5 py-5">
        {/* Book-level band: brief → spine (one-way edge). */}
        <div className="mb-4 flex items-center gap-2">
          <BandNode label="Brief" state={model.brief} />
          <Connector oneWay />
          <BandNode label="Book spine" state={model.spine} />
        </div>

        {/* Per-page grid: objective → beat → prose. */}
        <div className="overflow-x-auto">
          <div className="min-w-[420px]">
            <div className="grid grid-cols-[1fr_repeat(3,72px)] items-center border-b border-[hsl(var(--pv-border-soft))] pb-1.5">
              <span className="pv-eyebrow text-[9px] text-[hsl(var(--pv-text-faint))]">Page</span>
              {(["Objective", "Beat", "Prose"] as const).map((h) => (
                <span key={h} className="pv-mono text-center text-[9px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">{h}</span>
              ))}
            </div>

            {model.pages.map((p) =>
              p.pageType === "section" ? (
                <p key={p.id} className="pv-serif px-1 pb-0.5 pt-3 text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--pv-text-faint))]">
                  {p.title || "(section)"}
                </p>
              ) : (
                <div key={p.id} className="grid grid-cols-[1fr_repeat(3,72px)] items-center py-1">
                  <span className="pv-serif truncate pr-2 text-[13.5px] text-foreground">{p.title || "(untitled)"}</span>
                  <Cell state={p.objective} layer="objective" />
                  <Cell state={p.beat} layer="beat" />
                  <Cell state={p.prose} layer="prose" />
                </div>
              )
            )}
          </div>
        </div>

        <Legend />
      </div>
    </section>
  );
}

const STATE_LABEL: Record<CellState, string> = { gap: "empty", drift: "out of sync", synced: "in sync" };

// A single grid cell — a dot whose colour encodes the node's state.
function Cell({ state, layer }: { state: CellState; layer: string }) {
  return (
    <div className="flex justify-center" title={`${layer}: ${STATE_LABEL[state]}`}>
      <Dot state={state} />
    </div>
  );
}

function Dot({ state }: { state: CellState }) {
  if (state === "gap") {
    return <span className="inline-block h-3 w-3 rounded-full border border-dashed border-[hsl(var(--pv-text-faint))]" aria-label="empty" />;
  }
  if (state === "drift") {
    return <span className="inline-block h-3 w-3 rounded-full bg-amber-500" aria-label="out of sync" />;
  }
  return <span className="inline-block h-3 w-3 rounded-full bg-[hsl(var(--pv-accent))]" aria-label="in sync" />;
}

// A labelled node in the book-level band (brief / spine).
function BandNode({ label, state }: { label: string; state: CellState }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))] px-2.5 py-1" title={`${label}: ${STATE_LABEL[state]}`}>
      <Dot state={state} />
      <span className="pv-serif text-[13px] text-foreground">{label}</span>
    </span>
  );
}

// The connector between two book-level nodes. brief→spine is one-way (AI drafts down, never up).
function Connector({ oneWay }: { oneWay?: boolean }) {
  return (
    <span className="pv-mono text-[12px] text-[hsl(var(--pv-text-faint))]" title={oneWay ? "drafted downward only" : "two-way"}>
      {oneWay ? "→" : "↔"}
    </span>
  );
}

function Legend() {
  return (
    <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-[hsl(var(--pv-border-soft))] pt-3">
      {(["synced", "drift", "gap"] as const).map((s) => (
        <span key={s} className="pv-serif inline-flex items-center gap-1.5 text-[12px] text-[hsl(var(--pv-text-muted))]">
          <Dot state={s} /> {STATE_LABEL[s]}
        </span>
      ))}
    </div>
  );
}

// Body text excluding the leading title heading — decides if a page has real prose.
function bodyText(content: unknown): string {
  if (!content || typeof content !== "object") return typeof content === "string" ? content : "";
  const doc = content as { content?: Array<Record<string, unknown>> };
  if (!Array.isArray(doc.content)) return "";
  const nodes = doc.content[0]?.type === "heading" ? doc.content.slice(1) : doc.content;
  const walk = (n: Record<string, unknown>): string =>
    n.type === "text" ? String(n.text ?? "") : ((n.content as Array<Record<string, unknown>>) ?? []).map(walk).join("");
  return nodes.map(walk).join("").trim();
}
