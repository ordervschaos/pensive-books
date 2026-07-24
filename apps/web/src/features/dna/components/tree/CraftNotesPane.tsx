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

export function CraftNotesPane({ bookId }: { bookId: number }) {
  const { toast } = useToast();
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  // One-time load: this is a settings form the author types INTO, so — unlike the live tree — it seeds
  // local state once and owns it thereafter (same pattern as the brief editor's saveBrief). Realtime would
  // fight the caret. If craft_overrides changes elsewhere, a tab reopen re-seeds it.
  useEffect(() => {
    let alive = true;
    void supabase.from("books").select("craft_overrides").eq("id", bookId).maybeSingle().then(({ data }) => {
      if (!alive) return;
      setOverrides((data?.craft_overrides as Record<string, string> | null) ?? {});
      setLoaded(true);
    });
    return () => { alive = false; };
  }, [bookId]);

  // Persist the whole map (jsonb column). Blank values are stripped so a cleared field falls back to the
  // code default rather than storing an empty string that reads as "customized".
  const persist = async (next: Record<string, string>) => {
    const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v.trim()));
    const { error } = await supabase.from("books").update({ craft_overrides: clean }).eq("id", bookId);
    if (error) { toast({ title: "Couldn't save craft note", description: error.message, variant: "destructive" }); throw error; }
  };

  const commit = (key: string, value: string) => {
    setOverrides((prev) => {
      const next = { ...prev };
      if (value.trim()) next[key] = value; else delete next[key];
      void persist(next).catch(() => {});
      return next;
    });
  };
  const reset = (key: string) => commit(key, "");

  return (
    <div style={{ padding: "24px 16px 96px", maxWidth: 820, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: SERIF, fontSize: 20, color: T.ink, marginBottom: 6 }}>Craft notes</div>
        <p style={{ fontFamily: SERIF, fontSize: 14.5, lineHeight: 1.6, color: T.inkSoft, margin: 0, maxWidth: 640 }}>
          The story-craft rules the AI writes against at each stage of generation. Each has a built-in
          default; rewrite one here to change how <em>this book</em> is generated. Blank a field to fall
          back to the default. Notes reach both the writer (per-stage prompts) and the editor agent.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {NOTES.map((note) => (
          <NoteCard
            key={note.key}
            note={note}
            value={overrides[note.key]}
            disabled={!loaded}
            onCommit={(v) => commit(note.key, v)}
            onReset={() => reset(note.key)}
          />
        ))}
      </div>
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
