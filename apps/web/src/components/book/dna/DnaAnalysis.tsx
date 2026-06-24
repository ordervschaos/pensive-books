// DnaAnalysis — surfaces the three analytic axes (schema §6) in the studio: PACING (turning point vs
// target_pct), PROMISES (the thread registry's setup/payoff ledger), TOPOGRAPHY (the value-polarity strip),
// and the structural LINTS. Pure projection of the tree (no generation) — the conformance backstop the
// author reads, the same report the dna-flow eval prints, now in the UI. Collapsible; defaults open once
// there's structure to analyze.
import { useState } from "react";
import { ChevronDown, ChevronRight, TriangleAlert } from "lucide-react";
import { Eyebrow } from "@/components/book/studio/studioUi";
import { causality, pacing, promiseLedger, topography, validate, type DnaNode } from "@/lib/novelDna";
import type { BookSettings } from "@/lib/novelDna";

export function DnaAnalysis({ nodes, settings }: { nodes: DnaNode[]; settings: BookSettings }) {
  const [open, setOpen] = useState(true);
  const pace = pacing(nodes);
  const ledger = promiseLedger(nodes);
  const topo = topography(nodes);
  const causal = causality(nodes);
  const hasCausal = causal.some((r) => r.connector || r.needs.length);
  const issues = validate(nodes);
  if (!pace.length && !ledger.length && !topo.length) return null;

  const errors = issues.filter((i) => i.severity === "error").length;
  const warns = issues.length - errors;

  return (
    <div className="rounded-lg border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/30">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left">
        {open ? <ChevronDown className="h-3.5 w-3.5 text-[hsl(var(--pv-text-faint))]" /> : <ChevronRight className="h-3.5 w-3.5 text-[hsl(var(--pv-text-faint))]" />}
        <Eyebrow tone="muted">Story analysis</Eyebrow>
        <span className="ml-auto flex items-center gap-2">
          {issues.length === 0
            ? <span className="pv-mono text-[10px] uppercase tracking-[0.1em] text-emerald-500">clean</span>
            : <span className="pv-mono flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] text-amber-500"><TriangleAlert className="h-3 w-3" />{errors ? `${errors} err · ` : ""}{warns} warn</span>}
        </span>
      </button>

      {open && (
        <div className="space-y-4 px-4 pb-4 pt-1">
          {/* PACING */}
          {pace.length > 0 && (
            <section className="space-y-1">
              <p className="pv-mono text-[9px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">pacing · turn position vs target</p>
              {pace.map((p) => {
                const drift = typeof p.targetPct === "number" && Math.abs(p.driftPct) > 0.1;
                return (
                  <div key={p.movementId} className="flex items-center gap-2 text-[12px]">
                    <span className="pv-serif w-40 shrink-0 truncate text-[hsl(var(--pv-text-muted))]">{p.title ?? "act"}</span>
                    <div className="relative h-1.5 flex-1 rounded-full bg-[hsl(var(--pv-surface-2))]">
                      {typeof p.targetPct === "number" && <span className="absolute top-1/2 h-2.5 w-0.5 -translate-y-1/2 bg-[hsl(var(--pv-text-faint))]" style={{ left: `${p.targetPct * 100}%` }} title={`target ${Math.round(p.targetPct * 100)}%`} />}
                      <span className={`absolute top-1/2 h-2 w-2 -translate-y-1/2 -translate-x-1/2 rounded-full ${drift ? "bg-amber-500" : "bg-[hsl(var(--pv-accent))]"}`} style={{ left: `${p.actualPct * 100}%` }} title={`actual ${Math.round(p.actualPct * 100)}%`} />
                    </div>
                    <span className={`pv-mono w-10 shrink-0 text-right text-[10px] ${drift ? "text-amber-500" : "text-[hsl(var(--pv-text-faint))]"}`}>{Math.round(p.actualPct * 100)}%</span>
                  </div>
                );
              })}
            </section>
          )}

          {/* PROMISES */}
          {ledger.length > 0 && (
            <section className="space-y-1">
              <p className="pv-mono text-[9px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">promises · setups → payoffs</p>
              {ledger.map((r) => {
                const dangling = r.setups > 0 && r.payoffs === 0;
                return (
                  <div key={r.threadId} className="flex items-center gap-2 text-[12px]">
                    <span className="pv-serif flex-1 truncate text-[hsl(var(--pv-text-muted))]" title={r.promise}>{r.name}</span>
                    <span className={`pv-mono shrink-0 text-[10px] ${dangling ? "text-amber-500" : "text-[hsl(var(--pv-text-faint))]"}`}>{r.setups}→{r.payoffs}{dangling ? " ⚠" : ""}</span>
                  </div>
                );
              })}
            </section>
          )}

          {/* TOPOGRAPHY */}
          {topo.length > 0 && (
            <section className="space-y-1">
              <div className="flex items-center justify-between gap-3">
                <p className="pv-mono text-[9px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">topography · emotional charge in reading order</p>
                <span className="pv-mono flex items-center gap-2 text-[9px] text-[hsl(var(--pv-text-faint))]">
                  <span className="flex items-center gap-1"><span className="h-2 w-1.5 rounded-sm bg-emerald-500/70" />up</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-1.5 rounded-sm bg-rose-500/60" />down</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-1.5 rounded-sm bg-[hsl(var(--pv-surface-2))]" />flat</span>
                </span>
              </div>
              <div className="flex flex-wrap gap-0.5">
                {topo.map((t, i) => (
                  <span key={i} className={`inline-block h-3 w-1.5 rounded-sm ${t.polarity === "up" ? "bg-emerald-500/70" : t.polarity === "down" ? "bg-rose-500/60" : "bg-[hsl(var(--pv-surface-2))]"}`}
                    title={t.polarity ?? "no value shift"} />
                ))}
              </div>
            </section>
          )}

          {/* CAUSALITY — the causal spine: each beat's connector + unmet upstream needs */}
          {hasCausal && (
            <section className="space-y-1">
              <p className="pv-mono text-[9px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">causality · why each turn follows (∴ therefore · ↯ but)</p>
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                {causal.map((r) => {
                  const hollow = (r.connector === "therefore" && r.unmet.length > 0) || (r.connector === "but" && !r.reversed && !r.needs.length);
                  const glyph = r.connector === "therefore" ? "∴" : r.connector === "but" ? "↯" : "·";
                  const tip = [
                    r.connector ? `connector: ${r.connector}` : "first beat",
                    r.needs.length ? `needs: ${r.needs.join(", ")}` : "",
                    r.produces.length ? `produces: ${r.produces.join(", ")}` : "",
                    r.unmet.length ? `UNMET: ${r.unmet.join(", ")}` : "",
                  ].filter(Boolean).join(" · ");
                  return (
                    <span key={r.beatId} title={tip}
                      className={`pv-mono inline-flex h-4 min-w-4 items-center justify-center rounded-sm px-0.5 text-[10px] ${hollow ? "bg-amber-500/20 text-amber-500" : "text-[hsl(var(--pv-text-faint))]"}`}>
                      {glyph}
                    </span>
                  );
                })}
              </div>
            </section>
          )}

          {/* LINTS — each row: a severity dot, the rule name (scannable), then the human message */}
          {issues.length > 0 && (
            <section className="space-y-1 border-t border-[hsl(var(--pv-border-soft))] pt-2.5">
              <p className="pv-mono text-[9px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">conformance · {errors ? `${errors} to fix · ` : ""}{warns} to review</p>
              {issues.map((i, k) => (
                <div key={k} className="flex gap-2">
                  <span className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${i.severity === "error" ? "bg-rose-500" : "bg-amber-500"}`} title={i.severity} />
                  <p className="pv-serif text-[11.5px] leading-snug">
                    <span className="pv-mono mr-1.5 text-[9px] text-[hsl(var(--pv-text-faint))]">{i.rule}</span>
                    <span className="text-[hsl(var(--pv-text-muted))]">{i.message}</span>
                  </p>
                </div>
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
