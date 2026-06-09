import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { briefToPromptContext, computeCompletion, type Brief } from "@/lib/brief";
import { buildMap, type CellState, type MapModel, type MapPage, type RawPage } from "@/lib/planGraph";
import { metaHash, type PageMeta } from "@/lib/planProvenance";
import { NodeEditor, type NodeTarget, type SheetLayer } from "./NodeEditor";

interface ResolutionMapProps {
  bookId: number;
  /** Bump to refetch (e.g. after an edit elsewhere on the page). */
  refreshKey?: number;
  /** Called after a node is edited in the map, so the host can refresh its own views. */
  onChanged?: () => void;
}

/**
 * The Resolution Map — the book's resolution ladder drawn as a connected node-graph:
 *
 *   brief → spine → (per page) objective → beat → prose
 *
 * Every node shows a text preview + a state colour (gap / drift / synced). Clicking any node opens
 * the node sheet (NodeEditor) — act (re-create / revise) and review (diff) right there, with this
 * graph still visible behind it. Prose edits write the page body without opening the page; you only
 * jump into the full editor if you want to ("Open page ↗" inside the sheet).
 *
 * This is the AI-tools surface: the whole book, actionable and reviewable from one screen.
 */
export function ResolutionMap({ bookId, refreshKey, onChanged }: ResolutionMapProps) {
  const navigate = useNavigate();
  const [model, setModel] = useState<MapModel | null>(null);
  const [editing, setEditing] = useState<NodeTarget | null>(null);
  // Local bump so a node edit reloads the map without needing the host to re-render.
  const [localKey, setLocalKey] = useState(0);

  const load = useCallback(async () => {
    const [{ data: book }, { data: pages }] = await Promise.all([
      supabase.from("books").select("brief, spine").eq("id", bookId).maybeSingle(),
      supabase.from("pages").select("id, title, page_type, content, metadata")
        .eq("book_id", bookId).eq("archived", false).order("page_index", { ascending: true }),
    ]);
    const brief = (book?.brief as Brief | null) ?? null;
    const briefFilled = computeCompletion(brief) > 0;
    const spine = (book?.spine as { text?: string; brief_hash?: string } | null) ?? null;
    const spineText = spine?.text ?? null;
    const spineStale = !!spine?.brief_hash && spine.brief_hash !== metaHash(briefToPromptContext(brief) ?? "");
    const raw: RawPage[] = ((pages as Array<{ id: number; title: string | null; page_type: "text" | "section"; content: unknown; metadata: PageMeta | null }>) ?? [])
      .map((p) => ({ id: p.id, title: p.title, pageType: p.page_type === "section" ? "section" : "text", metadata: p.metadata, proseText: bodyText(p.content) }));
    setModel(buildMap({ briefFilled, spineText, spineStale, pages: raw }));
  }, [bookId]);

  useEffect(() => { void load(); }, [load, refreshKey, localKey]);

  if (!model) return null;

  // Open the node sheet for an editable node (spine/objective/beat/prose). Brief lives in its own tab.
  const openNode = (layer: SheetLayer, state: CellState, page?: { id: number; title: string | null }) =>
    setEditing({ layer, state, pageId: page?.id, pageTitle: page?.title });
  const onSaved = () => { setLocalKey((k) => k + 1); onChanged?.(); };

  const { totals } = model;
  const summary = model.complete
    ? "Every layer is filled and in sync."
    : [totals.gaps ? `${totals.gaps} gap${totals.gaps === 1 ? "" : "s"}` : "", totals.drift ? `${totals.drift} out of sync` : ""]
        .filter(Boolean).join(" · ");
  const pct = totals.cells ? Math.round((totals.filled - totals.drift) / totals.cells * 100) : 0;

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-[hsl(var(--pv-surface-2))]/40">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--pv-border-soft))] px-5 py-4">
        <span className="pv-eyebrow">Resolution graph</span>
        <span className="pv-serif text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">
          {pct}% in sync — {summary}
        </span>
      </div>

      <div className="px-5 py-5">
        {/* Book band: brief → spine (one-way edge — AI drafts down, never up). */}
        <div className="flex items-stretch gap-2">
          <NodeBox layer="brief" label="Brief" text={model.brief === "gap" ? "" : "Set — the book's premise"} state={model.brief} placeholder="No brief yet — set it in the Brief tab" />
          <Arrow oneWay />
          <NodeBox layer="spine" label="Spine" text={model.spineText} state={model.spine} placeholder="Empty — re-create from the brief" onClick={() => openNode("spine", model.spine)} />
        </div>

        {/* Fan-out: the spine branches to every page. A left rail + per-row tick draws the branch. */}
        <div className="relative mt-1 pl-5">
          <span aria-hidden className="absolute left-[7px] top-0 bottom-3 w-px bg-[hsl(var(--pv-border-soft))]" />
          {model.pages.map((p) =>
            p.pageType === "section" ? (
              <div key={p.id} className="relative pt-5 pb-1">
                <p className="pv-serif text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--pv-text-faint))]">
                  {p.title || "(section)"}
                </p>
              </div>
            ) : (
              <PageRow key={p.id} page={p} onOpen={openNode} onOpenPage={(id) => navigate(`/books/${bookId}/pages/${id}`)} />
            )
          )}
        </div>

        <Legend />
      </div>

      <NodeEditor bookId={bookId} target={editing} onClose={() => setEditing(null)} onSaved={onSaved} onOpenPage={(pid) => navigate(`/books/${bookId}/pages/${pid}`)} />
    </section>
  );
}

