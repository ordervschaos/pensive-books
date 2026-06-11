// FoundationsStep — stage 2 of the pin-driven flow (docs/pinned_method.md §3.2): five sub-steps
// (Argument → Ending → Cast → Tentpoles → Voice) as one focused screen each, behind a horizontal
// progress strip. The AI proposes candidates (durable foundations_options runs); the author selects,
// edits, keeps or kills — and every explicit gesture PINS the record, which all downstream
// generation must hold. "skip — use AI default" auto-selects the first candidate, unpinned.
//
// Voice is absorbed here (old stage 4): the chosen exemplar is ALSO mirrored to
// books.bible.voice_sample so the existing prose renderers keep reading their anchor unchanged.
import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Pin, Plus, RefreshCw, Skull, Sparkles, Undo2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAIRun } from "@/hooks/useAIRun";
import {
  foundationsProgress, pinNode, writeFoundations,
  type CastMember, type FCandidate, type FNode, type Foundations, type FoundationsStepKey, type Tentpole,
} from "@/lib/foundations";
import { Hero } from "../studioUi";

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
  onChanged: () => void;
  onVoiceStatus: (v: boolean) => void;
}

export function FoundationsStep({ bookId, foundations, onChanged, onVoiceStatus }: Props) {
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
        <NodeSub bookId={bookId} stepKey="argument" node={f.argument}
          heroTitle="Propose three arguments" heroSub="Three claims the book could argue, each with the ending it implies. Pick the one you'd defend — or edit it into yours."
          onSave={(n) => save({ ...f, argument: n })} />
      )}
      {active === "ending" && (
        <NodeSub bookId={bookId} stepKey="ending" node={f.ending}
          heroTitle="Propose three endings" heroSub="Three ways the selected argument can land. Picking one settles where every route must arrive."
          blockedReason={!f.argument?.text?.trim() ? "Select an argument first." : undefined}
          onSave={(n) => save({ ...f, ending: n })} />
      )}
      {active === "cast" && (
        <CastSub bookId={bookId} cast={f.cast ?? []} onSave={(cast) => save({ ...f, cast })} />
      )}
      {active === "tentpoles" && (
        <TentpolesSub bookId={bookId} tentpoles={f.tentpoles ?? []} onSave={(tentpoles) => save({ ...f, tentpoles })} />
      )}
      {active === "voice" && (
        <NodeSub bookId={bookId} stepKey="voice" node={f.voice_exemplar}
          heroTitle="Render one moment in three voices" heroSub="The same tentpole moment, ~120 words, three distinct soundscapes. The one you choose IS the voice exemplar."
          blockedReason={(f.tentpoles ?? []).filter((t) => t.status !== "killed").length === 0 ? "Add at least one tentpole moment first." : undefined}
          onSave={async (n) => { await save({ ...f, voice_exemplar: n }); if (n.text?.trim()) await mirrorVoice(n.text); }} />
      )}
    </div>
  );
}

