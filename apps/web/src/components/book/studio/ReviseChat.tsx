// ReviseChat — the conversational reviser for ONE planning LAYER (foundations / spine / beats). The
// author talks to a layer-focused story editor that holds that layer's knowledge base: ask a
// question, ask for a summary, ask for a pressure-test/evaluation — and sometimes ask for a change.
// A turn is sometimes just talk, sometimes an action (a proposed change, reviewed inline and applied
// through that layer's own write path).
//
// The revise-chat edge fn is the single writer of the revision_chats thread (one row per book+layer);
// this panel sends a message and projects the row live (refresh = no-op). Generalizes BeatChat —
// see docs/beat-sheet-revision.md and the unified-revision plan.
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, Clock, Loader2, Plus, Sparkles, SquarePen, Trash2, Wand2, X } from "lucide-react";
import { useChatScroll } from "./useChatScroll";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useLatestTaskRow } from "@/hooks/useLatestTaskRow";
import { LENSES as BEAT_LENSES, type RevisionPlan } from "@/lib/beatSheet";
import type { CastMember, Foundations, Tentpole } from "@/lib/foundations";
import {
  applyProposal, clearPendingProposal, GENERATE_PROMPTS, recordApplied, sendRevisionMessage, startNewRevisionSession,
  type RevisionChatRow, type RevisionLayer, type RevisionProposal, type RevisionSession,
} from "@/lib/revisionChat";
import type { StudioModel } from "./studioModel";
import { ActionLink, Eyebrow, Panel, RunError } from "./studioUi";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

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
    emptyBlurb: "No beats yet — plan them here from your objectives, or talk through the structure first. You review the plan before anything's applied.",
    emptyChips: [
      { label: "Plan all the beats", prompt: GENERATE_PROMPTS.beats },
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
      { label: "Draft the spine", prompt: GENERATE_PROMPTS.spine },
      { label: "Offer 3 directions", prompt: "Before drafting, offer me 2–3 distinct directions the spine could take — each a different structural angle on the same argument and settled ending. Don't write the full spine yet; just sketch the directions so I can pick." },
    ],
  },
  outline: {
    title: "Outline editor",
    blurb: "Talk through the structure, pressure-test the sequence, or ask for a change — it proposes an outline plan (chapters, pages, objectives) you review before it's applied.",
    placeholder: "Ask or change the outline…",
    applyNote: "Applied to the outline · beats & prose below go stale",
    chips: [
      { label: "Summarize", prompt: "Summarize the outline — the chapters and the through-line of objectives, in a few lines." },
      { label: "Pressure-test", prompt: "Pressure-test the outline: does the page sequence realize the spine? Does every page earn its place with a real objective? Is anything missing or redundant? Name the weak link and the highest-leverage fix." },
    ],
    emptyBlurb: "No outline yet — draft it here from your spine, or talk through the structure first. You review the plan before anything's applied.",
    emptyChips: [
      { label: "Draft the outline", prompt: GENERATE_PROMPTS.outline },
      { label: "Offer shapes", prompt: "Before drafting, offer me 2–3 distinct structural shapes the outline could take — different chapter breaks and pacing on the same spine. Don't write the full outline yet; just sketch the shapes so I can pick." },
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
    emptyBlurb: "No foundations yet — draft them here, or talk through the argument first. Ask for a few directions, pick one, and it's proposed for you to apply.",
    emptyChips: [
      { label: "Draft the foundations", prompt: GENERATE_PROMPTS.foundations },
      { label: "Offer directions", prompt: "Before drafting, offer me 2–3 distinct directions the foundations could take — each a different argument and the ending, cast, and signature moments it implies. Don't write the full foundations yet; just sketch the directions so I can pick." },
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
  // chips/blurb instead of the revision ones.
  const layerEmpty =
    layer === "spine" ? !currentSpine?.trim()
      : layer === "foundations" ? !currentFoundations?.argument?.text?.trim()
        : layer === "beats" ? !model?.counts?.beats
          : layer === "outline" ? !model?.hasScaffold
            : false;
  const chips = (layerEmpty && ui.emptyChips) ? ui.emptyChips : ui.chips;
  const blurb = (layerEmpty && ui.emptyBlurb) ? ui.emptyBlurb : ui.blurb;
  const { row, refetch } = useLatestTaskRow<RevisionChatRow>({
    table: "revision_chats", bookId, match: { layer }, activeStatuses: ["thinking"], staleMs: 120_000,
  });
  const messages = useMemo(() => (Array.isArray(row?.messages) ? row!.messages : []), [row]);
  const thinking = row?.status === "thinking";
  const pending = row?.pending_proposal ?? null;
  const sessions: RevisionSession[] = Array.isArray(row?.sessions) ? row!.sessions! : [];

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  // Optimistic echo: the just-sent message, shown instantly as a user bubble + "sending…" until the
  // edge fn writes it to the thread and Realtime projects it back (cleared by the effect below).
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const { scrollRef, atBottom, scrollToBottom } = useChatScroll([messages.length, thinking, !!pending, !!optimistic] as const);

  useEffect(() => {
    if (optimistic != null && messages.some((m) => m.role === "user" && m.text === optimistic)) setOptimistic(null);
  }, [messages, optimistic]);

  const newChat = async () => {
    if (thinking || sending) return;
    try { await startNewRevisionSession(bookId, layer); setHistoryOpen(false); refetch(); }
    catch (e) { toast({ title: "Couldn't start a new chat", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
  };

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || sending || thinking) return;
    setSending(true);
    setDraft("");
    setOptimistic(t);
    try {
      await sendRevisionMessage(bookId, layer, t);
      refetch();
    } catch (e) {
      setOptimistic(null);
      setDraft(t); // restore so the author can retry
      toast({ title: "The editor couldn't respond", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally { setSending(false); }
  };

  // When the proposal targets an upstream layer, use that layer's apply-note for the thread + toast.
  const applyNoteFor = (l: RevisionLayer) => LAYER_UI[l].applyNote;

  const apply = async () => {
    if (!pending) return;
    try {
      const summary = pending.summary?.trim() || "Revision applied.";
      const note = applyNoteFor(pending.patch.layer);
      await applyProposal(bookId, pending);
      // Reflect the apply in the thread (and clear pending in the same write) so the chat keeps its
      // history and visibly shows what was applied, instead of blanking.
      await recordApplied(bookId, layer, `✓ Applied — ${summary}\n_${note}_`);
      refetch();
      onChanged();
      toast({ title: "Applied the revision", description: note });
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
        <div className="ml-auto flex items-center gap-1">
          {sessions.length > 0 && (
            <button type="button" onClick={() => setHistoryOpen((v) => !v)} title="Past chats"
              className={`inline-flex items-center gap-1 rounded-full px-2 py-1 pv-mono text-[10px] uppercase tracking-[0.1em] transition-colors ${historyOpen ? "text-[hsl(var(--pv-accent))]" : "text-[hsl(var(--pv-text-faint))] hover:text-foreground"}`}>
              <Clock className="h-3 w-3" /> {sessions.length}
              <ChevronDown className={`h-3 w-3 transition-transform ${historyOpen ? "rotate-180" : ""}`} />
            </button>
          )}
          <button type="button" onClick={() => void newChat()} disabled={busy || messages.length === 0} title="New chat — archives the current one"
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[hsl(var(--pv-text-faint))] transition-colors hover:text-[hsl(var(--pv-accent))] disabled:opacity-40">
            <SquarePen className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Past chats — archived sessions, read-only. */}
      {historyOpen && sessions.length > 0 && (
        <div className="mt-2 shrink-0 max-h-[40%] overflow-y-auto rounded-xl border border-[hsl(var(--pv-border-soft))]/60 bg-[hsl(var(--pv-surface-2))]/30 px-3 py-2">
          <SessionHistory sessions={sessions} foundations={currentFoundations} model={model} />
        </div>
      )}

      {/* Conversation — fills the rail; the blurb only stands in for an empty thread. */}
      <div className="relative mt-3 min-h-0 flex-1">
      <div ref={scrollRef} className="h-full space-y-3.5 overflow-y-auto pr-1">
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
                <ReactMarkdown components={makeMarkdownComponents(currentFoundations, model)}>{m.text}</ReactMarkdown>
              </div>
            )}
          </div>
        ))}
        {optimistic && (
          <>
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-[hsl(var(--pv-surface-2))] px-3.5 py-2 pv-serif text-[14px] leading-[1.55] text-foreground whitespace-pre-wrap opacity-60">
                {optimistic}
              </div>
            </div>
            <div className="flex items-center gap-1.5 pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))]">
              sending <SendingDots />
            </div>
          </>
        )}
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
            applyNote={applyNoteFor(pending.patch.layer)} onApply={apply} onDiscard={discard}
          />
        )}
      </div>
      {/* Jump-to-latest pill — shown only when the user has scrolled up. */}
      {!atBottom && (
        <button
          type="button"
          onClick={() => scrollToBottom(true)}
          className="absolute bottom-2 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--pv-border-soft))] bg-background/90 px-3 py-1 pv-serif text-[12px] text-[hsl(var(--pv-text-muted))] shadow-sm backdrop-blur-sm hover:text-foreground transition-colors"
        >
          <ArrowDown className="h-3 w-3" /> latest
        </button>
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

// Three pulsing dots — the classic "typing" affordance for the optimistic sending state.
function SendingDots() {
  return (
    <span className="inline-flex items-center gap-0.5">
      <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
      <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
      <span className="h-1 w-1 animate-bounce rounded-full bg-current" />
    </span>
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

// ── Entity chips — inline references the AI outputs as `[xxxxxxxx]` ──────────
// The AI is trained to reference tentpoles, cast members, and pages by their IDs
// (8-char hex for tentpoles/cast; integers for pages). These render as clickable
// chips with a hover tooltip and a click modal showing full entity details.

type EntityRef =
  | { kind: "tentpole"; item: Tentpole }
  | { kind: "cast"; item: CastMember }
  | { kind: "page"; title: string | null; objectiveText: string; beatText: string };

function lookupEntity(id: string, foundations?: Foundations | null, model?: StudioModel): EntityRef | null {
  const tentpole = foundations?.tentpoles?.find((t) => t.id === id);
  if (tentpole) return { kind: "tentpole", item: tentpole };
  const cast = foundations?.cast?.find((c) => c.id === id);
  if (cast) return { kind: "cast", item: cast };
  const numId = /^\d+$/.test(id) ? parseInt(id, 10) : NaN;
  if (!isNaN(numId) && model) {
    const p = model.pageById(numId);
    if (p) return { kind: "page", title: p.title, objectiveText: p.objectiveText, beatText: p.beatText };
  }
  return null;
}

function EntityChip({ id, foundations, model }: { id: string; foundations?: Foundations | null; model?: StudioModel }) {
  const [open, setOpen] = useState(false);
  const entity = lookupEntity(id, foundations, model);

  if (!entity) {
    return (
      <span
        title="Deleted or not found"
        className="inline-flex items-center rounded-full border border-[hsl(var(--pv-border-soft))] bg-transparent px-2 py-0.5 pv-mono text-[10px] text-[hsl(var(--pv-text-faint))] opacity-60 line-through align-baseline not-prose"
      >
        {id.slice(0, 6)}…
      </span>
    );
  }

  let label = "";
  let tipText = "";
  let modalTitle = "";
  let modalBody: React.ReactNode = null;

  if (entity.kind === "tentpole") {
    const t = entity.item;
    label = t.text.length > 36 ? t.text.slice(0, 36) + "…" : t.text;
    tipText = t.text;
    modalTitle = "Tentpole moment";
    modalBody = (
      <div className="space-y-3">
        <p className="pv-serif text-[14px] leading-[1.65]">{t.text}</p>
        <div className="flex gap-2">
          <span className="pv-mono rounded-full border border-[hsl(var(--pv-border-soft))] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[hsl(var(--pv-text-faint))]">{t.status}</span>
          <span className="pv-mono rounded-full border border-[hsl(var(--pv-border-soft))] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[hsl(var(--pv-text-faint))]">{t.source}</span>
        </div>
      </div>
    );
  } else if (entity.kind === "cast") {
    const c = entity.item;
    label = c.name;
    tipText = [c.want, c.wound, c.lie].filter(Boolean).join(" · ");
    modalTitle = c.name;
    modalBody = (
      <div className="space-y-2 pv-serif text-[14px] leading-[1.6]">
        {c.role && <p className="pv-mono text-[10px] uppercase tracking-wide text-[hsl(var(--pv-text-faint))]">{c.role}</p>}
        {c.want && <p><span className="font-semibold">Want:</span> {c.want}</p>}
        {c.wound && <p><span className="font-semibold">Wound:</span> {c.wound}</p>}
        {c.lie && <p><span className="font-semibold">Lie:</span> {c.lie}</p>}
      </div>
    );
  } else {
    label = entity.title || `Page ${id}`;
    tipText = entity.objectiveText;
    modalTitle = entity.title || `Page ${id}`;
    modalBody = (
      <div className="space-y-2 pv-serif text-[14px] leading-[1.6]">
        {entity.objectiveText && <p>{entity.objectiveText}</p>}
        {entity.beatText && <p className="italic text-[hsl(var(--pv-text-muted))]">{entity.beatText}</p>}
      </div>
    );
  }

  return (
    <>
      <TooltipProvider delayDuration={250}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex items-center rounded-full border border-[hsl(var(--pv-accent))]/40 bg-[hsl(var(--pv-accent))]/[0.07] px-2 py-0.5 pv-mono text-[10px] text-[hsl(var(--pv-accent))] transition-colors hover:border-[hsl(var(--pv-accent))]/70 hover:bg-[hsl(var(--pv-accent))]/[0.14] align-baseline not-prose"
            >
              {label}
            </button>
          </TooltipTrigger>
          {tipText && (
            <TooltipContent className="max-w-[260px] pv-serif text-[12.5px] leading-[1.5]">
              {tipText}
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="pv-serif font-semibold">{modalTitle}</DialogTitle>
          </DialogHeader>
          <div className="mt-1">{modalBody}</div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function makeMarkdownComponents(foundations?: Foundations | null, model?: StudioModel): Components {
  return {
    code: ({ children }) => {
      const text = String(children ?? "");
      const m = text.match(/^\[([0-9a-f]{8}|\d+)\]$/);
      if (m) return <EntityChip id={m[1]} foundations={foundations} model={model} />;
      return <code className="rounded bg-[hsl(var(--pv-surface-2))] px-1 text-[0.83em]">{children}</code>;
    },
  };
}

// Past archived conversations (revision_chats.sessions), newest first — each expands read-only.
function SessionHistory({ sessions, foundations, model }: { sessions: RevisionSession[]; foundations?: Foundations | null; model?: StudioModel }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const when = (iso: string) => { try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return iso; } };
  return (
    <div className="space-y-1">
      {sessions.map((s, i) => (
        <div key={i}>
          <button type="button" onClick={() => setOpenIdx(openIdx === i ? null : i)}
            className="flex w-full items-center gap-2 py-1 text-left pv-serif text-[12px] text-[hsl(var(--pv-text-muted))] hover:text-foreground">
            <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${openIdx === i ? "rotate-180" : ""}`} />
            <span className="flex-1 truncate italic">{when(s.ended_at)} · {s.messages.length} message{s.messages.length === 1 ? "" : "s"}</span>
          </button>
          {openIdx === i && (
            <div className="space-y-2 border-l border-[hsl(var(--pv-border-soft))]/60 pl-3 pb-2">
              {s.messages.map((m, j) => (
                <div key={j} className={m.role === "user" ? "flex justify-end" : ""}>
                  {m.role === "user" ? (
                    <div className="max-w-[85%] rounded-xl rounded-br-sm bg-[hsl(var(--pv-surface-2))] px-3 py-1.5 pv-serif text-[12.5px] leading-[1.5] text-foreground whitespace-pre-wrap">{m.text}</div>
                  ) : (
                    <div className="max-w-[92%] pv-serif text-[13px] leading-[1.55] text-[hsl(var(--pv-text-muted))] prose prose-sm max-w-none dark:prose-invert"><ReactMarkdown components={makeMarkdownComponents(foundations, model)}>{m.text}</ReactMarkdown></div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
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
  const isUpstream = proposal.patch.layer !== layer;
  return (
    <Panel className="mt-4 border-[hsl(var(--pv-accent))]/45 px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <Eyebrow tone="accent">Proposed revision</Eyebrow>
        <button type="button" onClick={onDiscard} title="Discard" className="shrink-0 text-[hsl(var(--pv-text-faint))] hover:text-foreground"><X className="h-4 w-4" /></button>
      </div>
      {proposal.summary && <p className="pv-serif mt-1.5 text-[14px] leading-[1.6] text-[hsl(var(--pv-text-muted))]">{proposal.summary}</p>}

      <div className="mt-3.5">
        {isUpstream && (
          <p className="pv-mono mb-2.5 text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">
            ▲ changes {proposal.patch.layer.toUpperCase()} (upstream)
          </p>
        )}
        {(proposal.patch.layer === "beats" || proposal.patch.layer === "outline") && model
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
