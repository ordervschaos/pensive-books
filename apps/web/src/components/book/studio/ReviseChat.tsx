// ReviseChat — the conversational reviser for ONE planning LAYER (foundations / spine / beats). The
// author talks to a layer-focused story editor that holds that layer's knowledge base: ask a
// question, ask for a summary, ask for a pressure-test/evaluation — and sometimes ask for a change.
// A turn is sometimes just talk, sometimes an action (a proposed change, reviewed inline and applied
// through that layer's own write path).
//
// The revise-chat edge fn is the single writer of the revision_chats thread (one row per book+layer);
// this panel sends a message and projects the row live (refresh = no-op). Generalizes BeatChat —
// see docs/beat-sheet-revision.md and the unified-revision plan.
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, Loader2, Plus, Sparkles, Trash2, Wand2, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useLatestTaskRow } from "@/hooks/useLatestTaskRow";
import { LENSES as BEAT_LENSES, type RevisionPlan } from "@/lib/beatSheet";
import type { CastMember, Foundations, Tentpole } from "@/lib/foundations";
import {
  applyProposal, clearPendingProposal, sendRevisionMessage,
  type RevisionChatRow, type RevisionLayer, type RevisionProposal,
} from "@/lib/revisionChat";
import type { StudioModel } from "./studioModel";
import { ActionLink, Eyebrow, Panel, RunError } from "./studioUi";

interface LayerUi {
  title: string;
  blurb: string;
  placeholder: string;
  /** Apply confirmation note shown under the buttons. */
  applyNote: string;
  chips: { label: string; prompt: string }[];
  /** Shown when the layer has no content yet — generation-oriented, replaces blurb/chips. */
  emptyBlurb?: string;
  emptyChips?: { label: string; prompt: string }[];
}

const LAYER_UI: Record<RevisionLayer, LayerUi> = {
  beats: {
    title: "Beat editor",
    blurb: "Talk through the beats, ask for a summary or an evaluation, or ask for a change — it proposes a revision you review before anything is touched.",
    placeholder: "Ask or change the beats…",
    applyNote: "Saves a version first · prose stays (re-draft after)",
    chips: [
      { label: "Summarize", prompt: "Summarize the beat sheet in a few lines — the shape of the story as it stands." },
      { label: "Evaluate", prompt: "Evaluate the beat sheet against the fiction criteria. Where is it strong, where does it sag, and what's the single highest-leverage fix?" },
    ],
  },
  spine: {
    title: "Spine editor",
    blurb: "Talk through the throughline, pressure-test the arc, or ask for a change — it proposes a revised spine you review before it's saved.",
    placeholder: "Ask or change the spine…",
    applyNote: "Saved as the spine · beats & prose below go stale",
    chips: [
      { label: "Summarize", prompt: "Summarize the spine — the book as one arc, in a few lines." },
      { label: "Pressure-test", prompt: "Pressure-test the spine: does it realize the argument and land the settled ending? Is the causal chain unbroken? Is the midpoint a real turn? Name the weak link and the highest-leverage fix." },
    ],
    emptyBlurb: "No spine yet — draft it here, or talk through the throughline first. Ask for a few directions, pick one, and it's proposed for you to apply.",
    emptyChips: [
      { label: "Draft the spine", prompt: "Draft the spine from the foundations — the whole book as one ~250-word causal arc, from the beginning, through the pinned tentpoles, to the settled ending." },
      { label: "Offer 3 directions", prompt: "Before drafting, offer me 2–3 distinct directions the spine could take — each a different structural angle on the same argument and settled ending. Don't write the full spine yet; just sketch the directions so I can pick." },
    ],
  },
  foundations: {
    title: "Foundations editor",
    blurb: "Talk through the bedrock decisions, pressure-test them, or ask for a change — it proposes a revision you review before it's saved. Pinned lines stay locked.",
    placeholder: "Ask or change the foundations…",
    applyNote: "Saved to foundations · spine & beats below go stale",
    chips: [
      { label: "Summarize", prompt: "Summarize the foundations — argument, ending, cast, tentpoles, voice — in a few lines." },
      { label: "Pressure-test", prompt: "Pressure-test the foundations: is the argument a real claim? Does the ending pay its cost? Does each cast member's want/wound/lie cohere into an arc? Do the tentpoles dramatize the argument? Name the weak link and the highest-leverage fix." },
    ],
  },
};

