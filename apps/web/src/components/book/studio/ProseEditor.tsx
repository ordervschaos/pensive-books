// ProseEditor — the DRAFT step's editor rail: a conversational prose reviser.
//
// Unlike the planning-layer editors (ReviseChat — one model call, because a whole layer fits in
// context), prose is far too large to reason about in one shot. So this is powered by the durable
// **revise-agent** (a `book_agent_runs` tool-loop that READS pages on demand): you give it a focused
// instruction — or hand it the latest editor's read — it reads the relevant pages, may pause to ask
// you a creative question, and ends by proposing a `book_revisions` plan. On **Apply**, the existing
// `build-revision` executor rebuilds the affected prose into your DRAFTS (review by proofreading, not a
// per-page diff — the draft layer is the safety net, nothing live is overwritten).
//
// This generalizes the old `EditorAgent` (which only acted on a read, lived on the Read step, and
// handed its plan to the retired Revise step) into one place: the Draft rail.
import { useState } from "react";
import { ArrowUp, Loader2, MessagesSquare, PenLine, Wand2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { stopRun } from "@/lib/stopRun";
import { invokeGenerateBook } from "@/lib/generateBook";
import { useLatestTaskRow, type TaskRow } from "@/hooks/useLatestTaskRow";
import { Textarea } from "@/components/ui/textarea";
import { WorkingIndicator } from "../WorkingIndicator";
import type { EvalResult } from "../BookEvaluationSection";
import { ActionLink, Eyebrow, Panel, RunError } from "./studioUi";

interface AgentStep { t: "note" | "read" | "ask" | "answer" | "plan" | "done"; label: string }
interface AgentRow extends TaskRow {
  steps: AgentStep[] | null;
  pending: { question: string; options?: string[] } | null;
  report: string | null;
  revision_id: number | null;
  cancel_requested: boolean;
  error: string | null;
}
const SELECT = "id, book_id, status, created_at, updated_at, steps, pending, report, revision_id, cancel_requested, error, target_page_id";
const STEP_MARK: Record<AgentStep["t"], string> = { note: "·", read: "↳", ask: "?", answer: "↩", plan: "◆", done: "✓" };

// `pageId` set → a single-page prose chat (the PageReview rail): runs are scoped to that page
// (target_page_id), and the whole-book affordances (write-all, address-the-read) are hidden. Unset →
// the Draft step's whole-book prose editor (target_page_id IS NULL).
export function ProseEditor({ bookId, pageId, proseRemaining = 0, onChanged }: { bookId: number; pageId?: number; proseRemaining?: number; onChanged: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [answer, setAnswer] = useState("");
  const [applying, setApplying] = useState(false);
  const [writingAll, setWritingAll] = useState(false);
  const [dismissedDoneId, setDismissedDoneId] = useState<number | null>(null);

  const { row, refetch, stale } = useLatestTaskRow<AgentRow>({
    table: "book_agent_runs", bookId, select: SELECT,
    match: { target_page_id: pageId ?? null },
    activeStatuses: ["running"], staleMs: 6 * 60 * 1000,
  });

  const running = row?.status === "running";
  const awaiting = row?.status === "awaiting_input";
  const active = running || awaiting;

  // Start a run from a free-text instruction, or by handing the agent the latest editor's read.
  const start = async (body: { instruction?: string; evaluation?: EvalResult }) => {
    if (busy) return;
    if (active) { toast({ title: "The prose editor is already working", description: "Let this run finish (or stop it) first." }); return; }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("revise-agent", { body: { bookId, ...(pageId != null ? { targetPageId: pageId } : {}), ...body } });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      setDraft("");
      refetch();
    } catch (e) {
      toast({ title: "Couldn't start the prose editor", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally { setBusy(false); }
  };

  const addressLatestRead = async () => {
    const { data } = await supabase.from("book_evaluations")
      .select("result").eq("book_id", bookId).eq("status", "done")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    const ev = (data?.result ?? null) as EvalResult | null;
    if (!ev?.verdict) { toast({ title: "No editor's read yet", description: "Run the Read step first, then bring its notes here." }); return; }
    void start({ evaluation: ev });
  };

  const sendAnswer = async (text: string) => {
    const t = text.trim();
    if (!t || !row || busy) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("revise-agent", { body: { runId: row.id, answer: t } });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      setAnswer("");
      refetch();
    } catch (e) {
      toast({ title: "Couldn't send your answer", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally { setBusy(false); }
  };

  const stop = async () => { if (!row) return; await stopRun("book_agent_runs", row.id, row.status); refetch(); };

  // Write all the remaining prose straight from the beats — the durable generate-book "write_all" job.
  // Clobber-safe (it skips pages that already have prose; beats already exist, so it goes straight to
  // the prose stage). Progress shows in the Draft center's page-map; this is just the trigger.
  const writeAll = async () => {
    if (writingAll || proseRemaining === 0) return;
    setWritingAll(true);
    try {
      const { data, error } = await invokeGenerateBook({ bookId });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      toast({ title: "Writing the prose from your beats", description: "Watch the pages fill in the map — it runs in the background and survives a refresh." });
      onChanged();
    } catch (e) {
      toast({ title: "Couldn't start writing", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setWritingAll(false);
    }
  };

  // Apply the proposed plan: build-revision snapshots a version, then rebuilds the prose into drafts.
  // The row must be 'building' before the executor will drive it (matches ReviseWithAI's apply).
  const apply = async (revisionId: number) => {
    if (applying) return;
    setApplying(true);
    try {
      await supabase.from("book_revisions").update({ status: "building" }).eq("id", revisionId);
      const { error } = await supabase.functions.invoke("build-revision", { body: { revisionId } });
      if (error) throw error;
      toast({ title: "Reworking the prose into your drafts", description: "A version was snapshotted first — proofread the drafts when it's done." });
      setDismissedDoneId(row?.id ?? null);
      onChanged();
    } catch (e) {
      toast({ title: "Couldn't apply the revision", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally { setApplying(false); }
  };

  const steps = (row?.steps ?? []) as AgentStep[];
  const lastStep = steps.length ? steps[steps.length - 1].label : "Working";
  const done = row?.status === "done";
  const dismissed = done && dismissedDoneId === row?.id;
  const showComposer = !active && !(done && !dismissed);

  return (
    <Panel variant="soft" className="px-5 py-4">
      <div className="flex items-center gap-2">
        <Wand2 className="h-4 w-4 text-[hsl(var(--pv-accent))]" />
        <Eyebrow tone="accent">{pageId != null ? "Prose editor · this page" : "Prose editor"}</Eyebrow>
      </div>
      <p className="pv-serif mt-1 text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">
        {pageId != null
          ? "Describe a change to this page — it reads the page and its context, asks about the judgment calls, then proposes a revision it builds into your draft."
          : "Describe a change to the prose — it reads the pages, asks about the judgment calls, then proposes a revision it builds into your drafts."}
      </p>

      {/* The narrated step feed — the agent's honest activity log. */}
      {active && steps.length > 0 && (
        <div className="mt-4 space-y-1">
          {steps.map((s, i) => (
            <p key={i} className={`pv-serif text-[13px] leading-relaxed ${s.t === "ask" || s.t === "plan" ? "text-foreground" : "text-[hsl(var(--pv-text-muted))]"}`}>
              <span className="pv-mono mr-1.5 text-[11px] text-[hsl(var(--pv-text-faint))]">{STEP_MARK[s.t]}</span>{s.label}
            </p>
          ))}
        </div>
      )}

      {running && !stale && <WorkingIndicator phrases={[lastStep]} hint="reading & planning" />}
      {running && stale && (
        <p className="pv-serif mt-3 text-[13.5px] leading-relaxed text-amber-600">The run hasn't advanced in a while — it may have died. Stop it and start again.</p>
      )}
      {active && (
        <button type="button" onClick={() => void stop()} disabled={row?.cancel_requested}
          className="pv-serif mt-2 text-[12.5px] italic text-[hsl(var(--pv-text-faint))] hover:text-foreground">
          {row?.cancel_requested ? "Stopping…" : "Stop"}
        </button>
      )}

      {/* The question card — the agent paused on a creative fork. */}
      {awaiting && row?.pending && (
        <div className="mt-4 space-y-3 rounded-xl border border-[hsl(var(--pv-accent))]/30 bg-[hsl(var(--pv-accent))]/[0.07] p-4">
          <p className="pv-serif text-[14.5px] leading-relaxed text-foreground">{row.pending.question}</p>
          {(row.pending.options ?? []).length > 0 && (
            <div className="flex flex-col items-start gap-1.5">
              {row.pending.options!.map((opt, i) => (
                <button key={i} type="button" disabled={busy} onClick={() => void sendAnswer(opt)}
                  className="pv-serif rounded-lg border border-[hsl(var(--pv-border-soft))] bg-background px-3 py-1.5 text-left text-[13.5px] leading-snug text-foreground hover:border-[hsl(var(--pv-accent))]/50">
                  {opt}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <Textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={1} placeholder="…or answer in your own words"
              className="pv-serif min-h-[40px] flex-1 text-[13.5px] leading-relaxed" />
            <button type="button" onClick={() => void sendAnswer(answer)} disabled={busy || !answer.trim()}
              className="inline-flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            </button>
          </div>
        </div>
      )}

      {/* Done — the report + the Apply handoff (or just the report when it only answered). */}
      {done && !dismissed && (
        <div className="mt-4 rounded-xl border border-[hsl(var(--pv-accent))]/30 bg-[hsl(var(--pv-accent))]/10 p-4">
          <div className="flex items-start justify-between gap-3">
            <p className="pv-serif text-[14px] leading-relaxed text-foreground">{row?.report || "The prose editor finished."}</p>
            <button type="button" onClick={() => setDismissedDoneId(row?.id ?? null)} aria-label="Dismiss" className="shrink-0 text-[hsl(var(--pv-text-faint))] hover:text-foreground"><X className="h-4 w-4" /></button>
          </div>
          {row?.revision_id != null && (
            <div className="mt-3 flex items-center gap-4">
              <button type="button" onClick={() => row.revision_id != null && void apply(row.revision_id)} disabled={applying}
                className="pv-serif inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-[13.5px] text-primary-foreground disabled:opacity-50">
                {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />} Apply — rework the drafts
              </button>
              <ActionLink tone="faint" onClick={() => setDismissedDoneId(row?.id ?? null)}>dismiss</ActionLink>
            </div>
          )}
        </div>
      )}

      {row?.status === "error" && <RunError msg={row.error ?? "The prose editor stopped."} />}
      {row?.status === "cancelled" && (
        <p className="pv-serif mt-3 text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">Run cancelled — nothing was changed.</p>
      )}

      {/* Composer — start a fresh instruction (hidden while a run is active or its report is up). */}
      {showComposer && (
        <>
          <div className="mt-4 flex items-end gap-2">
            <Textarea value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void start({ instruction: draft.trim() }); } }}
              rows={1} placeholder={pageId != null ? 'e.g. "Make this page colder; cut the weather."' : 'e.g. "Make chapter 3 darker and cut the map subplot."'} disabled={busy}
              className="pv-serif min-h-[42px] resize-none text-[14px] leading-[1.55]" />
            <button type="button" onClick={() => draft.trim() && void start({ instruction: draft.trim() })} disabled={busy || !draft.trim()}
              title="Send" className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            </button>
          </div>
          {pageId == null && (
            <div className="mt-3 flex flex-col items-start gap-2">
              {proseRemaining > 0 && (
                <ActionLink icon={<PenLine className="h-3.5 w-3.5" />} busy={writingAll} onClick={() => void writeAll()}>
                  Write the {proseRemaining} remaining {proseRemaining === 1 ? "page" : "pages"} from the beats
                </ActionLink>
              )}
              <ActionLink tone="faint" icon={<MessagesSquare className="h-3.5 w-3.5" />} onClick={() => void addressLatestRead()}>
                Address the latest editor's read
              </ActionLink>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