// One page's chain: objective → beat → prose, with a branch tick off the spine rail.
function PageRow({
  page, onOpen, onOpenPage,
}: {
  page: MapPage;
  onOpen: (layer: SheetLayer, state: CellState, page: { id: number; title: string | null }) => void;
  onOpenPage: (id: number) => void;
}) {
  const ref = { id: page.id, title: page.title };
  return (
    <div className="relative py-2">
      {/* horizontal tick linking the rail to this row */}
      <span aria-hidden className="absolute left-[-13px] top-[26px] h-px w-3 bg-[hsl(var(--pv-border-soft))]" />
      <div className="mb-1.5 truncate pv-serif text-[13px] text-foreground">{page.title || "(untitled)"}</div>
      <div className="flex items-stretch gap-1.5 overflow-x-auto pb-1">
        <NodeBox layer="objective" label="Objective" text={page.objectiveText} state={page.objective} placeholder="Empty — re-create from the beat" onClick={() => onOpen("objective", page.objective, ref)} />
        <Arrow />
        <NodeBox layer="beat" label="Beat" text={page.beatText} state={page.beat} placeholder="Empty — re-create from the objective" onClick={() => onOpen("beat", page.beat, ref)} />
        <Arrow />
        <NodeBox
          layer="prose" label="Prose"
          text={page.proseText ? snippet(page.proseText) : ""}
          state={page.prose}
          placeholder="Empty — write from the plan"
          onClick={() => onOpen("prose", page.prose, ref)}
          onDoubleClick={() => onOpenPage(page.id)}
        />
      </div>
    </div>
  );
}

const STATE_LABEL: Record<CellState, string> = { gap: "empty", drift: "out of sync", synced: "in sync" };

// Per-state visual tone for a node box (border + dot + text weight).
const BOX_TONE: Record<CellState, string> = {
  gap: "border-dashed border-[hsl(var(--pv-text-faint))]/50 hover:border-[hsl(var(--pv-text-faint))]",
  drift: "border-amber-400/60 bg-amber-500/[0.04] hover:border-amber-500",
  synced: "border-[hsl(var(--pv-border-soft))] hover:border-foreground/30",
};

// A node in the graph: a small box with a state dot, layer label, and a text preview. Clickable when
// editable (spine/objective/beat/prose); brief is a static label (it lives in its own tab).
function NodeBox({
  layer, label, text, state, placeholder, onClick, onDoubleClick,
}: {
  layer: SheetLayer | "brief";
  label: string;
  text: string;
  state: CellState;
  placeholder: string;
  onClick?: () => void;
  onDoubleClick?: () => void;
}) {
  const interactive = !!onClick;
  const tone = layer === "brief" ? "border-[hsl(var(--pv-border-soft))]" : BOX_TONE[state];
  const className = `min-w-[150px] flex-1 rounded-lg border px-3 py-2 text-left transition-colors ${tone} ${interactive ? "cursor-pointer" : "cursor-default"}`;
  const body = (
    <>
      <div className="flex items-center gap-1.5">
        <Dot state={state} />
        <span className="pv-mono text-[9px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">{label}</span>
      </div>
      {text ? (
        <p className="mt-1 line-clamp-2 pv-serif text-[12.5px] leading-snug text-foreground">{text}</p>
      ) : (
        <p className="mt-1 line-clamp-2 pv-serif text-[12.5px] italic leading-snug text-[hsl(var(--pv-text-faint))]">{placeholder}</p>
      )}
    </>
  );
  if (!interactive) return <div className={className} title={`${label}: ${STATE_LABEL[state]}`}>{body}</div>;
  return (
    <button type="button" onClick={onClick} onDoubleClick={onDoubleClick} title={`${label}: ${STATE_LABEL[state]} — click to open`} className={className}>
      {body}
    </button>
  );
}

function Dot({ state }: { state: CellState }) {
  if (state === "gap") return <span className="inline-block h-2.5 w-2.5 rounded-full border border-dashed border-[hsl(var(--pv-text-faint))]" aria-label="empty" />;
  if (state === "drift") return <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" aria-label="out of sync" />;
  return <span className="inline-block h-2.5 w-2.5 rounded-full bg-[hsl(var(--pv-accent))]" aria-label="in sync" />;
}

// The connector between two nodes. brief→spine is one-way (drawn as →); the rest are two-way edges.
function Arrow({ oneWay }: { oneWay?: boolean }) {
  return (
    <span className="flex shrink-0 select-none items-center pv-mono text-[13px] text-[hsl(var(--pv-text-faint))]" title={oneWay ? "drafted downward only" : "two-way"}>
      {oneWay ? "→" : "›"}
    </span>
  );
}

function Legend() {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[hsl(var(--pv-border-soft))] pt-3">
      {(["synced", "drift", "gap"] as const).map((s) => (
        <span key={s} className="pv-serif inline-flex items-center gap-1.5 text-[12px] text-[hsl(var(--pv-text-muted))]">
          <Dot state={s} /> {STATE_LABEL[s]}
        </span>
      ))}
      <span className="pv-serif text-[12px] italic text-[hsl(var(--pv-text-faint))]">— click a node to act &amp; review</span>
    </div>
  );
}

// First ~140 chars of prose for the node preview.
function snippet(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 140 ? t.slice(0, 140) + "…" : t;
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
