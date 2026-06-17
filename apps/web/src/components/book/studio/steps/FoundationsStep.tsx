// FoundationsStep — stage 2 of the pin-driven flow (docs/pinned_method.md §3.2): five sub-steps
// (Argument → Ending → Cast → Tentpoles → Voice) as one focused screen each, behind a horizontal
// progress strip. The AI proposes candidates (durable foundations_options runs); the author selects,
// edits, keeps or kills — and every explicit gesture PINS the record, which all downstream
// generation must hold. "skip — use AI default" auto-selects the first candidate, unpinned.
//
// Voice is absorbed here (old stage 4): the chosen exemplar is ALSO mirrored to
// books.bible.voice_sample so the existing prose renderers keep reading their anchor unchanged.
import { useEffect, useRef, useState } from "react";
import { Check, ImageIcon, Pin, Plus, Sparkles, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Textarea } from "@/components/ui/textarea";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { useToast } from "@/hooks/use-toast";
import { useAIRun } from "@/hooks/useAIRun";
import { composePortraitPrompt, renderPortraitVariants, uploadReferenceImage } from "@/lib/sceneImages";
import { ImageGenStudio } from "../ImageGenStudio";
import {
  foundationsProgress, pinNode, writeFoundations,
  type CastMember, type CastProposal, type FCandidate, type FNode, type Foundations, type FoundationsStepKey, type Tentpole,
} from "@/lib/foundations";
import { ActionLink, CollapsedRow, Eyebrow, GenRow, Hero, ImageLightbox, OptionCard, Panel, PickButton, RunError, SkeletonCard, SkeletonProposalCard } from "../studioUi";
import { DurableReviser } from "../../DurableReviser";

const uid = () => crypto.randomUUID().slice(0, 8);

// Per-sub-step nudge chips for the C-Directions GenRow.
const STEP_CHIPS: Record<FoundationsStepKey, string[]> = {
  argument: ["Darker claim", "More hopeful", "Higher stakes", "Sharper irony", "Push the subtext", "More ambiguous"],
  ending:   ["Bleaker", "More hopeful", "Higher cost", "More ambiguous", "Quieter landing", "Sharper reversal"],
  cast:     ["Different wound", "Invert the dynamic", "Darker lie", "More vulnerability", "Add conflict", "Younger protagonist"],
  tentpoles:["Earlier in arc", "More visceral", "Quieter turn", "More confrontation", "Shift the cost", "Change who's present"],
  voice:    ["Colder", "Warmer", "Tighter", "More interior", "Slower burn", "More sensory"],
};

const SUBS: { key: FoundationsStepKey; label: string; caption: string }[] = [
  { key: "argument", label: "Argument", caption: "The claim the whole story argues — pick the one you'd defend." },
  { key: "ending", label: "Ending", caption: "Where it lands. Settled now, every route must reach it." },
  { key: "cast", label: "Cast", caption: "Protagonist and majors — want, wound, and the lie the arc breaks." },
  { key: "tentpoles", label: "Tentpoles", caption: "Moments you already see. Keep, kill, or write your own — at least three." },
  { key: "voice", label: "Voice", caption: "One pinned moment, three soundscapes — the chosen one anchors every page." },
];

interface Props {
  bookId: number;
  foundations: Foundations;
  onChanged: () => void;
}

