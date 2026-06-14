// BeatChat — the conversational BEAT EDITOR. The author talks to a story editor that holds the whole
// beat sheet + foundations + the fiction criteria: ask a question, ask for a summary, ask for an
// evaluation — and sometimes ask for a change. A turn is sometimes just talk, sometimes an action
// (a proposed beat revision, reviewed inline and applied via build-revision).
//
// The beats-agent edge fn is the single writer of the beat_chats thread; this panel sends a message
// and projects the row live (refresh = no-op). See docs/beat-sheet-revision.md.
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, Loader2, Plus, Sparkles, Trash2, Wand2, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useLatestTaskRow } from "@/hooks/useLatestTaskRow";
import { applyBeatPlan, LENSES, type RevisionPlan } from "@/lib/beatSheet";
import { sendBeatMessage, clearPendingPlan, type BeatChatRow } from "@/lib/beatChat";
import type { StudioModel } from "./studioModel";
import { ActionLink, Eyebrow, Panel, RunError } from "./studioUi";

export function BeatChat({ bookId, model, onChanged }: { bookId: number; model: StudioModel; onChanged: () => void }) {
  const { toast } = useToast();
  const { row, refetch } = useLatestTaskRow<BeatChatRow>({
    table: "beat_chats", bookId, activeStatuses: ["thinking"], staleMs: 120_000,
  });
  const messages = Array.isArray(row?.messages) ? row!.messages : [];
  const thinking = row?.status === "thinking";
  const pending = row?.pending_plan ?? null;

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
      await sendBeatMessage(bookId, t);
      refetch();
    } catch (e) {
      toast({ title: "The editor couldn't respond", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally { setSending(false); }
  };

  const apply = async () => {
    if (!pending) return;
    try {
      await applyBeatPlan(bookId, pending);
      await clearPendingPlan(bookId);
      onChanged();
      toast({ title: "Applying the revision", description: "Saved a version first — the sheet updates as it lands." });
    } catch (e) {
      toast({ title: "Couldn't apply", description: String((e as Error)?.message ?? e), variant: "destructive" });
    }
  };
  const discard = async () => { try { await clearPendingPlan(bookId); } catch { /* ignore */ } };

  const busy = sending || thinking;

  return (
    <Panel variant="soft" className="px-5 py-4">
      <div className="flex items-center gap-2">
        <Wand2 className="h-4 w-4 text-[hsl(var(--pv-accent))]" />
        <Eyebrow tone="accent">Beat editor</Eyebrow>
      </div>
      <p className="pv-serif mt-1 text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">
        Talk through the beats, ask for a summary or an evaluation, or ask for a change — it proposes a
        revision you review before anything is touched.
      </p>

      {messages.length > 0 && (
        <div ref={scrollRef} className="mt-4 max-h-[420px] space-y-3.5 overflow-y-auto pr-1">
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
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> reading the beats…
            </div>
          )}
        </div>
      )}

      {row?.status === "error" && row.error && <RunError msg={row.error} />}

      {pending && !thinking && (
        <PlanReview plan={pending} model={model} onApply={apply} onDiscard={discard} />
      )}

      {/* Quick actions */}
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <Chip onClick={() => void send("Summarize the beat sheet in a few lines — the shape of the story as it stands.")} disabled={busy}>Summarize</Chip>
        <Chip onClick={() => void send("Evaluate the beat sheet against the fiction criteria. Where is it strong, where does it sag, and what's the single highest-leverage fix?")} disabled={busy}>Evaluate</Chip>
        <span className="pv-mono mx-1 text-[9.5px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-faint))]">check vs</span>
        {LENSES.map((l) => (
          <Chip key={l.id} title={l.bestFor} disabled={busy}
            onClick={() => void send(`Check the beat sheet against the ${l.name} structure — what's missing, sagging, or paid off weakly. If it needs changes, propose them.`)}>
            {l.name}
          </Chip>
        ))}
      </div>

      {/* Composer */}
      <div className="mt-3 flex items-end gap-2">
        <Textarea
          value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(draft); } }}
          rows={1} placeholder="Ask anything, or say what should change…"
          disabled={busy}
          className="pv-serif min-h-[42px] resize-none text-[14px] leading-[1.55]"
        />
        <button type="button" onClick={() => void send(draft)} disabled={busy || !draft.trim()}
          title="Send"
          className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
        </button>
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

// ── The plan review (a diff) — fed by beat_chats.pending_plan ────────────────────
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

function PlanReview({ plan, model, onApply, onDiscard }: { plan: RevisionPlan; model: StudioModel; onApply: () => void; onDiscard: () => void }) {
  const changes = diffPlan(plan, model);
  return (
    <Panel className="mt-4 border-[hsl(var(--pv-accent))]/45 px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <Eyebrow tone="accent">Proposed revision</Eyebrow>
        <button type="button" onClick={onDiscard} title="Discard" className="shrink-0 text-[hsl(var(--pv-text-faint))] hover:text-foreground"><X className="h-4 w-4" /></button>
      </div>
      {plan.summary && <p className="pv-serif mt-1.5 text-[14px] leading-[1.6] text-[hsl(var(--pv-text-muted))]">{plan.summary}</p>}

      {changes.length === 0 ? (
        <p className="pv-serif mt-3 text-[13.5px] italic text-[hsl(var(--pv-text-faint))]">No structural changes proposed.</p>
      ) : (
        <ul className="mt-3.5 space-y-2.5">
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
      )}

      <div className="mt-4 flex items-center gap-5">
        <button type="button" onClick={onApply}
          className="pv-serif inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[14px] text-primary-foreground">
          <Check className="h-4 w-4" /> Apply revision
        </button>
        <ActionLink tone="faint" onClick={onDiscard}>discard</ActionLink>
        <span className="pv-serif text-[12px] italic text-[hsl(var(--pv-text-faint))]">Saves a version first · prose stays (re-draft after)</span>
      </div>
    </Panel>
  );
}
