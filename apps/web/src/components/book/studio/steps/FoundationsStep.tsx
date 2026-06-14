// FoundationsStep — stage 2 of the pin-driven flow (docs/pinned_method.md §3.2): five sub-steps
// (Argument → Ending → Cast → Tentpoles → Voice) as one focused screen each, behind a horizontal
// progress strip. The AI proposes candidates (durable foundations_options runs); the author selects,
// edits, keeps or kills — and every explicit gesture PINS the record, which all downstream
// generation must hold. "skip — use AI default" auto-selects the first candidate, unpinned.
//
// Voice is absorbed here (old stage 4): the chosen exemplar is ALSO mirrored to
// books.bible.voice_sample so the existing prose renderers keep reading their anchor unchanged.
import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Pin, Plus, RefreshCw, Skull, Sparkles, Undo2, Wand2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Textarea } from "@/components/ui/textarea";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { useToast } from "@/hooks/use-toast";
import { useAIRun } from "@/hooks/useAIRun";
import {
  foundationsProgress, pinNode, writeFoundations,
  type CastMember, type FCandidate, type FNode, type Foundations, type FoundationsStepKey, type Tentpole,
} from "@/lib/foundations";
import { ActionLink, Eyebrow, Hero, Panel, RunError, RunningInline } from "../studioUi";

const uid = () => crypto.randomUUID().slice(0, 8);

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
  /** Persist the step's author steer before any generation kicks (provided by StudioStage). */
  beforeGen: () => Promise<void>;
  onChanged: () => void;
  onVoiceStatus: (v: boolean) => void;
}

