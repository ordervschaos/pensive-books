// DnaTreePage — /books/:slug/dna/tree
// Visual tree of the live book_nodes hierarchy. No app chrome; nav suppressed via ConditionalNav.
// Color-coded by node kind; connector lines via CSS borders; collapsible per-node.
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { byId, childrenOf, isEntityKind, isProseStale, isStale, type DnaNode, type BeatContent, type SceneContent } from "@/lib/novelDna";

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
    case "voice_profile": return s(c.style) || "voice profile";
    default: return "";
  }
}

// ── Detail fields per kind (the "dig one layer in" payload) ───────────────────
// The relevant content fields beneath each node's one-line title — character wants/wounds, scene
// goal/conflict/outcome, game win/lose, etc. Id references (pov, players, relationship a/b) resolve to
// names via the index. Returns [] for kinds with nothing beyond their title (so they stay non-expandable).
function nodeDetails(n: DnaNode, index: Map<string, DnaNode>): { label: string; value: string }[] {
  const c = n.content as Record<string, unknown>;
  const out: { label: string; value: string }[] = [];
  const add = (label: string, value: unknown) => {
    const v = Array.isArray(value) ? value.filter(Boolean).join(", ") : typeof value === "string" ? value.trim() : value != null ? String(value) : "";
    if (v) out.push({ label, value: v });
  };
  const name = (id: unknown) => (typeof id === "string" ? ((index.get(id)?.content as Record<string, unknown>)?.name as string) ?? id : "");
  const names = (ids: unknown) => (Array.isArray(ids) ? ids.map(name).filter(Boolean) : []);
  switch (n.kind) {
    case "character":
      add("role", c.role); add("want", c.want); add("need", c.need); add("wound", c.wound);
      add("lie", c.lie); add("truth", c.truth); add("idiolect", c.idiolect); add("tag", c.tag); break;
    case "relationship":
      add("between", [name(c.a), name(c.b)].filter(Boolean).join("  ↔  ")); add("charge", c.charge); break;
    case "world_fact":
      add("rule", c.rule); add("mechanism", c.mechanism); add("category", c.category); break;
    case "thread":
      add("kind", c.kind); add("promise", c.promise); add("payoff", c.payoff); break;
    case "game":
      add("players", names(c.players)); add("win", c.win_condition); add("lose", c.lose_condition);
      add("stake", c.stake); add("rules", names(c.governing_rules)); break;
    case "voice_profile":
      add("pov", c.pov); add("tense", c.tense); add("constraints", c.constraints); add("sample", c.sample); break;
    case "scene": {
      const sc = n.content as SceneContent;
      add("pov", name(sc.pov)); add("loc", sc.loc); add("goal", sc.goal); add("conflict", sc.conflict); add("outcome", sc.outcome);
      if (sc.value_shift) add("value", `${sc.value_shift.from ?? "?"} → ${sc.value_shift.to ?? "?"}${sc.value_shift.polarity ? `  (${sc.value_shift.polarity})` : ""}`);
      break;
    }
    case "movement": {
      const m = c as Record<string, unknown>;
      add("goal", m.goal); add("turning point", m.turning_point);
      if (typeof m.target_pct === "number") add("target", `${Math.round((m.target_pct as number) * 100)}%`);
      const val = m.value as Record<string, unknown> | undefined;
      if (val) add("value", `${val.from ?? "?"} → ${val.to ?? "?"}`);
      break;
    }
    case "premise":
      add("genre", c.genre); add("tone", c.tone); break;
    case "pillar":
      add("ending", c.ending); break;
    default: break;
  }
  return out;
}

// ── Connector glyph for beats ────────────────────────────────────────────────
function beatGlyph(n: DnaNode): string {
  if (n.kind !== "beat") return "";
  const c = (n.content as BeatContent).connector;
  return c === "therefore" ? "∴ " : c === "but" ? "↯ " : "";
}

