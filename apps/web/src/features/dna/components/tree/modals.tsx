import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { deleteNode, saveNode } from "@/features/dna/lib/bookNodes";
import { byId, scenesInOrder, type DnaNode, type NodeContent, type SceneContent } from "@/features/dna/lib/novelDna";
import { diffAgainstVersion, listVersions, loadVersion, restoreVersion, snapshotTree, type TreeDiff, type TreeVersion } from "@/features/dna/lib/treeVersions";
import { nodeTitle } from "./nodeDisplay";
import { MONO, SERIF, T } from "./treeChrome";

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
  const mono = MONO;

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
      <div style={{ position: "absolute", inset: 0, background: "rgba(31,29,24,0.35)" }} />
      <div style={{ position: "relative", background: T.raised, border: `1px solid ${T.border}`, borderRadius: 10, padding: "22px 24px", width: 420, display: "flex", flexDirection: "column", gap: 16, boxShadow: T.shadow }}>
        <div style={{ fontFamily: mono, fontSize: 10.5, letterSpacing: "0.2em", textTransform: "uppercase", color: T.bad }}>discard story content</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {DISCARD_OPTIONS.map((o) => (
            <label key={o.level} style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", padding: "8px 10px", borderRadius: 5, background: level === o.level ? T.surface : "transparent", border: `1px solid ${level === o.level ? T.border : "transparent"}` }}>
              <input type="radio" name="discard-level" value={o.level} checked={level === o.level} onChange={() => setLevel(o.level)}
                style={{ marginTop: 2, accentColor: T.bad, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontFamily: mono, fontSize: 11.5, color: T.ink, letterSpacing: "0.04em" }}>{o.label}</div>
                  {o.level === "prose" && level === "prose" && proseScenes.length > 0 && (
                    <span onClick={(e) => { e.preventDefault(); toggleAll(); }}
                      style={{ fontFamily: mono, fontSize: 9.5, color: T.accent, cursor: "pointer", letterSpacing: "0.04em" }}>
                      {allPicked ? "select none" : "select all"}
                    </span>
                  )}
                </div>
                <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 2 }}>{o.detail}</div>
                {level === o.level && <div style={{ fontFamily: mono, fontSize: 9.5, color: T.bad, marginTop: 4, letterSpacing: "0.04em" }}>{counts[o.level]}</div>}
                {o.level === "prose" && level === "prose" && (
                  proseScenes.length === 0
                    ? <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 6 }}>no scenes have prose yet</div>
                    : <div style={{ marginTop: 6, maxHeight: 200, overflowY: "auto", display: "flex", flexDirection: "column", gap: 1, borderTop: `1px solid ${T.borderSoft}`, paddingTop: 6 }}>
                        {proseScenes.map((s, i) => {
                          const sel = picked.has(s.id);
                          const words = (s.content as SceneContent).prose?.words ?? 0;
                          return (
                            <label key={s.id} onClick={(e) => { e.preventDefault(); e.stopPropagation(); togglePick(s.id); }}
                              style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 4px", borderRadius: 3, cursor: "pointer", background: sel ? `${T.bad}0d` : "transparent" }}>
                              <input type="checkbox" checked={sel} readOnly style={{ accentColor: T.bad, flexShrink: 0, pointerEvents: "none" }} />
                              <span style={{ fontFamily: mono, fontSize: 10, color: sel ? T.remove : T.muted, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {i + 1}. {nodeTitle(s) || "untitled scene"}
                              </span>
                              <span style={{ fontFamily: mono, fontSize: 9.5, color: T.faint, flexShrink: 0 }}>{words}w</span>
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
          <button onClick={onClose} disabled={busy} style={{ background: "none", border: "none", fontFamily: mono, fontSize: 11, color: T.muted, cursor: "pointer", letterSpacing: "0.08em" }}>cancel</button>
          {(() => {
            const disabled = busy || (level === "prose" && picked.size === 0);
            return (
              <button onClick={() => void run()} disabled={disabled} style={{ background: `${T.bad}0d`, border: `1px solid ${T.bad}66`, borderRadius: 4, fontFamily: mono, fontSize: 11, color: disabled ? `${T.bad}88` : T.bad, cursor: disabled ? "default" : "pointer", padding: "4px 14px", letterSpacing: "0.08em", opacity: disabled && !busy ? 0.5 : 1 }}>
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
  const mono = MONO;
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
      <DialogContent className="flex max-h-[85vh] w-[min(720px,92vw)] max-w-[720px] flex-col gap-0 overflow-hidden p-0 sm:rounded-lg" style={{ background: T.raised, borderColor: T.border, color: T.muted }}>
        {/* Header */}
        <div style={{ minWidth: 0, padding: "16px 40px 16px 28px", borderBottom: `1px solid ${T.borderSoft}`, flexShrink: 0 }}>
          <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: T.muted }}>
            prose reader{idx >= 0 ? ` · ${idx + 1} / ${written.length}` : ""}
          </div>
          <DialogTitle className="truncate font-normal tracking-normal" style={{ fontFamily: SERIF, fontSize: 16, color: T.ink, marginTop: 3 }}>
            {scene ? (nodeTitle(scene) || "untitled scene") : "scene not found"}
          </DialogTitle>
        </div>
        {/* Body */}
        <div style={{ overflowY: "auto", padding: "32px 28px 40px", flex: 1 }}>
          {paragraphs.length > 0 ? (
            <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: "1.1em" }}>
              {paragraphs.map((p, i) => (
                <p key={i} style={{ margin: 0, fontFamily: SERIF, fontSize: 17, lineHeight: 1.7, color: T.ink }}>{p}</p>
              ))}
            </div>
          ) : (
            <div style={{ fontFamily: mono, fontSize: 12, color: T.muted, textAlign: "center", marginTop: 40 }}>no prose written for this scene yet</div>
          )}
        </div>
        {/* Footer nav */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 28px", borderTop: `1px solid ${T.borderSoft}`, flexShrink: 0 }}>
          <button onClick={() => prev && setCurrentId(prev.id)} disabled={!prev}
            style={{ background: "none", border: "none", fontFamily: mono, fontSize: 11, color: prev ? T.accent : T.faint, cursor: prev ? "pointer" : "default", letterSpacing: "0.06em" }}>← prev</button>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {scene && (
              <button onClick={() => onAttachNode(scene.id)}
                style={{ background: "none", border: "none", fontFamily: mono, fontSize: 10, color: T.accent, cursor: "pointer", letterSpacing: "0.04em" }}>
                ＋ add to agent context
              </button>
            )}
            <span style={{ fontFamily: mono, fontSize: 10, color: T.faint }}>{prose?.words ? `${prose.words}w` : ""}</span>
          </div>
          <button onClick={() => next && setCurrentId(next.id)} disabled={!next}
            style={{ background: "none", border: "none", fontFamily: mono, fontSize: 11, color: next ? T.accent : T.faint, cursor: next ? "pointer" : "default", letterSpacing: "0.06em" }}>next →</button>
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
  const mono = MONO;
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
      <DialogContent className="flex max-h-[85vh] w-[min(560px,92vw)] max-w-[560px] flex-col gap-0 overflow-hidden p-0 sm:rounded-lg" style={{ background: T.raised, borderColor: T.border, color: T.muted }}>
        <div style={{ padding: "16px 24px 14px", borderBottom: `1px solid ${T.borderSoft}`, flexShrink: 0 }}>
          <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: T.muted }}>history</div>
          <DialogTitle className="font-normal tracking-normal" style={{ fontFamily: SERIF, fontSize: 16, color: T.ink, marginTop: 3 }}>
            Tree versions
          </DialogTitle>
          {sinceLastDiff && (
            <div style={{ marginTop: 8, fontFamily: mono, fontSize: 11, color: sinceLastDiff.added + sinceLastDiff.removed + sinceLastDiff.changed > 0 ? T.warn : T.muted }}>
              since last version: {diffLabel(sinceLastDiff)}
            </div>
          )}
          <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="name this version (optional)…"
              onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
              style={{ flex: 1, minWidth: 0, background: T.inputBg, border: `1px solid ${T.border}`, borderRadius: 6, color: T.ink, fontSize: 12, padding: "6px 8px", outline: "none", fontFamily: "inherit" }} />
            <button onClick={() => void save()} disabled={saving}
              style={{ fontFamily: mono, fontSize: 11, letterSpacing: "0.04em", color: T.accent, background: `${T.accent}0d`, border: `1px solid ${T.accent}44`, borderRadius: 4, padding: "0 12px", cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1 }}>
              {saving ? "saving…" : "save version"}
            </button>
          </div>
        </div>
        <div style={{ overflowY: "auto", padding: "6px 0 14px", flex: 1 }}>
          {loading && <div style={{ padding: "16px 24px", fontFamily: mono, fontSize: 11, color: T.muted }}>loading…</div>}
          {!loading && versions.length === 0 && (
            <div style={{ padding: "16px 24px", fontFamily: mono, fontSize: 11, color: T.muted }}>
              No saved versions yet. Versions checkpoint automatically when auto-accept arms, or save one above.
            </div>
          )}
          {versions.map((v) => {
            const d = openDiffs[v.id];
            return (
              <div key={v.id} style={{ padding: "8px 24px", borderBottom: `1px solid ${T.borderSoft}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontFamily: mono, fontSize: 12, color: v.label ? T.ink : T.muted, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {v.label ?? "auto checkpoint"}
                  </span>
                  <span style={{ fontFamily: mono, fontSize: 10, color: T.faint }}>{when(v.created_at)}</span>
                </div>
                <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 12 }}>
                  <button onClick={() => void toggleDiff(v.id)} style={{ background: "none", border: "none", fontFamily: mono, fontSize: 10, color: T.muted, cursor: "pointer", padding: 0 }}>
                    {d ? (d === "loading" ? "loading…" : diffLabel(d)) : "diff vs. live"}
                  </button>
                  <button onClick={() => void restore(v.id)} disabled={restoringId === v.id}
                    style={{ background: "none", border: "none", fontFamily: mono, fontSize: 10, color: confirmRestoreId === v.id ? T.bad : T.accent, cursor: "pointer", padding: 0 }}>
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

// ── Node details ─────────────────────────────────────────────────────────────
// "view details" (kebab menu): authoring provenance for one node — who/what wrote its current content,
// and if the AI did, the exact model + prompt + raw completion behind it (book_nodes.last_ai_call_id →
// ai_calls, mirroring pages.last_ai_call_id's admin lineage). Only set for content committed through the
// dna-expand engine (logline/sketch/prose/beatsheet/contract/children) — see 20260707140000 migration;
// content the book-agent chat authors directly (propose_node_ops/propose_options) has no link yet.
interface AiCallDetail {
  id: number; created_at: string; fn: string; source: string; model: string | null;
  system: string | null; input: unknown; output: string | null;
  input_tokens: number | null; output_tokens: number | null; latency_ms: number | null;
}

// The logged `input` is a messages array; flatten it back to readable text (mirrors admin/AiCalls.tsx).
function flattenInput(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return input;
  if (!Array.isArray(input)) return JSON.stringify(input, null, 2);
  return (input as Array<{ content?: unknown }>)
    .map((m) => {
      const c = m?.content;
      if (typeof c === "string") return c;
      if (Array.isArray(c)) return c.map((b) => (typeof b === "string" ? b : (b as { text?: string })?.text ?? "")).join("\n");
      return "";
    })
    .join("\n\n");
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const mono = MONO;
  if (!text.trim()) return null;
  return (
    <div style={{ borderTop: `1px solid ${T.borderSoft}`, paddingTop: 10, marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span onClick={() => setOpen((v) => !v)} style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: T.muted, cursor: "pointer", userSelect: "none" }}>
          {open ? "▾" : "▸"} {label} ({text.length.toLocaleString()} chars)
        </span>
        <span onClick={() => { void navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
          style={{ fontFamily: mono, fontSize: 9.5, color: copied ? T.good : T.muted, cursor: "pointer", letterSpacing: "0.04em" }}>
          {copied ? "copied" : "copy"}
        </span>
      </div>
      {open && (
        <pre style={{ marginTop: 8, maxHeight: 260, overflow: "auto", fontFamily: mono, fontSize: 11, lineHeight: 1.5, color: T.inkSoft, whiteSpace: "pre-wrap", wordBreak: "break-word", background: T.surface, border: `1px solid ${T.borderSoft}`, borderRadius: 4, padding: 10 }}>
          {text}
        </pre>
      )}
    </div>
  );
}

export function NodeDetailsModal({ node, onClose }: { node: DnaNode; onClose: () => void }) {
  const mono = MONO;
  const [call, setCall] = useState<AiCallDetail | null | "loading" | "error">(node.last_ai_call_id ? "loading" : null);

  useEffect(() => {
    if (!node.last_ai_call_id) { setCall(null); return; }
    let alive = true;
    setCall("loading");
    supabase.from("ai_calls")
      .select("id, created_at, fn, source, model, system, input, output, input_tokens, output_tokens, latency_ms")
      .eq("id", node.last_ai_call_id).maybeSingle()
      .then(({ data, error }) => { if (alive) setCall(error || !data ? "error" : (data as AiCallDetail)); });
    return () => { alive = false; };
  }, [node.last_ai_call_id]);

  const when = (iso: string) => { try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return iso; } };
  const a = node.authoring;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[85vh] w-[min(640px,92vw)] max-w-[640px] flex-col gap-0 overflow-hidden p-0 sm:rounded-lg" style={{ background: T.raised, borderColor: T.border, color: T.muted }}>
        <div style={{ padding: "16px 24px 14px", borderBottom: `1px solid ${T.borderSoft}`, flexShrink: 0 }}>
          <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: T.muted }}>view details · {node.kind}</div>
          <DialogTitle className="truncate font-normal tracking-normal" style={{ fontFamily: SERIF, fontSize: 16, color: T.ink, marginTop: 3 }}>
            {nodeTitle(node) || "untitled"}
          </DialogTitle>
        </div>
        <div style={{ overflowY: "auto", padding: "16px 24px 22px", flex: 1 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", fontFamily: mono, fontSize: 11 }}>
            <span style={{ color: T.muted }}>source: <span style={{ color: T.inkSoft }}>{a.source}</span></span>
            <span style={{ color: T.muted }}>status: <span style={{ color: T.inkSoft }}>{a.status}</span></span>
            {a.locked && <span style={{ color: T.warn }}>🔒 locked</span>}
          </div>

          {call === null && (
            <div style={{ marginTop: 14, fontFamily: mono, fontSize: 11, color: T.muted }}>
              {a.source === "user" ? "Written by hand — no AI call." : "No AI call linked — either hand-edited, or authored directly by the agent chat (not yet wired to this panel)."}
            </div>
          )}
          {call === "loading" && <div style={{ marginTop: 14, fontFamily: mono, fontSize: 11, color: T.muted }}>loading the generating call…</div>}
          {call === "error" && <div style={{ marginTop: 14, fontFamily: mono, fontSize: 11, color: T.bad }}>couldn't load ai_calls #{node.last_ai_call_id} (deleted, or you lack access).</div>}
          {call && typeof call === "object" && (
            <>
              <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: "6px 18px", fontFamily: mono, fontSize: 11 }}>
                <span style={{ color: T.muted }}>model: <span style={{ color: T.accent }}>{call.model ?? "?"}</span></span>
                <span style={{ color: T.muted }}>pass: <span style={{ color: T.inkSoft }}>{call.fn}</span></span>
                <span style={{ color: T.muted }}>when: <span style={{ color: T.inkSoft }}>{when(call.created_at)}</span></span>
                {call.latency_ms != null && <span style={{ color: T.muted }}>latency: <span style={{ color: T.inkSoft }}>{(call.latency_ms / 1000).toFixed(1)}s</span></span>}
                {(call.input_tokens != null || call.output_tokens != null) && (
                  <span style={{ color: T.muted }}>tokens: <span style={{ color: T.inkSoft }}>{call.input_tokens ?? "?"} in / {call.output_tokens ?? "?"} out</span></span>
                )}
              </div>
              <CopyBlock label="prompt" text={[call.system, flattenInput(call.input)].filter(Boolean).join("\n\n---\n\n")} />
              <CopyBlock label="raw output" text={call.output ?? ""} />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
