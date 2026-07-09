// DnaMetersPage — /books/:slug/dna/meters
// The standalone meters route: loads + subscribes the tree, then renders the shared MetersPane (the same body
// the studio's `meters` tab shows). Pure projection of the live tree — nothing generates here; the pane's read
// buttons write onto book_nodes and the subscription below re-projects. Nav suppressed (a dev DNA route).
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { type DnaNode } from "@/features/dna/lib/novelDna";
import { MetersPane } from "@/features/dna/components/tree/MetersPane";
import { setConsoleTheme, T } from "@/features/dna/components/tree/treeChrome";
import { useTheme } from "@/components/theme/ThemeProvider";
import { useBookNodesLiveSync } from "@/features/dna/hooks/useBookNodesLiveSync";

const getNumericId = (p: string | undefined) => { const m = p?.match(/^(\d+)/); return m ? parseInt(m[1]) : 0; };

export default function DnaMetersPage() {
  const { themeName } = useTheme();
  const consoleMode = themeName === "terminal" ? "terminal" as const : "paper" as const;
  setConsoleTheme(consoleMode);
  const themeClass = consoleMode === "terminal" ? "theme-terminal dark" : "theme-paper";
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
  useBookNodesLiveSync(bookId, "meters", setNodes);

  if (error) return <div className={themeClass} style={{ padding: 24, color: T.bad, fontFamily: "monospace", background: T.bg, minHeight: "100vh" }}>error: {error}</div>;
  if (!nodes) return <div className={themeClass} style={{ padding: 24, color: T.muted, fontFamily: "monospace", background: T.bg, minHeight: "100vh" }}>loading…</div>;

  return (
    <div key={consoleMode} className={themeClass} style={{ minHeight: "100vh", background: T.bg, color: T.inkSoft, padding: "24px 28px", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.2, color: T.ink }}>Meters</h1>
          <a href={`/books/${bookSlug}/dna/tree`} style={{ fontSize: 12, color: T.accent, textDecoration: "none" }}>← tree</a>
        </div>
        <MetersPane nodes={nodes} bookId={bookId} bookSlug={bookSlug ?? ""} />
      </div>
    </div>
  );
}
