// DnaTreePage — /books/:slug/dna/tree
// Visual tree of the live book_nodes hierarchy. No app chrome; nav suppressed via ConditionalNav.
// Color-coded by node kind; connector lines via CSS borders; collapsible per-node.
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { byId, childrenOf, isProseStale, isStale, type DnaNode, type BeatContent, type SceneContent } from "@/lib/novelDna";

const getNumericId = (p: string | undefined) => { const m = p?.match(/^(\d+)/); return m ? parseInt(m[1]) : 0; };

// ── Kind color map — groups: spine (seed→pillar), entities, structure, leaf ───
const KIND_COLOR: Record<string, string> = {
  seed: "#a78bfa",       // violet — the origin
  premise: "#818cf8",    // indigo
  pillar: "#6366f1",     // indigo darker
  character: "#38bdf8",  // sky — entities
  relationship: "#7dd3fc",
  world_fact: "#bae6fd",
  tentpole: "#e0f2fe",
  game: "#93c5fd",
  thread: "#f9a8d4",     // pink — cross-cutting promises
  movement: "#fb923c",   // orange — acts
  beat: "#fbbf24",       // amber — causal units
  scene: "#4ade80",      // green — the leaf scenes
};

const KIND_BG: Record<string, string> = {
  seed: "#1e1a2e", premise: "#1a1a2e", pillar: "#16163a",
  character: "#0c1e2e", relationship: "#0c1e2e", world_fact: "#0c1e2e", tentpole: "#0c1e2e", game: "#0c1e2e",
  thread: "#2a1020",
  movement: "#1e1200", beat: "#1e1600", scene: "#001a10",
};

// ── Title extraction per kind (first meaningful field) ───────────────────────
function nodeTitle(n: DnaNode): string {
  const c = n.content as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");
  switch (n.kind) {
    case "seed": return s(c.logline);
    case "premise": return s(c.dramatic_question) || s((c.shape as Record<string, unknown>)?.setup);
    case "pillar": return s(c.controlling_idea);
    case "character": return s(c.name);
    case "relationship": return s(c.bond);
    case "world_fact": return s(c.name) || s(c.rule);
    case "tentpole": return s(c.summary);
    case "game": return s(c.name);
    case "thread": return s(c.name) || s(c.promise);
    case "movement": return s(c.title) || s(c.goal);
    case "beat": return s((c as BeatContent).summary);
    case "scene": return s((c as SceneContent).chapter_start?.title) || s((c as SceneContent).goal);
    default: return "";
  }
}

// ── Connector glyph for beats ────────────────────────────────────────────────
function beatGlyph(n: DnaNode): string {
  if (n.kind !== "beat") return "";
  const c = (n.content as BeatContent).connector;
  return c === "therefore" ? "∴ " : c === "but" ? "↯ " : "";
}

