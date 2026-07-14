import { useEffect, useRef, useState } from "react";
import { CONTENT_TYPES, SCOPE_BANDS, briefIdea, type Brief, type BriefVision } from "@/lib/brief";
import { ConnectorTick, detailRowStyle, inputStyle, KIND_COLOR, labelStyle, MONO, SERIF, T } from "./treeChrome";

// ── Brief section — rendered inside the seed when expanded ───────────────────
// The brief lives on books.brief (not in book_nodes), so it has its own save path.
// Fields: genre, audience, tone, success_criteria, scope.word_target, content_type.level.
// The seed's logline field (book_nodes.content.logline) is the prose distillation;
// these are the publishing/mandate fields the whole generation stack derives from.
function BriefFieldRow({ label, depth, display, onEdit, children }: {
  label: string; depth: number; display: React.ReactNode; onEdit?: () => void; children?: React.ReactNode;
}) {
  return (
    <div style={detailRowStyle(depth)} onClick={(e) => e.stopPropagation()}>
      <ConnectorTick depth={depth} />
      <span style={{ width: 12, flexShrink: 0 }} />
      <span style={labelStyle}>{label}</span>
      {children || (
        <span onClick={onEdit} style={{ fontFamily: SERIF, fontSize: 14, color: display ? T.ink : T.faint, whiteSpace: "pre-wrap", wordBreak: "break-word", flex: 1, lineHeight: 1.55, cursor: onEdit ? "text" : "default", fontStyle: display ? "normal" : "italic" }}>
          {display || `＋ ${label}`}
        </span>
      )}
    </div>
  );
}

