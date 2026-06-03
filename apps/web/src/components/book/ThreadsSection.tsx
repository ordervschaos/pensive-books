import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Lock, LockOpen, Pencil, Plus, X } from "lucide-react";
import { sanitizeAIError, captureException } from "@/lib/sentry";
import { useToast } from "@/hooks/use-toast";
import {
  type Thread,
  type ThreadAnchor,
  type AnchorEvent,
  type ThreadDraft,
  type ThreadScan,
  type ThreadStatus,
  firstPromise,
  lastResolution,
  fetchThreads,
  fetchPendingScan,
  scanThreads,
  applyThreadScan,
  markScanReviewed,
  createThread,
  updateThread,
  setThreadLocked,
  deleteThread,
  formatWords,
} from "@/lib/threads";
import { WorkingIndicator, WORKING_PHRASES } from "./WorkingIndicator";
import { NotifyWhenDone } from "./NotifyWhenDone";
import { notify as fireNotification } from "@/lib/notify";

const STATUS_TONE: Record<ThreadStatus, string> = {
  planned: "text-[hsl(var(--pv-text-faint))]",
  open: "text-amber-600 dark:text-amber-500",
  closed: "text-[hsl(var(--pv-text-muted))]",
};

// How a thread reads on the shelf: distance from first promise to last resolution (or end of book).
function distanceLine(t: Thread, total: number): { text: string; drift: boolean } {
  const fp: ThreadAnchor | null = firstPromise(t);
  const lr: ThreadAnchor | null = lastResolution(t);

  if (t.status === "closed") {
    const span =
      fp?.word_offset != null && lr?.word_offset != null
        ? Math.max(0, lr.word_offset - fp.word_offset)
        : null;
    return {
      text: span != null ? `closed · ${formatWords(span)} setup→payoff` : "closed",
      drift: false,
    };
  }
  if (t.status === "open" && fp?.word_offset != null) {
    const openFor = Math.max(0, total - fp.word_offset);
    const drift = t.target_distance != null && openFor > t.target_distance;
    const budget = t.target_distance != null ? ` / ~${formatWords(t.target_distance)} budget` : "";
    return { text: `open · ${formatWords(openFor)} so far${budget}`, drift };
  }
  return {
    text: t.target_distance != null ? `planned · ~${formatWords(t.target_distance)} budget` : "planned",
    drift: false,
  };
}

// Group scan events by threadKey, preserving the order of first appearance.
function groupEvents(events: AnchorEvent[]): { key: string; events: AnchorEvent[] }[] {
  const groups: { key: string; events: AnchorEvent[] }[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    if (!seen.has(e.threadKey)) {
      seen.add(e.threadKey);
      groups.push({ key: e.threadKey, events: [e] });
    } else {
      groups.find((g) => g.key === e.threadKey)!.events.push(e);
    }
  }
  return groups;
}

type View =
  | { kind: "loading" }
  | { kind: "list" }
  | { kind: "scanning" }
  | { kind: "review"; scan: ThreadScan; accepted: boolean[] }
  | { kind: "error"; error: string };

