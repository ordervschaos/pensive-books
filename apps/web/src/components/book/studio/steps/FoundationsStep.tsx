// FoundationsStep — chat-first redesign: the center is a near-manual editor.
// Sub-steps: Argument → Ending → Cast → World → Tentpoles → Voice.
// ALL generation and option-picking live in the right-rail ReviseChat (layer="foundations"),
// EXCEPT World which has a direct AI-generate path here (returns a single WorldNode, not proposals).
// The center only creates / edits / deletes — no AI generation UI except World generate.
import { useEffect, useState } from "react";
import { Check, ImageIcon, Pin, Plus, X } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { useToast } from "@/hooks/use-toast";
import { composePortraitPrompt, renderPortraitVariants, uploadReferenceImage } from "@/lib/sceneImages";
import { ImageGenStudio } from "../ImageGenStudio";
import {
  foundationsProgress, pinNode, writeFoundations,
  type CastMember, type FNode, type Foundations, type FoundationsStepKey, type Narration, type Relationship, type Tentpole, type WorldNode,
} from "@/lib/foundations";
import { BookLookControls } from "../BookLookControls";
import { ActionLink, Eyebrow, GenerateInChat, ImageLightbox, Panel, RunError, RunningInline } from "../studioUi";
import { useAIRun } from "@/hooks/useAIRun";

const uid = () => crypto.randomUUID().slice(0, 8);

const SUBS: { key: FoundationsStepKey; label: string; caption: string }[] = [
  { key: "argument", label: "Argument", caption: "The claim the whole story argues — pick the one you'd defend." },
  { key: "ending", label: "Ending", caption: "Where it lands. Settled now, every route must reach it." },
  { key: "cast", label: "Cast", caption: "Protagonist and majors — want, wound, and the lie the arc breaks." },
  { key: "world", label: "World", caption: "The pinned setting, period, and constraints — prose must never contradict these." },
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
          bookId={bookId}
          node={f.argument}
          placeholder="The claim the book argues — one or two sentences, the truth it wants the reader to leave with…"
          onSave={(n) => save({ ...f, argument: n })}
        />
      )}
      {active === "ending" && (
        <NodeSub
          bookId={bookId}
          node={f.ending}
          placeholder="Where the story lands — how the argument resolves, what the reader feels in the last pages…"
          blocked={!f.argument?.text?.trim() ? "Add an argument first." : undefined}
          onSave={(n) => save({ ...f, ending: n })}
        />
      )}
      {active === "cast" && (
        <div className="space-y-5">
          <HouseLook f={f} onPatch={(patch) => save({ ...f, ...patch })} />
          <CastSub
            bookId={bookId}
            cast={f.cast ?? []}
            relationships={f.relationships ?? []}
            onSave={(cast, relationships) => save({ ...f, cast, relationships: relationships ?? f.relationships })}
          />
        </div>
      )}
      {active === "world" && (
        <WorldSub
          bookId={bookId}
          world={f.world}
          onSave={(world) => save({ ...f, world })}
        />
      )}
      {active === "tentpoles" && (
        <TentpolesSub bookId={bookId} tentpoles={f.tentpoles ?? []} onSave={(tentpoles) => save({ ...f, tentpoles })} />
      )}
      {active === "voice" && (
        <div className="space-y-6">
          <NodeSub
            bookId={bookId}
            node={f.voice_exemplar}
            placeholder="The voice exemplar — ~120 words of a tentpole moment in the story's chosen soundscape…"
            blocked={(f.tentpoles ?? []).filter((t) => t.status !== "killed").length === 0 ? "Add at least one tentpole moment first." : undefined}
            onSave={(n) => save({ ...f, voice_exemplar: n })}
          />
          <NarrationSub
            narration={f.narration ?? {}}
            onSave={(narration) => save({ ...f, narration })}
          />
        </div>
      )}
    </div>
  );
}

// ── Single-field node editor (argument / ending / voice) ─────────────────────
function NodeSub({ bookId, node, placeholder, blocked, onSave }: {
  bookId: number;
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
        <GenerateInChat bookId={bookId} layer="foundations" label="Draft the foundations" />
        <p className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))]">
          Or type it directly below.
        </p>
        <AutoTextarea
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={handleBlur}
          placeholder={placeholder}
          className="pv-serif w-full border-none bg-transparent px-0 text-[16px] leading-[1.65] focus-visible:ring-0"
        />
      </div>
    );
  }

  return (
    <AutoTextarea
      value={value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={handleBlur}
      className="pv-serif w-full border-none bg-transparent px-0 text-[18px] leading-[1.7] focus-visible:ring-0"
    />
  );
}

