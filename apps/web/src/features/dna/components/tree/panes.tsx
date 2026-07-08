// Read-only tab panes: StoryPane (the assembled manuscript) and CharactersPane
// (the cast dossier). Projections of the tree; each deep-links back for editing.
import { scenesInOrder, type DnaNode, type SceneContent } from "@/features/dna/lib/novelDna";
import { KIND_COLOR, MONO, SERIF, T } from "./treeChrome";
import { nodeTitle } from "./nodeDisplay";

// ── Story pane ────────────────────────────────────────────────────────────────
// The assembled manuscript: every scene's prose, in reading order, as one continuous read (what the
// ProseReaderModal shows one scene at a time — here it's the whole book). Read-only projection of the
// tree; each scene divider deep-links back to the scene for editing. The two OUTPUT verbs (render pages /
// open the reader) live here — this is the "story output" scope.
export function StoryPane({ nodes, onJump, onRender, onRead, rendering }: {
  nodes: DnaNode[]; onJump: (id: string) => void;
  onRender: () => void; onRead: () => void; rendering: "render" | "read" | null;
}) {
  const mono = MONO;
  const written = scenesInOrder(nodes).filter((s) => (s.content as SceneContent).prose?.text?.trim());
  const totalWords = written.reduce((sum, s) => sum + ((s.content as SceneContent).prose?.words ?? 0), 0);
  const btn: React.CSSProperties = { background: "none", border: `1px solid ${T.border}`, borderRadius: 5, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", padding: "4px 10px", fontFamily: mono, cursor: rendering ? "default" : "pointer", color: rendering ? T.faint : T.accent };
  return (
    <div style={{ padding: "24px 16px 96px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, maxWidth: 680, margin: "0 auto 32px" }}>
        <span style={{ fontFamily: mono, fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: T.muted }}>
          {written.length} {written.length === 1 ? "scene" : "scenes"} · {totalWords.toLocaleString()} words
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={onRender} disabled={!!rendering} style={btn}>{rendering === "render" ? "rendering…" : "render pages →"}</button>
          <button onClick={onRead} disabled={!!rendering} style={btn}>{rendering === "read" ? "rendering…" : "read in reader →"}</button>
        </div>
      </div>
      {written.length === 0 ? (
        <div style={{ fontFamily: mono, fontSize: 12, color: T.muted, textAlign: "center", marginTop: 64 }}>
          No prose yet — write scenes in the tree, then they'll flow together here.
        </div>
      ) : (
        <div style={{ maxWidth: 680, margin: "0 auto", display: "flex", flexDirection: "column", gap: "2.6em" }}>
          {written.map((s) => {
            const prose = (s.content as SceneContent).prose;
            const paragraphs = (prose?.text ?? "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
            return (
              <section key={s.id}>
                <div onClick={() => onJump(s.id)} title="edit this scene in the tree"
                  style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: T.muted, cursor: "pointer", marginBottom: "1.2em", borderBottom: `1px solid ${T.borderSoft}`, paddingBottom: 6 }}>
                  {nodeTitle(s) || "untitled scene"} →
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "1.1em" }}>
                  {paragraphs.map((p, i) => (
                    <p key={i} style={{ margin: 0, fontFamily: SERIF, fontSize: 17, lineHeight: 1.7, color: T.ink }}>{p}</p>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Characters pane ───────────────────────────────────────────────────────────
// The cast dossier: a read view of the character + relationship entity nodes (schema §4). Read-only —
// the tree stays the edit surface; each card deep-links to its node. Same pattern as Analytics: a curated
// projection, not a second editor.
export function CharactersPane({ nodes, index, onJump }: {
  nodes: DnaNode[]; index: Map<string, DnaNode>; onJump: (id: string) => void;
}) {
  const mono = MONO;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");
  const cast = nodes.filter((n) => n.kind === "character");
  const rels = nodes.filter((n) => n.kind === "relationship");
  const accent = KIND_COLOR["character"] ?? T.muted;
  const Field = ({ label, val }: { label: string; val: string }) => val ? (
    <div style={{ display: "flex", gap: 8, fontSize: 12, lineHeight: 1.5 }}>
      <span style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: T.muted, width: 46, flexShrink: 0, paddingTop: 3 }}>{label}</span>
      <span style={{ fontFamily: SERIF, fontSize: 13.5, color: T.inkSoft }}>{val}</span>
    </div>
  ) : null;

  if (cast.length === 0 && rels.length === 0) {
    return <div style={{ fontFamily: mono, fontSize: 12, color: T.muted, textAlign: "center", marginTop: 64 }}>No cast yet — add characters in the tree.</div>;
  }
  return (
    <div style={{ padding: "24px 16px 96px", maxWidth: 940, margin: "0 auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 14 }}>
        {cast.map((ch) => {
          const c = ch.content as Record<string, unknown>;
          return (
            <div key={ch.id} onClick={() => onJump(ch.id)} title="edit in the tree"
              style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: "14px 16px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 7, background: T.raised }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = `${accent}55`; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = T.border; }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 2 }}>
                <span style={{ fontFamily: SERIF, fontSize: 17, color: T.ink }}>{str(c.name) || "unnamed"}</span>
                {str(c.role) && <span style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase", color: accent }}>{str(c.role)}</span>}
                {str(c.tag) && <span style={{ marginLeft: "auto", fontFamily: mono, fontSize: 9.5, color: T.faint }}>{str(c.tag)}</span>}
              </div>
              <Field label="want" val={str(c.want)} />
              <Field label="need" val={str(c.need)} />
              <Field label="wound" val={str(c.wound)} />
              <Field label="lie" val={str(c.lie)} />
              <Field label="truth" val={str(c.truth)} />
              <Field label="voice" val={str(c.idiolect)} />
            </div>
          );
        })}
      </div>
      {rels.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: T.muted, marginBottom: 12 }}>relationships</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rels.map((r) => {
              const c = r.content as Record<string, unknown>;
              const a = typeof c.a === "string" ? index.get(c.a) : undefined;
              const b = typeof c.b === "string" ? index.get(c.b) : undefined;
              return (
                <div key={r.id} onClick={() => onJump(r.id)} title="edit in the tree"
                  style={{ border: `1px solid ${T.border}`, borderRadius: 6, padding: "10px 14px", cursor: "pointer", fontFamily: SERIF, fontSize: 14, lineHeight: 1.5, color: T.inkSoft }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = `${accent}44`; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = T.border; }}>
                  <span style={{ color: T.ink }}>{a ? nodeTitle(a) || "?" : "?"}</span>
                  <span style={{ color: accent, margin: "0 8px" }}>↔</span>
                  <span style={{ color: T.ink }}>{b ? nodeTitle(b) || "?" : "?"}</span>
                  {str(c.bond) && <span style={{ color: T.muted }}> — {str(c.bond)}</span>}
                  {str(c.charge) && <span style={{ color: T.faint, marginLeft: 8, fontFamily: mono, fontSize: 10 }}>({str(c.charge)})</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
