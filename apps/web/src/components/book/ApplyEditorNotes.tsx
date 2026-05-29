import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { buildDoc } from "@/lib/inlineMarkdown";
import { VersionService } from "@/services/VersionService";
import type { EvalResult, Severity } from "./BookEvaluationSection";

// Same dual backend as the rest of the AI features: local bridge in dev, edge in prod.
const BRIDGE = import.meta.env.VITE_EVAL_BRIDGE_URL as string | undefined;

// A revision call is a network + LLM call (Anthropic 5xx/429, dropped connection, an edge
// timeout, the bridge's `claude exited N`) — retry each page a couple of times so one
// transient blip mid-cascade doesn't strand a page. Mirrors WriteAllPages.
const MAX_ATTEMPTS = 3; // 1 try + 2 retries
const RETRY_BASE_MS = 1000;
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

export interface FixIssue {
  section: string;
  severity: Severity;
  note: string;
  evidence?: string;
  suggestion?: string;
}

// Collect the editor's page-anchored notes, grouped by the page they target. Issues with no
// page_ref.id are book-level/structural — they're shown in the report's "Fix these first"
// list and left for the author; we can't responsibly one-click a structural rewrite.
export function groupByPage(result: EvalResult): Map<number, { title: string; issues: FixIssue[] }> {
  const byPage = new Map<number, { title: string; issues: FixIssue[] }>();
  for (const section of result.sections) {
    for (const issue of section.issues ?? []) {
      const id = issue.page_ref?.id;
      if (id == null) continue;
      const entry = byPage.get(id) ?? { title: issue.page_ref!.title, issues: [] };
      entry.issues.push({
        section: section.title,
        severity: issue.severity,
        note: issue.note,
        evidence: issue.evidence,
        suggestion: issue.suggestion,
      });
      byPage.set(id, entry);
    }
  }
  return byPage;
}

/**
 * One-click revision: take the editor's page-anchored notes and rewrite each affected page
 * to address them. Snapshots a version first (the restore point), then writes the revisions
 * as uncommitted draft changes — the author reviews them in "View drafts" and either saves a
 * version to keep or rolls back to discard. Non-destructive by design.
 */
export function ApplyEditorNotes({ bookId, result }: { bookId: number; result: EvalResult }) {
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; retrying?: number } | null>(null);

  const byPage = groupByPage(result);
  const pageCount = byPage.size;
  const noteCount = [...byPage.values()].reduce((n, e) => n + e.issues.length, 0);

  // Revise one page's prose to address its notes, then persist as a draft change.
  const revisePage = async (id: number, title: string | null, objective: string | undefined, issues: FixIssue[]) => {
    const body = { bookId, pageId: id, level: "page", mode: "revise", objective: objective ?? "", issues };
    let text: string;
    if (BRIDGE) {
      const r = await fetch(`${BRIDGE}/unit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      text = String(d.text ?? "").trim();
    } else {
      const { data, error } = await supabase.functions.invoke("generate-unit", { body });
      if (error) throw error;
      text = String(data?.text ?? "").trim();
    }
    if (text) {
      const { error: upErr } = await supabase.from("pages").update({ content: buildDoc(title, text) }).eq("id", id);
      if (upErr) throw upErr;
    }
  };

  const run = async () => {
    if (pageCount === 0) return;
    if (!window.confirm(
      `Apply ${noteCount} note${noteCount === 1 ? "" : "s"} across ${pageCount} page${pageCount === 1 ? "" : "s"}? ` +
      `A version is saved first so you can revert; the revised pages appear in your drafts to review.`
    )) return;

    try {
      setRunning(true);
      setProgress(null);

      // Restore point before AI touches anything. Commit pending edits into a snapshot if
      // there are any (or if there's no version yet); otherwise the latest commit already is
      // the pre-revision state. If the snapshot fails, abort — never overwrite without one.
      const [hasChanges, latest] = await Promise.all([
        VersionService.hasUncommittedChanges(bookId),
        VersionService.getLatestVersion(bookId),
      ]);
      if (hasChanges || !latest) {
        await VersionService.createCommit(bookId, "Snapshot before applying the editor's notes");
      }

      const ids = [...byPage.keys()];
      const { data: pages, error } = await supabase
        .from("pages")
        .select("id, title, metadata")
        .in("id", ids);
      if (error) throw error;
      const meta = new Map(
        (pages as Array<{ id: number; title: string | null; metadata: { objective?: string } | null }> | null ?? [])
          .map((p) => [p.id, p])
      );

      const entries = [...byPage.entries()];
      setProgress({ done: 0, total: entries.length });
      let failures = 0;
      for (let i = 0; i < entries.length; i++) {
        const [id, entry] = entries[i];
        const page = meta.get(id);
        let ok = false;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS && !ok; attempt++) {
          try {
            await revisePage(id, page?.title ?? null, page?.metadata?.objective, entry.issues);
            ok = true;
          } catch (e) {
            console.error(`apply-notes: page ${id} attempt ${attempt}/${MAX_ATTEMPTS} failed`, e);
            if (attempt < MAX_ATTEMPTS) {
              setProgress({ done: i, total: entries.length, retrying: attempt });
              await sleep(RETRY_BASE_MS * 2 ** (attempt - 1) + Math.random() * 250);
            }
          }
        }
        if (!ok) failures++;
        setProgress({ done: i + 1, total: entries.length });
      }

      toast({
        title: failures ? "Applied with some failures" : "Editor's notes applied",
        description:
          `${entries.length - failures} of ${entries.length} page${entries.length === 1 ? "" : "s"} revised` +
          `${failures ? ` (${failures} failed)` : ""}. Review them under “View drafts”, then save a version to keep — or revert to discard.`,
        variant: failures ? "destructive" : undefined,
      });
    } catch (e) {
      toast({ title: "Couldn't apply notes", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  if (pageCount === 0) return null;

  const label = progress
    ? progress.retrying
      ? `Retrying ${progress.done + 1}/${progress.total}…`
      : `Revising ${progress.done}/${progress.total}…`
    : running
      ? "Working…"
      : `Apply ${noteCount} page note${noteCount === 1 ? "" : "s"} →`;

  return (
    <div className="rounded-xl border border-[hsl(var(--pv-border-soft))] px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="pv-eyebrow">Apply the editor's notes</div>
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="pv-serif text-[14px] italic text-[hsl(var(--pv-text-muted))] transition-colors hover:text-foreground disabled:opacity-60"
        >
          {label}
        </button>
      </div>
      <p className="pv-serif mt-1.5 text-[13.5px] leading-relaxed text-[hsl(var(--pv-text-muted))]">
        Rewrites the {pageCount} page{pageCount === 1 ? "" : "s"} with page-level notes to address them, saving a version
        first so you can revert. Revisions land in your drafts to review. Structural items under
        “Fix these first” stay for your hand.
      </p>
    </div>
  );
}