// ── Shared single-select node sub-step (argument / ending / voice) ───────────
function NodeSub({ bookId, stepKey, node, heroTitle, heroSub, blockedReason, onSave }: {
  bookId: number;
  stepKey: FoundationsStepKey;
  node: FNode | undefined;
  heroTitle: string;
  heroSub: string;
  blockedReason?: string;
  onSave: (n: FNode) => Promise<void> | void;
}) {
  const run = useAIRun<{ candidates: FCandidate[] }>({ bookId, kind: "foundations_options", targetKey: `foundations:${stepKey}` });
  const appliedRef = useRef<number | null>(null);
  const autoPickRef = useRef(false);
  const [draft, setDraft] = useState<string | null>(null); // inline edit buffer for the selected text

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

  if (generating) {
    return (
      <div className="flex items-center gap-4">
        <p className="pv-serif inline-flex items-center gap-2 text-[14px] italic text-[hsl(var(--pv-text-muted))]">
          <Loader2 className="h-4 w-4 animate-spin" /> Proposing candidates…
        </p>
        <button type="button" onClick={() => void run.cancel()} className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))] hover:text-foreground">cancel</button>
      </div>
    );
  }

  const candidates = node?.candidates ?? [];
  const selected = (node?.text ?? "").trim();

  if (candidates.length === 0 && !selected) {
    return (
      <div>
        <Hero icon={<Sparkles className="h-5 w-5" />} title={heroTitle} sub={heroSub} onClick={() => void run.start({ step: stepKey })} />
        <SkipLink onClick={() => { autoPickRef.current = true; void run.start({ step: stepKey }); }} />
        {run.run?.status === "error" && <RunError msg={run.run.error} />}
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      {candidates.map((c) => {
        const isSelected = selected !== "" && c.text.trim() === selected;
        return (
          <div key={c.id} className={`rounded-2xl border px-6 py-5 transition-colors ${isSelected ? "border-[hsl(var(--pv-accent))]/45 bg-[hsl(var(--pv-surface-2))]/60 shadow-[0_10px_30px_rgba(0,0,0,0.05)]" : "border-border bg-[hsl(var(--pv-surface-2))]/40"}`}>
            <div className="mb-2.5 flex items-center justify-between gap-3">
              <span className="pv-mono text-[10px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-faint))]">
                {c.label || (isSelected ? "Approved" : "Candidate")}
              </span>
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
      {/* A selected text that's no longer among the candidates (edited away, or candidates refreshed). */}
      {selected !== "" && !candidates.some((c) => c.text.trim() === selected) && (
        <div className="rounded-2xl border border-[hsl(var(--pv-accent))]/45 bg-[hsl(var(--pv-surface-2))]/60 px-6 py-5">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <span className="pv-mono text-[10px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-faint))]">Approved · yours</span>
            {node?.pinned && <PinBadge onUnpin={() => void onSave({ ...node, pinned: false })} />}
          </div>
          <Textarea
            value={draft ?? selected}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => { if (draft != null && draft.trim() !== selected) void onSave(pinNode(node, draft.trim())); setDraft(null); }}
            rows={Math.max(3, Math.ceil((draft ?? selected).length / 80))}
            className="pv-serif border-none bg-transparent px-0 text-[15.5px] leading-[1.65] focus-visible:ring-0"
          />
        </div>
      )}
      <div className="flex items-center gap-5">
        <button type="button" onClick={() => void run.start({ step: stepKey })} className="pv-serif inline-flex items-center gap-1.5 text-[13.5px] italic text-[hsl(var(--pv-accent))] hover:opacity-75">
          <RefreshCw className="h-3.5 w-3.5" /> regenerate{node?.pinned ? " (your approved text is held)" : ""}
        </button>
        {!selected && <SkipLink onClick={() => { autoPickRef.current = true; void run.start({ step: stepKey }); }} />}
      </div>
      {run.run?.status === "error" && <RunError msg={run.run.error} />}
    </div>
  );
}

// ── Cast sub-step ─────────────────────────────────────────────────────────────
const CAST_FIELDS = ["want", "wound", "lie"] as const;

function CastSub({ bookId, cast, onSave }: { bookId: number; cast: CastMember[]; onSave: (c: CastMember[]) => Promise<void> | void }) {
  const run = useAIRun<{ candidates: CastMember[] }>({ bookId, kind: "foundations_options", targetKey: "foundations:cast" });
  const appliedRef = useRef<number | null>(null);
  const generating = run.starting || run.run?.status === "running" || run.run?.status === "pending";

  // Merge AI candidates: an existing member (by name) only gains fields that are empty and unpinned;
  // unknown names are appended. Pinned lines are never overwritten (§4 rule 2b).
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
              if (!existing[k]?.trim() && !(existing.pinned_fields ?? []).includes(k)) existing[k] = cand[k];
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
    return (
      <div className="flex items-center gap-4">
        <p className="pv-serif inline-flex items-center gap-2 text-[14px] italic text-[hsl(var(--pv-text-muted))]"><Loader2 className="h-4 w-4 animate-spin" /> Drafting the cast…</p>
        <button type="button" onClick={() => void run.cancel()} className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))] hover:text-foreground">cancel</button>
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      {cast.length === 0 && (
        <Hero icon={<Sparkles className="h-5 w-5" />} title="Draft the cast"
          sub="Protagonist plus up to two majors, each with want / wound / lie. Edit any line to make it yours — edited lines are pinned."
          onClick={() => void run.start({ step: "cast" })} />
      )}
      {cast.map((m) => (
        <div key={m.id} className="rounded-2xl border border-border bg-[hsl(var(--pv-surface-2))]/40 px-6 py-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <input
              defaultValue={m.name}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== m.name) update(m.id, { name: v }); }}
              className="pv-serif w-full max-w-[280px] border-none bg-transparent text-[18px] font-semibold text-foreground outline-none"
            />
            <div className="flex items-center gap-3">
              <span className="pv-mono text-[10px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-faint))]">{m.role ?? "major"}</span>
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
                  <span className="pv-mono w-14 shrink-0 text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-muted))]">{k}</span>
                  <input
                    defaultValue={m[k] ?? ""}
                    placeholder="—"
                    onBlur={(e) => { const v = e.target.value.trim(); if (v !== (m[k] ?? "")) update(m.id, { [k]: v }, k); }}
                    className="pv-serif w-full border-none bg-transparent text-[14.5px] leading-relaxed text-foreground outline-none placeholder:text-[hsl(var(--pv-text-faint))]"
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
        </div>
      ))}
      <div className="flex items-center gap-5">
        <button
          type="button"
          onClick={() => void onSave([...cast, { id: uid(), name: "New character", role: cast.length ? "major" : "protagonist", pinned_fields: [...CAST_FIELDS] }])}
          className="pv-serif inline-flex items-center gap-1.5 text-[13.5px] italic text-[hsl(var(--pv-text-muted))] hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" /> add character
        </button>
        {cast.length > 0 && (
          <button type="button" onClick={() => void run.start({ step: "cast" })} className="pv-serif inline-flex items-center gap-1.5 text-[13.5px] italic text-[hsl(var(--pv-accent))] hover:opacity-75">
            <RefreshCw className="h-3.5 w-3.5" /> redraft with AI{pinnedCount ? ` (${pinnedCount} pinned line${pinnedCount === 1 ? "" : "s"} held)` : ""}
          </button>
        )}
      </div>
      {run.run?.status === "error" && <RunError msg={run.run.error} />}
    </div>
  );
}

