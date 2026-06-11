// lints — the v1 server-style invariant checks over the PLAN (docs/pinned_method.md §5), run in the
// new (pin-driven) flow only. Pure derivation: computed in the studio read-model on every render
// rather than stored, so flags can never go stale against the data they judge. (Persisting onto
// pages/book comes later, when server-side consumers — prose context, revise — need them.)
//
// Phase-3 rules: thread_unclosed, dead_page, tentpole_missing. The rest (thread_stale, flat_arc,
// state_contradiction, value_static) land with the Beats/Draft delta passes.
import type { Foundations } from "./foundations";
import type { LintFlag, PageMeta } from "./planProvenance";

/** A lint flag, optionally anchored to the page it judges (book-level flags have no pageId). */
export interface BookLint extends LintFlag {
  pageId?: number;
}

export interface LintThread {
  id: number;
  name: string;
  status: string; // planned | open | closed
  /** Count of 'resolution' anchors — 0 means no payoff page even planned. */
  resolutionCount: number;
}

export interface LintInput {
  /** Text pages in reading order (sections excluded). */
  pages: Array<{ id: number; title: string | null; metadata: PageMeta | null }>;
  threads: LintThread[];
  foundations: Foundations | null;
}

export function lintBook(input: LintInput): BookLint[] {
  const flags: BookLint[] = [];
  const hasOutline = input.pages.some((p) => !!p.metadata?.objective?.trim());
  if (!hasOutline) return flags; // nothing to judge until the outline exists

  // thread_unclosed (error): a live thread with no payoff page planned or written by book end.
  for (const t of input.threads) {
    if (t.status !== "closed" && t.resolutionCount === 0) {
      flags.push({ rule: "thread_unclosed", severity: "error", message: `Thread “${t.name}” has no payoff page.` });
    }
  }

  // dead_page (error): a planned page that changes nothing — empty planned_delta.
  for (const p of input.pages) {
    if (p.metadata?.objective?.trim() && !(p.metadata.planned_delta?.length)) {
      flags.push({ rule: "dead_page", severity: "error", pageId: p.id, message: `“${p.title || "(untitled)"}” changes nothing — no planned delta.` });
    }
  }

  // tentpole_missing (error): a pinned tentpole the outline never placed.
  for (const t of input.foundations?.tentpoles ?? []) {
    if (t.status === "pinned" && !t.placed_page_id) {
      const short = t.text.split(/\s+/).slice(0, 6).join(" ");
      flags.push({ rule: "tentpole_missing", severity: "error", message: `Pinned tentpole “${short}…” isn't placed on any page.` });
    }
  }

  return flags;
}
