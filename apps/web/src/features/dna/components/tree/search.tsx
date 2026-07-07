import { useEffect, useMemo, useRef, useState } from "react";
import { type DnaNode } from "@/features/dna/lib/novelDna";
import { KIND_COLOR } from "./treeChrome";
import { nodeTitle } from "./nodeDisplay";

// ── Search (⌕) — a persistent left-docked panel, VS Code's Search sidebar rather than its Quick Open: stays
// open across jumps (so several hits can be clicked through without re-typing), case/whole-word/regex
// toggles, an include-kind filter (kind is DNA's "which file" — the natural grouping unit here), results
// grouped by kind with collapsible headers, and the match highlighted in place. Closed only by Esc, the ✕,
// or the toolbar toggle — same open/close contract as the timeline/editor rail panels.
export interface SearchOpts { caseSensitive: boolean; wholeWord: boolean; useRegex: boolean }
function escapeRegExp(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
export function buildSearchPattern(query: string, opts: SearchOpts): RegExp | null {
  const q = query.trim();
  if (!q) return null;
  let source = opts.useRegex ? q : escapeRegExp(q);
  if (opts.wholeWord) source = `\\b(?:${source})\\b`;
  try { return new RegExp(source, opts.caseSensitive ? "g" : "gi"); } catch { return null; }
}
export interface SearchHit { node: DnaNode; titleHit: boolean; snippet: string }
// Title hits first (an exec() per string, `lastIndex` reset each call since the pattern carries the "g" flag
// and is reused across nodes). A content hit's snippet windows ±40 chars around the actual match length —
// not the query length, since regex/whole-word matches don't have to be the same size as the typed query.
export function searchDna(nodes: DnaNode[], pattern: RegExp | null, includeKinds: Set<string>): SearchHit[] {
  if (!pattern) return [];
  const hits: SearchHit[] = [];
  for (const n of nodes) {
    if (includeKinds.size && !includeKinds.has(n.kind)) continue;
    const title = nodeTitle(n);
    pattern.lastIndex = 0;
    if (pattern.test(title)) { hits.push({ node: n, titleHit: true, snippet: title }); continue; }
    const text = JSON.stringify(n.content ?? {});
    pattern.lastIndex = 0;
    const m = pattern.exec(text);
    if (!m) continue;
    const len = m[0].length || 1;
    const start = Math.max(0, m.index - 40);
    const end = Math.min(text.length, m.index + len + 40);
    const snippet = (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
    hits.push({ node: n, titleHit: false, snippet });
  }
  return hits.sort((a, b) => Number(b.titleHit) - Number(a.titleHit));
}
// Split text into hit/non-hit runs against `pattern`, for inline highlighting. Forces the "g" flag (a fresh
// RegExp, not the shared one — sharing would leave lastIndex in a state the caller doesn't expect) and
// guards zero-length matches (a bare regex like "a*") so it can't spin forever advancing lastIndex by hand.
function highlightRuns(text: string, pattern: RegExp): { text: string; hit: boolean }[] {
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  const runs: { text: string; hit: boolean }[] = [];
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index), hit: false });
    const len = m[0].length || 1;
    runs.push({ text: text.slice(m.index, m.index + len), hit: true });
    last = m.index + len;
    re.lastIndex = last;
  }
  if (last < text.length) runs.push({ text: text.slice(last), hit: false });
  return runs;
}
export function Highlighted({ text, pattern }: { text: string; pattern: RegExp | null }) {
  if (!pattern || !text) return <>{text}</>;
  return <>{highlightRuns(text, pattern).map((r, i) => r.hit
    ? <mark key={i} style={{ background: "#f5c84233", color: "#f5c842", borderRadius: 2, padding: "0 1px" }}>{r.text}</mark>
    : <span key={i}>{r.text}</span>)}</>;
}
function SearchToggleBtn({ active, label, title, onClick }: { active: boolean; label: string; title: string; onClick: () => void }) {
  return (
    <button onClick={onClick} title={title} style={{
      fontFamily: "ui-monospace, monospace", fontSize: 10, padding: "2px 5px", borderRadius: 3, cursor: "pointer",
      background: active ? "#9bd3e633" : "transparent", border: `1px solid ${active ? "#9bd3e688" : "#2a2a3a"}`,
      color: active ? "#9bd3e6" : "#666",
    }}>{label}</button>
  );
}