// ── Single tree row ──────────────────────────────────────────────────────────
function TreeRow({ node, index, nodes, depth, isLast, collapsed, onToggle }: {
  node: DnaNode; index: Map<string, DnaNode>; nodes: DnaNode[]; depth: number;
  isLast: boolean; collapsed: boolean; onToggle: () => void;
}) {
  const kids = childrenOf(nodes, node.id);
  const hasKids = kids.length > 0;
  const stale = isStale(node, index) || (node.kind === "scene" && isProseStale(node));
  const color = KIND_COLOR[node.kind] ?? "#888";
  const bg = KIND_BG[node.kind] ?? "transparent";
  const title = nodeTitle(node);
  const glyph = beatGlyph(node);

  return (
    <div style={{ position: "relative" }}>
      {/* Vertical connector line from this node down to its last child */}
      {hasKids && !collapsed && (
        <div style={{
          position: "absolute",
          left: depth * 20 + 8,
          top: 22,
          bottom: 0,
          width: 1,
          background: `${color}30`,
          pointerEvents: "none",
        }} />
      )}

      {/* The node row */}
      <div
        onClick={hasKids ? onToggle : undefined}
        style={{
          display: "flex", alignItems: "baseline", gap: 8,
          paddingLeft: depth * 20 + (depth > 0 ? 20 : 4),
          paddingRight: 12, paddingTop: 3, paddingBottom: 3,
          cursor: hasKids ? "pointer" : "default",
          position: "relative",
        }}
      >
        {/* Horizontal connector line from parent spine to this node */}
        {depth > 0 && (
          <div style={{
            position: "absolute",
            left: (depth - 1) * 20 + 8,
            top: "50%",
            width: 12,
            height: 1,
            background: `${color}40`,
            transform: "translateY(-50%)",
          }} />
        )}

        {/* Expand/collapse chevron */}
        <span style={{ width: 12, shrink: 0, color: hasKids ? `${color}80` : "transparent", fontSize: 9, lineHeight: 1 }}>
          {hasKids ? (collapsed ? "▶" : "▼") : "·"}
        </span>

        {/* Kind badge */}
        <span style={{
          fontFamily: "ui-monospace, monospace", fontSize: 9, letterSpacing: "0.1em",
          textTransform: "uppercase", color, background: bg,
          padding: "1px 5px", borderRadius: 3, border: `1px solid ${color}30`,
          whiteSpace: "nowrap", flexShrink: 0,
        }}>
          {node.kind}
        </span>

        {/* Title / content preview */}
        {(glyph || title) && (
          <span style={{
            fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#c9c9c9",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
          }}>
            {glyph && <span style={{ color: "#fbbf24", marginRight: 2 }}>{glyph}</span>}
            {title}
          </span>
        )}

        {/* Status + stale + locked chips */}
        <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, marginLeft: "auto" }}>
          {stale && <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 8, textTransform: "uppercase", letterSpacing: "0.12em", color: "#f59e0b" }}>stale</span>}
          {node.authoring.locked && <span style={{ fontSize: 10, color: color }}>🔒</span>}
          <span style={{
            width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
            background: node.authoring.status === "accepted" ? (stale ? "#f59e0b" : "#4ade80")
              : node.authoring.status === "draft" ? "#fbbf24"
                : "#444",
          }} title={node.authoring.status ?? "empty"} />
          <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 9, color: "#444", letterSpacing: "0.05em" }}>
            {node.id}
          </span>
        </span>
      </div>
    </div>
  );
}

