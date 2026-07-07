import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { deleteNode, saveNode } from "@/features/dna/lib/bookNodes";
import { byId, scenesInOrder, type DnaNode, type NodeContent, type SceneContent } from "@/features/dna/lib/novelDna";
import { diffAgainstVersion, listVersions, loadVersion, restoreVersion, snapshotTree, type TreeDiff, type TreeVersion } from "@/features/dna/lib/treeVersions";
import { nodeTitle } from "./nodeDisplay";

// ── Discard story modal ───────────────────────────────────────────────────────
type DiscardLevel = "prose" | "scenes" | "beats" | "story";
const DISCARD_OPTIONS: { level: DiscardLevel; label: string; detail: string }[] = [
  { level: "prose",  label: "prose only",         detail: "clear written prose — keep scene plans, beats, acts" },
  { level: "scenes", label: "scenes + prose",      detail: "delete all scene nodes — keep beats and acts" },
  { level: "beats",  label: "beats + scenes",      detail: "delete all beat nodes and their scenes — keep acts" },
  { level: "story",  label: "full story",          detail: "delete acts, beats, scenes and all prose — keep foundations" },
];
export function DiscardStoryModal({ nodes, onClose }: { nodes: DnaNode[]; onClose: () => void }) {
  const [level, setLevel] = useState<DiscardLevel>("prose");
  const [busy, setBusy] = useState(false);
  const mono = "ui-monospace, monospace";

  const acts = nodes.filter((n) => n.kind === "act");
  const beats     = nodes.filter((n) => n.kind === "beat");
  const scenes    = nodes.filter((n) => n.kind === "scene");

  // Prose-only is selectable per-scene: list scenes that have prose, in reading order, all picked by default.
  const proseScenes = scenesInOrder(nodes).filter((s) => (s.content as SceneContent).prose?.text?.trim());
  const [picked, setPicked] = useState<Set<string>>(() => new Set(proseScenes.map((s) => s.id)));
  const togglePick = (id: string) =>
    setPicked((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const allPicked = proseScenes.length > 0 && picked.size === proseScenes.length;
  const toggleAll = () =>
    setPicked(allPicked ? new Set() : new Set(proseScenes.map((s) => s.id)));

  const counts: Record<DiscardLevel, string> = {
    prose:  `${picked.size} of ${proseScenes.length} scenes selected`,
    scenes: `${scenes.length} scenes`,
    beats:  `${beats.length} beats · ${scenes.length} scenes`,
    story:  `${acts.length} acts · ${beats.length} beats · ${scenes.length} scenes`,
  };

  const run = async () => {
    setBusy(true);
    try {
      if (level === "prose") {
        const withProse = proseScenes.filter((s) => picked.has(s.id));
        await Promise.all(withProse.map((s) => {
          const { prose: _p, ...rest } = s.content as SceneContent;
          return saveNode({ ...s, content: rest as NodeContent });
        }));
      } else if (level === "scenes") {
        await Promise.all(scenes.map((s) => deleteNode(s.id)));
      } else if (level === "beats") {
        await Promise.all(beats.map((b) => deleteNode(b.id)));
      } else {
        await Promise.all(acts.map((m) => deleteNode(m.id)));
      }
      onClose();
    } catch (e) {
      alert(`Discard failed: ${(e as Error).message}`);
      setBusy(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ position: "absolute", inset: 0, background: "#000000aa" }} />
      <div style={{ position: "relative", background: "#0e0e12", border: "1px solid #2a2a38", borderRadius: 8, padding: "22px 24px", width: 420, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: "#c06060" }}>discard story content</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {DISCARD_OPTIONS.map((o) => (
            <label key={o.level} style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", padding: "8px 10px", borderRadius: 5, background: level === o.level ? "#1e1e2a" : "transparent", border: `1px solid ${level === o.level ? "#3a3a5a" : "transparent"}` }}>
              <input type="radio" name="discard-level" value={o.level} checked={level === o.level} onChange={() => setLevel(o.level)}
                style={{ marginTop: 2, accentColor: "#c06060", flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontFamily: mono, fontSize: 11, color: "#cfcfcf", letterSpacing: "0.04em" }}>{o.label}</div>
                  {o.level === "prose" && level === "prose" && proseScenes.length > 0 && (
                    <span onClick={(e) => { e.preventDefault(); toggleAll(); }}
                      style={{ fontFamily: mono, fontSize: 9, color: "#6a8aa0", cursor: "pointer", letterSpacing: "0.04em" }}>
                      {allPicked ? "select none" : "select all"}
                    </span>
                  )}
                </div>
                <div style={{ fontFamily: mono, fontSize: 10, color: "#555", marginTop: 2 }}>{o.detail}</div>
                {level === o.level && <div style={{ fontFamily: mono, fontSize: 9, color: "#7a3030", marginTop: 4, letterSpacing: "0.04em" }}>{counts[o.level]}</div>}
                {o.level === "prose" && level === "prose" && (
                  proseScenes.length === 0
                    ? <div style={{ fontFamily: mono, fontSize: 10, color: "#555", marginTop: 6 }}>no scenes have prose yet</div>
                    : <div style={{ marginTop: 6, maxHeight: 200, overflowY: "auto", display: "flex", flexDirection: "column", gap: 1, borderTop: "1px solid #22222e", paddingTop: 6 }}>
                        {proseScenes.map((s, i) => {
                          const sel = picked.has(s.id);
                          const words = (s.content as SceneContent).prose?.words ?? 0;
                          return (
                            <label key={s.id} onClick={(e) => { e.preventDefault(); e.stopPropagation(); togglePick(s.id); }}
                              style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 4px", borderRadius: 3, cursor: "pointer", background: sel ? "#1a1414" : "transparent" }}>
                              <input type="checkbox" checked={sel} readOnly style={{ accentColor: "#c06060", flexShrink: 0, pointerEvents: "none" }} />
                              <span style={{ fontFamily: mono, fontSize: 10, color: sel ? "#cf999c" : "#666", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {i + 1}. {nodeTitle(s) || "untitled scene"}
                              </span>
                              <span style={{ fontFamily: mono, fontSize: 9, color: "#555", flexShrink: 0 }}>{words}w</span>
                            </label>
                          );
                        })}
                      </div>
                )}
              </div>
            </label>
          ))}
        </div>
        <div style={{ display: "flex", gap: 16, justifyContent: "flex-end", paddingTop: 4 }}>
          <button onClick={onClose} disabled={busy} style={{ background: "none", border: "none", fontFamily: mono, fontSize: 11, color: "#555", cursor: "pointer", letterSpacing: "0.08em" }}>cancel</button>
          {(() => {
            const disabled = busy || (level === "prose" && picked.size === 0);
            return (
              <button onClick={() => void run()} disabled={disabled} style={{ background: "#3a1515", border: "1px solid #7a3030", borderRadius: 4, fontFamily: mono, fontSize: 11, color: disabled ? "#7a3030" : "#e07070", cursor: disabled ? "default" : "pointer", padding: "4px 14px", letterSpacing: "0.08em", opacity: disabled && !busy ? 0.5 : 1 }}>
                {busy ? "discarding…" : "discard"}
              </button>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

// ── Prose reader ─────────────────────────────────────────────────────────────
// A focused reading view for a scene's written prose, with prev/next navigation
// through all scenes that have prose (in reading order). Built on the shadcn
// Dialog (Radix) so body-scroll lock, Escape-to-close, and outside-click come
// for free instead of being hand-rolled on a fixed-position div.
export function ProseReaderModal({ sceneId, nodes, onClose, onAttachNode }: {
  sceneId: string; nodes: DnaNode[]; onClose: () => void; onAttachNode: (id: string) => void;
}) {
  const mono = "ui-monospace, monospace";
  const [currentId, setCurrentId] = useState(sceneId);
  const written = scenesInOrder(nodes).filter((s) => (s.content as SceneContent).prose?.text?.trim());
  const idx = written.findIndex((s) => s.id === currentId);
  // The opened scene may have no prose yet (e.g. opened from its header before writing);
  // fall back to showing it standalone so the reader still renders something sensible.
  const scene = idx >= 0 ? written[idx] : byId(nodes)[currentId];
  const prose = scene ? (scene.content as SceneContent).prose : undefined;
  const text = prose?.text?.trim() ?? "";
  const paragraphs = text ? text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean) : [];
  const prev = idx > 0 ? written[idx - 1] : null;
  const next = idx >= 0 && idx < written.length - 1 ? written[idx + 1] : null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[85vh] w-[min(720px,92vw)] max-w-[720px] flex-col gap-0 overflow-hidden border-[#2a2a38] bg-[#0e0e12] p-0 text-[#8a9ab0] sm:rounded-lg">
        {/* Header */}
        <div style={{ minWidth: 0, padding: "16px 40px 16px 28px", borderBottom: "1px solid #1c1c26", flexShrink: 0 }}>
          <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: "#5a6a80" }}>
            prose reader{idx >= 0 ? ` · ${idx + 1} / ${written.length}` : ""}
          </div>
          <DialogTitle className="truncate font-normal tracking-normal" style={{ fontFamily: mono, fontSize: 13, color: "#cfcfcf", marginTop: 3 }}>
            {scene ? (nodeTitle(scene) || "untitled scene") : "scene not found"}
          </DialogTitle>
        </div>
        {/* Body */}
        <div style={{ overflowY: "auto", padding: "32px 28px 40px", flex: 1 }}>
          {paragraphs.length > 0 ? (
            <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: "1.1em" }}>
              {paragraphs.map((p, i) => (
                <p key={i} style={{ margin: 0, fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 17, lineHeight: 1.7, color: "#d8d8dc" }}>{p}</p>
              ))}
            </div>
          ) : (
            <div style={{ fontFamily: mono, fontSize: 12, color: "#666", textAlign: "center", marginTop: 40 }}>no prose written for this scene yet</div>
          )}
        </div>
        {/* Footer nav */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 28px", borderTop: "1px solid #1c1c26", flexShrink: 0 }}>
          <button onClick={() => prev && setCurrentId(prev.id)} disabled={!prev}
            style={{ background: "none", border: "none", fontFamily: mono, fontSize: 11, color: prev ? "#8a9ab0" : "#333", cursor: prev ? "pointer" : "default", letterSpacing: "0.06em" }}>← prev</button>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {scene && (
              <button onClick={() => onAttachNode(scene.id)}
                style={{ background: "none", border: "none", fontFamily: mono, fontSize: 10, color: "#a8a8ff", cursor: "pointer", letterSpacing: "0.04em" }}>
                ＋ add to agent context
              </button>
            )}
            <span style={{ fontFamily: mono, fontSize: 10, color: "#555" }}>{prose?.words ? `${prose.words}w` : ""}</span>
          </div>
          <button onClick={() => next && setCurrentId(next.id)} disabled={!next}
            style={{ background: "none", border: "none", fontFamily: mono, fontSize: 11, color: next ? "#8a9ab0" : "#333", cursor: next ? "pointer" : "default", letterSpacing: "0.06em" }}>next →</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Version history ───────────────────────────────────────────────────────────
// A simple, linear "save points" history for the tree (book_tree_versions) — Notion/Docs-style, not
// git: no branches, no per-hunk staging (the agent's proposal cards already cover pre-commit review at
// op-granularity while a run is live). This is the fallback net for auto-accept mode, where the agent
// commits its own picks with no per-op review: snapshotTree() checkpoints right before auto arms
// (AgentRail.toggleAuto), and this modal shows what's changed since the last checkpoint and can restore
// an old one. Restore is forward-moving — it appends a new version, never rewrites history.
export function HistoryModal({ bookId, nodes, onClose }: { bookId: number; nodes: DnaNode[]; onClose: () => void }) {
  const mono = "ui-monospace, monospace";
  const { toast } = useToast();
  const [versions, setVersions] = useState<Omit<TreeVersion, "nodes">[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [sinceLastDiff, setSinceLastDiff] = useState<TreeDiff | null>(null);
  const [openDiffs, setOpenDiffs] = useState<Record<number, TreeDiff | "loading">>({});
  const [confirmRestoreId, setConfirmRestoreId] = useState<number | null>(null);
  const [restoringId, setRestoringId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listVersions(bookId);
      setVersions(list);
      setSinceLastDiff(list.length > 0 ? diffAgainstVersion(nodes, await loadVersion(list[0].id)) : null);
    } catch (e) {
      toast({ title: "Couldn't load version history", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, toast]);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try { await snapshotTree(bookId, label.trim() || undefined); setLabel(""); await load(); }
    catch (e) { toast({ title: "Couldn't save version", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const toggleDiff = async (id: number) => {
    if (openDiffs[id]) { setOpenDiffs((p) => { const n = { ...p }; delete n[id]; return n; }); return; }
    setOpenDiffs((p) => ({ ...p, [id]: "loading" }));
    try {
      const versionNodes = await loadVersion(id);
      setOpenDiffs((p) => ({ ...p, [id]: diffAgainstVersion(nodes, versionNodes) }));
    }
    catch (e) {
      toast({ title: "Couldn't load that version", description: String((e as Error)?.message ?? e), variant: "destructive" });
      setOpenDiffs((p) => { const n = { ...p }; delete n[id]; return n; });
    }
  };

  const restore = async (id: number) => {
    if (confirmRestoreId !== id) { setConfirmRestoreId(id); return; }
    setConfirmRestoreId(null);
    setRestoringId(id);
    try {
      await restoreVersion(bookId, id, nodes);
      await load();
      toast({ title: "Restored", description: "The tree now matches that version." });
    } catch (e) { toast({ title: "Couldn't restore", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
    finally { setRestoringId(null); }
  };

  const when = (iso: string) => { try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return iso; } };
  const diffLabel = (d: TreeDiff) => {
    const parts: string[] = [];
    if (d.added) parts.push(`+${d.added}`);
    if (d.removed) parts.push(`−${d.removed}`);
    if (d.changed) parts.push(`~${d.changed}`);
    return parts.length ? parts.join(" ") : "no changes";
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[85vh] w-[min(560px,92vw)] max-w-[560px] flex-col gap-0 overflow-hidden border-[#2a2a38] bg-[#0e0e12] p-0 text-[#8a9ab0] sm:rounded-lg">
        <div style={{ padding: "16px 24px 14px", borderBottom: "1px solid #1c1c26", flexShrink: 0 }}>
          <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: "#5a6a80" }}>history</div>
          <DialogTitle className="font-normal tracking-normal" style={{ fontFamily: mono, fontSize: 13, color: "#cfcfcf", marginTop: 3 }}>
            Tree versions
          </DialogTitle>
          {sinceLastDiff && (
            <div style={{ marginTop: 8, fontFamily: mono, fontSize: 11, color: sinceLastDiff.added + sinceLastDiff.removed + sinceLastDiff.changed > 0 ? "#d0a060" : "#555" }}>
              since last version: {diffLabel(sinceLastDiff)}
            </div>
          )}
          <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="name this version (optional)…"
              onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
              style={{ flex: 1, minWidth: 0, background: "#16161c", border: "1px solid #2a2a3a", borderRadius: 4, color: "#e6e6e6", fontSize: 12, padding: "6px 8px", outline: "none", fontFamily: "inherit" }} />
            <button onClick={() => void save()} disabled={saving}
              style={{ fontFamily: mono, fontSize: 11, letterSpacing: "0.04em", color: "#a8a8ff", background: "#8a8aff14", border: "1px solid #8a8aff44", borderRadius: 4, padding: "0 12px", cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1 }}>
              {saving ? "saving…" : "save version"}
            </button>
          </div>
        </div>
        <div style={{ overflowY: "auto", padding: "6px 0 14px", flex: 1 }}>
          {loading && <div style={{ padding: "16px 24px", fontFamily: mono, fontSize: 11, color: "#555" }}>loading…</div>}
          {!loading && versions.length === 0 && (
            <div style={{ padding: "16px 24px", fontFamily: mono, fontSize: 11, color: "#555" }}>
              No saved versions yet. Versions checkpoint automatically when auto-accept arms, or save one above.
            </div>
          )}
          {versions.map((v) => {
            const d = openDiffs[v.id];
            return (
              <div key={v.id} style={{ padding: "8px 24px", borderBottom: "1px solid #1a1a22" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontFamily: mono, fontSize: 12, color: v.label ? "#cfcfcf" : "#8a8a8a", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {v.label ?? "auto checkpoint"}
                  </span>
                  <span style={{ fontFamily: mono, fontSize: 10, color: "#555" }}>{when(v.created_at)}</span>
                </div>
                <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 12 }}>
                  <button onClick={() => void toggleDiff(v.id)} style={{ background: "none", border: "none", fontFamily: mono, fontSize: 10, color: "#666", cursor: "pointer", padding: 0 }}>
                    {d ? (d === "loading" ? "loading…" : diffLabel(d)) : "diff vs. live"}
                  </button>
                  <button onClick={() => void restore(v.id)} disabled={restoringId === v.id}
                    style={{ background: "none", border: "none", fontFamily: mono, fontSize: 10, color: confirmRestoreId === v.id ? "#f87171" : "#8a9ab0", cursor: "pointer", padding: 0 }}>
                    {restoringId === v.id ? "restoring…" : confirmRestoreId === v.id ? "confirm restore?" : "restore"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
