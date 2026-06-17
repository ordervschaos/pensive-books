// DraftStep — the Draft step's Stage body: render prose from the approved beats. The prototype's
// pilot → continue → all rhythm, so the author never has to batch the whole book blind:
//   • write the first/next page → drop into that page's resolution ladder and write+read it in place
//   • write the N remaining at once → the durable generate-book run (same job as DraftProse), watched
//     live, resumable, cancel/restart on stall.
// The Stage owns the head + approve gate; this renders the body.
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Check, ChevronDown, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { invokeGenerateBook } from "@/lib/generateBook";
import { useLatestTaskRow, type TaskRow } from "@/hooks/useLatestTaskRow";
import { notify as fireNotification } from "@/lib/notify";
import { discardProse } from "@/lib/discardLadder";
import { NotifyWhenDone } from "../../NotifyWhenDone";
import { RunControls } from "../../RunControls";
import type { StudioModel } from "../studioModel";
import { ActionLink, DoneStrip, Hero, Pip3, ProgressMeter, RunningCard } from "../studioUi";

interface BuildProgress { done: number; total: number; phase?: string; stage?: string }
interface BuildRow extends TaskRow { progress: BuildProgress | null; error: string | null }

function draftAt(model: StudioModel): string | null {
  const entry = model.journey.draft;
  if (!entry) return null;
  const iso = typeof entry === "string" ? entry : entry.at;
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  } catch {
    return null;
  }
}

