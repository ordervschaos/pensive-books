// CraftNotesPane — the studio's "Craft Notes" tab. The tier-1 story craft (how a logline is forged, the
// premise anatomy, the beat causality/polarity laws, the scene direction grammar) is baked into the
// generation prompts in code (_shared/craft-kb.ts). This surface exposes each of those craft notes: it
// shows the DEFAULT and lets the author rewrite it PER BOOK. An override is persisted to
// books.craft_overrides[key]; both write paths (dna-expand's stage prompts + the book-agent's context)
// read it back through craftBody()/craftOverrideBlock(), so a rewritten note actually changes generation.
//
// The default text is read from the committed mirror craftNotes.json (craftNotes.artifact.test locks it to
// the edge CRAFT_NOTES source of truth) — the web can't import the edge module across the deploy boundary.
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import CRAFT_NOTES from "@/features/dna/lib/craftNotes.json";
import { MONO, SERIF, T } from "./treeChrome";

type CraftNote = { key: string; label: string; help: string; body: string };
const NOTES = CRAFT_NOTES as CraftNote[];

// The structural/entity generation passes (node_type_configs) — the ones with no code craft const because
// they run through ONE generic config-driven expander. `premise` is EXCLUDED: it's special-cased in
// dna-expand (covered by the Premise craft note above), so overriding its config row would no-op.
type ExpansionConfig = { target: string; child_kind: string; child_level: number; role: string; count: string };
type ExpansionOverride = { role?: string; count?: string };
// Friendly labels for the passes (the target key is internal jargon — "movements" is what the UI calls Acts).
const EXPANSION_LABEL: Record<string, string> = {
  pillar: "Pillar", cast: "Cast", world: "World", relationships: "Relationships",
  "set-pieces": "Set-pieces", threads: "Threads", games: "Games",
  voice_profile: "Voice profile", movements: "Acts", beats: "Beats", scenes: "Scenes",
};

export function CraftNotesPane({ bookId }: { bookId: number }) {
  const { toast } = useToast();
  const [craftOver, setCraftOver] = useState<Record<string, string>>({});
  const [expOver, setExpOver] = useState<Record<string, ExpansionOverride>>({});
  const [configs, setConfigs] = useState<ExpansionConfig[]>([]);
  const [loaded, setLoaded] = useState(false);

  // One-time load: this is a settings form the author types INTO, so — unlike the live tree — it seeds
  // local state once and owns it thereafter (same pattern as the brief editor's saveBrief). Realtime would
  // fight the caret. The expansion DEFAULTS come live from the global node_type_configs table (its SSOT),
  // not a mirror — so there's no drift to lock.
  useEffect(() => {
    let alive = true;
    void Promise.all([
      supabase.from("books").select("craft_overrides, expansion_overrides").eq("id", bookId).maybeSingle(),
      supabase.from("node_type_configs").select("target, child_kind, child_level, role, count"),
    ]).then(([bookRes, cfgRes]) => {
      if (!alive) return;
      setCraftOver((bookRes.data?.craft_overrides as Record<string, string> | null) ?? {});
      setExpOver((bookRes.data?.expansion_overrides as Record<string, ExpansionOverride> | null) ?? {});
      // node_type_configs.count is `text` in the DB (e.g. "3 to 5"), though the generated types mistype it
      // as number — coerce and drop the special-cased `premise` (see ExpansionConfig note above).
      const rows = ((cfgRes.data as unknown as Record<string, unknown>[] | null) ?? []).map((r) => ({
        target: String(r.target), child_kind: String(r.child_kind), child_level: Number(r.child_level),
        role: String(r.role ?? ""), count: String(r.count ?? ""),
      })) as ExpansionConfig[];
      setConfigs(rows.filter((c) => c.target !== "premise"));
      setLoaded(true);
    });
    return () => { alive = false; };
  }, [bookId]);

  // Sort by the generation ladder (child_level), then keep a stable order within a level.
  const orderedConfigs = useMemo(
    () => [...configs].sort((a, b) => a.child_level - b.child_level || a.target.localeCompare(b.target)),
    [configs],
  );

  // ── craft-note (prose/plan) overrides — flat { key: text }, blanks stripped ──
  const commitCraft = (key: string, value: string) => {
    setCraftOver((prev) => {
      const next = { ...prev };
      if (value.trim()) next[key] = value; else delete next[key];
      const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v.trim()));
      void supabase.from("books").update({ craft_overrides: clean }).eq("id", bookId).then(({ error }) => {
        if (error) toast({ title: "Couldn't save craft note", description: error.message, variant: "destructive" });
      });
      return next;
    });
  };

  // ── expansion (structure/entity) overrides — nested { target: { role?, count? } }, blank fields dropped ──
  const commitExpansion = (target: string, patch: ExpansionOverride) => {
    setExpOver((prev) => {
      const merged = { ...(prev[target] ?? {}), ...patch };
      const entry: ExpansionOverride = {};
      if (merged.role?.trim()) entry.role = merged.role.trim();
      if (merged.count?.trim()) entry.count = merged.count.trim();
      const next = { ...prev };
      if (entry.role || entry.count) next[target] = entry; else delete next[target];
      void supabase.from("books").update({ expansion_overrides: next }).eq("id", bookId).then(({ error }) => {
        if (error) toast({ title: "Couldn't save structure override", description: error.message, variant: "destructive" });
      });
      return next;
    });
  };

  return (
    <div style={{ padding: "24px 16px 96px", maxWidth: 820, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: SERIF, fontSize: 20, color: T.ink, marginBottom: 6 }}>Craft notes</div>
        <p style={{ fontFamily: SERIF, fontSize: 14.5, lineHeight: 1.6, color: T.inkSoft, margin: 0, maxWidth: 640 }}>
          The rules the AI generates against, per stage. Each has a built-in default; rewrite one to change
          how <em>this book</em> is generated. Blank a field to fall back to the default.
        </p>
      </div>

      {/* ── Prose & plan craft — the distilled story-craft consts (craftBody) ── */}
      <SectionHeader title="Prose & plan craft" sub="How the AI writes at each stage — reaches both the writer and the editor agent." />
      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 32 }}>
        {NOTES.map((note) => (
          <NoteCard
            key={note.key}
            note={note}
            value={craftOver[note.key]}
            disabled={!loaded}
            onCommit={(v) => commitCraft(note.key, v)}
            onReset={() => commitCraft(note.key, "")}
          />
        ))}
      </div>

      {/* ── Structure generation — the config-driven entity/act/scene passes (node_type_configs) ── */}
      <SectionHeader title="Structure generation" sub="How each structural pass is built — its instruction to the AI and how many it makes." />
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {orderedConfigs.map((cfg) => (
          <ExpansionCard
            key={cfg.target}
            config={cfg}
            override={expOver[cfg.target]}
            disabled={!loaded}
            onCommit={(patch) => commitExpansion(cfg.target, patch)}
            onReset={() => commitExpansion(cfg.target, { role: "", count: "" })}
          />
        ))}
      </div>
    </div>
  );
}

function SectionHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: T.muted }}>{title}</div>
      <div style={{ fontFamily: SERIF, fontSize: 13, color: T.faint, marginTop: 3 }}>{sub}</div>
    </div>
  );
}

function NoteCard({ note, value, disabled, onCommit, onReset }: {
  note: CraftNote; value: string | undefined; disabled: boolean;
  onCommit: (v: string) => void; onReset: () => void;
}) {
  const customized = typeof value === "string" && value.trim().length > 0;
  // The textarea shows the override when set, else the default — so "reset to default" and "start editing"
  // are the same gesture (edit the shown text). `draft` tracks unsaved keystrokes; commit on blur.
  const shown = customized ? value! : note.body;
  const [draft, setDraft] = useState(shown);
  const [editing, setEditing] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Re-seed the field when the persisted value changes from OUTSIDE this card (load, reset) — but never
  // while the author is mid-edit, or we'd stomp their caret.
  useEffect(() => { if (!editing) setDraft(shown); }, [shown, editing]);

  const autosize = (el: HTMLTextAreaElement | null) => { if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; } };
  useEffect(() => { autosize(taRef.current); }, [draft, editing]);

  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, background: T.raised, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "11px 14px", borderBottom: `1px solid ${T.borderSoft}` }}>
        <span style={{ fontFamily: MONO, fontSize: 12, letterSpacing: "0.04em", color: T.ink }}>{note.label}</span>
        <span style={{ fontFamily: SERIF, fontSize: 12.5, color: T.muted, flex: 1, minWidth: 0 }}>{note.help}</span>
        <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: customized ? T.accent : T.faint, flexShrink: 0 }}>
          {customized ? "customized" : "default"}
        </span>
        {customized && (
          <button onClick={onReset} disabled={disabled} title="Discard this book's note and use the built-in default"
            style={{ background: "none", border: "none", cursor: "pointer", fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: T.muted, flexShrink: 0, padding: 0 }}>
            reset ↺
          </button>
        )}
      </div>
      <textarea
        ref={taRef}
        value={draft}
        disabled={disabled}
        spellCheck={false}
        onFocus={() => setEditing(true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          const next = draft.trim();
          // Only write when the author actually diverged from the shown text — editing the default and
          // leaving it byte-identical shouldn't mint a redundant override.
          if (next !== shown.trim()) onCommit(next === note.body.trim() ? "" : next);
        }}
        style={{
          display: "block", width: "100%", boxSizing: "border-box", resize: "none",
          padding: "12px 14px", border: "none", outline: "none", background: "transparent",
          fontFamily: MONO, fontSize: 12, lineHeight: 1.65, color: T.inkSoft, minHeight: 80,
          whiteSpace: "pre-wrap",
        }}
      />
    </div>
  );
}