export function ThreadsSection({ bookId, manuscriptWordCount }: { bookId: number; manuscriptWordCount: number }) {
  const { toast } = useToast();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [view, setView] = useState<View>({ kind: "loading" });
  const [applying, setApplying] = useState(false);
  const [editor, setEditor] = useState<{ thread: Thread | null } | null>(null);
  // "Notify me when done" is pre-flight here: a scan persists its row only when
  // it finishes, so the email opt-in must travel into the scan request (the
  // edge fn sets notify_email at insert → the INSERT trigger mails). The browser
  // notification is fired below when this awaiting tab gets the result.
  const [notify, setNotify] = useState(false);

  const load = async () => {
    try {
      const [ts, pending] = await Promise.all([fetchThreads(bookId), fetchPendingScan(bookId)]);
      setThreads(ts);
      setView((v) => {
        if (v.kind !== "loading" && v.kind !== "scanning") return v;
        return pending
          ? { kind: "review", scan: pending, accepted: pending.events.map(() => true) }
          : { kind: "list" };
      });
    } catch (e) {
      captureException(e);
      setView({ kind: "error", error: sanitizeAIError(e instanceof Error ? e.message : "Couldn't load threads.") });
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  const scan = async () => {
    setView({ kind: "scanning" });
    try {
      const result = await scanThreads(bookId, notify);
      setView({ kind: "review", scan: result, accepted: result.events.map(() => true) });
      if (notify)
        fireNotification("Your thread scan is ready", {
          body: "Review the promises, payoffs, and open loops it surfaced.",
          url: window.location.href,
          tag: `scan-${bookId}`,
        });
    } catch (e) {
      captureException(e);
      setView({ kind: "error", error: sanitizeAIError(e instanceof Error ? e.message : "Scan failed.") });
      if (notify)
        fireNotification("Your thread scan didn't finish", {
          body: "It ran into a problem — you can try scanning again.",
          url: window.location.href,
          tag: `scan-${bookId}`,
        });
    }
  };

  const cancelReview = async (scanId?: number | null) => {
    if (scanId != null) {
      try { await markScanReviewed(scanId, "dismissed"); } catch { /* non-fatal */ }
    }
    setView({ kind: "loading" });
    await load();
  };

  const apply = async (scanResult: ThreadScan, accepted: boolean[]) => {
    const picked = scanResult.events.filter((_, i) => accepted[i]);
    setApplying(true);
    try {
      await applyThreadScan(bookId, picked);
      if (scanResult.scanId != null) await markScanReviewed(scanResult.scanId, "applied");
      const anchorCount = picked.length;
      const newCount = new Set(picked.filter((e) => e.isNewThread).map((e) => e.threadKey)).size;
      toast({
        title: "Thread tracker updated",
        description: `${newCount} thread${newCount !== 1 ? "s" : ""} created, ${anchorCount} anchor${anchorCount !== 1 ? "s" : ""} added.`,
      });
      setView({ kind: "loading" });
      await load();
    } catch (e) {
      toast({ title: "Couldn't apply changes", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setApplying(false);
    }
  };

  const toggleLock = async (t: Thread) => {
    try {
      await setThreadLocked(t.id, !t.author_locked);
      setThreads((ts) => ts.map((x) => (x.id === t.id ? { ...x, author_locked: !x.author_locked } : x)));
    } catch (e) {
      toast({ title: "Couldn't update thread", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  const remove = async (t: Thread) => {
    try {
      await deleteThread(t.id);
      setThreads((ts) => ts.filter((x) => x.id !== t.id));
    } catch (e) {
      toast({ title: "Couldn't delete thread", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  const saveThread = async (draft: ThreadDraft) => {
    const target = editor?.thread ?? null;
    try {
      if (target) {
        await updateThread(target.id, draft);
        setThreads((ts) =>
          ts.map((x) => (x.id === target.id ? { ...x, ...draft, description: draft.description || null } : x))
        );
      } else {
        const created = await createThread(bookId, draft);
        setThreads((ts) => [...ts, created]);
      }
      setEditor(null);
    } catch (e) {
      toast({ title: "Couldn't save thread", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  const busy = view.kind === "scanning" || view.kind === "loading";

  return (
    <div className="rounded-2xl border border-border bg-[hsl(var(--pv-surface-2))]/40 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="pv-eyebrow">
          Threads ·{" "}
          <span className="pv-serif text-[13px] normal-case not-italic tracking-normal text-[hsl(var(--pv-text-muted))]">
            foreshadowing &amp; open loops
          </span>
        </div>
        {view.kind !== "scanning" && view.kind !== "review" && (
          <div className="flex shrink-0 items-center gap-4">
            <button
              type="button"
              onClick={() => setEditor({ thread: null })}
              disabled={busy}
              className="pv-serif inline-flex items-center gap-1 text-[14px] italic text-[hsl(var(--pv-text-muted))] transition-colors hover:text-foreground disabled:opacity-60"
            >
              <Plus className="h-3.5 w-3.5" /> Add thread
            </button>
            <NotifyWhenDone enabled={notify} onChange={setNotify} />
            <button
              type="button"
              onClick={scan}
              disabled={busy}
              className="pv-serif text-[14px] italic text-[hsl(var(--pv-text-muted))] transition-colors hover:text-foreground disabled:opacity-60"
            >
              {threads.length ? "Re-scan →" : "Scan the book →"}
            </button>
          </div>
        )}
      </div>

      {editor && view.kind !== "scanning" && view.kind !== "review" && (
        <ThreadEditor
          key={editor.thread?.id ?? "new"}
          thread={editor.thread}
          onCancel={() => setEditor(null)}
          onSave={saveThread}
        />
      )}

      {view.kind === "loading" && (
        <p className="pv-serif mt-3 text-[14px] italic text-[hsl(var(--pv-text-faint))]">Loading…</p>
      )}

      {view.kind === "scanning" && (
        <WorkingIndicator phrases={WORKING_PHRASES.scan} hint="~1–2s per page" />
      )}

      {view.kind === "error" && (
        <p className="pv-serif mt-3 max-w-[640px] text-[14px] leading-relaxed text-red-600 dark:text-red-400">{view.error}</p>
      )}

      {/* Idle thread list */}
      {view.kind === "list" && (
        threads.length === 0 ? (
          <p className="pv-serif mt-3 max-w-[640px] text-[15px] italic leading-relaxed text-[hsl(var(--pv-text-muted))]">
            No threads tracked yet. Add one by hand, or scan the book to surface its setups, foreshadowing,
            and open loops — then close them deliberately, at the right distance.
          </p>
        ) : (
          <div className="mt-4 space-y-1">
            {threads.map((t) => {
              const { text, drift } = distanceLine(t, manuscriptWordCount);
              const fp = firstPromise(t);
              const lr = lastResolution(t);
              return (
                <div key={t.id} className="group flex items-start justify-between gap-3 rounded-lg px-2 py-2 hover:bg-[hsl(var(--pv-surface-2))]/50">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="pv-serif text-[15px] text-foreground">{t.name}</span>
                      {t.author_locked && <Lock className="h-3 w-3 shrink-0 text-[hsl(var(--pv-text-faint))]" />}
                    </div>
                    {t.description && (
                      <p className="pv-serif text-[13.5px] italic leading-snug text-[hsl(var(--pv-text-muted))]">{t.description}</p>
                    )}
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className={`pv-mono text-[10.5px] uppercase tracking-[0.12em] ${STATUS_TONE[t.status]}`}>{text}</span>
                      {drift && (
                        <span className="pv-mono text-[10.5px] uppercase tracking-[0.12em] text-red-600 dark:text-red-400">⚠ past budget</span>
                      )}
                      {fp?.page_id != null && (
                        <Link
                          to={`/books/${bookId}/pages/${fp.page_id}`}
                          className="text-[12px] italic text-[hsl(var(--pv-text-faint))] underline-offset-2 hover:text-[hsl(var(--pv-text-muted))] hover:underline"
                        >
                          ↪ first promise
                        </Link>
                      )}
                      {lr?.page_id != null && (
                        <Link
                          to={`/books/${bookId}/pages/${lr.page_id}`}
                          className="text-[12px] italic text-[hsl(var(--pv-text-faint))] underline-offset-2 hover:text-[hsl(var(--pv-text-muted))] hover:underline"
                        >
                          ↪ last resolution
                        </Link>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button type="button" onClick={() => setEditor({ thread: t })} title="Edit thread" className="rounded p-1 text-[hsl(var(--pv-text-faint))] hover:text-foreground">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => toggleLock(t)} title={t.author_locked ? "Unlock (let scans update it)" : "Lock (protect from scans)"} className="rounded p-1 text-[hsl(var(--pv-text-faint))] hover:text-foreground">
                      {t.author_locked ? <LockOpen className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                    </button>
                    <button type="button" onClick={() => remove(t)} title="Delete thread" className="rounded p-1 text-[hsl(var(--pv-text-faint))] hover:text-red-600 dark:hover:text-red-400">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* Scan review — grouped by thread, one checkbox per anchor event */}
      {view.kind === "review" && (
        <div className="mt-4 space-y-4">
          <p className="pv-mono text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">
            Updates the thread tracker — does not edit the manuscript
          </p>
          {view.scan.summary && (
            <p className="pv-serif text-[14.5px] leading-relaxed text-foreground">{view.scan.summary}</p>
          )}

          {view.scan.events.length === 0 ? (
            <p className="pv-serif text-[15px] italic text-[hsl(var(--pv-text-muted))]">
              No thread activity found — the book has no new promises or resolutions to log.
            </p>
          ) : (
            <div className="space-y-4">
              {groupEvents(view.scan.events).map(({ key, events: groupEvts }) => {
                const isNew = key.startsWith("new:");
                const first = groupEvts[0];
                return (
                  <div key={key}>
                    {/* Thread header */}
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-2">
                      {isNew && (
                        <span className="pv-mono text-[10px] uppercase tracking-[0.14em] text-[hsl(var(--pv-accent))]">new</span>
                      )}
                      <span className="pv-serif text-[15px] text-foreground">{first.threadName}</span>
                      {first.threadDescription && (
                        <span className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-muted))]">— {first.threadDescription}</span>
                      )}
                    </div>
                    {/* Anchor events for this thread */}
                    <div className="mt-1 space-y-0.5">
                      {groupEvts.map((e) => {
                        const globalIndex = view.scan.events.indexOf(e);
                        return (
                          <label
                            key={globalIndex}
                            className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 pl-4 hover:bg-[hsl(var(--pv-surface-2))]/50"
                          >
                            <input
                              type="checkbox"
                              checked={view.accepted[globalIndex]}
                              onChange={(ev) => {
                                const next = view.accepted.slice();
                                next[globalIndex] = ev.target.checked;
                                setView({ ...view, accepted: next });
                              }}
                              className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--pv-accent))]"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-baseline gap-x-2">
                                <span
                                  className={`pv-mono text-[10px] uppercase tracking-[0.12em] ${
                                    e.role === "resolution"
                                      ? "text-emerald-600 dark:text-emerald-500"
                                      : "text-[hsl(var(--pv-text-muted))]"
                                  }`}
                                >
                                  {e.role}
                                </span>
                                <Link
                                  to={`/books/${bookId}/pages/${e.pageId}`}
                                  onClick={(ev) => ev.stopPropagation()}
                                  className="text-[12px] italic text-[hsl(var(--pv-text-faint))] underline-offset-2 hover:text-[hsl(var(--pv-text-muted))] hover:underline"
                                >
                                  ↪ page
                                </Link>
                                {e.wordOffset > 0 && (
                                  <span className="pv-mono text-[10px] text-[hsl(var(--pv-text-faint))]">
                                    {formatWords(e.wordOffset)}w in
                                  </span>
                                )}
                              </div>
                              {e.note && (
                                <p className="pv-serif text-[13px] italic leading-snug text-[hsl(var(--pv-text-faint))]">
                                  {e.note}
                                </p>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-end gap-4 pt-1">
            {view.scan.events.length > 0 && (
              <button
                type="button"
                onClick={() => cancelReview(view.scan.scanId)}
                disabled={applying}
                className="pv-serif text-[14px] italic text-[hsl(var(--pv-text-muted))] hover:text-foreground disabled:opacity-60"
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                view.scan.events.length === 0
                  ? cancelReview(view.scan.scanId)
                  : apply(view.scan, view.accepted)
              }
              disabled={applying || (view.scan.events.length > 0 && view.accepted.every((a) => !a))}
              className="pv-mono inline-flex items-center gap-1.5 rounded-full bg-[hsl(var(--pv-accent))] px-3.5 py-2 text-[10.5px] uppercase tracking-[0.12em] text-background transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {applying && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {view.scan.events.length === 0
                ? "Done"
                : `Apply ${view.accepted.filter(Boolean).length} anchor${view.accepted.filter(Boolean).length === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Manual add / edit form ─────────────────────────────────────────────────────
const STATUSES: ThreadStatus[] = ["planned", "open", "closed"];

function ThreadEditor({
  thread,
  onCancel,
  onSave,
}: {
  thread: Thread | null;
  onCancel: () => void;
  onSave: (draft: ThreadDraft) => Promise<void>;
}) {
  const [name, setName] = useState(thread?.name ?? "");
  const [description, setDescription] = useState(thread?.description ?? "");
  const [status, setStatus] = useState<ThreadStatus>(thread?.status ?? "open");
  const [budget, setBudget] = useState(thread?.target_distance != null ? String(thread.target_distance) : "");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const parsed = parseInt(budget, 10);
    setSaving(true);
    await onSave({
      name: trimmed,
      description: description.trim(),
      status,
      target_distance: Number.isFinite(parsed) && parsed > 0 ? parsed : null,
    });
    setSaving(false);
  };

  const fieldCls =
    "w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground placeholder:text-[hsl(var(--pv-text-faint))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--pv-accent))]";

  return (
    <div className="mt-4 space-y-3 rounded-xl border border-border bg-background/60 p-4">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Thread name — e.g. Mara's locket"
        className={`${fieldCls} pv-serif text-[15px]`}
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What it promises / how it pays off"
        rows={2}
        className={`${fieldCls} pv-serif resize-none`}
      />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <span className="pv-mono text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as ThreadStatus)} className={`${fieldCls} w-auto`}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="pv-mono text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">Budget (words)</span>
          <input
            type="number"
            min={0}
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            placeholder="optional"
            className={`${fieldCls} w-28`}
          />
        </label>
      </div>
      <div className="flex items-center justify-end gap-4 pt-1">
        <button type="button" onClick={onCancel} disabled={saving} className="pv-serif text-[14px] italic text-[hsl(var(--pv-text-muted))] hover:text-foreground disabled:opacity-60">
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={saving || !name.trim()}
          className="pv-mono inline-flex items-center gap-1.5 rounded-full bg-[hsl(var(--pv-accent))] px-3.5 py-2 text-[10.5px] uppercase tracking-[0.12em] text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {thread ? "Save thread" : "Add thread"}
        </button>
      </div>
    </div>
  );
}