export function DraftStep({ bookId, model, onChanged, onSelectPage, onSelectStep }: { bookId: number; model: StudioModel; onChanged: () => void; onSelectPage: (pageId: number) => void; onSelectStep: (k: "beats") => void }) {
  const { toast } = useToast();
  const [notify, setNotify] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const doneKey = `draft-done-dismissed:${bookId}`;
  const [doneDismissed, setDoneDismissed] = useState(() => {
    try { return !!localStorage.getItem(doneKey); } catch { return false; }
  });
  const dismissDone = () => {
    try { localStorage.setItem(doneKey, "1"); } catch { /* ignore */ }
    setDoneDismissed(true);
  };
  const notifyRef = useRef(false);
  const notifiedRef = useRef<number | null>(null);
  const watchedRef = useRef<number | null>(null);
  useEffect(() => { notifyRef.current = notify; }, [notify]);

  const { row, refetch, stale } = useLatestTaskRow<BuildRow>({
    table: "book_generations", bookId, match: { kind: "write_all" }, activeStatuses: ["pending", "running"], staleMs: 180_000,
  });
  const active = row?.status === "pending" || row?.status === "running";
  const progress = active ? row?.progress ?? null : null;
  const running = active && progress?.stage === "prose"; // only prose stage blocks the Draft UI
  const paused = row?.status === "ready" && row?.progress?.phase === "beats_done";

  useEffect(() => {
    if (active && row) watchedRef.current = row.id;
    if (!row || watchedRef.current !== row.id) return;
    if (row.status === "done") {
      if (notifyRef.current && notifiedRef.current !== row.id) {
        notifiedRef.current = row.id;
        fireNotification("Your book draft is written", { body: "The planned pages have been written. Open the book to review them.", url: window.location.href, tag: `draft-${bookId}` });
      }
      onChanged();
    } else if (row.status === "error" && notifiedRef.current !== row.id) {
      notifiedRef.current = row.id;
      toast({ title: "Couldn't finish the draft", description: row.error ?? "The run stopped.", variant: "destructive" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id, row?.status]);

  const runAll = async () => {
    if (active) return;
    try {
      const body = paused && row ? { generationId: row.id, resume: true } : { bookId, notify };
      const { data, error } = await invokeGenerateBook(body);
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      refetch(); onChanged();
    } catch (e) {
      toast({ title: "Couldn't start the draft", description: String((e as Error)?.message ?? e), variant: "destructive" });
    }
  };

  // Pages carrying prose — what a prose discard wipes (the beats are kept, to re-draft from).
  const discardIds = model.textPages.filter((p) => p.prose !== "gap").map((p) => p.id);
  // Prose directly stale: the beat was changed after prose was written. Re-drafting fixes this.
  const staleIds = model.textPages.filter((p) => p.prose === "drift").map((p) => p.id);
  // Beat stale: the objective changed after the beat was written. Prose can't fix this — the beat
  // itself must be regenerated first (in the Beats step). Counted separately for the warning.
  const beatStaleCount = model.textPages.filter((p) => p.beat === "drift" && p.prose !== "gap").length;

  const discardAll = async () => {
    if (active || discarding || discardIds.length === 0) return;
    if (!window.confirm(
      `Discard the prose on ${discardIds.length} page${discardIds.length === 1 ? "" : "s"}? ` +
      `The beats stay — you'll re-draft the prose from them. This can't be undone.`,
    )) return;
    setDiscarding(true);
    try {
      await discardProse(bookId, discardIds);
      toast({ title: "Prose discarded", description: "Every page is back to its beat. Write all to re-draft the prose." });
      onChanged();
    } catch (e) {
      toast({ title: "Couldn't discard the prose", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setDiscarding(false);
    }
  };

  const redraftStale = async () => {
    if (active || discarding || staleIds.length === 0) return;
    if (!window.confirm(
      `Re-draft ${staleIds.length} stale page${staleIds.length === 1 ? "" : "s"}? ` +
      `The old prose is discarded and re-written from the current beat.`,
    )) return;
    setDiscarding(true);
    try {
      await discardProse(bookId, staleIds);
      onChanged();
    } catch (e) {
      toast({ title: "Couldn't reset stale pages", description: String((e as Error)?.message ?? e), variant: "destructive" });
      setDiscarding(false);
      return;
    }
    setDiscarding(false);
    await runAll();
  };

  const total = model.counts.objective + model.counts.written;
  const filled = model.counts.written;
  const remaining = model.proseRemaining;
  const allDone = remaining === 0 && model.hasWritten;
  const firstEmpty = model.textPages.find((p) => p.objective !== "gap" && p.prose === "gap");
  const lastWritten = [...model.textPages].reverse().find((p) => p.prose !== "gap");

  const pageMap = (
    <PageMap model={model} collapsed={collapsed} onSelectPage={onSelectPage} onToggle={(key) => setCollapsed((c) => ({ ...c, [key]: !c[key] }))} />
  );

  if (running) {
    return (
      <div>
        <RunningCard
          label={progress?.phase ?? "Writing pages"} done={progress?.done} total={progress?.total} unit="page"
          controls={<RunControls table="book_generations" row={row} stale={stale} onRestart={runAll} refetch={refetch} />}
        />
        <div className="mt-8">{pageMap}</div>
      </div>
    );
  }

  if (allDone) {
    const completedAt = draftAt(model);
    return (
      <div>
        {!doneDismissed && (
          <DoneStrip icon={<Check className="h-5 w-5" />} title="Every page written" onDismiss={dismissDone}>
            All {total} pages have prose.{completedAt && <span className="ml-1 text-[hsl(var(--pv-text-faint))]">Approved {completedAt}.</span>}
          </DoneStrip>
        )}
        {staleIds.length > 0 && (
          <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] px-6 py-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <div>
                <p className="pv-serif text-[14px] text-foreground">
                  {staleIds.length} {staleIds.length === 1 ? "page has" : "pages have"} stale prose — {staleIds.length === 1 ? "its beat changed" : "their beats changed"} after the prose was written.
                </p>
                <div className="mt-2">
                  <ActionLink busy={discarding} onClick={() => void redraftStale()}>
                    re-draft {staleIds.length} stale {staleIds.length === 1 ? "page" : "pages"} →
                  </ActionLink>
                </div>
              </div>
            </div>
          </div>
        )}
        {beatStaleCount > 0 && (
          <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] px-6 py-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <div>
                <p className="pv-serif text-[14px] text-foreground">
                  {beatStaleCount} {beatStaleCount === 1 ? "page has a beat" : "pages have beats"} out of sync with {beatStaleCount === 1 ? "its" : "their"} objective.
                </p>
                <div className="mt-2">
                  <ActionLink onClick={() => onSelectStep("beats")}>
                    go to Beats to regenerate →
                  </ActionLink>
                </div>
              </div>
            </div>
          </div>
        )}
        <div className="mt-4">
          <ActionLink tone="faint" busy={discarding} onClick={() => void discardAll()}>
            discard the prose & re-draft →
          </ActionLink>
        </div>
        <div className="mt-8">{pageMap}</div>
      </div>
    );
  }

  return (
    <div>
      {filled > 0 && <ProgressMeter verb="written so far" filled={filled} total={total} noun="page" />}
      {firstEmpty && (
        <Hero
          icon={filled === 0 ? <Sparkles className="h-5 w-5" /> : <ArrowRight className="h-5 w-5" />}
          title={filled === 0 ? `Write the first page — ${firstEmpty.title || "page 1"}` : `Write the next page — ${firstEmpty.title || "next"}`}
          sub={paused ? "Beats are planned — continue into the prose. Open this page to write and read it in place." : "Open this page to write it from its beat and read it straight away — then keep going one at a time, or write the rest at once."}
          onClick={() => onSelectPage(firstEmpty.id)}
        />
      )}
      <div className="mt-4 flex flex-wrap items-center gap-5 text-[13.5px]">
        <ActionLink onClick={() => void runAll()}>
          {paused ? "continue — write all the prose" : `write the ${remaining} remaining at once`} →
        </ActionLink>
        {lastWritten && <button type="button" onClick={() => onSelectPage(lastWritten.id)} className="pv-serif italic text-[hsl(var(--pv-text-muted))] hover:text-foreground">review the last page →</button>}
        {discardIds.length > 0 && (
          <ActionLink tone="faint" busy={discarding} onClick={() => void discardAll()}>
            discard the prose & re-draft →
          </ActionLink>
        )}
      </div>
      <div className="mt-4"><NotifyWhenDone enabled={notify} onChange={setNotify} /></div>
      <div className="mt-8">{pageMap}</div>
    </div>
  );
}

function PageMap({ model, collapsed, onSelectPage, onToggle }: {
  model: StudioModel;
  collapsed: Record<string, boolean>;
  onSelectPage: (pageId: number) => void;
  onToggle: (key: string) => void;
}) {
  if (model.movements.length === 0) return null;
  return (
    <div>
      <div className="mb-3 flex items-center justify-between px-0.5">
        <span className="pv-mono text-[10px] uppercase tracking-[0.18em] text-[hsl(var(--pv-text-muted))]">The book · map</span>
        <span className="pv-serif text-[11px] italic text-[hsl(var(--pv-text-faint))]">{model.sync.pct}% · {model.sync.gaps} gaps</span>
      </div>
      {model.movements.map((m) => {
        const isCollapsed = !!collapsed[m.key];
        return (
          <div key={m.key} className="mb-0.5">
            <button
              type="button"
              onClick={() => onToggle(m.key)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[hsl(var(--pv-surface-2))]"
            >
              <ChevronDown className={`h-3.5 w-3.5 text-[hsl(var(--pv-text-faint))] transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
              <span className="pv-mono text-[9.5px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-muted))]">
                {m.num ? `${m.num} · ` : ""}{m.title}
              </span>
              <span className="ml-auto pv-mono text-[11px] text-[hsl(var(--pv-text-faint))]">{m.pages.length}</span>
            </button>
            {!isCollapsed && m.pages.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelectPage(p.id)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 pl-[18px] text-left transition-colors hover:bg-[hsl(var(--pv-surface-2))]"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full border-[1.4px] transition-colors"
                  style={{
                    background: p.beat !== "gap" && p.prose !== "gap" ? "hsl(var(--pv-accent))" : "transparent",
                    borderColor: p.objective !== "gap" ? "hsl(var(--pv-accent))" : "hsl(var(--pv-text-faint))",
                  }}
                />
                <span className="flex-1 truncate pv-serif text-[13.5px] text-[hsl(var(--pv-text-muted))]">
                  {model.tentpolePageIds.has(p.id) && (
                    <span className="mr-1 text-[hsl(var(--pv-accent))]" aria-hidden>◆</span>
                  )}
                  {p.title || "(untitled)"}
                </span>
                <Pip3 objective={p.objective} beat={p.beat} prose={p.prose} />
              </button>
            ))}
          </div>
        );
      })}
      <div className="mt-3 flex flex-wrap items-center gap-x-3.5 gap-y-1 px-2 pv-serif text-[12px] text-[hsl(var(--pv-text-muted))]">
        <span className="flex items-center gap-1.5"><span className="h-[7px] w-[7px] rounded-full bg-[hsl(var(--pv-accent))]" /> written</span>
        <span className="flex items-center gap-1.5"><span className="h-[7px] w-[7px] rounded-full border-[1.5px] border-[hsl(var(--pv-text-faint))]/60" /> planned</span>
        <span className="italic text-[hsl(var(--pv-text-faint))]">objective · beat · prose</span>
      </div>
    </div>
  );
}