export function ReviseChat({ bookId, layer, onChanged, model, currentSpine, currentFoundations }: {
  bookId: number;
  layer: RevisionLayer;
  onChanged: () => void;
  model?: StudioModel;
  currentSpine?: string;
  currentFoundations?: Foundations | null;
}) {
  const { toast } = useToast();
  const ui = LAYER_UI[layer];
  // When the layer has no content yet, the chat's job is to GENERATE it — show generation-oriented
  // chips/blurb instead of the revision ones. (Scoped to spine for now; other layers add theirs.)
  const layerEmpty = layer === "spine" && !currentSpine?.trim();
  const chips = (layerEmpty && ui.emptyChips) ? ui.emptyChips : ui.chips;
  const blurb = (layerEmpty && ui.emptyBlurb) ? ui.emptyBlurb : ui.blurb;
  const { row, refetch } = useLatestTaskRow<RevisionChatRow>({
    table: "revision_chats", bookId, match: { layer }, activeStatuses: ["thinking"], staleMs: 120_000,
  });
  const messages = Array.isArray(row?.messages) ? row!.messages : [];
  const thinking = row?.status === "thinking";
  const pending = row?.pending_proposal ?? null;

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, thinking]);

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || sending || thinking) return;
    setSending(true);
    setDraft("");
    try {
      await sendRevisionMessage(bookId, layer, t);
      refetch();
    } catch (e) {
      toast({ title: "The editor couldn't respond", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally { setSending(false); }
  };

  const apply = async () => {
    if (!pending) return;
    try {
      await applyProposal(bookId, pending);
      await clearPendingProposal(bookId, layer);
      onChanged();
      toast({ title: "Applied the revision", description: ui.applyNote });
    } catch (e) {
      toast({ title: "Couldn't apply", description: String((e as Error)?.message ?? e), variant: "destructive" });
    }
  };
  const discard = async () => { try { await clearPendingProposal(bookId, layer); } catch { /* ignore */ } };

  const busy = sending || thinking;

  return (
    <Panel variant="soft" className="flex h-full flex-col px-4 py-3.5">
      <div className="flex shrink-0 items-center gap-2">
        <Wand2 className="h-4 w-4 text-[hsl(var(--pv-accent))]" />
        <Eyebrow tone="accent">{ui.title}</Eyebrow>
      </div>

      {/* Conversation — fills the rail; the blurb only stands in for an empty thread. */}
      <div ref={scrollRef} className="mt-3 min-h-0 flex-1 space-y-3.5 overflow-y-auto pr-1">
        {messages.length === 0 && !pending && (
          <p className="pv-serif text-[12.5px] italic leading-[1.5] text-[hsl(var(--pv-text-faint))]">{blurb}</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
            {m.role === "user" ? (
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-[hsl(var(--pv-surface-2))] px-3.5 py-2 pv-serif text-[14px] leading-[1.55] text-foreground whitespace-pre-wrap">
                {m.text}
              </div>
            ) : (
              <div className="max-w-[92%] pv-serif text-[14.5px] leading-[1.62] text-[hsl(var(--pv-text-muted))] prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0 prose-headings:text-foreground prose-strong:text-foreground prose-strong:font-semibold">
                <ReactMarkdown>{m.text}</ReactMarkdown>
              </div>
            )}
          </div>
        ))}
        {thinking && (
          <div className="flex items-center gap-2 pv-serif text-[13.5px] italic text-[hsl(var(--pv-text-faint))]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> reading the {layer}…
          </div>
        )}

        {row?.status === "error" && row.error && <RunError msg={row.error} />}

        {pending && !thinking && (
          <ProposalReview
            proposal={pending} layer={layer} model={model}
            currentSpine={currentSpine} currentFoundations={currentFoundations}
            applyNote={ui.applyNote} onApply={apply} onDiscard={discard}
          />
        )}
      </div>

      {/* Quick actions + composer — pinned to the bottom of the rail. */}
      <div className="mt-3 shrink-0">
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <Chip key={c.label} onClick={() => void send(c.prompt)} disabled={busy}>{c.label}</Chip>
          ))}
          {layer === "beats" && (
            <>
              <span className="pv-mono mx-1 text-[9.5px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-faint))]">check vs</span>
              {BEAT_LENSES.map((l) => (
                <Chip key={l.id} title={l.bestFor} disabled={busy}
                  onClick={() => void send(`Check the beat sheet against the ${l.name} structure — what's missing, sagging, or paid off weakly. If it needs changes, propose them.`)}>
                  {l.name}
                </Chip>
              ))}
            </>
          )}
        </div>

        <div className="mt-2.5 flex items-end gap-2">
          <Textarea
            value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(draft); } }}
            rows={1} placeholder={ui.placeholder}
            disabled={busy}
            className="pv-serif min-h-[42px] resize-none text-[14px] leading-[1.55]"
          />
          <button type="button" onClick={() => void send(draft)} disabled={busy || !draft.trim()}
            title="Send"
            className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </Panel>
  );
}

