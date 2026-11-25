// Calm transcript: the agent's legwork (reads, searches, prose checks, notes) folds into one "Worked"
// row between the things the author actually needs to see — their messages, replies, proposals,
// questions, memory, accept/reject receipts. Pure, so the fold rule is tested, not eyeballed.
import type { ManuscriptStep } from "./manuscriptAgent";

export type ChatItem =
  | { kind: "step"; step: ManuscriptStep; key: number }
  | { kind: "work"; steps: ManuscriptStep[]; key: number };

const WORK = new Set<ManuscriptStep["t"]>(["read", "finding"]);

export function groupSteps(steps: ManuscriptStep[]): ChatItem[] {
  const out: ChatItem[] = [];
  steps.forEach((step, i) => {
    const last = out[out.length - 1];
    if (WORK.has(step.t)) {
      if (last?.kind === "work") last.steps.push(step);
      else out.push({ kind: "work", steps: [step], key: i });
    } else out.push({ kind: "step", step, key: i });
  });
  return out;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "read 6 pages · 2 searches · checked prose · noted 4" — what the folded row says. */
export function workSummary(steps: ManuscriptStep[]): string {
  let pages = 0, searches = 0, checks = 0, notes = 0;
  for (const s of steps) {
    if (s.t === "finding") { notes += s.findings?.length ?? 0; continue; }
    if (s.label.startsWith("searched")) { searches++; continue; }
    if (s.label.startsWith("checked the prose")) { checks++; continue; }
    const many = s.label.match(/\((\d+) pages?\)|^read (\d+) pages/);
    pages += many ? Number(many[1] ?? many[2]) : 1;
  }
  return [
    pages && `read ${plural(pages, "page")}`,
    searches && plural(searches, "search", "searches"),
    checks && "checked prose",
    notes && `noted ${notes}`,
  ].filter(Boolean).join(" · ");
}
