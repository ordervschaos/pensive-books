// SidePanel — the canvas's collapsible left panel, in one of two modes:
//   pages   — the book's pages and sections (sections group the text pages under them), each tagged
//             with its staged state (green = new page, red = to be deleted, amber dot = edits pending)
//   changes — every staged change, grouped by where it lands; click → that page, first change in view
import { BookOpen, FileText, Minus, Plus, X } from "lucide-react";
import { Eyebrow } from "@/components/book/shared/studioUi";
import { changeLabel, type ManuscriptChange, type ManuscriptPage } from "../../lib/manuscriptAgent";
import type { Selection } from "./selection";

export type PanelMode = "pages" | "changes";

export function SidePanel({ mode, pages, staged, selection, onSelect, onClose }: {
  mode: PanelMode; pages: ManuscriptPage[]; staged: ManuscriptChange[]; selection: Selection; onSelect: (s: Selection) => void; onClose: () => void;
}) {
  const editsByPage = new Map(staged.filter((c): c is Extract<ManuscriptChange, { kind: "page_edit" }> => c.kind === "page_edit").map((c) => [c.pageId, c]));
  const deleted = new Set(staged.filter((c) => c.kind === "page_delete").map((c) => (c as { pageId: number }).pageId));
  const adds = staged.filter((c): c is Extract<ManuscriptChange, { kind: "page_add" }> => c.kind === "page_add");
  const isSel = (s: Selection) => JSON.stringify(s) === JSON.stringify(selection);
  const rowCls = (sel: boolean, tone?: "red" | "green") =>
    `flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${sel ? "bg-[hsl(var(--pv-surface-2))]" : "hover:bg-[hsl(var(--pv-surface-2))]/60"} ${tone === "red" ? "text-red-600" : tone === "green" ? "text-green-700" : "text-foreground"}`;

  const AddRows = ({ afterId }: { afterId: number | null }) => (
    <>
      {adds.filter((a) => a.afterPageId === afterId).map((a) => (
        <button key={a.id} type="button" onClick={() => onSelect({ kind: "add", changeId: a.id })} className={rowCls(isSel({ kind: "add", changeId: a.id }), "green")}>
          <Plus className="h-3.5 w-3.5 shrink-0" />
          <span className={`pv-serif min-w-0 flex-1 truncate text-[13px] ${a.pageType === "section" ? "font-semibold" : ""}`}>{a.title}</span>
          <span className="pv-mono text-[9px] uppercase tracking-[0.1em]">new</span>
        </button>
      ))}
    </>
  );

  return (
    <aside className="sidebar-scroll flex h-full w-[260px] shrink-0 flex-col overflow-y-auto border-r border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/30 px-2.5 py-3">
      <div className="mb-2 flex items-center justify-between px-1.5">
        <Eyebrow>{mode === "pages" ? "Pages" : `${staged.length} change${staged.length === 1 ? "" : "s"}`}</Eyebrow>
        <button type="button" onClick={onClose} className="text-[hsl(var(--pv-text-faint))] hover:text-foreground" aria-label="Close panel"><X className="h-3.5 w-3.5" /></button>
      </div>

      {mode === "pages" && (
        <div className="flex flex-col gap-0.5">
          <button type="button" onClick={() => onSelect({ kind: "book" })} className={rowCls(isSel({ kind: "book" }))}>
            <BookOpen className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--pv-accent))]" />
            <span className="pv-serif flex-1 truncate text-[13px] font-semibold">The book</span>
            {staged.some((c) => c.kind === "book_edit") && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
          </button>
          <AddRows afterId={null} />
          {pages.map((p) => {
            const sel = isSel({ kind: "page", pageId: p.id });
            const isDel = deleted.has(p.id);
            const hasEdit = editsByPage.has(p.id);
            const section = p.page_type === "section";
            return (
              <div key={p.id}>
                <button type="button" onClick={() => onSelect({ kind: "page", pageId: p.id })} className={`${rowCls(sel, isDel ? "red" : undefined)} ${section ? "mt-2" : "pl-6"}`}>
                  {isDel ? <Minus className="h-3.5 w-3.5 shrink-0" /> : section ? <BookOpen className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--pv-text-faint))]" /> : <FileText className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--pv-text-faint))]" />}
                  <span className={`pv-serif min-w-0 flex-1 truncate text-[13px] ${section ? "font-semibold" : ""} ${isDel ? "line-through" : ""}`}>{(p.title ?? "").trim() || "Untitled"}</span>
                  {hasEdit && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" title="edits pending" />}
                  <span className="pv-mono text-[9px] text-[hsl(var(--pv-text-faint))]">{p.page_index + 1}</span>
                </button>
                <AddRows afterId={p.id} />
              </div>
            );
          })}
        </div>
      )}

      {mode === "changes" && (
        <div className="flex flex-col gap-0.5">
          {staged.length === 0 && <p className="px-1.5 pv-serif text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">Nothing staged. Ask the agent for a change and it will appear here.</p>}
          {staged.map((c) => {
            const target: Selection = c.kind === "book_edit" ? { kind: "book" } : c.kind === "page_add" ? { kind: "add", changeId: c.id } : { kind: "page", pageId: c.pageId };
            const tone = c.kind === "page_delete" ? "red" : c.kind === "page_add" ? "green" : undefined;
            return (
              <button key={c.id} type="button" onClick={() => onSelect(target)} className={rowCls(isSel(target), tone)}>
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone === "red" ? "bg-red-500" : tone === "green" ? "bg-green-600" : "bg-amber-500"}`} />
                <span className="min-w-0 flex-1">
                  <span className="pv-serif block truncate text-[13px]">{changeLabel(c, pages)}</span>
                  {c.note && <span className="pv-serif block truncate text-[11px] italic text-[hsl(var(--pv-text-faint))]">{c.note}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </aside>
  );
}