function Chip({ onClick, disabled, title, children }: { onClick: () => void; disabled?: boolean; title?: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      className="rounded-full border border-[hsl(var(--pv-border-soft))] px-2.5 py-1 text-[12px] text-[hsl(var(--pv-text-muted))] transition-colors hover:border-[hsl(var(--pv-accent))]/50 hover:text-[hsl(var(--pv-accent))] disabled:opacity-40">
      {children}
    </button>
  );
}

// ── Proposal review (a diff), fed by revision_chats.pending_proposal ─────────────
function ProposalReview({ proposal, layer, model, currentSpine, currentFoundations, applyNote, onApply, onDiscard }: {
  proposal: RevisionProposal;
  layer: RevisionLayer;
  model?: StudioModel;
  currentSpine?: string;
  currentFoundations?: Foundations | null;
  applyNote: string;
  onApply: () => void;
  onDiscard: () => void;
}) {
  return (
    <Panel className="mt-4 border-[hsl(var(--pv-accent))]/45 px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <Eyebrow tone="accent">Proposed revision</Eyebrow>
        <button type="button" onClick={onDiscard} title="Discard" className="shrink-0 text-[hsl(var(--pv-text-faint))] hover:text-foreground"><X className="h-4 w-4" /></button>
      </div>
      {proposal.summary && <p className="pv-serif mt-1.5 text-[14px] leading-[1.6] text-[hsl(var(--pv-text-muted))]">{proposal.summary}</p>}

      <div className="mt-3.5">
        {proposal.patch.layer === "beats" && model
          ? <BeatDiff plan={proposal.patch.data} model={model} />
          : proposal.patch.layer === "spine"
            ? <SpineDiff before={currentSpine ?? ""} after={proposal.patch.data.text} />
            : proposal.patch.layer === "foundations"
              ? <FoundationsDiff patch={proposal.patch.data} before={currentFoundations ?? null} />
              : <p className="pv-serif text-[13.5px] italic text-[hsl(var(--pv-text-faint))]">Proposed change ready to apply.</p>}
      </div>

      <div className="mt-4 flex items-center gap-5">
        <button type="button" onClick={onApply}
          className="pv-serif inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[14px] text-primary-foreground">
          <Check className="h-4 w-4" /> Apply revision
        </button>
        <ActionLink tone="faint" onClick={onDiscard}>discard</ActionLink>
        <span className="pv-serif text-[12px] italic text-[hsl(var(--pv-text-faint))]">{applyNote}</span>
      </div>
    </Panel>
  );
}

// ── Spine diff: before → after text ──────────────────────────────────────────
function SpineDiff({ before, after }: { before: string; after: string }) {
  return (
    <div className="space-y-3">
      {before.trim() && (
        <div>
          <span className="pv-mono text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">Now</span>
          <p className="pv-serif mt-1 whitespace-pre-wrap text-[13px] leading-[1.6] text-[hsl(var(--pv-text-faint))] line-through decoration-[hsl(var(--pv-text-faint))]/40">{before.trim()}</p>
        </div>
      )}
      <div>
        <span className="pv-mono text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--pv-accent))]">Proposed</span>
        <p className="pv-serif mt-1 whitespace-pre-wrap text-[14px] leading-[1.65] text-foreground">{after.trim()}</p>
      </div>
    </div>
  );
}