// ── Cast sub-step ─────────────────────────────────────────────────────────────
const CAST_FIELDS = ["want", "wound", "lie"] as const;
// F1: per-character voice + history fields (not in the pinned_fields system — AI generates them
// but the author can overwrite freely; no lock/unlock toggle needed).
const CAST_VOICE_FIELDS: Array<{ key: "history" | "idiolect" | "tag"; placeholder: string }> = [
  { key: "history", placeholder: "Formative backstory — 1–2 sentences explaining the wound/lie origin…" },
  { key: "idiolect", placeholder: "How they speak — diction, verbal tics, register (e.g. short declaratives, never asks questions)…" },
  { key: "tag", placeholder: "One trackable physical/gesture marker (e.g. always straightens objects near her)…" },
];

function CastSub({ bookId, cast, relationships, onSave }: {
  bookId: number;
  cast: CastMember[];
  relationships: Relationship[];
  onSave: (c: CastMember[], r?: Relationship[]) => Promise<void> | void;
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
        <GenerateInChat bookId={bookId} layer="foundations" label="Draft the foundations" />
        <ActionLink
          icon={<Plus className="h-3.5 w-3.5" />}
          onClick={() => void onSave([{ id: uid(), name: "Protagonist", role: "protagonist", pinned_fields: [...CAST_FIELDS] }])}
        >
          or add a character by hand
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
          {/* Core arc fields (pinnable) */}
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
          {/* F1: per-character voice + history fields */}
          <div className="mt-3 border-t border-[hsl(var(--pv-border-soft))] pt-3 space-y-2">
            <Eyebrow tone="muted">voice & history</Eyebrow>
            {CAST_VOICE_FIELDS.map(({ key, placeholder }) => (
              <div key={key} className="flex items-baseline gap-3">
                <Eyebrow tone="faint" className="w-14 shrink-0">{key}</Eyebrow>
                <AutoTextarea
                  defaultValue={m[key] ?? ""}
                  placeholder={placeholder}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v !== (m[key] ?? "")) update(m.id, { [key]: v }); }}
                  className="pv-serif border-b border-transparent bg-transparent px-0 py-0 text-[14px] leading-relaxed text-foreground focus-visible:ring-0 placeholder:text-[hsl(var(--pv-text-faint))] hover:border-[hsl(var(--pv-border-soft))] transition-colors"
                />
              </div>
            ))}
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

      {/* F2: relationships panel */}
      <RelationshipsSub cast={cast} relationships={relationships} onSave={(r) => void onSave(cast, r)} />
    </div>
  );
}