export function FoundationsStep({ bookId, foundations, onChanged }: Props) {
  const beforeGen = async () => {};  // steer removed — no-op
  const { toast } = useToast();
  const [f, setF] = useState<Foundations>(foundations);
  // Land on the first incomplete sub-step, then move only on explicit clicks — selecting a candidate
  // must not yank the screen forward while the author might still want to edit it.
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
      {/* Sub-step progress strip — same dot language as the rail's check circles. */}
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
        <NodeSub bookId={bookId} stepKey="argument" node={f.argument} beforeGen={beforeGen}
          heroTitle="Propose three arguments" heroSub="Three claims the book could argue, each with the ending it implies. Pick the one you'd defend — or edit it into yours."
          onSave={(n) => save({ ...f, argument: n })} />
      )}
      {active === "ending" && (
        <NodeSub bookId={bookId} stepKey="ending" node={f.ending} beforeGen={beforeGen}
          heroTitle="Propose three endings" heroSub="Three ways the selected argument can land. Picking one settles where every route must arrive."
          blockedReason={!f.argument?.text?.trim() ? "Select an argument first." : undefined}
          onSave={(n) => save({ ...f, ending: n })} />
      )}
      {active === "cast" && (
        <CastSub bookId={bookId} cast={f.cast ?? []} beforeGen={beforeGen} onSave={(cast) => save({ ...f, cast })} />
      )}
      {active === "tentpoles" && (
        <TentpolesSub bookId={bookId} tentpoles={f.tentpoles ?? []} beforeGen={beforeGen} onSave={(tentpoles) => save({ ...f, tentpoles })} />
      )}
      {active === "voice" && (
        <NodeSub bookId={bookId} stepKey="voice" node={f.voice_exemplar} beforeGen={beforeGen}
          heroTitle="Render one moment in three voices" heroSub="The same tentpole moment, ~120 words, three distinct soundscapes. The one you choose IS the voice exemplar."
          blockedReason={(f.tentpoles ?? []).filter((t) => t.status !== "killed").length === 0 ? "Add at least one tentpole moment first." : undefined}
          onSave={async (n) => { await save({ ...f, voice_exemplar: n }); if (n.text?.trim()) await mirrorVoice(n.text); }} />
      )}

    </div>
  );
}

