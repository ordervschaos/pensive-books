// ManuscriptAgentPage — /books/:slug/agent. The agent canvas: the agent's chat rail on the left, the
// book as the canvas on the right. The book and its pages are a live projection (useManuscript); the
// agent's thread is a live projection (useLatestTaskRow over kind='manuscript'); staged changes paint
// red/green on the canvas and resolve at word / block / page / everything grain.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Check, ListTree, PanelLeft, PanelLeftClose, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useBookPermissions } from "@/hooks/use-book-permissions";
import { useLatestTaskRow } from "@/hooks/useLatestTaskRow";
import { PublishingDialog } from "@/components/book/PublishingDialog";
import { AppearanceMenu } from "@/components/navigation/AppearanceMenu";
import { useManuscript } from "../hooks/useManuscript";
import { acceptChange, MANUSCRIPT_RUN_SELECT, rejectChange, type ManuscriptChange, type ManuscriptRunRow, type ManuscriptStep } from "../lib/manuscriptAgent";
import { ManuscriptChat } from "../components/chat/ManuscriptChat";
import { SidePanel, type PanelMode } from "../components/canvas/SidePanel";
import { AddPreview, PageCanvas } from "../components/canvas/PageCanvas";
import { BookHeader } from "../components/canvas/BookHeader";
import { BottomNav } from "../components/canvas/BottomNav";
import type { Selection } from "../components/canvas/selection";

const getNumericId = (p: string | undefined) => { const m = p?.match(/^(\d+)/); return m ? parseInt(m[1]) : 0; };
const RAIL_W_DEFAULT = 420, RAIL_W_MIN = 320, RAIL_W_MAX = 720;

