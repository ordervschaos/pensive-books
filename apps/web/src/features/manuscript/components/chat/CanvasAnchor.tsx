import { BookOpen, FileText, Plus } from "lucide-react";
import type { CanvasSnapshot } from "../../lib/manuscriptContext";

/** The same page name in the composer and the message receipt makes the target visible. */
export function CanvasAnchor({ snapshot, onOpen, current = false }: {
  snapshot: CanvasSnapshot; onOpen?: () => void; current?: boolean;
}) {
  const Icon = snapshot.target.kind === "book" ? BookOpen : snapshot.target.kind === "add" ? Plus : FileText;
  const content = <><Icon className="h-3 w-3 shrink-0" /><span className="truncate">{snapshot.label}</span></>;
  const className = "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-[hsl(var(--pv-border-soft))] px-2 py-1 pv-serif text-[11.5px] text-[hsl(var(--pv-text-muted))]";
  // "Showing": the receipt whose target is on the canvas right now reads like the canvas's own label.
  return onOpen ? (
    <button type="button" onClick={onOpen} aria-current={current ? "true" : undefined} title={current ? "Showing beside the chat" : `Show ${snapshot.label}`}
      className={`${className} transition-colors hover:border-[hsl(var(--pv-accent))]/50 hover:text-foreground ${current ? "border-[hsl(var(--pv-accent))]/45 bg-[hsl(var(--pv-accent))]/[0.06] text-foreground" : ""}`}>
      {content}{current && <span className="pv-mono text-[8.5px] uppercase tracking-[0.12em] text-[hsl(var(--pv-accent))]">showing</span>}
    </button>
  ) : <span className={className}>{content}</span>;
}