// ── Shared single-select node sub-step (argument / ending / voice) ───────────
function NodeSub({ bookId, stepKey, node, heroTitle, heroSub, blockedReason, beforeGen, onSave }: {
  bookId: number;
  stepKey: FoundationsStepKey;
  node: FNode | undefined;
  heroTitle: string;
  heroSub: string;
  blockedReason?: string;
  beforeGen: () => Promise<void>;
  onSave: (n: FNode) => Promise<void> | void;
}) {
  const run = useAIRun<{ candidates: FCandidate[] }>({ bookId, kind: "foundations_options", targetKey: `foundations:${stepKey}` });
  const appliedRef = useRef<number | null>(null);
  const autoPickRef = useRef(false);
  const [draft, setDraft] = useState<string | null>(null); // inline edit buffer for the selected text

  const fire = async (note: string) => { await beforeGen(); void run.start({ step: stepKey, ...(note.trim() ? { prompt: note.trim() } : {}) }); };
  const fireSkip = async () => { autoPickRef.current = true; await beforeGen(); void run.start({ step: stepKey }); };

  const generating = run.starting || run.run?.status === "running" || run.run?.status === "pending";

  // Candidates land → APPEND to the existing pool (not replace). Auto-select the first new one on "skip".
  useEffect(() => {
    const r = run.run;
    if (r?.status === "ready" && r.result?.candidates?.length && appliedRef.current !== r.id) {
      appliedRef.current = r.id;
      void run.accept(async (res) => {
        const existing = node?.candidates ?? [];
        const next: FNode = { ...(node ?? {}), candidates: [...existing, ...res.candidates] };
        if (autoPickRef.current && !node?.pinned) { next.text = res.candidates[0]?.text; next.pinned = false; }
        autoPickRef.current = false;
        await onSave(next);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.run?.id, run.run?.status]);

  if (blockedReason) return <p className="pv-serif text-[14px] italic text-[hsl(var(--pv-text-faint))]">{blockedReason}</p>;

  const candidates = node?.candidates ?? [];
  const selected = (node?.text ?? "").trim();
  const pinnedAndNotInCandidates = selected !== "" && !candidates.some((c) => c.text.trim() === selected);

  // Initial state with no existing cards — show skeletons directly (nothing to keep behind them).
  if (generating && candidates.length === 0 && !selected) {
    return (
      <div className="space-y-3">
        <p className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))]">
          Creating candidates…{" "}
          <button type="button" onClick={() => void run.cancel()}
            className="underline-offset-2 hover:text-foreground hover:underline transition-colors">cancel</button>
        </p>
        {[0, 1, 2].map((i) => <SkeletonCard key={i} />)}
      </div>
    );
  }

  if (!generating && candidates.length === 0 && !selected) {
    return (
      <div>
        <Hero icon={<Sparkles className="h-5 w-5" />} title={heroTitle} sub={heroSub} onClick={() => void fire("")} />
        <div className="mt-4 space-y-2.5">
          <GenRow chips={STEP_CHIPS[stepKey]} label="Propose options" onFire={(note) => void fire(note)} />
          <SkipLink onClick={() => void fireSkip()} />
        </div>
        {run.run?.status === "error" && <RunError msg={run.run.error} />}
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      {/* Approved text that's no longer in the candidate list — show at TOP as the anchor. */}
      {pinnedAndNotInCandidates && (
        <Panel variant="chosen">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <Eyebrow>Chosen · yours</Eyebrow>
          </div>
          <Textarea
            value={draft ?? selected}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => { if (draft != null && draft.trim() !== selected) void onSave(pinNode(node, draft.trim())); setDraft(null); }}
            rows={Math.max(3, Math.ceil((draft ?? selected).length / 80))}
            className="pv-serif border-none bg-transparent px-0 text-[15.5px] leading-[1.65] focus-visible:ring-0"
          />
          <DurableReviser
            bookId={bookId} layer={stepKey} targetKey={`foundations:${stepKey}:revise`}
            current={selected} onApply={async (text) => { await onSave(pinNode(node, text)); }} label="revise →"
          />
        </Panel>
      )}
      {candidates.map((c, idx) => {
        const isSelected = selected !== "" && c.text.trim() === selected;
        const candidateLabel = c.label || `Candidate ${String.fromCharCode(65 + idx)}`;
        // Collapse non-selected candidates to a compact row once a selection has been made.
        if (!isSelected && selected) {
          return (
            <CollapsedRow key={c.id} label={candidateLabel} text={c.text}
              onPick={() => void onSave(pinNode(node, c.text))}
              onRemove={() => void onSave({ ...(node ?? {}), candidates: candidates.filter((x) => x.id !== c.id) })} />
          );
        }
        if (isSelected) {
          return (
            <Panel key={c.id} variant="chosen">
              <div className="mb-2.5 flex items-center justify-between gap-3">
                <Eyebrow>{candidateLabel}</Eyebrow>
                <PickButton selected>Chosen</PickButton>
              </div>
              <Textarea
                value={draft ?? selected}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => { if (draft != null && draft.trim() !== selected) void onSave(pinNode(node, draft.trim())); setDraft(null); }}
                rows={Math.max(3, Math.ceil((draft ?? selected).length / 80))}
                className="pv-serif border-none bg-transparent px-0 text-[15.5px] leading-[1.65] focus-visible:ring-0"
              />
              <DurableReviser
                bookId={bookId} layer={stepKey} targetKey={`foundations:${stepKey}:revise`}
                current={selected} onApply={async (text) => { await onSave(pinNode(node, text)); }} label="revise →"
              />
            </Panel>
          );
        }
        return (
          <OptionCard key={c.id} label={candidateLabel} onPick={() => void onSave(pinNode(node, c.text))} pickLabel="Select">
            <p className="pv-serif whitespace-pre-wrap text-[15.5px] leading-[1.65] text-foreground">{c.text}</p>
            {c.implied_ending && <p className="pv-serif mt-2.5 text-[13.5px] italic text-[hsl(var(--pv-text-muted))]">implied ending: {c.implied_ending}</p>}
          </OptionCard>
        );
      })}
      {generating ? (
        <div className="space-y-3">
          <p className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))]">
            Adding more options…{" "}
            <button type="button" onClick={() => void run.cancel()}
              className="underline-offset-2 hover:text-foreground hover:underline transition-colors">cancel</button>
          </p>
          {[0, 1, 2].map((i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <div className="mt-1 space-y-2.5">
          <GenRow
            chips={STEP_CHIPS[stepKey]}
            label="Propose more"
            descLabel="Adds fresh takes below — your chosen one stays selected."
            onFire={(note) => void fire(note)}
          />
          {!selected && <SkipLink onClick={() => void fireSkip()} />}
        </div>
      )}
      {run.run?.status === "error" && <RunError msg={run.run.error} />}
    </div>
  );
}