// ── F2: Relationships panel ───────────────────────────────────────────────────
function RelationshipsSub({ cast, relationships, onSave }: {
  cast: CastMember[];
  relationships: Relationship[];
  onSave: (r: Relationship[]) => void;
}) {
  const addRow = () =>
    onSave([...relationships, { id: uid(), a: cast[0]?.id ?? "", b: cast[1]?.id ?? cast[0]?.id ?? "", bond: "" }]);

  const updateRow = (id: string, patch: Partial<Relationship>) =>
    onSave(relationships.map((r) => r.id === id ? { ...r, ...patch } : r));

  const removeRow = (id: string) =>
    onSave(relationships.filter((r) => r.id !== id));

  return (
    <Panel className="bg-[hsl(var(--pv-surface-2))]/30">
      <Eyebrow tone="muted">relationships</Eyebrow>
      <p className="pv-serif mt-1 mb-3 text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">
        Key dyads — who A is to B and the charge between them.
      </p>
      {relationships.length > 0 && (
        <div className="space-y-2 mb-3">
          {relationships.map((r) => (
            <div key={r.id} className="flex items-center gap-2">
              {/* A */}
              <select
                value={r.a}
                onChange={(e) => updateRow(r.id, { a: e.target.value })}
                className="pv-serif rounded border border-[hsl(var(--pv-border-soft))] bg-transparent px-2 py-1 text-[13px] text-foreground focus:outline-none"
              >
                {cast.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <span className="pv-serif text-[12px] text-[hsl(var(--pv-text-faint))]">↔</span>
              {/* B */}
              <select
                value={r.b}
                onChange={(e) => updateRow(r.id, { b: e.target.value })}
                className="pv-serif rounded border border-[hsl(var(--pv-border-soft))] bg-transparent px-2 py-1 text-[13px] text-foreground focus:outline-none"
              >
                {cast.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              {/* bond */}
              <input
                defaultValue={r.bond}
                placeholder="bond — one line on the charge between them…"
                onBlur={(e) => { const v = e.target.value.trim(); if (v !== r.bond) updateRow(r.id, { bond: v }); }}
                className="pv-serif min-w-0 flex-1 border-b border-transparent bg-transparent py-1 text-[13px] text-foreground outline-none placeholder:text-[hsl(var(--pv-text-faint))] hover:border-[hsl(var(--pv-border-soft))] transition-colors"
              />
              {/* pin */}
              <button
                type="button"
                title={r.pinned ? "Locked from AI — click to unlock" : "Lock this bond"}
                onClick={() => updateRow(r.id, { pinned: !r.pinned })}
                className="shrink-0"
              >
                <Pin className={`h-3 w-3 ${r.pinned ? "text-[hsl(var(--pv-accent))]" : "text-[hsl(var(--pv-text-faint))] opacity-40 hover:opacity-70"}`} />
              </button>
              <button type="button" onClick={() => removeRow(r.id)} className="shrink-0 text-[hsl(var(--pv-text-faint))] hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      {cast.length >= 2 ? (
        <ActionLink icon={<Plus className="h-3.5 w-3.5" />} onClick={addRow}>
          add relationship
        </ActionLink>
      ) : (
        <p className="pv-serif text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">Add at least two characters to define relationships.</p>
      )}
    </Panel>
  );
}

// "House look" — the book-level visual style every scene/portrait STYLE line inherits, so the whole
// book's illustrations look like one book. A theme preset fills art_direction; the author can fine-tune
// the text (→ "custom"). The render-model toggle (image_model) applies to every illustration in the book.
// The same controls (sans the help line) also appear on the Scene level (BookLookControls).
function HouseLook({ f, onPatch }: { f: Foundations; onPatch: (patch: Partial<Foundations>) => void }) {
  return (
    <Panel className="bg-[hsl(var(--pv-surface-2))]/40">
      <Eyebrow tone="muted">house look — one visual style for the whole book</Eyebrow>
      <div className="mt-2.5">
        <BookLookControls artTheme={f.art_theme} artDirection={f.art_direction} imageModel={f.image_model} onPatch={onPatch} />
      </div>
      <p className="pv-serif mt-2 text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">
        Leave blank for the default cinematic illustration look.
      </p>
    </Panel>
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

// ── F3a: World sub-step ───────────────────────────────────────────────────────
// Edits foundations.world (setting, period, rules[]) with AI generation via ai-run foundations_options step="world".
// The edge returns { world: WorldNode } — a single pre-built node (not a candidates list).
function WorldSub({ bookId, world, onSave }: {
  bookId: number;
  world: WorldNode | undefined;
  onSave: (w: WorldNode) => Promise<void> | void;
}) {
  const { toast } = useToast();
  const [newRule, setNewRule] = useState("");

  const { run, starting, start, accept, cancel } = useAIRun<{ world: WorldNode }>({
    bookId,
    kind: "foundations_options",
    targetKey: "world",
  });

  const generate = () => void start({ step: "world" }).catch((e: unknown) => {
    toast({ title: "Generation failed", description: String((e as Error)?.message ?? e), variant: "destructive" });
  });

  const applyWorld = async (result: { world: WorldNode }) => {
    await onSave(result.world);
  };

  const update = (patch: Partial<WorldNode>) => void onSave({ ...(world ?? {}), ...patch });

  const addRule = () => {
    const r = newRule.trim();
    if (!r) return;
    setNewRule("");
    update({ rules: [...(world?.rules ?? []), r] });
  };

  const removeRule = (i: number) =>
    update({ rules: (world?.rules ?? []).filter((_, idx) => idx !== i) });

  const updateRule = (i: number, v: string) =>
    update({ rules: (world?.rules ?? []).map((r, idx) => (idx === i ? v : r)) });

  const isEmpty = !world?.setting && !world?.period && !(world?.rules?.length);

  return (
    <div className="space-y-4">
      {isEmpty && (
        <p className="pv-serif text-[15px] italic leading-relaxed text-[hsl(var(--pv-text-faint))]">
          No world defined yet.
        </p>
      )}

      {/* AI generate button */}
      {run?.status === "running" || run?.status === "pending" ? (
        <RunningInline label="Generating world…" onCancel={() => void cancel()} className="py-1" />
      ) : run?.status === "ready" ? (
        <div className="space-y-2">
          <p className="pv-serif text-[14px] italic text-[hsl(var(--pv-text-muted))]">World proposal ready — apply it or dismiss.</p>
          <div className="flex items-center gap-3">
            <ActionLink onClick={() => void accept(applyWorld)}>Apply world</ActionLink>
            <ActionLink tone="faint" onClick={() => void cancel()}>Dismiss</ActionLink>
          </div>
        </div>
      ) : run?.status === "error" ? (
        <div>
          <RunError msg={run.error} />
          <ActionLink onClick={generate} className="mt-2">Retry</ActionLink>
        </div>
      ) : (
        <ActionLink
          icon={<Plus className="h-3.5 w-3.5" />}
          busy={starting}
          onClick={generate}
        >
          {isEmpty ? "Generate the world" : "Regenerate world"}
        </ActionLink>
      )}

      {/* Manual editor */}
      <Panel className="bg-[hsl(var(--pv-surface-2))]/40 space-y-3">
        {/* Pin toggle */}
        <div className="flex items-center justify-between gap-3">
          <Eyebrow tone="muted">world / setting</Eyebrow>
          <button
            type="button"
            title={world?.pinned ? "Pinned — click to unpin (AI may rewrite)" : "Pin this world — AI won't overwrite it"}
            onClick={() => update({ pinned: !world?.pinned })}
            className="flex items-center gap-1.5"
          >
            <Pin className={`h-3 w-3 ${world?.pinned ? "text-[hsl(var(--pv-accent))]" : "text-[hsl(var(--pv-text-faint))] opacity-40 hover:opacity-70"}`} />
            {world?.pinned && <Eyebrow tone="accent">pinned</Eyebrow>}
          </button>
        </div>

        {/* Setting */}
        <div className="flex items-baseline gap-3">
          <Eyebrow tone="faint" className="w-14 shrink-0">setting</Eyebrow>
          <AutoTextarea
            defaultValue={world?.setting ?? ""}
            placeholder="Where (and what kind of place) the story lives — specific enough to paint a picture…"
            onBlur={(e) => { const v = e.target.value.trim(); if (v !== (world?.setting ?? "")) update({ setting: v }); }}
            className="pv-serif border-b border-transparent bg-transparent px-0 py-0 text-[14.5px] leading-relaxed text-foreground focus-visible:ring-0 placeholder:text-[hsl(var(--pv-text-faint))] hover:border-[hsl(var(--pv-border-soft))] transition-colors"
          />
        </div>

        {/* Period */}
        <div className="flex items-baseline gap-3">
          <Eyebrow tone="faint" className="w-14 shrink-0">period</Eyebrow>
          <AutoTextarea
            defaultValue={world?.period ?? ""}
            placeholder="When — era, season, moment in history, or 'contemporary'…"
            onBlur={(e) => { const v = e.target.value.trim(); if (v !== (world?.period ?? "")) update({ period: v }); }}
            className="pv-serif border-b border-transparent bg-transparent px-0 py-0 text-[14.5px] leading-relaxed text-foreground focus-visible:ring-0 placeholder:text-[hsl(var(--pv-text-faint))] hover:border-[hsl(var(--pv-border-soft))] transition-colors"
          />
        </div>

        {/* Rules */}
        <div>
          <Eyebrow tone="faint" className="mb-2 block">rules — load-bearing constraints prose must never contradict</Eyebrow>
          <div className="space-y-1.5">
            {(world?.rules ?? []).map((rule, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="pv-mono shrink-0 text-[10px] text-[hsl(var(--pv-text-faint))]">{i + 1}.</span>
                <input
                  defaultValue={rule}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== rule) updateRule(i, v); }}
                  className="pv-serif min-w-0 flex-1 border-b border-transparent bg-transparent py-0.5 text-[13.5px] text-foreground outline-none placeholder:text-[hsl(var(--pv-text-faint))] hover:border-[hsl(var(--pv-border-soft))] transition-colors"
                />
                <button type="button" onClick={() => removeRule(i)} className="shrink-0 text-[hsl(var(--pv-text-faint))] hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          {/* Add rule inline */}
          <div className="mt-2 flex items-center gap-2">
            <input
              value={newRule}
              onChange={(e) => setNewRule(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRule(); } }}
              placeholder="Add a constraint — Enter to save…"
              className="pv-serif min-w-0 flex-1 border-b border-[hsl(var(--pv-border-soft))] bg-transparent py-0.5 text-[13.5px] text-foreground outline-none placeholder:text-[hsl(var(--pv-text-faint))] focus:border-foreground/30 transition-colors"
            />
            <ActionLink icon={<Plus className="h-3.5 w-3.5" />} onClick={addRule} disabled={!newRule.trim()}>
              add
            </ActionLink>
          </div>
        </div>
      </Panel>
    </div>
  );
}

// ── F4a: Narration settings ───────────────────────────────────────────────────
// Placed at the bottom of the Voice sub-step: narration defaults are a voice-level concern (same
// step where the prose exemplar is set). Reads/writes foundations.narration via the parent's save().
const PERSON_OPTIONS: Array<{ value: Narration["person"]; label: string; hint: string }> = [
  { value: "first", label: "First person", hint: "I/me — intimate, limited" },
  { value: "close-third", label: "Close third", hint: "She/he — deep single POV" },
  { value: "omniscient", label: "Omniscient", hint: "God-view — multiple heads" },
];
const TENSE_OPTIONS: Array<{ value: Narration["tense"]; label: string }> = [
  { value: "past", label: "Past" },
  { value: "present", label: "Present" },
];

function NarrationSub({ narration, onSave }: { narration: Narration; onSave: (n: Narration) => Promise<void> | void }) {
  const patch = (p: Partial<Narration>) => void onSave({ ...narration, ...p });

  return (
    <Panel className="bg-[hsl(var(--pv-surface-2))]/40">
      <Eyebrow tone="muted">narration defaults</Eyebrow>
      <p className="pv-serif mt-1 mb-3 text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">
        Book-level POV and tense — every page honors these unless overridden.
      </p>

      {/* Person */}
      <div className="mb-3">
        <Eyebrow tone="faint" className="mb-2 block">person</Eyebrow>
        <div className="flex flex-wrap gap-2">
          {PERSON_OPTIONS.map(({ value, label, hint }) => (
            <button
              key={value}
              type="button"
              onClick={() => patch({ person: narration.person === value ? undefined : value })}
              className={`pv-serif rounded-full border px-3.5 py-1.5 text-[13.5px] transition-colors ${
                narration.person === value
                  ? "border-[hsl(var(--pv-accent))] bg-[hsl(var(--pv-accent))]/[0.08] text-[hsl(var(--pv-accent))]"
                  : "border-border text-[hsl(var(--pv-text-muted))] hover:border-foreground/30"
              }`}
              title={hint}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tense */}
      <div className="mb-3">
        <Eyebrow tone="faint" className="mb-2 block">tense</Eyebrow>
        <div className="flex flex-wrap gap-2">
          {TENSE_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => patch({ tense: narration.tense === value ? undefined : value })}
              className={`pv-serif rounded-full border px-3.5 py-1.5 text-[13.5px] transition-colors ${
                narration.tense === value
                  ? "border-[hsl(var(--pv-accent))] bg-[hsl(var(--pv-accent))]/[0.08] text-[hsl(var(--pv-accent))]"
                  : "border-border text-[hsl(var(--pv-text-muted))] hover:border-foreground/30"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Distance — optional free text */}
      <div>
        <Eyebrow tone="faint" className="mb-1.5 block">distance (optional)</Eyebrow>
        <AutoTextarea
          defaultValue={narration.distance ?? ""}
          placeholder="e.g. 'deep interiority — thoughts bleed into prose' or 'detached observer, sparse interiority'…"
          onBlur={(e) => { const v = e.target.value.trim(); if (v !== (narration.distance ?? "")) patch({ distance: v || undefined }); }}
          className="pv-serif border-b border-transparent bg-transparent px-0 py-0 text-[14px] leading-relaxed text-foreground focus-visible:ring-0 placeholder:text-[hsl(var(--pv-text-faint))] hover:border-[hsl(var(--pv-border-soft))] transition-colors"
        />
      </div>
    </Panel>
  );
}

// ── Tentpoles sub-step ────────────────────────────────────────────────────────
// Unified list: all tentpoles in one column. Pinned = locked from AI. Add/edit/delete manually.
function TentpolesSub({ bookId, tentpoles, onSave }: {
  bookId: number;
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
        <GenerateInChat bookId={bookId} layer="foundations" label="Draft the foundations" />
        <p className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))]">Or add a moment by hand:</p>
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