function BriefSection({ brief, onSave, depth, onCollapse }: { brief: Brief | null; onSave: (patch: Partial<Brief>) => Promise<void>; depth: number; onCollapse?: () => void }) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  useEffect(() => { if (editingField) inputRef.current?.focus(); }, [editingField]);

  const commit = async (field: string, value: unknown) => {
    setBusy(true);
    setEditingField(null);
    try {
      if (field === "word_target") await onSave({ scope: { ...brief?.scope, word_target: value as number } });
      else if (field === "heat") await onSave({ content_type: { ...brief?.content_type, level: value as Brief["content_type"] extends { level?: infer L } | undefined ? L : never } });
      else await onSave({ [field]: value });
    } catch (e) { alert(`Save failed: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  const startEdit = (field: string, current: string) => { setDraft(current); setEditingField(field); };
  const commonProps = (field: string, multiline?: boolean) => ({
    ref: inputRef as never, value: draft, disabled: busy,
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => setDraft(e.target.value),
    onBlur: () => { void commit(field, multiline ? draft.trim() : draft.trim()); },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); setEditingField(null); }
      else if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); void commit(field, draft.trim()); }
    },
    style: { ...inputStyle, flex: 1, resize: "vertical" as const },
  });

  const toneArr = Array.isArray(brief?.tone) ? brief.tone : [];
  const heatLabel = CONTENT_TYPES.find((c) => c.value === brief?.content_type?.level)?.label ?? "";
  const bandLabel = SCOPE_BANDS.find((b) => b.value === brief?.scope?.band)?.label ?? "";

  return (
    <>
      <div style={{ ...detailRowStyle(depth - 1), paddingTop: 6, cursor: onCollapse ? "pointer" : "default" }}
        onClick={onCollapse} title={onCollapse ? "collapse — the brief is reference, not active work, once foundations are underway" : undefined}>
        <ConnectorTick depth={depth - 1} />
        <span style={{ width: 12, flexShrink: 0 }} />
        {onCollapse && <span style={{ fontSize: 9, color: T.muted, marginRight: 2 }}>▾</span>}
        <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: T.accent }}>brief — mandate · the constant origin</span>
      </div>

      {/* idea — the author's raw "what is the book about?" (brief.idea); the logline is DERIVED from this, not equal to it */}
      <BriefFieldRow label="idea" depth={depth} display={briefIdea(brief)} onEdit={() => startEdit("idea", briefIdea(brief) ?? "")}>
        {editingField === "idea" && <textarea rows={Math.min(6, Math.max(2, draft.split("\n").length))} {...commonProps("idea", true)} />}
      </BriefFieldRow>

      {/* genre */}
      <BriefFieldRow label="genre" depth={depth} display={brief?.genre} onEdit={() => startEdit("genre", brief?.genre ?? "")}>
        {editingField === "genre" && <input {...commonProps("genre")} />}
      </BriefFieldRow>

      {/* audience */}
      <BriefFieldRow label="audience" depth={depth} display={brief?.audience} onEdit={() => startEdit("audience", brief?.audience ?? "")}>
        {editingField === "audience" && <input {...commonProps("audience")} />}
      </BriefFieldRow>

      {/* tone — comma-sep list */}
      <BriefFieldRow label="tone" depth={depth} display={toneArr.join(", ")} onEdit={() => startEdit("tone", toneArr.join(", "))}>
        {editingField === "tone" && (
          <input {...commonProps("tone")} onBlur={() => { void commit("tone", draft.split(",").map((s) => s.trim()).filter(Boolean)); }} style={{ ...inputStyle, flex: 1 }} />
        )}
      </BriefFieldRow>

      {/* success_criteria */}
      <BriefFieldRow label="success criteria" depth={depth} display={brief?.success_criteria} onEdit={() => startEdit("success_criteria", brief?.success_criteria ?? "")}>
        {editingField === "success_criteria" && <textarea rows={3} {...commonProps("success_criteria", true)} />}
      </BriefFieldRow>

      {/* scope.word_target */}
      <BriefFieldRow label="word target" depth={depth} display={brief?.scope?.word_target ? `${brief.scope.word_target.toLocaleString()} words${bandLabel ? ` · ${bandLabel}` : ""}` : bandLabel} onEdit={() => startEdit("word_target", String(brief?.scope?.word_target ?? ""))}>
        {editingField === "word_target" && (
          <input type="number" {...commonProps("word_target")} onBlur={() => { const n = parseInt(draft); void commit("word_target", isNaN(n) ? undefined : n); }} style={{ ...inputStyle, flex: 1 }} />
        )}
      </BriefFieldRow>

      {/* content_type.level — select */}
      <div style={detailRowStyle(depth)} onClick={(e) => e.stopPropagation()}>
        <ConnectorTick depth={depth} />
        <span style={{ width: 12, flexShrink: 0 }} />
        <span style={labelStyle}>heat</span>
        <select value={brief?.content_type?.level ?? ""} disabled={busy}
          onChange={(e) => { void commit("heat", e.target.value || undefined); }}
          style={{ ...inputStyle, fontSize: 11, padding: "1px 4px", width: 200, flexShrink: 0 }}>
          <option value="">(not set)</option>
          {CONTENT_TYPES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>
    </>
  );
}

// ── Vision — the interview's artifact ────────────────────────────────────────
// brief.vision is what the agent's `update_vision` tool captures during the discovery interview (the
// premise stage's first rung), in the AUTHOR's own words. It already had two MACHINE consumers — the
// journey's done-gate (dnaJourney: compiled_at/skipped advances Interview → Seed) and the generation
// prompt (_shared/brief.ts, opts.vision) — but no human one, so it read as write-only: the author
// answered the interview and never saw their answers again. This is the read/edit surface. Editing is
// hand-authoring over the agent's capture; each section replaces that section wholesale, exactly as
// update_vision does. compiled_at / skipped are status, not fields — shown, never edited here.
const VISION_SECTIONS: { key: keyof BriefVision; label: string }[] = [
  { key: "characters", label: "characters" },
  { key: "world_setting", label: "world / setting" },
  { key: "plot_points", label: "plot points" },
  { key: "themes_aims", label: "themes / aims" },
  { key: "influences", label: "influences" },
  { key: "constraints", label: "constraints" },
  { key: "open_questions", label: "open questions" },
  { key: "notes", label: "notes" },
];

function visionStatus(vision: BriefVision | undefined): string {
  const filled = VISION_SECTIONS.filter((s) => (vision?.[s.key] as string | undefined)?.trim()).length;
  if (vision?.skipped) return "skipped";
  if (!filled) return "not captured yet — the interview writes here";
  const when = vision?.compiled_at ? new Date(vision.compiled_at).toLocaleDateString() : null;
  return `${filled} of ${VISION_SECTIONS.length} sections${when ? ` · compiled ${when}` : " · in progress"}`;
}

function VisionSection({ brief, onSave, depth }: {
  brief: Brief | null; onSave: (patch: Partial<Brief>) => Promise<void>; depth: number;
}) {
  const [open, setOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { if (editingKey) inputRef.current?.focus(); }, [editingKey]);

  const vision = brief?.vision;

  // Section-wise merge — same shape as the agent's update_vision write, so a hand edit and an agent
  // capture are indistinguishable downstream. An emptied section is deleted, not left as "".
  const commit = async (key: keyof BriefVision, value: string) => {
    setBusy(true);
    setEditingKey(null);
    const next: BriefVision = { ...(vision ?? {}) };
    if (value.trim()) next[key] = value.trim() as never;
    else delete next[key];
    try { await onSave({ vision: next }); }
    catch (e) { alert(`Save failed: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div style={{ ...detailRowStyle(depth), cursor: "pointer" }}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        title={open ? "collapse the vision" : "expand the vision — what you told the interview"}>
        <ConnectorTick depth={depth} />
        <span style={{ width: 12, flexShrink: 0 }} />
        <span style={{ fontSize: 9, color: T.muted, marginRight: 2 }}>{open ? "▾" : "▸"}</span>
        <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: T.accent, flexShrink: 0 }}>vision — the interview</span>
        <span style={{ fontFamily: SERIF, fontSize: 12.5, color: T.muted, fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {visionStatus(vision)}
        </span>
      </div>

      {open && VISION_SECTIONS.map(({ key, label }) => {
        const value = (vision?.[key] as string | undefined) ?? "";
        return (
          <BriefFieldRow key={key} label={label} depth={depth + 1} display={value} onEdit={() => { setDraft(value); setEditingKey(key); }}>
            {editingKey === key && (
              <textarea
                ref={inputRef} value={draft} disabled={busy}
                rows={Math.min(14, Math.max(3, draft.split("\n").length + 1))}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => { void commit(key, draft); }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { e.preventDefault(); setEditingKey(null); }
                  else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void commit(key, draft); }
                }}
                style={{ ...inputStyle, flex: 1, resize: "vertical" }}
              />
            )}
          </BriefFieldRow>
        );
      })}
    </>
  );
}