// ── Cast sub-step ─────────────────────────────────────────────────────────────
const CAST_FIELDS = ["want", "wound", "lie"] as const;

function CastSub({ bookId, cast, beforeGen, onSave }: { bookId: number; cast: CastMember[]; beforeGen: () => Promise<void>; onSave: (c: CastMember[]) => Promise<void> | void }) {
  const run = useAIRun<{ proposals: CastProposal[] }>({ bookId, kind: "foundations_options", targetKey: "foundations:cast" });
  const generating = run.starting || run.run?.status === "running" || run.run?.status === "pending";
  const proposals = run.run?.status === "ready" ? (run.run.result?.proposals ?? []) : [];

  const fire = async (note: string) => {
    await beforeGen();
    void run.start({ step: "cast", ...(note.trim() ? { prompt: note.trim() } : {}) });
  };

  const pickProposal = (p: CastProposal) => {
    void run.accept(async () => { await onSave(p.members); });
  };

  const update = (id: string, patch: Partial<CastMember>, pinField?: string) => {
    void onSave(cast.map((m) => {
      if (m.id !== id) return m;
      const pinned_fields = pinField && !(m.pinned_fields ?? []).includes(pinField)
        ? [...(m.pinned_fields ?? []), pinField] : m.pinned_fields;
      return { ...m, ...patch, pinned_fields };
    }));
  };

  // Proposals ready — show the pick-one UI (overlays the editing ui if cast already exists).
  if (proposals.length > 0) {
    return (
      <div className="space-y-4">
        <p className="pv-serif text-[14px] italic text-[hsl(var(--pv-text-muted))]">
          Three different takes on who this story is about — pick the one you'd defend.
        </p>
        {proposals.map((prop) => (
          <OptionCard key={prop.label} label={prop.label} onPick={() => pickProposal(prop)} pickLabel={cast.length ? "Switch to this" : "Choose this cast"}>
            <div className="space-y-4">
              {prop.members.map((m) => (
                <div key={m.id}>
                  <p className="pv-serif mb-1.5 text-[16px] font-semibold text-foreground">
                    {m.name}
                    <span className="pv-mono ml-2 text-[9.5px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))] font-normal">{m.role ?? "major"}</span>
                  </p>
                  <div className="space-y-1.5">
                    {CAST_FIELDS.map((k) => m[k] && (
                      <div key={k} className="flex gap-3">
                        <Eyebrow tone="muted" className="w-14 shrink-0">{k}</Eyebrow>
                        <p className="pv-serif text-[14px] leading-snug text-foreground">{m[k]}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </OptionCard>
        ))}
        <div className="space-y-2.5">
          <GenRow chips={STEP_CHIPS.cast} label="Propose different options" descLabel="Adds new configurations below." onFire={(note) => void fire(note)} />
          {cast.length > 0 && (
            <button type="button" onClick={() => void run.reject()}
              className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))] hover:text-foreground">
              dismiss — keep current cast
            </button>
          )}
        </div>
        {run.run?.status === "error" && <RunError msg={run.run.error} />}
      </div>
    );
  }

  // No cast yet — hero state (with skeletons if generating).
  if (cast.length === 0) {
    if (generating) {
      return (
        <div className="space-y-3">
          <p className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))]">
            Creating cast options…{" "}
            <button type="button" onClick={() => void run.cancel()}
              className="underline-offset-2 hover:text-foreground hover:underline transition-colors">cancel</button>
          </p>
          {[0, 1, 2].map((i) => <SkeletonProposalCard key={i} />)}
        </div>
      );
    }
    return (
      <div>
        <Hero icon={<Sparkles className="h-5 w-5" />} title="Propose three cast options"
          sub="Three complete configurations — protagonist plus majors, each with want / wound / lie. Pick the one you'd defend, then edit freely."
          onClick={() => void fire("")} />
        <div className="mt-4">
          <GenRow chips={STEP_CHIPS.cast} label="Propose options" onFire={(note) => void fire(note)} />
        </div>
        {run.run?.status === "error" && <RunError msg={run.run.error} />}
      </div>
    );
  }

  // Cast exists — editing mode. Skeletons appear below while new proposals are being created.
  return (
    <div className="space-y-3.5">
      {cast.map((m) => (
        <Panel key={m.id} className="bg-[hsl(var(--pv-surface-2))]/40">
          <div className="mb-3 flex items-center justify-between gap-3">
            <input
              defaultValue={m.name}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== m.name) update(m.id, { name: v }); }}
              className="pv-serif w-full max-w-[280px] border-none bg-transparent text-[18px] font-semibold text-foreground outline-none"
            />
            <div className="flex items-center gap-3">
              <Eyebrow>{m.role ?? "major"}</Eyebrow>
              <button type="button" onClick={() => { if (window.confirm(`Remove ${m.name}?`)) void onSave(cast.filter((x) => x.id !== m.id)); }}
                className="text-[hsl(var(--pv-text-faint))] hover:text-foreground" aria-label="Remove character">
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
                  {isPinned && (
                    <button type="button" title="Pinned — click to unpin" onClick={() => { if (window.confirm(`Unpin ${m.name}'s ${k}? Regeneration may rewrite it.`)) update(m.id, { pinned_fields: (m.pinned_fields ?? []).filter((x) => x !== k) } as Partial<CastMember>); }}>
                      <Pin className="h-3 w-3 text-[hsl(var(--pv-accent))]" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <CastLook bookId={bookId} member={m} onUpdate={(patch) => update(m.id, patch)} />
        </Panel>
      ))}
      {generating ? (
        <div className="space-y-3">
          <p className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))]">
            Proposing cast options…{" "}
            <button type="button" onClick={() => void run.cancel()}
              className="underline-offset-2 hover:text-foreground hover:underline transition-colors">cancel</button>
          </p>
          {[0, 1, 2].map((i) => <SkeletonProposalCard key={i} />)}
        </div>
      ) : (
        <div className="space-y-3">
          <ActionLink
            icon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => void onSave([...cast, { id: uid(), name: "New character", role: cast.length ? "major" : "protagonist", pinned_fields: [...CAST_FIELDS] }])}
          >
            add character
          </ActionLink>
          <GenRow chips={STEP_CHIPS.cast} label="Propose new cast options" descLabel="Adds fresh configurations below." onFire={(note) => void fire(note)} />
        </div>
      )}
      {run.run?.status === "error" && <RunError msg={run.run.error} />}
    </div>
  );
}