// ── Tentpoles sub-step ────────────────────────────────────────────────────────
function TentpolesSub({ bookId, tentpoles, onSave }: { bookId: number; tentpoles: Tentpole[]; onSave: (t: Tentpole[]) => Promise<void> | void }) {
  const run = useAIRun<{ candidates: Tentpole[] }>({ bookId, kind: "foundations_options", targetKey: "foundations:tentpoles" });
  const appliedRef = useRef<number | null>(null);
  const [newMoment, setNewMoment] = useState("");
  const generating = run.starting || run.run?.status === "running" || run.run?.status === "pending";

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
              <TentpoleCard key={t.id} t={t} onText={(v) => setText(t.id, v)} onKill={() => setStatus(t.id, "killed")} />
            ))}
            <div className="rounded-2xl border border-dashed border-border px-4 py-3">
              <Textarea
                value={newMoment}
                onChange={(e) => setNewMoment(e.target.value)}
                placeholder="A scene you can already see — 1–3 sentences…"
                rows={2}
                className="pv-serif border-none bg-transparent px-0 text-[14px] leading-relaxed focus-visible:ring-0"
              />
              <button type="button" onClick={addAuthor} disabled={!newMoment.trim()}
                className="pv-serif mt-1 inline-flex items-center gap-1.5 text-[13px] italic text-[hsl(var(--pv-accent))] hover:opacity-75 disabled:opacity-40">
                <Plus className="h-3.5 w-3.5" /> add — it's pinned
              </button>
            </div>
          </div>
        </div>
        {/* Right: AI proposals with keep / kill / edit. */}
        <div>
          <h3 className="pv-mono mb-2.5 text-[10px] uppercase tracking-[0.16em] text-[hsl(var(--pv-text-muted))]">Proposals</h3>
          {generating ? (
            <div className="flex items-center gap-4 py-2">
              <p className="pv-serif inline-flex items-center gap-2 text-[14px] italic text-[hsl(var(--pv-text-muted))]"><Loader2 className="h-4 w-4 animate-spin" /> Proposing moments…</p>
              <button type="button" onClick={() => void run.cancel()} className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))] hover:text-foreground">cancel</button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {proposals.map((t) => (
                <TentpoleCard key={t.id} t={t}
                  onText={(v) => setText(t.id, v)}
                  onKeep={t.status === "fluid" ? () => setStatus(t.id, "pinned") : undefined}
                  onKill={() => setStatus(t.id, "killed")} />
              ))}
              <button type="button" onClick={() => void run.start({ step: "tentpoles" })}
                className="pv-serif inline-flex items-center gap-1.5 text-[13.5px] italic text-[hsl(var(--pv-accent))] hover:opacity-75">
                {proposals.length ? <RefreshCw className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                {proposals.length ? `propose more (${pinnedCount} pinned held)` : "propose six moments"}
              </button>
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

function TentpoleCard({ t, onText, onKeep, onKill }: { t: Tentpole; onText: (v: string) => void; onKeep?: () => void; onKill: () => void }) {
  const [draft, setDraft] = useState<string | null>(null);
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
        <button type="button" onClick={onKill} className="pv-serif inline-flex items-center gap-1 text-[12.5px] italic text-[hsl(var(--pv-text-faint))] hover:text-foreground">
          <Skull className="h-3 w-3" /> kill
        </button>
      </div>
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

function RunError({ msg }: { msg: string | null }) {
  return <p className="pv-serif mt-2 text-[13px] italic text-red-600 dark:text-red-400">{msg || "Generation failed."}</p>;
}
