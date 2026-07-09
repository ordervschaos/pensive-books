// LedgerPane — the continuity ledger body, extracted so it renders in two places on ONE implementation:
// the standalone /dna/ledger route (DnaLedgerPage wraps it in page chrome) and the studio's Analytics tab
// (DnaTreePage feeds it the already-subscribed nodes). Pure projection of the live tree — "Build continuity
// ledger" runs the sequential per-scene read (docs/true-agent.md Step 3), writing facts + continuity_break
// flags onto book_nodes; the subscription the host owns re-projects them here. Mirrors MetersPane's shape.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ledgerFull, scenesInOrder, traceDiff, validate, type DnaNode } from "@/features/dna/lib/novelDna";
import { ledgerFindingsMessage, runLedgerScan, sendBreaksToEditor, traceFindingsMessage, type LedgerScanProgress } from "@/features/dna/lib/factLedger";
import { MONO, T } from "./treeChrome";

export function LedgerPane({ nodes, bookId, bookSlug }: { nodes: DnaNode[]; bookId: number; bookSlug: string }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const { facts, breaks, traceGaps, sceneNum } = useMemo(() => {
    const ns = nodes ?? [];
    const order = new Map(scenesInOrder(ns).map((s, i) => [s.id, i + 1]));
    return {
      facts: ledgerFull(ns).sort((a, b) => (order.get(a.sceneId) ?? 0) - (order.get(b.sceneId) ?? 0)),
      breaks: validate(ns).filter((i) => i.rule === "continuity_break"),
      traceGaps: traceDiff(ns), // planned-vs-observed state gaps (scene-ledger §3.2)
      sceneNum: (id: string) => order.get(id) ?? 0,
    };
  }, [nodes]);
  const hasFindings = (n: DnaNode[] | null) => !!n && (!!ledgerFindingsMessage(n) || !!traceFindingsMessage(n));

  const build = async () => {
    if (!nodes || !bookId) return;
    setBusy(true); setNote("Reading scene 1…");
    try {
      const r = await runLedgerScan(bookId, nodes, (p: LedgerScanProgress) => setNote(`Reading scene ${p.done}/${p.total}… (${p.contradictions} break${p.contradictions === 1 ? "" : "s"} so far)`));
      setNote(`Read ${r.scanned} scene(s): ${r.facts} fact(s), ${r.contradictions} continuity break(s).`);
    } catch (e) {
      setNote(`Scan failed: ${String((e as Error)?.message ?? e)}`);
    } finally { setBusy(false); }
  };

  const send = async () => {
    if (!nodes || !bookId) return;
    setBusy(true);
    try {
      const sent = await sendBreaksToEditor(bookId, nodes, {});
      if (sent) navigate(`/books/${bookSlug}/dna/tree`);
      else setNote("Nothing to send — the prose is consistent and every planned move/payoff landed.");
    } catch (e) {
      setNote(`Couldn't send to the editor: ${String((e as Error)?.message ?? e)}`);
    } finally { setBusy(false); }
  };

  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: "12px 14px", marginBottom: 18, background: T.raised }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>Ledger</span>
        <button type="button" onClick={() => void build()} disabled={busy}
          style={{ fontSize: 12, color: T.paper, background: T.accent, border: "none", borderRadius: 6, padding: "5px 11px", fontWeight: 600, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
          {busy ? "Reading…" : "Build continuity ledger"}
        </button>
        <button type="button" onClick={() => void send()} disabled={busy || !hasFindings(nodes)}
          style={{ fontSize: 12, color: T.inkSoft, background: "transparent", border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 11px", cursor: busy || !hasFindings(nodes) ? "default" : "pointer", opacity: busy || !hasFindings(nodes) ? 0.4 : 1 }}>
          Send findings to editor →
        </button>
        {note && <span style={{ fontSize: 12, color: note.toLowerCase().includes("fail") || note.toLowerCase().includes("couldn't") ? T.bad : T.muted }}>{note}</span>}
      </div>
      <p style={{ fontSize: 12, color: T.muted, marginTop: 0, marginBottom: breaks.length || traceGaps.length || facts.length ? 12 : 0 }}>
        The "story so far" canon (docs/true-agent.md Step 3) — facts the prose asserts, folded over scenes in reading order (last-write-wins). The read also flags where later prose contradicts earlier canon.
      </p>

      {breaks.length > 0 && (
        <div style={{ border: `1px solid ${T.bad}44`, background: `${T.bad}11`, borderRadius: 8, padding: "10px 12px", marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.bad, marginBottom: 6 }}>{breaks.length} continuity break{breaks.length === 1 ? "" : "s"}</div>
          {breaks.map((b, k) => (
            <div key={k} style={{ fontSize: 12, color: T.inkSoft, paddingLeft: 4, marginBottom: 2 }}>
              <span style={{ color: T.muted }}>scene {sceneNum(b.nodeId ?? "")}:</span> {b.message}
            </div>
          ))}
        </div>
      )}

      {traceGaps.length > 0 && (
        <div style={{ border: `1px solid ${T.warn}44`, background: `${T.warn}11`, borderRadius: 8, padding: "10px 12px", marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.warn, marginBottom: 6 }}>{traceGaps.length} planned-vs-observed trace gap{traceGaps.length === 1 ? "" : "s"} <span style={{ color: T.muted, fontWeight: 400 }}>— a move/payoff the plan wanted that the read didn't find</span></div>
          {traceGaps.map((g, k) => (
            <div key={k} style={{ fontSize: 12, color: T.inkSoft, paddingLeft: 4, marginBottom: 2 }}>
              <span style={{ color: T.muted }}>[{g.axis}]</span> {g.note}
            </div>
          ))}
        </div>
      )}

      {facts.length === 0 ? (
        <div style={{ fontSize: 13, color: T.muted, border: `1px dashed ${T.border}`, borderRadius: 8, padding: 20 }}>
          No facts yet. Run <code style={{ color: T.warn }}>Build continuity ledger</code> to read the prose and extract the canon (needs scenes with prose).
        </div>
      ) : (
        <div style={{ border: `1px solid ${T.borderSoft}`, borderRadius: 8, overflow: "hidden" }}>
          {facts.map((f) => (
            <div key={f.key} style={{ display: "flex", gap: 12, alignItems: "baseline", padding: "8px 12px", borderBottom: `1px solid ${T.borderSoft}` }}>
              <span style={{ fontFamily: MONO, fontSize: 12, color: T.warn, minWidth: 180 }}>{f.key}</span>
              <span style={{ flex: 1, fontSize: 13, color: T.ink }}>{f.value}{f.note ? <span style={{ color: T.muted }}> · {f.note}</span> : null}</span>
              <span style={{ fontSize: 11, color: T.muted, whiteSpace: "nowrap" }}>scene {sceneNum(f.sceneId)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