// caseSensitive/wholeWord/useRegex/includeKinds are lifted to the page (owned alongside `query`) rather than
// local state, because the page ALSO needs them: it highlights the same pattern in the tree itself and
// auto-reveals matched nodes, so the panel and the tree must compute against the identical options — one
// source of truth, not two toggle sets that could drift apart.
export function SearchPanel({
  nodes, query, onQueryChange,
  caseSensitive, onCaseSensitiveChange, wholeWord, onWholeWordChange, useRegex, onUseRegexChange,
  includeKinds, onIncludeKindsChange, onJump, onClose,
}: {
  nodes: DnaNode[]; query: string; onQueryChange: (q: string) => void;
  caseSensitive: boolean; onCaseSensitiveChange: (v: boolean) => void;
  wholeWord: boolean; onWholeWordChange: (v: boolean) => void;
  useRegex: boolean; onUseRegexChange: (v: boolean) => void;
  includeKinds: Set<string>; onIncludeKindsChange: (s: Set<string>) => void;
  onJump: (id: string) => void; onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [activeIdx, setActiveIdx] = useState(0);

  // Kinds actually present in this book's tree, in schema-hierarchy order (KIND_COLOR's key order), with any
  // kind KIND_COLOR doesn't know about (e.g. voice_profile) appended rather than silently dropped.
  const kindsPresent = useMemo(() => {
    const present = new Set<string>(nodes.map((n) => n.kind));
    const ordered = Object.keys(KIND_COLOR).filter((k) => present.has(k));
    return [...ordered, ...[...present].filter((k) => !ordered.includes(k))];
  }, [nodes]);

  const pattern = useMemo(() => buildSearchPattern(query, { caseSensitive, wholeWord, useRegex }), [query, caseSensitive, wholeWord, useRegex]);
  const invalidRegex = useRegex && query.trim() !== "" && pattern === null;
  const hits = useMemo(() => searchDna(nodes, pattern, includeKinds), [nodes, pattern, includeKinds]);
  const groups = useMemo(() => {
    const byKind = new Map<string, SearchHit[]>();
    for (const h of hits) { const arr = byKind.get(h.node.kind); if (arr) arr.push(h); else byKind.set(h.node.kind, [h]); }
    return kindsPresent.filter((k) => byKind.has(k)).map((k) => [k, byKind.get(k)!] as const);
  }, [hits, kindsPresent]);
  const flatVisible = useMemo(() => groups.filter(([k]) => !collapsedGroups.has(k)).flatMap(([, hs]) => hs), [groups, collapsedGroups]);
  useEffect(() => { setActiveIdx(0); }, [query, caseSensitive, wholeWord, useRegex, includeKinds]);
  const activeHit = flatVisible[Math.min(activeIdx, flatVisible.length - 1)];

  const toggleKind = (k: string) => { const next = new Set(includeKinds); if (next.has(k)) next.delete(k); else next.add(k); onIncludeKindsChange(next); };
  const toggleGroup = (k: string) => setCollapsedGroups((prev) => { const next = new Set(prev); if (next.has(k)) next.delete(k); else next.add(k); return next; });

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, bottom: 0, width: 320, zIndex: 22,
      background: "#0b0b0fee", borderRight: "1px solid #1c1c26", display: "flex", flexDirection: "column",
      fontFamily: "ui-monospace, monospace", backdropFilter: "blur(6px)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px 6px" }}>
        <span style={{ fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "#666" }}>search</span>
        <span onClick={onClose} title="close (esc)" style={{ color: "#666", cursor: "pointer", fontSize: 13, lineHeight: 1 }}>✕</span>
      </div>
      <div style={{ padding: "0 12px 8px", display: "flex", flexDirection: "column", gap: 6, borderBottom: "1px solid #1a1a22" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input ref={inputRef} value={query} placeholder="search nodes…"
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.preventDefault(); onClose(); }
              else if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, flatVisible.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
              else if (e.key === "Enter" && activeHit) { e.preventDefault(); onJump(activeHit.node.id); }
            }}
            style={{ flex: 1, minWidth: 0, background: "#16161c", border: "1px solid #2a2a3a", borderRadius: 4, color: "#e6e6e6", fontSize: 12, padding: "6px 8px", outline: "none", fontFamily: "inherit" }} />
          <SearchToggleBtn active={caseSensitive} label="Aa" title="match case" onClick={() => onCaseSensitiveChange(!caseSensitive)} />
          <SearchToggleBtn active={wholeWord} label="ab" title="match whole word" onClick={() => onWholeWordChange(!wholeWord)} />
          <SearchToggleBtn active={useRegex} label=".*" title="use regular expression" onClick={() => onUseRegexChange(!useRegex)} />
        </div>
        {invalidRegex && <span style={{ fontSize: 10, color: "#f87171" }}>invalid regular expression</span>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
          {kindsPresent.map((k) => (
            <span key={k} onClick={() => toggleKind(k)} title={`limit to ${k}`}
              style={{
                fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", padding: "1px 6px", borderRadius: 3,
                color: includeKinds.has(k) ? "#0a0a0a" : (KIND_COLOR[k] ?? "#888"),
                background: includeKinds.has(k) ? (KIND_COLOR[k] ?? "#888") : "transparent",
                border: `1px solid ${(KIND_COLOR[k] ?? "#888")}55`,
              }}>{k}</span>
          ))}
          {includeKinds.size > 0 && <span onClick={() => onIncludeKindsChange(new Set())} style={{ fontSize: 9, color: "#666", cursor: "pointer", textDecoration: "underline" }}>clear</span>}
        </div>
        <span style={{ fontSize: 10, color: "#555" }}>
          {query.trim() ? `${hits.length} result${hits.length === 1 ? "" : "s"} in ${groups.length} kind${groups.length === 1 ? "" : "s"}` : "type to search titles + content"}
        </span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0 12px" }}>
        {query.trim() && hits.length === 0 && !invalidRegex && (
          <div style={{ padding: "10px 12px", fontSize: 11, color: "#555" }}>no matches</div>
        )}
        {groups.map(([kind, kindHits]) => {
          const collapsed = collapsedGroups.has(kind);
          return (
            <div key={kind}>
              <div onClick={() => toggleGroup(kind)}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", cursor: "pointer", position: "sticky", top: 0, background: "#0b0b0fee", zIndex: 1 }}>
                <span style={{ fontSize: 9, color: "#555", width: 10 }}>{collapsed ? "▶" : "▼"}</span>
                <span style={{ fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: KIND_COLOR[kind] ?? "#888" }}>{kind}</span>
                <span style={{ fontSize: 9, color: "#444" }}>{kindHits.length}</span>
              </div>
              {!collapsed && kindHits.map((hit) => (
                <div key={hit.node.id} onClick={() => onJump(hit.node.id)} onMouseEnter={() => setActiveIdx(flatVisible.indexOf(hit))}
                  style={{ padding: "5px 12px 5px 26px", cursor: "pointer", background: hit === activeHit ? "#8a8aff14" : "transparent" }}>
                  <div style={{ fontSize: 11, color: hit.titleHit ? "#cfcfcf" : "#8a8a8a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.5 }}>
                    <Highlighted text={hit.snippet || "(untitled)"} pattern={pattern} />
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