// One structural pass: its `role` (the AI instruction — free text, autosized) + `count` (how many, a short
// string like "3 to 5" / "exactly 4"). Both default to the global node_type_configs value and override the
// same way as a craft note: edit the shown default → mints an override; blank / reset → back to default.
function ExpansionCard({ config, override, disabled, onCommit, onReset }: {
  config: ExpansionConfig; override: ExpansionOverride | undefined; disabled: boolean;
  onCommit: (patch: ExpansionOverride) => void; onReset: () => void;
}) {
  const roleCustom = typeof override?.role === "string" && override.role.trim().length > 0;
  const countCustom = typeof override?.count === "string" && override.count.trim().length > 0;
  const customized = roleCustom || countCustom;
  const shownRole = roleCustom ? override!.role!.trim() : config.role;
  const shownCount = countCustom ? override!.count!.trim() : config.count;

  const [role, setRole] = useState(shownRole);
  const [count, setCount] = useState(shownCount);
  const [editing, setEditing] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (!editing) { setRole(shownRole); setCount(shownCount); } }, [shownRole, shownCount, editing]);
  const autosize = (el: HTMLTextAreaElement | null) => { if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; } };
  useEffect(() => { autosize(taRef.current); }, [role, editing]);

  const label = EXPANSION_LABEL[config.target] ?? config.target;
  const inputStyle: React.CSSProperties = {
    fontFamily: MONO, fontSize: 11.5, color: T.inkSoft, background: T.bg, border: `1px solid ${T.border}`,
    borderRadius: 5, padding: "3px 8px", width: 110, outline: "none",
  };

  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, background: T.raised, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "11px 14px", borderBottom: `1px solid ${T.borderSoft}` }}>
        <span style={{ fontFamily: MONO, fontSize: 12, letterSpacing: "0.04em", color: T.ink }}>{label}</span>
        <span style={{ fontFamily: SERIF, fontSize: 12, color: T.faint, flex: 1, minWidth: 0 }}>→ {config.child_kind}</span>
        <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: customized ? T.accent : T.faint, flexShrink: 0 }}>
          {customized ? "customized" : "default"}
        </span>
        {customized && (
          <button onClick={onReset} disabled={disabled} title="Discard this book's overrides and use the global default"
            style={{ background: "none", border: "none", cursor: "pointer", fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: T.muted, flexShrink: 0, padding: 0 }}>
            reset ↺
          </button>
        )}
      </div>
      <textarea
        ref={taRef}
        value={role}
        disabled={disabled}
        spellCheck={false}
        onFocus={() => setEditing(true)}
        onChange={(e) => setRole(e.target.value)}
        onBlur={() => {
          setEditing(false);
          const next = role.trim();
          if (next !== shownRole.trim()) onCommit({ role: next === config.role.trim() ? "" : next });
        }}
        style={{
          display: "block", width: "100%", boxSizing: "border-box", resize: "none",
          padding: "12px 14px", border: "none", outline: "none", background: "transparent",
          fontFamily: MONO, fontSize: 12, lineHeight: 1.65, color: T.inkSoft, minHeight: 56, whiteSpace: "pre-wrap",
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", borderTop: `1px solid ${T.borderSoft}` }}>
        <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: T.muted }}>count</span>
        <input
          value={count}
          disabled={disabled}
          spellCheck={false}
          onFocus={() => setEditing(true)}
          onChange={(e) => setCount(e.target.value)}
          onBlur={() => {
            setEditing(false);
            const next = count.trim();
            if (next !== shownCount.trim()) onCommit({ count: next === config.count.trim() ? "" : next });
          }}
          style={inputStyle}
        />
        <span style={{ fontFamily: SERIF, fontSize: 12, color: T.faint }}>how many to generate (e.g. "3 to 5", "exactly 4")</span>
      </div>
    </div>
  );
}
