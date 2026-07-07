// Read-only tab panes: StoryPane (the assembled manuscript) and CharactersPane
// (the cast dossier). Projections of the tree; each deep-links back for editing.
import { scenesInOrder, type DnaNode, type SceneContent } from "@/features/dna/lib/novelDna";
import { KIND_COLOR } from "./treeChrome";
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
  const mono = "ui-monospace, monospace";
  const written = scenesInOrder(nodes).filter((s) => (s.content as SceneContent).prose?.text?.trim());
  const totalWords = written.reduce((sum, s) => sum + ((s.content as SceneContent).prose?.words ?? 0), 0);
  const btn: React.CSSProperties = { background: "none", border: "1px solid #2a2a2a", borderRadius: 5, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", padding: "4px 10px", fontFamily: mono, cursor: rendering ? "default" : "pointer", color: rendering ? "#444" : "#8a9ab0" };
  return (
    <div style={{ padding: "24px 16px 96px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, maxWidth: 680, margin: "0 auto 32px" }}>
        <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#5a6a80" }}>
          {written.length} {written.length === 1 ? "scene" : "scenes"} · {totalWords.toLocaleString()} words
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={onRender} disabled={!!rendering} style={btn}>{rendering === "render" ? "rendering…" : "render pages →"}</button>
          <button onClick={onRead} disabled={!!rendering} style={btn}>{rendering === "read" ? "rendering…" : "read in reader →"}</button>
        </div>
      </div>
      {written.length === 0 ? (
        <div style={{ fontFamily: mono, fontSize: 12, color: "#555", textAlign: "center", marginTop: 64 }}>
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
                  style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: "#4a5a6a", cursor: "pointer", marginBottom: "1.2em", borderBottom: "1px solid #16161c", paddingBottom: 6 }}>
                  {nodeTitle(s) || "untitled scene"} →
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "1.1em" }}>
                  {paragraphs.map((p, i) => (
                    <p key={i} style={{ margin: 0, fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 17, lineHeight: 1.7, color: "#d8d8dc" }}>{p}</p>
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
  const mono = "ui-monospace, monospace";
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");
  const cast = nodes.filter((n) => n.kind === "character");
  const rels = nodes.filter((n) => n.kind === "relationship");
  const accent = KIND_COLOR["character"] ?? "#c084fc";
  const Field = ({ label, val }: { label: string; val: string }) => val ? (
    <div style={{ display: "flex", gap: 8, fontSize: 12, lineHeight: 1.5 }}>
      <span style={{ fontFamily: mono, fontSize: 8.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "#556", width: 46, flexShrink: 0, paddingTop: 3 }}>{label}</span>
      <span style={{ color: "#b8b8c2" }}>{val}</span>
    </div>
  ) : null;

  if (cast.length === 0 && rels.length === 0) {
    return <div style={{ fontFamily: mono, fontSize: 12, color: "#555", textAlign: "center", marginTop: 64 }}>No cast yet — add characters in the tree.</div>;
  }
  return (
    <div style={{ padding: "24px 16px 96px", maxWidth: 940, margin: "0 auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 14 }}>
        {cast.map((ch) => {
          const c = ch.content as Record<string, unknown>;
          return (
            <div key={ch.id} onClick={() => onJump(ch.id)} title="edit in the tree"
              style={{ border: "1px solid #1c1c24", borderRadius: 8, padding: "14px 16px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 7, background: "#0d0d12" }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = `${accent}55`; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#1c1c24"; }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 2 }}>
                <span style={{ fontFamily: "Georgia, serif", fontSize: 16, color: "#e4e4ea" }}>{str(c.name) || "unnamed"}</span>
                {str(c.role) && <span style={{ fontFamily: mono, fontSize: 8.5, letterSpacing: "0.14em", textTransform: "uppercase", color: accent }}>{str(c.role)}</span>}
                {str(c.tag) && <span style={{ marginLeft: "auto", fontFamily: mono, fontSize: 9, color: "#556" }}>{str(c.tag)}</span>}
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
          <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: "#4a5a6a", marginBottom: 12 }}>relationships</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rels.map((r) => {
              const c = r.content as Record<string, unknown>;
              const a = typeof c.a === "string" ? index.get(c.a) : undefined;
              const b = typeof c.b === "string" ? index.get(c.b) : undefined;
              return (
                <div key={r.id} onClick={() => onJump(r.id)} title="edit in the tree"
                  style={{ border: "1px solid #1c1c24", borderRadius: 6, padding: "10px 14px", cursor: "pointer", fontSize: 12, lineHeight: 1.5, color: "#b8b8c2" }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = `${accent}44`; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#1c1c24"; }}>
                  <span style={{ color: "#e4e4ea" }}>{a ? nodeTitle(a) || "?" : "?"}</span>
                  <span style={{ color: accent, margin: "0 8px" }}>↔</span>
                  <span style={{ color: "#e4e4ea" }}>{b ? nodeTitle(b) || "?" : "?"}</span>
                  {str(c.bond) && <span style={{ color: "#8a8a96" }}> — {str(c.bond)}</span>}
                  {str(c.charge) && <span style={{ color: "#556", marginLeft: 8, fontFamily: mono, fontSize: 10 }}>({str(c.charge)})</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