// ── Recursive tree subtree ───────────────────────────────────────────────────
function Subtree({ node, index, nodes, depth, isLast, collapsedSet, onToggle }: {
  node: DnaNode; index: Map<string, DnaNode>; nodes: DnaNode[]; depth: number; isLast: boolean;
  collapsedSet: Set<string>; onToggle: (id: string) => void;
}) {
  const kids = childrenOf(nodes, node.id).sort((a, b) => a.position - b.position);
  const collapsed = collapsedSet.has(node.id);

  return (
    <div>
      <TreeRow node={node} index={index} nodes={nodes} depth={depth} isLast={isLast}
        collapsed={collapsed} onToggle={() => onToggle(node.id)} />
      {!collapsed && kids.map((child, i) => (
        <Subtree key={child.id} node={child} index={index} nodes={nodes} depth={depth + 1}
          isLast={i === kids.length - 1} collapsedSet={collapsedSet} onToggle={onToggle} />
      ))}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function DnaTreePage() {
  const { bookSlug } = useParams();
  const bookId = getNumericId(bookSlug);

  const [bookName, setBookName] = useState<string>("");
  const [nodes, setNodes] = useState<DnaNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsedSet, setCollapsedSet] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!bookId) { setError("no book id"); return; }
    void (async () => {
      const [{ data: nodeRows, error: nodesErr }, { data: book, error: bookErr }] = await Promise.all([
        supabase.from("book_nodes").select("*").eq("book_id", bookId).order("position"),
        supabase.from("books").select("name").eq("id", bookId).maybeSingle(),
      ]);
      if (nodesErr || bookErr) { setError((nodesErr ?? bookErr)?.message ?? "error"); return; }
      setBookName(book?.name ?? "");
      setNodes((nodeRows ?? []) as DnaNode[]);
    })();
  }, [bookId]);

  // Live subscription
  useEffect(() => {
    if (!bookId) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const soon = () => { if (t) clearTimeout(t); t = setTimeout(() => void supabase.from("book_nodes").select("*").eq("book_id", bookId).order("position").then(({ data }) => { if (data) setNodes(data as DnaNode[]); }), 400); };
    const ch = supabase.channel(`tree_${bookId}_${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "book_nodes", filter: `book_id=eq.${bookId}` }, soon)
      .subscribe();
    return () => { if (t) clearTimeout(t); void supabase.removeChannel(ch); };
  }, [bookId]);

  const collapseAll = useCallback(() => {
    if (!nodes) return;
    setCollapsedSet(new Set(nodes.filter((n) => childrenOf(nodes, n.id).length > 0).map((n) => n.id)));
  }, [nodes]);

  const expandAll = useCallback(() => setCollapsedSet(new Set()), []);

  const toggleNode = useCallback((id: string) => {
    setCollapsedSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const base: React.CSSProperties = {
    margin: 0, minHeight: "100vh",
    fontFamily: "ui-monospace, 'Cascadia Code', 'Source Code Pro', monospace",
    background: "#0a0a0a", color: "#888",
    userSelect: "text",
  };

  if (error) return <div style={{ ...base, padding: 24, color: "#f87171" }}>error: {error}</div>;
  if (!nodes) return <div style={{ ...base, padding: 24 }}>loading…</div>;

  const index = byId(nodes);
  const roots = nodes.filter((n) => n.parent_id === null).sort((a, b) => a.position - b.position);

  // Kind distribution for the stats bar
  const counts = nodes.reduce<Record<string, number>>((acc, n) => { acc[n.kind] = (acc[n.kind] ?? 0) + 1; return acc; }, {});
  const accepted = nodes.filter((n) => n.authoring.status === "accepted").length;
  const staleCount = nodes.filter((n) => isStale(n, index) || (n.kind === "scene" && isProseStale(n))).length;

  return (
    <div style={base}>
      {/* Header bar */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #1a1a1a", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <span style={{ color: "#666", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          {bookName || bookSlug} · dna tree
        </span>
        <span style={{ color: "#333", fontSize: 11 }}>
          {nodes.length} nodes · {accepted} accepted{staleCount > 0 ? ` · ${staleCount} stale` : ""}
        </span>
        {/* Kind legend */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {Object.entries(counts).map(([kind, n]) => (
            <span key={kind} style={{ fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: KIND_COLOR[kind] ?? "#888" }}>
              {n} {kind}
            </span>
          ))}
        </div>
        {/* Controls */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 12 }}>
          <button onClick={expandAll} style={{ background: "none", border: "none", color: "#555", fontSize: 10, cursor: "pointer", letterSpacing: "0.1em", textTransform: "uppercase" }}>expand all</button>
          <button onClick={collapseAll} style={{ background: "none", border: "none", color: "#555", fontSize: 10, cursor: "pointer", letterSpacing: "0.1em", textTransform: "uppercase" }}>collapse all</button>
          <a href={`/books/${bookSlug}/dna.json`} style={{ color: "#555", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", textDecoration: "none" }}>json →</a>
          <a href={`/books/${bookSlug}/dna`} style={{ color: "#555", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", textDecoration: "none" }}>studio →</a>
        </div>
      </div>

      {/* Legend */}
      <div style={{ padding: "8px 16px", borderBottom: "1px solid #111", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <span style={{ fontSize: 9, color: "#333", letterSpacing: "0.1em", textTransform: "uppercase" }}>status</span>
        {[["accepted", "#4ade80"], ["draft", "#fbbf24"], ["empty", "#444"]].map(([s, c]) => (
          <span key={s} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: c }} />
            <span style={{ fontSize: 9, color: "#444", letterSpacing: "0.08em", textTransform: "uppercase" }}>{s}</span>
          </span>
        ))}
        <span style={{ fontSize: 9, color: "#f59e0b", letterSpacing: "0.08em", textTransform: "uppercase" }}>amber dot = stale</span>
        <span style={{ fontSize: 9, color: "#fbbf24", marginLeft: 8 }}>∴ therefore  ↯ but</span>
      </div>

      {/* Tree */}
      <div style={{ paddingTop: 8, paddingBottom: 48 }}>
        {roots.length === 0 ? (
          <div style={{ padding: "24px 16px", color: "#333", fontSize: 13 }}>no nodes — migrate or seed the tree first</div>
        ) : roots.map((root, i) => (
          <Subtree key={root.id} node={root} index={index} nodes={nodes} depth={0}
            isLast={i === roots.length - 1} collapsedSet={collapsedSet} onToggle={toggleNode} />
        ))}
      </div>
    </div>
  );
}
