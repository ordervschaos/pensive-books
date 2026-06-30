// DnaLedgerPage — /books/:slug/dna/ledger
// The continuity ledger (docs/true-agent.md Step 3): the prefix-sum "story so far" canon folded from each
// scene's observed_establishes, plus the contradiction breaks the read recorded. "Build continuity ledger"
// runs the sequential per-scene read (the batch form of the per-page loop); "Send breaks to editor" hands the
// continuity_break findings to the agent. Pure projection of the live tree — refresh is a no-op.
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ledgerFull, scenesInOrder, validate, type DnaNode } from "@/lib/novelDna";
import { ledgerFindingsMessage, runLedgerScan, sendBreaksToEditor, type LedgerScanProgress } from "@/lib/factLedger";

const getNumericId = (p: string | undefined) => { const m = p?.match(/^(\d+)/); return m ? parseInt(m[1]) : 0; };

export default function DnaLedgerPage() {
  const { bookSlug } = useParams<{ bookSlug: string }>();
  const navigate = useNavigate();
  const bookId = getNumericId(bookSlug);
  const [nodes, setNodes] = useState<DnaNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!bookId) { setError("no book id"); return; }
    void supabase.from("book_nodes").select("*").eq("book_id", bookId).order("position")
      .then(({ data, error: err }) => { if (err) setError(err.message); else setNodes((data ?? []) as DnaNode[]); });
  }, [bookId]);

  // live subscription (refresh = no-op: the page is a projection of server state)
  useEffect(() => {
    if (!bookId) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const soon = () => { if (t) clearTimeout(t); t = setTimeout(() => void supabase.from("book_nodes").select("*").eq("book_id", bookId).order("position").then(({ data }) => { if (data) setNodes(data as DnaNode[]); }), 400); };
    const ch = supabase.channel(`ledger_${bookId}_${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "book_nodes", filter: `book_id=eq.${bookId}` }, soon)
      .subscribe();
    return () => { if (t) clearTimeout(t); void supabase.removeChannel(ch); };
  }, [bookId]);

  const { facts, breaks, sceneNum } = useMemo(() => {
    const ns = nodes ?? [];
    const order = new Map(scenesInOrder(ns).map((s, i) => [s.id, i + 1]));
    return {
      facts: ledgerFull(ns).sort((a, b) => (order.get(a.sceneId) ?? 0) - (order.get(b.sceneId) ?? 0)),
      breaks: validate(ns).filter((i) => i.rule === "continuity_break"),
      sceneNum: (id: string) => order.get(id) ?? 0,
    };
  }, [nodes]);

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
      else setNote("No continuity breaks to send — the prose is consistent.");
    } catch (e) {
      setNote(`Couldn't send to the editor: ${String((e as Error)?.message ?? e)}`);
    } finally { setBusy(false); }
  };

  if (error) return <div style={{ padding: 24, color: "#f87171", fontFamily: "monospace" }}>error: {error}</div>;
  if (!nodes) return <div style={{ padding: 24, color: "#888", fontFamily: "monospace" }}>loading…</div>;

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#ddd", padding: "24px 28px", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.2 }}>Continuity ledger</h1>
          <a href={`/books/${bookSlug}/dna/tree`} style={{ fontSize: 12, color: "#7dd3fc", textDecoration: "none" }}>← tree</a>
        </div>
        <p style={{ fontSize: 12, color: "#777", marginTop: 0, marginBottom: 12 }}>
          The "story so far" canon (docs/true-agent.md Step 3) — facts the prose asserts, folded over scenes in reading order (last-write-wins). The read also flags where later prose contradicts earlier canon.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
          <button type="button" onClick={() => void build()} disabled={busy}
            style={{ fontSize: 12, color: "#0a0a0a", background: "#7dd3fc", border: "none", borderRadius: 6, padding: "6px 12px", fontWeight: 600, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
            {busy ? "Reading…" : "Build continuity ledger"}
          </button>
          <button type="button" onClick={() => void send()} disabled={busy || !ledgerFindingsMessage(nodes)}
            style={{ fontSize: 12, color: "#ddd", background: "transparent", border: "1px solid #333", borderRadius: 6, padding: "6px 12px", cursor: busy || !ledgerFindingsMessage(nodes) ? "default" : "pointer", opacity: busy || !ledgerFindingsMessage(nodes) ? 0.4 : 1 }}>
            Send breaks to editor →
          </button>
          {note && <span style={{ fontSize: 12, color: note.toLowerCase().includes("fail") || note.toLowerCase().includes("couldn't") ? "#f87171" : "#888" }}>{note}</span>}
        </div>

        {breaks.length > 0 && (
          <div style={{ border: "1px solid #3a1a1a", background: "#140d0d", borderRadius: 8, padding: "10px 12px", marginBottom: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#f87171", marginBottom: 6 }}>{breaks.length} continuity break{breaks.length === 1 ? "" : "s"}</div>
            {breaks.map((b, k) => (
              <div key={k} style={{ fontSize: 12, color: "#d8b4b4", paddingLeft: 4, marginBottom: 2 }}>
                <span style={{ color: "#888" }}>scene {sceneNum(b.nodeId ?? "")}:</span> {b.message}
              </div>
            ))}
          </div>
        )}

        {facts.length === 0 ? (
          <div style={{ fontSize: 13, color: "#777", border: "1px dashed #2a2a2a", borderRadius: 8, padding: 20 }}>
            No facts yet. Run <code style={{ color: "#fbbf24" }}>Build continuity ledger</code> to read the prose and extract the canon (needs scenes with prose).
          </div>
        ) : (
          <div style={{ border: "1px solid #1c1c1c", borderRadius: 8, overflow: "hidden" }}>
            {facts.map((f) => (
              <div key={f.key} style={{ display: "flex", gap: 12, alignItems: "baseline", padding: "8px 12px", borderBottom: "1px solid #161616" }}>
                <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#fbbf24", minWidth: 180 }}>{f.key}</span>
                <span style={{ flex: 1, fontSize: 13, color: "#e5e5e5" }}>{f.value}{f.note ? <span style={{ color: "#777" }}> · {f.note}</span> : null}</span>
                <span style={{ fontSize: 11, color: "#666", whiteSpace: "nowrap" }}>scene {sceneNum(f.sceneId)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
