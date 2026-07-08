// DnaMetersPage — /books/:slug/dna/meters
// The standalone meters route: loads + subscribes the tree, then renders the shared MetersPane (the same body
// the studio's `meters` tab shows). Pure projection of the live tree — nothing generates here; the pane's read
// buttons write onto book_nodes and the subscription below re-projects. Nav suppressed (a dev DNA route).
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { type DnaNode } from "@/features/dna/lib/novelDna";
import { MetersPane } from "@/features/dna/components/tree/MetersPane";

const getNumericId = (p: string | undefined) => { const m = p?.match(/^(\d+)/); return m ? parseInt(m[1]) : 0; };

export default function DnaMetersPage() {
  const { bookSlug } = useParams<{ bookSlug: string }>();
  const bookId = getNumericId(bookSlug);
  const [nodes, setNodes] = useState<DnaNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // initial load
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
    const ch = supabase.channel(`meters_${bookId}_${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "book_nodes", filter: `book_id=eq.${bookId}` }, soon)
      .subscribe();
    return () => { if (t) clearTimeout(t); void supabase.removeChannel(ch); };
  }, [bookId]);

  if (error) return <div style={{ padding: 24, color: "#f87171", fontFamily: "monospace" }}>error: {error}</div>;
  if (!nodes) return <div style={{ padding: 24, color: "#888", fontFamily: "monospace" }}>loading…</div>;

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#ddd", padding: "24px 28px", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.2 }}>Meters</h1>
          <a href={`/books/${bookSlug}/dna/tree`} style={{ fontSize: 12, color: "#7dd3fc", textDecoration: "none" }}>← tree</a>
        </div>
        <MetersPane nodes={nodes} bookId={bookId} bookSlug={bookSlug ?? ""} />
      </div>
    </div>
  );
}