export default function ManuscriptAgentPage() {
  const { bookSlug } = useParams();
  const bookId = getNumericId(bookSlug);
  const navigate = useNavigate();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();

  const { canEdit, hasAccess, loading: permLoading } = useBookPermissions(bookSlug);
  useEffect(() => { if (!permLoading && (!hasAccess || !canEdit)) navigate(`/books/${bookSlug}`, { replace: true }); }, [permLoading, hasAccess, canEdit, bookSlug, navigate]);

  const { book, pages, loading, refetch } = useManuscript(bookId);
  const { row: run, refetch: refetchRun, stale } = useLatestTaskRow<ManuscriptRunRow>({
    table: "book_agent_runs", bookId, select: MANUSCRIPT_RUN_SELECT, match: { kind: "manuscript" }, activeStatuses: ["running"], staleMs: 6 * 60 * 1000, enabled: !!bookId,
  });
  const staged = useMemo(() => (Array.isArray(run?.proposals) ? run!.proposals! : []) as ManuscriptChange[], [run]);
  const runId = run?.id ?? null;

  // ── Selection: the URL carries it (?page=<id> | ?page=book | ?add=<changeId>) so a chat unit can deep-link. ──
  const selection = useMemo<Selection>(() => {
    const add = params.get("add");
    if (add) return { kind: "add", changeId: add };
    const p = params.get("page");
    if (!p || p === "book") return { kind: "book" };
    return { kind: "page", pageId: Number(p) };
  }, [params]);
  const select = useCallback((s: Selection) => {
    const next = new URLSearchParams();
    if (s.kind === "page") next.set("page", String(s.pageId));
    else if (s.kind === "add") next.set("add", s.changeId);
    setParams(next, { replace: true });
  }, [setParams]);

  // The reading order the bottom bar walks: the book, then pages with staged new pages at their slots.
  const sequence = useMemo<Selection[]>(() => {
    const adds = staged.filter((c): c is Extract<ManuscriptChange, { kind: "page_add" }> => c.kind === "page_add");
    const seq: Selection[] = [{ kind: "book" }, ...adds.filter((a) => a.afterPageId == null).map((a) => ({ kind: "add" as const, changeId: a.id }))];
    for (const p of pages) {
      seq.push({ kind: "page", pageId: p.id });
      for (const a of adds.filter((x) => x.afterPageId === p.id)) seq.push({ kind: "add", changeId: a.id });
    }
    return seq;
  }, [pages, staged]);
  const seqIndex = Math.max(0, sequence.findIndex((s) => JSON.stringify(s) === JSON.stringify(selection)));
  // A selection that vanished (page deleted, phantom resolved) falls back to the book.
  useEffect(() => {
    if (loading) return;
    if (selection.kind === "page" && !pages.some((p) => p.id === selection.pageId)) select({ kind: "book" });
    if (selection.kind === "add" && !staged.some((c) => c.id === selection.changeId)) select({ kind: "book" });
  }, [loading, selection, pages, staged, select]);

  // ── Chrome state ──
  const [panel, setPanel] = useState<PanelMode | null>(() => (localStorage.getItem(`ms-panel:${bookId}`) as PanelMode | null) || null);
  useEffect(() => { localStorage.setItem(`ms-panel:${bookId}`, panel ?? ""); }, [bookId, panel]);
  const togglePanel = (m: PanelMode) => setPanel((cur) => (cur === m ? null : m));
  const [railWidth, setRailWidth] = useState<number>(() => { const s = Number(localStorage.getItem(`ms-rail:${bookId}`)); return Number.isFinite(s) && s >= RAIL_W_MIN && s <= RAIL_W_MAX ? s : RAIL_W_DEFAULT; });
  const dragRef = useRef<{ x: number; w: number } | null>(null);
  const onDragStart = (e: React.MouseEvent) => {
    dragRef.current = { x: e.clientX, w: railWidth };
    const move = (ev: MouseEvent) => { if (dragRef.current) setRailWidth(Math.min(RAIL_W_MAX, Math.max(RAIL_W_MIN, dragRef.current.w + ev.clientX - dragRef.current.x))); };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); dragRef.current = null; setRailWidth((w) => { localStorage.setItem(`ms-rail:${bookId}`, String(w)); return w; }); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);

  // ── Resolution (chat + top bar). The canvas resolves its own page in place. ──
  const jumpToChange = (c: ManuscriptChange) => {
    if (c.kind === "book_edit") select({ kind: "book" });
    else if (c.kind === "page_add") select({ kind: "add", changeId: c.id });
    else select({ kind: "page", pageId: c.pageId });
  };
  const doAccept = async (c: ManuscriptChange) => {
    if (busyId || !runId) return;
    setBusyId(c.id);
    try { await acceptChange(bookId, runId, c, pages); }
    catch (e) { toast({ title: "Couldn't apply", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
    finally { setBusyId(null); }
  };
  const doReject = async (c: ManuscriptChange) => {
    if (busyId || !runId) return;
    setBusyId(c.id);
    try { await rejectChange(runId, c, pages); }
    catch (e) { toast({ title: "Couldn't reject", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
    finally { setBusyId(null); }
  };
  // Everything, in a structure-safe order (edits before deletes before adds), refetching pages between
  // structural writes so each reorder sees the live index map.
  const resolveAll = async (verb: "accept" | "reject") => {
    if (busyId || !runId || !staged.length) return;
    const order = { book_edit: 0, page_edit: 1, page_delete: 2, page_add: 3 } as const;
    const list = [...staged].sort((a, b) => order[a.kind] - order[b.kind]);
    setBusyId("all");
    try {
      let live = pages;
      for (const c of list) {
        if (verb === "accept") { await acceptChange(bookId, runId, c, live); if (c.kind !== "book_edit") live = (await refetch()).pages; }
        else await rejectChange(runId, c, live);
      }
      toast({ title: verb === "accept" ? "All changes applied" : "All changes rejected" });
    } catch (e) { toast({ title: "Stopped part-way", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
    finally { setBusyId(null); }
  };
  const onAction = (step: ManuscriptStep) => {
    if (step.action === "publish") setPublishOpen(true);
    else if (step.action === "open_page" && step.pageId != null) select({ kind: "page", pageId: step.pageId });
    else if (step.action === "open_studio") navigate(`/books/${bookSlug}/studio`);
  };

  if (permLoading || !hasAccess || !canEdit || loading || !book) return null;

  const current = selection.kind === "page" ? pages.find((p) => p.id === selection.pageId) : undefined;
  const sectionLabel = current ? [...pages].filter((p) => p.page_index <= current.page_index && p.page_type === "section").pop()?.title ?? null : null;
  const stopLabel = selection.kind === "book" ? "the book" : selection.kind === "add" ? "new page" : (current?.title ?? "").trim() || "Untitled";
  const bookEdits = staged.filter((c): c is Extract<ManuscriptChange, { kind: "book_edit" }> => c.kind === "book_edit");
  const barBtn = "inline-flex items-center gap-1.5 rounded-full px-3 py-1 pv-serif text-[12.5px] transition-colors disabled:opacity-40";

  return (
    <div className="fixed inset-0 flex bg-background text-foreground">
      {/* Agent rail */}
      <aside className="relative flex h-full shrink-0 flex-col border-r border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/20" style={{ width: railWidth }}>
        <ManuscriptChat bookId={bookId} run={run} refetchRun={refetchRun} stale={stale} pages={pages} staged={staged} busyId={busyId}
          onAccept={(c) => void doAccept(c)} onReject={(c) => void doReject(c)} onJumpToChange={jumpToChange} onJumpToPage={(id) => select({ kind: "page", pageId: id })} onAction={onAction} />
        <div onMouseDown={onDragStart} className="absolute -right-1 top-0 z-20 h-full w-2 cursor-col-resize" title="Drag to resize" />
      </aside>

      {/* Canvas */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="box-border flex h-11 shrink-0 items-center gap-2 border-b border-[hsl(var(--pv-border-soft))] px-3">
          <button type="button" onClick={() => togglePanel("pages")} title="Pages" className={`rounded-full p-1.5 ${panel === "pages" ? "bg-[hsl(var(--pv-surface-2))] text-foreground" : "text-[hsl(var(--pv-text-muted))] hover:text-foreground"}`}>
            {panel === "pages" ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
          </button>
          <button type="button" onClick={() => navigate(`/books/${bookSlug}`)} className="inline-flex items-center gap-1 pv-serif text-[12.5px] text-[hsl(var(--pv-text-muted))] hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Book</button>
          <span className="min-w-0 flex-1 truncate pv-serif text-[14px] text-foreground">{book.name}</span>
          {staged.length > 0 && (
            <>
              <span className="pv-mono text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--pv-accent))]">{staged.length} staged</span>
              <button type="button" disabled={!!busyId} onClick={() => void resolveAll("accept")} className={`${barBtn} bg-green-600 text-white hover:bg-green-700`}><Check className="h-3.5 w-3.5" /> Accept all</button>
              <button type="button" disabled={!!busyId} onClick={() => void resolveAll("reject")} className={`${barBtn} border border-red-500/50 text-red-600 hover:bg-red-500/10`}><X className="h-3.5 w-3.5" /> Reject all</button>
            </>
          )}
          <button type="button" onClick={() => togglePanel("changes")} title="Changed pages" className={`rounded-full p-1.5 ${panel === "changes" ? "bg-[hsl(var(--pv-surface-2))] text-foreground" : "text-[hsl(var(--pv-text-muted))] hover:text-foreground"}`}>
            <ListTree className="h-4 w-4" />
          </button>
          <AppearanceMenu />
        </div>

        <div className="flex min-h-0 flex-1">
          {panel && <SidePanel mode={panel} pages={pages} staged={staged} selection={selection} onSelect={select} onClose={() => setPanel(null)} />}
          <main className="sidebar-scroll min-w-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[720px] px-8 py-10">
              {selection.kind === "book" && <BookHeader book={book} pages={pages} bookEdits={bookEdits} runId={runId} busyId={busyId} setBusyId={setBusyId} canEdit={canEdit} />}
              {selection.kind === "add" && (() => { const c = staged.find((x) => x.id === selection.changeId); return c && c.kind === "page_add" ? <AddPreview change={c} bookId={bookId} runId={runId} pages={pages} busyId={busyId} setBusyId={setBusyId} /> : null; })()}
              {selection.kind === "page" && current && (
                <PageCanvas page={current} bookId={bookId} runId={runId} pages={pages} busyId={busyId} setBusyId={setBusyId} onSaving={setSaving} canEdit={canEdit}
                  edit={staged.find((c): c is Extract<ManuscriptChange, { kind: "page_edit" }> => c.kind === "page_edit" && c.pageId === current.id)}
                  del={staged.find((c): c is Extract<ManuscriptChange, { kind: "page_delete" }> => c.kind === "page_delete" && c.pageId === current.id)} />
              )}
            </div>
          </main>
        </div>

        <BottomNav index={seqIndex} total={sequence.length} label={stopLabel} sectionLabel={sectionLabel} saving={saving}
          onPrev={() => select(sequence[Math.max(0, seqIndex - 1)])} onNext={() => select(sequence[Math.min(sequence.length - 1, seqIndex + 1)])} />
      </div>

      <PublishingDialog bookId={bookId} bookName={book.name} isPublic={book.is_public} open={publishOpen} onOpenChange={setPublishOpen} onSuccess={() => void refetch()} />
    </div>
  );
}
