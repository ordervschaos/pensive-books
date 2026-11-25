import { BookOpen, FileText, Plus } from "lucide-react";
import type { CanvasSnapshot } from "../../lib/manuscriptContext";

/** The same page name in the composer and the message receipt makes the target visible. */
export function CanvasAnchor({ snapshot, onOpen, current = false }: {
  snapshot: CanvasSnapshot; onOpen?: () => void; current?: boolean;
}) {
  const Icon = snapshot.target.kind === "book" ? BookOpen : snapshot.target.kind === "add" ? Plus : FileText;
  const content = <><Icon className="h-3 w-3 shrink-0" /><span className="truncate">{snapshot.label}</span></>;
  const className = "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-[hsl(var(--pv-border-soft))] px-2 py-1 pv-serif text-[11.5px] text-[hsl(var(--pv-text-muted))]";
  return onOpen ? (
    <button type="button" onClick={onOpen} aria-current={current ? "true" : undefined} title={`Show ${snapshot.label}`}
      className={`${className} transition-colors hover:border-[hsl(var(--pv-accent))]/50 hover:text-foreground`}>{content}</button>
  ) : <span className={className}>{content}</span>;
}
