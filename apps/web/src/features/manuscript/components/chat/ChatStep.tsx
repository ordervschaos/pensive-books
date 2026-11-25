// ChatStep — one feed step as a chat element. Author messages → right bubble; the agent's replies →
// markdown prose; reads/notes → muted activity lines; 'action' → a smart unit (a button for something
// only the author can do); applied/discarded → a collapsed record of a resolved change.
import { ArrowRight, BookOpen, Check, NotebookPen, Rocket, Sparkles, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ManuscriptStep } from "../../lib/manuscriptAgent";
import type { ManuscriptCanvas } from "../../lib/manuscriptContext";
import { pageFromHref, type LinkedPage } from "../../lib/manuscriptLinks";
import { CanvasAnchor } from "./CanvasAnchor";

export function ChatStep({ step, pages = [], canvas, onAction, onJumpToPage, onSelectCanvas, canOpenCanvas }: {
  step: ManuscriptStep;
  pages?: LinkedPage[];
  canvas?: ManuscriptCanvas;
  onAction?: (step: ManuscriptStep) => void;
  onJumpToPage?: (pageId: number) => void;
  onSelectCanvas?: (canvas: ManuscriptCanvas) => void;
  canOpenCanvas?: (canvas: ManuscriptCanvas) => boolean;
}) {
  if (step.t === "user" || step.t === "answer") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-[hsl(var(--pv-surface-2))] px-3.5 py-2 pv-serif text-[14px] leading-[1.55] text-foreground">
          {step.canvas && <div className="mb-1.5"><CanvasAnchor snapshot={step.canvas}
            current={JSON.stringify(step.canvas.target) === JSON.stringify(canvas)}
            onOpen={onSelectCanvas && canOpenCanvas?.(step.canvas.target) ? () => onSelectCanvas(step.canvas!.target) : undefined} /></div>}
          <div className="whitespace-pre-wrap">{step.label}</div>
        </div>
      </div>
    );
  }
  if (step.t === "read") {
    return <p className="inline-flex items-center gap-1.5 pv-serif text-[12.5px] italic text-[hsl(var(--pv-text-faint))]"><BookOpen className="h-3 w-3" /> {step.label}</p>;
  }
  if (step.t === "finding") {
    const items = step.findings ?? [];
    if (!items.length) return null;
    return (
      <div className="flex flex-col gap-1">
        <p className="inline-flex items-center gap-1.5 pv-mono text-[9.5px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]"><NotebookPen className="h-3 w-3" /> noted</p>
        <div className="flex flex-col gap-1 border-l border-[hsl(var(--pv-border))] pl-2.5">
          {items.map((f, i) => (
            <p key={i} className="pv-serif text-[12.5px] leading-[1.45] text-[hsl(var(--pv-text-faint))]">
              {f.ref && <span className="text-[hsl(var(--pv-text-muted))]">{f.ref} — </span>}{f.finding}
            </p>
          ))}
        </div>
      </div>
    );
  }
  if (step.t === "plan") {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-[hsl(var(--pv-accent))]/30 bg-[hsl(var(--pv-accent))]/[0.05] px-3 py-2.5">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--pv-accent))]" />
        <span className="pv-serif flex-1 text-[13px] leading-[1.45] text-[hsl(var(--pv-text-muted))]">Proposed: {step.label}</span>
      </div>
    );
  }
  if (step.t === "action") {
    const icon = step.action === "publish" ? <Rocket className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />;
    return (
      <button type="button" onClick={() => onAction?.(step)}
        className="group inline-flex items-center gap-2 rounded-full border border-[hsl(var(--pv-accent))]/50 bg-[hsl(var(--pv-accent))]/[0.07] px-4 py-2 pv-serif text-[13.5px] text-foreground transition-colors hover:bg-[hsl(var(--pv-accent))]/[0.14]">
        <span className="text-[hsl(var(--pv-accent))]">{icon}</span>{step.label}
      </button>
    );
  }
  if (step.t === "applied" || step.t === "discarded") {
    const applied = step.t === "applied";
    const c = step.change;
    const pageId = c && (c.kind === "page_edit" || c.kind === "page_delete") ? c.pageId : undefined;
    return (
      <button type="button" disabled={pageId == null} onClick={() => pageId != null && onJumpToPage?.(pageId)}
        className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left ${applied ? "border-green-600/30 bg-green-500/[0.06]" : "border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/30"} disabled:cursor-default`}>
        {applied ? <Check className="h-3.5 w-3.5 shrink-0 text-green-600" /> : <X className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--pv-text-faint))]" />}
        <span className="pv-serif flex-1 truncate text-[12.5px] text-[hsl(var(--pv-text-muted))]">{applied ? "Accepted" : "Rejected"}: {step.label}</span>
      </button>
    );
  }
  // note / ask / done — the agent speaking.
  return (
    <div className="max-w-[92%] pv-serif text-[14.5px] leading-[1.62] text-[hsl(var(--pv-text-muted))] prose prose-sm max-w-none prose-p:my-2 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0 prose-headings:text-foreground prose-strong:text-foreground prose-strong:font-semibold prose-code:text-foreground">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
        table: ({ children }) => <div className="overflow-x-auto"><table>{children}</table></div>,
        a: ({ href, children }) => {
          const page = pageFromHref(href, pages);
          if (href?.startsWith("?page=")) {
            if (!page || !onJumpToPage) return <span>{children}</span>;
            return <a href={href} title={`Open p${page.page_index + 1} · ${page.title?.trim() || "Untitled"}`}
              aria-current={canvas?.kind === "page" && canvas.pageId === page.id ? "page" : undefined}
              onClick={(e) => {
                if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                e.preventDefault(); onJumpToPage(page.id);
              }} className="text-[hsl(var(--pv-accent))] underline decoration-[hsl(var(--pv-accent))]/35 underline-offset-2 hover:decoration-current">{children}</a>;
          }
          return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
        },
      }}>
        {step.label}
      </ReactMarkdown>
    </div>
  );
}