// ── Foundations diff: per changed field, before → after; cast/tentpoles coarse ────
function FoundationsDiff({ patch, before }: { patch: { argument?: string; ending?: string; voice?: string; cast?: unknown[]; tentpoles?: unknown[] }; before: Foundations | null }) {
  const rows: { label: string; before?: string; after: string }[] = [];
  if (typeof patch.argument === "string") rows.push({ label: "Argument", before: before?.argument?.text, after: patch.argument });
  if (typeof patch.ending === "string") rows.push({ label: "Ending", before: before?.ending?.text, after: patch.ending });
  if (typeof patch.voice === "string") rows.push({ label: "Voice", before: before?.voice_exemplar?.text, after: patch.voice });

  return (
    <div className="space-y-3.5">
      {rows.map((r) => (
        <div key={r.label}>
          <span className="pv-mono text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">{r.label}</span>
          {r.before?.trim() && (
            <p className="pv-serif mt-1 text-[12.5px] leading-[1.55] text-[hsl(var(--pv-text-faint))] line-through decoration-[hsl(var(--pv-text-faint))]/40">{r.before.trim()}</p>
          )}
          <p className="pv-serif mt-0.5 text-[14px] leading-[1.6] text-foreground">{r.after.trim()}</p>
        </div>
      ))}
      {Array.isArray(patch.cast) && <CastDiff after={patch.cast as CastMember[]} before={before?.cast ?? []} />}
      {Array.isArray(patch.tentpoles) && <TentpoleDiff after={patch.tentpoles as Tentpole[]} before={before?.tentpoles ?? []} />}
      {rows.length === 0 && !patch.cast && !patch.tentpoles && (
        <p className="pv-serif text-[13.5px] italic text-[hsl(var(--pv-text-faint))]">No changes proposed.</p>
      )}
    </div>
  );
}

const CAST_FIELDS = [
  { key: "want", label: "Want" }, { key: "wound", label: "Wound" }, { key: "lie", label: "Lie" },
] as const;

