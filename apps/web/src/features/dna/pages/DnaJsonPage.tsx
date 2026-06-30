// DnaJsonPage — /books/:slug/dna.json
// Dumps the book_nodes tree as raw JSON. No app chrome; nav is suppressed via ConditionalNav.
// Two query params:
//   ?mode=flat  (default) — raw book_nodes rows as stored
//   ?mode=tree  — nested hierarchy (children inlined under each parent)
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { DnaNode } from "@/lib/novelDna";

const getNumericId = (param: string | undefined) => {
  const m = param?.match(/^(\d+)/);
  return m ? parseInt(m[1]) : 0;
};

function nestNodes(flat: DnaNode[]) {
  type Nested = DnaNode & { children?: Nested[] };
  const map = new Map<string, Nested>(flat.map((n) => [n.id, { ...n }]));
  const roots: Nested[] = [];
  for (const n of map.values()) {
    if (!n.parent_id) { roots.push(n); continue; }
    const parent = map.get(n.parent_id);
    if (parent) { (parent.children ??= []).push(n); }
    else roots.push(n);
  }
  // Sort by position at every level.
  const sort = (ns: Nested[]) => { ns.sort((a, b) => a.position - b.position); ns.forEach((n) => n.children && sort(n.children)); };
  sort(roots);
  return roots;
}

export default function DnaJsonPage() {
  const { bookSlug } = useParams();
  const [params] = useSearchParams();
  const mode = params.get("mode") === "tree" ? "tree" : "flat";
  const bookId = getNumericId(bookSlug);

  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bookId) { setError("no book id"); return; }
    void (async () => {
      const [{ data: nodes, error: nodesErr }, { data: book, error: bookErr }] = await Promise.all([
        supabase.from("book_nodes").select("*").eq("book_id", bookId).order("position"),
        supabase.from("books").select("id, name, mode, brief").eq("id", bookId).maybeSingle(),
      ]);
      if (nodesErr || bookErr) { setError((nodesErr ?? bookErr)?.message ?? "error"); return; }
      const payload = {
        book: { id: book?.id, name: book?.name, mode: book?.mode },
        node_count: nodes?.length ?? 0,
        nodes: mode === "tree" ? nestNodes((nodes ?? []) as DnaNode[]) : (nodes ?? []),
      };
      setOutput(JSON.stringify(payload, null, 2));
    })();
  }, [bookId, mode]);

  const pre: React.CSSProperties = {
    margin: 0, padding: "1.5rem", minHeight: "100vh",
    fontFamily: "ui-monospace, 'Cascadia Code', 'Source Code Pro', monospace",
    fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-all",
    background: "#0f0f0f", color: "#d4d4d4",
  };

  if (error) return <pre style={{ ...pre, color: "#f87171" }}>{`error: ${error}`}</pre>;
  if (!output) return <pre style={pre}>loading…</pre>;
  return <pre style={pre}>{output}</pre>;
}
