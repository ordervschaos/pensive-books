import type { OpRow } from "@/features/dna/lib/dnaChat";

// The per-op change list — target node, each field's old → new, blast radius — shared by the pre-apply
// preview (ProposalCard) and the post-apply history (ResolvedCard) so a change reads identically whether
// you're about to accept it or looking back at it later.
export function DiffRows({ rows }: { rows: OpRow[] }) {
  return (
    <ul className="space-y-2.5">
      {rows.map((row, i) => (
        <li key={i} className="border-l-2 border-[hsl(var(--pv-border-soft))] pl-2.5">
          <div className="flex items-baseline gap-2">
            <span className={`pv-mono text-[9.5px] uppercase tracking-[0.12em] ${row.verb === "delete" ? "text-red-600" : row.verb === "add" ? "text-emerald-600" : "text-amber-600"}`}>{row.verb}</span>
            <span className="pv-serif text-[13px] text-foreground">{row.kind} · {row.label}</span>
            {row.parentLabel && <span className="pv-serif text-[11.5px] italic text-[hsl(var(--pv-text-faint))]">in {row.parentLabel}</span>}
            {!!row.restales && <span className="pv-mono text-[9px] text-[hsl(var(--pv-text-faint))]">±{row.restales}</span>}
          </div>
          {row.fields.map((f) => (
            <div key={f.key} className="mt-0.5">
              <span className="pv-mono text-[9px] uppercase tracking-[0.1em] text-[hsl(var(--pv-text-faint))]">{f.key}</span>
              {f.old && <p className="pv-serif text-[12px] leading-[1.45] text-[hsl(var(--pv-text-faint))] line-through decoration-[hsl(var(--pv-text-faint))]/40">{f.old}</p>}
              <p className="pv-serif text-[12.5px] leading-[1.5] text-[hsl(var(--pv-text-muted))]">{f.next}</p>
            </div>
          ))}
        </li>
      ))}
    </ul>
  );
}