// Per-member, per-field before→after (want/wound/lie) — matched by id; unmatched = new member.
function CastDiff({ after, before }: { after: CastMember[]; before: CastMember[] }) {
  const beforeById = new Map(before.map((m) => [m.id, m]));
  const changed = after.map((m) => {
    const prev = beforeById.get(m.id);
    const fields = CAST_FIELDS
      .map((f) => ({ ...f, before: prev?.[f.key]?.trim() ?? "", after: (m[f.key] ?? "").trim() }))
      .filter((f) => f.after && f.after !== f.before);
    return { member: m, isNew: !prev, fields };
  }).filter((c) => c.isNew || c.fields.length > 0);

  if (changed.length === 0) return null;
  return (
    <div className="flex gap-2.5">
      <Wand2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1 space-y-3">
        <span className="pv-mono text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">Cast</span>
        {changed.map((c) => (
          <div key={c.member.id}>
            <span className="pv-serif text-[13.5px] font-semibold text-foreground">{c.member.name}</span>
            {c.isNew && <span className="pv-serif ml-2 text-[12px] italic text-[hsl(var(--pv-text-faint))]">new</span>}
            <div className="mt-1 space-y-1.5">
              {c.fields.map((f) => (
                <div key={f.key}>
                  <span className="pv-mono text-[9.5px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">{f.label}</span>
                  {f.before && (
                    <p className="pv-serif text-[12.5px] leading-[1.5] text-[hsl(var(--pv-text-faint))] line-through decoration-[hsl(var(--pv-text-faint))]/40">{f.before}</p>
                  )}
                  <p className="pv-serif text-[13.5px] leading-[1.55] text-foreground">{f.after}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
        <p className="pv-serif text-[12px] italic leading-[1.5] text-[hsl(var(--pv-text-faint))]">Pinned fields are kept. Members not listed are unchanged.</p>
      </div>
    </div>
  );
}

// Per-tentpole before→after text + status change — matched by id.
function TentpoleDiff({ after, before }: { after: Tentpole[]; before: Tentpole[] }) {
  const beforeById = new Map(before.map((t) => [t.id, t]));
  const changed = after.map((t) => {
    const prev = beforeById.get(t.id);
    const textChanged = (t.text ?? "").trim() !== (prev?.text ?? "").trim();
    const statusChanged = !!prev && t.status !== prev.status;
    return { tentpole: t, isNew: !prev, textChanged, statusChanged };
  }).filter((c) => c.isNew || c.textChanged || c.statusChanged);

  if (changed.length === 0) return null;
  return (
    <div className="flex gap-2.5">
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--pv-accent))]" />
      <div className="min-w-0 flex-1 space-y-2.5">
        <span className="pv-mono text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">Tentpoles</span>
        {changed.map((c) => (
          <div key={c.tentpole.id}>
            {c.isNew && <span className="pv-serif text-[12px] italic text-[hsl(var(--pv-text-faint))]">new · </span>}
            {c.textChanged && beforeById.get(c.tentpole.id)?.text?.trim() && (
              <p className="pv-serif text-[12.5px] leading-[1.5] text-[hsl(var(--pv-text-faint))] line-through decoration-[hsl(var(--pv-text-faint))]/40">{beforeById.get(c.tentpole.id)!.text!.trim()}</p>
            )}
            <p className="pv-serif text-[13.5px] leading-[1.55] text-foreground">{c.tentpole.text.trim()}</p>
            {c.statusChanged && (
              <span className="pv-mono text-[10px] uppercase tracking-[0.1em] text-amber-600">{beforeById.get(c.tentpole.id)?.status} → {c.tentpole.status}</span>
            )}
          </div>
        ))}
        <p className="pv-serif text-[12px] italic leading-[1.5] text-[hsl(var(--pv-text-faint))]">Pinned & killed moments not listed survive untouched.</p>
      </div>
    </div>
  );
}

// ── Beat diff (moved from BeatChat, unchanged) ───────────────────────────────
type Change = { kind: "add" | "delete" | "retarget" | "rebeat" | "move"; title: string; why?: string; detail?: string };

function diffPlan(plan: RevisionPlan, model: StudioModel): Change[] {
  const changes: Change[] = [];
  const curOrder = model.map.pages.map((p) => p.id);
  const newOrder = plan.pages.map((p) => p.ref).filter((r): r is number => r != null);
  for (const p of plan.pages) {
    if (p.op === "add") { changes.push({ kind: "add", title: p.title || "(untitled)", why: p.why, detail: p.beat || p.objective }); continue; }
    if (p.ref == null) continue;
    const cur = model.pageById(p.ref);
    if (!cur) continue;
    if (p.op === "retarget" && (p.objective ?? "").trim() !== cur.objectiveText.trim())
      changes.push({ kind: "retarget", title: p.title || cur.title || "(untitled)", why: p.why, detail: p.objective });
    if ((p.beat ?? "").trim() && (p.beat ?? "").trim() !== cur.beatText.trim())
      changes.push({ kind: "rebeat", title: p.title || cur.title || "(untitled)", why: p.why, detail: p.beat });
  }
  for (const d of plan.deletes) changes.push({ kind: "delete", title: model.pageById(d.ref)?.title || "(untitled)", why: d.why });
  const keptCur = curOrder.filter((id) => newOrder.includes(id));
  const keptNew = newOrder.filter((id) => keptCur.includes(id));
  if (keptCur.join(",") !== keptNew.join(",")) changes.push({ kind: "move", title: "Pages reordered", detail: "Reading order changes." });
  return changes;
}

const CHANGE_META: Record<Change["kind"], { icon: typeof Plus; label: string; tone: string }> = {
  add: { icon: Plus, label: "Add", tone: "text-emerald-600" },
  delete: { icon: Trash2, label: "Delete", tone: "text-red-600" },
  retarget: { icon: Wand2, label: "Retarget", tone: "text-amber-600" },
  rebeat: { icon: Sparkles, label: "Rewrite beat", tone: "text-[hsl(var(--pv-accent))]" },
  move: { icon: Check, label: "Reorder", tone: "text-[hsl(var(--pv-text-muted))]" },
};

function BeatDiff({ plan, model }: { plan: RevisionPlan; model: StudioModel }) {
  const changes = diffPlan(plan, model);
  if (changes.length === 0) return <p className="pv-serif text-[13.5px] italic text-[hsl(var(--pv-text-faint))]">No structural changes proposed.</p>;
  return (
    <ul className="space-y-2.5">
      {changes.map((c, i) => {
        const m = CHANGE_META[c.kind];
        const Icon = m.icon;
        return (
          <li key={i} className="flex gap-2.5">
            <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${m.tone}`} />
            <div className="min-w-0">
              <span className="pv-mono text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">{m.label}</span>
              <span className="pv-serif ml-2 text-[14px] text-foreground">{c.title}</span>
              {c.why && <p className="pv-serif text-[12.5px] italic leading-[1.5] text-[hsl(var(--pv-text-faint))]">{c.why}</p>}
              {c.detail && c.kind !== "move" && <p className="pv-serif mt-0.5 line-clamp-2 text-[12.5px] leading-[1.5] text-[hsl(var(--pv-text-muted))]">{c.detail}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