// ── Brief origin (step 0) ─────────────────────────────────────────────────────
// The brief is the ORIGIN — book-level input on books.brief, NOT a tree node. The seed (= the logline) is
// step 1, DERIVED from it (docs/dna-studio-analysis.md §1). So the brief renders here, ABOVE the tree, with a
// "↓ derives" cue — not nested inside the seed (which wrongly read as the brief being a detail OF the logline).
// The brief is the ORIGIN; the seed (logline) is auto-derived from it on first open (see the bootstrap in the
// load effect), so the tree is never empty and the agent always has a root to build from.
// The one-line summary shown once the brief is collapsed — enough to recognize it without re-reading it.
function briefSummary(brief: Brief | null): string {
  const heat = CONTENT_TYPES.find((c) => c.value === brief?.content_type?.level)?.label;
  const tone = Array.isArray(brief?.tone) ? brief.tone.join(", ") : "";
  const idea = briefIdea(brief)?.trim();
  const ideaShort = idea ? (idea.length > 70 ? `${idea.slice(0, 70)}…` : idea) : "";
  // Flag a captured vision even when collapsed — otherwise the interview stays invisible on a
  // past-premise book, which is exactly how it went unnoticed in the first place.
  const hasVision = VISION_SECTIONS.some((s) => (brief?.vision?.[s.key] as string | undefined)?.trim());
  return [brief?.genre, tone, heat, brief?.scope?.word_target ? `${brief.scope.word_target.toLocaleString()} words` : "", ideaShort ? `"${ideaShort}"` : "", hasVision ? "vision ✓" : ""]
    .filter(Boolean).join(" · ");
}

// `open` defaults true (a fresh/premise-stage book) so the brief is never surprise-hidden; DnaTreePage
// persists the toggle per book and defaults it collapsed once the tree is past the premise stage (#4 —
// the brief is "the constant origin": reference on a drafting book, not work in progress).
export function BriefOrigin({ brief, onSave, open = true, onToggleOpen }: {
  brief: Brief | null; onSave: (patch: Partial<Brief>) => Promise<void>;
  open?: boolean; onToggleOpen?: (open: boolean) => void;
}) {
  if (!open) {
    return (
      <div style={{ borderBottom: `1px solid ${T.borderSoft}`, padding: "8px 16px" }}>
        <div onClick={() => onToggleOpen?.(true)} title="expand the brief"
          style={{ display: "flex", alignItems: "baseline", gap: 8, cursor: "pointer", minWidth: 0 }}>
          <span style={{ fontSize: 9, color: T.muted, flexShrink: 0 }}>▸</span>
          <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: T.accent, flexShrink: 0 }}>brief — mandate</span>
          <span style={{ fontFamily: SERIF, fontSize: 12.5, color: T.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {briefSummary(brief) || "empty — click to fill in"}
          </span>
        </div>
      </div>
    );
  }
  return (
    <div style={{ borderBottom: `1px solid ${T.borderSoft}`, paddingBottom: 8 }}>
      <BriefSection brief={brief} onSave={onSave} depth={1} onCollapse={onToggleOpen ? () => onToggleOpen(false) : undefined} />
      {/* The interview's capture — part of the ORIGIN, alongside the mandate fields it sits next to. */}
      <VisionSection brief={brief} onSave={onSave} depth={1} />
      <div style={{ padding: "8px 16px 2px 20px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: KIND_COLOR.seed, fontSize: 13, lineHeight: 1 }}>↓</span>
        <span style={{ fontFamily: SERIF, fontSize: 12.5, color: T.muted, fontStyle: "italic" }}>
          derives the SEED below — a polished logline (protagonist · inciting · goal · obstacle · stakes), generated from this brief
        </span>
      </div>
    </div>
  );
}