// "Design the look" — per-character appearance + a SET of reference portraits (different angles/views,
// AI-generated or uploaded) that scene generation reuses for coherence. Portraits are kept in local
// state so rapid "add"s append correctly, persisted to foundations (single writer) on each change.
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
function TentpolesSub({ bookId, tentpoles, beforeGen, onSave }: { bookId: number; tentpoles: Tentpole[]; beforeGen: () => Promise<void>; onSave: (t: Tentpole[]) => Promise<void> | void }) {
  const run = useAIRun<{ candidates: Tentpole[] }>({ bookId, kind: "foundations_options", targetKey: "foundations:tentpoles" });
  const appliedRef = useRef<number | null>(null);
  const [newMoment, setNewMoment] = useState("");
  const generating = run.starting || run.run?.status === "running" || run.run?.status === "pending";
  const fire = async (note: string) => {
    await beforeGen();
    void run.start({ step: "tentpoles", ...(note.trim() ? { prompt: note.trim() } : {}) });
  };

  useEffect(() => {
    const r = run.run;
    if (r?.status === "ready" && r.result?.candidates?.length && appliedRef.current !== r.id) {
      appliedRef.current = r.id;
      void run.accept(async (res) => {
        const have = new Set(tentpoles.map((t) => t.id));
        await onSave([...tentpoles, ...res.candidates.filter((c) => !have.has(c.id))]);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.run?.id, run.run?.status]);

  // Pinned = author's own + AI cards the author explicitly kept.
  const pinnedCards = tentpoles.filter((t) => t.source === "author" || t.status === "pinned");
  // Proposals = AI cards still awaiting the author's verdict.
  const proposalCards = tentpoles.filter((t) => t.source === "ai" && t.status === "fluid");

  const liveCount = pinnedCards.length + proposalCards.length;
  const pinnedCount = tentpoles.filter((t) => t.status === "pinned").length;

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

  const colHeader = (label: string) => (
    <h3 className="pv-mono mb-2.5 text-[10px] uppercase tracking-[0.16em] text-[hsl(var(--pv-text-muted))]">{label}</h3>
  );

  return (
    <div>
      <p className="pv-serif mb-4 text-[13px] italic text-[hsl(var(--pv-text-muted))]">
        {liveCount} moment{liveCount === 1 ? "" : "s"} on the board — at least 3 to proceed.
        {pinnedCount > 0 && ` ${pinnedCount} pinned: every spine route must pass through them.`}
      </p>
      <div className="grid gap-5 grid-cols-1 lg:grid-cols-2">

        {/* ── Pinned ── */}
        <div>
          {colHeader("Pinned")}
          <div className="space-y-2.5">
            {pinnedCards.map((t) => (
              <TentpoleCard key={t.id} t={t} bookId={bookId}
                onText={(v) => setText(t.id, v)}
                onUnpin={t.source === "ai" ? () => unpinCard(t.id) : undefined}
                onDelete={() => deleteCard(t.id)} />
            ))}
            <div className="rounded-2xl border border-dashed border-border px-4 py-3">
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
            </div>
          </div>
        </div>

        {/* ── Proposals ── */}
        <div>
          {colHeader("Proposals")}
          <div className="space-y-2.5">
            {proposalCards.map((t) => (
              <TentpoleCard key={t.id} t={t} bookId={bookId}
                onText={(v) => setText(t.id, v)}
                onPin={() => pinCard(t.id)}
                onDelete={() => deleteCard(t.id)} />
            ))}
            {generating && (
              <>
                <p className="px-1 text-[12px] text-muted-foreground/60">Proposing moments…</p>
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </>
            )}
            {!generating && (
              <GenRow
                chips={STEP_CHIPS.tentpoles}
                label={proposalCards.length ? `Propose more${pinnedCount ? ` (${pinnedCount} pinned held)` : ""}` : "Propose moments"}
                descLabel={proposalCards.length ? "Adds fresh moments below — pinned ones stay." : undefined}
                onFire={(note) => void fire(note)}
              />
            )}
            {run.run?.status === "error" && <RunError msg={run.run.error} />}
          </div>
        </div>

      </div>
    </div>
  );
}

function TentpoleCard({ t, onText, onPin, onUnpin, onDelete, bookId }: { t: Tentpole; onText: (v: string) => void; onPin?: () => void; onUnpin?: () => void; onDelete: () => void; bookId?: number }) {
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
        {pinned && <span className="pv-mono inline-flex items-center gap-1 text-[9.5px] uppercase tracking-[0.12em] text-[hsl(var(--pv-accent))]"><Pin className="h-3 w-3" /> pinned</span>}
        {onUnpin && (
          <button type="button" onClick={onUnpin} className="pv-serif inline-flex items-center gap-1 text-[12.5px] italic text-[hsl(var(--pv-text-faint))] hover:opacity-75">
            <Pin className="h-3 w-3" /> unpin
          </button>
        )}
        {onPin && (
          <button type="button" onClick={onPin} className="pv-serif inline-flex items-center gap-1 text-[12.5px] italic text-[hsl(var(--pv-accent))] hover:opacity-75">
            <Check className="h-3 w-3" /> pin
          </button>
        )}
        {bookId != null && (
          <DurableReviser
            bookId={bookId}
            layer="tentpole"
            targetKey={`foundations:tentpole-revise:${t.id}`}
            current={t.text}
            onApply={async (text) => { onText(text); }}
            label="revise"
          />
        )}
        <button type="button" onClick={onDelete} className="pv-serif inline-flex items-center gap-1 text-[12.5px] italic text-[hsl(var(--pv-text-faint))] hover:text-destructive/70 transition-colors">
          <X className="h-3 w-3" /> discard
        </button>
      </div>
    </Panel>
  );
}

// ── Small shared bits ─────────────────────────────────────────────────────────
function SkipLink({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="pv-serif mt-3 text-[13px] italic text-[hsl(var(--pv-text-faint))] hover:text-foreground">
      skip — use AI default (auto-selects, stays unpinned)
    </button>
  );
}