export function FoundationsStep({ bookId, foundations, beforeGen, onChanged, onVoiceStatus }: Props) {
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

  // Legacy voice mapping: the exemplar is also the few-shot anchor the prose renderers read.
  const mirrorVoice = async (text: string) => {
    const { data } = await supabase.from("books").select("bible").eq("id", bookId).maybeSingle();
    const bible = { ...((data?.bible as Record<string, unknown> | null) ?? {}), voice_sample: text };
    await supabase.from("books").update({ bible }).eq("id", bookId);
    onVoiceStatus(!!text.trim());
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

  // Persist the foundations steer before kicking, so the worker reads the fresh guidance.
  const fire = async () => { await beforeGen(); void run.start({ step: stepKey }); };
  const fireSkip = async () => { autoPickRef.current = true; await beforeGen(); void run.start({ step: stepKey }); };

  const generating = run.starting || run.run?.status === "running" || run.run?.status === "pending";

  // Candidates land → persist them into the node (and auto-select the first, unpinned, on "skip").
  useEffect(() => {
    const r = run.run;
    if (r?.status === "ready" && r.result?.candidates?.length && appliedRef.current !== r.id) {
      appliedRef.current = r.id;
      void run.accept(async (res) => {
        const next: FNode = { ...(node ?? {}), candidates: res.candidates };
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

  if (generating) {
    return (
      <div>
        {/* Keep the pinned card visible during loading so the author knows it's held safe. */}
        {node?.pinned && selected && (
          <Panel className="mb-4 border-[hsl(var(--pv-accent))]/30 bg-[hsl(var(--pv-surface-2))]/40 opacity-60">
            <Eyebrow>Pinned · held through generation</Eyebrow>
            <p className="pv-serif mt-2 whitespace-pre-wrap text-[15px] leading-[1.65] text-foreground/70">{selected}</p>
          </Panel>
        )}
        <RunningInline label="Proposing candidates…" onCancel={() => void run.cancel()} />
      </div>
    );
  }

  if (candidates.length === 0 && !selected) {
    return (
      <div>
        <Hero icon={<Sparkles className="h-5 w-5" />} title={heroTitle} sub={heroSub} onClick={() => void fire()} />
        <SkipLink onClick={() => void fireSkip()} />
        {run.run?.status === "error" && <RunError msg={run.run.error} />}
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      {/* Approved text that's no longer in the candidate list — show at TOP as the anchor. */}
      {pinnedAndNotInCandidates && (
        <Panel className="border-[hsl(var(--pv-accent))]/45 bg-[hsl(var(--pv-surface-2))]/60">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <Eyebrow>Approved · yours</Eyebrow>
            {node?.pinned && <PinBadge onUnpin={() => void onSave({ ...node, pinned: false })} />}
          </div>
          <Textarea
            value={draft ?? selected}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => { if (draft != null && draft.trim() !== selected) void onSave(pinNode(node, draft.trim())); setDraft(null); }}
            rows={Math.max(3, Math.ceil((draft ?? selected).length / 80))}
            className="pv-serif border-none bg-transparent px-0 text-[15.5px] leading-[1.65] focus-visible:ring-0"
          />
        </Panel>
      )}
      {candidates.map((c, idx) => {
        const isSelected = selected !== "" && c.text.trim() === selected;
        const candidateLabel = c.label || `Candidate ${String.fromCharCode(65 + idx)}`;
        // Collapse non-selected candidates to a compact row once a selection has been made.
        if (!isSelected && selected) {
          return (
            <div key={c.id} className="flex items-center gap-3 rounded-xl border border-[hsl(var(--pv-border-soft))]/80 bg-[hsl(var(--pv-surface-2))]/30 px-5 py-2.5">
              <span className="pv-mono shrink-0 text-[9.5px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-faint))]">{candidateLabel}</span>
              <p className="pv-serif flex-1 truncate text-[13.5px] italic leading-snug text-[hsl(var(--pv-text-faint))]">{c.text}</p>
              <button type="button" onClick={() => void onSave(pinNode(node, c.text))}
                className="pv-serif shrink-0 text-[12.5px] italic text-[hsl(var(--pv-text-muted))] hover:text-foreground transition-colors">
                switch
              </button>
            </div>
          );
        }
        return (
          <div key={c.id} className={`rounded-2xl border px-6 py-5 transition-colors ${isSelected ? "border-[hsl(var(--pv-accent))]/45 bg-[hsl(var(--pv-surface-2))]/60 shadow-[0_10px_30px_rgba(0,0,0,0.05)]" : "border-border bg-[hsl(var(--pv-surface-2))]/40"}`}>
            <div className="mb-2.5 flex items-center justify-between gap-3">
              <Eyebrow>{candidateLabel}</Eyebrow>
              <div className="flex items-center gap-2.5">
                {isSelected && node?.pinned && <PinBadge onUnpin={() => void onSave({ ...node, pinned: false })} />}
                <button
                  type="button"
                  onClick={() => void onSave(pinNode(node, c.text))}
                  disabled={isSelected}
                  className={`pv-serif inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13.5px] transition-colors disabled:opacity-100 ${isSelected ? "bg-primary text-primary-foreground" : "border border-border text-foreground hover:border-foreground/40"}`}
                >
                  {isSelected ? <Check className="h-3.5 w-3.5" /> : null}
                  {isSelected ? "Approved" : "Select"}
                </button>
              </div>
            </div>
            {isSelected ? (
              <Textarea
                value={draft ?? selected}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => { if (draft != null && draft.trim() !== selected) void onSave(pinNode(node, draft.trim())); setDraft(null); }}
                rows={Math.max(3, Math.ceil((draft ?? selected).length / 80))}
                className="pv-serif border-none bg-transparent px-0 text-[15.5px] leading-[1.65] focus-visible:ring-0"
              />
            ) : (
              <p className="pv-serif whitespace-pre-wrap text-[15.5px] leading-[1.65] text-foreground">{c.text}</p>
            )}
            {c.implied_ending && <p className="pv-serif mt-2.5 text-[13.5px] italic text-[hsl(var(--pv-text-muted))]">implied ending: {c.implied_ending}</p>}
          </div>
        );
      })}
      <div className="flex items-center gap-5">
        <ActionLink icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void fire()}>
          regenerate{node?.pinned ? " (your approved text is held)" : ""}
        </ActionLink>
        {!selected && <SkipLink onClick={() => void fireSkip()} />}
      </div>
      {run.run?.status === "error" && <RunError msg={run.run.error} />}
    </div>
  );
}

// ── Cast sub-step ─────────────────────────────────────────────────────────────
const CAST_FIELDS = ["want", "wound", "lie"] as const;

function CastSub({ bookId, cast, beforeGen, onSave }: { bookId: number; cast: CastMember[]; beforeGen: () => Promise<void>; onSave: (c: CastMember[]) => Promise<void> | void }) {
  const run = useAIRun<{ candidates: CastMember[] }>({ bookId, kind: "foundations_options", targetKey: "foundations:cast" });
  const appliedRef = useRef<number | null>(null);
  const generating = run.starting || run.run?.status === "running" || run.run?.status === "pending";
  const fire = async () => { await beforeGen(); void run.start({ step: "cast" }); };

  // Merge AI candidates: a redraft REWRITES every unpinned field on an existing member (by name) with
  // the steered candidate — pinned lines are held verbatim (§4 rule 2b). A blank candidate field keeps
  // the prior value. Unknown names are appended.
  useEffect(() => {
    const r = run.run;
    if (r?.status === "ready" && r.result?.candidates?.length && appliedRef.current !== r.id) {
      appliedRef.current = r.id;
      void run.accept(async (res) => {
        const next = [...cast];
        for (const cand of res.candidates) {
          const existing = next.find((m) => m.name.trim().toLowerCase() === cand.name.trim().toLowerCase());
          if (existing) {
            for (const k of CAST_FIELDS) {
              if ((existing.pinned_fields ?? []).includes(k)) continue;
              if (cand[k]?.trim()) existing[k] = cand[k];
            }
          } else {
            next.push(cand);
          }
        }
        await onSave(next);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.run?.id, run.run?.status]);

  const pinnedCount = cast.reduce((n, m) => n + (m.pinned_fields?.length ?? 0), 0);

  const update = (id: string, patch: Partial<CastMember>, pinField?: string) => {
    void onSave(cast.map((m) => {
      if (m.id !== id) return m;
      const pinned_fields = pinField && !(m.pinned_fields ?? []).includes(pinField)
        ? [...(m.pinned_fields ?? []), pinField] : m.pinned_fields;
      return { ...m, ...patch, pinned_fields };
    }));
  };

  if (generating) {
    return <RunningInline label="Drafting the cast…" onCancel={() => void run.cancel()} />;
  }

  return (
    <div className="space-y-3.5">
      {cast.length === 0 && (
        <div>
          <Hero icon={<Sparkles className="h-5 w-5" />} title="Draft the cast"
            sub="Protagonist plus up to two majors, each with want / wound / lie. Edit any line to make it yours — edited lines are pinned."
            onClick={() => void fire()} />
          <SkipLink onClick={() => void fire()} />
        </div>
      )}
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
        </Panel>
      ))}
      <div className="flex items-center gap-5">
        <ActionLink
          icon={<Plus className="h-3.5 w-3.5" />}
          onClick={() => void onSave([...cast, { id: uid(), name: "New character", role: cast.length ? "major" : "protagonist", pinned_fields: [...CAST_FIELDS] }])}
        >
          add character
        </ActionLink>
        {cast.length > 0 && (
          <ActionLink icon={<RefreshCw className="h-3.5 w-3.5" />} tone="muted" onClick={() => void fire()}>
            regenerate{pinnedCount ? ` (${pinnedCount} pinned line${pinnedCount === 1 ? "" : "s"} held)` : ""}
          </ActionLink>
        )}
      </div>
      {run.run?.status === "error" && <RunError msg={run.run.error} />}
    </div>
  );
}

// ── Tentpoles sub-step ────────────────────────────────────────────────────────
function TentpolesSub({ bookId, tentpoles, beforeGen, onSave }: { bookId: number; tentpoles: Tentpole[]; beforeGen: () => Promise<void>; onSave: (t: Tentpole[]) => Promise<void> | void }) {
  const run = useAIRun<{ candidates: Tentpole[] }>({ bookId, kind: "foundations_options", targetKey: "foundations:tentpoles" });
  const appliedRef = useRef<number | null>(null);
  const [newMoment, setNewMoment] = useState("");
  const generating = run.starting || run.run?.status === "running" || run.run?.status === "pending";
  const fire = async () => { await beforeGen(); void run.start({ step: "tentpoles" }); };

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

  const authorCards = tentpoles.filter((t) => t.source === "author");
  const proposals = tentpoles.filter((t) => t.source === "ai" && t.status !== "killed");
  const killed = tentpoles.filter((t) => t.status === "killed");
  const liveCount = tentpoles.filter((t) => t.status !== "killed").length;
  const pinnedCount = tentpoles.filter((t) => t.status === "pinned").length;

  const setStatus = (id: string, status: Tentpole["status"]) =>
    void onSave(tentpoles.map((t) => (t.id === id ? { ...t, status } : t)));
  const setText = (id: string, text: string) =>
    void onSave(tentpoles.map((t) => (t.id === id ? { ...t, text, status: "pinned" } : t)));

  const addAuthor = () => {
    const text = newMoment.trim();
    if (!text) return;
    setNewMoment("");
    void onSave([...tentpoles, { id: uid(), text, source: "author", status: "pinned" }]);
  };

  return (
    <div>
      <p className="pv-serif mb-4 text-[13px] italic text-[hsl(var(--pv-text-muted))]">
        {liveCount} moment{liveCount === 1 ? "" : "s"} on the board — at least 3 to proceed.
        {pinnedCount > 0 && ` ${pinnedCount} pinned: every spine route must pass through them.`}
      </p>
      <div className="grid gap-5 md:grid-cols-2">
        {/* Left: moments the author already sees (always pinned). */}
        <div>
          <h3 className="pv-mono mb-2.5 text-[10px] uppercase tracking-[0.16em] text-[hsl(var(--pv-text-muted))]">Moments you already see</h3>
          <div className="space-y-2.5">
            {authorCards.map((t) => (
              <TentpoleCard key={t.id} t={t} bookId={bookId} onText={(v) => setText(t.id, v)} onKill={() => setStatus(t.id, "killed")} />
            ))}
            <div className="rounded-2xl border border-dashed border-border px-4 py-3">
              <Textarea
                value={newMoment}
                onChange={(e) => setNewMoment(e.target.value)}
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
        {/* Right: AI proposals with keep / kill / edit. */}
        <div>
          <h3 className="pv-mono mb-2.5 text-[10px] uppercase tracking-[0.16em] text-[hsl(var(--pv-text-muted))]">Proposals</h3>
          {generating ? (
            <RunningInline className="py-2" label="Proposing moments…" onCancel={() => void run.cancel()} />
          ) : (
            <div className="space-y-2.5">
              {proposals.map((t) => (
                <TentpoleCard key={t.id} t={t} bookId={bookId}
                  onText={(v) => setText(t.id, v)}
                  onKeep={t.status === "fluid" ? () => setStatus(t.id, "pinned") : undefined}
                  onKill={() => setStatus(t.id, "killed")} />
              ))}
              <ActionLink icon={proposals.length ? <RefreshCw className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />} onClick={() => void fire()}>
                {proposals.length ? `propose more (${pinnedCount} pinned held)` : "propose six moments"}
              </ActionLink>
            </div>
          )}
        </div>
      </div>
      {killed.length > 0 && (
        <div className="mt-5 border-t border-[hsl(var(--pv-border-soft))] pt-3.5">
          <h3 className="pv-mono mb-2 text-[10px] uppercase tracking-[0.16em] text-[hsl(var(--pv-text-faint))]">Killed — held as "not this" signal for regeneration</h3>
          <div className="space-y-1.5">
            {killed.map((t) => (
              <div key={t.id} className="flex items-baseline gap-2.5">
                <p className="pv-serif flex-1 text-[13px] italic leading-snug text-[hsl(var(--pv-text-faint))] line-through">{t.text}</p>
                <button type="button" onClick={() => setStatus(t.id, t.source === "author" ? "pinned" : "fluid")}
                  className="pv-serif inline-flex shrink-0 items-center gap-1 text-[12px] italic text-[hsl(var(--pv-text-muted))] hover:text-foreground">
                  <Undo2 className="h-3 w-3" /> restore
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {run.run?.status === "error" && <RunError msg={run.run.error} />}
    </div>
  );
}

function TentpoleCard({ t, onText, onKeep, onKill, bookId }: { t: Tentpole; onText: (v: string) => void; onKeep?: () => void; onKill: () => void; bookId?: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [revising, setRevising] = useState(false);
  const pinned = t.status === "pinned";
  return (
    <div className={`rounded-2xl border px-4 py-3 transition-colors ${pinned ? "border-[hsl(var(--pv-accent))]/45 bg-[hsl(var(--pv-surface-2))]/60" : "border-border bg-[hsl(var(--pv-surface-2))]/40"}`}>
      <Textarea
        value={draft ?? t.text}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft != null && draft.trim() && draft.trim() !== t.text) onText(draft.trim()); setDraft(null); }}
        rows={Math.max(2, Math.ceil((draft ?? t.text).length / 60))}
        className="pv-serif border-none bg-transparent px-0 text-[14px] leading-relaxed focus-visible:ring-0"
      />
      <div className="mt-1.5 flex items-center gap-3.5">
        {pinned && <span className="pv-mono inline-flex items-center gap-1 text-[9.5px] uppercase tracking-[0.12em] text-[hsl(var(--pv-accent))]"><Pin className="h-3 w-3" /> pinned</span>}
        {onKeep && (
          <button type="button" onClick={onKeep} className="pv-serif inline-flex items-center gap-1 text-[12.5px] italic text-[hsl(var(--pv-accent))] hover:opacity-75">
            <Check className="h-3 w-3" /> keep
          </button>
        )}
        {bookId != null && !revising && (
          <button type="button" onClick={() => setRevising(true)} className="pv-serif inline-flex items-center gap-1 text-[12.5px] italic text-[hsl(var(--pv-text-faint))] hover:text-foreground">
            <Wand2 className="h-3 w-3" /> revise
          </button>
        )}
        <button type="button" onClick={onKill} className="pv-serif inline-flex items-center gap-1 text-[12.5px] italic text-[hsl(var(--pv-text-faint))] hover:text-foreground">
          <Skull className="h-3 w-3" /> kill
        </button>
      </div>
      {revising && bookId != null && (
        <TentpoleRevisePanel
          bookId={bookId}
          tentpoleId={t.id}
          current={t.text}
          onDone={(text) => { onText(text); setRevising(false); }}
          onCancel={() => setRevising(false)}
        />
      )}
    </div>
  );
}

function TentpoleRevisePanel({ bookId, tentpoleId, current, onDone, onCancel }: {
  bookId: number;
  tentpoleId: string;
  current: string;
  onDone: (text: string) => void;
  onCancel: () => void;
}) {
  const [instruction, setInstruction] = useState("");
  const run = useAIRun<{ text: string }>({ bookId, kind: "tentpole_revise", targetKey: `foundations:tentpole-revise:${tentpoleId}` });
  const appliedRef = useRef<number | null>(null);
  const busy = run.starting || run.run?.status === "running" || run.run?.status === "pending";

  useEffect(() => {
    const r = run.run;
    if (r?.status === "ready" && r.result?.text && appliedRef.current !== r.id) {
      appliedRef.current = r.id;
      void run.accept(async (res) => { onDone(res.text); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.run?.id, run.run?.status]);

  const submit = () => {
    if (!instruction.trim() || busy) return;
    void run.start({ current, instruction: instruction.trim() });
  };

  return (
    <div className="mt-3 border-t border-[hsl(var(--pv-border-soft))] pt-3">
      <Textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}
        placeholder={`How should I revise this? e.g. "set it later in the story" or "raise the stakes"`}
        rows={2}
        disabled={busy}
        className="pv-serif border-[hsl(var(--pv-border-soft))] bg-transparent text-[13px] leading-relaxed focus-visible:ring-0"
      />
      <div className="mt-2 flex items-center gap-3">
        {busy ? (
          <p className="pv-serif inline-flex items-center gap-1.5 text-[12.5px] italic text-[hsl(var(--pv-text-muted))]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Revising…
          </p>
        ) : (
          <button type="button" onClick={submit} disabled={!instruction.trim()}
            className="pv-serif inline-flex items-center gap-1 text-[12.5px] italic text-[hsl(var(--pv-accent))] hover:opacity-75 disabled:opacity-40">
            <Wand2 className="h-3 w-3" /> apply revision
          </button>
        )}
        <button type="button" onClick={() => { void run.cancel(); onCancel(); }}
          className="pv-serif text-[12.5px] italic text-[hsl(var(--pv-text-faint))] hover:text-foreground">
          cancel
        </button>
      </div>
      {run.run?.status === "error" && (
        <p className="pv-serif mt-1.5 text-[12px] italic text-red-600 dark:text-red-400">{run.run.error ?? "Something went wrong."}</p>
      )}
    </div>
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

function PinBadge({ onUnpin }: { onUnpin: () => void }) {
  return (
    <button
      type="button"
      title="Pinned — regeneration must keep this. Click to unpin."
      onClick={() => { if (window.confirm("Unpin? Regeneration may then rewrite it.")) onUnpin(); }}
      className="pv-mono inline-flex items-center gap-1 text-[9.5px] uppercase tracking-[0.12em] text-[hsl(var(--pv-accent))]"
    >
      <Pin className="h-3 w-3" /> pinned
    </button>
  );
}
