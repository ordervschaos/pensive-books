// FoundationsStep — chat-first redesign: the center is a near-manual editor.
// Five sub-steps (Argument → Ending → Cast → Tentpoles → Voice) behind a progress strip.
// ALL generation and option-picking live in the right-rail ReviseChat (layer="foundations").
// The center only creates / edits / deletes — no AI generation UI here.
import { useEffect, useState } from "react";
import { Check, ImageIcon, Pin, Plus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Textarea } from "@/components/ui/textarea";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { useToast } from "@/hooks/use-toast";
import { composePortraitPrompt, renderPortraitVariants, uploadReferenceImage } from "@/lib/sceneImages";
import { ImageGenStudio } from "../ImageGenStudio";
import {
  foundationsProgress, pinNode, writeFoundations,
  type CastMember, type FNode, type Foundations, type FoundationsStepKey, type Tentpole,
} from "@/lib/foundations";
import { ActionLink, Eyebrow, ImageLightbox, Panel } from "../studioUi";

const uid = () => crypto.randomUUID().slice(0, 8);

const SUBS: { key: FoundationsStepKey; label: string; caption: string }[] = [
  { key: "argument", label: "Argument", caption: "The claim the whole story argues — pick the one you'd defend." },
  { key: "ending", label: "Ending", caption: "Where it lands. Settled now, every route must reach it." },
  { key: "cast", label: "Cast", caption: "Protagonist and majors — want, wound, and the lie the arc breaks." },
  { key: "tentpoles", label: "Tentpoles", caption: "Moments you already see — at least three to proceed." },
  { key: "voice", label: "Voice", caption: "One pinned moment: the chosen voice exemplar anchors every page." },
];

interface Props {
  bookId: number;
  foundations: Foundations;
  onChanged: () => void;
}