// ── A single content field shown when a node is dug into ──────────────────────
function DetailRow({ label, value, depth }: { label: string; value: string; depth: number }) {
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "baseline", gap: 8, paddingLeft: depth * 20 + 20, paddingRight: 12, paddingTop: 1, paddingBottom: 1 }}>
      <div style={{ position: "absolute", left: (depth - 1) * 20 + 8, top: 9, width: 12, height: 1, background: "#ffffff12" }} />
      <span style={{ width: 12, flexShrink: 0 }} />
      <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "#5c5c5c", width: 92, flexShrink: 0, textAlign: "right" }}>{label}</span>
      <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#aeaeae", whiteSpace: "pre-wrap", wordBreak: "break-word", flex: 1, lineHeight: 1.5 }}>{value}</span>
    </div>
  );
}

// ── Single tree row ──────────────────────────────────────────────────────────
function TreeRow({ node, index, depth, expandable, open, onToggle }: {
  node: DnaNode; index: Map<string, DnaNode>; depth: number;
  expandable: boolean; open: boolean; onToggle: () => void;
}) {
  const stale = isStale(node, index) || (node.kind === "scene" && isProseStale(node));
  const color = KIND_COLOR[node.kind] ?? "#888";
  const bg = KIND_BG[node.kind] ?? "transparent";
  const title = nodeTitle(node);
  const glyph = beatGlyph(node);

  return (
    <div style={{ position: "relative" }}>
      {/* Vertical connector line from this node down to its last child / detail */}
      {expandable && open && (
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
        onClick={expandable ? onToggle : undefined}
        style={{
          display: "flex", alignItems: "baseline", gap: 8,
          paddingLeft: depth * 20 + (depth > 0 ? 20 : 4),
          paddingRight: 12, paddingTop: 3, paddingBottom: 3,
          cursor: expandable ? "pointer" : "default",
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
        <span style={{ width: 12, flexShrink: 0, color: expandable ? `${color}80` : "transparent", fontSize: 9, lineHeight: 1 }}>
          {expandable ? (open ? "▼" : "▶") : "·"}
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

// ── A render-only grouping of the pillar's children ──────────────────────────
// The pillar parents two kinds of thing (schema §3 ladder vs §4 entities), and the entity side spans seven
// kinds. This projects the `kind` axis into legible buckets without moving any node; a synthetic
// `${pillar}::story|::world|::world::<kind>` id wires each group into the existing collapse machinery.
const ENTITY_GROUPS: { kind: DnaNode["kind"]; label: string }[] = [
  { kind: "character", label: "characters" },
  { kind: "relationship", label: "relationships" },
  { kind: "thread", label: "threads" },
  { kind: "game", label: "games" },
  { kind: "world_fact", label: "world facts" },
  { kind: "tentpole", label: "tentpoles" },
  { kind: "voice_profile", label: "voice" },
];

// A collapsible labeled section — pure layout, not a real node. `children` is whatever renders inside.
function NodeGroup({ groupId, label, hint, count, depth, collapsedSet, onToggle, children }: {
  groupId: string; label: string; hint?: string; count: number; depth: number;
  collapsedSet: Set<string>; onToggle: (id: string) => void; children: React.ReactNode;
}) {
  if (!count) return null;
  const collapsed = collapsedSet.has(groupId);
  return (
    <div style={{ position: "relative" }}>
      {!collapsed && (
        <div style={{ position: "absolute", left: depth * 20 + 8, top: 22, bottom: 0, width: 1, background: "#ffffff14", pointerEvents: "none" }} />
      )}
      <div onClick={() => onToggle(groupId)} style={{
        display: "flex", alignItems: "baseline", gap: 8,
        paddingLeft: depth * 20 + 20, paddingRight: 12, paddingTop: 7, paddingBottom: 3, cursor: "pointer",
      }}>
        <span style={{ width: 12, flexShrink: 0, color: "#555", fontSize: 9, lineHeight: 1 }}>{collapsed ? "▶" : "▼"}</span>
        <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: "#8a8a8a" }}>{label}</span>
        <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 9, letterSpacing: "0.06em", color: "#3a3a3a" }}>{hint ? `${hint} · ` : ""}{count}</span>
      </div>
      {!collapsed && children}
    </div>
  );
}

// ── Recursive tree subtree ───────────────────────────────────────────────────
function Subtree({ node, index, nodes, depth, collapsedSet, openSet, onToggle, onToggleDetail }: {
  node: DnaNode; index: Map<string, DnaNode>; nodes: DnaNode[]; depth: number;
  collapsedSet: Set<string>; openSet: Set<string>; onToggle: (id: string) => void; onToggleDetail: (id: string) => void;
}) {
  const kids = childrenOf(nodes, node.id).sort((a, b) => a.position - b.position);
  const hasKids = kids.length > 0;
  const details = nodeDetails(node, index);
  const expandable = hasKids || details.length > 0;
  // Containers default OPEN (collapsedSet = opt-out); detail-only leaves default CLOSED (openSet = opt-in),
  // so digging into a character's wound/lie is on demand and the tree stays scannable by default.
  const open = expandable && (hasKids ? !collapsedSet.has(node.id) : openSet.has(node.id));
  const toggle = () => (hasKids ? onToggle(node.id) : onToggleDetail(node.id));
  const detailRows = details.map((d) => <DetailRow key={d.label} label={d.label} value={d.value} depth={depth + 1} />);
  const sub = (items: DnaNode[], d: number) => items.map((child) => (
    <Subtree key={child.id} node={child} index={index} nodes={nodes} depth={d}
      collapsedSet={collapsedSet} openSet={openSet} onToggle={onToggle} onToggleDetail={onToggleDetail} />
  ));

  // The pillar splits into STORY (the spine) + CAST & WORLD (the registry, sub-grouped by kind); every
  // other node renders its detail fields then its children.
  let body: React.ReactNode = null;
  if (open) {
    if (node.kind === "pillar") {
      const ladder = kids.filter((c) => !isEntityKind(c.kind));
      const entities = kids.filter((c) => isEntityKind(c.kind));
      body = (
        <>
          {detailRows}
          <NodeGroup groupId={`${node.id}::story`} label="story" hint="the spine — acts in order"
            count={ladder.length} depth={depth + 1} collapsedSet={collapsedSet} onToggle={onToggle}>
            {sub(ladder, depth + 2)}
          </NodeGroup>
          <NodeGroup groupId={`${node.id}::world`} label="cast & world" hint="the registry"
            count={entities.length} depth={depth + 1} collapsedSet={collapsedSet} onToggle={onToggle}>
            {ENTITY_GROUPS.map(({ kind, label }) => {
              const items = entities.filter((e) => e.kind === kind);
              return (
                <NodeGroup key={kind} groupId={`${node.id}::world::${kind}`} label={label}
                  count={items.length} depth={depth + 2} collapsedSet={collapsedSet} onToggle={onToggle}>
                  {sub(items, depth + 3)}
                </NodeGroup>
              );
            })}
          </NodeGroup>
        </>
      );
    } else {
      body = <>{detailRows}{sub(kids, depth + 1)}</>;
    }
  }

  return (
    <div>
      <TreeRow node={node} index={index} depth={depth} expandable={expandable} open={open} onToggle={toggle} />
      {body}
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
  const [openSet, setOpenSet] = useState<Set<string>>(new Set()); // detail-only leaves the user dug into

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
    setOpenSet(new Set()); // also fold any dug-into detail leaves
  }, [nodes]);

  const expandAll = useCallback(() => setCollapsedSet(new Set()), []);

  const toggleDetail = useCallback((id: string) => {
    setOpenSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

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
        ) : roots.map((root) => (
          <Subtree key={root.id} node={root} index={index} nodes={nodes} depth={0}
            collapsedSet={collapsedSet} openSet={openSet} onToggle={toggleNode} onToggleDetail={toggleDetail} />
        ))}
      </div>
    </div>
  );
}