export function FoundationsStep({ bookId, foundations, onChanged }: Props) {
  const { toast } = useToast();
  const [f, setF] = useState<Foundations>(foundations);
  const [active, setActive] = useState<FoundationsStepKey>(
    () => SUBS.find((s) => !foundationsProgress(foundations)[s.key])?.key ?? "voice",
  );
  useEffect(() => setF(foundations), [foundations]);

  const prog = foundationsProgress(f);

  const save = async (next: Foundations) => {
    setF(next);
    try { await writeFoundations(bookId, next); onChanged(); }
    catch (e) { toast({ title: "Couldn't save", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
  };

  const mirrorVoice = async (text: string) => {
    const { data } = await supabase.from("books").select("bible").eq("id", bookId).maybeSingle();
    const bible = { ...((data?.bible as Record<string, unknown> | null) ?? {}), voice_sample: text };
    await supabase.from("books").update({ bible }).eq("id", bookId);
  };

  const caption = SUBS.find((s) => s.key === active)!.caption;

  return (
    <div>
      {/* Sub-step progress strip */}
      <div className="mb-6 flex flex-wrap items-center gap-1.5">
        {SUBS.map((s, i) => {
          const done = prog[s.key];
          const isActive = s.key === active;
          return (
            <div key={s.key} className="flex items-center gap-1.5">
              {i > 0 && <span className="h-px w-4 bg-[hsl(var(--pv-border-soft))]" />}
              <button
                type="button"
                onClick={() => setActive(s.key)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 pv-mono text-[10px] uppercase tracking-[0.12em] transition-colors ${
                  isActive ? "border-[hsl(var(--pv-accent))] text-[hsl(var(--pv-accent))]"
                    : done ? "border-transparent bg-[hsl(var(--pv-accent))]/[0.08] text-[hsl(var(--pv-accent))]"
                      : "border-border text-[hsl(var(--pv-text-muted))] hover:border-foreground/30"
                }`}
              >
                {done && <Check className="h-3 w-3" strokeWidth={3} />}
                {s.label}
              </button>
            </div>
          );
        })}
      </div>
      <p className="pv-serif mb-5 text-[15px] italic leading-snug text-[hsl(var(--pv-text-muted))]">{caption}</p>

      {active === "argument" && (
        <NodeSub
          node={f.argument}
          placeholder="The claim the book argues — one or two sentences, the truth it wants the reader to leave with…"
          onSave={(n) => save({ ...f, argument: n })}
        />
      )}
      {active === "ending" && (
        <NodeSub
          node={f.ending}
          placeholder="Where the story lands — how the argument resolves, what the reader feels in the last pages…"
          blocked={!f.argument?.text?.trim() ? "Add an argument first." : undefined}
          onSave={(n) => save({ ...f, ending: n })}
        />
      )}
      {active === "cast" && (
        <CastSub bookId={bookId} cast={f.cast ?? []} onSave={(cast) => save({ ...f, cast })} />
      )}
      {active === "tentpoles" && (
        <TentpolesSub tentpoles={f.tentpoles ?? []} onSave={(tentpoles) => save({ ...f, tentpoles })} />
      )}
      {active === "voice" && (
        <NodeSub
          node={f.voice_exemplar}
          placeholder="The voice exemplar — ~120 words of a tentpole moment in the story's chosen soundscape…"
          blocked={(f.tentpoles ?? []).filter((t) => t.status !== "killed").length === 0 ? "Add at least one tentpole moment first." : undefined}
          onSave={async (n) => { await save({ ...f, voice_exemplar: n }); if (n.text?.trim()) await mirrorVoice(n.text); }}
        />
      )}
    </div>
  );
}

// ── Single-field node editor (argument / ending / voice) ─────────────────────
function NodeSub({ node, placeholder, blocked, onSave }: {
  node: FNode | undefined;
  placeholder: string;
  blocked?: string;
  onSave: (n: FNode) => Promise<void> | void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = (node?.text ?? "").trim();
  const value = draft ?? text;

  if (blocked) {
    return <p className="pv-serif text-[14px] italic text-[hsl(var(--pv-text-faint))]">{blocked}</p>;
  }

  const handleBlur = () => {
    const v = (draft ?? "").trim();
    if (draft !== null && v !== text) {
      void onSave(pinNode(node, v));
    }
    setDraft(null);
  };

  if (!text) {
    // Empty state — calm pointer + still allow typing
    return (
      <div className="space-y-4">
        <p className="pv-serif text-[15px] italic leading-relaxed text-[hsl(var(--pv-text-faint))]">
          Nothing here yet.
        </p>
        <p className="pv-serif text-[14px] text-[hsl(var(--pv-text-muted))]">
          Draft it in the editor on the right →
        </p>
        <Panel variant="soft" className="px-5 py-4">
          <Textarea
            value={value}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={handleBlur}
            placeholder={placeholder}
            rows={5}
            className="pv-serif border-none bg-transparent px-0 text-[16px] leading-[1.65] focus-visible:ring-0"
          />
        </Panel>
      </div>
    );
  }

  return (
    <Panel variant="chosen">
      <div className="mb-2 flex items-center gap-2">
        <Eyebrow tone="accent">
          <Check className="mr-1 inline h-3 w-3" strokeWidth={3} />
          {node?.pinned ? "Pinned" : "Draft"}
        </Eyebrow>
      </div>
      <Textarea
        value={value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleBlur}
        rows={Math.max(4, Math.ceil(value.length / 80))}
        className="pv-serif border-none bg-transparent px-0 text-[16px] leading-[1.65] focus-visible:ring-0"
      />
    </Panel>
  );
}

// ── Cast sub-step ─────────────────────────────────────────────────────────────
const CAST_FIELDS = ["want", "wound", "lie"] as const;

function CastSub({ bookId, cast, onSave }: {
  bookId: number;
  cast: CastMember[];
  onSave: (c: CastMember[]) => Promise<void> | void;
}) {
  const update = (id: string, patch: Partial<CastMember>, pinField?: string) => {
    void onSave(cast.map((m) => {
      if (m.id !== id) return m;
      const pinned_fields = pinField && !(m.pinned_fields ?? []).includes(pinField)
        ? [...(m.pinned_fields ?? []), pinField] : m.pinned_fields;
      return { ...m, ...patch, pinned_fields };
    }));
  };

  if (cast.length === 0) {
    return (
      <div className="space-y-4">
        <p className="pv-serif text-[15px] italic leading-relaxed text-[hsl(var(--pv-text-faint))]">
          No cast yet.
        </p>
        <p className="pv-serif text-[14px] text-[hsl(var(--pv-text-muted))]">
          Draft it in the editor on the right →
        </p>
        <ActionLink
          icon={<Plus className="h-3.5 w-3.5" />}
          onClick={() => void onSave([{ id: uid(), name: "Protagonist", role: "protagonist", pinned_fields: [...CAST_FIELDS] }])}
        >
          add character
        </ActionLink>
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      {cast.map((m) => (
        <Panel key={m.id} className="group bg-[hsl(var(--pv-surface-2))]/40">
          <div className="mb-3 flex items-center justify-between gap-3">
            <input
              defaultValue={m.name}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== m.name) update(m.id, { name: v }); }}
              className="pv-serif w-full max-w-[280px] border-none bg-transparent text-[18px] font-semibold text-foreground outline-none"
            />
            <div className="flex items-center gap-3">
              <Eyebrow>{m.role ?? "major"}</Eyebrow>
              <button
                type="button"
                onClick={() => { if (window.confirm(`Remove ${m.name}?`)) void onSave(cast.filter((x) => x.id !== m.id)); }}
                className="text-[hsl(var(--pv-text-faint))] hover:text-foreground"
                aria-label="Remove character"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="space-y-2">
            {CAST_FIELDS.map((k) => {
              const isPinned = (m.pinned_fields ?? []).includes(k);
              return (
                <div key={k} className="flex items-baseline gap-3">
                  <Eyebrow tone="muted" className="w-14 shrink-0">{k}</Eyebrow>
                  <AutoTextarea
                    defaultValue={m[k] ?? ""}
                    placeholder="—"
                    onBlur={(e) => { const v = e.target.value.trim(); if (v !== (m[k] ?? "")) update(m.id, { [k]: v }, k); }}
                    className="pv-serif border-b border-transparent bg-transparent px-0 py-0 text-[14.5px] leading-relaxed text-foreground focus-visible:ring-0 placeholder:text-[hsl(var(--pv-text-faint))] hover:border-[hsl(var(--pv-border-soft))] transition-colors"
                  />
                  {isPinned ? (
                    <button
                      type="button"
                      title="Locked from AI — click to unlock"
                      onClick={() => {
                        if (window.confirm(`Unlock ${m.name}'s ${k}? The AI may rewrite it.`))
                          update(m.id, { pinned_fields: (m.pinned_fields ?? []).filter((x) => x !== k) } as Partial<CastMember>);
                      }}
                    >
                      <Pin className="h-3 w-3 text-[hsl(var(--pv-accent))]" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      title="Lock this field — the AI won't overwrite it"
                      onClick={() => update(m.id, {}, k)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Pin className="h-3 w-3 text-[hsl(var(--pv-text-faint))]" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <CastLook bookId={bookId} member={m} onUpdate={(patch) => update(m.id, patch)} />
        </Panel>
      ))}
      <ActionLink
        icon={<Plus className="h-3.5 w-3.5" />}
        onClick={() => void onSave([...cast, { id: uid(), name: "New character", role: cast.length ? "major" : "protagonist", pinned_fields: [...CAST_FIELDS] }])}
      >
        add character
      </ActionLink>
    </div>
  );
}

// "Design the look" — per-character appearance + portrait set. Kept verbatim from old version.
function CastLook({ bookId, member, onUpdate }: { bookId: number; member: CastMember; onUpdate: (patch: Partial<CastMember>) => void }) {
  const [portraits, setPortraits] = useState<string[]>(member.portraits ?? []);
  const [lightbox, setLightbox] = useState<string | null>(null);
  useEffect(() => { setPortraits(member.portraits ?? []); }, [member.portraits]);

  const addPortrait = (url: string) => setPortraits((prev) => { const next = [...prev, url]; onUpdate({ portraits: next }); return next; });
  const removePortrait = (url: string) => setPortraits((prev) => { const next = prev.filter((x) => x !== url); onUpdate({ portraits: next }); return next; });

  return (
    <div className="mt-3 border-t border-[hsl(var(--pv-border-soft))] pt-3">
      <Eyebrow tone="muted">appearance</Eyebrow>
      <AutoTextarea
        defaultValue={member.appearance ?? ""}
        placeholder="What they look like — age, build, hair, distinguishing features, typical dress…"
        onBlur={(e) => { const v = e.target.value.trim(); if (v !== (member.appearance ?? "")) onUpdate({ appearance: v }); }}
        className="pv-serif border-b border-transparent bg-transparent px-0 py-0 text-[14px] leading-relaxed text-foreground focus-visible:ring-0 placeholder:text-[hsl(var(--pv-text-faint))] hover:border-[hsl(var(--pv-border-soft))] transition-colors"
      />

      {portraits.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2.5">
          {portraits.map((u) => (
            <div key={u} className="relative">
              <img src={u} alt={member.name} className="h-20 w-20 cursor-zoom-in rounded-lg border border-[hsl(var(--pv-border-soft))] object-cover" onClick={() => setLightbox(u)} />
              <button type="button" onClick={() => removePortrait(u)} className="absolute -right-1.5 -top-1.5 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80" aria-label="Remove portrait">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2 text-[hsl(var(--pv-text-faint))]">
          <ImageIcon className="h-4 w-4" />
          <span className="pv-serif text-[12.5px] italic">No portraits yet — design or upload a few (front, profile, full body) for stronger coherence.</span>
        </div>
      )}

      <div className="mt-3">
        <ImageGenStudio
          compose={(instr) => composePortraitPrompt(bookId, member.id, instr)}
          render={(prompt, refUrls) => renderPortraitVariants(bookId, member.id, prompt, refUrls, 3)}
          uploadRef={uploadReferenceImage}
          onAdd={addPortrait}
          uploadDirect={async (file) => addPortrait(await uploadReferenceImage(file))}
          onFullscreen={setLightbox}
          multiSelect
          startLabel={portraits.length ? "Add another look" : "Design the look"}
        />
      </div>
      <ImageLightbox src={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

// ── Tentpoles sub-step ────────────────────────────────────────────────────────
// Unified list: all tentpoles in one column. Pinned = locked from AI. Add/edit/delete manually.
function TentpolesSub({ tentpoles, onSave }: {
  tentpoles: Tentpole[];
  onSave: (t: Tentpole[]) => Promise<void> | void;
}) {
  const [newMoment, setNewMoment] = useState("");

  const live = tentpoles.filter((t) => t.status !== "killed");
  const pinnedCount = live.filter((t) => t.status === "pinned").length;

  const setText = (id: string, text: string) =>
    void onSave(tentpoles.map((t) => (t.id === id ? { ...t, text, status: "pinned" } : t)));
  const pinCard = (id: string) =>
    void onSave(tentpoles.map((t) => (t.id === id ? { ...t, status: "pinned" } : t)));
  const unpinCard = (id: string) =>
    void onSave(tentpoles.map((t) => (t.id === id ? { ...t, status: "fluid" } : t)));
  const deleteCard = (id: string) =>
    void onSave(tentpoles.filter((t) => t.id !== id));

  const addAuthor = () => {
    const text = newMoment.trim();
    if (!text) return;
    setNewMoment("");
    void onSave([...tentpoles, { id: uid(), text, source: "author", status: "pinned" }]);
  };

  if (live.length === 0) {
    return (
      <div className="space-y-4">
        <p className="pv-serif text-[15px] italic leading-relaxed text-[hsl(var(--pv-text-faint))]">
          No tentpoles yet.
        </p>
        <p className="pv-serif text-[14px] text-[hsl(var(--pv-text-muted))]">
          Draft them in the editor on the right →
        </p>
        <Panel variant="dashed" className="px-4 py-3">
          <Textarea
            value={newMoment}
            onChange={(e) => setNewMoment(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addAuthor(); }}
            placeholder="A scene you can already see — 1–3 sentences…"
            rows={2}
            className="pv-serif border-none bg-transparent px-0 text-[14px] leading-relaxed focus-visible:ring-0"
          />
          <ActionLink icon={<Plus className="h-3.5 w-3.5" />} onClick={addAuthor} disabled={!newMoment.trim()} className="mt-1">
            add moment — it's pinned
          </ActionLink>
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-muted))]">
        {live.length} moment{live.length === 1 ? "" : "s"} — need at least 3 to proceed.
        {pinnedCount > 0 && ` ${pinnedCount} locked from AI.`}
      </p>

      <div className="space-y-2.5">
        {live.map((t) => (
          <TentpoleCard
            key={t.id}
            t={t}
            onText={(v) => setText(t.id, v)}
            onPin={t.status !== "pinned" ? () => pinCard(t.id) : undefined}
            onUnpin={t.status === "pinned" && t.source === "ai" ? () => unpinCard(t.id) : undefined}
            onDelete={() => deleteCard(t.id)}
          />
        ))}

        {/* Add a new moment inline */}
        <Panel variant="dashed" className="px-4 py-3">
          <Textarea
            value={newMoment}
            onChange={(e) => setNewMoment(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addAuthor(); }}
            placeholder="A scene you can already see — 1–3 sentences…"
            rows={2}
            className="pv-serif border-none bg-transparent px-0 text-[14px] leading-relaxed focus-visible:ring-0"
          />
          <ActionLink icon={<Plus className="h-3.5 w-3.5" />} onClick={addAuthor} disabled={!newMoment.trim()} className="mt-1">
            add — it's pinned
          </ActionLink>
        </Panel>
      </div>
    </div>
  );
}

function TentpoleCard({ t, onText, onPin, onUnpin, onDelete }: {
  t: Tentpole;
  onText: (v: string) => void;
  onPin?: () => void;
  onUnpin?: () => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const pinned = t.status === "pinned";
  return (
    <Panel variant={pinned ? "chosen" : undefined} className="px-4 py-3 transition-colors">
      <Textarea
        value={draft ?? t.text}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft != null && draft.trim() && draft.trim() !== t.text) onText(draft.trim()); setDraft(null); }}
        rows={Math.max(2, Math.ceil((draft ?? t.text).length / 60))}
        className="pv-serif border-none bg-transparent px-0 text-[14px] leading-relaxed focus-visible:ring-0"
      />
      <div className="mt-1.5 flex items-center gap-3.5">
        {pinned && (
          <span className="pv-mono inline-flex items-center gap-1 text-[9.5px] uppercase tracking-[0.12em] text-[hsl(var(--pv-accent))]">
            <Pin className="h-3 w-3" /> locked from AI
          </span>
        )}
        {onUnpin && (
          <button type="button" onClick={onUnpin} title="Unlock — the AI may rewrite this"
            className="pv-serif inline-flex items-center gap-1 text-[12.5px] italic text-[hsl(var(--pv-text-faint))] hover:opacity-75">
            <Pin className="h-3 w-3" /> unlock
          </button>
        )}
        {onPin && (
          <button type="button" onClick={onPin} title="Lock this moment — the AI won't overwrite it"
            className="pv-serif inline-flex items-center gap-1 text-[12.5px] italic text-[hsl(var(--pv-accent))] hover:opacity-75">
            <Check className="h-3 w-3" /> lock
          </button>
        )}
        <button type="button" onClick={onDelete}
          className="pv-serif inline-flex items-center gap-1 text-[12.5px] italic text-[hsl(var(--pv-text-faint))] hover:text-destructive/70 transition-colors">
          <X className="h-3 w-3" /> discard
        </button>
      </div>
    </Panel>
  );
}
